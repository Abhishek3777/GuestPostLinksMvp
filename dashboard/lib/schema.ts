// Mirrors ../src/db/schema.ts in the worker project. Duplicated rather than
// imported across the two Next.js/tsx module boundaries (different
// TS module resolution + build pipelines) — kept intentionally small (4
// tables) so the duplication cost stays low. The worker project's schema.ts
// is the source of truth for migrations; this file must stay in sync with it
// by hand.
import { relations } from "drizzle-orm";
import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const domainStatus = pgEnum("domain_status", [
  "success",
  "blocked",
  "dns_error",
  "timeout",
  "no_posts_found",
  "error",
]);

export const discoverySource = pgEnum("discovery_source", ["sitemap", "wp-api", "feed", "html-crawl"]);

export const campaignStatus = pgEnum("campaign_status", ["queued", "running", "completed", "failed"]);
export const campaignMode = pgEnum("campaign_mode", ["discovery", "direct"]);
export const contactStageStatus = pgEnum("contact_stage_status", [
  "not_started",
  "queued",
  "running",
  "completed",
  "failed",
]);
export const contactStatus = pgEnum("contact_status", [
  "pending",
  "has_email",
  "form_only",
  "no_contact_found",
  "blocked",
  "dns_error",
  "timeout",
  "error",
]);

export const userRole = pgEnum("user_role", ["admin", "member"]);

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  dedupDays: integer("dedup_days").notNull().default(90),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  role: userRole("role").notNull().default("member"),
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  mode: campaignMode("mode").notNull().default("discovery"),
  autoContact: boolean("auto_contact").notNull().default(false),
  incremental: boolean("incremental").notNull().default(false),
  paused: boolean("paused").notNull().default(false),
  daysWindow: integer("days_window"),
  targetPostCount: integer("target_post_count").notNull(),
  status: campaignStatus("status").notNull().default("queued"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  contactStageStatus: contactStageStatus("contact_stage_status").notNull().default("not_started"),
  contactStageStartedAt: timestamp("contact_stage_started_at", { withTimezone: true }),
  contactStageCompletedAt: timestamp("contact_stage_completed_at", { withTimezone: true }),
});

export const campaignDomains = pgTable(
  "campaign_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
  },
  (t) => [uniqueIndex("campaign_domains_campaign_domain_idx").on(t.campaignId, t.domain)]
);

export const domainCrawlStatus = pgTable(
  "domain_crawl_status",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    status: domainStatus("status").notNull(),
    source: discoverySource("source"),
    reason: text("reason"),
    postsProcessed: integer("posts_processed").notNull().default(0),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("domain_crawl_status_campaign_domain_idx").on(t.campaignId, t.domain)]
);

export const guestPostLinks = pgTable(
  "guest_post_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    sourceDomain: text("source_domain"),
    guestPostUrl: text("guest_post_url").notNull(),
    externalLink: text("external_link").notNull(),
    rootDomain: text("root_domain").notNull(),
    postDate: timestamp("post_date", { withTimezone: true }),
    dateFound: timestamp("date_found", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("guest_post_links_unique_idx").on(t.campaignId, t.guestPostUrl, t.externalLink),
    index("guest_post_links_root_domain_idx").on(t.rootDomain),
  ]
);

export const doNotContact = pgTable("do_not_contact", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: text("domain").notNull().unique(),
  note: text("note"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export const watchedSites = pgTable("watched_sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: text("domain").notNull().unique(),
  active: boolean("active").notNull().default(true),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastCampaignId: uuid("last_campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
});

export const guestPostProspects = pgTable(
  "guest_post_prospects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    rootDomain: text("root_domain").notNull(),
    exampleGuestPostUrl: text("example_guest_post_url"),
    exampleExternalLink: text("example_external_link"),
    exclusionReason: text("exclusion_reason"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    contactStatus: contactStatus("contact_status").notNull().default("pending"),
    emailAddress: text("email_address"),
    // The single address to actually use, picked out of emailAddress by
    // pickEmail (lib/pickEmail.ts, ported from pick_email.py).
    contactEmail: text("contact_email"),
    contactFormUrl: text("contact_form_url"),
    finalDomain: text("final_domain"),
    contactReason: text("contact_reason"),
    contactCheckedAt: timestamp("contact_checked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("guest_post_prospects_campaign_domain_idx").on(t.campaignId, t.rootDomain)]
);

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  domains: many(campaignDomains),
  domainStatuses: many(domainCrawlStatus),
  links: many(guestPostLinks),
  prospects: many(guestPostProspects),
}));
