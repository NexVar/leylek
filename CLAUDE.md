# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Sync notice:** `CLAUDE.md` and `AGENTS.md` at this repo root are kept
> **byte-identical below the `BEGIN SHARED BODY` marker** so any agent
> (Claude Code, Codex, Cursor, Aider, etc.) gets the same brief. The
> preamble above the marker is the only place the two may differ — it
> exists for tool-specific addressing.

<!-- BEGIN SHARED BODY -->

## What this repo is

**Leylek** — multi-agent otonom dijital reklam ajansı. KOBİ'ler ve
e-ticaret satıcıları için Meta + Google Ads kampanyalarını otonom üreten,
yayınlayan, optimize eden bir SaaS. Tamamen Cloudflare üzerinde serverless.

PRD'nin **MVP'si canlı** (`v1.0.0` tag): https://leylek.nexvar.io. Bir
sonraki büyük iş `docs/mockdata.md` planında — Google + Meta için
production-shape mock Worker'lar yazıp tek code path'e geçmek.

## Önce şunları oku (5 dakika)

| Dosya | Niye |
|---|---|
| `README.md` | Proje girişi + canlı URL'ler + 1 dakikalık ne yaptığını anlama |
| `PRD.md` | Ürün gereksinim belgesi — §4 (MVP), §5 (multi-agent), §7 (Otopilot/Co-Pilot akışı), §10 (sim/real ad platform port + adapter), §15 (jüri narrative) |
| `docs/AGENT_BUILD_LOG.md` | Şu ana kadar 8 wave atılmış — her wave'in ne yaptığı, ne doğrulandığı |
| `docs/AGENT_DECISIONS.md` | Otonom agent'ın PRD dışında yaptığı tüm "sensible default" seçimleri (brand, seed kurvalar, auth strategy, sim/real swap, vb.) |
| `docs/DEMO_PLAYBOOK.md` | 60 saniyelik jüri walkthrough + Co-Pilot beat + Google OAuth Cloud Console kurulumu |
| `docs/DESIGN.md` | Google `design.md` formatında visual identity — Modern Fintech + warm coral, navy primary, Inter, 12 px default radius. Tailwind v4 `@theme` token'ları buradan üretiliyor |
| `docs/mockdata.md` | **Sıradaki büyük iş** — Google + Meta mock Worker'ları (8 fazlı plan, ~8 saat) |

## Mimari (kuş bakışı)

```
                    https://leylek.nexvar.io
                              │
              ┌───────────────┼────────────────┐
              │                                │
        /* (Pages)                       /api/* (Worker route)
        leylek-web                       leylek-gateway (Hono)
                                          │  │  │  │
            Service Bindings ─────────────┘  │  │  └────────┐
            (internal, no public URL)        │  │           │
                                             │  │           │
            ┌────────────────┬────────────┬──┘  │           │
            ▼                ▼            ▼     ▼           ▼
    content-agent    optimizer-agent  publisher-agent  analytics-worker
    (Gemini 2.5      (Gemini 2.5       (port+adapter:    (metric ingestion
     Flash, /        Flash, /          SimulatedAds      cron + refresh)
     analyze)        + Campaign        Client today;
                     Durable Object)   RealGoogleAds in
                                       repo per PRD §10)
                              │
                              ▼
                        D1 SQL + KV
                        (single namespace, prefixed keys)
```

**Single-origin**: frontend ve gateway aynı host'tan serve ediliyor
(`leylek.nexvar.io/api/*` zone route → `leylek-gateway` worker'a;
diğer her şey Pages'a). Cookie `SameSite=Lax`.

**5 Worker** + 1 Campaign Durable Object (`CampaignAgent`, per-campaign
atomic state). Service Bindings ile haberleşir — content/optimizer/
publisher/analytics dışarıdan public URL'ye ihtiyaç duymaz (workers.dev
URL'leri deploy artifact'ı, kullanılmıyor).

**Sim/real ad platform swap**: PRD §10 — port (`AdPlatformClient`) +
adapter pattern. Şu an `SimulatedAdsClient` (KV-state, bespoke) demo'yu
sürüyor; `RealGoogleAdsClient` production REST kodu repoda çalışır
halde, `LEYLEK_AD_PLATFORM=real` ile flip ediliyor. `MetaAdsClient`
şu an `NOT_IMPLEMENTED` stub — `mockdata.md` planı bu mimariyi
sadeleştiriyor (sim/real ayrımı yerine baseUrl env switch).

