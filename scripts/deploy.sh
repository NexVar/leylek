#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# deploy.sh
#
# Deploy the Leylek stack to Cloudflare in dependency order:
#
#   1. google-ads-mock, meta-ads-mock                    (no Service Bindings; HTTPS callees)
#   2. content-agent, publisher-agent, analytics-worker  (no Service Bindings)
#   3. optimizer-agent                                   (binds publisher)
#   4. gateway                                           (binds all four agents)
#   5. D1 schema migrations (remote)
#   6. Workers Secrets (via setup-cloudflare-secrets.sh)
#   7. apps/web → Cloudflare Pages
#
# Idempotent — each `wrangler deploy` overwrites the previous version. Re-run
# after a code change to push everything; pass `--workers-only` to skip the
# Pages step.
#
# Requires:
#   - CLOUDFLARE_API_TOKEN exported (or sourced from .env)
#   - wrangler 4.x on PATH
#   - pnpm install already run at the repo root
#
# Usage (from repo root):
#   ./scripts/deploy.sh                  # full deploy
#   ./scripts/deploy.sh --workers-only   # skip Pages + secrets
#   ./scripts/deploy.sh --pages-only     # only Pages
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

# Load .env if present so CLOUDFLARE_API_TOKEN flows to wrangler.
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$REPO_ROOT/.env"
  set +a
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "${RED}ERROR:${RESET} CLOUDFLARE_API_TOKEN not set. Add it to .env or export it." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Flag parsing
# ---------------------------------------------------------------------------
DO_WORKERS=true
DO_PAGES=true
DO_SECRETS=true
DO_MIGRATE=true

case "${1:-}" in
  --workers-only) DO_PAGES=false; DO_SECRETS=false ;;
  --pages-only)   DO_WORKERS=false; DO_SECRETS=false; DO_MIGRATE=false ;;
  --no-secrets)   DO_SECRETS=false ;;
  --no-migrate)   DO_MIGRATE=false ;;
  "" ) ;;
  *) echo "${RED}Unknown flag: $1${RESET}"; exit 2 ;;
esac

deploy_worker() {
  local dir="$1"
  echo ""
  echo "${BOLD}▸ Deploying $dir${RESET}"
  ( cd "$dir" && wrangler deploy )
}

# ---------------------------------------------------------------------------
# 1. Mock platform workers — no Service Bindings; reached over HTTPS by
#    publisher-agent + analytics-worker via GOOGLE_ADS_BASE_URL /
#    META_ADS_BASE_URL env vars. Deploy first so first-call latency on a
#    fresh stack doesn't hit a cold 404.
# ---------------------------------------------------------------------------
if $DO_WORKERS; then
  deploy_worker workers/google-ads-mock
  deploy_worker workers/meta-ads-mock

  # 2. Other leaf workers — no Service Bindings between this trio.
  deploy_worker workers/content-agent
  deploy_worker workers/publisher-agent
  deploy_worker workers/analytics-worker

  # 3. Optimizer binds publisher (needs publisher to exist first).
  deploy_worker workers/optimizer-agent

  # 4. Gateway binds everything else.
  deploy_worker workers/gateway
fi

# ---------------------------------------------------------------------------
# 4. D1 migrations to remote (production database).
# ---------------------------------------------------------------------------
if $DO_MIGRATE; then
  echo ""
  echo "${BOLD}▸ Applying D1 migrations to leylek-prod (remote)${RESET}"
  # `wrangler d1 migrations apply` is idempotent — only un-applied files run.
  ( cd workers/gateway && wrangler d1 migrations apply leylek-prod --remote )
fi

# ---------------------------------------------------------------------------
# 5. Push Workers Secrets from .env.
# ---------------------------------------------------------------------------
if $DO_SECRETS; then
  echo ""
  echo "${BOLD}▸ Pushing Workers Secrets${RESET}"
  bash "$SCRIPT_DIR/setup-cloudflare-secrets.sh"
fi

# ---------------------------------------------------------------------------
# 6. Frontend → Cloudflare Pages.
# ---------------------------------------------------------------------------
if $DO_PAGES; then
  echo ""
  echo "${BOLD}▸ Building apps/web${RESET}"
  pnpm --filter @leylek/web build

  echo ""
  echo "${BOLD}▸ Deploying apps/web → Cloudflare Pages (project: leylek-web)${RESET}"
  # First call auto-creates the project.
  ( cd apps/web && wrangler pages deploy dist \
      --project-name leylek-web \
      --branch main \
      --commit-dirty=true )
fi

echo ""
echo "${GREEN}${BOLD}✓ Deploy complete${RESET}"
