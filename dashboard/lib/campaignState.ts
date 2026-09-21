// What the user should SEE for a campaign, given that "paused" is a flag layered on
// top of the worker's own statuses:
//   pausing = pause pressed, sites already in flight are still finishing
//   paused  = parked; nothing is running until Resume
export interface CampaignStateInput {
  status: string;
  contactStageStatus: string;
  paused: boolean;
}

export function isActive(c: CampaignStateInput): boolean {
  return (
    c.status === "queued" ||
    c.status === "running" ||
    c.contactStageStatus === "queued" ||
    c.contactStageStatus === "running"
  );
}

export function isWorking(c: CampaignStateInput): boolean {
  return c.status === "running" || c.contactStageStatus === "running";
}

export function displayStatus(c: CampaignStateInput): string {
  if (c.paused && isActive(c)) return isWorking(c) ? "pausing" : "paused";
  return c.status;
}

// Something the user can pause, or something that is paused and can be resumed.
export function canPauseOrResume(c: CampaignStateInput): "pause" | "resume" | null {
  if (!isActive(c)) return null;
  return c.paused ? "resume" : "pause";
}
