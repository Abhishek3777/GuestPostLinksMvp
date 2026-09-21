CREATE TYPE "public"."campaign_mode" AS ENUM('discovery', 'direct');--> statement-breakpoint
CREATE TYPE "public"."contact_stage_status" AS ENUM('not_started', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('pending', 'has_email', 'form_only', 'no_contact_found', 'blocked', 'dns_error', 'timeout', 'error');--> statement-breakpoint
ALTER TABLE "guest_post_prospects" ALTER COLUMN "example_guest_post_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_post_prospects" ALTER COLUMN "example_external_link" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "mode" "campaign_mode" DEFAULT 'discovery' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "contact_stage_status" "contact_stage_status" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "contact_stage_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "contact_stage_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guest_post_prospects" ADD COLUMN "contact_status" "contact_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_post_prospects" ADD COLUMN "email_address" text;--> statement-breakpoint
ALTER TABLE "guest_post_prospects" ADD COLUMN "contact_form_url" text;--> statement-breakpoint
ALTER TABLE "guest_post_prospects" ADD COLUMN "final_domain" text;--> statement-breakpoint
ALTER TABLE "guest_post_prospects" ADD COLUMN "contact_checked_at" timestamp with time zone;