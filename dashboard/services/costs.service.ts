import { asc, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { costBalanceSnapshots, costLedger, costRailwayDaily, costRailwayReal, costVercelDaily } from "@/lib/schema";

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
  /** Cost per day per service; prepaid services count on the day they were paid. */
  cash: DailyByService;
  railwaySub: Record<string, Record<string, number>>;
  /** Railway's OWN real current-period total per tracked project — not our estimate above. Null until the first successful collection. */
  railwayReal: { periodStart: string; total: number; byProject: { projectName: string; usageDollars: number }[]; collectedAt: string } | null;
  /** Vercel billed items per day (Pro, extra seats, usage); empty until a Vercel token is set. */
  vercelSub: Record<string, Record<string, number>>;
  balances: Record<string, number | null>;
  balancesAt: string | null;
  ledger: LedgerEntry[];
  /** Top-ups spotted from a balance jump; `counted` is false when a manual entry already covers it. */
  detected: { service: string; date: string; amount: number; counted: boolean }[];
  collecting: boolean;
  fx: { rate: number; source: "live" | "fallback"; asOf: string | null };
}

// A balance rise smaller than this isn't treated as a top-up (rounding, refunds).
const MIN_DETECTED_TOPUP = 1;

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

export function detectTopups(
  snaps: { service: string; balance: number; takenAt: Date }[],
  ledger: { service: string; paidOn: string }[],
) {
  const detected: CostData["detected"] = [];
  const latest: Record<string, { balance: number; at: Date }> = {};
  for (const svc of PREPAID) {
    let prev: number | null = null;
    for (const s of snaps) {
      if (s.service !== svc) continue;
      latest[svc] = { balance: s.balance, at: s.takenAt };
      if (prev !== null && s.balance - prev >= MIN_DETECTED_TOPUP) {
        const date = ymd(s.takenAt);
        const amount = Math.round((s.balance - prev) * 100) / 100;
        const duplicate = ledger.some(
          (t) => t.service === svc && (t.paidOn === date || t.paidOn === addDays(date, -1) || t.paidOn === addDays(date, 1)),
        );
        detected.push({ service: svc, date, amount, counted: !duplicate });
      }
      prev = s.balance;
    }
  }
  return { detected, latest };
}

export async function getCostData(collecting: boolean): Promise<CostData> {
  const today = ymd(new Date());
  const startDay = addDays(today, -89);

  const [fx, railwayRows, vercelRows, ledgerRows, snaps, railwayRealRows] = await Promise.all([
    getUsdInr(),
    db.select().from(costRailwayDaily).where(gte(costRailwayDaily.day, startDay)),
    db.select().from(costVercelDaily).where(gte(costVercelDaily.day, startDay)),
    db.select().from(costLedger).orderBy(desc(costLedger.paidOn)),
    db.select().from(costBalanceSnapshots).orderBy(asc(costBalanceSnapshots.takenAt)),
    db.select().from(costRailwayReal).orderBy(desc(costRailwayReal.periodStart)),
  ]);

  // Only the most recent billing period's rows — periodStart is the same for
  // every project within one pull, so the first row's date defines the set.
  const latestPeriod = railwayRealRows[0]?.periodStart ?? null;
  const currentPeriodRows = latestPeriod ? railwayRealRows.filter((r) => r.periodStart === latestPeriod) : [];
  const railwayReal: CostData["railwayReal"] = currentPeriodRows.length
    ? {
        periodStart: latestPeriod!,
        total: currentPeriodRows.reduce((sum, r) => sum + r.usageDollars, 0),
        byProject: currentPeriodRows.map((r) => ({ projectName: r.projectName, usageDollars: r.usageDollars })),
        collectedAt: currentPeriodRows.reduce((m, r) => (r.collectedAt > m ? r.collectedAt : m), currentPeriodRows[0].collectedAt).toISOString(),
      }
    : null;

  const dates: string[] = [];
  for (let d = startDay; d <= today; d = addDays(d, 1)) dates.push(d);
  const cash: DailyByService = {};
  for (const d of dates) cash[d] = {};

  // Railway: priced actual usage (today is partial).
  const railwaySub: CostData["railwaySub"] = {};
  for (const r of railwayRows) {
    if (!cash[r.day]) continue;
    (railwaySub[r.day] ??= {})[r.label] = r.cost;
    cash[r.day].Railway = (cash[r.day].Railway ?? 0) + r.cost;
  }

  // Vercel: real billed charges where we have them, flat plan price otherwise.
  const vercelSub: CostData["vercelSub"] = {};
  for (const r of vercelRows) {
    if (!cash[r.day]) continue;
    (vercelSub[r.day] ??= {})[r.label] = r.cost;
    cash[r.day].Vercel = (cash[r.day].Vercel ?? 0) + r.cost;
  }
  for (const f of FIXED_COSTS)
    for (const d of dates) {
      if (f.service === "Vercel" && vercelSub[d]) continue; // actual charges win
      cash[d][f.service] = f.monthly / daysInMonth(d);
    }

  // Cash basis: top-ups on the date they were paid.
  for (const t of ledgerRows) {
    const svc = t.service as CostService;
    if (cash[t.paidOn]) cash[t.paidOn][svc] = (cash[t.paidOn][svc] ?? 0) + t.amount;
  }

  // Auto-detected top-ups (2captcha / CapSolver): a balance that jumps up
  // between two consecutive readings means money was added. Counted like a
  // ledger entry, unless you already entered one for that service within a day
  // of it (then the manual entry wins, so nothing is counted twice).
  const { detected, latest } = detectTopups(snaps, ledgerRows);
  for (const t of detected)
    if (t.counted && cash[t.date]) cash[t.date][t.service as CostService] = (cash[t.date][t.service as CostService] ?? 0) + t.amount;

  const latestAt = Object.values(latest).reduce<Date | null>((m, v) => (!m || v.at > m ? v.at : m), null);
  return {
    today,
    dates,
    cash,
    railwaySub,
    railwayReal,
    vercelSub,
    balances: Object.fromEntries(PREPAID.map((s) => [s, latest[s]?.balance ?? null])),
    balancesAt: latestAt?.toISOString() ?? null,
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
