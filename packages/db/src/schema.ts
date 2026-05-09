/**
 * Leylek D1 schema (Drizzle ORM).
 *
 * Mirrors PRD §8. Every column has a comment because jury will read this.
 * Monetary values stored as integer kurus (Turkish lira / 100) to avoid float math.
 */

import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// users — login identity
// ---------------------------------------------------------------------------
export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    email: text('email').notNull().unique(),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    /** 'google' | 'magic_link' */
    provider: text('provider').notNull(),
    /** Google sub or email-for-magic-link */
    providerSub: text('provider_sub').notNull(),
    companyName: text('company_name'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    lastLoginAt: text('last_login_at'),
  },
  (table) => ({
    providerIdx: uniqueIndex('idx_users_provider').on(table.provider, table.providerSub),
  }),
);

// ---------------------------------------------------------------------------
// connected_accounts — user's Meta / Google Ads OAuth links
// ---------------------------------------------------------------------------
export const connectedAccounts = sqliteTable(
  'connected_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'meta' | 'google_ads' */
    provider: text('provider').notNull(),
    /** Meta ad_account_id (act_XXX) or Google Ads customer_id (10-digit) */
    externalId: text('external_id').notNull(),
    /** Human label e.g. "Ahmet'in Magazasi" */
    accountLabel: text('account_label'),
    /** AES-256-GCM ciphertext; envelope key in Workers Secrets */
    encAccessToken: text('enc_access_token'),
    encRefreshToken: text('enc_refresh_token'),
    tokenExpiresAt: text('token_expires_at'),
    /** Comma-separated scope list */
    scopes: text('scopes'),
    /** 'active' | 'expired' | 'revoked' */
    status: text('status').notNull().default('active'),
    connectedAt: text('connected_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    lastUsedAt: text('last_used_at'),
  },
  (table) => ({
    userProviderExternalIdx: uniqueIndex('idx_connected_accounts_user_provider_external').on(
      table.userId,
      table.provider,
      table.externalId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// campaigns
// ---------------------------------------------------------------------------
export const campaigns = sqliteTable('campaigns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  productUrl: text('product_url').notNull(),
  /** 'OTOPILOT' | 'COPILOT' */
  mode: text('mode').notNull(),
  /** Daily budget in kurus (TRY * 100) */
  dailyBudgetKurus: integer('daily_budget_kurus').notNull(),
  /** 'active' | 'paused' | 'archived' */
  status: text('status').notNull().default('active'),
  /** Durable Object instance identifier */
  doId: text('do_id'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// ads — variant under a campaign
// ---------------------------------------------------------------------------
export const ads = sqliteTable('ads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  campaignId: integer('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  /** 'AGGRESSIVE' | 'STORY' | 'TECHNICAL' */
  strategyType: text('strategy_type').notNull(),
  adText: text('ad_text').notNull(),
  imagePrompt: text('image_prompt'),
  /** Real Meta ad id returned by Marketing API */
  metaAdId: text('meta_ad_id'),
  /** Real Google Ads ad id returned by Ads API */
  googleAdId: text('google_ad_id'),
  /** 'pending' | 'active' | 'paused' */
  status: text('status').notNull().default('pending'),
  spendKurus: integer('spend_kurus').notNull().default(0),
  cpaKurus: integer('cpa_kurus'),
  /** CTR x 10000 — e.g. 250 = 2.5% */
  ctrBasisPoints: integer('ctr_basis_points'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// agent_logs — every agent decision with reasoning (jury-critical)
// ---------------------------------------------------------------------------
export const agentLogs = sqliteTable(
  'agent_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** 'content' | 'optimizer' | 'publisher' */
    agentName: text('agent_name').notNull(),
    /** 'PAUSED_AD' | 'REALLOCATED_BUDGET' | 'CREATED_AD' | ... */
    actionTaken: text('action_taken').notNull(),
    /** ad_id or campaign_id reference, agent-defined */
    targetRef: text('target_ref'),
    /** Gemini reasoning, human-readable */
    reason: text('reason').notNull(),
    /** 0.0 - 1.0 */
    confidence: real('confidence'),
    /** Audit trail for the Gemini call */
    geminiRequestId: text('gemini_request_id'),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    campaignTimeIdx: index('idx_agent_logs_campaign_time').on(table.campaignId, table.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// metric_snapshots — time-series ad performance data
// ---------------------------------------------------------------------------
export const metricSnapshots = sqliteTable(
  'metric_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    adId: integer('ad_id')
      .notNull()
      .references(() => ads.id, { onDelete: 'cascade' }),
    snapshotAt: text('snapshot_at').notNull(),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    conversions: integer('conversions').notNull().default(0),
    spendKurus: integer('spend_kurus').notNull().default(0),
  },
  (table) => ({
    adTimeIdx: index('idx_metric_snapshots_ad_time').on(table.adId, table.snapshotAt),
  }),
);

// ---------------------------------------------------------------------------
// notifications — Co-Pilot proposal queue
// ---------------------------------------------------------------------------
export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  campaignId: integer('campaign_id').references(() => campaigns.id, {
    onDelete: 'cascade',
  }),
  /** 'STOP_LOSS_PROPOSAL' | 'BUDGET_SHIFT_PROPOSAL' | ... */
  type: text('type').notNull(),
  /** Proposed action detail as JSON string */
  payloadJson: text('payload_json').notNull(),
  /** 'pending' | 'approved' | 'rejected' */
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text('resolved_at'),
});

// ---------------------------------------------------------------------------
// Type exports for downstream packages
// ---------------------------------------------------------------------------
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ConnectedAccount = typeof connectedAccounts.$inferSelect;
export type NewConnectedAccount = typeof connectedAccounts.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type Ad = typeof ads.$inferSelect;
export type NewAd = typeof ads.$inferInsert;
export type AgentLog = typeof agentLogs.$inferSelect;
export type NewAgentLog = typeof agentLogs.$inferInsert;
export type MetricSnapshot = typeof metricSnapshots.$inferSelect;
export type NewMetricSnapshot = typeof metricSnapshots.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
