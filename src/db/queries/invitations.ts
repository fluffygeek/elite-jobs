import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { db as defaultDb } from "@/db";
import { invitations, users, type Role } from "@/db/schema";

// Accepts any Postgres-backed Drizzle database that was created with this
// project's schema — the real postgres.js singleton in production, or a
// PGlite (in-memory Postgres via WASM) instance in tests. See
// src/db/test-utils.ts for how tests construct one.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, typeof import("@/db/schema")>;

// Invite links are valid for 7 days. Not specified anywhere in the ticket or
// architecture doc — chosen as a reasonable default for an internal-staff
// invite flow (long enough that someone doesn't miss it on a day off, short
// enough that a stale unused invite doesn't linger indefinitely).
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createInvitation(email: string, role: Role, db: Db = defaultDb) {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const [invitation] = await db
    .insert(invitations)
    .values({ email, role, token, expiresAt })
    .returning();

  return invitation;
}

export async function getInvitationByToken(token: string, db: Db = defaultDb) {
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.token, token))
    .limit(1);

  return invitation ?? null;
}

export class InvitationNotFoundError extends Error {
  constructor() {
    super("Invitation not found");
    this.name = "InvitationNotFoundError";
  }
}

export class InvitationExpiredError extends Error {
  constructor() {
    super("Invitation has expired");
    this.name = "InvitationExpiredError";
  }
}

export class InvitationAlreadyAcceptedError extends Error {
  constructor() {
    super("Invitation has already been accepted");
    this.name = "InvitationAlreadyAcceptedError";
  }
}

/**
 * Validates the invitation token and, if valid, creates the corresponding
 * user account with the given password hash. Throws a specific error
 * subclass so callers (Server Actions, UI) can distinguish "not found" vs
 * "expired" vs "already accepted".
 */
export type InvitationStatus = "expired" | "accepted" | "valid";

// Pulled out as its own (non-component) function so the impure Date.now()
// check doesn't live inside a React Server Component's render body — see
// src/app/invite/[token]/page.tsx, which is the only caller.
export function getInvitationStatus(invitation: {
  acceptedAt: Date | null;
  expiresAt: Date;
}): InvitationStatus {
  if (invitation.acceptedAt) {
    return "accepted";
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    return "expired";
  }
  return "valid";
}

export async function acceptInvitation(token: string, passwordHash: string, db: Db = defaultDb) {
  const invitation = await getInvitationByToken(token, db);

  if (!invitation) {
    throw new InvitationNotFoundError();
  }
  if (invitation.acceptedAt) {
    throw new InvitationAlreadyAcceptedError();
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    throw new InvitationExpiredError();
  }

  const [user] = await db
    .insert(users)
    .values({ email: invitation.email, role: invitation.role, passwordHash })
    .returning();

  await db.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invitation.id));

  return user;
}
