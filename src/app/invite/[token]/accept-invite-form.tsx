"use client";

import { useState, type FormEvent } from "react";
import { acceptInvite } from "./actions";

export function AcceptInviteForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    try {
      await acceptInvite({ token, password });
      setStatus("success");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong.");
    }
  }

  if (status === "success") {
    return <p>Your account has been created. You can now sign in.</p>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        minLength={8}
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="submit" disabled={status === "submitting"}>
        {status === "submitting" ? "Creating account…" : "Set password and create account"}
      </button>
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
    </form>
  );
}
