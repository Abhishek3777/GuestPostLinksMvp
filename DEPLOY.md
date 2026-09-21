# Deploying (Railway or any Docker host)

Two services, one repo. Build context for both is the **repo root**.

| Service   | Dockerfile                  | Railway config               | Listens on |
|-----------|-----------------------------|------------------------------|------------|
| worker    | `deploy/Dockerfile.worker`    | `deploy/railway.worker.json`    | nothing (polls the DB) |
| dashboard | `deploy/Dockerfile.dashboard` | `deploy/railway.dashboard.json` | `$PORT`, health check `/login` |

On Railway: create each service from this repo and point its "Config as code
path" at the matching `railway.*.json`.

## Environment variables

**worker**
- `DATABASE_URL` — required (Supabase pooler, port 6543)
- optional: `PROXY_URL`, `MIN_HOST_INTERVAL_MS`, `CRAWL_CONCURRENCY`, `CONTACT_CONCURRENCY`, `POLL_INTERVAL_MS` (see `.env.example`)

**dashboard**
- `DATABASE_URL` — required
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — required **at build time** (they are baked into the browser bundle; the Dockerfile takes them as build args, which Railway fills from the service's variables)

Never put a `.env` file in the image — `.dockerignore` keeps them out.

## Run the same images locally

    docker build -f deploy/Dockerfile.worker -t gpl-worker .
    docker run --rm --env-file .env gpl-worker

    docker build -f deploy/Dockerfile.dashboard \
      --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... -t gpl-dashboard .
    docker run --rm -p 3000:3000 --env-file dashboard/.env.local gpl-dashboard

Careful: a running worker picks up any queued campaign in the database it is
pointed at, wherever it runs. Run one worker per database.

## Notes
- The worker restarts safely: on start it re-queues whatever the previous
  process was midway through.
- Run a small campaign from the deployed worker first. A datacenter IP can be
  treated differently from a home connection, and the Linux `curl` fallback
  does not always get through where Windows `curl` did.
- The database schema is not migrated by either service. Apply migrations
  yourself (`npm run db:push` / `db:generate`) before first use.
