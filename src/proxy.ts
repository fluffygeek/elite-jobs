import { NextResponse } from "next/server";
import { auth } from "../auth";

// Gates every route except the public ones listed in `config.matcher` below.
// A signed-out visitor hitting a protected route (the (dashboard) and
// (intake) surfaces, plus "/") is bounced to /login rather than erroring —
// issue #18's acceptance criterion. Role-specific access (e.g. keeping a
// Technician out of /markets) is a separate, not-yet-built concern; this is
// purely "are you signed in at all".
export default auth((req) => {
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
});

export const config = {
  matcher: [
    "/((?!api/auth|login|invite|manifest\\.webmanifest|serwist|icon\\.svg|favicon\\.ico|_next/static|_next/image).*)",
  ],
};
