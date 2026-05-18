# mockdata — Google Ads + Meta Ads mock worker plan

> Tasarım dokümanı. Şu an `SimulatedAdsClient` (KV-state, bespoke) +
> `RealGoogleAdsClient` (gerçek HTTP) iki ayrı kod yolu olarak duruyor.
> Bu plan **tek-yol mimariye** geçişi tanımlıyor: production `RealGoogleAdsClient`
> + `RealMetaAdsClient`, base URL env'den injectable; sandbox'ta mock Worker'lara,
> prod'da gerçek `googleads.googleapis.com` / `graph.facebook.com`'a yönlendiriliyor.

## Motivasyon

| Şu an | Mock plan sonrası |
|---|---|
| 2 ayrı kod yolu (Sim + Real) | 1 yol — `RealGoogleAdsClient`, `RealMetaAdsClient` |
| Sim adapter prod'da hiç exercise olmuyor → drift riski | Production code path her demoyu sürüyor |
| Jüri: "Real ships in repo, demo sim'de çalışıyor" | Jüri: "Tek prod kod, base URL'i değiştirdiğimde gerçek Google'a konuşuyor" |
| Meta `MetaAdsClient` NOT_IMPLEMENTED stub | Meta production-ready, mock üstünde test edilmiş |
| `LEYLEK_AD_PLATFORM=sim|real` flag | Sadece `GOOGLE_ADS_BASE_URL` + `META_ADS_BASE_URL` URL switch |

## Mimari

```
publisher-agent
  └─ makeAdPlatformClient({provider, baseUrl, credentials})
       ├─ RealGoogleAdsClient(baseUrl=GOOGLE_ADS_BASE_URL, …)
       │      ↓ HTTP
       │   ┌─ sandbox: leylek-google-ads-mock.workers.dev  (Faz 1 — yeni Worker)
       │   └─ prod   : googleads.googleapis.com             (zaten çalışır)
       │
       └─ RealMetaAdsClient(baseUrl=META_ADS_BASE_URL, …)    (Faz 3 — yeni client)
              ↓ HTTP
           ┌─ sandbox: leylek-meta-ads-mock.workers.dev     (Faz 2 — yeni Worker)
           └─ prod   : graph.facebook.com                    (Meta App Review sonrası)
```

## Plan — fazlar

### Faz 0 — Mimari karar + cleanup (~30 dk)

**Yapılacak:**
- `wrangler.toml`'lara (publisher-agent + analytics-worker) yeni var:
  ```toml
  GOOGLE_ADS_BASE_URL = "https://leylek-google-ads-mock.batuhanbayazitt.workers.dev"
  META_ADS_BASE_URL = "https://leylek-meta-ads-mock.batuhanbayazitt.workers.dev"
  GOOGLE_ADS_OAUTH_URL = "https://leylek-google-ads-mock.batuhanbayazitt.workers.dev"
  ```
  Prod flip: bu var'ları `https://googleads.googleapis.com` ve
  `https://graph.facebook.com` + `https://oauth2.googleapis.com` olarak değiştir.
- `LEYLEK_AD_PLATFORM=sim|real` flag deprecate (mevcut env okuma kaldırılır)
- `SimulatedAdsClient` artık factory'den dönmüyor; dosya silinmiyor (geri dönüş
  kolay olsun diye) ama `make-client.ts` artık dispatch etmiyor.

**Dosya değişiklikleri:**
- `workers/publisher-agent/wrangler.toml` — 3 var eklenir, `LEYLEK_AD_PLATFORM` kalkar
- `workers/analytics-worker/wrangler.toml` — aynı
- `workers/publisher-agent/src/clients/make-client.ts` — sim branch silinir
- `workers/publisher-agent/src/env.ts` — yeni var'lar tip-safe

**Acceptance:**
- `pnpm -r typecheck` clean
- Mevcut Worker'lar deploy'lansa bile çakışmaz (yeni var'lar default'a düşer veya optional)

---

