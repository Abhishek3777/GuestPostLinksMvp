// Campaign finish-time estimate — the pure maths, no database and no React, so
// it can be tested on its own. The plain-language version of this logic is in
// docs/CAMPAIGN_ETA.md; keep the two in step.
//
// Idea: we can't know a campaign's duration up front, but we CAN measure how
// fast it is going right now. time left = work left / current speed, summed
// over the stages still to run.

// A crawl run has two stages that matter for timing: the crawl (one step per
// input domain) and the contact lookup (one step per kept prospect). The filter
// stage between them is a few seconds and is ignored.

// Of the distinct backlink domains a crawl finds, this fraction is kept as a
// prospect (the rest are big brands, gov/edu, do-not-contact, ...). Measured on
// the first real campaign: 26,572 kept of 33,140 saved = 0.80.
export const KEEP_RATIO = 0.8;

// While the crawl is still running, the contact workload is a projection, so
// the range is widened by this much either side to reflect that.
const PROJECTION_SPREAD = 0.15;

// Don't quote a speed until the stage has run this long and produced at least
// this many results in the last 15 minutes — a handful of early results says
// nothing about the rest of the run.
const MIN_MINUTES_RUNNING = 3;
const MIN_EVENTS_15M = 10;

// However noisy the 5/15/60-minute speeds are, the range never extends past
// half or double the 15-minute speed.
const MAX_SPEED_SWING = 2;

export interface CampaignEtaInput {
  mode: "discovery" | "direct";
  status: string; // campaign status: queued | running | completed | failed
  contactStageStatus: string; // not_started | queued | running | completed | failed
  paused: boolean;
  autoContact: boolean;
  startedAt: Date | null;
  contactStageStartedAt: Date | null;

  // Crawl stage
  totalDomains: number;
  domainsChecked: number;
  crawlEvents: Events; // domains finished in the last 5 / 15 / 60 minutes
  distinctBacklinkDomains: number; // distinct root domains found in links so far

  // Contact stage
  keptPending: number; // kept prospects still to look up
  contactEvents: Events; // lookups finished in the last 5 / 15 / 60 minutes

  // Lookups per minute from past campaigns; null when there's no history yet.
  historicalContactRate: number | null;

  now: Date;
}

export interface Events {
  m5: number;
  m15: number;
  m60: number;
}

export type CampaignEta =
  | { kind: "none" } // finished, failed, or nothing to estimate
  | { kind: "paused" }
  | { kind: "queued" } // waiting for a worker slot
  | { kind: "estimating"; reason: string }
  | {
      kind: "estimate";
      phase: "crawl" | "contact";
      lowMs: number; // optimistic
      expectedMs: number;
      highMs: number; // pessimistic
      finishAt: Date; // expected
      // True when part of the remaining work can't be timed yet (e.g. the
      // contact lookup after a crawl, with no past campaign to learn its speed
      // from) — the number then covers only what we CAN time.
      partial: string | null;
    };

interface Speeds {
  central: number; // per minute
  fast: number;
  slow: number;
  fromHistory: boolean;
}

// Per-minute speed from the three windows. A window can't be longer than the
// stage has been running, or a fresh stage would look artificially slow.
function speedsFrom(ev: Events, minutesRunning: number): Speeds | null {
  const rate = (count: number, windowMin: number) => count / Math.max(1, Math.min(windowMin, minutesRunning));
  const r5 = rate(ev.m5, 5);
  const r15 = rate(ev.m15, 15);
  const r60 = rate(ev.m60, 60);
  if (r15 <= 0) return null;
  const all = [r5, r15, r60].filter((r) => r > 0);
  const fast = Math.min(Math.max(...all), r15 * MAX_SPEED_SWING);
  const slow = Math.max(Math.min(...all), r15 / MAX_SPEED_SWING);
  return { central: r15, fast, slow, fromHistory: false };
}

function historicalSpeeds(rate: number | null): Speeds | null {
  if (!rate || rate <= 0) return null;
  // No live measurement to bracket it with, so the past average gets the widest
  // allowed swing.
  return { central: rate, fast: rate * MAX_SPEED_SWING, slow: rate / MAX_SPEED_SWING, fromHistory: true };
}

const MIN_MS = 60_000;

