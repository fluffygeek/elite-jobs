import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit tests for the UI-edge glue extracted from page.tsx (issue #24):
// parseFieldValue's raw-string-to-typed-value conversion, and
// submitFieldEdit's dispatch to updateJobFieldAction + redirect on each
// outcome. Mocks updateJobFieldAction and next/navigation's redirect the
// same way src/app/login/actions.test.ts mocks redirect — this module's own
// logic is what's under test, not the real DB-backed action (that's covered
// by actions.test.ts) or a live Next.js request scope.
const { updateJobFieldActionMock, redirectMock } = vi.hoisted(() => ({
  updateJobFieldActionMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("./actions", () => ({
  updateJobFieldAction: updateJobFieldActionMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import { parseFieldValue, submitFieldEdit } from "./edit-field";

describe("parseFieldValue", () => {
  it("parses a string field (e.g. address) as-is", () => {
    expect(parseFieldValue("address", "123 Main St")).toBe("123 Main St");
  });

  it("parses techNotes as-is", () => {
    expect(parseFieldValue("techNotes", "Left note on door")).toBe("Left note on door");
  });

  it("parses a number field (fiberFootage) from its raw string", () => {
    expect(parseFieldValue("fiberFootage", "250")).toBe(250);
  });

  it("parses a number field (boreFootage) from its raw string", () => {
    expect(parseFieldValue("boreFootage", "100")).toBe(100);
  });

  it("parses a boolean field (locate) from its raw string", () => {
    expect(parseFieldValue("locate", "true")).toBe(true);
    expect(parseFieldValue("locate", "false")).toBe(false);
  });

  it("parses a boolean field (directionalBore) from its raw string", () => {
    expect(parseFieldValue("directionalBore", "true")).toBe(true);
    expect(parseFieldValue("directionalBore", "false")).toBe(false);
  });

  it("parses a boolean field (prebury) from its raw string", () => {
    expect(parseFieldValue("prebury", "true")).toBe(true);
    expect(parseFieldValue("prebury", "false")).toBe(false);
  });

  it("parses a boolean field (discrepancyFlag) from its raw string", () => {
    expect(parseFieldValue("discrepancyFlag", "true")).toBe(true);
    expect(parseFieldValue("discrepancyFlag", "false")).toBe(false);
  });

  it("parses a boolean field (closedOut) from its raw string", () => {
    expect(parseFieldValue("closedOut", "true")).toBe(true);
    expect(parseFieldValue("closedOut", "false")).toBe(false);
  });

  it("parses the fiberCode enum field as-is", () => {
    expect(parseFieldValue("fiberCode", "CP")).toBe("CP");
    expect(parseFieldValue("fiberCode", "DDB")).toBe("DDB");
  });
});

describe("submitFieldEdit", () => {
  const formDataWithNewValue = (value: string) => {
    const formData = new FormData();
    formData.set("newValue", value);
    return formData;
  };

  beforeEach(() => {
    updateJobFieldActionMock.mockReset();
    redirectMock.mockReset();
  });

  it("redirects with a success notice when the update succeeds", async () => {
    updateJobFieldActionMock.mockResolvedValueOnce({
      status: "success",
      job: { id: "job-1" },
    });

    await submitFieldEdit("job-1", "techNotes", "Old note", formDataWithNewValue("New note"));

    expect(updateJobFieldActionMock).toHaveBeenCalledWith(
      "job-1",
      "techNotes",
      "Old note",
      "New note",
    );
    expect(redirectMock).toHaveBeenCalledWith(
      `/jobs?notice=${encodeURIComponent("techNotes updated")}`,
    );
  });

  it("redirects with an error notice when the update conflicts", async () => {
    updateJobFieldActionMock.mockResolvedValueOnce({
      status: "conflict",
      message: "This field changed, reload and try again.",
    });

    await submitFieldEdit("job-1", "techNotes", "Old note", formDataWithNewValue("New note"));

    expect(redirectMock).toHaveBeenCalledWith(
      `/jobs?notice=${encodeURIComponent("This field changed, reload and try again.")}&error=1`,
    );
  });

  it("redirects with an error notice when the job is not found", async () => {
    updateJobFieldActionMock.mockResolvedValueOnce({
      status: "not_found",
      message: "This job no longer exists.",
    });

    await submitFieldEdit("job-1", "techNotes", "Old note", formDataWithNewValue("New note"));

    expect(redirectMock).toHaveBeenCalledWith(
      `/jobs?notice=${encodeURIComponent("This job no longer exists.")}&error=1`,
    );
  });

  it("parses raw form values before dispatching to updateJobFieldAction (number field)", async () => {
    updateJobFieldActionMock.mockResolvedValueOnce({
      status: "success",
      job: { id: "job-1" },
    });

    await submitFieldEdit("job-1", "fiberFootage", "200", formDataWithNewValue("250"));

    expect(updateJobFieldActionMock).toHaveBeenCalledWith("job-1", "fiberFootage", 200, 250);
  });

  it("parses raw form values before dispatching to updateJobFieldAction (boolean field)", async () => {
    updateJobFieldActionMock.mockResolvedValueOnce({
      status: "success",
      job: { id: "job-1" },
    });

    await submitFieldEdit("job-1", "closedOut", "false", formDataWithNewValue("true"));

    expect(updateJobFieldActionMock).toHaveBeenCalledWith("job-1", "closedOut", false, true);
  });
});
