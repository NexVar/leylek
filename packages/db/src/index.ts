/**
 * @leylek/db — Drizzle ORM client for Cloudflare D1.
 *
 * Usage in a Worker:
 *
 *   import { drizzle } from 'drizzle-orm/d1';
 *   import { schema } from '@leylek/db';
 *
 *   const db = drizzle(env.DB, { schema });
 *   const user = await db.select().from(schema.users).where(...);
 */

import * as schema from './schema';

export { schema };
export * from './schema';
