# Leylek

> **Müşteriyi Leylek getirir.** Siz uyurken satış yapan, zararı kesen otonom dijital pazarlama ajansınız.

Cloudflare Workers + Google Gemini 2.5 üzerinde çalışan **multi-agent** yapay zeka platformu. KOBİ'ler ve e-ticaret satıcıları için Meta Ads + Google Ads kampanyalarını otonom olarak üretir, yayınlar, optimize eder; zarar eden reklamı kapatıp bütçeyi kâr edene kaydırır.

İki çalışma modu:

- **Otopilot** — Tam otonom. Ajan kendi karar verir, eyleme geçer, log tutar.
- **Co-Pilot** — İnsan onaylı. Ajan önerir, kullanıcı tıklar, sonra ajan yürütür.

## Demo

Demo URL ve seed user bilgisi demo öncesi buraya eklenecek.

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

- `gateway` — API entry, OAuth, rate-limit, frontend façade
- `content-agent` — **Gemini 2.5 Pro** — ürün URL'sini analiz, persona çıkarımı, 3 reklam varyantı (Agresif / Hikaye / Teknik)
- `optimizer-agent` — **Gemini 2.5 Pro** (cron) — spend/CPA/CTR oku, pause/keep/realloc kararı + gerekçe
- `publisher-agent` — Meta + Google Ads gerçek API aksiyonları (yayına alma, pause, budget shift)
- `analytics-worker` — Meta/Google'dan metric çek (cron), D1'e yaz
- `Campaign DO` — per-campaign decision history, queued actions, atomic state

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
