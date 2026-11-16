import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getLeadsReport, istDate, type LeadCounts } from "@/services/leads.service";
import { LeadsFilters } from "@/components/LeadsFilters";
import { LeadsChart } from "@/components/LeadsChart";

export const dynamic = "force-dynamic";

const num = (n: number) => n.toLocaleString("en-US");

function pct(part: number, whole: number) {
  return whole ? `${Math.round((part / whole) * 100)}%` : "0%";
}

function dayLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function periodLabel(range: string, from: string, to: string) {
  if (range === "today") return "today";
  if (range === "7d") return "the last 7 days";
  if (range === "30d") return "the last 30 days";
  if (range === "90d") return "the last 90 days";
  return `${dayLabel(from)} to ${dayLabel(to)}`;
}

function change(current: number, previous: LeadCounts | null, label: string) {
  if (!previous || previous.total === 0) return null;
  const diff = Math.round(((current - previous.total) / previous.total) * 100);
  if (diff === 0) return `Same as ${label}`;
  return `${diff > 0 ? "Up" : "Down"} ${Math.abs(diff)}% from ${label}`;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; user?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const report = await getLeadsReport(await searchParams);
  const { totals, previous, days, byMember, rows } = report;
  const selectedMember = report.members.find((m) => m.id === report.userId);
  const delta = change(totals.total, previous, report.previousLabel);

  const cards = [
    { label: "Email only", value: totals.emailOnly },
    { label: "Contact form only", value: totals.formOnly },
    { label: "Email and form", value: totals.both },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">Leads</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Contactable leads found across campaigns. A lead is a site where we found an email address, a contact form, or both.
        </p>
      </div>

      <LeadsFilters
        range={report.range}
        from={report.from}
        to={report.to}
        userId={report.userId}
        members={report.members}
        today={istDate(new Date())}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="text-xs font-medium text-muted">Total leads</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-text">{num(totals.total)}</div>
          <div className="mt-1 text-xs text-muted">
            {delta ??
              `From ${report.campaignCount} ${report.campaignCount === 1 ? "campaign" : "campaigns"} in ${periodLabel(report.range, report.from, report.to)}`}
          </div>
        </div>
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-surface p-4">
            <div className="text-xs font-medium text-muted">{c.label}</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-text">{num(c.value)}</div>
            <div className="mt-1 text-xs text-muted">{pct(c.value, totals.total)} of leads</div>
          </div>
        ))}
      </div>

      {totals.total === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-14 text-center">
          <p className="text-sm font-medium text-text">No leads found for this period</p>
          <p className="mt-1 text-sm text-muted">
            {selectedMember ? `${selectedMember.label} has no finished campaigns in this range. ` : ""}
            Try a longer range or a different member.
          </p>
        </div>
      ) : (
        <>
          {days.length > 1 && (
            <section className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-3 text-sm font-medium text-muted">Leads per day</h2>
              <LeadsChart days={days} />
            </section>
          )}

          {!report.userId && byMember.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-muted">By member</h2>
              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
                      <th className="px-5 py-3">Member</th>
                      <th className="px-5 py-3 text-right">Campaigns</th>
                      <th className="px-5 py-3 text-right">Email only</th>
                      <th className="px-5 py-3 text-right">Form only</th>
                      <th className="px-5 py-3 text-right">Both</th>
                      <th className="px-5 py-3 text-right">Total leads</th>
                      <th className="px-5 py-3 text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byMember.map((m) => (
                      <tr key={m.id ?? "none"} className="border-b border-border last:border-0 hover:bg-surface-2">
                        <td className="px-5 py-3 font-medium text-text">{m.label}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted">{num(m.campaigns)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted">{num(m.emailOnly)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted">{num(m.formOnly)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted">{num(m.both)}</td>
                        <td className="px-5 py-3 text-right font-medium tabular-nums text-text">{num(m.total)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted">{pct(m.total, totals.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-medium text-muted">Campaigns</h2>
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wide text-muted">
                    <th className="px-5 py-3">Campaign</th>
                    {!report.userId && <th className="px-5 py-3">Member</th>}
                    <th className="px-5 py-3">Finished</th>
                    <th className="px-5 py-3 text-right">Email only</th>
                    <th className="px-5 py-3 text-right">Form only</th>
                    <th className="px-5 py-3 text-right">Both</th>
                    <th className="px-5 py-3 text-right">Total leads</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const owner = report.members.find((m) => m.id === c.ownerId)?.label ?? c.ownerEmail ?? "Unassigned";
                    return (
                      <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                        <td className="px-5 py-3 font-medium text-text">
                          <Link href={`/campaigns/${c.id}`} className="hover:text-accent hover:underline">
                            {c.name}
                          </Link>
                          {c.inProgress && (
                            <span className="ml-2 rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-medium text-info">
                              Still running
                            </span>
                          )}
                        </td>
                        {!report.userId && <td className="px-5 py-3 text-muted">{owner}</td>}
                        <td className="px-5 py-3 text-muted">{c.inProgress ? "In progress" : dayLabel(c.date)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted">{num(c.emailOnly)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted">{num(c.formOnly)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted">{num(c.both)}</td>
                        <td className="px-5 py-3 text-right font-medium tabular-nums text-text">{num(c.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <p className="max-w-3xl text-xs leading-relaxed text-muted">
            Each campaign is counted on the day its contact lookup finished, in Indian Standard Time. Campaigns that are still running
            count toward today with the leads found so far. Every lead is a different site, because a site already contacted in
            another campaign is left out of later ones.
          </p>
        </>
      )}
    </div>
  );
}
