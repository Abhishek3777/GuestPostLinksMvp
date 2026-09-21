import { getDomain } from "tldts";
import { exclusionReason } from "../filter/exclusions.js";

// A prospect can pass Stage 2 under its own name and still lead somewhere we would
// never contact: the domain redirects to a big brand, a parked page, a government
// site, or a domain on the do-not-contact list. Stage 2 never sees that, because
// the redirect only shows up when the site is actually visited. So after the
// contact lookup, the place the site really ended up gets the same exclusion
// rules the prospect itself passed.
//
// "landedOn" is where the homepage redirected to and/or the domain a "this site
// has moved" notice points at. Landing on another host of the SAME registrable
// domain (www., shop., blog.) is not a redirect to anywhere new.
const IGNORED_REASONS = new Set(["", "invalid_domain"]); // odd/unparseable destinations are not grounds to drop a lead

export interface DestinationExclusion {
  reason: string;
  destination: string;
}

export function destinationExclusion(
  rootDomain: string,
  landedOn: (string | null | undefined)[],
  doNotContact: Set<string>
): DestinationExclusion | null {
  const own = getDomain(rootDomain) ?? rootDomain.toLowerCase();
  for (const dest of landedOn) {
    if (!dest) continue;
    const destination = getDomain(dest) ?? dest.toLowerCase();
    if (destination === own) continue;
    const reason = exclusionReason(destination, doNotContact);
    if (!IGNORED_REASONS.has(reason)) return { reason, destination };
  }
  return null;
}
