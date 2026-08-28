import { describe, expect, it } from "vitest";
import { computeBoreCode } from "./bore-payment-tier";

describe("computeBoreCode", () => {
  it.each([
    [0, "DDB1"],
    [1, "DDB1"],
    [149, "DDB1"],
    [150, "DDB1"],
    [151, "DDB2"],
    [250, "DDB2"],
    [251, "DDB3"],
    [350, "DDB3"],
    [351, "DDB4"],
    [450, "DDB4"],
  ])("%i ft -> %s", (footage, expected) => {
    expect(computeBoreCode(footage)).toBe(expected);
  });

  it("451 ft incurs a 1 ft overage", () => {
    expect(computeBoreCode(451)).toBe("DDB4 DBC1 x 1");
  });

  it("750 ft -> DDB4 DBC1 x 300 (spec example)", () => {
    expect(computeBoreCode(750)).toBe("DDB4 DBC1 x 300");
  });

  it("large overage values scale linearly", () => {
    expect(computeBoreCode(1000)).toBe("DDB4 DBC1 x 550");
  });

  it("rejects negative footage", () => {
    expect(() => computeBoreCode(-1)).toThrow();
  });

  it("rejects non-finite footage", () => {
    expect(() => computeBoreCode(Number.NaN)).toThrow();
    expect(() => computeBoreCode(Number.POSITIVE_INFINITY)).toThrow();
  });
});