## Repo layout

```
leylek/
├── apps/web/                   # React 19 + Vite 8 + Tailwind v4 frontend
│   └── src/
│       ├── api/                # TanStack Query hooks + fetch wrapper
│       ├── components/         # All custom, no shadcn — tokens from DESIGN.md
│       ├── pages/              # Login, Dashboard, CampaignDetail, Accounts
│       └── index.css           # @theme block (Tailwind v4 CSS-first)
├── workers/
│   ├── gateway/                # Hono. OAuth + magic-link + JWT, campaign CRUD,
│   │                           #   /api/auth/* + /api/campaigns/*
│   ├── content-agent/          # Gemini 2.5 Flash structured-output URL→3 variant
│   ├── optimizer-agent/        # Campaign DO + Gemini decision + Co-Pilot
│   │                           #   email via Resend
│   ├── publisher-agent/        # AdPlatformClient port wiring,
│   │   └── src/clients/        # SimulatedAdsClient + RealGoogleAdsClient +
│   │                           #   MetaAdsClient (Faz 2 stub) + factory
│   └── analytics-worker/       # /internal/refresh + 15-min cron metric aggregation
├── packages/
│   ├── shared-types/           # Zod schemas + TS types (ad-platform port lives here)
│   ├── db/                     # Drizzle schema + migrations
│   └── prompts/                # Versioned Gemini prompts (CONTENT/OPTIMIZER)
├── scripts/
│   ├── seed-demo-data.ts       # Demlik Pro demo (idempotent, Mulberry32 PRNG)
│   ├── deploy.sh               # Local deploy walker (CI does this on push too)
│   ├── e2e-demo.sh             # agent-browser E2E against deployed URL
│   └── setup-cloudflare-secrets.sh  # Bulk wrangler secret put from .env
├── docs/
│   ├── PRD.md, ARCHITECTURE.md, DESIGN.md
│   ├── AGENT_DECISIONS.md, AGENT_BUILD_LOG.md, DEMO_PLAYBOOK.md
│   └── mockdata.md             # Next-up plan
└── .github/workflows/ci.yml    # build → typecheck → lint → deploy-pages + deploy-workers on push to main
```

## Komutlar

| Amaç | Komut |
|---|---|
| Install | `pnpm install --frozen-lockfile` |
| Typecheck all | `pnpm -r typecheck` |
| Typecheck one worker | `pnpm --filter @leylek/gateway typecheck` (or `content-agent`, `optimizer-agent`, `publisher-agent`, `analytics-worker`, `web`) |
| Lint | `pnpm lint` (Biome) |
| Auto-fix lint | `pnpm lint:fix` |
| Test (Vitest) | `pnpm test` (suite henüz boş, framework hazır) |
| Build (web + workers compile) | `pnpm build` |
| Local Vite dev | `pnpm --filter @leylek/web dev` |
| Local worker dev | `pnpm --filter @leylek/gateway dev` (port 8788, similarly 8789–8792) |
| Generate Drizzle migration | `pnpm db:generate` (in `packages/db/`) |
| Apply migration to prod D1 | `pnpm --filter @leylek/db db:migrate:prod` |
| Seed Demlik Pro demo | `pnpm db:seed` |
| Deploy everything (Workers + Pages) | `./scripts/deploy.sh` |
| Push Workers Secrets | `./scripts/setup-cloudflare-secrets.sh` |
| E2E (agent-browser, deployed URL) | `./scripts/e2e-demo.sh` |
| Health | `curl https://leylek.nexvar.io/api/health` |

## CI / auto-deploy

`.github/workflows/ci.yml`:
- Her push + PR: typecheck + lint + vitest + build
- Push to **main** ek olarak: `deploy-pages` (apps/web/dist → Pages) +
  `deploy-workers` (5 worker dependency order). `wrangler deploy` zincir
  içinde. ~1.5 dk.
- Secrets: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repo'da set
  (gh secret set ile yazıldı).

**Pages projesi "Direct Uploads" tipi** — Cloudflare-native Git source'a
switch edilemiyor (API reddediyor: `cannot update the source of a Direct
Uploads project`). Bu yüzden auto-deploy GitHub Actions üzerinden, native
Cloudflare entegrasyonu değil.

## Conventions — kesinlikle uy

