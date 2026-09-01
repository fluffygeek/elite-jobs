import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db";
import { markets } from "@/db/schema";
import type * as schema from "@/db/schema";

// Markets are a small, admin-managed list — not part of the Job concurrency
// model (see AGENTS.md ground rules), so plain reads/writes are fine here;
// no compare-and-swap needed.
//
// Each function takes an optional `db` so tests can pass in a PGlite instance
// (see src/db/test-utils.ts) while production callers get the real
// postgres.js singleton by default. Typed against the driver-agnostic
// PgDatabase base so both the postgres.js driver and the pglite test driver
// satisfy the parameter type.
export type DbClient = PgDatabase<PgQueryResultHKT, typeof schema>;

export async function listMarkets(db: DbClient = defaultDb) {
  return db.select().from(markets).orderBy(markets.name);
}

export async function listActiveMarkets(db: DbClient = defaultDb) {
  return db.select().from(markets).where(eq(markets.active, true)).orderBy(markets.name);
}

// Looks up a Market by its exact name — used by src/db/queries/jobs.ts's
// createJob to resolve the Market a Job belongs to from the name
// src/lib/domain/market-from-state.ts derives from the submitted State.
// Returns undefined when no Market with that name exists.
export async function getMarketByName(name: string, db: DbClient = defaultDb) {
  const [market] = await db.select().from(markets).where(eq(markets.name, name));
  return market;
}

export async function createMarket(name: string, db: DbClient = defaultDb) {
  const [market] = await db.insert(markets).values({ name }).returning();
  return market;
}

export async function renameMarket(id: string, name: string, db: DbClient = defaultDb) {
  const [market] = await db
    .update(markets)
    .set({ name })
    .where(eq(markets.id, id))
    .returning();
  return market;
}

export async function setMarketActive(id: string, active: boolean, db: DbClient = defaultDb) {
  const [market] = await db
    .update(markets)
    .set({ active })
    .where(eq(markets.id, id))
    .returning();
  return market;
}