### Faz 1 — `leylek-google-ads-mock` Worker (~2 saat)

**Yeni klasör:** `workers/google-ads-mock/`

**Klasör yapısı:**
```
workers/google-ads-mock/
  src/
    index.ts              # Hono app + route dispatch
    env.ts                # KV binding
    handlers/
      oauth.ts            # POST /oauth2/v4/token  → fake access_token
      campaign-budgets.ts # POST /v17/customers/:cid/campaignBudgets:mutate
      campaigns.ts        # POST /v17/customers/:cid/campaigns:mutate
      ad-groups.ts        # POST /v17/customers/:cid/adGroups:mutate
      ad-group-ads.ts     # POST /v17/customers/:cid/adGroupAds:mutate
      google-ads-search.ts# POST /v17/customers/:cid/googleAds:search
    gaql.ts               # Minimal GAQL parser — sadece bizim 2 query shape'i
  package.json
  tsconfig.json
  wrangler.toml
```

**KV layout** (paylaşılan `leylek-kv`, ayrı prefix):
```
gads:customer:<cid>                  → CustomerSummary JSON
gads:budget:<cid>:<budgetId>         → CampaignBudget JSON {resourceName, amountMicros, ...}
gads:campaign:<cid>:<campaignId>     → Campaign JSON {resourceName, status, name, campaignBudget, …}
gads:adGroup:<cid>:<adGroupId>       → AdGroup JSON
gads:ad:<cid>:<adId>                 → AdGroupAd JSON {status, ad: {responsive_search_ad: {…}}}
gads:metrics:<cid>:<adId>            → DailySnapshot[] JSON (Demlik Pro pattern, 48h)
```

**Endpoint detayları:**

| Endpoint | İstek | Cevap |
|---|---|---|
| `POST /v17/customers/:cid/campaignBudgets:mutate` | `{operations:[{create:{name, amount_micros, delivery_method}}]}` | `{results:[{resourceName:'customers/:cid/campaignBudgets/<gen-id>'}]}` |
| `POST /v17/customers/:cid/campaigns:mutate` | `{operations:[{create:{name, status:'PAUSED', advertising_channel_type:'SEARCH', campaign_budget, network_settings:{…}}}]}` | `{results:[{resourceName:'customers/:cid/campaigns/<gen-id>'}]}` |
| `POST /v17/customers/:cid/adGroups:mutate` | `{operations:[{create:{name, campaign, status:'ENABLED', type:'SEARCH_STANDARD', cpc_bid_micros}}]}` | `{results:[{resourceName:'customers/:cid/adGroups/<gen-id>'}]}` |
| `POST /v17/customers/:cid/adGroupAds:mutate` | `{operations:[{create:{ad_group, status, ad:{final_urls, responsive_search_ad:{headlines, descriptions}}}}]}` veya `{operations:[{update:{resource_name, status}, update_mask:'status'}]}` | `{results:[{resourceName:'customers/:cid/adGroupAds/<gen-id>~<gen-ad-id>'}]}` |
| `POST /v17/customers/:cid/googleAds:search` | `{query:'<GAQL>'}` | `{results:[…]}` — GAQL parser şu 2 shape'i destekler:<br/>1. `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = <id>`<br/>2. `SELECT metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros FROM ad_group_ad WHERE ad_group_ad.ad.id = <id> AND segments.date BETWEEN '<d1>' AND '<d2>'` |
| `POST /oauth2/v4/token` | URL-encoded `grant_type=refresh_token&client_id=…&refresh_token=…` | `{access_token:'mock_<random>', expires_in:3600}` — gerçek client'taki cache mekanizmasını test eder |

