import { listActiveMarkets } from "@/db/queries/markets";
import { fiberCodeEnum } from "@/db/schema";
import { NewJobForm } from "./new-job-form";

// Always reflect the current active Market list (and there's no DB reachable
// at build time to statically prerender against — same reasoning as
// src/app/(dashboard)/markets/page.tsx).
export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  const markets = await listActiveMarkets();

  return (
    <main className="intake-form-page">
      <h1>New Job</h1>
      <NewJobForm markets={markets} fiberCodes={fiberCodeEnum} />
    </main>
  );
}
