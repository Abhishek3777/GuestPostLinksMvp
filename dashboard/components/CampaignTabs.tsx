import Link from "next/link";

// Top-of-page tab switcher between the Stage 1 overview and Stage 3 contact
// results — lives right under the title, not at the bottom, so it's reachable
// without scrolling past however many thousand domains Stage 1 has.
export function CampaignTabs({
  campaignId,
  active,
  contactStageStarted,
}: {
  campaignId: string;
  active: "overview" | "contacts";
  contactStageStarted: boolean;
}) {
  if (!contactStageStarted) return null;

  const tabs = [
    { key: "overview" as const, label: "Overview", href: `/campaigns/${campaignId}` },
    { key: "contacts" as const, label: "Contact results", href: `/campaigns/${campaignId}/contacts` },
  ];

  return (
    <div className="flex w-fit rounded-lg border border-border bg-surface p-0.5 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`rounded-md px-3.5 py-1.5 font-medium transition-colors ${
            active === tab.key ? "bg-accent-soft text-accent" : "text-muted hover:text-text"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
