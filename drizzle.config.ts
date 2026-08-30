import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Plain "dotenv/config" only loads .env, not .env.local — the file every
// other part of this app (and `vercel env pull`) actually writes to.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
