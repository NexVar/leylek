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
- **Provider:** `google` (real Google OAuth) or `magic_link` (Resend) — see §6.

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

## 6. Auth strategy

Two paths, both production. No dev-login backdoor.

- **Google OAuth:** `/api/auth/google/start` → Google consent → callback
  at `/api/auth/google/callback`. Requires the user (once) to add
  `https://leylek.nexvar.io/api/auth/google/callback` to the OAuth
  client's Authorized redirect URIs in Cloud Console AND publish the
  Consent Screen to Production (basic scopes — `openid email profile` —
  publish instantly, no Google verification). Step-by-step instructions
  in DEMO_PLAYBOOK §10.
- **Magic-link via Resend:** POST `/api/auth/magic-link/request`,
  gateway mints a 10-min URL-safe token in KV + sends a Turkish HTML
  email through Resend's REST API. Verify endpoint deletes the KV
  entry on first hit and issues the same JWT cookie. Requires Resend
  domain verification (see §9).

E2E test uses neither button — it POSTs the magic-link request, pulls
the resulting `magic_link:*` entry out of KV via the Cloudflare REST
API, then navigates the browser to the verify URL. Mirrors what a real
user does after clicking the link in their inbox.

## 7. Hosting topology

Single-origin. Everything served from `https://leylek.nexvar.io`:

- `/` (and any path that's not `/api/*`) → Cloudflare Pages project
  `leylek-web` (custom domain attached via Pages API; CNAME on
  nexvar.io zone). Auto-deploy on push to `main` via the
  `deploy-pages` job in `.github/workflows/ci.yml`.
- `/api/*` → `leylek-gateway` Worker via a Cloudflare zone route
  binding (`leylek.nexvar.io/api/*`) attached out-of-band via the
  Workers Routes API with a scoped token.
- Other 4 Workers (`content-agent`, `optimizer-agent`,
  `publisher-agent`, `analytics-worker`) are reachable only by the
  gateway via Service Bindings — no public URL needed. They keep
  their `workers.dev` URLs as a side-effect of deploy but aren't
  part of the demo path.

Cookie: `SameSite=Lax` (same-origin, tighter than the previous
SameSite=None split-domain setup).

## 8. Cron triggers

PRD has `optimizer-agent` every 6h and `analytics-worker` every 15min. Both
kept; the demo path uses the manual `POST /internal/optimize/:campaignId`
trigger so no waiting is needed in the 60-second flow.

## 9. Resend domain verification

Two flows hit Resend: the gateway's magic-link send and the
optimizer's Co-Pilot proposal email (PRD §7). Both go through the
verified domain `leylek.nexvar.io` (SPF MX/TXT + DKIM TXT + DMARC TXT
in nexvar.io zone). FROM address is
`Leylek <noreply@leylek.nexvar.io>`.

When Resend rejects (transient or domain-unverified), the gateway
returns `502 {sent: false, error: 'email_provider_rejected'}` and
the UI surfaces a clean retry. The optimizer's Co-Pilot email is
fire-and-forget via `ctx.waitUntil` — proposal is already in D1, in-app
`NotificationsPanel` is the primary channel.

One-time verification step at `resend.com/domains` (user clicks
"Verify DNS Records" after the records propagate).

## 10. Things deliberately NOT done in this build-out

- **Meta Marketing API real implementation** — Faz 2 per PRD §10.
- **Co-Pilot push notifications** — email channel covers PRD §7;
  web push is PRD §18 open question.
- **Billing / multi-tenant / Shopify** — PRD vision-only.

## 11. Update protocol

Whenever a decision is overridden by the user, append a dated entry at the
bottom rather than rewriting history.
