import { describe, expect, it } from "vitest";
import { deriveJobSite, UnparsableAddressError } from "./job-site";

describe("deriveJobSite", () => {
  it.each([
    ["104 E Welwood Dr, Savannah, GA 31419, USA", { state: "GA", zip: "31419" }],
    ["123 Main St, Atlanta, GA 30301", { state: "GA", zip: "30301" }],
    ["456 Oak Ave, Miami, FL 33101", { state: "FL", zip: "33101" }],
    ["789 Pine Rd, Live Oak, FL 32060", { state: "FL", zip: "32060" }],
    ["1600 Pennsylvania Ave NW, Washington, DC 20500", { state: "DC", zip: "20500" }],
    ["100 Peachtree St NE, Atlanta, GA 30303-1234", { state: "GA", zip: "30303" }],
    ["221B Baker St, Springfield, IL 62704, United States", { state: "IL", zip: "62704" }],
    ["55 Main St Savannah GA 31401", { state: "GA", zip: "31401" }],
  ])("parses %s", (address, expected) => {
    expect(deriveJobSite(address)).toEqual(expected);
  });

  it("normalizes a lowercase state abbreviation to uppercase", () => {
    expect(deriveJobSite("104 E Welwood Dr, Savannah, ga 31419")).toEqual({
      state: "GA",
      zip: "31419",
    });
  });

  it("throws UnparsableAddressError when no trailing STATE ZIP is found", () => {
    expect(() => deriveJobSite("104 E Welwood Dr, Savannah")).toThrow(UnparsableAddressError);
  });

  it("throws on an empty address", () => {
    expect(() => deriveJobSite("")).toThrow(UnparsableAddressError);
  });
});