export function computeCampaignEta(i: CampaignEtaInput): CampaignEta {
  const crawlActive = i.status === "queued" || i.status === "running";
  const contactActive = i.contactStageStatus === "queued" || i.contactStageStatus === "running";
  if (!crawlActive && !contactActive) return { kind: "none" };
  if (i.paused) return { kind: "paused" };

  const minutesSince = (d: Date | null) => (d ? Math.max(0, (i.now.getTime() - d.getTime()) / MIN_MS) : 0);

  // ---- Contact-stage work: already running/queued, or a direct campaign ----
  if (contactActive) {
    return contactOnly(i, i.keptPending, minutesSince(i.contactStageStartedAt ?? i.startedAt));
  }
  if (i.mode === "direct") {
    // Direct campaigns run the contact stage inline; before it flips to
    // "running" the prospects are still being seeded.
    if (i.status === "queued") return { kind: "queued" };
    return contactOnly(i, i.keptPending, minutesSince(i.startedAt));
  }

  // ---- Discovery campaign, crawl still going ----
  if (i.status === "queued") return { kind: "queued" };

  const minutesRunning = minutesSince(i.startedAt);
  const remainingDomains = Math.max(0, i.totalDomains - i.domainsChecked);

  let crawl: Speeds | null = null;
  if (remainingDomains > 0) {
    if (minutesRunning < MIN_MINUTES_RUNNING || i.crawlEvents.m15 < MIN_EVENTS_15M) {
      return { kind: "estimating", reason: "Collecting a few minutes of progress first" };
    }
    crawl = speedsFrom(i.crawlEvents, minutesRunning);
    if (!crawl) return { kind: "estimating", reason: "No progress in the last 15 minutes" };
  }

  // Contact workload still to come (only if this run continues into it).
  let projected = 0;
  let exactContact = false;
  if (i.autoContact) {
    const fractionDone = i.totalDomains > 0 ? i.domainsChecked / i.totalDomains : 1;
    if (remainingDomains === 0) {
      // Crawl over: the backlink domains found are the full set.
      projected = i.distinctBacklinkDomains * KEEP_RATIO;
      exactContact = true;
    } else if (fractionDone > 0) {
      projected = (i.distinctBacklinkDomains / fractionDone) * KEEP_RATIO;
    }
  }

  const crawlMin = crawl ? remainingDomains / crawl.central : 0;
  const crawlFast = crawl ? remainingDomains / crawl.fast : 0;
  const crawlSlow = crawl ? remainingDomains / crawl.slow : 0;

  if (!i.autoContact || projected <= 0) {
    if (remainingDomains === 0) return { kind: "none" };
    return build("crawl", crawlFast, crawlMin, crawlSlow, i.now, i.autoContact ? null : "Crawl only — contact lookup is started separately");
  }

  const contact = historicalSpeeds(i.historicalContactRate);
  if (!contact) {
    return build("crawl", crawlFast, crawlMin, crawlSlow, i.now, "Contact lookup time can't be estimated until the first one has run");
  }
  const spread = exactContact ? 0 : PROJECTION_SPREAD;
  return build(
    "crawl",
    crawlFast + (projected * (1 - spread)) / contact.fast,
    crawlMin + projected / contact.central,
    crawlSlow + (projected * (1 + spread)) / contact.slow,
    i.now,
    null
  );
}

function contactOnly(i: CampaignEtaInput, remaining: number, minutesRunning: number): CampaignEta {
  if (remaining <= 0) {
    // Nothing left to look up but still flagged active: seeding / wrapping up.
    return { kind: "estimating", reason: "Wrapping up" };
  }
  let speeds: Speeds | null = null;
  if (minutesRunning >= MIN_MINUTES_RUNNING && i.contactEvents.m15 >= MIN_EVENTS_15M) {
    speeds = speedsFrom(i.contactEvents, minutesRunning);
  }
  // Too early, or queued behind something else: lean on past campaigns' speed.
  speeds ??= historicalSpeeds(i.historicalContactRate);
  if (!speeds) return { kind: "estimating", reason: "Collecting a few minutes of progress first" };
  return build("contact", remaining / speeds.fast, remaining / speeds.central, remaining / speeds.slow, i.now, null);
}

function build(
  phase: "crawl" | "contact",
  fastMin: number,
  centralMin: number,
  slowMin: number,
  now: Date,
  partial: string | null
): CampaignEta {
  const expectedMs = centralMin * MIN_MS;
  return {
    kind: "estimate",
    phase,
    lowMs: fastMin * MIN_MS,
    expectedMs,
    highMs: slowMin * MIN_MS,
    finishAt: new Date(now.getTime() + expectedMs),
    partial,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

// "45 min", "2h 10m", "1d 4h" — rounded so it doesn't pretend to be precise.
export function formatDuration(ms: number): string {
  const min = Math.max(1, Math.round(ms / MIN_MS));
  if (min < 60) return `${min < 10 ? min : Math.round(min / 5) * 5} min`;
  if (min < 60 * 24) {
    const total = Math.round(min / 10) * 10;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const hours = Math.round(min / 60);
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function formatFinishTime(d: Date): string {
  // Server-rendered: fix the zone (same reason as the campaigns list) or this
  // would show the container's UTC clock.
  return d.toLocaleString("en-IN", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}
