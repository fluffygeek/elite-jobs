// Market derivation from State — see CONTEXT.md's "Market" entry and issue
// #33's spec. Exactly two Markets are ever derived this way: Florida and
// Georgia. Pure, framework-free, no I/O — the caller (src/db/queries/jobs.ts's
// createJob) is responsible for looking up the actual Market row by the name
// this returns, and for rejecting a State this resolves to `null`.
const STATE_TO_MARKET_NAME: Record<string, "Florida" | "Georgia"> = {
  FL: "Florida",
  GA: "Georgia",
};

export function resolveMarketNameForState(state: string): "Florida" | "Georgia" | null {
  const normalized = state.trim().toUpperCase();
  return STATE_TO_MARKET_NAME[normalized] ?? null;
}
