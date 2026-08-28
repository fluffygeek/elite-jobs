"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { auth, signIn } from "../../../auth";
import { homePathForRole } from "@/auth/redirect";

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
  // so the actual navigation happens here, after the session cookie is set.
  const session = await auth();
  redirect(homePathForRole(session!.user.role));
}
