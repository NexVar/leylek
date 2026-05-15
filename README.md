# Leylek

> **Müşteriyi Leylek getirir.** Siz uyurken satış yapan, zararı kesen otonom dijital pazarlama ajansınız.

Cloudflare Workers + Google Gemini 2.5 üzerinde çalışan **multi-agent** yapay zeka platformu. KOBİ'ler ve e-ticaret satıcıları için Meta Ads + Google Ads kampanyalarını otonom olarak üretir, yayınlar, optimize eder; zarar eden reklamı kapatıp bütçeyi kâr edene kaydırır.

İki çalışma modu:

- **Otopilot** — Tam otonom. Ajan kendi karar verir, eyleme geçer, log tutar.
- **Co-Pilot** — İnsan onaylı. Ajan önerir, kullanıcı tıklar, sonra ajan yürütür.

## Demo

| Surface | URL |
|---|---|
| Frontend | https://leylek-web.pages.dev |
| Gateway / API | https://leylek-gateway.batuhanbayazitt.workers.dev |
| `/api/health` (5-Worker probe) | [link](https://leylek-gateway.batuhanbayazitt.workers.dev/api/health) |

**Demo girişi:** Magic-link (Resend) — `batuhanbayazitt@gmail.com` yaz,
"E-postaya giriş bağlantısı gönder"e tıkla. Resend sandbox tarafında
reddederse gateway aynı sayfada "Doğrudan giriş bağlantısını aç" link'i
gösteriyor (dev-login fallback). **Google ile Giriş Yap butonu default'ta
gizli** (`LEYLEK_GOOGLE_OAUTH_READY=false`) — Cloud Console redirect-URI
kaydı yapılmadan tıklayan kullanıcı `redirect_uri_mismatch` hatası alır,
bu yüzden butonu UI'dan tamamen kaldırıyoruz. Kurulum +
flag flip için: [DEMO_PLAYBOOK §10](./docs/DEMO_PLAYBOOK.md).

**Otopilot + Co-Pilot:** Otopilot 60 saniyelik aha anı; Co-Pilot için
kampanya başlığındaki **Otopilot / Co-Pilot** pill'ine tıklayıp tekrar
"Şimdi Optimize Et" de — bu kez ajan kararı **öneri** olarak düşüyor,
kullanıcı **Onayla** butonuyla yayın ajanını tetikliyor (PRD §7).

**Akış:** [docs/DEMO_PLAYBOOK.md](./docs/DEMO_PLAYBOOK.md). Reset:
`pnpm db:seed` (idempotent). E2E: `./scripts/e2e-demo.sh`.

## Mimari özeti

Tamamen serverless — hiçbir sunucu kiralanmadı, sonsuz ölçeklenir.

| Katman | Teknoloji |
|---|---|
| Frontend | React 19 + Vite 8 + Tailwind CSS v4 (Cloudflare Pages) |
| Backend (5 mikroservis ajan) | Cloudflare Workers + Hono (Service Bindings ile haberleşir) |
| Per-campaign state | Cloudflare Durable Objects (her kampanya kendi "yaşayan ajanı") |
| Veritabanı | Cloudflare D1 (serverless SQLite) + Drizzle ORM |
| Cache & session | Cloudflare KV |
| AI | Google Gemini 2.5 Pro (content + optimizer kararı) / 2.5 Flash (özet) |
| Reklam API'leri | Meta Marketing API + Meta Conversions API + Google Ads API (gerçek, sandbox/test account) |
| Auth | Google OAuth 2.0 (ana) + Magic Link via Resend (yedek) |

Detaylı mimari: [PRD.md](./PRD.md) §5–§6.

## Multi-agent katmanı (5 Worker + 1 Durable Object)

```
React (Pages) → gateway Worker → [ content-agent | optimizer-agent | publisher-agent | analytics-worker ]
                                            ↓
                                  Campaign Durable Object (per kampanya)
                                            ↓
                                          D1 + KV
```

- `gateway` — API entry, Google OAuth + dev-login + JWT, AES helpers, frontend façade
- `content-agent` — **Gemini 2.5 Flash** (PRD §16 fallback path) — ürün URL'sini analiz, persona çıkarımı, 3 reklam varyantı (Agresif / Hikaye / Teknik), `responseSchema` ile structured output
- `optimizer-agent` — **Gemini 2.5 Flash** (cron her 6 saat) — spend/CPA/CTR oku, pause/keep/realloc kararı + Türkçe gerekçe
- `publisher-agent` — Google Ads gerçek API kodu repo'da (`real-google-ads.ts`); demo `sim` runtime'da `SimulatedAdsClient`; Meta `MetaAdsClient` Faz 2 stub
- `analytics-worker` — D1 metric_snapshots → cached aggregates (`ads.spend_kurus` vb.); real mode'da Google Ads insights'tan yeni snapshot çeker
- `Campaign DO` — per-campaign decision history, atomic Gemini → publisher action zinciri

## Repo yapısı

```
leylek/
├── apps/
│   └── web/                # React + Vite + Tailwind frontend
├── workers/
│   ├── gateway/
│   ├── content-agent/
│   ├── optimizer-agent/
│   ├── publisher-agent/
│   └── analytics-worker/
├── packages/
│   ├── shared-types/       # TS types ortak
│   ├── db/                 # Drizzle schema + migrations
│   └── prompts/            # Gemini prompt templates (versiyonlanmış)
├── scripts/
│   └── seed-demo-data.ts   # Demo seeding (gerçek API çağrılarıyla)
├── docs/
│   ├── PRD.md
│   ├── DESIGN.md           # Visual identity (Google design.md formatı)
│   └── ARCHITECTURE.md
├── .env.example
├── .gitignore
├── LICENSE
├── README.md
├── biome.json
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Kurulum (geliştirici)

```bash
pnpm install
cp .env.example .env        # tüm credential'ları doldur (yönlendirme PRD §9'da)
pnpm dev                    # Vite + wrangler dev paralel ayağa kaldırır
```

Tüm credential listesi ve nereden alınacağı için [`.env.example`](./.env.example) içindeki yorumları oku.

## Deploy + demo seed

```bash
# 1. Tüm 5 Worker + Pages tek komutta
./scripts/deploy.sh

# 2. Demlik Pro demo verisini D1 + KV'ye yaz
pnpm db:seed

# 3. End-to-end smoke (seeds, drives the browser, asserts state)
./scripts/e2e-demo.sh
```

Deploy bağımlılık sırasına dikkat eder: leaf Worker'lar → optimizer-agent
(publisher binding'i ister) → gateway (4 Worker'a binding). Pages
projesi `leylek-web` ilk deploy'da otomatik oluşur.

## Jüri için harita

| Konu | PRD bölümü |
|---|---|
| Multi-Agent mimarisi | §5 |
| Teknik altyapı (Cloudflare) | §6 |
| Veri akışı + D1 şema | §7, §8 |
| Real Integrations + Seeding stratejisi | §10 |
| Git Flow & Commit stratejisi | §11 |
| Demo akışı (60 sn aha) | §4 |
| Jüri sunum stratejisi (4 Hoca için) | §15 |

## Lisans

© 2026 NexVar. Tüm hakları saklıdır. **Proprietary** — bu repo jüri değerlendirmesi için public görünür, ancak yazılım Proprietary lisans altındadır. Kopyalama, dağıtım, türetilmiş eser yasaktır. [LICENSE](./LICENSE) dosyasına bakın.
