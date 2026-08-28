import { signOutAction } from "./sign-out-action";
import styles from "./app-bar.module.css";

export function AppBar() {
  return (
    <header className={styles.bar}>
      <span className={styles.mark}>Elite Jobs</span>
      <form action={signOutAction}>
        <button className={styles.signOut} type="submit">
          Sign out
        </button>
      </form>
    </header>
  );
}
