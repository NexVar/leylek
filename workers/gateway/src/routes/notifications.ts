/**
 * Cross-campaign notification routes — powers the global Co-Pilot inbox
 * shown in the header bell drawer.
 *
 * The per-campaign listing + approve/reject endpoints live in
 * `routes/campaigns.ts` and are unchanged. This file adds:
 *
 *   GET /api/notifications?status=pending|all&limit=N
 *
 * which returns the authenticated user's notifications across every
 * campaign they own, newest first, with the originating campaign joined
 * for inbox-side display.
 */

import { schema } from '@leylek/db';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';

import type { Env } from '../env';
import { type AuthVariables, requireAuth } from '../middleware/auth';

export const notificationRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

notificationRoutes.use('*', requireAuth);

notificationRoutes.get('/', async (c) => {
  const userId = Number(c.get('userId'));
  const status = c.req.query('status') === 'all' ? 'all' : 'pending';
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;

  const db = drizzle(c.env.DB, { schema });

  const baseWhere =
    status === 'pending'
      ? and(eq(schema.notifications.userId, userId), eq(schema.notifications.status, 'pending'))
      : eq(schema.notifications.userId, userId);

  const listing = await db
    .select({
      id: schema.notifications.id,
      userId: schema.notifications.userId,
      campaignId: schema.notifications.campaignId,
      type: schema.notifications.type,
      payloadJson: schema.notifications.payloadJson,
      status: schema.notifications.status,
      createdAt: schema.notifications.createdAt,
      resolvedAt: schema.notifications.resolvedAt,
      campaignProductUrl: schema.campaigns.productUrl,
    })
    .from(schema.notifications)
    .leftJoin(schema.campaigns, eq(schema.notifications.campaignId, schema.campaigns.id))
    .where(baseWhere)
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit);

  const notifications = listing.map((row) => ({
    id: row.id,
    userId: row.userId,
    campaignId: row.campaignId,
    type: row.type,
    payloadJson: row.payloadJson,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    campaign: row.campaignId
      ? { id: row.campaignId, productUrl: row.campaignProductUrl ?? '' }
      : null,
  }));

  // pendingCount is always returned (even when status=all) so the bell
  // badge stays correct without a second round-trip.
  const pendingRows = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(eq(schema.notifications.userId, userId), eq(schema.notifications.status, 'pending')),
    );

  return c.json({ notifications, pendingCount: pendingRows.length });
});
