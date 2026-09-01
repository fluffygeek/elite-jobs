"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "../../../auth";

export interface LoginState {
  error: string | null;
}

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return { error: "Enter your email and password." };
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    // AuthError.type "CredentialsSignin" is what authorize() returning null
    // surfaces as — a wrong email or password. Anything else is a real
    // failure (a downed database, a config error) and should propagate, not
    // get mislabeled as "wrong password".
    if (error instanceof AuthError && error.type === "CredentialsSignin") {
      return { error: "That email or password isn't right. Try again." };
    }
    throw error;
  }

  // signIn(..., { redirect: false }) doesn't throw Next's redirect signal,
  // so the actual navigation happens here. Deliberately redirect to "/"
  // rather than calling auth() again in this same action to resolve the
  // role ourselves: the session cookie signIn() just set isn't reliably
  // visible to auth() within the same request/action (a known Auth.js
  // timing gotcha — it showed up as a real production crash, not a
  // hypothetical). "/" already does its own fresh-request role lookup
  // (src/app/page.tsx), where the cookie is guaranteed to be present.
  redirect("/");
}
