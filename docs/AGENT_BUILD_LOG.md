# Agent Build Log

> Per-wave summary of what the autonomous agent built, why, and what verified
> green. Newest wave at the top. Companion to
> [AGENT_DECISIONS.md](./AGENT_DECISIONS.md) — decisions are the "what",
> this log is the "how it actually landed".

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
