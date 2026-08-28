import { listMarkets } from "@/db/queries/markets";
import { createMarketAction, renameMarketAction, setMarketActiveAction } from "./actions";

// Minimal Office Staff surface for managing Markets: view all (including
// inactive), add, rename, and toggle active/reactivate. Plain Server
// Components + Server Actions via <form action> — no client-state library,
// no design system (per AGENTS.md's "no premature abstraction" principle).
// Server Action `action` props on <form> must return void | Promise<void>,
// but the action functions themselves return the affected Market (useful for
// the Server Action tests). These thin wrappers discard the return value for
// the form-binding call sites.
async function createMarketFormAction(formData: FormData) {
  await createMarketAction(formData);
}

async function renameMarketFormAction(id: string, formData: FormData) {
  await renameMarketAction(id, formData);
}

async function setMarketActiveFormAction(id: string, active: boolean) {
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
