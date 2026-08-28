import { getInvitationByToken, getInvitationStatus } from "@/db/queries/invitations";
import { AcceptInviteForm } from "./accept-invite-form";

// Public page — no auth required. The token itself is the credential that
// proves the visitor is the invitee.
export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await getInvitationByToken(token);

  if (!invitation) {
    return <InviteError message="This invitation link is invalid." />;
  }

  const status = getInvitationStatus(invitation);

  if (status === "accepted") {
    return <InviteError message="This invitation has already been accepted. Please sign in instead." />;
  }

  if (status === "expired") {
    return <InviteError message="This invitation has expired. Ask an Office Staff member to send a new one." />;
  }

  return (
    <main>
      <h1>Accept your invitation</h1>
      <p>
        You&apos;ve been invited to join Elite Jobs as {invitation.role === "office_staff" ? "Office Staff" : "a Technician"} (
        {invitation.email}). Set a password to create your account.
      </p>
      <AcceptInviteForm token={token} />
    </main>
  );
}

function InviteError({ message }: { message: string }) {
  return (
    <main>
      <h1>Invitation error</h1>
      <p>{message}</p>
    </main>
  );
}
