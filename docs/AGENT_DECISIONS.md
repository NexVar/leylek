# Agent Decisions — Leylek autonomous build-out

> Source of truth for choices the autonomous agent (Claude) made on the user's
> behalf because the goal said _"zero questions to human, decisions per PRD +
> sensible defaults"_. Every entry here is an explicit decision so future
> reviewers (and the jury) see the rationale, not a black box.

## 1. Demo brand

**Product:** "Demlik Pro — Akıllı Çay Demleme Cihazı" (Smart Turkish-tea brewing device)
**Vendor:** _Demlik Co._ — invented hypothetical Turkish e-commerce brand
**Mock product URL:** `https://demlik.pro/akilli-cay-demleme-cihazi`

Why this product:
- Universally Turkish identity (tea is the national drink) — connects with the
  hackathon's local jury.
- Clearly maps onto the three ad strategies the content-agent must produce:
  - **AGGRESSIVE:** "Çayını 3 dakikada mükemmel demle — ilk 100 sipariş %40 indirim"
  - **STORY:** "Anneannemin çay yaptığı o sabahları geri getirdik."
  - **TECHNICAL:** sıcaklık kontrolü, app entegrasyonu, demleme sayacı.
- The URL doesn't need to resolve at scrape time — the content-agent treats a
  network failure as "use the title hint" so demos and tests don't depend on a
  real e-commerce site being online.

## 2. Demo user

- **Email:** `batuhanbayazitt@gmail.com` (PRD §15 user, matches git author)
- **Provider:** `google` (real Google OAuth in prod; `dev-login` endpoint
  short-circuit for E2E only — see §6).

## 3. Ad-platform runtime

- **Demo:** `LEYLEK_AD_PLATFORM=sim` (default in `wrangler.toml [vars]` for
  every Worker that touches ad-platform actions).
- **Production-ready:** `RealGoogleAdsClient` ships in
  `workers/publisher-agent/src/clients/real-google-ads.ts`. Flips by setting
  `LEYLEK_AD_PLATFORM=real` and providing
  `GOOGLE_ADS_DEVELOPER_TOKEN` + `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.
- **Meta:** stub adapter throwing `NOT_IMPLEMENTED` per PRD §10 (Faz 2).

## 4. Design tokens (set by goal directive)

- Theme: Modern Fintech + warm coral.
- Navy `#0F1729` primary, coral `#FF6B5C` CTA, cool gray `#F4F5F7` surface,
  ink `#0B0F1A` text, white `#FFFFFF` card.
- Typography: Inter (variable, 400–700), system fallback stack.
- Radius scale: 8px / **12px (default)** / 16px / 24px.
- Spacing: 4px grid (Tailwind defaults).

Full spec: [DESIGN.md](./DESIGN.md).

## 5. Seed metric curves (sim mode)

The seed script writes a 48-hour fake history so the optimizer-agent has a
deterministic, **PRD §10 §5 catastrophic-loser** picture when the jury hits
"Şimdi Optimize Et":

| Ad | Strategy   | Impr.  | Clicks | Conv. | Spend (kurus) | CPA (TRY) |
|----|------------|--------|--------|-------|----------------|-----------|
| 1  | AGGRESSIVE | 10 500 | 220    | 60    | 1 100 000      | **183 TRY** |
| 2  | STORY      | 13 000 | 520    | 250   |   375 000      | 15 TRY    |
| 3  | TECHNICAL  |  9 500 | 285    | 95    |   380 000      | 40 TRY    |

Median CPA = 40 TRY. Ad 1 / median = 4.575× → triggers the prompt's
"catastrophic loser" branch → `action: PAUSE_AD`, `targetAdId: <ad 1>`.

Ad 2 also satisfies the "clear winner" branch (CPA 15 = 0.375× median, well
under 0.7×), but the prompt's priority order means PAUSE wins over
REALLOCATE on this snapshot. The jury sees a single decisive action.

**Applying the seed:** run `pnpm db:seed` from the repo root. The script
(`scripts/seed-demo-data.ts`) talks directly to the Cloudflare D1 + KV REST
API (no `wrangler` dependency), reads credentials from `.env`, and writes:
the demo user + `google_ads` connected account (upserted), the Demlik Pro
campaign with the three ads, three `CREATED_AD` `agent_logs` rows, **48 h of
`metric_snapshots` (8×6 h buckets per ad)** whose per-ad totals match the
table above exactly, and `sim:campaign:* / sim:ad:* / sim:metrics:*` KV
entries so the publisher-agent's `SimulatedAdsClient` recognises the
external IDs. The script is idempotent — campaign + child rows are wiped
and rewritten on each run; the bucket-level distribution is driven by a
seeded Mulberry32 PRNG so reruns produce byte-stable snapshot rows. A
safety check refuses to run if `CLOUDFLARE_D1_DATABASE_ID` or
`CLOUDFLARE_KV_NAMESPACE_ID` don't match the pinned `leylek-prod` IDs in
`workers/*/wrangler.toml`; override with `LEYLEK_SEED_FORCE=1` for a fresh
environment.

