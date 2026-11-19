import assert from "node:assert/strict";
import { test } from "node:test";
import { findContact } from "./findContact.js";
import type { FetchResult } from "../httpClient.js";

// Verifies formConfirmed: true only when a <form> with a real message field was
// actually SEEN; false for the "contact page read, but no form on it" guess that
// (2026-11-19) is now what triggers a browser re-check in contactStage.ts instead
// of being shipped straight to FormBlast as if it were a confirmed lead.

const HOMEPAGE_WITH_CONTACT_LINK = `<html><body><a href="/contact">Contact</a></body></html>`;
const CONFIRMED_FORM_PAGE = `<html><body>
  <form id="wpcf7-1" action="/send">
    <input type="text" name="your-name">
    <input type="email" name="your-email">
    <textarea name="your-message"></textarea>
    <button type="submit">Send</button>
  </form>
</body></html>`;
const NO_FORM_AT_ALL_PAGE = `<html><body><h1>Get in touch</h1><p>We'd love to hear from you.</p></body></html>`;
// A form with no textarea and no message-ish field — same shape as the
// 'form exists, no message box' cases from the 18 Nov diagnosis. Plain id/class
// so it isn't ALSO picked up by the (separately diagnosed) form-plugin-wrapper
// fallback — this fixture is testing the main <form> loop's own field check.
const FORM_NO_MESSAGE_BOX_PAGE = `<html><body>
  <form id="quote-form" action="/quote">
    <input type="text" name="name">
    <input type="email" name="email">
    <select name="service"><option>Sales</option></select>
    <button type="submit">Request a Quote</button>
  </form>
</body></html>`;

function mockFetcher(pages: Record<string, string>): (url: string) => Promise<FetchResult> {
  return async (url: string) => {
    const path = new URL(url).pathname;
    const body = pages[path];
    return body !== undefined ? { ok: true, status: 200, body, url } : { ok: false, status: 404, errorReason: "error", body: "" };
  };
}

test("a real <form> with a textarea is formConfirmed: true", async () => {
  const result = await findContact(
    "example.com",
    mockFetcher({ "/": HOMEPAGE_WITH_CONTACT_LINK, "/contact": CONFIRMED_FORM_PAGE })
  );
  assert.equal(result.status, "form_only");
  assert.equal(result.formConfirmed, true);
  assert.equal(result.contactFormUrl, "https://example.com/contact");
});

test("a contact page with no <form> at all is formConfirmed: false, still offered as a lead", async () => {
  const result = await findContact(
    "example.com",
    mockFetcher({ "/": HOMEPAGE_WITH_CONTACT_LINK, "/contact": NO_FORM_AT_ALL_PAGE })
  );
  assert.equal(result.status, "form_only");
  assert.equal(result.formConfirmed, false);
  assert.equal(result.contactFormUrl, "https://example.com/contact");
  assert.match(result.reason ?? "", /no form detected on it/);
});

test("a <form> that has no message box is NOT confirmed (same shape as the 18 Nov diagnosis)", async () => {
  const result = await findContact(
    "example.com",
    mockFetcher({ "/": HOMEPAGE_WITH_CONTACT_LINK, "/contact": FORM_NO_MESSAGE_BOX_PAGE })
  );
  assert.equal(result.status, "form_only");
  assert.equal(result.formConfirmed, false);
});

test("an unreadable homepage never reaches the form question: formConfirmed is false, not missing", async () => {
  const result = await findContact("dead-domain.test", async () => ({ ok: false, errorReason: "dns_error" }));
  assert.equal(result.status, "dns_error");
  assert.equal(result.formConfirmed, false);
});
