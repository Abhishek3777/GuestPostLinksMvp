-- rescue_attempts: one row per rescue tier tried per blocked domain, so "how
-- often does the paid proxy actually recover a domain, and at what bandwidth"
-- is a query. Idempotent; run once against the guestpost schema BEFORE
-- deploying the worker that writes to it:
--   psql "$DATABASE_URL_DIRECT" -f dashboard/scripts/rescue-attempts.sql
-- (Until it exists the worker just logs "[rescue-stats] failed to record ..."
-- and carries on; crawls and lookups are unaffected.)
SET search_path TO guestpost;

CREATE TABLE IF NOT EXISTS rescue_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  domain text NOT NULL,
  stage text NOT NULL,          -- crawl | contact
  tier text NOT NULL,           -- direct_browser | proxy_browser | capsolver | proxy_skipped_budget
  recovered boolean NOT NULL,
  result_status text NOT NULL,
  bytes bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rescue_attempts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS rescue_attempts_campaign_idx ON rescue_attempts (campaign_id);
CREATE INDEX IF NOT EXISTS rescue_attempts_created_idx ON rescue_attempts (created_at);

-- The question this exists to answer (per campaign: drop the WHERE and add
-- GROUP BY campaign_id, or leave as-is for overall):
--   SELECT tier,
--          count(*)                                   AS tried,
--          count(*) FILTER (WHERE recovered)          AS recovered,
--          round(100.0 * count(*) FILTER (WHERE recovered) / nullif(count(*),0), 1) AS pct,
--          round(sum(bytes) / 1e9, 2)                 AS gb,
--          round(sum(bytes) / 1e6 / nullif(count(*) FILTER (WHERE recovered),0), 1) AS mb_per_recovery
--   FROM guestpost.rescue_attempts GROUP BY tier ORDER BY tier;