## 6. Auth strategy for the E2E demo

- **Real prod path:** Google OAuth login via the gateway
  (`/api/auth/google/start` + `/api/auth/google/callback`). Real client ID
  is in `.env`; the redirect URI registered in code is the gateway's prod
  URL (`https://leylek-gateway.batuhanbayazitt.workers.dev/api/auth/google/callback`).
  **One-time Cloud Console step required**: the user must add this exact
  redirect URI to the OAuth client's Authorized redirect URIs AND list the
  Google account that will sign in as a Test user on the consent screen
  (the app is in Testing mode by default). Without these two clicks Google
  returns `Error 400: redirect_uri_mismatch`. Step-by-step instructions
  live in `docs/DEMO_PLAYBOOK.md §9`. The gateway code is correct; this is
  pure config that lives in the user's own Google account.
- **E2E shortcut:** `/api/auth/dev-login` endpoint, only enabled when
  `LEYLEK_ALLOW_DEV_LOGIN=true`. POST `{email}` returns a signed JWT cookie
  for an existing seeded user. The jury demo + `scripts/e2e-demo.sh` both
  use this path because (a) agent-browser can't complete the Google
  consent dance in CI, and (b) it sidesteps the manual Cloud Console
  step above. Disabled in any deployment that doesn't set the flag —
  defaults to off.

## 7. Hosting topology

- 5 Workers via `wrangler deploy` (one per service), workers.dev subdomain:
  - `leylek-gateway.<account>.workers.dev`
  - `leylek-content-agent.<account>.workers.dev`
  - `leylek-optimizer-agent.<account>.workers.dev`
  - `leylek-publisher-agent.<account>.workers.dev`
  - `leylek-analytics-worker.<account>.workers.dev`
- Frontend → Cloudflare Pages project `leylek-web`. Static `vite build` output
  uploaded via `wrangler pages deploy`. `VITE_GATEWAY_URL` baked at build time.

## 8. Cron triggers

PRD has `optimizer-agent` every 6h and `analytics-worker` every 15min. Both
kept; the demo path uses the manual `POST /internal/optimize/:campaignId`
trigger so no waiting is needed in the 60-second flow.

## 9. Resend sandbox + Co-Pilot email delivery

The Resend API key in `.env` belongs to a free-tier account registered to
`sweetsavagetr@gmail.com`. Free tier with the default `onboarding@resend.dev`
sender will **only deliver to that exact address**; anything else returns
`403 validation_error`.

Two flows hit Resend:

- **Magic-link** (`gateway`): on Resend reject, gateway degrades to
  `200 {sent: false, devLink}` when `LEYLEK_ALLOW_DEV_LOGIN=true`,
  surfacing the verify URL inline in the UI. Demo + E2E ride this path.
- **Co-Pilot proposal** (`optimizer-agent`, PRD §7): after writing a
  `notifications` row, the DO fires a `ctx.waitUntil` Resend POST with
  a Turkish HTML + plain-text body containing the Gemini reasoning and
  a deep-link back to `/campaigns/:id`. On a non-2xx the response body
  is logged but never bubbles up — the proposal is already persisted
  in D1 and the in-app `NotificationsPanel` is the primary notification
  surface; the email is an additional channel.

To make Co-Pilot emails actually land in inboxes on stage, either
verify a domain at `resend.com/domains` (then change `RESEND_FROM_EMAIL`
to `notifications@yourdomain.com`), or temporarily seed the demo user
with `sweetsavagetr@gmail.com` so Resend accepts the recipient.

## 10. Things deliberately NOT done in this build-out

- **Meta Marketing API real implementation** — Faz 2 per PRD §10.
- **Magic-link auth** — stub remains; real Google OAuth + dev-login covers the
  demo. Magic-link is a 2-3 hour add-on with Resend already wired.
- **Co-Pilot full notification flow** — schema + UI placeholders are in
  place; manual approve/reject UX comes after the Otopilot path is green.
- **Billing / multi-tenant / Shopify** — PRD vision-only.

## 10. Update protocol

Whenever a decision is overridden by the user, append a dated entry at the
bottom rather than rewriting history.