**Yan davranışlar:**
- Her endpoint **50-200 ms artificial latency** (`SimulatedAdsClient`'taki gibi, gerçek hissi versin)
- `POST /v17/customers/:cid/adGroupAds:mutate` ile `update_mask: 'status'` gelirse: KV'deki `gads:ad:*`'ı update, idempotent
- `metrics.cost_micros` Demlik Pro pattern'ine göre Demlik AGGRESSIVE'de yüksek, STORY'de düşük (seed script ile aynı kurva)

**GAQL parser** (`src/gaql.ts`):
- Regex-based, sadece bizim 2 query shape'ini parse eder
- Detection: `WHERE campaign.id = <num>` → budget lookup; `WHERE ad_group_ad.ad.id = <num> AND segments.date BETWEEN '<d1>' AND '<d2>'` → metrics fetch
- Bilinmeyen query → 400 `{error: 'unsupported GAQL'}`

**Acceptance:**
- `curl POST` her endpoint'e Google Ads API JSON shape'inde cevap döndürür
- `wrangler deploy` ile `leylek-google-ads-mock.workers.dev` canlı
- `RealGoogleAdsClient` (base URL = mock) ile create campaign → create ad → pause → metrics fetch tam zincir çalışır

---

### Faz 2 — `leylek-meta-ads-mock` Worker (~2 saat)

**Yeni klasör:** `workers/meta-ads-mock/`

**Klasör yapısı:**
```
workers/meta-ads-mock/
  src/
    index.ts
    env.ts
    handlers/
      campaigns.ts        # POST /v21.0/act_:adAccountId/campaigns
      adsets.ts           # POST /v21.0/act_:adAccountId/adsets
      ads.ts              # POST /v21.0/act_:adAccountId/ads, POST /v21.0/:adId
      insights.ts         # GET  /v21.0/:adId/insights
      oauth.ts            # GET  /v21.0/oauth/access_token
  package.json
  tsconfig.json
  wrangler.toml
```

**KV layout:**
```
meta:adAccount:<aaId>                → AdAccount JSON
meta:campaign:<aaId>:<campId>        → Campaign JSON {id, objective, status, …}
meta:adset:<aaId>:<adsetId>          → AdSet JSON {id, campaign_id, daily_budget, …}
meta:ad:<aaId>:<adId>                → Ad JSON {id, adset_id, creative, effective_status, …}
meta:insights:<adId>                 → daily insight rows
```

**Endpoint detayları:**

| Endpoint | Davranış |
|---|---|
| `POST /v21.0/act_<aa>/campaigns` `{name, objective, status, special_ad_categories}` | Campaign create, `{id:'<gen>'}` döndür |
| `POST /v21.0/act_<aa>/adsets` `{name, campaign_id, daily_budget, billing_event, optimization_goal, targeting, status}` | AdSet create |
| `POST /v21.0/act_<aa>/ads` `{name, adset_id, creative, status}` | Ad create |
| `POST /v21.0/<adId>` `{status:'PAUSED'\|'ACTIVE'}` | Ad status update, idempotent |
| `POST /v21.0/<adsetId>` `{daily_budget}` | AdSet budget update (Meta'da budget AdSet seviyesinde, Google'la farklı) |
| `GET /v21.0/<adId>/insights?date_preset=last_2_days&fields=impressions,clicks,spend,actions` | Mock metric döndür, Demlik Pro pattern |
| `GET /v21.0/oauth/access_token?grant_type=fb_exchange_token&fb_exchange_token=<short>&client_id=…&client_secret=…` | `{access_token:'mock_meta_<random>', expires_in:5184000}` (60 gün — long-lived) |

**Yan davranışlar:**
- Aynı latency (50-200 ms)
- Meta'da response shape'leri Google'dan farklı — `{data: [...], paging: {…}}` veya tek obj. Mock bunları doğru taklit eder.
- `effective_status` ile `status` Meta'da iki ayrı field — mock ikisini de döndürür

**Acceptance:**
- Worker deploy
- `curl` ile create campaign → create adset → create ad → pause → insights zincir çalışır
- Cevaplar Meta Marketing API v21.0 shape'inde

---

### Faz 3 — `RealMetaAdsClient` (~1.5 saat)

**Dosya:** `workers/publisher-agent/src/clients/real-meta-ads.ts` — şu an stub.

**Yeni implementasyon:**

```ts
export interface RealMetaAdsConfig {
  baseUrl: string;           // mock veya graph.facebook.com
  accessToken: string;        // user access token (long-lived)
  adAccountId: string;        // act_<id> format
  apiVersion: string;         // 'v21.0' default
}

export class RealMetaAdsClient implements AdPlatformClient {
  readonly runtime = 'real' as const;

  constructor(private readonly cfg: RealMetaAdsConfig) {}

  async createCampaign(input: CreateCampaignInput): Promise<{ externalId: string }> {
    const dailyKurus = input.dailyBudgetKurus;
    // Meta'da campaign-level budget yok (objective-bazlı kampanyalarda var ama
    // bizim Faz 1 senaryomuzda AdSet seviyesinde budget); önce campaign,
    // sonra adset bir wrapper'la oluşturuluyor.
    const resp = await this.metaFetch(`/act_${this.cfg.adAccountId}/campaigns`, 'POST', {
      name: input.name,
      objective: 'OUTCOME_TRAFFIC',
      status: 'PAUSED',
      special_ad_categories: '[]',
    });
    return { externalId: resp.id };
  }

  async createAd(input: CreateAdInput): Promise<{ externalId: string }> {
    // 1. AdSet oluştur (campaign'in altında)
    // 2. Ad creative oluştur
    // 3. Ad'ı creative'e bağla
    // ... implementation
  }

  async pauseAd(externalAdId: string, reason: string): Promise<void> {
    await this.metaFetch(`/${externalAdId}`, 'POST', { status: 'PAUSED' });
  }

  async resumeAd(externalAdId: string): Promise<void> {
    await this.metaFetch(`/${externalAdId}`, 'POST', { status: 'ACTIVE' });
  }

  async updateBudget(externalCampaignId: string, newBudgetKurus: number): Promise<void> {
    // Bizim modelimizde campaign id ama Meta'da budget AdSet'te.
    // Lookup: campaign altındaki ilk AdSet'in budget'ini değiştir.
    // GraphQL-style: GET /v21.0/<campId>/adsets?fields=id,daily_budget
  }

  async fetchMetrics(externalAdId: string, windowHours: number): Promise<MetricWindow> {
    const datePreset = windowHours <= 24 ? 'today' :
                       windowHours <= 48 ? 'yesterday' : 'last_3_days';
    const resp = await this.metaFetch<{data: any[]}>(
      `/${externalAdId}/insights`,
      'GET',
      undefined,
      { date_preset: datePreset, fields: 'impressions,clicks,spend,actions' },
    );
    // Parse + return MetricWindow shape
  }

  private async metaFetch<T>(path, method, body?, qs?): Promise<T> {
    const url = `${this.cfg.baseUrl}/${this.cfg.apiVersion}${path}`;
    // …
  }
}
```

**`MetaAdsClient` stub silinir** veya bu yeni class'la replace edilir.

**Acceptance:**
- `pnpm typecheck` clean
- `RealMetaAdsClient(baseUrl=mock-worker-url, …)` zinciri yeni mock'a karşı çalışır

---

### Faz 4 — Factory rewrite (~30 dk)

**Dosya:** `workers/publisher-agent/src/clients/make-client.ts`

```ts
export interface MakeClientInput {
  provider: 'google_ads' | 'meta';
  credentials: {
    refreshToken?: string;     // Google
    accessToken?: string;      // Meta
    customerId?: string;       // Google (10-digit)
    adAccountId?: string;      // Meta
  };
  env: {
    GOOGLE_ADS_BASE_URL: string;
    GOOGLE_ADS_OAUTH_URL: string;
    META_ADS_BASE_URL: string;
    GOOGLE_ADS_DEVELOPER_TOKEN: string;
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: string;
    GOOGLE_OAUTH_CLIENT_ID: string;
    GOOGLE_OAUTH_CLIENT_SECRET: string;
  };
}

export function makeAdPlatformClient(input: MakeClientInput): AdPlatformClient {
  if (input.provider === 'google_ads') {
    return new RealGoogleAdsClient({
      baseUrl: input.env.GOOGLE_ADS_BASE_URL,
      oauthUrl: input.env.GOOGLE_ADS_OAUTH_URL,
      developerToken: input.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      loginCustomerId: input.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
      customerId: input.credentials.customerId!,
      refreshToken: input.credentials.refreshToken!,
      clientId: input.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: input.env.GOOGLE_OAUTH_CLIENT_SECRET,
    });
  }
  return new RealMetaAdsClient({
    baseUrl: input.env.META_ADS_BASE_URL,
    accessToken: input.credentials.accessToken!,
    adAccountId: input.credentials.adAccountId!,
    apiVersion: 'v21.0',
  });
}
```

**Çağrı yerleri** (publisher-agent routes + analytics-worker cron) güncellenir:
- Eski: `makeAdPlatformClient({runtime, provider, kv, realConfig?})`
- Yeni: `makeAdPlatformClient({provider, credentials, env})`

---

### Faz 5 — `RealGoogleAdsClient` refactor (~30 dk)

**Dosya:** `workers/publisher-agent/src/clients/real-google-ads.ts`

Mevcut hardcoded constants kaldırılır:
- `const GOOGLE_ADS_ROOT = 'https://googleads.googleapis.com';` → `cfg.baseUrl`
- `const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';` → `cfg.oauthUrl`

Constructor'a `baseUrl` + `oauthUrl` eklenir. `adsFetch()` ve `accessToken()` bunları kullanır.

**Acceptance:**
- `pnpm typecheck` clean
- Tek değişiklikle (env var'larda base URL) mock'a veya prod'a yönlendirilebilir

---

### Faz 6 — Seed script update (~45 dk)

**Dosya:** `scripts/seed-demo-data.ts`

Mevcut `sim:campaign:*` / `sim:ad:*` / `sim:metrics:*` yazımı **iki yeni prefix'e** dönüşür:

```ts
// Eski sim:campaign:sim_camp_demlik
// Yeni:
// gads:customer:<test-customer-id>           = customer summary
// gads:budget:<cid>:<gen-id>                 = budget object (1000 TRY = 10_000_000 micros)
// gads:campaign:<cid>:<gen-id>               = campaign object
// gads:adGroup:<cid>:<gen-id>                = ad group
// gads:ad:<cid>:<gen-id-1> (AGGRESSIVE)      = ad with status, creative
// gads:ad:<cid>:<gen-id-2> (STORY)
// gads:ad:<cid>:<gen-id-3> (TECHNICAL)
// gads:metrics:<cid>:<gen-id-N>              = 48h daily snapshots
```

D1 ads tablosunda `googleAdId` artık `<cid>~<adId>` format'ı (Google'ın gerçek resourceName tail'i ile uyumlu).

**Idempotence**: seed re-run KV prefix'leri silip yeniden yazar.

---

### Faz 7 — Deploy + bind + test (~30 dk)

**Komutlar:**
```bash
# 1. Mock worker'ları deploy
(cd workers/google-ads-mock && wrangler deploy)
(cd workers/meta-ads-mock && wrangler deploy)

# 2. Eski sim KV state'i temizle (opsiyonel)
wrangler kv key list --namespace-id=<kv> --prefix=sim: \
  | jq -r '.[].name' | xargs -I{} wrangler kv key delete --namespace-id=<kv> {}

# 3. Publisher-agent + analytics-worker redeploy (yeni env var'larla)
(cd workers/publisher-agent && wrangler deploy)
(cd workers/analytics-worker && wrangler deploy)

# 4. Seed
pnpm db:seed

# 5. E2E
./scripts/e2e-demo.sh
```

**Acceptance:**
- 5 (artık 7) Worker `/api/health` ok
- E2E green: magic-link → dashboard → optimize-now → mock'ta AGGRESSIVE ad PAUSED
- `wrangler tail` ile publisher-agent log'larında `GOOGLE_ADS_BASE_URL=...mock.workers.dev`'e gerçek HTTP çağrıları görünüyor (`SimulatedAdsClient` log'ları yok)

---

## Toplam tahmin

| Faz | Süre | Çıktı |
|---|---|---|
| 0. Cleanup | 30 dk | Env var'lar + `LEYLEK_AD_PLATFORM` deprecated |
| 1. Google Ads mock worker | 2h | `workers/google-ads-mock/` deploy'ed |
| 2. Meta Ads mock worker | 2h | `workers/meta-ads-mock/` deploy'ed |
| 3. RealMetaAdsClient | 1.5h | Meta production-ready kod repo'da |
| 4. Factory rewrite | 30 dk | Tek code path, sim/real flag yok |
| 5. RealGoogleAdsClient refactor | 30 dk | baseUrl injectable |
| 6. Seed update | 45 dk | KV mock state Google/Meta shape'inde |
| 7. Deploy + E2E | 30 dk | Hepsi canlı, e2e green |
| **Toplam** | **~8 saat** | 2 yeni mock Worker + RealMetaAdsClient + tek client path |

## Risk + geri dönüş

- **GAQL parser**: minimal subset yazılır, edge case yakalanırsa worker 400 döner.
  Test edilen 2 query shape (budget lookup + metrics fetch by ad ID) yeterli.
- **`SimulatedAdsClient` silinmiyor**: factory artık kullanmıyor ama dosya
  repoda kalıyor. Bir saat içinde eski state'e dönülebilir (factory + env
  rollback).
- **Meta `id` collision**: Meta API gerçek ID'leri integer, biz `crypto.randomUUID()`
  hex döndürüyoruz. Mock client implementation'da `id: string` olduğu için
  çalışır; gerçek Meta'ya geçince ID'ler integer döner, kod aynı (her ikisi
  `string`).
- **OAuth refresh cache invalidation**: mock token süresi 3600s, kod bunu
  doğru sürüyor. Cache 30s buffer'lı yenileniyor.

## İleri ihtimal — production flip

Mock plan tamamen production-ready. Üretime geçmek:

1. Google Ads dev token (Test access yeterli) + Test Manager Customer ID al
2. `wrangler secret put GOOGLE_ADS_BASE_URL=https://googleads.googleapis.com --name leylek-publisher-agent` (var yerine secret çünkü Sensitive olmasa da prod URL'i config drift olmasın)
3. `wrangler secret put GOOGLE_ADS_OAUTH_URL=https://oauth2.googleapis.com --name leylek-publisher-agent`
4. Aynı şey META_ADS_BASE_URL → `graph.facebook.com`
5. User OAuth token'ları gerçek Google/Meta hesabıyla `connected_accounts.enc_*` AES-encrypt edilmiş olarak D1'e gelmesi gerek (mevcut publisher route handler buna hazır TODO(real) satırı ile)

## İlişkili dokümanlar

- PRD §10 — Port + Adapter pattern (bu plan onu pekiştiriyor)
- DEMO_PLAYBOOK §9 — Co-Pilot walkthrough (mock'lar tetiklendikçe bu akış aynen kalır)
- AGENT_DECISIONS §3 — ad-platform runtime — bu plan §3'ü güncelliyor: artık tek client, base URL switch.

## Karar

Aşağıdaki üç seçenekten biriyle ilerlenecek (kullanıcı seçecek):

- [ ] **Tam plan (~8 saat)** — Google + Meta mock + her ikisi de production-ready.
- [ ] **Küçük başla (~3 saat)** — sadece Faz 1 (Google Ads mock) + Faz 5 (RealGoogleAdsClient
      refactor) + Faz 6 partial (gads:* seed) + Faz 7 partial. Meta sonraki sprint'e.
- [ ] **Şimdilik kalsın** — mevcut SimulatedAdsClient yeterli, jüriye anlatım aynı.
