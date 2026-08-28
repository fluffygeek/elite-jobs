import type { Role } from "@/db/schema";

// Where a signed-in user lands right after auth resolves — used by both the
// root page (post-login landing) and the login page (bounce an
// already-signed-in visitor away from the form instead of showing it again).
export function homePathForRole(role: Role): string {
  return role === "technician" ? "/jobs/new" : "/jobs";
}
