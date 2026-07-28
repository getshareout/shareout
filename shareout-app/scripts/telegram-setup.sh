#!/usr/bin/env bash
set -euo pipefail

# telegram-setup.sh — register the bot's profile text, slash-command menu
# (setMyCommands), and optionally the webhook (setWebhook). Run once after
# deploy, or whenever the command list or webhook URL changes.
#
# Usage:
#   ./scripts/telegram-setup.sh                 # set the command menu only
#   ./scripts/telegram-setup.sh --webhook       # also (re)register the webhook
#
# Config (from shareout-app/.env, never printed):
#   - TELEGRAM_BOT_TOKEN      (required)
#   - TELEGRAM_WEBHOOK_SECRET (required only with --webhook)
#   - WEBHOOK_URL env override (default https://shareout.site/telegram/webhook)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
[ -f "$ENV_FILE" ] || { echo "telegram-setup: $ENV_FILE not found" >&2; exit 1; }

TOKEN="$(grep -m1 '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
[ -n "${TOKEN:-}" ] || { echo "telegram-setup: TELEGRAM_BOT_TOKEN missing in .env" >&2; exit 1; }
SECRET="$(grep -m1 '^TELEGRAM_WEBHOOK_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)"
WEBHOOK_URL="${WEBHOOK_URL:-https://shareout.site/telegram/webhook}"
DO_WEBHOOK=0
[ "${1:-}" = "--webhook" ] && DO_WEBHOOK=1

TELEGRAM_BOT_TOKEN="$TOKEN" TG_SECRET="${SECRET:-}" TG_WEBHOOK_URL="$WEBHOOK_URL" TG_DO_WEBHOOK="$DO_WEBHOOK" python3 - <<'PY'
import os, json, urllib.request, sys

token = os.environ["TELEGRAM_BOT_TOKEN"]

def call(method, payload):
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})
    try:
        resp = json.load(urllib.request.urlopen(req, timeout=15))
    except Exception as e:
        print(f"{method}: FAIL {e}"); sys.exit(1)
    print(f"{method}: {'ok' if resp.get('ok') else 'FAIL ' + str(resp.get('description'))}")
    if not resp.get("ok"): sys.exit(1)

call("setMyShortDescription", {
    "short_description": "Find, summarize, and manage your ShareOut pages."
})
call("setMyDescription", {
    "description": (
        "Welcome to ShareOut in Telegram.\n\n"
        "Ask about your pages, switch workspaces, send snapshots or PDFs, "
        "check alerts and schedules, share pages, or ask a page crew to work."
    )
})

# The slash-command menu shown in Telegram's UI. Free-text questions and media
# requests are handled by the agent too; commands make the main flows discoverable.
commands = [
    {"command": "artifacts",  "description": "List pages in the current scope"},
    {"command": "search",     "description": "Find a page by name"},
    {"command": "workspaces", "description": "Show available workspaces"},
    {"command": "workspace",  "description": "Switch workspace"},
    {"command": "personal",   "description": "Focus on personal pages"},
    {"command": "status",     "description": "Show account and current scope"},
    {"command": "alerts",     "description": "List metric alerts"},
    {"command": "schedules",  "description": "List scheduled sends"},
    {"command": "snapshot",   "description": "Send a page image"},
    {"command": "pdf",        "description": "Send a page PDF"},
    {"command": "refresh",    "description": "Run live data for a page"},
    {"command": "share",      "description": "Share a page"},
    {"command": "edit",       "description": "Propose a page edit"},
    {"command": "crew",       "description": "Ask a page crew to work"},
    {"command": "settings",   "description": "Open Telegram settings"},
    {"command": "help",       "description": "What I can do"},
    {"command": "unlink",     "description": "Disconnect this chat"},
]
call("setMyCommands", {"commands": commands})
print("logo: upload public/_brand/logo-mark.png to BotFather with /setuserpic")

if os.environ.get("TG_DO_WEBHOOK") == "1":
    secret = os.environ.get("TG_SECRET") or ""
    if not secret:
        print("setWebhook: FAIL TELEGRAM_WEBHOOK_SECRET missing in .env"); sys.exit(1)
    call("setWebhook", {
        "url": os.environ["TG_WEBHOOK_URL"],
        "secret_token": secret,
        # callback_query is required for the ✅/❌ approval buttons on write actions.
        "allowed_updates": ["message", "callback_query"],
    })
PY
