import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

// Test-only database: PGlite is real Postgres compiled to WASM (not a mock),
// so these are genuine integration tests against a real Postgres engine —
// just an in-memory, per-test-file instance instead of a live server.
//
// Schema setup: we apply the same SQL migration files in ./drizzle that
// production uses (via drizzle-kit generate/migrate), rather than a
// programmatic `drizzle-kit push`, so the test schema is guaranteed to match
// exactly what a real deploy would run.
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });

  return db;
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;
