"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { resetPassword } from "@/db/queries/password-resets";

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Matches src/app/invite/[token]/actions.ts's salt rounds.
const SALT_ROUNDS = 10;

export async function submitPasswordReset(input: { token: string; password: string }) {
  const { token, password } = resetSchema.parse(input);

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await resetPassword(token, passwordHash);

  return { id: user.id, email: user.email };
}
