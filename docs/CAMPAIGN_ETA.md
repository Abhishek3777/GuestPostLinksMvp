# Campaign estimated finish time

Every running campaign shows how long it has left and roughly when it will be
done, end to end (crawl **and** contact lookup). This page explains what the
number means (part 1, for anyone) and how it is built (part 2, for developers).

---

# Part 1: For everyone (no technical background needed)

## What you see

| Where | What it shows |
|---|---|
| Campaigns list, under the progress bar | `~6h 20m left` (hover for the range and the finish time) |
| Campaign page (Overview) and Contact results page, under the title | `Estimated 5h – 8h left · finishes around Oct 1, 4:30 AM IST` |

Other messages you may see instead of a time:

| Message | Meaning |
|---|---|
| **Estimating…** | The campaign has only just started (or restarted). We need a few minutes of real progress before we can say anything honest. |
| **Waiting for a worker slot** | The campaign is queued behind others. It isn't running yet, so it has no time. |
| **Paused** | Nothing is running. The estimate comes back after Resume. |
| A time with a `*` | The estimate covers only part of the work. Hover to see which part (see "Known limits"). |
| *(nothing)* | The campaign is finished, or failed. |

## How it works, in one picture

It works like the ETA in a taxi app. The app doesn't know the trip time in
advance. It watches how fast you are moving **right now** and divides the
distance left by that speed.

> **time left = work left ÷ current speed**

A campaign has two jobs, done one after the other:

1. **Crawl**: visit each domain you gave us and collect the backlinks.
2. **Contact lookup**: for every backlink domain we kept as a prospect, find an
   email or contact form.

We work out the time left for each job and add them up.

### Worked example

- The crawl has 4,645 domains. 2,000 are done, so **2,645 are left**.
- In the last 15 minutes the crawler finished 30 domains, which is **2 per minute**.
- Crawl time left: 2,645 ÷ 2 = about 1,320 minutes (22 hours).

The contact lookup hasn't started, so we don't yet know how many prospects there
will be. We predict it from what has been found so far: if the first 2,000
domains produced 10,000 backlink domains, all 4,645 should produce about 23,000.
Roughly 80% of those are kept as prospects (the rest are big brands, gov/edu
sites, do-not-contact and so on), so about **18,500 lookups**. At the speed
measured from past campaigns (say 10 a minute), that is about 31 hours. Add the
two parts for the total.

Once the crawl finishes, the prediction is replaced with the real number of
prospects, and the estimate gets more accurate.

### Why it's a range, not one number

Speed isn't constant. If a site starts blocking us, or a proxy fails, the crawl
slows down. So we work out one time using the fastest recent speed and one using
the slowest. That gives "5h – 8h", and the "finishes around" time is in the
middle. **If you need to plan around it, plan for the later end of the range.**

### Why it changes

