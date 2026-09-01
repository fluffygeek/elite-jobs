import { describe, expect, it } from "vitest";
import { formatAddress } from "./format-address";

describe("formatAddress", () => {
  it("composes street, city, state, and zip", () => {
    expect(
      formatAddress({
        addressStreet: "123 Main St",
        addressLine2: null,
        addressCity: "Savannah",
        addressState: "GA",
        addressZip: "31401",
      }),
    ).toBe("123 Main St, Savannah, GA 31401");
  });

  it("includes Address Line 2 when present", () => {
    expect(
      formatAddress({
        addressStreet: "123 Main St",
        addressLine2: "Apt 4",
        addressCity: "Savannah",
        addressState: "GA",
        addressZip: "31401",
      }),
    ).toBe("123 Main St, Apt 4, Savannah, GA 31401");
  });

  it("omits Zip when absent", () => {
    expect(
      formatAddress({
        addressStreet: "123 Main St",
        addressLine2: null,
        addressCity: "Savannah",
        addressState: "GA",
        addressZip: null,
      }),
    ).toBe("123 Main St, Savannah, GA");
  });

  it("treats an empty-string Line 2/Zip the same as null", () => {
    expect(
      formatAddress({
        addressStreet: "123 Main St",
        addressLine2: "",
        addressCity: "Savannah",
        addressState: "GA",
        addressZip: "",
      }),
    ).toBe("123 Main St, Savannah, GA");
  });
});
