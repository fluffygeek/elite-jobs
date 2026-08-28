# Elite Jobs

Tracks fiber and directional-bore installation jobs submitted by field technicians across multiple geographic markets, replacing a Google Sheets–based workflow. Office staff review submitted jobs and close them out in the back office.

## Language

**Market**:
A fixed, admin-managed geographic region of operation (e.g. "Live Oak", "Florida", "Georgia") that every Job belongs to.
_Avoid_: Region, territory

**Technician**:
The field worker who performs installation work and submits Jobs from the field, often with unreliable connectivity.
_Avoid_: Field tech, tech, installer

**Office Staff**:
The back-office role that reviews submitted Jobs and marks them closed out. Office Staff can see Jobs across every Market.
_Avoid_: Dispatch, dispatcher, admin

**Job**:
A single unit of installation work at one Address, submitted by a Technician and belonging to one Market. A Job carries fiber and/or bore work details, a small set of fixed boolean site attributes, and a Close-Out status that only Office Staff can change.
_Avoid_: Ticket, work order, task

**Job Number**:
A free-text identifier the Technician enters on a Job. Not validated or issued by any external system — uniqueness is not enforced across Markets.
_Avoid_: Ticket number, work order number

**Job Site**:
The state and zip code covered by a Job, derived automatically from its Address. Not entered independently.
_Avoid_: Location, service area

**Fiber Code**:
A Technician-selected classification of the fiber work performed on a Job, drawn from a fixed list: `CP`, `DDB`.
_Avoid_: Fiber type

**Fiber Footage**:
The numeric length, in feet, of fiber work performed on a Job.

**Bore Footage**:
The numeric length, in feet, of directional bore work performed on a Job, entered by the Technician.

**Bore Payment Tier**:
The business rule that classifies a Job's Bore Footage into a payment tier for billing purposes. The app computes this from Bore Footage — it is never chosen or entered by the Technician:
- `DDB1`: up to 150 ft
- `DDB2`: 151–250 ft
- `DDB3`: 251–350 ft
- `DDB4`: 351–450 ft
- Footage beyond 450 ft additionally incurs a `DBC1` overage, expressed as `DBC1 x <N>` where `N` is the footage past 450.

A Job's rendered **Bore Code** is the display string produced by this rule (e.g. 750 ft → `"DDB4 DBC1 x 300"`).
_Avoid_: Bore Code as an input, Bore rate

**Site Attributes**:
The fixed set of three yes/no properties recorded on every Job regardless of Market: Locate, Directional Bore, Prebury.

**Tech Notes**:
Free-text notes the Technician records on a Job.

**Close-Out**:
The act of Office Staff marking a Job as fully processed in the back-office (billing) system. A Job is either awaiting Close-Out or Closed Out; Technicians cannot change this status.
_Avoid_: Status, completion, "Close out in L/O System" (legacy sheet column name)

**Discrepancy Flag**:
A marker Office Staff can set on a Job to indicate it needs attention (e.g. suspected duplicate, mismatched address, questionable footage). Flagged Jobs can be pulled into a dedicated export separate from the general CSV export.

**Offline Submission**:
A Job created by a Technician while disconnected, held locally on the device with a client-generated identifier, and synced to the server once connectivity returns. The client-generated identifier is what lets a repeated sync be recognized as the same Job rather than a duplicate.
_Avoid_: Draft, pending job
