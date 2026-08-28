"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { acceptInvitation } from "@/db/queries/invitations";

const acceptSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const SALT_ROUNDS = 10;

export async function acceptInvite(input: { token: string; password: string }) {
  const { token, password } = acceptSchema.parse(input);

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await acceptInvitation(token, passwordHash);

  return { id: user.id, email: user.email, role: user.role };
}