### Git
- **Author**: `batuhan4` / `batuhanbayazitt@gmail.com`. Clone'da
  ilk iş: `git config user.name batuhan4 && git config user.email batuhanbayazitt@gmail.com`.
- **Co-Authored-By trailer KOYMA.** Hiçbir commit'te. `Co-Authored-By:
  Claude` falan asla yok. Bu kural bütün repo'larda geçerli.
- **Atomik commit'ler**: bir commit = bir mantıksal değişiklik. PRD §11.
  Big-bang dump yasak.
- **Conventional Commits**: `feat(scope):` / `fix(scope):` / `chore:` /
  `docs:` / `refactor(scope):` / `test:` / `perf(scope):`. PRD §11.
- **Push every 3-5 commits** — küçük partilerle göndereceğin için CI
  fail durumunda root cause kolay bulunur.

### Code
- **TypeScript strict mode** (`noUnusedLocals`, `noUnusedParameters`,
  `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`).
  Unused params'a `_` prefix.
- **Biome 2.4** lint + format. Single quote, trailing commas, lineWidth 100.
- **Zod schemas** in `@leylek/shared-types` — validation at every boundary,
  type inference everywhere. Frontend ve backend aynı tip dünyasında.
- **Drizzle ORM** for D1. Schema in `packages/db/src/schema.ts`. Migrations
  in `packages/db/migrations/`.
- **No new dependencies without strong justification** — sim adapter +
  custom SVG chart yerine recharts/shadcn yok, vb.
- **No emojis in agent output text** (DESIGN.md tone). UI affordances Lucide
  icon, agent reasoning plain Turkish prose.

### Frontend
- **Tailwind v4 `@theme`** is the only token source. Hex/px değerlerini
  asla hardcode etme — `bg-accent`, `rounded-md`, `text-h2`, vb.
- All primitives in `apps/web/src/components/` are custom and source
  their tokens from DESIGN.md. shadcn yok bilinçli.
- **Tone**: Türkçe, lowercase headings (`Reklam Varyantları`, not
  `REKLAM VARYANTLARI`). Numbers before nouns: "3 reklam aktif".
- Reasoning is the product — Gemini'nin Türkçe gerekçesi UI'da kesinlikle
  truncate edilmez.

### Workers
- **Service Bindings** (CONTENT_AGENT, OPTIMIZER_AGENT, PUBLISHER_AGENT,
  ANALYTICS_WORKER) — internet egress yok, type-safe RPC.
- **Per-worker `wrangler.toml`**, her birinde D1/KV/Service binding
  declarations. Routes ve cron triggers da burada.
- **Secrets via `wrangler secret put`** — kodda asla yok. `.env` lokal-only,
  gitignored. `scripts/setup-cloudflare-secrets.sh` toplu push için.

### Port + Adapter (PRD §10)
Şu an: `AdPlatformClient` interface'i (`packages/shared-types/src/ad-platform.ts`)
ile 3 implementation (`SimulatedAdsClient`, `RealGoogleAdsClient`,
`MetaAdsClient` stub). Factory `makeAdPlatformClient` `LEYLEK_AD_PLATFORM`
env'ine bakıyor.

**Sonraki refactor** (`docs/mockdata.md`): sim/real ayrımı kaldırılacak,
tek `RealGoogleAdsClient` + `RealMetaAdsClient`, `GOOGLE_ADS_BASE_URL` ve
`META_ADS_BASE_URL` env'leri ile mock Worker'lara veya gerçek API'ye
yönlendirilecek.

## Operational notes

### Cloudflare resources
- **Account**: `Batuhanbayazitt@gmail.com's Account` (id `36a8550c...`)
- **D1**: `leylek-prod` (id `c20b810d-f5a9-464d-9fa9-8a33101948f7`, 7 tables)
- **KV**: `leylek-kv` (id `e9c37be505844e1dbdb0b83b8311ed17`).
  Prefix layout: `sim:campaign:*`, `sim:ad:*`, `sim:metrics:*`,
  `magic_link:*`, `oauth_state:*`. mockdata planında `gads:*`, `meta:*` eklenecek.
- **Zone**: `nexvar.io` (id `c55144c33d61e99add875b4ee66d2a15`). DNS records
  for `leylek.nexvar.io` (Pages CNAME) + `resend._domainkey.leylek` +
  `send.leylek` (SPF MX/TXT) + `_dmarc`.
