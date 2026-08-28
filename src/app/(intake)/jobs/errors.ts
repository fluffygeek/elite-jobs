// Error classes for the Technician job intake surface, kept in a plain
// (non "use server") module. A "use server" file may only export async
// functions — see actions.ts — and this module is transitively imported by
// the client-side new-job-form.tsx (which needs to `instanceof`-check
// against it), so the class can't live inside actions.ts itself.
export class NotAuthorizedError extends Error {
  constructor() {
    super("Only Technicians can submit Jobs");
    this.name = "NotAuthorizedError";
  }
}
