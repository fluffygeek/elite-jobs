// Env vars are loaded via `tsx --env-file=.env.local` (see package.json's
// db:seed script), not a dotenv import here — a top-level `import` of "./index"
// below is hoisted above any dotenv call in this file regardless of source
// order (ES module imports always run before other top-level statements),
// so loading .env.local from inside this file would be too late.
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { markets, users } from "./schema";
import {
  createJob,
  updateJobDiscrepancyFlag,
  updateJobClosedOut,
  DuplicateJobNumberError,
} from "./queries/jobs";

// Seeds demo data for local exploration/QA: a couple of Markets, a test
// Technician + Office Staff account, and a handful of Jobs spanning the
// Bore Payment Tier boundaries plus a flagged and a closed-out example.
//
// There is currently only ONE database configured for this project — the
// live production one (no separate staging/dev DB exists). This script
// will not touch anything without --force, and always prints which host
// it's about to write to, so that's a deliberate choice each time, not an
// accident of running the wrong command.
//
// Idempotent: safe to re-run. Existing rows (matched by email or job
// number) are left alone rather than duplicated.

const FORCE = process.argv.includes("--force");

const DEMO_PASSWORD = "Demo1234!";

const DEMO_MARKETS = ["Live Oak", "Florida", "Georgia"] as const;

async function ensureMarket(name: string): Promise<string> {
  const [existing] = await db.select().from(markets).where(eq(markets.name, name));
  if (existing) return existing.id;
  const [created] = await db.insert(markets).values({ name }).returning();
  return created.id;
}

async function ensureUser(email: string, role: "technician" | "office_staff"): Promise<string> {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return existing.id;
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const [created] = await db.insert(users).values({ email, role, passwordHash }).returning();
  return created.id;
}

interface DemoJob {
  jobNumber: string;
  marketId: string;
  technicianId: string;
  date: Date;
  address: string;
  fiberCode: "CP" | "DDB";
  fiberFootage: number;
  boreFootage: number;
  locate: boolean;
  directionalBore: boolean;
  prebury: boolean;
  techNotes?: string;
  flagged?: boolean;
  closedOut?: boolean;
}

async function ensureJob(spec: DemoJob) {
  try {
    const job = await createJob({
      id: randomUUID(),
      marketId: spec.marketId,
      technicianId: spec.technicianId,
      jobNumber: spec.jobNumber,
      date: spec.date,
      address: spec.address,
      fiberCode: spec.fiberCode,
      fiberFootage: spec.fiberFootage,
      boreFootage: spec.boreFootage,
      locate: spec.locate,
      directionalBore: spec.directionalBore,
      prebury: spec.prebury,
      techNotes: spec.techNotes,
    });

    if (spec.flagged) {
      await updateJobDiscrepancyFlag(job.id, false, true);
    }
    if (spec.closedOut) {
      await updateJobClosedOut(job.id, false, true);
    }
    console.log(`  created ${spec.jobNumber}`);
  } catch (error) {
    if (error instanceof DuplicateJobNumberError) {
      console.log(`  skipped ${spec.jobNumber} (already exists)`);
      return;
    }
    throw error;
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const host = dbUrl.match(/@([^/]+)\//)?.[1] ?? "(unknown host)";

  console.log(`This will seed demo data into: ${host}`);
  if (!FORCE) {
    console.log("Dry run — nothing written. Pass --force to actually seed.");
    return;
  }

  const marketIds: Record<string, string> = {};
  for (const name of DEMO_MARKETS) {
    marketIds[name] = await ensureMarket(name);
    console.log(`market ready: ${name}`);
  }

  const technicianId = await ensureUser("demo.tech@elitetmg.com", "technician");
  const officeStaffId = await ensureUser("demo.staff@elitetmg.com", "office_staff");
  console.log(`technician ready: demo.tech@elitetmg.com / ${DEMO_PASSWORD}`);
  console.log(`office staff ready: demo.staff@elitetmg.com / ${DEMO_PASSWORD}`);
  void officeStaffId; // no Job field references the office staff account directly

  const jobs: DemoJob[] = [
    {
      jobNumber: "DEMO-001",
      marketId: marketIds["Live Oak"],
      technicianId,
      date: new Date("2026-08-01"),
      address: "104 E Welwood Dr, Savannah, GA 31419, USA",
      fiberCode: "CP",
      fiberFootage: 120,
      boreFootage: 100, // DDB1 tier
      locate: true,
      directionalBore: false,
      prebury: false,
      techNotes: "Standard install, no issues.",
    },
    {
      jobNumber: "DEMO-002",
      marketId: marketIds["Live Oak"],
      technicianId,
      date: new Date("2026-08-03"),
      address: "3335 Ranch Rd, Marietta, GA 30066, USA",
      fiberCode: "DDB",
      fiberFootage: 200,
      boreFootage: 225, // DDB2 tier
      locate: true,
      directionalBore: true,
      prebury: false,
    },
    {
      jobNumber: "DEMO-003",
      marketId: marketIds["Georgia"],
      technicianId,
      date: new Date("2026-08-05"),
      address: "512 Oak St, Savannah, GA 31401, USA",
      fiberCode: "DDB",
      fiberFootage: 300,
      boreFootage: 400, // DDB4 tier
      locate: true,
      directionalBore: true,
      prebury: true,
      techNotes: "Possible duplicate of DEMO-004 — same address/date.",
      flagged: true,
    },
    {
      jobNumber: "DEMO-004",
      marketId: marketIds["Georgia"],
      technicianId,
      date: new Date("2026-08-05"),
      address: "512 Oak St, Savannah, GA 31401, USA",
      fiberCode: "CP",
      fiberFootage: 90,
      boreFootage: 600, // over 450, exercises the DBC1 overage code
      locate: false,
      directionalBore: false,
      prebury: false,
    },
    {
      jobNumber: "DEMO-005",
      marketId: marketIds["Florida"],
      technicianId,
      date: new Date("2026-07-20"),
      address: "22 Palm Ave, Tampa, FL 33602, USA",
      fiberCode: "CP",
      fiberFootage: 150,
      boreFootage: 50,
      locate: true,
      directionalBore: false,
      prebury: false,
      closedOut: true,
    },
  ];

  console.log("seeding jobs:");
  for (const job of jobs) {
    await ensureJob(job);
  }

  console.log("done.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
