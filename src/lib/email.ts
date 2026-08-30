// TODO: wire to a real email provider, e.g. Resend, once an account exists
// — see docs/architecture.md's "External services" (Resend or equivalent for
// transactional email). No provider account exists yet, so this is a
// placeholder that logs the email instead of sending it. The interface below
// is the seam a real implementation drops into — callers don't need to
// change when that happens.
export async function sendInvitationEmail(email: string, acceptUrl: string): Promise<void> {
  console.log(
    `[email:placeholder] Invitation email to ${email}\n` +
      `Subject: You've been invited to Elite Jobs\n` +
      `Body: Click the link below to accept your invitation and set your password:\n${acceptUrl}`,
  );
}

export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  console.log(
    `[email:placeholder] Password reset email to ${email}\n` +
      `Subject: Reset your Elite Jobs password\n` +
      `Body: Click the link below to set a new password. This link expires in 1 hour:\n${resetUrl}`,
  );
}