It is re-measured every time the page loads (the result is held for 30 seconds
so a busy dashboard doesn't redo it constantly). If the campaign speeds up, the
time left drops faster than the clock. If it slows down, the time left can go
*up*. That is the estimate correcting itself, not a bug.

## Known limits (be upfront with whoever is waiting on it)

- **It is a forecast, not a promise.** Sites that block us, timeouts and proxy
  trouble all slow things down and can't be predicted.
- **Early numbers are rough.** It won't show a time for the first few minutes.
  Within the first hour or two, expect it to move a lot.
- **Contact time before the crawl ends is partly a guess.** That part is padded
  by ±15%.
- **No past campaigns to learn from yet.** The contact-lookup speed is learned
  from earlier campaigns. If there are none, the crawl time is shown with a `*`
  saying contact lookup time can't be added until that stage has started and we
  have watched its speed.
- **"Crawl only" campaigns.** If contact lookup isn't set to run automatically
  after the crawl, the estimate covers only the crawl and says so.
- **Several campaigns at once.** The worker can run up to 3 campaigns at the
  same time and they share its capacity, so a campaign can slow down when
  another starts. The estimate catches up once it notices.
- **Pausing.** Time spent paused slightly drags down the recent speed for a few
  minutes after Resume.

---

# Part 2: For developers

## Files

| File | Role |
|---|---|
| `dashboard/lib/campaignEta.ts` | The maths. Pure functions, no DB, no React. `computeCampaignEta()`, `formatDuration()`, `formatFinishTime()`. |
| `dashboard/lib/campaignEta.test.ts` | Unit tests for the above (run from the repo root, see below). |
| `dashboard/services/campaigns.service.ts` | `getCampaignEtas(rows)` gathers the inputs with aggregate SQL and calls the maths. Also `getHistoricalContactRate()`. |
| `dashboard/components/CampaignEtaLabel.tsx` | Display. `variant="compact"` (list) or `"full"` (headers). |
| `dashboard/app/page.tsx`, `app/campaigns/[id]/page.tsx`, `.../contacts/page.tsx` | Call `getCampaignEtas` and render the label. |

No schema change and nothing new is stored. Everything is computed at read time
from timestamps the worker already writes.

## Inputs (all already in the database)

| Input | Source |
|---|---|
| Crawl progress events (finished in last 5/15/60 min) | `domain_crawl_status.checked_at` |
| Domains total / checked | `campaign_domains`, `domain_crawl_status` row counts |
| Backlink domains found so far | `count(distinct root_domain)` in `guest_post_links` (only while crawling with `auto_contact`) |
| Contact lookups remaining | `guest_post_prospects` where `exclusion_reason is null and contact_checked_at is null` |
| Contact progress events (5/15/60 min) | `guest_post_prospects.contact_checked_at` |
| Historic contact speed | all prospects checked in the last 30 days, per campaign with 50+ lookups: lookups ÷ (last check − first check). Cached 10 min. |
| Phase and state | `campaigns.status`, `contact_stage_status`, `paused`, `auto_contact`, `mode`, `started_at`, `contact_stage_started_at` |

Each query is an aggregate returning a few numbers per campaign (no rows), runs
only for campaigns that are queued or running, and the combined result is cached
in memory per campaign for 30 s. This is deliberate: the dashboard previously had
an egress problem from fetching rows (see the note at the top of
`campaigns.service.ts`), and this adds essentially none.

## Algorithm

```
state:
  not queued/running in either stage  -> none
  paused                              -> paused
  crawl queued                        -> queued

speed(window)   = events in window / min(window, minutes the stage has run)
central         = speed(15 min)
fast / slow     = max / min of speed(5), speed(15), speed(60),
                  clamped to [central/2, central*2]

CRAWL (discovery, contact stage not started):
  needs >= 3 min running AND >= 10 events in 15 min, else "estimating"
  crawl time = domains_left / speed
  if auto_contact:
     fraction   = domains_checked / total_domains
     prospects  = distinct_backlink_domains / fraction * KEEP_RATIO   (0.8)
     (once the crawl is finished: no division, and no +/-15% spread)
     contact time = prospects / historical_contact_rate
  total = crawl time + contact time

CONTACT (stage running/queued, or a direct campaign):
  remaining = kept prospects with contact_checked_at null
  use the live contact speed once it has >= 3 min and >= 10 events;
  otherwise the historical speed (covers "queued" and the first minutes)
  time = remaining / speed

low  = every part at its `fast` speed (projected workload -15%)
high = every part at its `slow` speed (projected workload +15%)
expected = every part at `central`
finishAt = now + expected
```

### Constants (top of `campaignEta.ts`)

| Constant | Value | Why |
|---|---|---|
| `KEEP_RATIO` | 0.8 | First real campaign: 26,572 kept of 33,140 saved. Change if later campaigns differ a lot. |
| `PROJECTION_SPREAD` | ±15% | Extra width while the contact workload is still a projection. |
| `MIN_MINUTES_RUNNING` / `MIN_EVENTS_15M` | 3 min / 10 | Below this we say "Estimating…". |
| `MAX_SPEED_SWING` | 2× | The range never extends beyond half or double the 15-minute speed. |

### Choices worth knowing about

- **Recent speed, not the average since the start.** Domain cost varies hugely
  (a site with 1,000 posts vs a DNS error), so the overall average is too
  optimistic or pessimistic depending on when you look.
- **No invented numbers.** With no historical contact speed, the contact part
  isn't guessed: the crawl time is shown with `partial` set and a `*` in the UI.
- **"Stalled".** If nothing finished in the last 15 minutes the label is
  "Estimating… No progress in the last 15 minutes", not a huge number.
- **Timezone.** Finish time is formatted server-side in `Asia/Kolkata`
  (the container clock is UTC), same as the campaigns list.

## Testing

From the repo root:

```
npx tsx --test dashboard/lib/campaignEta.test.ts
```

Covers: finished/failed, paused, queued, too-little-progress, crawl + contact
adding up (expected 700 min in the fixture), missing history, and duration
formatting. The SQL in `getCampaignEtas` is not covered by automated tests; the
easiest check is to open a running campaign and compare the numbers against a
manual calculation from the counts on the page.

## Ideas for later

- A pre-start estimate on the "New Campaign" form, once there are enough
  finished campaigns to learn a crawl speed from.
- Storing periodic progress snapshots to draw a progress graph and to compare
  forecast vs. actual finish time (useful to tune the constants above).
- Reading the speed per campaign when several run at once, instead of the
  shared worker's overall pace.

## Speeding a campaign up (related, not part of the estimate)

The contact stage speed is roughly `CONTACT_CONCURRENCY` (default 8 sites at a
time) divided by the time one lookup takes. Splitting the worker into two
services does **not** speed up one campaign, because the contact stage only starts
after the crawl. What does: raising `CONTACT_CONCURRENCY` (Railway env var; the
DB pool in `src/db/client.ts` is 25, so ~20–24 is about the ceiling without
raising it), giving the worker more CPU/memory, and reducing time lost to
timeouts (15 s + 4 s + retry) and the browser fallback, which is capped at 2
pages at a time (`browserLimit` in `src/rescueFetchers.ts`).
