import { beforeEach, describe, expect, it, vi } from "vitest";

// Server-Action seam tests: mock `auth()` (from the root auth.ts) to exercise
// the office_staff role gate, but exercise the real query layer against a
// PGlite (real Postgres, WASM) database — see src/db/test-utils.ts. We mock
// "@/db" (the postgres.js connection singleton), not the query functions
// themselves, so that the query layer under src/db/queries/markets.ts runs
// unmocked against the PGlite instance instead of trying to open a real
// postgres.js connection (no DATABASE_URL is configured in this test env).
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("../../../../auth", () => ({
  auth: authMock,
}));

// revalidatePath requires a live Next.js request/render scope that doesn't
// exist in a unit test — stub it out; it's a cache-invalidation side effect,
// not behavior this seam's tests are asserting on.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/db/test-utils");
  const db = await createTestDb();
  return { db };
});

import { listMarkets } from "@/db/queries/markets";
import { createMarketAction, renameMarketAction, setMarketActiveAction } from "./actions";

function officeStaffSession() {
  return { user: { role: "office_staff" } };
}

function technicianSession() {
  return { user: { role: "technician" } };
}

describe("markets Server Actions", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("allows an office_staff session to create a market", async () => {
    authMock.mockResolvedValue(officeStaffSession());

    const formData = new FormData();
    formData.set("name", "Live Oak");
    const market = await createMarketAction(formData);

    expect(market.name).toBe("Live Oak");
    const all = await listMarkets();
    expect(all.some((m) => m.name === "Live Oak")).toBe(true);
  });

  it("rejects a technician session", async () => {
    authMock.mockResolvedValue(technicianSession());

    const formData = new FormData();
    formData.set("name", "Nope");
    await expect(createMarketAction(formData)).rejects.toThrow(/office staff only/i);
  });

  it("rejects when there is no session", async () => {
    authMock.mockResolvedValue(null);

    const formData = new FormData();
    formData.set("name", "Nope");
    await expect(createMarketAction(formData)).rejects.toThrow(/office staff only/i);
  });

  it("allows an office_staff session to rename a market", async () => {
    authMock.mockResolvedValue(officeStaffSession());

    const created = await createMarketAction((() => {
      const fd = new FormData();
      fd.set("name", "Flordia");
      return fd;
    })());

    const renameForm = new FormData();
    renameForm.set("name", "Florida");
    const renamed = await renameMarketAction(created.id, renameForm);
    expect(renamed.name).toBe("Florida");
  });

  it("rejects a technician session trying to rename", async () => {
    authMock.mockResolvedValue(officeStaffSession());
    const created = await createMarketAction((() => {
      const fd = new FormData();
      fd.set("name", "Georgia");
      return fd;
    })());

    authMock.mockResolvedValue(technicianSession());
    const renameForm = new FormData();
    renameForm.set("name", "Should Not Apply");
    await expect(renameMarketAction(created.id, renameForm)).rejects.toThrow(
      /office staff only/i,
    );
  });

  it("allows an office_staff session to deactivate and reactivate a market", async () => {
    authMock.mockResolvedValue(officeStaffSession());
    const created = await createMarketAction((() => {
      const fd = new FormData();
      fd.set("name", "Georgia");
      return fd;
    })());

    const deactivated = await setMarketActiveAction(created.id, false);
    expect(deactivated.active).toBe(false);

    const reactivated = await setMarketActiveAction(created.id, true);
    expect(reactivated.active).toBe(true);
  });

  it("rejects a technician session trying to deactivate", async () => {
    authMock.mockResolvedValue(officeStaffSession());
    const created = await createMarketAction((() => {
      const fd = new FormData();
      fd.set("name", "Florida");
      return fd;
    })());

    authMock.mockResolvedValue(technicianSession());
    await expect(setMarketActiveAction(created.id, false)).rejects.toThrow(
      /office staff only/i,
    );
  });
});
