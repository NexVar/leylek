# Agent Build Log

> Per-wave summary of what the autonomous agent built, why, and what verified
> green. Newest wave at the top. Companion to
> [AGENT_DECISIONS.md](./AGENT_DECISIONS.md) — decisions are the "what",
> this log is the "how it actually landed".

---

## Wave 4 — Honesty pass + UX cleanup (2026-05-19)

**Trigger:** the user noticed two real issues that Wave 3 silently glossed over:

1. **Google OAuth fails with `redirect_uri_mismatch`** when the user clicks
   "Google ile Giriş Yap". The gateway's redirect URI was correct in code
   but the **OAuth client's Cloud Console config** never got the
   production gateway URL added — that's a one-time manual step in
   `console.cloud.google.com/apis/credentials` that lives in the user's
   own Google account, not in this repo. I marked Wave 2/3 "complete"
   based on the dev-login E2E pass, which is misleading.
2. **`GET /api/auth/me` returned 401 to unauthenticated visitors**, which
   the frontend handled correctly (redirected to /login) but splashed a
   red entry in every visitor's devtools network tab on first paint.

**Shipped:**
- `gateway/src/routes/auth.ts`: `/me` now returns **200 + `{user: null}`**
  when no session cookie / invalid JWT is present, instead of 401. The
  frontend's `ProtectedRoute` already handled the falsy-user case, so
  this is a strict UX win — same redirect, no scary devtools red. Type
  on `AuthMeResponse.user` widened to `User | null` end-to-end.
- `apps/web/src/components/ProtectedRoute.tsx`: dropped the 401-error
  branch (now unreachable) and `clearUser()` is called when the API
  reports `user: null`.
- `apps/web/src/pages/Login.tsx`: a small caption under the
  "Google ile Giriş Yap" button explaining the Cloud Console
  prerequisite, with a pointer to `DEMO_PLAYBOOK.md §9`.
- `docs/DEMO_PLAYBOOK.md`: new **§9 — Enabling the real Google OAuth
  button**. Three numbered Cloud Console steps (add redirect URI, add
  test user, verify with `curl`), plus a "why this is manual"
  paragraph so future readers don't repeat the assumption I made.
- `docs/AGENT_DECISIONS.md §6`: rewritten to call out the one-time
  Cloud Console step explicitly.

**Verified:**
- `curl /api/auth/me` → `200 {"user":null}` (was 401).
- Direct visit to `/dashboard` still redirects to `/login` (the SPA
  guard collapses to a single `user?` test).
- `./scripts/e2e-demo.sh` still green end-to-end.
- `pnpm -r typecheck`, `pnpm lint`, `gitleaks detect` all clean.

**Lesson logged for the autonomous agent:** "claim works in production"
needs an actual production click-through, not a passing E2E that uses a
side-door. The verification-before-completion skill exists for exactly
this reason. Next time, before marking a goal complete that touches a
third-party OAuth provider, walk through the real consent screen — or
document the manual step BEFORE saying "done".

---

## Wave 3 — E2E + Polish (2026-05-19)

**Goal:** Reproducible end-to-end verification on the deployed URL plus
the demo-day documentation the jury walks in with.

**Shipped:**
- `scripts/e2e-demo.sh` — drives `agent-browser` through the full demo
  flow against the deployed Pages + Workers stack: dev-login, dashboard,
  campaign detail, "Şimdi Optimize Et", optimizer toast, ad pause. Asserts
  via gateway API that AGGRESSIVE → `status: paused` and that the newest
  `agent_log` row is `optimizer/PAUSE_AD`. Saves 5 stage screenshots into
  `e2e-out/`.
- `docs/DEMO_PLAYBOOK.md` — 60-second jury runbook + recovery table +
  defensive lines for the four jury archetypes (PRD §15).
- `README.md` updated with the live URLs, the deploy + seed + e2e
  one-liners, and the corrected agent stack (Flash, not Pro, per the
  Wave 2 quota fix).

**Verified:**
- `./scripts/e2e-demo.sh` → green. AGGRESSIVE → paused, newest agent_log
  = `optimizer/PAUSE_AD/target=<adId>`, 5 logs total. All 5 Workers
  report healthy via the gateway aggregate `/api/health`.
