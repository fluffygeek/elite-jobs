import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/test-utils";
import {
  createMarket,
  listActiveMarkets,
  listMarkets,
  renameMarket,
  setMarketActive,
} from "./markets";

// Persistence-seam tests: exercise the query functions against a real
// (PGlite) Postgres instance — see src/db/test-utils.ts for why PGlite.
describe("markets queries", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("creates a market", async () => {
    const market = await createMarket("Live Oak", db);
    expect(market.name).toBe("Live Oak");
    expect(market.active).toBe(true);
    expect(market.id).toBeDefined();
  });

  it("lists all markets including inactive ones", async () => {
    await createMarket("Florida", db);
    const georgia = await createMarket("Georgia", db);
    await setMarketActive(georgia.id, false, db);

    const all = await listMarkets(db);
    expect(all.map((m) => m.name).sort()).toEqual(["Florida", "Georgia"]);
    expect(all.find((m) => m.name === "Georgia")?.active).toBe(false);
  });

  it("listActiveMarkets filters out inactive markets", async () => {
    await createMarket("Florida", db);
    const georgia = await createMarket("Georgia", db);
    await setMarketActive(georgia.id, false, db);

    const active = await listActiveMarkets(db);
    expect(active.map((m) => m.name)).toEqual(["Florida"]);
  });

  it("renames a market", async () => {
    const market = await createMarket("Flordia", db);
    const renamed = await renameMarket(market.id, "Florida", db);
    expect(renamed.name).toBe("Florida");

    const all = await listMarkets(db);
    expect(all[0]?.name).toBe("Florida");
  });

  it("deactivates and reactivates a market", async () => {
    const market = await createMarket("Georgia", db);

    const deactivated = await setMarketActive(market.id, false, db);
    expect(deactivated.active).toBe(false);

    const reactivated = await setMarketActive(market.id, true, db);
    expect(reactivated.active).toBe(true);
  });
});
