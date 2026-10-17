-- Cost dashboard (/costs) tables. Idempotent; run once against the guestpost schema:
--   psql "$DATABASE_URL_DIRECT" -f dashboard/scripts/cost-tables.sql
-- (or `npm run db:push` from the repo root, which diffs against the live DB.)
SET search_path TO guestpost;

CREATE TABLE IF NOT EXISTS cost_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  paid_on date NOT NULL,
  amount double precision NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cost_balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  balance double precision NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cost_balance_snapshots_service_taken_idx ON cost_balance_snapshots (service, taken_at);
CREATE TABLE IF NOT EXISTS cost_railway_daily (
  day date NOT NULL,
  label text NOT NULL,
  cost double precision NOT NULL,
  PRIMARY KEY (day, label)
);
ALTER TABLE cost_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_balance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_railway_daily ENABLE ROW LEVEL SECURITY;

-- Past top-ups (from the payment screenshots, 2026-10-17).
INSERT INTO cost_ledger (service, paid_on, amount, note)
SELECT * FROM (VALUES
  ('DataImpulse', DATE '2026-09-15', 10::double precision, 'Stripe'),
  ('DataImpulse', DATE '2026-09-22', 50, 'Stripe'),
  ('DataImpulse', DATE '2026-10-14', 50, 'Stripe'),
  ('2captcha',    DATE '2026-09-01', 20, 'Stripe'),
  ('2captcha',    DATE '2026-09-22', 20, 'Stripe'),
  ('2captcha',    DATE '2026-10-09', 20, 'Stripe'),
  ('CapSolver',   DATE '2026-09-01', 20, 'card'),
  ('CapSolver',   DATE '2026-09-22', 20, 'card'),
  ('CapSolver',   DATE '2026-10-09', 20, 'card')
) AS v(service, paid_on, amount, note)
WHERE NOT EXISTS (SELECT 1 FROM cost_ledger);
