# Moving GuestPostLinksMvp off Railway onto an office PC

This is a pure infra move — no app code changes, no database migration, no
Supabase changes. Same prod Supabase project, same `campaigns`/`domain_crawl_status`/
`guest_post_links` tables, same data. All that changes is *where* the worker
and dashboard processes run.

Do these steps in order on the office PC.

---

## 0. Before you start

- Pick a PC that stays powered on and online all the time — not a laptop
  that gets closed or put to sleep. Disable Windows sleep/hibernate on it
  (Settings → System → Power → Screen and sleep → set both to Never).
- Confirm `acgdigitalmarketing.com`'s DNS is on Cloudflare (needed for step 7,
  the public URL). If it isn't, that's a one-time DNS move — doesn't touch
  the live WordPress site, you're only adding a new subdomain record later.

## 1. Install prerequisites

- **Node.js** — install the LTS version. Check `package.json` → `engines`
  in the repo for the exact version this project expects.
- **Git**

## 2. Get the code and install dependencies

```
git clone <repo-url>
cd guestPostLinksMvp
npm install

cd dashboard
npm install
cd ..
```

## 3. Install the browser the worker needs for blocked-site escalation

```
npx playwright install chromium
```

(This is the same browser-rescue path that was running on Railway — a
handful of domains that a plain HTTP fetch gets blocked on get retried
through a real Chromium instance. Needs to exist locally too.)

## 4. Copy the environment variables — same prod Supabase, nothing new to create

Pull the current values from Railway (either the Railway dashboard →
each service → Variables tab, or `npx railway variables` from the old
project) and recreate them here exactly as they are. Do **not** generate
new Supabase keys or a new connection string — same project, same database.

- Root `.env` (used by the worker) — needs `DATABASE_URL`, `DATABASE_URL_DIRECT`,
  and the crawl-tuning vars (`CRAWL_CONCURRENCY`, `CONTACT_CONCURRENCY`,
  `MIN_HOST_INTERVAL_MS`, `POLL_INTERVAL_MS`, `BROWSER_CONCURRENCY`, etc.) —
  see `.env.example` for the full list.
- `dashboard/.env.local` — needs the dashboard's Supabase client vars and
  auth config.

## 5. Build the dashboard for production

Don't run `next dev` long-term — it's not built for always-on, multi-user
traffic.

```
cd dashboard
npm run build
cd ..
```

## 6. Keep both processes alive with PM2

PM2 replaces what Railway was doing for you automatically: restart on
crash, restart on reboot.

```
npm install -g pm2

pm2 start "npx tsx src/worker/daemon.ts" --name worker --cwd "<full path to repo root>"
pm2 start "npm start" --name dashboard --cwd "<full path to repo root>\dashboard"

pm2 save
```

Then make PM2 come back after a Windows restart. Simplest route on
Windows: Task Scheduler → create a task that runs `pm2 resurrect` at
user logon. (Alternative: the `pm2-windows-startup` package, if you want
PM2 to install itself as a proper Windows service.)

## 7. Expose it to the team

**If the whole team is physically in the office and never needs remote
access:** skip straight to hitting the PC's LAN IP, e.g.
`http://192.168.x.x:3000`. Set that IP static in the router (or Windows
network settings) so it doesn't drift after a DHCP renewal.

**If anyone needs it from home or outside the office network (recommended
default):** use a Cloudflare Tunnel. Free, no port-forwarding, no public
IP needed, automatic HTTPS, works from anywhere.

```
# install cloudflared, then:
cloudflared tunnel login
cloudflared tunnel create guestpost-dashboard
cloudflared tunnel route dns guestpost-dashboard guestpost.acgdigitalmarketing.com
cloudflared tunnel run --url http://localhost:3000 guestpost-dashboard
```

Run `cloudflared` under PM2 too, same pattern as step 6, so it survives
reboots:

```
pm2 start "cloudflared tunnel run guestpost-dashboard" --name tunnel --cwd "<full path to repo root>"
pm2 save
```

The team then opens `https://guestpost.acgdigitalmarketing.com` exactly
like they opened the Railway URL before.

## 8. Cut over safely

1. Run the office-PC version side by side with Railway for a day.
2. Start a real campaign from the new URL, confirm it crawls and saves
   results normally.
3. Once confirmed, **stop** (don't delete) the Railway `worker` and
   `dashboard` services — keep them off but present as a rollback for a
   week or two.
4. Once you're confident, delete the Railway services to stop the billing.

---

## What does NOT change

- Database: same Supabase project, same tables, same data, same egress/
  storage behavior — including the `processed_posts` fix already shipped.
- Application code: zero logic changes. Every script/command above already
  exists in this repo exactly as Railway was running it.

## Known tradeoff

Railway's infrastructure reliability is being traded for the office's own
power and internet. If the office loses power or internet, the tool is
down for the whole team until someone is physically there to fix it —
that failure mode didn't exist on Railway.
