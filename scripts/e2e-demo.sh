#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# e2e-demo.sh
#
# Reproducible end-to-end check against the deployed Leylek demo. Mirrors the
# 60-second jury walkthrough — re-seeds the database, drives the browser
# through dev-login, dashboard, campaign detail, and the "Şimdi Optimize Et"
# CTA, then verifies the resulting state via the gateway API.
#
# Requirements:
#   - `agent-browser` on PATH (Chrome installed via `agent-browser install`).
#   - `.env` populated (D1 + KV IDs, CLOUDFLARE_API_TOKEN, demo Gemini key).
#   - 5 Workers + Pages already deployed.
#
# Outputs screenshots into `./e2e-out/` for visual inspection.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ -t 1 ]]; then
  GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; RED=$'\033[0;31m'
  BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  GREEN=""; YELLOW=""; RED=""; BOLD=""; RESET=""
fi

# Load .env so CLOUDFLARE_API_TOKEN reaches wrangler/curl callers below.
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$REPO_ROOT/.env"
  set +a
fi

GATEWAY_URL="${LEYLEK_GATEWAY_URL:-https://leylek-gateway.batuhanbayazitt.workers.dev}"
APP_URL="${LEYLEK_APP_URL:-https://leylek-web.pages.dev}"
DEMO_EMAIL="${LEYLEK_DEMO_EMAIL:-batuhanbayazitt@gmail.com}"
OUT_DIR="$REPO_ROOT/e2e-out"
mkdir -p "$OUT_DIR"

echo "${BOLD}▸ 1/6 Re-seeding demo dataset${RESET}"
pnpm db:seed | tail -10

echo ""
echo "${BOLD}▸ 2/6 Magic-link auth (KV-based token extraction)${RESET}"
# Production-grade auth: POST /magic-link/request (which always writes the KV
# entry, even when Resend rejects the recipient), then pull the freshest
# magic_link:* key out of KV via the Cloudflare REST API. This bypasses the
# Resend sandbox limit without needing a dev-login backdoor in the gateway.
test -n "${CLOUDFLARE_API_TOKEN:-}" \
  || { echo "${RED}CLOUDFLARE_API_TOKEN unset — needed for KV lookup${RESET}" >&2; exit 1; }
test -n "${CLOUDFLARE_ACCOUNT_ID:-}" \
  || { echo "${RED}CLOUDFLARE_ACCOUNT_ID unset${RESET}" >&2; exit 1; }
test -n "${CLOUDFLARE_KV_NAMESPACE_ID:-}" \
  || { echo "${RED}CLOUDFLARE_KV_NAMESPACE_ID unset${RESET}" >&2; exit 1; }

curl -sS -X POST -H 'content-type: application/json' \
  -d "{\"email\":\"$DEMO_EMAIL\"}" \
  "$GATEWAY_URL/api/auth/magic-link/request" > /dev/null

# Find the newest magic_link:* KV key.
sleep 1
MAGIC_TOKEN="$(curl -sS \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$CLOUDFLARE_KV_NAMESPACE_ID/keys?prefix=magic_link:&limit=100" \
  | python3 -c '
import json, sys
d = json.load(sys.stdin)
keys = d.get("result") or []
if not keys:
    sys.exit(0)
keys.sort(key=lambda k: k.get("expiration", 0), reverse=True)
print(keys[0]["name"].split("magic_link:", 1)[1])
')"
test -n "$MAGIC_TOKEN" \
  || { echo "${RED}no magic_link KV entry found${RESET}" >&2; exit 1; }
VERIFY_URL="$GATEWAY_URL/api/auth/magic-link/verify?token=$MAGIC_TOKEN"

# Get the campaign id while we're poking the API.
COOKIE_FILE="$(mktemp -t leylek-e2e-XXXXXX.cookies)"
trap 'rm -f "$COOKIE_FILE"' EXIT
curl -sS -c "$COOKIE_FILE" -L "$VERIFY_URL" > /dev/null
CAMPAIGN_ID="$(curl -sS -b "$COOKIE_FILE" "$GATEWAY_URL/api/campaigns" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["campaigns"][0]["id"])')"
echo "  campaign id = ${CAMPAIGN_ID}"

echo ""
echo "${BOLD}▸ 3/6 Driving the browser through the demo flow${RESET}"

# Close any previous session AND wipe the session cookie so we always start
# from a clean state.
agent-browser close --all >/dev/null 2>&1 || true

# Step A — visit /login + send the magic link via the actual UI form.
agent-browser open "$APP_URL/login" --args "--no-sandbox" > /dev/null
agent-browser cookies clear >/dev/null 2>&1 || true
agent-browser open "$APP_URL/login" > /dev/null
agent-browser wait --text 'E-postaya giriş bağlantısı gönder' > /dev/null
agent-browser screenshot "$OUT_DIR/01-login.png" > /dev/null

EMAIL_REF="$(agent-browser snapshot -i --json 2>/dev/null \
  | python3 -c 'import json,sys
data=json.load(sys.stdin)
refs=data.get("data",{}).get("refs",{})
for k,v in refs.items():
  if v.get("role")=="textbox":
    print(k); break')"
