import robotsParser, { Robot } from "robots-parser";
import { fetchText } from "./httpClient.js";

// Only used to pick which robots.txt group applies; it is never sent to a site.
const USER_AGENT = "Mozilla";

export interface RobotsGate {
  isAllowed: (url: string) => boolean;
}

const allowAll: RobotsGate = { isAllowed: () => true };

export async function loadRobots(domain: string): Promise<RobotsGate> {
  const robotsUrl = `https://${domain}/robots.txt`;
  const res = await fetchText(robotsUrl);
  if (!res.ok || !res.body) return allowAll;

  const robot: Robot = robotsParser(robotsUrl, res.body);
  return {
    isAllowed: (url: string) => robot.isAllowed(url, USER_AGENT) ?? true,
  };
}
