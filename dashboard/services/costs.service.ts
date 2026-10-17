import { asc, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { costBalanceSnapshots, costLedger, costRailwayDaily } from "@/lib/schema";

// Flat monthly plans — spread evenly over the days of each month.
export const FIXED_COSTS = [
  { service: "Vercel", monthly: 20 },
  { service: "Supabase", monthly: 29.5 },
] as const;
// Services paid by top-up. 2captcha/CapSolver expose a balance (so we can see
// consumption); DataImpulse has no usage API, so it's ledger-only.
export const PREPAID = ["2captcha", "CapSolver", "DataImpulse"] as const;
export const SERVICES = ["Railway", "Vercel", "Supabase", ...PREPAID] as const;
export type CostService = (typeof SERVICES)[number];

export type DailyByService = Record<string, Partial<Record<CostService, number>>>;

export interface LedgerEntry {
  id: string;
  service: string;
  date: string;
  amount: number;
  note: string;
}

export interface CostData {
  today: string;
  dates: string[];
  /** Prepaid services counted when you pay (top-up date). */
  cash: DailyByService;
  /** Prepaid services counted when used (balance drops between snapshots). */
  acc: DailyByService;
  railwaySub: Record<string, Record<string, number>>;
  balances: Record<string, number | null>;
  balancesAt: string | null;
  firstSnap: Record<string, string>;
  ledger: LedgerEntry[];
  detected: { service: string; date: string; amount: number }[];
  collecting: boolean;
  fx: { rate: number; source: "live" | "fallback"; asOf: string | null };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
};
const daysInMonth = (s: string) => {
  const d = new Date(s + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
};

// USD -> INR. Live rate from a free no-key API, cached 12h in-process; falls
// back to USD_INR_RATE (env) or a rough constant if the lookup fails, so the
// page never breaks over a currency conversion.
const FALLBACK_USD_INR = Number(process.env.USD_INR_RATE) || 88;
let fxCache: { at: number; value: CostData["fx"] } | null = null;

async function getUsdInr(): Promise<CostData["fx"]> {
  if (fxCache && Date.now() - fxCache.at < 12 * 3600 * 1000) return fxCache.value;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(5000) });
    const j = (await res.json()) as { result: string; rates?: { INR?: number }; time_last_update_utc?: string };
    const rate = j.rates?.INR;
    if (j.result === "success" && rate && rate > 0) {
      const value = { rate, source: "live" as const, asOf: j.time_last_update_utc ?? null };
      fxCache = { at: Date.now(), value };
      return value;
    }
  } catch {
    /* fall through to the fallback */
  }
  return { rate: FALLBACK_USD_INR, source: "fallback", asOf: null };
}

export async function getCostData(collecting: boolean): Promise<CostData> {
  const today = ymd(new Date());
  const startDay = addDays(today, -89);

  const [fx, railwayRows, ledgerRows, snaps] = await Promise.all([
    getUsdInr(),
    db.select().from(costRailwayDaily).where(gte(costRailwayDaily.day, startDay)),
    db.select().from(costLedger).orderBy(desc(costLedger.paidOn)),
    db.select().from(costBalanceSnapshots).orderBy(asc(costBalanceSnapshots.takenAt)),
  ]);

  const dates: string[] = [];
  for (let d = startDay; d <= today; d = addDays(d, 1)) dates.push(d);
  const cash: DailyByService = {};
  const acc: DailyByService = {};
  for (const d of dates) {
    cash[d] = {};
    acc[d] = {};
  }

  // Railway: priced actual usage (today is partial). Same on both bases.
  const railwaySub: CostData["railwaySub"] = {};
  for (const r of railwayRows) {
    if (!cash[r.day]) continue;
    (railwaySub[r.day] ??= {})[r.label] = r.cost;
    cash[r.day].Railway = acc[r.day].Railway = (cash[r.day].Railway ?? 0) + r.cost;
  }

  for (const f of FIXED_COSTS)
    for (const d of dates) cash[d][f.service] = acc[d][f.service] = f.monthly / daysInMonth(d);

  // Cash basis: top-ups on the date they were paid.
  for (const t of ledgerRows) {
    const svc = t.service as CostService;
    if (cash[t.paidOn]) cash[t.paidOn][svc] = (cash[t.paidOn][svc] ?? 0) + t.amount;
  }

  // Consumed basis: balance drop between consecutive daily snapshots, spread
  // over the days in between. A balance increase is a detected top-up.
  const detected: CostData["detected"] = [];
  const firstSnap: Record<string, string> = {};
  const latest: Record<string, { balance: number; at: Date }> = {};
  for (const svc of PREPAID) {
    const byDay = new Map<string, number>();
    for (const s of snaps) {
      if (s.service !== svc) continue;
      byDay.set(ymd(s.takenAt), s.balance); // last snapshot of the day wins
      latest[svc] = { balance: s.balance, at: s.takenAt };
    }
    const arr = [...byDay];
    if (arr.length) firstSnap[svc] = arr[0][0];
    for (let i = 1; i < arr.length; i++) {
      const drop = arr[i - 1][1] - arr[i][1];
      if (drop < 0) {
        detected.push({ service: svc, date: arr[i][0], amount: -drop });
        continue;
      }
      const span: string[] = [];
      for (let d = addDays(arr[i - 1][0], 1); d <= arr[i][0]; d = addDays(d, 1)) span.push(d);
      for (const d of span) if (acc[d]) acc[d][svc] = (acc[d][svc] ?? 0) + drop / span.length;
    }
  }

  const latestAt = Object.values(latest).reduce<Date | null>((m, v) => (!m || v.at > m ? v.at : m), null);
  return {
    today,
    dates,
    cash,
    acc,
    railwaySub,
    balances: Object.fromEntries(PREPAID.map((s) => [s, latest[s]?.balance ?? null])),
    balancesAt: latestAt?.toISOString() ?? null,
    firstSnap,
    ledger: ledgerRows.map((t) => ({ id: t.id, service: t.service, date: t.paidOn, amount: t.amount, note: t.note })),
    detected,
    collecting,
    fx,
  };
}

export async function addLedgerEntry(e: { service: string; date: string; amount: number; note: string }) {
  await db.insert(costLedger).values({ service: e.service, paidOn: e.date, amount: e.amount, note: e.note });
}

export async function deleteLedgerEntry(id: string) {
  await db.delete(costLedger).where(eq(costLedger.id, id));
}
