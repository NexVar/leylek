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
echo "${BOLD}▸ 2/6 Discovering seeded campaign id${RESET}"
# After seed, the dashboard's first campaign is the only one — fetch via
# dev-login cookie so we can target /campaigns/<id> deterministically.
COOKIE_FILE="$(mktemp -t leylek-e2e-XXXXXX.cookies)"
trap 'rm -f "$COOKIE_FILE"' EXIT

curl -sS -c "$COOKIE_FILE" -X POST \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$DEMO_EMAIL\"}" \
  "$GATEWAY_URL/api/auth/dev-login" >/dev/null

CAMPAIGN_ID="$(curl -sS -b "$COOKIE_FILE" "$GATEWAY_URL/api/campaigns" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["campaigns"][0]["id"])')"
echo "  campaign id = ${CAMPAIGN_ID}"

echo ""
echo "${BOLD}▸ 3/6 Driving the browser through the demo flow${RESET}"

# Close any previous session AND wipe the session cookie so the magic-link
# flow always runs from a clean state.
agent-browser close --all >/dev/null 2>&1 || true

# Step A — magic-link send. Demo Pages → Workers is cross-origin, so the
# magic-link UI is the real demo path: email in, send, the gateway either
# delivers via Resend (production) or — when the Resend free-tier sandbox
# refuses + LEYLEK_ALLOW_DEV_LOGIN is on — surfaces the verify URL inline
# as a coral "Doğrudan giriş bağlantısını aç" link. We follow that link.
agent-browser open "$APP_URL/login" --args "--no-sandbox" > /dev/null
agent-browser cookies clear >/dev/null 2>&1 || true
# Reopen instead of reload — `reload` after `cookies clear` occasionally races
# with the SPA's auth check; a fresh navigation is more deterministic.
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

# Step B — confirmation panel renders. When Resend rejects the recipient
# (sandbox sender), the panel adds a "Doğrudan giriş bağlantısını aç"
# coral link straight to the verify URL.
agent-browser wait --text 'E-posta gönderildi' > /dev/null
agent-browser screenshot "$OUT_DIR/02a-magic-sent.png" > /dev/null

# Step C — follow the dev-mode direct link. In a real-Resend deploy this
# would come from the email client; in the demo it lands in the UI.
# The link's accessible name carries a screen-reader suffix ("Aynı sekmede aç")
# so we resolve its ref dynamically rather than match on --name.
DIRECT_REF="$(agent-browser snapshot -i --json 2>/dev/null \
  | python3 -c '
import json, sys
data = json.load(sys.stdin)
refs = data.get("data", {}).get("refs", {})
for k, v in refs.items():
    if v.get("role") == "link" and "Doğrudan" in v.get("name", ""):
        print(k); break
')"
test -n "$DIRECT_REF" || { echo "${RED}could not find direct-link in sent panel${RESET}" >&2; exit 1; }
agent-browser click "$DIRECT_REF" > /dev/null
agent-browser wait --text 'ajanların görevde' > /dev/null
agent-browser screenshot "$OUT_DIR/02-dashboard.png" > /dev/null

# Step C — navigate to campaign detail.
agent-browser open "$APP_URL/campaigns/$CAMPAIGN_ID" > /dev/null
agent-browser wait --text 'Reklam Varyantları' > /dev/null
agent-browser screenshot "$OUT_DIR/03-campaign-before.png" > /dev/null

# Step D — fire the optimizer.
agent-browser find role button click --name 'Şimdi Optimize Et' > /dev/null

# Toast streams the Gemini reasoning client-side; grab a frame while it's up.
agent-browser wait --text 'Karar' > /dev/null
sleep 2
agent-browser screenshot "$OUT_DIR/04-optimizer-toast.png" > /dev/null

# Step E — let the state settle, capture the final view.
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
