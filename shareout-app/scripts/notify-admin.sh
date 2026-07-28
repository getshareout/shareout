#!/usr/bin/env bash
set -euo pipefail

# notify-admin.sh — send a Telegram message to every super-admin (@ShareOutSuperAdminBot).
# Roster: shareout-app/superadmin-recipients.json
#
# Usage:
#   ./scripts/notify-admin.sh "Deploy finished ✅"
#   ./scripts/notify-admin.sh --title "Alert" "5xx spike on /app"
#   some_command | ./scripts/notify-admin.sh
#
# Config:
#   - TELEGRAM_ADMIN_BOT_TOKEN or TELEGRAM_BOT_TOKEN from .env
#   - Chat ids from superadmin-recipients.json (telegramChatId fields)
#   - Optional override: ADMIN_TELEGRAM_CHAT_IDS or ADMIN_TELEGRAM_CHAT_ID

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
ROSTER="$ROOT/superadmin-recipients.json"

[ -f "$ENV_FILE" ] || { echo "notify-admin: $ENV_FILE not found" >&2; exit 1; }
[ -f "$ROSTER" ] || { echo "notify-admin: $ROSTER not found" >&2; exit 1; }
TOKEN="$(grep -m1 '^TELEGRAM_ADMIN_BOT_TOKEN=' "$ENV_FILE" | cut -d= -f2- || true)"
[ -n "${TOKEN:-}" ] || TOKEN="$(grep -m1 '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | cut -d= -f2- || true)"
[ -n "${TOKEN:-}" ] || { echo "notify-admin: TELEGRAM_ADMIN_BOT_TOKEN / TELEGRAM_BOT_TOKEN missing in .env" >&2; exit 1; }

TITLE=""
if [ "${1:-}" = "--title" ]; then TITLE="${2:-}"; shift 2; fi

if [ "$#" -gt 0 ]; then MSG="$*"; else MSG="$(cat)"; fi
[ -n "${MSG:-}" ] || { echo "notify-admin: empty message" >&2; exit 1; }
[ -n "$TITLE" ] && MSG="$TITLE"$'\n'"$MSG"

CHATS="${ADMIN_TELEGRAM_CHAT_IDS:-${ADMIN_TELEGRAM_CHAT_ID:-}}"

RESULT="$(TELEGRAM_BOT_TOKEN="$TOKEN" python3 - "$ROSTER" "$CHATS" "$MSG" <<'PY'
import json, os, sys, urllib.request
token = os.environ["TELEGRAM_BOT_TOKEN"]
roster_path, chats_override, text = sys.argv[1], sys.argv[2], sys.argv[3]
with open(roster_path, encoding="utf-8") as f:
    roster = json.load(f)
if chats_override.strip():
    chats = [int(c.strip()) for c in chats_override.split(",") if c.strip()]
else:
    chats = sorted({
        int(r["telegramChatId"])
        for r in roster.get("recipients", [])
        if isinstance(r.get("telegramChatId"), int)
    })
if not chats:
    print("fail:no telegramChatId in superadmin-recipients.json — add one or set ADMIN_TELEGRAM_CHAT_IDS")
    sys.exit(1)
ok = False
for chat in chats:
    body = json.dumps({"chat_id": chat, "text": text, "disable_web_page_preview": True}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=body, headers={"Content-Type": "application/json"})
    try:
        resp = json.load(urllib.request.urlopen(req, timeout=15))
        if resp.get("ok"):
            ok = True
        else:
            print(f"fail:{chat}:{resp.get('description')}")
    except Exception as e:
        print(f"fail:{chat}:{e}")
print("ok" if ok else "fail:all chats rejected")
if not ok:
    sys.exit(1)
PY
)"

echo "notify-admin: $RESULT"
[ "$RESULT" = "ok" ]
