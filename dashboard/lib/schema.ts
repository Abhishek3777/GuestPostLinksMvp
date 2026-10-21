// Mirrors ../src/db/schema.ts in the worker project. Duplicated rather than
// imported across the two Next.js/tsx module boundaries (different
// TS module resolution + build pipelines) — kept intentionally small (4
// tables) so the duplication cost stays low. The worker project's schema.ts
// is the source of truth for migrations; this file must stay in sync with it
// by hand.
import { relations } from "drizzle-orm";
import { bigint, boolean, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  role: userRole("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Singleton row (id always 1) holding app-wide settings — currently just the
// lead re-contact cooldown, which used to be set per-group before dedup
// became global.
export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  dedupDays: integer("dedup_days").notNull().default(90),
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
  failureCount: integer("failure_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  contactStageStatus: contactStageStatus("contact_stage_status").notNull().default("not_started"),
  contactStageStartedAt: timestamp("contact_stage_started_at", { withTimezone: true }),
  contactStageCompletedAt: timestamp("contact_stage_completed_at", { withTimezone: true }),
  // Set once, right before a completed campaign's detail rows (campaign_domains,
  // domain_crawl_status, guest_post_links, guest_post_prospects) get deleted a
  // week after completion — a frozen copy of the same numbers the dashboard
  // tiles show live, so the detail page still has something real to render
  // once the raw rows are gone. Null means "still has full live data."
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedSummary: jsonb("archived_summary").$type<ArchivedSummary>(),
  // Cumulative bytes transferred through the paid proxy for this campaign —
  // see the matching comment in src/db/schema.ts. Queryable here for "how
  // much/where is proxy usage happening" questions.
  proxyBytesUsed: bigint("proxy_bytes_used", { mode: "number" }).notNull().default(0),
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
  (t) => [
    uniqueIndex("domain_crawl_status_campaign_domain_idx").on(t.campaignId, t.domain),
    index("domain_crawl_status_campaign_checked_idx").on(t.campaignId, t.checkedAt),
  ]
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

export const domainRelevanceCache = pgTable("domain_relevance_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: text("domain").notNull().unique(),
  decision: text("decision").notNull(),
  reason: text("reason"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

export const watchedSites = pgTable("watched_sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: text("domain").notNull().unique(),
  active: boolean("active").notNull().default(true),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastCampaignId: uuid("last_campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  // Cumulative links ever found for this domain, across every monitor run —
  // see the matching comment in src/db/schema.ts (worker) for why this
  // exists separately from the per-run guest_post_links count.
  totalLinksFound: integer("total_links_found").notNull().default(0),
  totalPostsFound: integer("total_posts_found").notNull().default(0),
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
    claimedByCampaignId: uuid("claimed_by_campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
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
  (t) => [
    uniqueIndex("guest_post_prospects_campaign_domain_idx").on(t.campaignId, t.rootDomain),
    index("guest_post_prospects_campaign_created_idx").on(t.campaignId, t.createdAt),
  ]
);

// The one thing that must survive a campaign's data being deleted for the
// 90-day global dedup to keep working — see the matching comment in
// src/db/schema.ts.
export const domainContactLedger = pgTable("domain_contact_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: text("domain").notNull().unique(),
  contactedAt: timestamp("contacted_at", { withTimezone: true }).notNull(),
  campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
});

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  domains: many(campaignDomains),
  domainStatuses: many(domainCrawlStatus),
  links: many(guestPostLinks),
  prospects: many(guestPostProspects),
}));

// The shape of campaigns.archivedSummary, frozen by archiveCampaign in
// src/worker/archiveCampaign.ts — kept in sync with that file by hand, same
// as the rest of this schema mirrors ../src/db/schema.ts.
export interface ArchivedSummary {
  totalDomains: number;
  linksCount: number;
  domainStatusCounts: { status: string; count: number }[];
  prospectReasonCounts: { reason: string | null; count: number }[];
  contactStats: {
    kept: number;
    looked: number;
    reached: number;
    formsConfirmed: number;
    totalEmails: number;
    hasEmailStatus: number;
  };
  contactFilterCounts: Record<string, number>;
}

/* ---------------------------------------------------------------------------
 * Cost dashboard (admin /costs page). Three small tables:
 *  - cost_ledger: manual top-ups for prepaid services (2captcha, CapSolver,
 *    DataImpulse) — their APIs only expose a balance, not payment history.
 *  - cost_balance_snapshots: periodic balance readings; a drop between two
 *    readings is consumption.
 *  - cost_railway_daily: priced Railway usage per day per service, pulled
 *    from Railway's GraphQL usage API.
 * ------------------------------------------------------------------------- */

export const costLedger = pgTable("cost_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  service: text("service").notNull(),
  paidOn: date("paid_on").notNull(),
  amount: doublePrecision("amount").notNull(),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const costBalanceSnapshots = pgTable("cost_balance_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  service: text("service").notNull(),
  balance: doublePrecision("balance").notNull(),
  takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("cost_balance_snapshots_service_taken_idx").on(t.service, t.takenAt)]).enableRLS();

export const costRailwayDaily = pgTable("cost_railway_daily", {
  day: date("day").notNull(),
  label: text("label").notNull(),
  cost: doublePrecision("cost").notNull(),
}, (t) => [primaryKey({ columns: [t.day, t.label] })]).enableRLS();

// Vercel's billed charges per day per line item (Pro plan, extra seats, usage),
// from Vercel's billing API. Overrides the flat $20 estimate where present.
export const costVercelDaily = pgTable("cost_vercel_daily", {
  day: date("day").notNull(),
  label: text("label").notNull(),
  cost: doublePrecision("cost").notNull(),
}, (t) => [primaryKey({ columns: [t.day, t.label] })]).enableRLS();
