import { describe, expect, it, vi } from "vitest";

// Server-Action seam test for the login flow: mock signIn/auth (from the
// root auth.ts) and redirect (from next/navigation), the same way
// src/app/(dashboard)/jobs/actions.test.ts mocks auth() — exercise the
// real login() function, assert on what it does with each outcome.
//
// Also mocks the "next-auth" package itself, not just the local auth.ts
// wrapper: the real package fails to load under Vitest's Node ESM resolver
// (a next/server subpath resolution mismatch, unrelated to this ticket's
// code — see the CI failure this produced without the mock). AuthError and
// CredentialsSignin are re-implemented minimally here, matching real
// next-auth's shape closely enough for the `instanceof`/`.type` check in
// actions.ts to behave identically.
const { signInMock, authMock, redirectMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  authMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("../../../auth", () => ({
  signIn: signInMock,
  auth: authMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("next-auth", () => {
  class AuthError extends Error {
    type?: string;
  }
  class CredentialsSignin extends AuthError {
    type = "CredentialsSignin";
  }
  return { AuthError, CredentialsSignin };
});

import { CredentialsSignin } from "next-auth";
import { login } from "./actions";

describe("login Server Action", () => {
  it("returns a clear error when credentials are missing", async () => {
    const formData = new FormData();
    formData.set("email", "tech@example.com");

    const result = await login({ error: null }, formData);

    expect(result.error).toBe("Enter your email and password.");
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("returns a clear error when signIn rejects with CredentialsSignin", async () => {
    signInMock.mockRejectedValueOnce(new CredentialsSignin());

    const formData = new FormData();
    formData.set("email", "tech@example.com");
    formData.set("password", "wrong-password");

    const result = await login({ error: null }, formData);

    expect(result.error).toBe("That email or password isn't right. Try again.");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("re-throws a non-credentials error rather than mislabeling it", async () => {
    signInMock.mockRejectedValueOnce(new Error("database is down"));

    const formData = new FormData();
    formData.set("email", "tech@example.com");
    formData.set("password", "correct-password");

    await expect(login({ error: null }, formData)).rejects.toThrow("database is down");
  });

  it("redirects a Technician to the intake form on success", async () => {
    signInMock.mockResolvedValueOnce(undefined);
    authMock.mockResolvedValueOnce({ user: { role: "technician" } });

    const formData = new FormData();
    formData.set("email", "tech@example.com");
    formData.set("password", "correct-password");

    await login({ error: null }, formData);

    expect(redirectMock).toHaveBeenCalledWith("/jobs/new");
  });

  it("redirects Office Staff to the dashboard on success", async () => {
    signInMock.mockResolvedValueOnce(undefined);
    authMock.mockResolvedValueOnce({ user: { role: "office_staff" } });

    const formData = new FormData();
    formData.set("email", "staff@example.com");
    formData.set("password", "correct-password");

    await login({ error: null }, formData);

    expect(redirectMock).toHaveBeenCalledWith("/jobs");
  });
});
