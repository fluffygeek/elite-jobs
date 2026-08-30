import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/test-utils";
import {
  createPasswordReset,
  getPasswordResetByToken,
  PasswordResetAlreadyUsedError,
  PasswordResetExpiredError,
  PasswordResetNotFoundError,
  resetPassword,
} from "@/db/queries/password-resets";
import { passwordResets, users } from "@/db/schema";

async function createTestUser(db: TestDb, email: string, passwordHash = "old-hash") {
  const [user] = await db
    .insert(users)
    .values({ email, role: "technician", passwordHash })
    .returning();
  return user;
}

describe("password resets persistence", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("creates a password reset with a token and a 1-hour expiry", async () => {
    const user = await createTestUser(db, "tech@example.com");

    const before = Date.now();
    const passwordReset = await createPasswordReset(user.id, db);
    const after = Date.now();

    expect(passwordReset.userId).toBe(user.id);
    expect(passwordReset.token).toBeTruthy();
    expect(passwordReset.usedAt).toBeNull();
    expect(passwordReset.expiresAt.getTime()).toBeGreaterThan(before + 59 * 60 * 1000);
    expect(passwordReset.expiresAt.getTime()).toBeLessThanOrEqual(after + 61 * 60 * 1000);
  });

  it("looks up a password reset by token", async () => {
    const user = await createTestUser(db, "staff@example.com");
    const created = await createPasswordReset(user.id, db);

    const found = await getPasswordResetByToken(created.token, db);

    expect(found?.id).toBe(created.id);
  });

  it("resets the password for a valid token, and the new password authenticates while the old one doesn't", async () => {
    const oldHash = await bcrypt.hash("old-password", 10);
    const user = await createTestUser(db, "reset-me@example.com", oldHash);
    const passwordReset = await createPasswordReset(user.id, db);

    const newHash = await bcrypt.hash("brand-new-password", 10);
    const updatedUser = await resetPassword(passwordReset.token, newHash, db);

    expect(updatedUser.passwordHash).toBe(newHash);

    const [persisted] = await db.select().from(users).where(eq(users.id, user.id));
    expect(await bcrypt.compare("brand-new-password", persisted.passwordHash)).toBe(true);
    expect(await bcrypt.compare("old-password", persisted.passwordHash)).toBe(false);

    const [usedReset] = await db
      .select()
      .from(passwordResets)
      .where(eq(passwordResets.id, passwordReset.id));
    expect(usedReset.usedAt).not.toBeNull();
  });

  it("rejects an unknown token", async () => {
    await expect(resetPassword("not-a-real-token", "hash", db)).rejects.toBeInstanceOf(
      PasswordResetNotFoundError,
    );
  });

  it("rejects an expired token", async () => {
    const user = await createTestUser(db, "expired@example.com");
    const passwordReset = await createPasswordReset(user.id, db);
    await db
      .update(passwordResets)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(passwordResets.id, passwordReset.id));

    await expect(resetPassword(passwordReset.token, "hash", db)).rejects.toBeInstanceOf(
      PasswordResetExpiredError,
    );
  });

  it("rejects an already-used token, so it can only be used once", async () => {
    const user = await createTestUser(db, "dup@example.com");
    const passwordReset = await createPasswordReset(user.id, db);
    await resetPassword(passwordReset.token, "hash-1", db);

    await expect(resetPassword(passwordReset.token, "hash-2", db)).rejects.toBeInstanceOf(
      PasswordResetAlreadyUsedError,
    );
  });
});
