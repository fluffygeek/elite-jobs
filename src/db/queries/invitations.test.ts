import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/test-utils";
import {
  acceptInvitation,
  createInvitation,
  getInvitationByToken,
  InvitationAlreadyAcceptedError,
  InvitationExpiredError,
  InvitationNotFoundError,
} from "@/db/queries/invitations";
import { invitations } from "@/db/schema";
import { eq } from "drizzle-orm";

describe("invitations persistence", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("creates an invitation with a token and expiry", async () => {
    const invitation = await createInvitation("tech@example.com", "technician", db);

    expect(invitation.email).toBe("tech@example.com");
    expect(invitation.role).toBe("technician");
    expect(invitation.token).toBeTruthy();
    expect(invitation.acceptedAt).toBeNull();
    expect(invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("looks up an invitation by token", async () => {
    const created = await createInvitation("staff@example.com", "office_staff", db);

    const found = await getInvitationByToken(created.token, db);

    expect(found?.id).toBe(created.id);
  });

  it("accepts a valid invitation and creates a user with the invited role", async () => {
    const invitation = await createInvitation("newtech@example.com", "technician", db);

    const user = await acceptInvitation(invitation.token, "some-hash", db);

    expect(user.email).toBe("newtech@example.com");
    expect(user.role).toBe("technician");
    expect(user.passwordHash).toBe("some-hash");

    const [updated] = await db.select().from(invitations).where(eq(invitations.id, invitation.id));
    expect(updated.acceptedAt).not.toBeNull();
  });

  it("rejects an unknown token", async () => {
    await expect(acceptInvitation("not-a-real-token", "hash", db)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
  });

  it("rejects an expired token", async () => {
    const invitation = await createInvitation("expired@example.com", "office_staff", db);
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, invitation.id));

    await expect(acceptInvitation(invitation.token, "hash", db)).rejects.toBeInstanceOf(
      InvitationExpiredError,
    );
  });

  it("rejects an already-accepted token", async () => {
    const invitation = await createInvitation("dup@example.com", "technician", db);
    await acceptInvitation(invitation.token, "hash-1", db);

    await expect(acceptInvitation(invitation.token, "hash-2", db)).rejects.toBeInstanceOf(
      InvitationAlreadyAcceptedError,
    );
  });
});
