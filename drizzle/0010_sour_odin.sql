CREATE TABLE "processed_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_domain" text NOT NULL,
	"post_url" text NOT NULL,
	"outcome" text NOT NULL,
	"links_found" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_posts_post_url_unique" UNIQUE("post_url")
);
--> statement-breakpoint
ALTER TABLE "processed_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "incremental" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "processed_posts_source_domain_idx" ON "processed_posts" USING btree ("source_domain");