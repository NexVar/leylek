# Architecture — Leylek

> Living document. Mirrors PRD §5 (Multi-Agent Mimarisi) and §6 (Teknik Altyapı), but goes deeper as workers ship.

## High-level

```
   React 19 + Vite 8 + Tailwind v4 (Cloudflare Pages)
                │
                ▼
       gateway Worker (Hono)
        │  │  │  │
        ▼  ▼  ▼  ▼  (Service Bindings)
  content  optimizer  publisher  analytics
  -agent   -agent     -agent     -worker
   │          │           │           │
   │          ▼           │           │
   │   Campaign DO ───────┘           │
   │          │                       │
   └──────► D1 SQL ◄───────────────────┘
            + KV + Workers Secrets
```

5 Worker + 1 Durable Object class. Per-campaign DO instance.

## Per-Worker dosyalar (gelecek commit'lerde detaylanır)

- `workers/gateway/` — API entry, auth, façade
- `workers/content-agent/` — Gemini-powered ad creative generation
- `workers/optimizer-agent/` — Gemini-powered decision agent + Campaign DO host
- `workers/publisher-agent/` — Meta + Google Ads action layer
- `workers/analytics-worker/` — Metric ingestion

## Data layer

- **D1** — primary persistent state (users, campaigns, ads, agent_logs, metric_snapshots)
- **KV** — session token, rate-limit counter, geçici cache
- **Durable Object** — `CampaignAgent` (per-campaign atomic execution)
- **R2** — Faz 2 (ad creative image storage)

## Deployment topology

- Cloudflare Pages auto-deploy on `main` push
- Workers deployed via `wrangler deploy` (per-Worker `wrangler.toml`)
- D1, KV, DO bindings declared per Worker

## Detailed worker contracts

(Bu bölüm her Worker landing'inde güncellenir: input/output schema, error model, observability, performance budget.)

### gateway

_TODO: ship et + dökümante et_

### content-agent

_TODO_

### optimizer-agent + CampaignAgent DO

_TODO_

### publisher-agent

_TODO_

### analytics-worker

_TODO_

## Reference

- PRD §5 — Multi-Agent Mimarisi
- PRD §6 — Teknik Altyapı
- PRD §7 — Veri Akışı
- PRD §8 — D1 Schema
- PRD §9 — Güvenlik & API Yönetimi
