import { relations } from "drizzle-orm";
import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/* ---------------------------------------------------------------------------
 * Enums
 * ------------------------------------------------------------------------- */

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

// discovery = the normal 3-stage flow (crawl posts -> filter -> contact).
// direct = Stage 3 run standalone: you already know the target domains, skip
// straight to finding their contact info, no crawling or link-extraction.
export const campaignMode = pgEnum("campaign_mode", ["discovery", "direct"]);

// Tracked separately from campaigns.status because Stage 3 is a manually
// triggered, independent step for "discovery" campaigns (you review the kept
// prospect list before spending scrape effort on it) — a campaign can be
// campaigns.status="completed" (Stage 1+2 done) while this is still
// "not_started". For "direct" mode campaigns this runs automatically right
// after the exclusion check, no separate trigger needed.
export const contactStageStatus = pgEnum("contact_stage_status", [
  "not_started",
  "queued", // requested from the dashboard, waiting for the worker daemon to pick it up
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

/* ---------------------------------------------------------------------------
 * groups — admin-managed teams. A member's group is who they compete with for
 * leads: see the dedup note on guestPostProspects further down.
 * ------------------------------------------------------------------------- */

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/* ---------------------------------------------------------------------------
 * profiles — one row per dashboard user. `id` is the Supabase auth user's
 * UUID, copied over (not a DB foreign key: auth lives in a different Supabase
 * project than this one, so there is no `auth.users` table to reference here).
 * ------------------------------------------------------------------------- */

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  role: userRole("role").notNull().default("member"),
  // One group at a time, optional. Admins are never in a group — they already
  // see and can act on every campaign regardless.
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/* ---------------------------------------------------------------------------
 * campaigns — one row per crawl run. Holds the settings the run was fired
 * with, so results stay traceable to how they were produced.
 * ------------------------------------------------------------------------- */

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Who started it — an admin sees every campaign, a member only their own.
  // Nullable: campaigns created before RBAC existed have no owner and are
  // admin-only until claimed.
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  mode: campaignMode("mode").notNull().default("discovery"),
  // For "discovery" campaigns: keep going into Stage 3 (contact lookup) on the
  // kept prospects right after Stage 1+2, so one run goes domains -> contacts.
  // Off = stop after the filter and let a human review before scraping.
  autoContact: boolean("auto_contact").notNull().default(false),
  // "Monitoring" runs (from Sites to monitor): remember what earlier runs already
  // read, so only NEW posts are crawled and a backlink domain that an earlier
  // run already found and looked up is not delivered again. Ordinary one-off
  // campaigns leave this off and always start fresh.
  incremental: boolean("incremental").notNull().default(false),
  // Set from the dashboard's Pause button. The worker stops starting new work on a
  // paused campaign (sites already in flight finish), leaves it "queued", and will
  // not pick it up again until Resume clears the flag.
  paused: boolean("paused").notNull().default(false),
  daysWindow: integer("days_window"), // null = no date cutoff, just targetPostCount
  targetPostCount: integer("target_post_count").notNull(),
  status: campaignStatus("status").notNull().default("queued"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  contactStageStatus: contactStageStatus("contact_stage_status").notNull().default("not_started"),
  contactStageStartedAt: timestamp("contact_stage_started_at", { withTimezone: true }),
  contactStageCompletedAt: timestamp("contact_stage_completed_at", { withTimezone: true }),
}).enableRLS();

/* ---------------------------------------------------------------------------
 * campaign_domains — the uploaded domain list for a campaign. Exists
 * separately from domain_crawl_status because it needs to hold every domain
 * up front (so the dashboard can show "12 of 40 done"), before the worker
 * has touched any of them.
 * ------------------------------------------------------------------------- */

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
).enableRLS();

/* ---------------------------------------------------------------------------
 * domain_crawl_status — one row per domain per campaign. Every domain that
 * goes through Stage 1 leaves a row here saying what happened, even (and
 * especially) when nothing was found — this is how we know what fraction of
 * a domain list is visitable without paid unlock services.
 * ------------------------------------------------------------------------- */

export const domainCrawlStatus = pgTable(
  "domain_crawl_status",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    status: domainStatus("status").notNull(),
    source: discoverySource("source"), // which discovery strategy worked; null if none did
    reason: text("reason"), // free-text detail, e.g. "homepage probe: blocked"
    postsProcessed: integer("posts_processed").notNull().default(0),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Re-checking the same domain in the same campaign updates this one row
    // instead of piling up duplicates — needed for resumable runs.
    uniqueIndex("domain_crawl_status_campaign_domain_idx").on(t.campaignId, t.domain),
  ]
).enableRLS();

/* ---------------------------------------------------------------------------
 * guest_post_links — the actual Phase 1 output: for every post we crawled,
 * each external (backlink) link found inside its article body.
 * ------------------------------------------------------------------------- */

export const guestPostLinks = pgTable(
  "guest_post_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    // The domain the USER SENT that this post was found on — so every backlink
    // (and the contact info found for it) traces back to its input domain.
    // Nullable only because rows from before this column existed have none;
    // the CSV builder recovers those from the post URL's host.
    sourceDomain: text("source_domain"),
    guestPostUrl: text("guest_post_url").notNull(),
    externalLink: text("external_link").notNull(),
    rootDomain: text("root_domain").notNull(), // root domain of externalLink — the actual outreach target
    postDate: timestamp("post_date", { withTimezone: true }),
    dateFound: timestamp("date_found", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("guest_post_links_unique_idx").on(t.campaignId, t.guestPostUrl, t.externalLink),
    index("guest_post_links_root_domain_idx").on(t.rootDomain),
  ]
).enableRLS();

