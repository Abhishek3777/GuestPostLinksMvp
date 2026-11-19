// Run: npx tsx src/recipes/test-recipes.ts
// Checks the special-path (recipe) feature against live sites. Writes nothing
// to the database. Add a line to CASES when a new recipe domain is added.
import { fetchText, type Fetcher } from "../httpClient.js";
import { crawlDomain } from "../pipeline.js";
import { RECIPES, hasRecipe, runRecipe } from "./index.js";
import type { Recipe } from "./types.js";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
}

// 1) Matching: only the exact listed domains (with or without www, any case).
check("matches listed domains", ["issuewire.com", "www.issuewire.com", "ISSUEWIRE.com", "azbigmedia.com", "apsense.com", "einnews.com", "www.einnews.com"].every((d) => hasRecipe(d)));
check("does not match look-alikes", ["einpresswire.com", "notissuewire.com", "issuewire.com.evil.io", "blog.apsense.com", "azbigmedia.net", "metapress.com", ""].every((d) => !hasRecipe(d)));

// 2) Off switch.
process.env.DISABLE_RECIPES = "1";
const off = await runRecipe({ domain: "issuewire.com", days: 1, targetPostCount: 5, fetcher: fetchText });
check("DISABLE_RECIPES=1 turns recipes off", off === null);
delete process.env.DISABLE_RECIPES;

// 3) A recipe that throws, or finds nothing, never breaks anything.
const fake: Record<string, Recipe> = {
  "boom.test": async () => {
    throw new Error("site changed");
  },
  "empty.test": async () => ({ posts: [], source: "html-crawl", note: "x" }),
  "null.test": async () => null,
};
check("throwing recipe returns null", (await runRecipe({ domain: "boom.test", targetPostCount: 5, fetcher: fetchText }, fake)) === null);
check("empty recipe returns null", (await runRecipe({ domain: "empty.test", targetPostCount: 5, fetcher: fetchText }, fake)) === null);
check("null recipe returns null", (await runRecipe({ domain: "null.test", targetPostCount: 5, fetcher: fetchText }, fake)) === null);

// 4) Each real recipe finds recent, dated, unique posts (3-day window, no DB).
for (const domain of Object.keys(RECIPES)) {
  const t = Date.now();
  const r = await runRecipe({ domain, days: 3, targetPostCount: 100_000, fetcher: fetchText });
  if (!r) {
    check(`${domain}: recipe finds posts`, false, "returned nothing");
    continue;
  }
  const urls = r.posts.map((p) => p.url);
  const unique = new Set(urls).size === urls.length;
  // Sitemap sources keep the real date empty on purpose and carry the "last edited" date as a ranking hint.
  const when = (p: (typeof r.posts)[number]) => p.publishedAt ?? p.sitemapLastmod ?? null;
  const dated = r.posts.filter((p) => when(p)).length;
  const cutoff = Date.now() - 4 * 86_400_000;
  const inWindow = r.posts.filter((p) => when(p) && new Date(when(p)!).getTime() >= cutoff).length;
  check(`${domain}: found posts`, urls.length > 20, `${urls.length} candidates in ${Math.round((Date.now() - t) / 1000)}s, source=${r.source}`);
  check(`${domain}: urls unique + on this site`, unique && urls.every((u) => new URL(u).hostname.replace(/^www\./, "") === (r.siteDomain ?? domain)));
  check(`${domain}: dated and inside window`, dated >= urls.length * 0.95 && inWindow >= dated * 0.95, `${dated} dated, ${inWindow} inside 3-day window`);
}

// 5) End to end through the real pipeline: recipe domains read real posts.
for (const domain of Object.keys(RECIPES)) {
  const r = await crawlDomain(domain, { targetPostCount: 12, days: 30 });
  check(`${domain}: crawlDomain reads posts via the special path`, r.discoveryStatus === "success" && r.postsProcessed >= 8 && /special path/.test(r.reason ?? ""), `status=${r.discoveryStatus} src=${r.discoverySource} posts=${r.postsProcessed} links=${r.rows.length} | ${(r.reason ?? "").slice(0, 90)}`);
}

// 6) Fallback: a recipe that finds only junk must fall back to the normal crawl.
const junk: Recipe = async () => ({ posts: [{ url: "https://metapress.com/this-post-does-not-exist-123456789/", publishedAt: new Date().toISOString() }], source: "html-crawl", note: "junk" });
const original = RECIPES["metapress.com"];
RECIPES["metapress.com"] = junk;
const fb = await crawlDomain("metapress.com", { targetPostCount: 8, days: 30 });
if (original) RECIPES["metapress.com"] = original;
else delete RECIPES["metapress.com"];
check("junk recipe falls back to normal crawl", fb.postsProcessed >= 5 && !/special path/.test(fb.reason ?? ""), `posts=${fb.postsProcessed} src=${fb.discoverySource}`);

// 7) Domains WITHOUT a recipe make exactly the same requests as with recipes off.
const NORMAL = ["nhlsnipers.com", "airanklab.com", "shinesheets.com", "metapress.com", "hedaroibergroup.com"];
async function requestsFor(domain: string, recipesOff: boolean): Promise<{ urls: string[]; processed: number; status: string }> {
  if (recipesOff) process.env.DISABLE_RECIPES = "1";
  else delete process.env.DISABLE_RECIPES;
  const urls: string[] = [];
  const spy: Fetcher = (url, signal) => {
    urls.push(url);
    return fetchText(url, signal);
  };
  const r = await crawlDomain(domain, { targetPostCount: 4, days: 30, fetcher: spy });
  delete process.env.DISABLE_RECIPES;
  return { urls, processed: r.postsProcessed, status: r.discoveryStatus };
}
for (const d of NORMAL) {
  const a = await requestsFor(d, true);
  const b = await requestsFor(d, false);
  // Discovery requests (everything up to the first post page) must match one for one.
  const n = Math.min(a.urls.length, b.urls.length, 6);
  const same = JSON.stringify(a.urls.slice(0, n)) === JSON.stringify(b.urls.slice(0, n)) && a.status === b.status;
  check(`${d}: same requests with recipes on or off`, same && !hasRecipe(d), `status ${a.status}/${b.status}, posts ${a.processed}/${b.processed}, first ${n} requests identical`);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
