import bcrypt from "bcryptjs";
import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig } from "next-auth";
import { getUserByEmail } from "@/db/queries/users";

export const authConfig = {
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;

        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const user = await getUserByEmail(email);
        if (!user) {
          return null;
        }

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) {
          return null;
        }

        return { id: user.id, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        // JWT strategy: `token.sub` already carries the user id (set by
        // Auth.js from the `authorize()` return value's `id`), but we mirror
        // it onto `token.id` explicitly since that's what the session
        // callback below reads — relying on `sub` implicitly would be an
        // easy thing to break by accident later.
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as "technician" | "office_staff";
        session.user.id = token.id as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
