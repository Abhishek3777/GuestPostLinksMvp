CREATE TABLE "watched_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_campaign_id" uuid,
	CONSTRAINT "watched_sites_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
ALTER TABLE "watched_sites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "watched_sites" ADD CONSTRAINT "watched_sites_last_campaign_id_campaigns_id_fk" FOREIGN KEY ("last_campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;