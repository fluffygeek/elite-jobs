import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // Dummy values so src/lib/env.ts's Zod validation passes when a module
    // under test transitively imports src/db/index.ts (e.g. for its type,
    // or as the default `db` param) — no real DB/auth is ever hit in tests
    // since queries always receive an explicit PGlite `db` in tests, and
    // src/app/(dashboard)/markets/actions.test.ts mocks "@/db" and auth.ts.
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      AUTH_SECRET: "test-secret",
    },
  },
});
