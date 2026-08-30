import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db";
import { passwordResets, users } from "@/db/schema";

// Accepts any Postgres-backed Drizzle database that was created with this
// project's schema — the real postgres.js singleton in production, or a
// PGlite (in-memory Postgres via WASM) instance in tests. See
// src/db/test-utils.ts for how tests construct one.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, typeof import("@/db/schema")>;

// Reset links are valid for 1 hour, per issue #28's spec — much shorter than
// the 7-day invitation TTL, since this is a "act now while you remember"
// flow rather than an onboarding link someone might get to later.
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export async function createPasswordReset(userId: string, db: Db = defaultDb) {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

  const [passwordReset] = await db
    .insert(passwordResets)
    .values({ userId, token, expiresAt })
    .returning();

  return passwordReset;
}

export async function getPasswordResetByToken(token: string, db: Db = defaultDb) {
  const [passwordReset] = await db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.token, token))
    .limit(1);

  return passwordReset ?? null;
}

export class PasswordResetNotFoundError extends Error {
  constructor() {
    super("Password reset not found");
    this.name = "PasswordResetNotFoundError";
  }
}

export class PasswordResetExpiredError extends Error {
  constructor() {
    super("Password reset link has expired");
    this.name = "PasswordResetExpiredError";
  }
}

export class PasswordResetAlreadyUsedError extends Error {
  constructor() {
    super("Password reset link has already been used");
    this.name = "PasswordResetAlreadyUsedError";
  }
}

export type PasswordResetStatus = "expired" | "used" | "valid";

// Pulled out as its own (non-component) function so the impure Date.now()
// check doesn't live inside a React Server Component's render body — see
// src/app/reset-password/[token]/page.tsx, which is the only caller. Mirrors
// getInvitationStatus in src/db/queries/invitations.ts.
export function getPasswordResetStatus(passwordReset: {
  usedAt: Date | null;
  expiresAt: Date;
}): PasswordResetStatus {
  if (passwordReset.usedAt) {
    return "used";
  }
  if (passwordReset.expiresAt.getTime() < Date.now()) {
    return "expired";
  }
  return "valid";
}

/**
 * Validates the reset token and, if valid, updates the corresponding user's
 * password hash and marks the token used. Throws a specific error subclass
 * so callers (Server Actions, UI) can distinguish "not found" vs "expired"
 * vs "already used" — mirrors acceptInvitation in
 * src/db/queries/invitations.ts.
 */
export async function resetPassword(token: string, newPasswordHash: string, db: Db = defaultDb) {
  const passwordReset = await getPasswordResetByToken(token, db);

  if (!passwordReset) {
    throw new PasswordResetNotFoundError();
  }
  if (passwordReset.usedAt) {
    throw new PasswordResetAlreadyUsedError();
  }
  if (passwordReset.expiresAt.getTime() < Date.now()) {
    throw new PasswordResetExpiredError();
  }

  const [user] = await db
    .update(users)
    .set({ passwordHash: newPasswordHash })
    .where(eq(users.id, passwordReset.userId))
    .returning();

  await db
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(eq(passwordResets.id, passwordReset.id));

  return user;
}
