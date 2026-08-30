import { getPasswordResetByToken, getPasswordResetStatus } from "@/db/queries/password-resets";
import { ResetPasswordForm } from "./reset-password-form";
import styles from "../../login/login.module.css";

// Public page — no auth required. The token itself is the credential that
// proves the visitor requested this reset. Mirrors
// src/app/invite/[token]/page.tsx's shape.
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const passwordReset = await getPasswordResetByToken(token);

  if (!passwordReset) {
    return <ResetPasswordError message="This password reset link is invalid." />;
  }

  const status = getPasswordResetStatus(passwordReset);

  if (status === "used") {
    return (
      <ResetPasswordError message="This password reset link has already been used. Request a new one if you still need to reset your password." />
    );
  }

  if (status === "expired") {
    return (
      <ResetPasswordError message="This password reset link has expired. Request a new one to continue." />
    );
  }

  return (
    <div className={styles.screen}>
      <aside className={styles.signal} aria-hidden="true">
        <div className={styles.signalTrack}>
          <div className={styles.signalPulse} />
        </div>
        <p className={styles.signalMark}>Elite Jobs</p>
        <p className={styles.signalLine}>Every job, tracked from the trench to the office.</p>
      </aside>

      <main className={styles.formPane}>
        <div className={styles.formCard}>
          <p className={styles.mobileMark}>Elite Jobs</p>
          <h1 className={styles.heading}>Set a new password</h1>
          <p className={styles.subheading}>Choose a new password for your account.</p>
          <ResetPasswordForm token={token} />
        </div>
      </main>
    </div>
  );
}

function ResetPasswordError({ message }: { message: string }) {
  return (
    <div className={styles.screen}>
      <main className={styles.formPane}>
        <div className={styles.formCard}>
          <p className={styles.mobileMark}>Elite Jobs</p>
          <h1 className={styles.heading}>Reset link error</h1>
          <p className={styles.subheading}>{message}</p>
          <p className={styles.hint}>
            <a href="/forgot-password" className={styles.forgotLink}>
              Request a new reset link
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
