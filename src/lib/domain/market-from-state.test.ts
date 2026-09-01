import { describe, expect, it } from "vitest";
import { resolveMarketNameForState } from "./market-from-state";

describe("resolveMarketNameForState", () => {
  it("resolves FL to Florida", () => {
    expect(resolveMarketNameForState("FL")).toBe("Florida");
  });

  it("resolves GA to Georgia", () => {
    expect(resolveMarketNameForState("GA")).toBe("Georgia");
  });

  it("resolves an unsupported state to null", () => {
    expect(resolveMarketNameForState("NY")).toBeNull();
    expect(resolveMarketNameForState("DC")).toBeNull();
    expect(resolveMarketNameForState("")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(resolveMarketNameForState("fl")).toBe("Florida");
    expect(resolveMarketNameForState("ga")).toBe("Georgia");
    expect(resolveMarketNameForState("Fl")).toBe("Florida");
  });

  it("trims surrounding whitespace", () => {
    expect(resolveMarketNameForState(" FL ")).toBe("Florida");
  });
});
