# Leylek — Ürün Gereksinim Belgesi (PRD)

**Sürüm:** 1.0
**Tarih:** 2026-05-19
**Sahibi:** NexVar
**Hackathon teslimat:** _Demo tarihi belirlenince güncellenir_

---

## 1. Executive Summary

**Leylek**, KOBİ'ler ve e-ticaret satıcıları için Google Gemini 2.5 destekli **multi-agent** otonom dijital reklam üretim ve bütçe optimizasyon platformudur. Geleneksel dijital pazarlama ajanslarının hantal yapısına karşı; 7/24 uyanık kalan, finansal inisiyatif alabilen, zarar eden reklamı kendi başına kapatıp bütçeyi kâr edene kaydıran bir SaaS.

Sistem **5 ayrı Cloudflare Worker** mikroservisi ve **per-campaign Durable Object** mimarisi ile çalışır. Tek bir LLM wrapper değildir — içerik üreten, karar veren ve gerçek reklam API'leriyle aksiyon alan üç ayrı **ajan** vardır. Her ajanın beyni Google Gemini 2.5 Pro / Flash'tır.

İki mod:

- **Otopilot** — Tam otonom. Ajan kararı verir, eyleme döker, log tutar.
- **Co-Pilot** — Yarı otonom. Ajan önerir + uyarı verir, kullanıcı onaylar.

---

## 2. Problem & Çözüm

### Problem

Türkiye'deki KOBİ'ler ve e-ticaret satıcıları reklam yönetiminde üç temel acı yaşıyor:

1. **Karmaşıklık** — Meta Business Manager + Google Ads arayüzleri "uçak kokpiti" gibi. Ortalama bir esnaf "boost post" butonundan ileri gidemiyor; bütçesi kontrolsüzce eriyor.
2. **Hız** — Bir reklamın zarar ettiğini insan tarafından anlamak 3-7 günü bulur. Bu süre içinde günde 500-2000 TL boşa gider.
3. **Maliyet** — Dijital ajansa giden aylık fatura genelde 8-25K TL aralığında. KOBİ için katlanılabilir değil.

Mevcut "AI çözümleri" (Canva, ChatGPT, Midjourney) sadece **içerik üretir** — sorunun yarısı. Geri kalan hâlâ insan emeğine bağlı.

### Çözüm

Leylek; içerik üretiminin ötesine geçer ve **eylem alır**:

- Ürün URL'sini analiz eder → Gemini ile persona çıkarımı + 3 farklı stratejide reklam varyantı üretir
- Meta Marketing API + Google Ads API üzerinden gerçek API çağrısıyla yayına alır
- 6 saatte bir (üretim) veya demo'da manuel tetikle metric çeker, agentic karar verir
- Zarar eden reklamı kendi başına PAUSE eder; bütçeyi kâr eden varyanta kaydırır
- Tüm kararları gerekçesiyle birlikte log'lar — kullanıcı "neden böyle yaptın" sorusuna her zaman cevap alabilir

Yaratıcı kısım (content-agent) + finansal karar kısmı (optimizer-agent) ayrı ajanlar olduğu için, jüri "gerçek agentic" sorusuna mimariyle cevap verir.

---

## 3. Hedef Kitle (Personas)

### Persona 1 — "Otopilot": Vakti Olmayan Esnaf

- **Profil:** 35-50 yaş, Trendyol/Hepsiburada gibi pazaryerlerinde satış yapar, kendi sitesi var ama reklam yönetecek vakti/bilgisi yok.
- **Acı noktası:** "Reklam vereyim diyorum, açıyorum Facebook'u, ne yapacağımı bilemiyorum, sonra parayı boşa attığımı düşünüyorum."
- **Leylek kullanımı:** URL girer, bütçe verir, gerisi otomatik. "Bana sadece ne kadar kâr ettiğimi söyle" mentalitesi.
- **Subscription:** Usta Modu (sınırsız bütçe, tam otonom).

### Persona 2 — "Co-Pilot": Kontrolcü E-Ticaretçi

- **Profil:** 28-40 yaş, kendi e-ticaret sitesi var, reklam vermeye aşina, ama gece/hafta sonu denetim yapamadığı için kaygılı.
- **Acı noktası:** "Cuma akşamı reklamı koyuyorum, Pazartesi gelip bakıyorum, %30 paramı yemiş bir varyant var."
- **Leylek kullanımı:** Reklamlarını yine kendi koyar, ama Leylek'i **bütçe kalkanı** olarak çalıştırır. Zarar başlayınca push notification + e-mail alır, tek tıkla "kapat" der.
- **Subscription:** Çırak Modu (50K TL aylık bütçe sınırı, Co-Pilot mod).

---

## 4. MVP Scope & Demo Plan

### MVP'de fonksiyonel olarak teslim edilecek

- Google OAuth login + Magic Link yedek
- Meta Marketing API OAuth bağlama + test ad account üzerinde gerçek campaign/ad CRUD
- Google Ads API OAuth bağlama + test customer üzerinde gerçek campaign/ad CRUD
- `content-agent` — URL → persona + 3 reklam varyantı (Gemini 2.5 Pro, structured output)
- `optimizer-agent` — metric → pause/realloc kararı + gerekçe (Gemini 2.5 Pro)
- `publisher-agent` — Meta + Google sandbox üzerinden gerçek aksiyon
- `analytics-worker` — Meta/Google API'den gerçek metric çekme + D1 sync
- Otopilot mode (tam otonom akış)
- Co-Pilot mode (öneri + onay akışı + notification)
- "Şimdi Optimize Et" manuel cron tetikleyici (demo için)
- Campaign Durable Object — per-campaign agent state + decision history
- Dashboard: campaign list, ad detay, agent_logs timeline, spend chart

