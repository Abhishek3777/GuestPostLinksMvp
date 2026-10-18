-- Worker health (admin card on the Campaigns page). The worker creates this
-- itself on startup, so running this is optional — it exists so the dashboard
-- can be pointed at a fresh database before a worker has ever started.
SET search_path TO guestpost;

CREATE TABLE IF NOT EXISTS worker_heartbeat (
  id integer PRIMARY KEY DEFAULT 1,
  last_beat_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  host text,
  pid integer
);
