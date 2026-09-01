import { listMarkets } from "@/db/queries/markets";
import { createMarketAction, renameMarketAction, setMarketActiveAction } from "./actions";

// Minimal Office Staff surface for managing Markets: view all (including
// inactive), add, rename, and toggle active/reactivate. Plain Server
// Components + Server Actions via <form action> — no client-state library,
// no design system (per AGENTS.md's "no premature abstraction" principle).
//
// These wrappers exist for two reasons: <form action> needs a function that
// returns void | Promise<void>, but the underlying actions return the
// affected Market (useful for their own tests); and — the part that was
// actually broken (issue #37) — a plain local function in a Server
// Component file is NOT a real Server Action just because the file renders
// on the server. Next.js only treats a function as a serializable Server
// Action reference if it's exported from a "use server" file, or (as here)
// carries its own inline "use server" directive. Without that, passing the
// bound function to <form action> throws at runtime: "Functions cannot be
// passed directly to Client Components unless you explicitly expose it by
// marking it with 'use server'" — caught by actually clicking these buttons
// in a browser, not by the existing tests, which only call the underlying
// actions.ts functions directly and never exercise this form-binding path.
async function createMarketFormAction(formData: FormData) {
  "use server";
  await createMarketAction(formData);
}

async function renameMarketFormAction(id: string, formData: FormData) {
  "use server";
  await renameMarketAction(id, formData);
}

async function setMarketActiveFormAction(id: string, active: boolean) {
  "use server";
  await setMarketActiveAction(id, active);
}

// Always reflect current data (and there's no DB reachable at build time to
// statically prerender against, since none is provisioned yet).
export const dynamic = "force-dynamic";

export default async function MarketsPage() {
  const markets = await listMarkets();

  return (
    <main>
      <h1>Markets</h1>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Rename</th>
            <th>Deactivate/Reactivate</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((market) => (
            <tr key={market.id}>
              <td>{market.name}</td>
              <td>{market.active ? "Active" : "Inactive"}</td>
              <td>
                <form action={renameMarketFormAction.bind(null, market.id)}>
                  <input type="text" name="name" defaultValue={market.name} required />
                  <button type="submit">Rename</button>
                </form>
              </td>
              <td>
                <form
                  action={setMarketActiveFormAction.bind(null, market.id, !market.active)}
                >
                  <button type="submit">{market.active ? "Deactivate" : "Reactivate"}</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Add Market</h2>
      <form action={createMarketFormAction}>
        <input type="text" name="name" placeholder="Market name" required />
        <button type="submit">Add Market</button>
      </form>
    </main>
  );
}
