"use client";

const TONE_BG: Record<string, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-muted",
};

const TONE_DOT: Record<string, string> = TONE_BG;

export interface Segment {
  key: string; // raw value used for filtering — e.g. "blocked", "do_not_contact"
  label: string; // human-readable display text — e.g. "blocked", "do not contact"
  value: number;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
}

interface ProportionBarProps {
  segments: Segment[];
  onSegmentClick?: (key: string) => void;
  activeKey?: string | null;
}

// A single stacked horizontal bar + legend — turns "3 success, 1 blocked"
// buried in a table into something scannable at a glance. When
// onSegmentClick is given, segments act as filter toggles for a table below.
export function ProportionBar({ segments, onSegmentClick, activeKey }: ProportionBarProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const visible = segments.filter((s) => s.value > 0);
  const clickable = Boolean(onSegmentClick);

  if (total === 0) {
    return <div className="h-2 w-full rounded-full bg-surface-2" />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2">
        {visible.map((s) => (
          <button
            key={s.key}
            type="button"
            disabled={!clickable}
            onClick={() => onSegmentClick?.(s.key)}
            className={`${TONE_BG[s.tone]} ${clickable ? "cursor-pointer transition-opacity hover:opacity-80" : ""} ${
              activeKey && activeKey !== s.key ? "opacity-40" : ""
            }`}
            style={{ width: `${(s.value / total) * 100}%` }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
        {visible.map((s) => (
          <button
            key={s.key}
            type="button"
            disabled={!clickable}
            onClick={() => onSegmentClick?.(s.key)}
            className={`flex items-center gap-1.5 text-muted ${clickable ? "cursor-pointer hover:text-text" : ""} ${
              activeKey === s.key ? "font-medium text-text" : ""
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${TONE_DOT[s.tone]}`} />
            <span className="text-text">{s.value}</span>
            <span>{s.label}</span>
            <span className="text-muted">({Math.round((s.value / total) * 100)}%)</span>
          </button>
        ))}
      </div>
      {clickable && activeKey && (
        <button type="button" onClick={() => onSegmentClick?.(activeKey)} className="self-start text-xs text-accent hover:underline">
          Clear filter
        </button>
      )}
    </div>
  );
}