test -n "$EMAIL_REF" || { echo "${RED}could not find email input${RESET}" >&2; exit 1; }
agent-browser fill "$EMAIL_REF" "$DEMO_EMAIL" > /dev/null
agent-browser find role button click --name 'E-postaya giriş bağlantısı gönder' > /dev/null

# Step B — wait for the confirmation panel. Resend may have either delivered
# the email or rejected the recipient; either way the gateway already wrote
# the KV entry, so we can sidestep the inbox by navigating directly to the
# verify URL we resolved above.
agent-browser wait --text 'E-posta gönderildi' > /dev/null 2>&1 || true
agent-browser screenshot "$OUT_DIR/02a-magic-sent.png" > /dev/null

# Step C — request a fresh token (the one we used above is single-use) and
# navigate the browser to it. This is what a real user would do clicking
# the link in their inbox.
curl -sS -X POST -H 'content-type: application/json' \
  -d "{\"email\":\"$DEMO_EMAIL\"}" \
  "$GATEWAY_URL/api/auth/magic-link/request" > /dev/null
sleep 1
FRESH_TOKEN="$(curl -sS \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$CLOUDFLARE_KV_NAMESPACE_ID/keys?prefix=magic_link:&limit=100" \
  | python3 -c '
import json, sys
d = json.load(sys.stdin)
keys = d.get("result") or []
if not keys:
    sys.exit(0)
keys.sort(key=lambda k: k.get("expiration", 0), reverse=True)
print(keys[0]["name"].split("magic_link:", 1)[1])
')"
test -n "$FRESH_TOKEN" \
  || { echo "${RED}no fresh magic_link token found${RESET}" >&2; exit 1; }
agent-browser open "$GATEWAY_URL/api/auth/magic-link/verify?token=$FRESH_TOKEN" > /dev/null
agent-browser wait --text 'ajanların görevde' > /dev/null
agent-browser screenshot "$OUT_DIR/02-dashboard.png" > /dev/null

# Step D — navigate to campaign detail.
agent-browser open "$APP_URL/campaigns/$CAMPAIGN_ID" > /dev/null
agent-browser wait --text 'Reklam Varyantları' > /dev/null
agent-browser screenshot "$OUT_DIR/03-campaign-before.png" > /dev/null

# Step E — fire the optimizer.
agent-browser find role button click --name 'Şimdi Optimize Et' > /dev/null

# Toast streams the Gemini reasoning client-side; grab a frame while it's up.
agent-browser wait --text 'Karar' > /dev/null
sleep 2
agent-browser screenshot "$OUT_DIR/04-optimizer-toast.png" > /dev/null

# Step F — let the state settle, capture the final view.
agent-browser wait --text 'Durduruldu' > /dev/null
sleep 2
agent-browser screenshot "$OUT_DIR/05-campaign-after.png" > /dev/null

agent-browser close --all > /dev/null 2>&1 || true

echo ""
echo "${BOLD}▸ 4/6 Verifying state via the gateway API${RESET}"

CAMPAIGN_JSON_FILE="$(mktemp -t leylek-e2e-json-XXXXXX)"
curl -sS -b "$COOKIE_FILE" "$GATEWAY_URL/api/campaigns/$CAMPAIGN_ID" > "$CAMPAIGN_JSON_FILE"

# Bash + python f-strings don't mix because the embedded backslashes get eaten
# by the shell quoter. Pipe the JSON to a -c script that reads stdin.
PY_RESULT="$(python3 -c '
import json, sys
d = json.load(sys.stdin)
aggressive = next(x for x in d["ads"] if x["strategyType"] == "AGGRESSIVE")
paused = "yes" if aggressive["status"] == "paused" else "no:" + aggressive["status"]
log = d["logs"][0]
latest = "{}/{}/target={}".format(log["agentName"], log["actionTaken"], log["targetRef"])
print(paused, latest, len(d["logs"]))
' < "$CAMPAIGN_JSON_FILE")"
read -r PAUSED_OK LATEST_LOG LOG_COUNT <<< "$PY_RESULT"
rm -f "$CAMPAIGN_JSON_FILE"

echo "  aggressive ad status   = ${PAUSED_OK}"
echo "  newest agent_log       = ${LATEST_LOG}"
echo "  agent_logs count       = ${LOG_COUNT}"

if [[ "$PAUSED_OK" != "yes" || "$LATEST_LOG" != optimizer/PAUSE_AD/* ]]; then
  echo "${RED}${BOLD}✗ E2E assertions FAILED${RESET}"
  printf '%s\n' "$CAMPAIGN_JSON" | head -c 1500
  exit 1
fi

echo ""
echo "${BOLD}▸ 5/6 Health probe across all 5 workers${RESET}"
curl -sS "$GATEWAY_URL/api/health" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for name, info in d["upstream"].items():
    print("  {:10} -> {}".format(name, info["status"]))
'

echo ""
echo "${BOLD}▸ 6/6 Summary${RESET}"
echo "  Frontend  → ${APP_URL}"
echo "  Gateway   → ${GATEWAY_URL}"
echo "  Screenshots → ${OUT_DIR}"
echo "${GREEN}${BOLD}✓ E2E demo passed${RESET}"
