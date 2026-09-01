import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const roleEnum = ["technician", "office_staff"] as const;
export type Role = (typeof roleEnum)[number];

export const fiberCodeEnum = ["CP", "DDB"] as const;
export type FiberCode = (typeof fiberCodeEnum)[number];

export const markets = pgTable("markets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: roleEnum }).notNull(),
  // bcrypt hash of the user's password — set when the account is created via
  // invitation accept (see src/db/queries/invitations.ts). Never store plaintext.
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  role: text("role", { enum: roleEnum }).notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Structurally similar to `invitations` but a genuinely different concept
// (resetting an existing account vs. onboarding a new one), so it gets its
// own table rather than overloading `invitations` — see issue #28.
export const passwordResets = pgTable("password_resets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Job.id is the client-generated UUID from offline submission (ADR 0001) —
// the sync endpoint upserts on this id, never a server-assigned one.
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey(),
    marketId: uuid("market_id").notNull().references(() => markets.id),
    technicianId: uuid("technician_id").notNull().references(() => users.id),
    jobNumber: text("job_number").notNull(),
    date: timestamp("date", { withTimezone: true }).notNull(),
    addressStreet: text("address_street").notNull(),
    addressLine2: text("address_line2"),
    addressCity: text("address_city").notNull(),
    addressState: text("address_state").notNull(),
    addressZip: text("address_zip"),
    fiberCode: text("fiber_code", { enum: fiberCodeEnum }).notNull(),
    fiberFootage: integer("fiber_footage").notNull(),
    boreFootage: integer("bore_footage").notNull(),
    // Computed server-side from boreFootage on every write — see lib/domain.
    // Never accept this from a client.
    boreCode: text("bore_code").notNull(),
    locate: boolean("locate").notNull(),
    directionalBore: boolean("directional_bore").notNull(),
    prebury: boolean("prebury").notNull(),
    techNotes: text("tech_notes").notNull().default(""),
    closedOut: boolean("closed_out").notNull().default(false),
    discrepancyFlag: boolean("discrepancy_flag").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("jobs_market_job_number_unique").on(table.marketId, table.jobNumber)],
);
