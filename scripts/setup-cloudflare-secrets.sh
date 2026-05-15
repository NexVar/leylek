#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# setup-cloudflare-secrets.sh
#
# Bulk-push every required runtime secret into Cloudflare Workers via
# `wrangler secret put`. Reads values from the repo-root `.env` (gitignored).
#
# Idempotent — `wrangler secret put` overwrites an existing secret with the
# same name, so re-running the script after a new credential lands in `.env`
# is safe. Variables that are still empty in `.env` are skipped with a yellow
# warning, so the same script can be invoked again as more keys come online
# instead of doing 30+ manual wrangler invocations.
#
# Prerequisites:
#   - `wrangler` on PATH (we use 4.x).
#   - wrangler authenticated to the right Cloudflare account. Either:
#       export CLOUDFLARE_API_TOKEN=...   (matches the token in .env), or
#       `wrangler login` already run interactively.
#   - Workers exist on Cloudflare side (wrangler will create the secret
#     namespace on first `secret put`; the worker name must match
#     wrangler.toml `name = "..."`).
#
# Usage (from repo root):
#   ./scripts/setup-cloudflare-secrets.sh
#
# ---------------------------------------------------------------------------

set -euo pipefail

# --- Resolve repo root + .env, regardless of cwd ----------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy .env.example to .env and fill it in." >&2
  exit 1
fi

# --- Colors (only if stdout is a TTY) ---------------------------------------
if [[ -t 1 ]]; then
  GREEN=$'\033[0;32m'
  YELLOW=$'\033[0;33m'
  RED=$'\033[0;31m'
  BOLD=$'\033[1m'
  RESET=$'\033[0m'
else
  GREEN=""; YELLOW=""; RED=""; BOLD=""; RESET=""
fi

# --- Load .env --------------------------------------------------------------
# `set -a` auto-exports every var sourced below so the rest of the script
# can reference them by name. Restore the previous state afterwards.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# --- Worker -> secret mapping ----------------------------------------------
# One secret may be set on multiple workers. Order matters only for the log.
MAPPINGS=(
  # gateway — the front door, holds everything user-facing + JWT/AES + OAuth + email
  "leylek-gateway:GEMINI_API_KEY"
  "leylek-gateway:GOOGLE_OAUTH_CLIENT_ID"
  "leylek-gateway:GOOGLE_OAUTH_CLIENT_SECRET"
  "leylek-gateway:JWT_SECRET"
  "leylek-gateway:AES_KEY_BASE"
  "leylek-gateway:RESEND_API_KEY"
  "leylek-gateway:META_APP_ID"
  "leylek-gateway:META_APP_SECRET"

  # content-agent — only needs the LLM
  "leylek-content-agent:GEMINI_API_KEY"

  # optimizer-agent — LLM + Resend for Co-Pilot proposal notification emails (PRD §7)
  "leylek-optimizer-agent:GEMINI_API_KEY"
  "leylek-optimizer-agent:RESEND_API_KEY"

  # publisher-agent — pushes to Meta + Google Ads, needs decryption key
  "leylek-publisher-agent:META_APP_ID"
  "leylek-publisher-agent:META_APP_SECRET"
  "leylek-publisher-agent:GOOGLE_ADS_DEVELOPER_TOKEN"
  "leylek-publisher-agent:GOOGLE_OAUTH_CLIENT_ID"
  "leylek-publisher-agent:GOOGLE_OAUTH_CLIENT_SECRET"
  "leylek-publisher-agent:AES_KEY_BASE"

  # analytics-worker — pulls from Meta + Google Ads, needs decryption key
  "leylek-analytics-worker:META_APP_ID"
  "leylek-analytics-worker:META_APP_SECRET"
  "leylek-analytics-worker:GOOGLE_ADS_DEVELOPER_TOKEN"
  "leylek-analytics-worker:GOOGLE_OAUTH_CLIENT_ID"
  "leylek-analytics-worker:GOOGLE_OAUTH_CLIENT_SECRET"
  "leylek-analytics-worker:AES_KEY_BASE"
)

# --- Push each pair ---------------------------------------------------------
uploaded=0
skipped=0
failed=0

echo "${BOLD}Pushing Cloudflare Worker secrets from $ENV_FILE${RESET}"
echo

for pair in "${MAPPINGS[@]}"; do
  worker="${pair%%:*}"
  secret="${pair##*:}"
  value="${!secret-}"

  if [[ -z "$value" ]]; then
    echo "  ${YELLOW}skip${RESET}  $worker  <-  $secret  ${YELLOW}(empty in .env)${RESET}"
    skipped=$((skipped + 1))
    continue
  fi

  # `wrangler secret put` reads value from stdin in non-interactive mode.
  # Redirect stderr through so wrangler errors are still visible.
  if printf '%s' "$value" | wrangler secret put "$secret" --name "$worker" >/dev/null 2>&1; then
    echo "  ${GREEN}ok${RESET}    $worker  <-  $secret"
    uploaded=$((uploaded + 1))
  else
    echo "  ${RED}FAIL${RESET}  $worker  <-  $secret"
    failed=$((failed + 1))
  fi
done

# --- Summary ----------------------------------------------------------------
echo
echo "${BOLD}Summary${RESET}"
echo "  ${GREEN}uploaded${RESET}: $uploaded"
echo "  ${YELLOW}skipped${RESET} : $skipped (variable empty in .env — fill and re-run)"
if [[ "$failed" -gt 0 ]]; then
  echo "  ${RED}failed${RESET}  : $failed"
  exit 1
fi
