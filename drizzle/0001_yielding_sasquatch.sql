CREATE TYPE "public"."campaign_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "campaign_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"domain" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "status" "campaign_status" DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_domains" ADD CONSTRAINT "campaign_domains_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_domains_campaign_domain_idx" ON "campaign_domains" USING btree ("campaign_id","domain");