import assert from "node:assert/strict";
import { test } from "node:test";
import { destinationExclusion } from "./destination.js";
import { detectSuccessorNotice } from "./emails.js";

const none = new Set<string>();

test("a site that redirects to a big brand is excluded, with the destination named", () => {
  assert.deepEqual(destinationExclusion("smallblog.com", ["google.com"], none), {
    reason: "big_brand",
    destination: "google.com",
  });
});

test("redirect to a government or parked domain is excluded", () => {
  assert.equal(destinationExclusion("oldsite.com", ["nhs.uk"], none)?.reason, "excluded_domain");
  assert.equal(destinationExclusion("oldsite.com", ["health.gov.au"], none)?.reason, "gov_edu_tld");
});

test("the do-not-contact list applies to where a site really ends up", () => {
  assert.equal(destinationExclusion("a.com", ["clientco.com"], new Set(["clientco.com"]))?.reason, "do_not_contact");
});

test("landing on the same domain (www / subdomain) is not a redirect to somewhere new", () => {
  assert.equal(destinationExclusion("shop-example.com", ["www.shop-example.com", "blog.shop-example.com"], none), null);
});

test("an ordinary different destination is fine, and empty/odd destinations are ignored", () => {
  assert.equal(destinationExclusion("oldname.com", ["newname.com"], none), null);
  assert.equal(destinationExclusion("oldname.com", [null, undefined, ""], none), null);
});

test("the second destination is checked too (redirect fine, successor notice not)", () => {
  assert.equal(destinationExclusion("x.com", ["newname.com", "facebook.com"], none)?.reason, "big_brand");
});

test("a 'we have moved' notice page yields the new domain", () => {
  const html = `<body><p>Acme Blog is now part of <a href="https://www.bigco.io/acme">BigCo</a>.</p></body>`;
  assert.equal(detectSuccessorNotice(html, "acmeblog.com"), "bigco.io");
});

test("a real, content-rich site that merely mentions a merger is not read as moved", () => {
  const filler = "We write about travel and food. ".repeat(80);
  const html = `<body><h1>Company X has merged with Y!</h1><p>${filler}</p><a href="https://y.com">Y</a></body>`;
  assert.equal(detectSuccessorNotice(html, "x.com"), null);
});

test("no moved-notice phrase, or no outbound link, means no successor", () => {
  assert.equal(detectSuccessorNotice(`<body><a href="https://other.com">hi</a></body>`, "x.com"), null);
  assert.equal(detectSuccessorNotice(`<body>This site has moved to a new home.</body>`, "x.com"), null);
});
