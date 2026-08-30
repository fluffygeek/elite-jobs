import { beforeEach, describe, expect, it, vi } from "vitest";

// Server-Action seam test — mocks the persistence + email layers the same
// way src/app/(dashboard)/invite/actions.test.ts mocks createInvitation and
// sendInvitationEmail. The whole point of this test file is to assert the
// no-enumeration behavior: a known and an unknown email must produce the
// identical returned state.

const getUserByEmailMock = vi.fn();
vi.mock("@/db/queries/users", () => ({
  getUserByEmail: getUserByEmailMock,
}));

const createPasswordResetMock = vi.fn();
vi.mock("@/db/queries/password-resets", () => ({
  createPasswordReset: createPasswordResetMock,
}));

const sendPasswordResetEmailMock = vi.fn();
vi.mock("@/lib/email", () => ({
  sendPasswordResetEmail: sendPasswordResetEmailMock,
}));

const { requestPasswordReset } = await import("./actions");

describe("requestPasswordReset Server Action", () => {
  beforeEach(() => {
    getUserByEmailMock.mockReset();
    createPasswordResetMock.mockReset();
    sendPasswordResetEmailMock.mockReset();
    createPasswordResetMock.mockResolvedValue({
      id: "reset-id",
      token: "token-123",
      userId: "user-id",
    });
  });

  it("creates a reset token and sends an email for a known address", async () => {
    getUserByEmailMock.mockResolvedValue({
      id: "user-id",
      email: "known@example.com",
      role: "technician",
    });

    const formData = new FormData();
    formData.set("email", "known@example.com");

    const result = await requestPasswordReset({ message: null, error: null }, formData);

    expect(createPasswordResetMock).toHaveBeenCalledWith("user-id");
    expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(1);
    expect(result.error).toBeNull();
    expect(result.message).toBeTruthy();
  });

  it("returns the identical message for an unknown address, without creating a token or sending an email", async () => {
    getUserByEmailMock.mockResolvedValue(null);

    const formData = new FormData();
    formData.set("email", "unknown@example.com");

    const result = await requestPasswordReset({ message: null, error: null }, formData);

    expect(createPasswordResetMock).not.toHaveBeenCalled();
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
    expect(result.error).toBeNull();
    expect(result.message).toBeTruthy();
  });

  it("produces the exact same response for a known and an unknown email", async () => {
    getUserByEmailMock.mockResolvedValueOnce({
      id: "user-id",
      email: "known@example.com",
      role: "technician",
    });

    const knownFormData = new FormData();
    knownFormData.set("email", "known@example.com");
    const knownResult = await requestPasswordReset({ message: null, error: null }, knownFormData);

    getUserByEmailMock.mockResolvedValueOnce(null);

    const unknownFormData = new FormData();
    unknownFormData.set("email", "unknown@example.com");
    const unknownResult = await requestPasswordReset({ message: null, error: null }, unknownFormData);

    expect(unknownResult).toEqual(knownResult);
  });

  it("returns an error without touching persistence when the email is missing", async () => {
    const formData = new FormData();

    const result = await requestPasswordReset({ message: null, error: null }, formData);

    expect(result.error).toBeTruthy();
    expect(result.message).toBeNull();
    expect(getUserByEmailMock).not.toHaveBeenCalled();
  });
});
