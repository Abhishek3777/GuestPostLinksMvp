import { discoverPosts } from "./index.js";

// Real domains pulled from your own domains_meta.csv / GuestPostLinks.xlsx,
// so we already have a rough idea of what a "correct" result looks like.
const SAMPLE_DOMAINS = [
  "muskanquotes.com",
  "thepackagespk.com",
  "disquantified.org.uk",
  "jcwrealty.com",
  "ihome-remodeling.com",
];

const domains = process.argv.slice(2).length ? process.argv.slice(2) : SAMPLE_DOMAINS;

for (const domain of domains) {
  const result = await discoverPosts(domain);
  console.log(`\n=== ${domain} ===`);
  console.log(`status: ${result.status}${result.source ? `  source: ${result.source}` : ""}`);
  console.log(`posts found: ${result.posts.length}`);
  for (const post of result.posts.slice(0, 5)) {
    console.log(`  - ${post.url}${post.publishedAt ? `  (${post.publishedAt})` : ""}`);
  }
}
