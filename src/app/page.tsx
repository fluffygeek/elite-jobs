import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { homePathForRole } from "@/auth/redirect";

// Middleware already sends signed-out visitors to /login before this ever
// renders (see src/middleware.ts) — this page only ever runs for a session,
// and its only job is routing that session to the right home screen.
export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  redirect(homePathForRole(session.user.role));
}
