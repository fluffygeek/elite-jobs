"use client";

import { useState, type FormEvent } from "react";
import { submitPasswordReset } from "./actions";
import styles from "../../login/login.module.css";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    try {
      await submitPasswordReset({ token, password });
      setStatus("success");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong.");
    }
  }

  if (status === "success") {
    return (
      <p role="status">
        Your password has been updated. You can now{" "}
        <a href="/login" className={styles.forgotLink}>
          sign in
        </a>
        .
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form} noValidate>
      {errorMessage ? (
        <p className={styles.error} role="alert">
          {errorMessage}
        </p>
      ) : null}

      <label className={styles.field}>
        <span className={styles.label}>New password</span>
        <input
          className={styles.input}
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={status === "submitting"}
        />
      </label>

      <button className={styles.submit} type="submit" disabled={status === "submitting"}>
        {status === "submitting" ? "Updating…" : "Set new password"}
      </button>
    </form>
  );
}
