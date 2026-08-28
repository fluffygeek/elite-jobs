import { describe, expect, it } from "vitest";
import { findDuplicateHintIds } from "./duplicate-hint";

describe("findDuplicateHintIds", () => {
  it("flags two Jobs that share the same Address and Date", () => {
    const result = findDuplicateHintIds([
      { id: "a", address: "104 E Welwood Dr, Savannah, GA 31419, USA", date: new Date("2026-01-15") },
      { id: "b", address: "104 E Welwood Dr, Savannah, GA 31419, USA", date: new Date("2026-01-15") },
    ]);

    expect(result).toEqual(new Set(["a", "b"]));
  });

  it("does not flag Jobs with the same address but a different date", () => {
    const result = findDuplicateHintIds([
      { id: "a", address: "104 E Welwood Dr, Savannah, GA 31419, USA", date: new Date("2026-01-15") },
      { id: "b", address: "104 E Welwood Dr, Savannah, GA 31419, USA", date: new Date("2026-01-16") },
    ]);

    expect(result.size).toBe(0);
  });

  it("does not flag Jobs with the same date but a different address", () => {
    const result = findDuplicateHintIds([
      { id: "a", address: "104 E Welwood Dr, Savannah, GA 31419, USA", date: new Date("2026-01-15") },
      { id: "b", address: "200 Peachtree St, Atlanta, GA 30303, USA", date: new Date("2026-01-15") },
    ]);

    expect(result.size).toBe(0);
  });

  it("is insensitive to address casing and surrounding whitespace", () => {
    const result = findDuplicateHintIds([
      { id: "a", address: "104 E Welwood Dr, Savannah, GA 31419, USA", date: new Date("2026-01-15") },
      { id: "b", address: "  104 e welwood dr, savannah, ga 31419, usa  ", date: new Date("2026-01-15") },
    ]);

    expect(result).toEqual(new Set(["a", "b"]));
  });

  it("flags all members of a group larger than two", () => {
    const shared = { address: "104 E Welwood Dr, Savannah, GA 31419, USA", date: new Date("2026-01-15") };
    const result = findDuplicateHintIds([
      { id: "a", ...shared },
      { id: "b", ...shared },
      { id: "c", ...shared },
      { id: "d", address: "Somewhere else, GA 30303, USA", date: new Date("2026-01-15") },
    ]);

    expect(result).toEqual(new Set(["a", "b", "c"]));
  });

  it("does not flag a Job that has no match", () => {
    const result = findDuplicateHintIds([
      { id: "a", address: "104 E Welwood Dr, Savannah, GA 31419, USA", date: new Date("2026-01-15") },
    ]);

    expect(result.size).toBe(0);
  });

  it("returns an empty set for an empty list", () => {
    expect(findDuplicateHintIds([]).size).toBe(0);
  });
});
