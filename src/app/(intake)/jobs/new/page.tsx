import { fiberCodeEnum } from "@/db/schema";
import { NewJobForm } from "./new-job-form";

// No DB reachable at build time to statically prerender against — same
// reasoning as src/app/(dashboard)/markets/page.tsx. (Market is no longer
// selected here at all — see issue #33: it's derived server-side from the
// submitted State, so this page has nothing to fetch for it.)
export const dynamic = "force-dynamic";

export default function NewJobPage() {
  return (
    <main className="intake-form-page">
      <h1>New Job</h1>
      <NewJobForm fiberCodes={fiberCodeEnum} />
    </main>
  );
}
