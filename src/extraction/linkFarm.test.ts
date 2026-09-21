import assert from "node:assert/strict";
import { test } from "node:test";
import { countRealLinks, MAX_REAL_LINKS_PER_POST } from "./index.js";

const link = (rootDomain: string) => ({ externalUrl: `https://${rootDomain}/`, rootDomain });

test("a normal article's handful of links is well under the limit", () => {
  const links = ["acme-widgets.com", "smallshop.co.uk", "bestcoffee.org"].map(link);
  assert.equal(countRealLinks(links), 3);
  assert.ok(countRealLinks(links) <= MAX_REAL_LINKS_PER_POST);
});

test("social and big-brand links do not count towards the link-farm limit", () => {
  const links = [
    ...["facebook.com", "twitter.com", "google.com", "wikipedia.org", "youtube.com"].map(link),
    link("realprospect.com"),
  ];
  assert.equal(countRealLinks(links), 1);
});

test("a directory page of dozens of distinct sites is over the limit", () => {
  const links = Array.from({ length: 45 }, (_, i) => link(`prospect-number-${i}.com`));
  assert.ok(countRealLinks(links) > MAX_REAL_LINKS_PER_POST);
});
