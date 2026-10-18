import { fallbackDescription, fetchText, type Fetcher } from "../httpClient.js";
import {
  CONTACT_FALLBACK_PATHS,
  detectContactForm,
  detectSuccessorNotice,
  extractEmailsDetailed,
  findContactPageUrl,
  findSecondaryPageUrls,
  type DetectedEmail,
} from "./emails.js";
import { rankEmails } from "./rankEmails.js";

export type ContactOutcome =
  | "has_email"
  | "form_only"
  | "no_contact_found"
  | "blocked"
  | "dns_error"
  | "timeout"
  | "error";

export interface ContactResult {
  status: ContactOutcome;
  emailAddress: string | null; // the emails worth contacting, best first, comma-separated
  contactFormUrl: string | null;
  finalDomain: string | null;
  // Set when the homepage is a "this site has moved to X" notice: the domain it
  // points at. The caller re-checks it against the exclusion rules.
  successorDomain?: string | null;
  // WHY, in plain terms — filled for every non-happy outcome so a blank
  // Email/Contact Form cell is never unexplained. Also lists any emails that
  // were found but not kept.
  reason: string | null;
  // The homepage HTML this function already fetched — exposed so the caller
  // (contactStage.ts) can run the gambling/institutional/relevance checks
  // against it without a second fetch of the same page. Null whenever the
  // homepage itself never loaded (the early-return failure case below).
  homepageHtml: string | null;
}

