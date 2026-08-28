import { redirect } from "next/navigation";
import { auth } from "../../../auth";
import { homePathForRole } from "@/auth/redirect";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) {
    redirect(homePathForRole(session.user.role));
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
          <h1 className={styles.heading}>Sign in</h1>
          <p className={styles.subheading}>Use the email and password from your invite.</p>
          <LoginForm />
        </div>
      </main>
    </div>
  );
}
