import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig } from "next-auth";

// Credential verification against the users table lands in ticket #4
// (account provisioning via email invite) — this is the base plumbing only.
export const authConfig = {
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async () => {
        throw new Error("Credential verification not implemented yet — see issue #4");
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as "technician" | "office_staff";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
