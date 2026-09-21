import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const toneStyles: Record<string, string> = {
    neutral: "bg-surface-2 text-muted",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    info: "bg-info-soft text-info",
  };

  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-border bg-surface p-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${toneStyles[tone]}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-muted">{label}</div>
        <div className="text-xl font-semibold tracking-tight text-text">{value}</div>
      </div>
    </div>
  );
}