- The Gemini reasoning is visible in the toast for ~5 s; the screenshot
  (`e2e-out/04-optimizer-toast.png`) captures it for the jury.

---

## Wave 2 — Deploy + Bind (2026-05-19)

**Goal:** Stand up the full stack on Cloudflare with all Service Bindings
wired and secrets pushed, then seed the demo dataset.

**Shipped:**
- 5 Workers deployed in dependency order via `scripts/deploy.sh`:
  - `leylek-content-agent.batuhanbayazitt.workers.dev`
  - `leylek-publisher-agent.batuhanbayazitt.workers.dev`
  - `leylek-analytics-worker.batuhanbayazitt.workers.dev` (cron */15)
  - `leylek-optimizer-agent.batuhanbayazitt.workers.dev` (cron 0 */6)
  - `leylek-gateway.batuhanbayazitt.workers.dev`
- Cloudflare Pages project `leylek-web` → https://leylek-web.pages.dev.
- D1 `leylek-prod` schema migrated remotely (7 tables + indexes).
- Workers Secrets pushed: 14 secrets across the 5 Workers (the 8 empty
  Meta + Google-Ads-real values stayed skipped per Faz 2).
- Demo dataset seeded via `pnpm db:seed`.

**Deploy-readiness fixes folded into Wave 2:**
1. **AES key sizing** — `AES_KEY_BASE` is 64 bytes (`openssl rand -base64 64`);
   the strict 32-byte assertion would crash on first decrypt. Switched to
   deterministic SHA-256 key derivation in `gateway/src/crypto.ts`.
2. **OAuth callback host** — `redirectUri()` was pointing at `APP_URL`
   (the Pages frontend) but the callback lands on the gateway Worker. Added
   `GATEWAY_URL` var and pointed the OAuth redirect at it.
3. **Cookie SameSite** — Pages and Workers are different second-level
   domains; flipped to `SameSite=None; Secure` so the session survives
   cross-site `credentials: 'include'` fetches.
4. **Gemini Pro quota = 0** — free tier has zero requests/day on
   `gemini-2.5-pro` on this project; PRD §16 prescribed Flash as the
   fallback. Switched optimizer + content-agent to `gemini-2.5-flash`.
   Same Gemini API key, same structured-output contract, decisions stay
   deterministic.

**Verified:**
- `curl /api/health` returns all four upstreams green via Service Bindings.
- `POST /api/auth/dev-login` issues a session for the seeded user.
- `POST /api/campaigns/:id/optimize-now` → real Gemini Flash call →
  `OptimizerDecision { action: PAUSE_AD, targetAdId, reason }`.
- Side effects: AGGRESSIVE ad → `status: paused`, two new `agent_logs`
  rows (`optimizer/PAUSE_AD` + `publisher/PAUSED_AD`).

---

## Wave 1b — Gateway + Frontend + Seed (2026-05-19)

**Goal:** The user-facing surface (auth, dashboard, optimize CTA, seeded
demo dataset).

**Shipped (parallel agents):**
- **Gateway** — real Google OAuth + dev-login + JWT (HS256, base64url) +
  AES-256-GCM helpers. `requireAuth` middleware reads the `leylek_session`
  cookie. Campaign create runs `content-agent → D1 INSERT → publisher-agent`;
  optimize-now runs `analytics-worker refresh → optimizer-agent stream`.
  Aggregated `/api/health` probes all four upstream Workers in parallel.
- **Frontend** (`apps/web/`) — React 19 + Vite 8 + Tailwind v4 with the
  full `@theme` block translated from DESIGN.md. Pages: Login (split-pane
  brand hero + dev-login form + Google OAuth link), Dashboard (campaign
  cards), CampaignDetail (3 ad cards + spend chart + agent_logs timeline
  + "Şimdi Optimize Et" CTA + OptimizerToast with client-side reasoning
  stream). No shadcn — every primitive built from DESIGN.md tokens.
  TanStack Query v5 for fetches, Zustand for auth state.
