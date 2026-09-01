ALTER TABLE "jobs" ALTER COLUMN "address_street" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "address_city" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "address_state" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "address";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "job_site_state";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "job_site_zip";