/* ---------------------------------------------------------------------------
 * do_not_contact — ONE central list, shared across every campaign. Root
 * domain only. This is the thing the original spec called out as the actual
 * fix over the legacy pipeline's plain text file copied by hand between
 * machines: here, every worker reads the same table at the start of Stage 2.
 * ------------------------------------------------------------------------- */

export const doNotContact = pgTable("do_not_contact", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: text("domain").notNull().unique(),
  note: text("note"), // optional free-text, e.g. "hostile reply 2026-08-15"
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/* ---------------------------------------------------------------------------
 * watched_sites — the standing list of guest-post sites to keep monitoring
 * ("Sites to monitor" in the dashboard). Unlike a campaign's one-off upload this
 * persists: sites are switched active/paused, and "Run active sites" turns the
 * active ones into a campaign that only looks at posts published since the last
 * run. lastRunAt/lastCampaignId record that run so the list can show it.
 * ------------------------------------------------------------------------- */

export const watchedSites = pgTable("watched_sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: text("domain").notNull().unique(),
  active: boolean("active").notNull().default(true),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastCampaignId: uuid("last_campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
}).enableRLS();

/* ---------------------------------------------------------------------------
 * processed_posts — every post URL a crawl has finished with, across ALL
 * campaigns. It is what lets a monitoring run read only NEW posts.
 *   done    = read successfully (links, if any, were saved)
 *   skipped = fetched but not usable: not an article, too short, a link farm
 * A post whose fetch FAILED is deliberately not recorded, so the next run
 * retries it instead of losing it for good.
 * ------------------------------------------------------------------------- */

export const processedPosts = pgTable(
  "processed_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceDomain: text("source_domain").notNull(),
    postUrl: text("post_url").notNull().unique(),
    outcome: text("outcome").notNull(), // "done" | "skipped"
    linksFound: integer("links_found").notNull().default(0),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("processed_posts_source_domain_idx").on(t.sourceDomain)]
).enableRLS();

/* ---------------------------------------------------------------------------
 * guest_post_prospects — Stage 2 output. One row per UNIQUE root domain per
 * campaign (mirrors the legacy pipeline's build_contact_list.py: dedupe
 * first, decide keep/exclude once per target, not once per link row). A
 * campaign with 50 links to the same domain still produces exactly one
 * prospect row here — that row is what Stage 3 (contact scraping) will
 * eventually work from.
 *
 * Group dedup: the FIRST group-mate whose campaign keeps a given rootDomain
 * here (exclusionReason still null) "claims" it. Any other CURRENT member of
 * the same group whose filter stage later sees that same rootDomain excludes
 * it (reason "claimed_by_teammate") instead of creating a second kept row —
 * see findClaimedByGroupmates in src/db/filterResults.ts. Members in
 * different groups (or no group) never block each other this way.
 * ------------------------------------------------------------------------- */

export const guestPostProspects = pgTable(
  "guest_post_prospects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    rootDomain: text("root_domain").notNull(),
    // Null for "direct" mode campaigns — there's no guest post, the domain
    // was handed to us directly as a target to find contact info for.
    exampleGuestPostUrl: text("example_guest_post_url"),
    exampleExternalLink: text("example_external_link"),
    // "" / null = kept as a valid prospect. Otherwise: do_not_contact,
    // gov_edu_tld, big_brand, excluded_domain, parked_domain, url_shortener,
    // invalid_domain — see src/filter/exclusions.ts.
    exclusionReason: text("exclusion_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    // --- Stage 3 (contact scraping) fields, filled in after the fact ---
    contactStatus: contactStatus("contact_status").notNull().default("pending"),
    emailAddress: text("email_address"), // comma-separated when multiple found
    contactFormUrl: text("contact_form_url"),
    finalDomain: text("final_domain"), // where the domain redirected to, if anywhere
    contactReason: text("contact_reason"), // WHY it failed / came back partial — see findContact.ts
    contactCheckedAt: timestamp("contact_checked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("guest_post_prospects_campaign_domain_idx").on(t.campaignId, t.rootDomain)]
).enableRLS();

/* ---------------------------------------------------------------------------
 * Relations
 * ------------------------------------------------------------------------- */

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  domains: many(campaignDomains),
  domainStatuses: many(domainCrawlStatus),
  links: many(guestPostLinks),
}));

export const campaignDomainsRelations = relations(campaignDomains, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignDomains.campaignId], references: [campaigns.id] }),
}));

export const domainCrawlStatusRelations = relations(domainCrawlStatus, ({ one }) => ({
  campaign: one(campaigns, { fields: [domainCrawlStatus.campaignId], references: [campaigns.id] }),
}));

export const guestPostLinksRelations = relations(guestPostLinks, ({ one }) => ({
  campaign: one(campaigns, { fields: [guestPostLinks.campaignId], references: [campaigns.id] }),
}));

export const guestPostProspectsRelations = relations(guestPostProspects, ({ one }) => ({
  campaign: one(campaigns, { fields: [guestPostProspects.campaignId], references: [campaigns.id] }),
}));