- **Seed script** (`scripts/seed-demo-data.ts`) — pure-`fetch` against
  Cloudflare D1 + KV REST APIs, no wrangler dependency. Idempotent;
  Mulberry32 PRNG seeded `0x1eaf5eed` so reruns produce byte-stable
  `metric_snapshots`. Largest-remainder allocation across 8 × 6 h buckets
  so per-ad sums match AGENT_DECISIONS §5 totals exactly. Safety check
  refuses to run if `CLOUDFLARE_D1_DATABASE_ID` / `_KV_NAMESPACE_ID`
  don't match the pinned `leylek-prod` IDs (override with
  `LEYLEK_SEED_FORCE=1`).

**Verified:**
- `pnpm -r typecheck`, `pnpm lint` green.
- 3 parallel sub-agents returned with self-tests passing; gateway agent
  documented its transaction-boundary choice (keep half-written rows on
  publisher failure so a future `/republish` endpoint can retry).

---

## Wave 1a — Backend agent Workers (2026-05-19)

**Goal:** The four backend Workers implementing the agent contracts.

**Shipped (parallel agents):**
- **content-agent** — `POST /internal/analyze` with `@google/genai`
  structured output (`responseSchema` mirroring `ContentAgentOutput`).
  URL scrape with 5 s `AbortController` + 4 KB cap; slug-based fallback
  when the URL can't be fetched (the demo URL deliberately doesn't
  resolve). One retry on parse failure, 502 with diagnostic JSON on the
  second failure.
- **optimizer-agent + CampaignAgent DO** — DO aggregates last-48 h
  `metric_snapshots`, computes per-ad CPA + campaign median, builds a
  structured prompt, calls Gemini with `responseSchema` mirroring
  `OptimizerDecision`. Dispatches to publisher-agent via Service Binding
  on non-KEEP actions, inserts `agent_logs` row with `.returning({id})`,
  appends to DO `decisionHistory[]` (clipped to 20).
- **publisher-agent** — route handlers wired to the `AdPlatformClient`
  factory. `createCampaign + createAd × 3` on publish; `pauseAd` /
  `resumeAd` with retry-once on retryable `AdPlatformError`; budget
  reallocation persists the intent in `agent_logs.target_ref`. D1 + KV
  bindings added to `wrangler.toml`.
- **analytics-worker** — `/internal/refresh/:campaignId` aggregates
  snapshots → cached `ads.spend_kurus / cpa_kurus / ctr_basis_points`.
  Real-mode-only block calls `client.fetchMetrics()` + inserts a fresh
  snapshot before aggregating. Sim mode trusts the seed.

**Verified:**
- `pnpm -r typecheck`, `pnpm lint` green across the workspace.
- 4 parallel agents returned with self-tests passing; one cross-worker
  `loginCustomerId` bug (developer token aliased) corrected at
  integration.

---

## Wave 0 — Foundations (2026-05-19)

**Goal:** Lock down brand, design tokens, ad-platform port/adapter, and a D1
migration before parallel agents fan out. Everything downstream depends on
these.

**Shipped:**
- `docs/AGENT_DECISIONS.md` — brand "Demlik Pro", demo user, design tokens,
  sim/real ad-platform strategy, seed metric curves, auth shortcut for E2E.
- `docs/DESIGN.md` — Google `design.md` format. Navy + coral fintech palette,
  Inter, 12px radius, surface/ink hierarchy, component intent.
- `docs/AGENT_BUILD_LOG.md` — this file.
- `packages/shared-types/src/ad-platform.ts` — `AdPlatformClient` port + DTOs
  + `AdPlatformError`. Shared by publisher-agent + analytics-worker so the
  sim/real swap is one factory call deep.
- `workers/publisher-agent/src/clients/` — `SimulatedAdsClient` (in-memory
  state + realistic metric curves), `RealGoogleAdsClient` (production Google
  Ads REST calls), `MetaAdsClient` (Faz-2 stub), and `make-client.ts` factory
  that reads `LEYLEK_AD_PLATFORM`.
- Drizzle migration `0000_init.sql` generated from the existing schema.

**Verified:**
- `pnpm typecheck` green across the workspace.
- `pnpm lint` (biome) clean.
- Pre-commit gitleaks scan: 0 leaks.

**Decisions log:** see `AGENT_DECISIONS.md` §§1–9 — every value above traces
back to a numbered decision there.
