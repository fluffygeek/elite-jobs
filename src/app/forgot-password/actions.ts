"use server";

import { z } from "zod";
import { createPasswordReset } from "@/db/queries/password-resets";
import { getUserByEmail } from "@/db/queries/users";
import { sendPasswordResetEmail } from "@/lib/email";
import { env } from "@/lib/env";

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

// Deliberately the same string whether or not the email exists — see issue
// #28. Never let the caller branch on whether the account was found.
const GENERIC_MESSAGE = "If that email has an account, we've sent a reset link.";

export interface ForgotPasswordState {
  message: string | null;
  error: string | null;
}

/**
 * Looks up the given email and, if a matching user exists, creates a
 * password reset token and emails the reset link. Always returns the same
 * generic message regardless of whether the account was found — this is a
 * security requirement (no user enumeration), not optional polish.
 */
export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = formData.get("email");

  if (typeof email !== "string" || !email) {
    return { message: null, error: "Enter your email address." };
  }

  const parsed = forgotPasswordSchema.safeParse({ email });
  if (!parsed.success) {
    return { message: null, error: "Enter a valid email address." };
  }

  const user = await getUserByEmail(parsed.data.email);

  if (user) {
    const passwordReset = await createPasswordReset(user.id);
    const resetUrl = `${env.APP_URL}/reset-password/${passwordReset.token}`;
    await sendPasswordResetEmail(user.email, resetUrl);
  }

  return { message: GENERIC_MESSAGE, error: null };
}
