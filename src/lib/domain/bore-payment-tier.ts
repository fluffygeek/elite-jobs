// Bore Payment Tier computation — see CONTEXT.md's "Bore Payment Tier" entry
// and issue #1's spec for the full rule. Pure, framework-free, no I/O: the
// server is the only caller (never trust a client-sent Bore Code — see
// AGENTS.md's ground rules and src/db/schema.ts's comment on `jobs.boreCode`).
//
// Tiers:
//   DDB1: up to 150 ft
//   DDB2: 151-250 ft
//   DDB3: 251-350 ft
//   DDB4: 351-450 ft
// Footage beyond 450 ft additionally incurs a DBC1 overage, expressed as
// `DBC1 x <N>` where N is the footage past 450 (e.g. 750 ft -> "DDB4 DBC1 x 300").
const TIER_CEILING = 450;

export function computeBoreCode(boreFootage: number): string {
  if (!Number.isFinite(boreFootage) || boreFootage < 0) {
    throw new Error(`Bore Footage must be a non-negative number, got ${boreFootage}`);
  }

  const tieredFootage = Math.min(boreFootage, TIER_CEILING);
  const tier = tierFor(tieredFootage);
  const overage = boreFootage - TIER_CEILING;

  if (overage > 0) {
    return `${tier} DBC1 x ${overage}`;
  }

  return tier;
}

function tierFor(footage: number): string {
  if (footage <= 150) return "DDB1";
  if (footage <= 250) return "DDB2";
  if (footage <= 350) return "DDB3";
  return "DDB4";
}
