import { config } from "dotenv";

// Loads DATABASE_URL/AUTH_SECRET/etc for tests. Only src/lib/env.ts's parse
// at module-load time needs these to not throw — the actual persistence
// tests use PGlite (see src/db/test-utils.ts), not this connection string.
config({ path: ".env.local" });