- **Pages project**: `leylek-web`, custom domain `leylek.nexvar.io`.
- **Workers**: leylek-gateway, leylek-content-agent, leylek-optimizer-agent,
  leylek-publisher-agent, leylek-analytics-worker. Route binding
  `leylek.nexvar.io/api/*` → gateway.

### Auth + auth user-actions
- **Google OAuth**: client ID `271929788367-58e1c3qvrk45231oosciucgamkibfifh`,
  Consent Screen Published to Production, prod redirect URI registered.
  Anyone with a Google account can log in.
- **Magic-link**: Resend, verified sender `noreply@leylek.nexvar.io`.
  `leylek.nexvar.io` domain Resend'de verified.
- **Cookie**: HttpOnly, Secure, SameSite=Lax, single origin.

### Things deferred (PRD §17 Faz 2)
- **Meta Marketing API real integration** — `MetaAdsClient` stub.
  Path: mockdata.md Faz 3 implementation OR external Meta App Review
  (weeks) + write real client.
- **Google Ads developer token Standard** — for arbitrary (non-test)
  Google Ads customer access. Test access tier zaten anında (PRD §10
  pessimism düzeltildi). Demo mock'ta veya Test Manager Account'la
  gerçek API'ye gidebilir.
- **Web push** (PRD §18 open question). Resend email Co-Pilot channel.
- **Billing / multi-tenant / Shopify** — PRD §13–§14 vision only.

## Risk + dikkat

1. **Don't break `main`** — push'tan sonra CI hem build hem deploy ediyor.
   Lokal'de typecheck + lint + (mümkünse) `./scripts/e2e-demo.sh` çalıştır.
2. **Don't commit `.env`** — pre-commit gitleaks blokluyor ama dikkat.
3. **Don't add `[[routes]]` to wrangler.toml** without giving the deploy
   token `Workers Routes:Edit` on `nexvar.io`. Mevcut token'da yok;
   route zone'a out-of-band attach edilmiş. Wrangler bu yüzden routes
   yönetmiyor.
4. **Don't paste tokens in chat output** — `.env` Read, dökme.
5. **Resend free-tier limits** — domain verified ama günlük 100 mail
   sınırı var. Yoğun test için Resend'de Pro upgrade veya Cloudflare
   MailChannels paid yolu.
6. **Gemini 2.5 Pro free-tier quota = 0** — bu yüzden Flash'a düştük
   (PRD §16 fallback). Quota arttırılırsa
   `workers/optimizer-agent/src/campaign-agent.ts` ve
   `workers/content-agent/src/gemini.ts` constants flip.
7. **Pages project Direct Uploads** — silmeden Git source'a switch
   olunamaz. CI'dan deploy aynı sonucu veriyor.

## Sıradaki büyük iş

`docs/mockdata.md` planı. 3 seçenek var, ekip arkadaşı kararı:
- Tam plan (~8h) — Google + Meta mock + her ikisi production-ready
- Küçük başla (~3h) — sadece Google Ads mock + Faz 5 refactor
- Şimdilik kalsın — mevcut SimulatedAdsClient yeterli

## Ne zaman sorulacak

- **mockdata.md** planında bir faz tıkanırsa, plan iyimser kalmış demektir;
  `docs/AGENT_BUILD_LOG.md`'ye not düş ve PRD'yi revise et.
- **External approval bekleyen item'lar** (Meta App Review, Google Ads
  Standard) için kullanıcıdan onay almadan başvuru yapma.
- **`.env`'a yeni secret ekleme** — bunlar her ortam için ayrı üretilmeli,
  bana ne eklenmesi gerektiğini söyle.
- **PRD'yi değiştirme** — vizyon kayar. Yeni gereksinim varsa `PRD.md`'ye
  patch ekle, eski metni revize etme.

## Çıktı

- Her wave bittiğinde `docs/AGENT_BUILD_LOG.md`'ye entry düş (mevcut
  format: Wave 0–8 örnek).
- Atomic commit'ler push'la, conventional commits.
- Demo akışı bozulursa `./scripts/e2e-demo.sh` ile doğrula. Bozulan tek
  satır olabilir ama prod'a sızması diğer her şeyi kırar.
- `v1.0.0` sonrası feature work `v1.1.0` patch tag'iyle işaretlenebilir
  (semver — major mock refactor major bump değil çünkü dış davranış aynı).
