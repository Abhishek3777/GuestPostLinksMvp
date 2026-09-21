CREATE TYPE "public"."discovery_source" AS ENUM('sitemap', 'wp-api', 'feed', 'html-crawl');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('success', 'blocked', 'dns_error', 'timeout', 'no_posts_found', 'error');--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"days_window" integer,
	"target_post_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_crawl_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"status" "domain_status" NOT NULL,
	"source" "discovery_source",
	"reason" text,
	"posts_processed" integer DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_post_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"guest_post_url" text NOT NULL,
	"external_link" text NOT NULL,
	"root_domain" text NOT NULL,
	"post_date" timestamp with time zone,
	"date_found" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_crawl_status" ADD CONSTRAINT "domain_crawl_status_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_post_links" ADD CONSTRAINT "guest_post_links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_crawl_status_campaign_domain_idx" ON "domain_crawl_status" USING btree ("campaign_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_post_links_unique_idx" ON "guest_post_links" USING btree ("campaign_id","guest_post_url","external_link");--> statement-breakpoint
CREATE INDEX "guest_post_links_root_domain_idx" ON "guest_post_links" USING btree ("root_domain");