CREATE TABLE "do_not_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"note" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "do_not_contact_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "guest_post_prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"root_domain" text NOT NULL,
	"example_guest_post_url" text NOT NULL,
	"example_external_link" text NOT NULL,
	"exclusion_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_post_prospects" ADD CONSTRAINT "guest_post_prospects_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_post_prospects_campaign_domain_idx" ON "guest_post_prospects" USING btree ("campaign_id","root_domain");