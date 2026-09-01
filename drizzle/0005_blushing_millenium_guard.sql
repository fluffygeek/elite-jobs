ALTER TABLE "jobs" ADD COLUMN "locked_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_locked_by_user_id_users_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;