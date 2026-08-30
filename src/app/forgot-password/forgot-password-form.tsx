"use client";

import { useActionState } from "react";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";
import styles from "../login/login.module.css";

const initialState: ForgotPasswordState = { message: null, error: null };

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  if (state.message) {
    return <p role="status">{state.message}</p>;
  }

  return (
    <form action={formAction} className={styles.form} noValidate>
      {state.error ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}

      <label className={styles.field}>
        <span className={styles.label}>Email</span>
        <input
          className={styles.input}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          disabled={pending}
        />
      </label>

      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </button>

      <p className={styles.hint}>
        <a href="/login" className={styles.forgotLink}>
          Back to sign in
        </a>
      </p>
    </form>
  );
}
