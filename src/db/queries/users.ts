import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db";
import { users } from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, typeof import("@/db/schema")>;

export async function getUserByEmail(email: string, db: Db = defaultDb) {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  return user ?? null;
}