### Vizyon-only (PRD'de yer alır, MVP'de kod yok)

- Cold-outreach scraping ajanı (KVKK + Meta ToS riski; sadece roadmap'te)
- Billing / abonelik sistemi (Çırak / Usta / Enterprise tier'ları)
- Multi-tenant ayrımı (MVP'de 1 user → 1 Meta + 1 Google bağlantı)
- Shopify / Ticimax / IdeaSoft entegrasyonu (B2B2B)
- TikTok Ads, LinkedIn Ads (Faz 2)
- ERP / stok entegrasyonu (Faz 3)

### Demo akışı — 60 sn aha anı

**Pre-demo (script ile, gerçek API çağrılarıyla):**

1. Production D1'e `scripts/seed-demo-data.ts` çalıştırılır
2. 1 demo user (Google OAuth ile bir kez bağlanmış, tokens AES-encrypted in D1)
3. 1 aktif kampanya + 3 reklam varyantı (Meta sandbox + Google test account'ta gerçek `meta_ad_id`/`google_ad_id`'ler)
4. Meta Conversions API üzerinden 48 saatlik geriye dönük conversion event sequence enjekte (ad 1 zarar, ad 2 başarılı, ad 3 marjinal)
5. D1 `metric_snapshots` tablosu gerçek spend/CPA history ile dolu

**Demo akışı (60 saniye):**

| Saniye | Aksiyon | Görsel |
|---|---|---|
| 0–10 | Login → Dashboard açılır | 3 reklam yan yana, spend chart, ad 1 "zararda" badge |
| 10–20 | "Şimdi Optimize Et" tıklanır | optimizer-agent cron'u zorla tetiklenir |
| 20–45 | Gemini reasoning canlı streaming | "ad 1'in CPA'sı 4× ortalama, kapatıyorum, bütçeyi ad 2'ye kaydırıyorum" |
| 45–55 | publisher-agent simulator client `pauseAd` çağrısı (production code path runtime-swappable) | "simulator confirmed pause + budget reallocation" |
| 55–60 | agent_logs timeline güncellenir, ad 1 "PAUSED" | Karar logu ekrana düşer |

Demo sırasında **Gemini reasoning + Campaign DO atomic execution + agent_logs persistence + Cloudflare runtime gerçek** çalışır. Ad platform hop'u runtime `LEYLEK_AD_PLATFORM=sim` flag'iyle simulator client'a gider; production code path (`RealGoogleAdsClient`) tamamen yazılı ve `LEYLEK_AD_PLATFORM=real` ile Google Ads API'sine gerçek çağrı atar (Faz 2 — dev token Standard access onayı sonrası). Detay §10.

---

## 5. Multi-Agent Mimarisi

**Jüri kuralı:** _"Multi-Agent (Çoklu Ajan) mimarisi kullanılmalıdır. İçerik üreten, karar veren ve API üzerinden aksiyon alan farklı ajanlar tasarla."_

Leylek bu kuralı **3 belirgin ajan + 2 destek Worker + 1 Durable Object** ile karşılar.

### Diyagram

```
   ┌───────────────────────────────────────────────────────────────┐
   │              React 19 + Vite 8 + Tailwind v4                  │
   │                   (Cloudflare Pages — static)                 │
   └─────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │   gateway        │  • Google OAuth + magic link auth
                        │   (Worker)       │  • Service Bindings router
                        └─┬──┬──┬──┬──────┘  • Rate-limit, frontend façade
                          │  │  │  │
        ┌─────────────────┘  │  │  └────────────────────┐
        │  ┌─────────────────┘  │                       │
        │  │                    │                       │
        ▼  ▼                    ▼                       ▼
 ┌─────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
 │ content-    │  │ optimizer-      │  │ publisher-      │  │ analytics-      │
 │ agent       │  │ agent  (cron)   │  │ agent           │  │ worker  (cron)  │
 │ Gemini 2.5  │  │ Gemini 2.5      │  │ Meta + Google   │  │ Meta + Google   │
 │ Pro         │  │ Pro             │  │ sandbox APIs    │  │ API → D1        │
 └──────┬──────┘  └────────┬────────┘  └────────▲────────┘  └────────┬────────┘
        │                  │                    │                    │
        │                  ▼                    │                    │
        │         ┌──────────────────┐          │                    │
        │         │ Campaign DO      │──────────┘                    │
        │         │ (per kampanya)   │                               │
        │         │ • state          │                               │
        │         │ • decision log   │                               │
        │         │ • atomic action  │                               │
        │         └────────┬─────────┘                               │
        │                  │                                         │
        └──────────────► D1 SQL ◄─────────────────────────────────────┘
                  ┌──────────────────────────┐
                  │ users, connected_accounts│
                  │ campaigns, ads, agent_logs│
                  │ metric_snapshots          │
                  └──────────────────────────┘
                  ┌──────────────────────────┐
                  │ KV (session, cache)      │
                  │ Workers Secrets (creds)  │
                  └──────────────────────────┘
```

### Worker sorumlulukları (Single Responsibility)

| Worker | Tip | Görev | Gemini? |
|---|---|---|---|
| `gateway` | Orkestrator | API entry, auth, routing, façade | — |
| **`content-agent`** | **Agent** | URL parse, audience extraction, 3 reklam varyantı üretimi (Agresif / Hikaye / Teknik) | 2.5 Pro |
| **`optimizer-agent`** | **Agent** | Metric oku, pause/keep/realloc kararı + structured gerekçe | 2.5 Pro |
| **`publisher-agent`** | **Agent** | Port + adapter pattern; `RealGoogleAdsClient` (production) + `SimulatedAdsClient` (demo) — `LEYLEK_AD_PLATFORM` env flag'iyle swap. Meta için stub interface (Faz 2 implementation) | — |
| `analytics-worker` | Destek | Meta/Google API'den metric çek, D1'e yaz | (opsiyonel 2.5 Flash haftalık özet) |

### Durable Object: `CampaignAgent`

Her aktif kampanya = bir DO instance.

DO içinde:

- `decision_history[]` — son N kararın özeti
- `queued_actions[]` — bekleyen aksiyon kuyruğu
- `last_known_metrics` — son metric snapshot referansı
- `agent_context` — Gemini'ye gönderilen rolling context

DO'nun atomic execution garantisi sayesinde "iki cron eş zamanlı aynı kampanyaya karar verme" race condition'ı doğal olarak çözülür. Bir kampanya = bir karar zinciri = bir DO.

**Hikaye:** Her kampanyanın kendi yaşayan ajanı var.

### Service Bindings ile haberleşme

Worker-to-Worker iletişim HTTP üzerinden değil — Cloudflare Service Bindings ile. Type-safe, düşük latency, internet egress yok.

`wrangler.toml` örneği (gateway için):

```toml
name = "leylek-gateway"
main = "src/index.ts"
compatibility_date = "2026-05-19"

[[services]]
binding = "CONTENT_AGENT"
service = "leylek-content-agent"

[[services]]
binding = "OPTIMIZER_AGENT"
service = "leylek-optimizer-agent"

[[services]]
binding = "PUBLISHER_AGENT"
service = "leylek-publisher-agent"

[[d1_databases]]
binding = "DB"
database_name = "leylek-prod"
database_id = "<set-by-wrangler>"

[[kv_namespaces]]
binding = "KV"
id = "<set-by-wrangler>"

[[durable_objects.bindings]]
name = "CAMPAIGN_AGENT"
class_name = "CampaignAgent"
script_name = "leylek-optimizer-agent"
```

---

## 6. Teknik Altyapı (Cloudflare Full-Stack)

### Cloudflare bileşenleri

| Bileşen | Kullanım |
|---|---|
| **Pages** | React frontend statik servis, otomatik global CDN |
| **Workers** | 5 mikroservis Worker, her biri kendi `wrangler.toml`'u |
| **Pages Functions** | Kullanmıyoruz — standalone Workers + Service Bindings tercih |
| **D1** | Tek veritabanı, tüm Worker'lar bağlanır (binding ile) |
| **KV** | Session token, rate-limit counter, geçici cache |
| **Durable Objects** | `CampaignAgent` sınıfı (optimizer-agent Worker'ında host edilir) |
| **Cron Triggers** | `optimizer-agent` her 6 saat, `analytics-worker` her 15 dk |
| **Workers Secrets** | Tüm API keys, JWT secret, AES key base |
| **R2** | Şu an yok; Faz 2'de ad creative image storage |

### Frontend stack

- **React 19.2** — `use()` hook, server actions, native ref forwarding
- **Vite 8** — Rolldown bundler default
- **Tailwind CSS v4** — CSS-first config (`@import "tailwindcss"`), `@tailwindcss/vite` plugin
- **shadcn/ui** — React 19 / Tailwind v4 uyumlu güncel
- **TanStack Query v5** — server state
- **Zustand** — UI state
- **React Router v6** — sayfa routing
- **Zod** — runtime validation, shared schema with backend

### Backend stack

- **Hono v4** — Workers-native, type-safe router
- **Drizzle ORM** — type-safe D1 queries, schema-first
- **drizzle-kit 0.31** — migration generator
- **Zod** — request/response validation
- **Workers Runtime** — V8 isolates, no Node.js dependency

### Test & quality

- **Vitest** — unit test
- **Playwright** — UAT scenarios (agent-browser ile de tetiklenebilir)
- **Biome 2.0** — lint + format
- **TypeScript 5.7** — strict + `noUncheckedIndexedAccess`
- **Husky + gitleaks** — pre-commit: typecheck + lint + secret scan

### Monorepo

- **pnpm 11** workspaces — `apps/*`, `workers/*`, `packages/*`
- Shared TS config (`tsconfig.base.json`) + Biome config (`biome.json`) köktende

### Deploy

- **Cloudflare Pages auto-deploy** — `main` push → otomatik prod deploy
- **PR preview deploys** — her feature branch için preview URL
- **wrangler CLI** — Workers + D1 + KV + Secrets yönetimi
- **GitHub Actions CI** — typecheck + test + lint, push'ta + PR'da

### Local development

```bash
pnpm install
cp .env.example .env
pnpm dev
```

`wrangler dev --local` D1, KV, DO'ları lokal emüle eder.

---

## 7. Veri Akışı

### Otopilot akışı

1. User → "URL gir + günlük bütçe" form (UI)
2. UI → `gateway POST /api/campaigns`
3. `gateway` → `content-agent.analyze(url, brief)`
   - URL fetch + parse
   - Gemini 2.5 Pro → `{audience, 3 variants}`
4. `gateway` → DB INSERT `campaigns` + `ads`
5. `gateway` → `publisher-agent.publish(campaign_id)`
   - Meta sandbox API: campaign + 3 ads create
   - Google Ads test account: campaign + ads create
   - `meta_ad_id`, `google_ad_id` döner
6. `gateway` → DB UPDATE `ads` with external IDs
7. Cron her 15 dk: `analytics-worker` → Meta/Google → `metric_snapshots`
8. Cron her 6 saat (demo manuel): `optimizer-agent`
   - Aktif kampanyalar listesi (D1)
   - Her kampanya için Campaign DO çağrılır
   - DO: D1'den son N saat metric oku
   - DO: Gemini 2.5 Pro structured output `{action, target_ad_id, reason, confidence}`
   - Eğer `action = pause/realloc` → `publisher-agent.execute()`
   - DO: `agent_logs` INSERT
9. UI polling `/api/campaigns/:id/logs` → frontend timeline güncellenir

### Co-Pilot akışı

Otopilot ile aynı, ancak Adım 8'de:

- `optimizer-agent` karar verir ama **uygulamaz**
- DO `notifications` tablosuna öneri yazar
- Push notification + e-mail (Resend) kullanıcıya gönderilir
- Kullanıcı UI'da Onayla / Reddet → onaylandıysa `publisher-agent.execute()`

---

## 8. D1 Schema

```sql
-- users — login bilgisi
CREATE TABLE users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT NOT NULL UNIQUE,
  name              TEXT,
  avatar_url        TEXT,
  provider          TEXT NOT NULL,        -- 'google' | 'magic_link'
  provider_sub      TEXT NOT NULL,
  company_name      TEXT,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at     TEXT
);
CREATE UNIQUE INDEX idx_users_provider ON users(provider, provider_sub);

-- connected_accounts — reklam hesabı bağlantıları
CREATE TABLE connected_accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,        -- 'meta' | 'google_ads'
  external_id       TEXT NOT NULL,
  account_label     TEXT,
  enc_access_token  TEXT,                  -- AES-256-GCM, envelope key in Workers Secrets
  enc_refresh_token TEXT,
  token_expires_at  TEXT,
  scopes            TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  connected_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at      TEXT,
  UNIQUE(user_id, provider, external_id)
);

-- campaigns
CREATE TABLE campaigns (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_url       TEXT NOT NULL,
  mode              TEXT NOT NULL,        -- 'OTOPILOT' | 'COPILOT'
  daily_budget_kurus INTEGER NOT NULL,    -- kuruş (integer math)
  status            TEXT NOT NULL DEFAULT 'active',
  do_id             TEXT,                  -- Durable Object identifier
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ads (reklam varyantları)
CREATE TABLE ads (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id       INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  strategy_type     TEXT NOT NULL,        -- 'AGGRESSIVE' | 'STORY' | 'TECHNICAL'
  ad_text           TEXT NOT NULL,
  image_prompt      TEXT,
  meta_ad_id        TEXT,
  google_ad_id      TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  spend_kurus       INTEGER NOT NULL DEFAULT 0,
  cpa_kurus         INTEGER,
  ctr_basis_points  INTEGER,              -- CTR x 10000
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- agent_logs (jüri için kritik)
CREATE TABLE agent_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id       INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  agent_name        TEXT NOT NULL,        -- 'content' | 'optimizer' | 'publisher'
  action_taken      TEXT NOT NULL,        -- 'PAUSED_AD' | 'REALLOCATED_BUDGET' | 'CREATED_AD'
  target_ref        TEXT,
  reason            TEXT NOT NULL,
  confidence        REAL,                  -- 0.0 - 1.0
  gemini_request_id TEXT,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_agent_logs_campaign_time ON agent_logs(campaign_id, created_at DESC);

-- metric_snapshots (time-series)
CREATE TABLE metric_snapshots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id             INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  snapshot_at       TEXT NOT NULL,
  impressions       INTEGER NOT NULL DEFAULT 0,
  clicks            INTEGER NOT NULL DEFAULT 0,
  conversions       INTEGER NOT NULL DEFAULT 0,
  spend_kurus       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_metric_snapshots_ad_time ON metric_snapshots(ad_id, snapshot_at DESC);

-- notifications (Co-Pilot için)
CREATE TABLE notifications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id       INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  type              TEXT NOT NULL,
  payload_json      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at       TEXT
);
```

Schema değişiklikleri Drizzle migration'ları üzerinden yönetilir (`packages/db/migrations/`).

---

## 9. Güvenlik & API Yönetimi

### Auth flow — Google OAuth

1. UI → "Google ile Giriş Yap"
2. Browser → `accounts.google.com/o/oauth2/v2/auth?client_id=…&scope=openid email profile&state=…`
3. Google → `gateway/api/auth/google/callback?code=…&state=…`
4. `gateway`: state CSRF check + code → token swap
5. `gateway`: token ile `userinfo` çağrısı → `{email, name, picture, sub}`
6. `gateway`: D1 upsert (`provider='google', provider_sub=<google_sub>`)
7. `gateway`: JWT issue (`JWT_SECRET` ile imzalı) + HttpOnly Secure SameSite cookie set
8. `gateway`: 302 → dashboard

### Auth flow — Magic Link (yedek)

1. UI → e-mail gir → POST `/api/auth/magic-link/request`
2. `gateway`: 6-haneli token üret + KV'ye 10 dk TTL ile sakla
3. `gateway`: Resend API → e-mail gönder
4. User linke tıklar → `gateway`: token verify → KV sil → D1 upsert + JWT issue

### Reklam hesabı bağlama — Meta OAuth

1. User dashboard'da "Meta Reklam Hesabımı Bağla" → `gateway` → `facebook.com/v21.0/dialog/oauth?scope=ads_management,ads_read,business_management,pages_show_list`
2. Meta → `gateway` callback → code → access_token swap
3. `gateway`: short-lived (1–2h) → long-lived (60d) token swap
4. `gateway`: Meta API → user'ın ad account listesi → frontend
5. User hangi account'u bağlayacağını seçer → `gateway`: AES-256-GCM encrypt → D1 `connected_accounts` INSERT

### Reklam hesabı bağlama — Google Ads OAuth

Aynı pattern. Ek olarak:

- **App-level `developer_token`** — Test access instant, Standard 1-2 hafta inceleme
- Her request: developer_token + per-user OAuth token
- Customer ID seçimi: `customers:listAccessibleCustomers`

### Token encryption (AES-256-GCM)

1. `AES_KEY_BASE` Workers Secrets'ta tutulur
2. Token D1'e yazılırken: `enc_token = AES-256-GCM(token, key, iv)` — IV her seferinde fresh
3. Token kullanılırken: gateway decrypt → Worker memory'de kısa süre, log'a yazılmaz

### Workers Secrets (production)

Tüm hassas değerler `wrangler secret put` ile her Worker'a ayrı yüklenir:

```bash
wrangler secret put GEMINI_API_KEY --name leylek-content-agent
wrangler secret put GEMINI_API_KEY --name leylek-optimizer-agent
wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET --name leylek-gateway
wrangler secret put META_APP_SECRET --name leylek-gateway
wrangler secret put META_APP_SECRET --name leylek-publisher-agent
wrangler secret put GOOGLE_ADS_DEVELOPER_TOKEN --name leylek-publisher-agent
wrangler secret put JWT_SECRET --name leylek-gateway
wrangler secret put AES_KEY_BASE --name leylek-gateway
wrangler secret put RESEND_API_KEY --name leylek-gateway
```

Repo'da, branch'lerde, log'larda **hiç** görünmez.

### Public flip checklist (repo private → public)

- [ ] `gitleaks detect --no-git -v` 0 finding
- [ ] `git log --all --full-history -- .env` boş dönüyor
- [ ] Tüm secret'lar Workers Secrets'ta
- [ ] `.env.example` placeholder, gerçek değer yok
- [ ] LICENSE Proprietary doğrulandı
- [ ] README jüri için açıklayıcı
- [ ] PRD §15 (jüri sunum) güncel
- [ ] Production wrangler config doğru env'i hedefliyor
- [ ] Settings → Change visibility → Public

---

## 10. Production-Ready Code + Demo Simulator Stratejisi

**Hackathon context:** Meta App Review (2-4 hafta) ve Google Ads developer token Standard access (1-2 hafta) onay süreçleri hackathon timeline'ına sığmıyor. Bu kısıt **demo'yu fakirleştirmemek için**: production-ready gerçek ad platform kodu repo'da çalışıyor; demo runtime, aynı kodu in-memory simulator adapter'ı üzerinden koşturuyor. Flip 1 satır env flag.

### Port + Adapter Pattern

`publisher-agent` ve `analytics-worker` aynı interface'i tüketir:

```typescript
// packages/shared-types/src/ad-platform.ts
export interface AdPlatformClient {
  createCampaign(input: CreateCampaignInput): Promise<{ externalId: string }>;
  createAd(input: CreateAdInput): Promise<{ externalId: string }>;
  pauseAd(externalId: string, reason: string): Promise<void>;
  updateBudget(externalId: string, newBudgetKurus: number): Promise<void>;
  fetchMetrics(externalId: string, windowHours: number): Promise<MetricWindow>;
}
```

İki concrete implementation:

#### `RealGoogleAdsClient` (production code, repo'da committed)

- Real Google Ads API çağrıları:
  - `customers:listAccessibleCustomers`
  - `customers/{id}/googleAds:search` (metric query, GAQL)
  - `customers/{id}/campaigns:mutate` (create / pause / budget update)
  - `customers/{id}/adGroupAds:mutate`
- OAuth refresh token rotation: `oauth2/v4/token` ile expired access token yenile
- Rate limit + exponential backoff
- Error mapping → typed `AdPlatformError`

#### `SimulatedAdsClient` (demo runtime)

- Aynı interface, in-memory state
- State per demo user → Cloudflare KV (TTL: 24h) veya Campaign DO
- Realistic metric curves önceden hazırlanmış (ad 1 zarar curve, ad 2 başarı curve, ad 3 marjinal curve) — 48 saatlik time series
- API latency simulate (50-200ms jitter)
- `createCampaign` / `createAd` benzersiz `sim_<uuid>` external_id döner

#### Meta için stub

Faz 1'de `RealMetaAdsClient` yazılmaz — interface conform `MetaAdsClient` stub class olur (her metot `throw new Error('Meta integration ships in Faz 2')`). Faz 2'de gerçek implementasyon eklenir. Bu sayede multi-platform routing layer (`PlatformRouter`) yapısı bugünden Faz 2'ye hazırdır.

### Feature Flag

Cloudflare Workers env:

```
LEYLEK_AD_PLATFORM=sim       # Demo / dev runtime
LEYLEK_AD_PLATFORM=real      # Production runtime (dev token approval sonrası)
```

`publisher-agent` ve `analytics-worker` factory:

```typescript
function makeClient(env: Env): AdPlatformClient {
  if (env.LEYLEK_AD_PLATFORM === 'real') {
    return new RealGoogleAdsClient(env);
  }
  return new SimulatedAdsClient(env);
}
```

Default `sim` (production deploy'da bilinçli `real` set edilmediyse demo mode kal). `wrangler.toml`'da `[vars] LEYLEK_AD_PLATFORM = "sim"`.

### Demo vs Production karşılaştırma

| Katman | Demo (sim mode) | Production (real mode) |
|---|---|---|
| Frontend UI | Gerçek React + Vite + Tailwind | Aynı |
| Gateway routing + auth | Gerçek Hono Worker | Aynı |
| Google OAuth login | Gerçek (Google Identity) | Aynı |
| Magic Link via Resend | Gerçek (Resend API) | Aynı |
| `content-agent` Gemini 2.5 Pro çağrısı | Gerçek | Aynı |
| `optimizer-agent` Gemini 2.5 Pro decision | Gerçek | Aynı |
| Campaign Durable Object atomic state | Gerçek | Aynı |
| `agent_logs` D1 persistence | Gerçek | Aynı |
| `publisher-agent` action layer | `SimulatedAdsClient` (in-memory) | `RealGoogleAdsClient` (Google Ads API HTTP call) |
| Metric data source | Pre-seeded sim curves | Gerçek Google Ads `googleAds:search` insights |

**Multi-agent narrative + Gemini reasoning + DO + log timeline farkı sıfır.** Tek farklı hop: external HTTP call vs internal state mutation.

### Jüri için defansif pitch cümlesi

> "Production code'umuz Google Ads API'nin gerçek implementasyonu — `workers/publisher-agent/src/clients/real-google-ads.ts`'i okuyun. Demo şu anda simulator mode'da çünkü Google Ads developer token Standard access onayı 2-4 hafta sürüyor ve hackathon süresine sığmıyor. Production'da `LEYLEK_AD_PLATFORM=real` Workers Secret'iyle tek satır flip — agent'lar aynı kararları gerçek Google Ads API çağrılarıyla execute eder. Meta için aynı pattern Faz 2'de devreye alınacak; interface bugünden hazır."

### `scripts/seed-demo-data.ts` — sim mode

```typescript
async function seedDemoData(env: Env) {
  const platform = env.LEYLEK_AD_PLATFORM ?? 'sim';
  const client: AdPlatformClient = platform === 'real'
    ? new RealGoogleAdsClient(env)
    : new SimulatedAdsClient(env);

  // 1. Demo user (Google OAuth tokens prep edilmiş veya magic-link bypass)
  const user = await db.insert(users).values({
    email: 'demo@leylek.app',
    provider: 'google',
    providerSub: '<real-google-sub-after-first-real-oauth>',
    name: 'Demo Kullanıcı',
  });

  // 2. Connected account (sim mode: placeholder external_id)
  await db.insert(connectedAccounts).values({
    userId: user.id,
    provider: 'google_ads',
    externalId: platform === 'real' ? GOOGLE_ADS_TEST_CUSTOMER_ID : 'sim_customer_001',
    status: 'active',
  });

  // 3. Campaign — client.createCampaign her iki mode'da aynı kod
  const { externalId: campExtId } = await client.createCampaign({
    name: 'Demo — MazeStore Akıllı Su Şişesi',
    dailyBudgetKurus: 100000, // 1000 TRY
  });
  const campaign = await db.insert(campaigns).values({ ... });

  // 4. 3 reklam variant
  const variants = await Promise.all([
    client.createAd({ strategy: 'AGGRESSIVE', ... }),
    client.createAd({ strategy: 'STORY', ... }),
    client.createAd({ strategy: 'TECHNICAL', ... }),
  ]);

  // 5. metric_snapshots seed — sim curves
  //    (real mode'da analytics-worker periyodik çekecek, seed'e gerek yok)
  if (platform === 'sim') {
    await seedMetricCurves(variants);
  }
}
```

Tek script, env flag ile mode select. Hackathon kapsamında `sim`, dev token onayı sonrası `real` flip.

---

## 11. Git Flow & Commit Stratejisi

**Jüri talimatı:** _"Tek bir commit ile değil; ajanlar, UI, API entegrasyonu gibi modüllere bölünerek nasıl düzenli ve temiz (Clean Code prensipleriyle) commit'lenmesi gerektiğini adım adım açıkla."_

### Conventional Commits

Tüm commit'ler [Conventional Commits](https://www.conventionalcommits.org/) standardına uyar:

- `feat(scope):` — yeni özellik
- `fix(scope):` — bug fix
- `chore:` — scaffold, config, tooling
- `docs:` — dokümantasyon
- `refactor(scope):` — davranışı değiştirmeyen iyileştirme
- `test:` — test ekleme/düzeltme
- `perf(scope):` — performans

### Branch model

- `main` — her zaman deployable. Otomatik production deploy.
- `feature/<kısa-ad>` — her ajan veya UI modülü için kısa ömürlü branch
  - `feature/agent-content`
  - `feature/agent-optimizer`
  - `feature/agent-publisher`
  - `feature/agent-analytics`
  - `feature/ui-dashboard`
  - `feature/ui-onboarding`
  - `feature/db-schema`
  - `feature/auth-google`
  - `feature/oauth-meta`
  - `feature/oauth-google-ads`
  - `feature/demo-seed`
- PR ile `main`'e merge. **Squash kapalı** — her commit linear history'de görünür, jüri ilerlemeyi okuyabilir.

### Atomic commit prensibi

- Bir commit = bir mantıksal değişiklik. "Big-bang dump" yasak.
- Test ile birlikte gelir — testsiz feature merge edilmez.
- Imperative title ("add", değil "added") + 50 karakter limit + boş satır + 72-col body (gerekirse).

### İndikatif commit haritası

| # | Commit | İçerik |
|---|---|---|
| 1 | `chore: initial repo scaffold` | .gitignore, .env.example, LICENSE |
| 2 | `docs: add README` | Proje intro, mimari özet |
| 3 | `docs: add PRD v1.0` | Bu doküman |
| 4 | `chore: monorepo workspace setup` | package.json, pnpm-workspace.yaml, tsconfig, biome |
| 5 | `docs: add ARCHITECTURE.md stub` | Living doc |
| 6 | `feat(db): D1 schema first draft` | Drizzle schema |
| 7 | `feat(db): add migration runner` | drizzle-kit config + initial migration |
| 8 | `chore: scaffold workers/gateway` | Hono setup, basic /api routing |
| 9 | `feat(gateway): Google OAuth flow` | OAuth start + callback + JWT issue |
| 10 | `feat(gateway): magic link auth` | Resend integration |
| 11 | `chore: scaffold workers/content-agent` | Hono + Gemini SDK |
| 12 | `feat(agent-content): URL analyze + 3 variants` | Gemini structured output |
| 13 | `chore: scaffold workers/publisher-agent` | Meta + Google Ads SDK setup |
| 14 | `feat(agent-publisher): Meta campaign create + pause` | OAuth + Marketing API |
| 15 | `feat(agent-publisher): Google Ads test customer flow` | adwords scope + customer create |
| 16 | `chore: scaffold workers/optimizer-agent + Campaign DO` | DO sınıfı + cron trigger |
| 17 | `feat(agent-optimizer): metric read + Gemini decision` | structured output JSON schema |
| 18 | `feat(agent-optimizer): atomic action via Campaign DO` | DO routing |
| 19 | `chore: scaffold workers/analytics-worker` | cron + Meta/Google metric fetch |
| 20 | `feat(analytics): metric ingestion to D1` | snapshots tablosu |
| 21 | `chore: scaffold apps/web` | Vite + React 19 + Tailwind v4 + shadcn/ui |
| 22 | `feat(ui): dashboard + campaign list` | TanStack Query + Zustand |
| 23 | `feat(ui): agent_logs timeline + spend chart` | recharts |
| 24 | `feat(demo): seed-demo-data.ts` | gerçek API çağrılarıyla |
| 25 | `feat(ui): "Şimdi Optimize Et" manuel trigger` | demo için |
| 26 | `test(e2e): Playwright login + dashboard + stop-loss` | UAT scenarios |
| 27 | `docs: deployment + jury walkthrough` | Pages deploy notları |

### Pre-commit hook

`Husky` + `gitleaks` + `biome check`:

1. `biome check --write` — auto-format + lint fix
2. `gitleaks protect --staged` — staged file'larda secret tara
3. `pnpm typecheck` — TS hata varsa block

Komutting yapan kişi sadece `git commit -m "..."` der, hook arkada çalışır.

### Pull Request

Her PR şu kontrolden geçer:

- CI: typecheck + lint + unit tests
- Playwright e2e: ilgili scenario'lar
- Preview deploy URL
- Self-review checklist

---

## 12. Lisans & Repo Notu

- **Lisans:** Proprietary — `LICENSE` dosyası "All rights reserved" tanımlar.
- **Repo görünürlüğü:** Demo öncesi `Public` flip edilir (jüri için). Lisans değişmez.
- **Public flip checklist:** §9 sonunda.

Public görünürlük açık kaynak değildir — repo'yu görmek serbesttir, ancak kopyalamak, dağıtmak, türetilmiş eser yaratmak yasaktır.

---

## 13. Gelir Modeli & Fiyatlandırma (vizyon, MVP'de yok)

| Tier | Aylık | Sınır |
|---|---|---|
| **Çırak** (Co-Pilot) | 1.499 TL | Max 50.000 TL/ay bütçe yönetimi, sadece uyarı |
| **Usta** (Otopilot) | 3.499 TL | Sınırsız bütçe, tam otonom karar + bütçe shift |
| **Enterprise** (kâr paylaşımı) | Sabit ücret yok | AI'nın sağladığı kâr artışı üzerinden %10 |

MVP'de billing entegrasyonu yok; demo'da seed user "Usta plan aktif" görünür. Faz 2'de Iyzico veya Stripe.

---

## 14. Go-to-Market & Agentic Growth (vizyon)

1. **Otonom E-Ticaret Avcısı** — Python ajanı web/Instagram'da kötü reklamlı e-ticaret sitelerini tespit eder, otonom outreach. _KVKK + Meta ToS riski; sadece roadmap'te, MVP'de kod yok._
2. **Dinamik FOMO Ajanı** — döviz kuru artışında "bugün bütçeniz dün %12 daha fazla erirdi" mesajı.
3. **B2B2B entegrasyonları** — Shopify, Ticimax, IdeaSoft app marketplace'leri.

---

## 15. Jüri Sunum Stratejisi

7 dakikalık pitch ve 1 dakikalık video için 4 hocaya net mesaj:

### Atıl Hoca (iş modeli / ticarileşme)

> "Hocam, Leylek geleneksel dijital pazarlama ajanslarını disrupt edecek. Hedef KOBİ'ler — ajansa verdikleri paranın 10'da 1'ine 7/24 uyumayan, hata yapmayan, satış getiren otonom ajan vadediyoruz. Çırak/Usta/Enterprise tier'larıyla TAM ~12B TL Türkiye dijital reklam pazarına giriyoruz."

### Kaan Hoca (agentic AI)

> "Kaan Hocam, sistemde 3 belirgin agent + 1 per-campaign Durable Object'imiz var. Sadece LLM wrapper değil — content-agent içerik üretir, optimizer-agent finansal risk analizi yapar ve kimseye sormadan reklam fişini çekebilir, publisher-agent gerçek Meta + Google API'lerine aksiyon atar. Her kampanyanın kendi yaşayan Durable Object'i var, decision history + atomic execution garantili."

### Talha Hoca (Cloudflare mimarisi)

> "Talha Hocam, mimari %100 serverless — Pages + 5 Worker + D1 + KV + Durable Objects. Hiçbir sunucu kiralamadık, sonsuz ölçeklenir. Worker'lar arasında Service Bindings ile type-safe haberleşme, internet egress yok. Per-campaign Durable Object isolation race condition'ları doğal çözüyor. `wrangler` ile tek komutla deploy."

### Egemen Hoca (finansal vizyon)

> "Egemen Hocam, Leylek bir bütçe kalkanıdır. Reklam aslında günlük cash flow yönetimidir. CPA 4× ortalamayı geçince ajan stop-loss atar — KOBİ'nin parası gece yarısı erimez. Bu zarar koruması, jüriye gösterdiğimiz 60 sn aha anının tam kalbi."

---

## 16. Risk & Limitasyonlar

| Risk | Olasılık | Etki | Azaltma |
|---|---|---|---|
| Meta App Review red / gecikme | Mitigated | Demo bloklamıyor | Faz 2 — şu an sim adapter, real `MetaAdsClient` stub interface ile §10'da hazır |
| Google Ads dev_token Standard gecikme | Mitigated | Demo bloklamıyor | `LEYLEK_AD_PLATFORM=sim` demo runtime; `RealGoogleAdsClient` production code repo'da, token onayı sonrası flag flip |
| Gemini quota tükenme | Orta | Demo'da Gemini fail | Pre-demo quota kontrolü; Flash fallback hazır |
| Cloudflare D1 write rate limit | Düşük | analytics-worker yavaşlar | Batch insert, KV cache layer |
| Demo gününde wifi/Meta API outage | Düşük | Demo akışı kırılır | Pre-recorded backup video + offline screencast |
| Pricing demo'da somut hissedilmez | Orta | Atıl Hoca puanı düşer | Pitch deck'te sözlü vurgu + landing page'de kart |

---

## 17. Yol Haritası

### Faz 1 — Hackathon MVP (mevcut sprint)
- Multi-agent mimari (5 Worker + Campaign DO) tam çalışır
- Google Ads `RealGoogleAdsClient` production code + `SimulatedAdsClient` adapter
- Meta `MetaAdsClient` stub interface (Faz 2'de implementasyon)
- Co-Pilot + Otopilot her iki mod canlı
- Demo runtime `LEYLEK_AD_PLATFORM=sim`
- Demo seed (sim mode), jüri sunumu
- E2E agent-browser test passing on deployed URL

### Faz 2 — İlk 100 Kullanıcı (3-6 ay post-hackathon)
- Google Ads developer_token Standard access → `LEYLEK_AD_PLATFORM=real` flip
- Meta App Review production approval → `RealMetaAdsClient` implementation behind same interface
- TikTok Ads entegrasyonu
- Billing sistemi (Iyzico veya Stripe)
- Multi-account-per-user
- Resmi domain (leylek.app) + brand identity

### Faz 3 — Ölçeklenme (6-12 ay)
- Shopify / Ticimax / IdeaSoft entegrasyonları
- ERP / stok yazılımı entegrasyonu
- LinkedIn Ads (B2B segmenti)
- Multi-tenant tam izolasyon
- Cold-outreach ajanı (KVKK uyumlu opt-in B2B kanal)

---

## 18. Açık Sorular

- [ ] Gemini 2.5 Pro/Flash sunset durumunda fallback policy — mentor yazılı onayı
- [ ] Meta App Review submission timing
- [ ] Google Ads Standard access başvuru tarihi
- [ ] Production domain alımı (leylek.app vs leylek.com.tr)
- [ ] Demo'da seed kullanılacak gerçek e-ticaret ürün URL'i
- [ ] Co-Pilot push notification kanalı: sadece e-mail mi, web push da mı
- [ ] Pitch deck'te demo video versiyonu mu, canlı demo mu

---

**Sürüm geçmişi:**
- v1.1 — Port + adapter pattern for ad platform (sim/real swap via `LEYLEK_AD_PLATFORM`); demo runtime in sim mode; Meta moved to Faz 2; risk table updated (2026-05-19)
- v1.0 — initial document (2026-05-19)
