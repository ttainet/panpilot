#!/usr/bin/env python3
"""PanPilot deployment via the Cloudflare API (no wrangler token needed).

Credentials NEVER touch this process: every request carries only the
`hsurr:` surrogate from dynamic_credentials, which the runtime swaps for the
real registered Cloudflare credential on approved requests to
api.cloudflare.com. Nothing secret is printed; generated secret values are
only reported as "set".

Usage:
  python3 scripts/deploy.py [--step d1|migrate|bundle|upload|secrets|domain|toml|all]

The `migrate` step applies every migrations/*.sql file (in filename order)
against the existing database; statements that fail only because the object
already exists (table/index already exists, duplicate column) are treated
as already applied, so it is safe to re-run. Use it for schema updates on an
already-deployed database — it does NOT touch secrets (DRIVER_TOKEN etc.
keep their deployed values).

State (the D1 uuid) is kept in scripts/deploy-state.json (git-ignored).
The generated DRIVER_TOKEN is written to .driver-token (mode 600, git-ignored)
for local Driver use.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets as pysecrets
import subprocess
import sys
import urllib.error
import urllib.request

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request  # noqa: E402

ACCOUNT_ID = "3941996c4a5fc4834c26be4b138b0ce7"
BASE = "https://api.cloudflare.com/client/v4"
SCRIPT_NAME = "panpilot"
HOSTNAME = "panpilot.ttai.net"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_PATH = os.path.join(ROOT, "scripts", "deploy-state.json")
DRIVER_TOKEN_PATH = os.path.join(ROOT, ".driver-token")
EXPECTED_TABLES = {"subscriptions", "episodes", "candidates", "driver_tasks", "logs", "settings"}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused, verify the endpoint")


def api(method: str, path: str, json_body=None, raw_body: bytes | None = None,
        content_type: str | None = None):
    """One authenticated CF API call. Returns (http_status, parsed_json_or_text)."""
    url = BASE + path
    data = raw_body
    headers = {}
    if json_body is not None:
        data = json.dumps(json_body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    elif content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    add_surrogate_to_request(req, "custom.cloudflare", allowed_hosts=["api.cloudflare.com"])
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=120) as resp:
            raw = resp.read()
            if not raw:
                return resp.status, {"success": True, "result": None}
            try:
                return resp.status, json.loads(raw.decode("utf-8"))
            except Exception:
                return resp.status, {"raw": raw.decode("utf-8", errors="replace")}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw}


def load_state() -> dict:
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_state(state: dict) -> None:
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def fail(step: str, status, payload) -> None:
    errors = payload.get("errors") if isinstance(payload, dict) else None
    print(f"[{step}] FAILED http={status} errors={json.dumps(errors, ensure_ascii=False)[:500]}")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Step: D1 create/reuse + migrations + table check
# ---------------------------------------------------------------------------

def step_d1() -> str:
    state = load_state()
    status, payload = api("GET", f"/accounts/{ACCOUNT_ID}/d1/database?per_page=100")
    if status != 200 or not payload.get("success"):
        fail("d1-list", status, payload)
    existing = [d for d in payload.get("result", []) if d.get("name") == SCRIPT_NAME]
    if existing:
        uuid = existing[0]["uuid"]
        print(f"[d1] reusing existing database '{SCRIPT_NAME}' uuid={uuid}")
    else:
        status, payload = api("POST", f"/accounts/{ACCOUNT_ID}/d1/database", {"name": SCRIPT_NAME})
        if status != 200 or not payload.get("success"):
            fail("d1-create", status, payload)
        uuid = payload["result"]["uuid"]
        print(f"[d1] created database '{SCRIPT_NAME}' uuid={uuid}")
    state["d1_uuid"] = uuid
    save_state(state)

    apply_all_migrations(uuid)
    verify_tables(uuid)
    return uuid


def split_sql(sql_text: str) -> list[str]:
    """Split a migration file into statements. `--` comments are stripped to
    end-of-line first: comment text may itself contain ';' (e.g.
    "-- JSON/text; NEVER store cookies"), which would otherwise corrupt the
    naive ';' statement split."""
    lines = [ln.split("--", 1)[0] for ln in sql_text.splitlines()]
    return [s.strip() for s in "\n".join(lines).split(";") if s.strip()]


def _already_applied(payload) -> bool:
    """True when a failed statement only failed because it was already applied
    (table/index already exists, duplicate column name)."""
    if not isinstance(payload, dict):
        return False
    text = json.dumps(payload.get("errors") or payload, ensure_ascii=False).lower()
    return "already exists" in text or "duplicate column" in text


def apply_all_migrations(uuid: str) -> None:
    mig_dir = os.path.join(ROOT, "migrations")
    files = sorted(f for f in os.listdir(mig_dir) if f.endswith(".sql"))
    for fname in files:
        with open(os.path.join(mig_dir, fname), encoding="utf-8") as f:
            statements = split_sql(f.read())
        print(f"[migrate] {fname}: {len(statements)} statements")
        for i, stmt in enumerate(statements, 1):
            status, payload = api(
                "POST", f"/accounts/{ACCOUNT_ID}/d1/database/{uuid}/query", {"sql": stmt})
            if status == 200 and payload.get("success"):
                continue
            if _already_applied(payload):
                print(f"[migrate] {fname} stmt {i}: already applied, skipped")
                continue
            fail(f"migrate-{fname}-{i}", status, payload)
    print("[migrate] all migrations applied")


def verify_tables(uuid: str) -> None:
    status, payload = api(
        "POST", f"/accounts/{ACCOUNT_ID}/d1/database/{uuid}/query",
        {"sql": "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"},
    )
    if status != 200 or not payload.get("success"):
        fail("d1-verify", status, payload)
    names = {row["name"] for r in payload["result"] for row in r.get("results", [])}
    missing = EXPECTED_TABLES - names
    if missing:
        print(f"[d1] FAILED: missing tables {sorted(missing)}; present: {sorted(names)}")
        sys.exit(1)
    print(f"[d1] verified tables: {sorted(EXPECTED_TABLES)}")


def step_migrate(uuid: str) -> None:
    apply_all_migrations(uuid)
    verify_tables(uuid)
    # Spot-check the v0.4 columns exist (subscriptions.poster_path).
    status, payload = api(
        "POST", f"/accounts/{ACCOUNT_ID}/d1/database/{uuid}/query",
        {"sql": "SELECT poster_path, overview, rating FROM subscriptions LIMIT 0"},
    )
    if status != 200 or not payload.get("success"):
        fail("migrate-verify-columns", status, payload)
    print("[migrate] verified subscriptions.poster_path / overview / rating columns")


# ---------------------------------------------------------------------------
# Step: bundle with esbuild
# ---------------------------------------------------------------------------

def step_bundle() -> str:
    out = os.path.join(ROOT, "dist", "index.js")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cmd = ["npx", "-y", "esbuild", "src/index.ts", "--bundle", "--format=esm",
           "--platform=neutral", f"--outfile={out}"]
    print(f"[bundle] {' '.join(cmd)}")
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if proc.returncode != 0:
        print(proc.stdout[-2000:])
        print(proc.stderr[-2000:])
        print("[bundle] FAILED")
        sys.exit(1)
    size = os.path.getsize(out)
    print(f"[bundle] ok: dist/index.js ({size} bytes)")
    return out


# ---------------------------------------------------------------------------
# Step: upload Worker script (modules format, multipart)
# ---------------------------------------------------------------------------

def step_upload(bundle_path: str, uuid: str) -> None:
    with open(bundle_path, "rb") as f:
        code = f.read()
    metadata = {
        "main_module": "index.js",
        "compatibility_date": "2024-11-01",
        "bindings": [
            {"type": "d1", "name": "DB", "id": uuid},
            {"type": "plain_text", "name": "CHECK_INTERVAL_HOURS", "text": "6"},
        ],
    }
    boundary = "----panpilot" + pysecrets.token_hex(10)
    parts = []
    parts.append(
        f"--{boundary}\r\n".encode()
        + b'Content-Disposition: form-data; name="metadata"\r\n'
        + b"Content-Type: application/json\r\n\r\n"
        + json.dumps(metadata).encode() + b"\r\n"
    )
    parts.append(
        f"--{boundary}\r\n".encode()
        + b'Content-Disposition: form-data; name="index.js"; filename="index.js"\r\n'
        + b"Content-Type: application/javascript+module\r\n\r\n"
        + code + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    status, payload = api(
        "PUT", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}",
        raw_body=body, content_type=f"multipart/form-data; boundary={boundary}",
    )
    if status != 200 or not payload.get("success"):
        fail("upload", status, payload)
    print("[upload] worker script 'panpilot' uploaded")


# ---------------------------------------------------------------------------
# Step: secrets (values generated here, never printed)
# ---------------------------------------------------------------------------

def step_secrets() -> None:
    values = {
        "APP_USERNAME": "admin",
        "APP_PASSWORD": "admin",  # initial default chosen by the owner; changeable in /settings
        "SESSION_SECRET": pysecrets.token_hex(32),
        "DRIVER_TOKEN": pysecrets.token_hex(32),
    }
    for name, text in values.items():
        status, payload = api(
            "PUT", f"/accounts/{ACCOUNT_ID}/workers/scripts/{SCRIPT_NAME}/secrets",
            {"name": name, "text": text, "type": "secret_text"},
        )
        # CF returns 201 when a secret is first created, 200 on update.
        if not (200 <= status < 300) or not payload.get("success"):
            fail(f"secret-{name}", status, payload)
        print(f"[secrets] {name}: set")
    fd = os.open(DRIVER_TOKEN_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(values["DRIVER_TOKEN"] + "\n")
    os.chmod(DRIVER_TOKEN_PATH, 0o600)
    print("[secrets] DRIVER_TOKEN also written to .driver-token (mode 600, git-ignored)")


# ---------------------------------------------------------------------------
# Step: custom domain binding
# ---------------------------------------------------------------------------

TTAI_ZONE_ID = "46521058f972d036db6b926b0d18a7f5"  # ttai.net


def step_domain() -> None:
    status, payload = api("GET", f"/accounts/{ACCOUNT_ID}/workers/domains?per_page=100")
    if status == 200 and payload.get("success"):
        for d in payload.get("result", []):
            if d.get("hostname") == HOSTNAME:
                print(f"[domain] {HOSTNAME} already bound (id={d.get('id')})")
                return
    status, payload = api(
        "POST", f"/accounts/{ACCOUNT_ID}/workers/domains",
        {"hostname": HOSTNAME, "service": SCRIPT_NAME, "environment": "production",
         "zone_id": TTAI_ZONE_ID, "zone_name": "ttai.net"},
    )
    if status == 200 and payload.get("success"):
        print(f"[domain] bound {HOSTNAME} -> service {SCRIPT_NAME} (id={payload['result'].get('id')})")
        return
    errors = payload.get("errors") if isinstance(payload, dict) else None
    print(f"[domain] workers/domains POST rejected (http={status}, errors={json.dumps(errors, ensure_ascii=False)[:300]}); "
          "falling back to zone Worker route + proxied DNS record")
    _domain_via_route()


def _domain_via_route() -> None:
    """Classic equivalent of a custom domain: a zone-level Worker route for
    panpilot.ttai.net/* plus a proxied placeholder DNS record so the hostname
    resolves to Cloudflare (the Worker answers; the origin IP is never used).
    Universal SSL on the zone covers the hostname."""
    pattern = f"{HOSTNAME}/*"
    status, payload = api("GET", f"/zones/{TTAI_ZONE_ID}/workers/routes")
    if status == 200 and payload.get("success"):
        for r in payload.get("result", []):
            if r.get("pattern") == pattern and r.get("script") == SCRIPT_NAME:
                print(f"[domain] route {pattern} -> {SCRIPT_NAME} already exists (id={r.get('id')})")
                break
        else:
            status2, payload2 = api(
                "POST", f"/zones/{TTAI_ZONE_ID}/workers/routes",
                {"pattern": pattern, "script": SCRIPT_NAME},
            )
            if status2 != 200 or not payload2.get("success"):
                fail("domain-route", status2, payload2)
            print(f"[domain] created route {pattern} -> {SCRIPT_NAME} (id={payload2['result'].get('id')})")
    else:
        fail("domain-route-list", status, payload)

    status, payload = api("GET", f"/zones/{TTAI_ZONE_ID}/dns_records?name={HOSTNAME}")
    if status == 200 and payload.get("success") and payload.get("result"):
        rec = payload["result"][0]
        print(f"[domain] DNS record for {HOSTNAME} already exists ({rec.get('type')} -> {rec.get('content')}, proxied={rec.get('proxied')})")
        return
    status, payload = api(
        "POST", f"/zones/{TTAI_ZONE_ID}/dns_records",
        {"type": "A", "name": "panpilot", "content": "192.0.2.0", "proxied": True,
         "comment": "PanPilot Worker route placeholder (origin never contacted)"},
    )
    if status != 200 or not payload.get("success"):
        fail("domain-dns", status, payload)
    print(f"[domain] created proxied DNS A record panpilot.ttai.net -> 192.0.2.0 (id={payload['result'].get('id')})")


# ---------------------------------------------------------------------------
# Step: backfill wrangler.toml database_id
# ---------------------------------------------------------------------------

def step_toml(uuid: str) -> None:
    path = os.path.join(ROOT, "wrangler.toml")
    with open(path, encoding="utf-8") as f:
        text = f.read()
    new_text, n = re.subn(r'database_id = "[^"]*"', f'database_id = "{uuid}"', text, count=1)
    if n == 0:
        print("[toml] FAILED: database_id line not found")
        sys.exit(1)
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_text)
    print(f"[toml] wrangler.toml database_id backfilled ({uuid})")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", default="all",
                    choices=["d1", "migrate", "bundle", "upload", "secrets", "domain", "toml", "all"])
    args = ap.parse_args()
    state = load_state()

    def need_uuid() -> str:
        uuid = load_state().get("d1_uuid") or state.get("d1_uuid")
        if not uuid:
            print("d1 uuid unknown — run --step d1 first")
            sys.exit(1)
        return uuid

    if args.step in ("d1", "all"):
        uuid = step_d1()
    if args.step == "migrate":
        step_migrate(need_uuid())
    if args.step in ("bundle", "all"):
        bundle = step_bundle()
    if args.step in ("upload", "all"):
        if args.step != "all":
            bundle = os.path.join(ROOT, "dist", "index.js")
            if not os.path.exists(bundle):
                bundle = step_bundle()
        step_upload(bundle, need_uuid())
    if args.step in ("secrets", "all"):
        step_secrets()
    if args.step in ("domain", "all"):
        step_domain()
    if args.step in ("toml", "all"):
        step_toml(need_uuid())
    print("[deploy] step(s) completed:", args.step)


if __name__ == "__main__":
    main()
