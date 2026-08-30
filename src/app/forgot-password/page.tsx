import { ForgotPasswordForm } from "./forgot-password-form";
import styles from "../login/login.module.css";

// Public page — no auth required, mirrors src/app/login/page.tsx's layout.
export default function ForgotPasswordPage() {
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
          <h1 className={styles.heading}>Forgot password?</h1>
          <p className={styles.subheading}>
            Enter the email on your account and we&apos;ll send you a link to reset your password.
          </p>
          <ForgotPasswordForm />
        </div>
      </main>
    </div>
  );
}
