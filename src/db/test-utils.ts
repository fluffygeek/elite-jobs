import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

// Test-only database: PGlite is real Postgres compiled to WASM, not a mock,
// so it satisfies "integration tests against a real Postgres instance" without
// needing a hosted DB (none is provisioned yet for this project).
//
// Schema setup: we apply the raw SQL from the generated migration file
// (drizzle/0000_oval_bloodaxe.sql) directly, rather than running Drizzle's
// `migrate()` helper. `migrate()` expects a migrations journal + a
// `__drizzle_migrations` bookkeeping table, which is unnecessary ceremony for
// a throwaway per-test-file database that only ever needs the schema applied
// once. Reading the SQL file keeps this in sync with `db:generate` output
// without duplicating the schema by hand.
export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATION_PATH = path.resolve(import.meta.dirname, "../../drizzle/0000_oval_bloodaxe.sql");

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  const sql = readFileSync(MIGRATION_PATH, "utf-8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await client.exec(statement);
  }

  return db;
}