function stripWww(hostname: string): string {
  return hostname.replace(/^www\./, "");
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

// Sites that redirect every unknown address to the homepage would otherwise look
// like they have a contact page at whatever we guess.
function bouncedToHomepage(page: { url?: string }, requestedUrl: string): boolean {
  return pathOf(page.url ?? requestedUrl).replace(/\/+$/, "") === "";
}

// ...and so would sites that answer a made-up address with a 200 "page not found".
function looksLikeRealPage(page: { body?: string }): boolean {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(page.body ?? "")?.[1] ?? "";
  return !/\b404\b|not found|page (does not|doesn't) exist|nothing (was )?found/i.test(title);
}

export type { Fetcher };

export async function findContact(domain: string, baseFetcher: Fetcher = fetchText, signal?: AbortSignal): Promise<ContactResult> {
  // Wrapped once so every fetch this function makes carries the
  // cancellation signal automatically — see pipeline.ts's crawlDomain for
  // the matching pattern and util.ts's withTimeout for why this exists.
  const fetcher: Fetcher = signal ? (url) => baseFetcher(url, signal) : baseFetcher;
  const bare = await fetcher(`https://${domain}/`);
  let homepage = bare;
  let triedWww = false;

  // Some sites 400/DNS-fail on the bare domain and only resolve under www.
  if (!bare.ok && (bare.errorReason === "dns_error" || bare.errorReason === "error")) {
    triedWww = true;
    homepage = await fetcher(`https://www.${domain}/`);
  }

  if (!homepage.ok || !homepage.body) {
    const detail = homepage.failureDetail ?? homepage.errorReason ?? "unknown";
    const bareDetail = bare.failureDetail ?? bare.errorReason ?? "unknown";
    return {
      status: homepage.errorReason ?? "error",
      emailAddress: null,
      contactFormUrl: null,
      finalDomain: null,
      homepageHtml: null,
      reason: !triedWww
        ? `homepage: ${detail}`
        : bareDetail === detail
          ? `homepage: ${detail} (same for bare domain and www)`
          : `homepage: ${bareDetail} (bare domain), ${detail} (www)`,
    };
  }

  const homeUrl = homepage.url ?? `https://${domain}/`;
  const finalDomain = homepage.url ? stripWww(new URL(homepage.url).hostname) : null;
  const redirectedTo = finalDomain && finalDomain !== domain ? finalDomain : null;

  // Every email seen anywhere; ranking happens once at the end, over the lot.
  const detected: DetectedEmail[] = [...extractEmailsDetailed(homepage.body)];
  const homepageForm = detectContactForm(homepage.body);
  const notes: string[] = [];
  const successorDomain = detectSuccessorNotice(homepage.body, domain);
  if (successorDomain) notes.push(`the site says it has moved to ${successorDomain}`);

  // --- The contact page -------------------------------------------------------
  let contactPageUrl = findContactPageUrl(homepage.body, homeUrl, domain);
  let contactPageForm: { type: string } | null = null;
  let contactPageReadable = false;

  if (contactPageUrl && contactPageUrl !== homepage.url) {
    const page = await fetcher(contactPageUrl);
    if (page.ok && page.body) {
      contactPageReadable = true;
      detected.push(...extractEmailsDetailed(page.body));
      contactPageForm = detectContactForm(page.body);
    } else {
      notes.push(`contact page ${page.errorReason ?? "failed"}: ${page.failureDetail ?? "unknown"}`);
    }
  } else if (contactPageUrl) {
    contactPageReadable = true; // the "contact" link points back at the page we already read
    contactPageForm = homepageForm;
  } else {
    // The homepage links to no contact page. Menus built by JavaScript, links
    // hidden inside images and unusual footers all look like this, and the
    // site very often still HAS /contact — so ask for the usual addresses.
    for (const path of CONTACT_FALLBACK_PATHS) {
      const url = new URL(path, homeUrl).href;
      const page = await fetcher(url);
      if (!page.ok || !page.body) continue;
      if (bouncedToHomepage(page, url)) break; // a catch-all redirect: the other guesses would bounce too
      if (!looksLikeRealPage(page)) continue;
      contactPageUrl = page.url ?? url;
      contactPageReadable = true;
      detected.push(...extractEmailsDetailed(page.body));
      contactPageForm = detectContactForm(page.body);
      notes.push(`no contact link on the homepage; found ${path} by trying common addresses`);
      break;
    }
  }

  // --- About / Team / Write-for-us pages, only when nothing has turned up yet --
  // Stops at the first page that yields an email, so the extra cost is at most
  // two more requests, and only when needed.
  let secondaryForm: { url: string; type: string } | null = null;
  const secondaryChecked: string[] = [];
  let foundOnSecondary: string | null = null;
  if (detected.length === 0) {
    const candidates = findSecondaryPageUrls(homepage.body, homeUrl, domain, 2);
    for (const url of candidates) {
      if (url === homepage.url || url === contactPageUrl) continue;
      const page = await fetcher(url);
      secondaryChecked.push(pathOf(url));
      if (!page.ok || !page.body) continue;
      const found = extractEmailsDetailed(page.body);
      const form = detectContactForm(page.body);
      if (form && !secondaryForm) secondaryForm = { url, type: form.type };
      if (found.length) {
        detected.push(...found);
        foundOnSecondary = pathOf(url);
        break;
      }
    }
  }

  // --- Which emails are worth keeping ---------------------------------------
  const ranked = rankEmails(detected, [domain, redirectedTo ?? ""]);
  const emailAddress = ranked.kept.length ? ranked.kept.join(", ") : null;

  // --- Which page is the contact form -----------------------------------------
  // Only a page where an actual <form> (or a known form embed) was seen counts as
  // confirmed. Order: the contact page, then the homepage, then an About-type page.
  const confirmedFormUrl = contactPageForm
    ? contactPageUrl
    : homepageForm
      ? homeUrl
      : (secondaryForm?.url ?? null);
  // A contact page whose form we could not see (no <form> in the HTML, or the
  // page could not be read at all). With no email to fall back on it is still
  // the best lead there is — the form may be loaded by JavaScript, and a person
  // can open the page — so it is offered and labelled as unconfirmed. When an
  // email WAS found it is left out, so the Contact Form column only holds forms
  // we actually saw whenever there is an email to use instead.
  const unconfirmedPageUrl = !confirmedFormUrl && !emailAddress ? contactPageUrl : null;
  const contactFormUrl = confirmedFormUrl ?? unconfirmedPageUrl;

  const status: ContactOutcome = emailAddress ? "has_email" : contactFormUrl ? "form_only" : "no_contact_found";

  // --- Explain the outcome -----------------------------------------------------
  if (confirmedFormUrl) {
    notes.push(`contact form confirmed on ${pathOf(confirmedFormUrl)}`);
  } else if (unconfirmedPageUrl) {
    notes.push(
      contactPageReadable
        ? "contact page found but no form detected on it (the form may load via JavaScript, or the page may just list an address)"
        : "contact page found but could not be read, so a form could not be confirmed"
    );
  }
  if (foundOnSecondary) notes.push(`email found on ${foundOnSecondary} (not on the homepage or contact page)`);
  else if (!emailAddress && secondaryChecked.length) notes.push(`also checked ${secondaryChecked.join(", ")} with no email`);
  if (!emailAddress && !contactFormUrl && !contactPageUrl) {
    notes.push("homepage loaded, but no email address and no contact page found");
  }
  if (ranked.other.length) {
    const shown = ranked.other.slice(0, 6).join(", ");
    const more = ranked.other.length > 6 ? ` +${ranked.other.length - 6} more` : "";
    notes.push(`kept ${ranked.kept.length} of ${ranked.kept.length + ranked.other.length} emails found; not kept: ${shown}${more}`);
  }

  // Say so when the result only exists thanks to a fallback, so a report can
  // show which sites depend on one.
  const fallbackNote = fallbackDescription(homepage.usedFallback);
  if (fallbackNote) notes.push(fallbackNote);

  return {
    status,
    emailAddress,
    contactFormUrl,
    finalDomain: redirectedTo,
    successorDomain,
    homepageHtml: homepage.body ?? null,
    reason: notes.length ? notes.join("; ") : null,
  };
}
