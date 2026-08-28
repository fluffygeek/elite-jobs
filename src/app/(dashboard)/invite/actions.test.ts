import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
vi.mock("../../../../auth", () => ({
  auth: authMock,
}));

const createInvitationMock = vi.fn();
vi.mock("@/db/queries/invitations", () => ({
  createInvitation: createInvitationMock,
}));

const sendInvitationEmailMock = vi.fn();
vi.mock("@/lib/email", () => ({
  sendInvitationEmail: sendInvitationEmailMock,
}));

const { sendInvite, NotAuthorizedError } = await import("./actions");

describe("sendInvite Server Action role gate", () => {
  beforeEach(() => {
    authMock.mockReset();
    createInvitationMock.mockReset();
    sendInvitationEmailMock.mockReset();
    createInvitationMock.mockResolvedValue({
      id: "invitation-id",
      token: "token-123",
      email: "invitee@example.com",
      role: "technician",
    });
  });

  it("allows an office_staff session to send an invite", async () => {
    authMock.mockResolvedValue({ user: { role: "office_staff" } });

    const result = await sendInvite({ email: "invitee@example.com", role: "technician" });

    expect(result).toEqual({ id: "invitation-id" });
    expect(createInvitationMock).toHaveBeenCalledWith("invitee@example.com", "technician");
    expect(sendInvitationEmailMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a technician session", async () => {
    authMock.mockResolvedValue({ user: { role: "technician" } });

    await expect(sendInvite({ email: "invitee@example.com", role: "technician" })).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
    expect(createInvitationMock).not.toHaveBeenCalled();
  });

  it("rejects when there is no session", async () => {
    authMock.mockResolvedValue(null);

    await expect(sendInvite({ email: "invitee@example.com", role: "technician" })).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
    expect(createInvitationMock).not.toHaveBeenCalled();
  });
});
