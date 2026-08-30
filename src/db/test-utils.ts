import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

// Test-only database: PGlite is real Postgres compiled to WASM, not a mock,
// so it satisfies "integration tests against a real Postgres instance" without
// needing a hosted DB (none is provisioned yet for this project).
//
// Schema setup: we apply the raw SQL from the generated migration files
// directly, rather than running Drizzle's `migrate()` helper. `migrate()`
// expects a migrations journal + a `__drizzle_migrations` bookkeeping table,
// which is unnecessary ceremony for a throwaway per-test-file database that
// only ever needs the schema applied once. Reading the SQL files keeps this
// in sync with `db:generate` output without duplicating the schema by hand.
export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../drizzle");
const MIGRATION_FILES = [
  "0000_oval_bloodaxe.sql",
  "0001_brave_molly_hayes.sql",
  "0002_remarkable_leper_queen.sql",
];

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  for (const file of MIGRATION_FILES) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await client.exec(statement);
    }
  }

  return db;
}
