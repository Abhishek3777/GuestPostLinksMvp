import { strict as assert } from "node:assert";
import { test } from "node:test";
import { computeCampaignEta, formatDuration, type CampaignEtaInput } from "./campaignEta.ts";

const now = new Date("2026-09-30T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

const base: CampaignEtaInput = {
  mode: "discovery",
  status: "running",
  contactStageStatus: "not_started",
  paused: false,
  autoContact: true,
  startedAt: ago(120),
  contactStageStartedAt: null,
  totalDomains: 1000,
  domainsChecked: 400,
  crawlEvents: { m5: 10, m15: 30, m60: 120 }, // 2 per minute
  distinctBacklinkDomains: 2000,
  keptPending: 0,
  contactEvents: { m5: 0, m15: 0, m60: 0 },
  historicalContactRate: 10, // per minute
  now,
};

test("finished / failed campaigns have no estimate", () => {
  assert.equal(computeCampaignEta({ ...base, status: "completed" }).kind, "none");
  assert.equal(computeCampaignEta({ ...base, status: "failed" }).kind, "none");
});

test("paused and queued are reported as such, not timed", () => {
  assert.equal(computeCampaignEta({ ...base, paused: true }).kind, "paused");
  assert.equal(computeCampaignEta({ ...base, status: "queued" }).kind, "queued");
});

test("too little progress -> estimating", () => {
  const eta = computeCampaignEta({ ...base, crawlEvents: { m5: 1, m15: 3, m60: 3 } });
  assert.equal(eta.kind, "estimating");
});

test("crawl + projected contact add up", () => {
  const eta = computeCampaignEta(base);
  assert.equal(eta.kind, "estimate");
  if (eta.kind !== "estimate") return;
  // crawl: 600 left / 2 per min = 300 min. contact: 2000/0.4 * 0.8 = 4000 prospects / 10 per min = 400 min.
  assert.equal(Math.round(eta.expectedMs / 60_000), 700);
  assert.ok(eta.lowMs < eta.expectedMs && eta.expectedMs < eta.highMs);
  assert.equal(eta.partial, null);
});

test("no contact history -> crawl time only, flagged partial", () => {
  const eta = computeCampaignEta({ ...base, historicalContactRate: null });
  assert.equal(eta.kind, "estimate");
  if (eta.kind !== "estimate") return;
  assert.equal(Math.round(eta.expectedMs / 60_000), 300);
  assert.ok(eta.partial);
});

test("contact stage running uses its own live speed", () => {
  const eta = computeCampaignEta({
    ...base,
    status: "running",
    domainsChecked: 1000,
    contactStageStatus: "running",
    contactStageStartedAt: ago(60),
    keptPending: 600,
    contactEvents: { m5: 50, m15: 150, m60: 600 }, // 10 per minute
  });
  assert.equal(eta.kind, "estimate");
  if (eta.kind !== "estimate") return;
  assert.equal(eta.phase, "contact");
  assert.equal(Math.round(eta.expectedMs / 60_000), 60);
});

test("formatDuration rounds sensibly", () => {
  assert.equal(formatDuration(4 * 60_000), "4 min");
  assert.equal(formatDuration(47 * 60_000), "45 min");
  assert.equal(formatDuration(125 * 60_000), "2h 10m");
  assert.equal(formatDuration(180 * 60_000), "3h");
});
