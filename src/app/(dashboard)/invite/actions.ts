"use server";

import { z } from "zod";
import { auth } from "../../../../auth";
import { createInvitation } from "@/db/queries/invitations";
import { sendInvitationEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { roleEnum } from "@/db/schema";

const sendInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(roleEnum),
});

export class NotAuthorizedError extends Error {
  constructor() {
    super("Only Office Staff can send invitations");
    this.name = "NotAuthorizedError";
  }
}

/**
 * Sends an invitation to join Elite Jobs with the given role. Only callable
 * by an authenticated Office Staff user — gated on the session's role, same
 * as any other Office Staff-only Server Action in the dashboard surface.
 */
export async function sendInvite(input: { email: string; role: string }) {
  const session = await auth();

  if (session?.user?.role !== "office_staff") {
    throw new NotAuthorizedError();
  }

  const { email, role } = sendInviteSchema.parse(input);

  const invitation = await createInvitation(email, role);
  const acceptUrl = `${env.APP_URL}/invite/${invitation.token}`;

  await sendInvitationEmail(email, acceptUrl);

  return { id: invitation.id };
}
