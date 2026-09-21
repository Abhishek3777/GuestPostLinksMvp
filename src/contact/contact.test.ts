import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeCloudflareEmail,
  detectContactForm,
  extractEmails,
  extractEmailsDetailed,
  findObfuscatedEmails,
} from "./emails.js";
import { rankEmails } from "./rankEmails.js";

// Cloudflare's scheme: first byte is the key, every later byte is char ^ key.
function cfEncode(email: string, key = 0x7a): string {
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return hex(key) + [...email].map((c) => hex(c.charCodeAt(0) ^ key)).join("");
}

const ranks = (emails: string[], site = "site.com", mailto = false) =>
  rankEmails(emails.map((email) => ({ email, viaMailto: mailto })), [site]);

// --- ranking -----------------------------------------------------------------

test("sales beats accounts, and accounts is reported, not lost", () => {
  const r = ranks(["accounts@site.com", "sales@site.com"]);
  assert.deepEqual(r.kept, ["sales@site.com"]);
  assert.deepEqual(r.other, ["accounts@site.com"]);
});

test("editorial / partnership inboxes rank first, several good ones are kept, capped at 3", () => {
  const r = ranks(["info@site.com", "support@site.com", "editor@site.com", "billing@site.com", "partnerships@site.com", "hello@site.com"]);
  assert.equal(r.kept[0], "editor@site.com");
  assert.equal(r.kept.length, 3);
  assert.ok(!r.kept.includes("support@site.com") && !r.kept.includes("billing@site.com"));
  assert.ok(r.other.includes("support@site.com") && r.other.includes("billing@site.com"));
});

test("a real person on the site's own domain outranks a generic inbox", () => {
  const r = ranks(["info@site.com", "sarah.jones@site.com"]);
  assert.equal(r.kept[0], "sarah.jones@site.com");
});

test("an address on a stranger's domain (theme vendor, web designer) is not kept when the site has its own", () => {
  const r = ranks(["support@magpoint.com", "info@webdesigner.io", "hello@site.com"]);
  assert.deepEqual(r.kept, ["hello@site.com"]);
  assert.ok(r.other.includes("info@webdesigner.io"));
});

test("off-domain address found only in running text is not trusted; a deliberate mailto link is", () => {
  assert.deepEqual(ranks(["contact@parentco.com"], "site.com", false).kept, []);
  assert.deepEqual(ranks(["contact@parentco.com"], "site.com", true).kept, ["contact@parentco.com"]);
});

test("free-mail addresses count for small sites", () => {
  assert.deepEqual(ranks(["jane.blogger@gmail.com"]).kept, ["jane.blogger@gmail.com"]);
});

test("when only role inboxes exist, one is kept rather than nothing", () => {
  const r = ranks(["accounts@site.com", "support@site.com"]);
  assert.equal(r.kept.length, 1);
  assert.equal(r.other.length, 1);
});

test("compound role names are recognised: accountsreceivable is not a person", () => {
  const r = ranks(["accountsreceivable@site.com", "dwest@site.com", "customer-support-uk@site.com"]);
  assert.deepEqual(r.kept, ["dwest@site.com"]);
  assert.deepEqual([...r.other].sort(), ["accountsreceivable@site.com", "customer-support-uk@site.com"]);
});

test("a redirect target counts as the site's own domain", () => {
  const r = rankEmails([{ email: "editor@newname.com", viaMailto: false }], ["oldname.com", "newname.com"]);
  assert.deepEqual(r.kept, ["editor@newname.com"]);
});

test("subdomain mail and mixed case still match the site; duplicates collapse", () => {
  const r = ranks(["Sales@Mail.Site.com", "sales@mail.site.com"]);
  assert.deepEqual(r.kept, ["sales@mail.site.com"]);
});

test("nothing found -> nothing kept", () => {
  assert.deepEqual(ranks([]), { kept: [], other: [] });
});

// --- Cloudflare decoding -------------------------------------------------------

test("decodes a Cloudflare data-cfemail value", () => {
  assert.equal(decodeCloudflareEmail(cfEncode("editor@site.com")), "editor@site.com");
  assert.equal(decodeCloudflareEmail("zz"), null);
  assert.equal(decodeCloudflareEmail(cfEncode("not an email")), null);
});

test("finds Cloudflare-protected emails in the span and href forms", () => {
  const html = `<body>
    <a href="/cdn-cgi/l/email-protection#${cfEncode("sales@site.com", 0x21)}"><span class="__cf_email__" data-cfemail="${cfEncode("sales@site.com", 0x21)}">[email&#160;protected]</span></a>
    <span data-cfemail="${cfEncode("editor@site.com")}">[email&#160;protected]</span>
  </body>`;
  const found = extractEmailsDetailed(html);
  assert.deepEqual(found.map((f) => f.email).sort(), ["editor@site.com", "sales@site.com"]);
  assert.ok(found.every((f) => f.viaMailto));
});

// --- plain extraction ------------------------------------------------------------

test("mailto and plain-text emails are found; file names and placeholders are not", () => {
  const html = `<body><a href="mailto:%20Info@Site.com?subject=Hi">mail</a> write to press@site.com
    <img src="logo@2x.png"> <script>var x="hidden@site.com"</script> you@example.com jquery@3.6.0.min.js</body>`;
  assert.deepEqual(extractEmails(html).sort(), ["info@site.com", "press@site.com"]);
});

test("one mailto link with several addresses yields each", () => {
  const html = `<a href="mailto:a@site.com,b@site.com">x</a>`;
  assert.deepEqual(extractEmails(html).sort(), ["a@site.com", "b@site.com"]);
});

test("hand-written obfuscation is decoded without corrupting ordinary text", () => {
  assert.deepEqual(findObfuscatedEmails("mail us: info [at] site [dot] com today"), ["info@site.com"]);
  assert.deepEqual(findObfuscatedEmails("sales(at)site.co.uk"), ["sales@site.co.uk"]);
  assert.deepEqual(findObfuscatedEmails("editor at site dot com"), ["editor@site.com"]);
  // ordinary prose must not turn into addresses
  assert.deepEqual(findObfuscatedEmails("meet me at starbucks.com for a chat; format.com is a dot-com"), []);
  assert.deepEqual(extractEmails("<body>We will meet at noon. Visit format.com [at] the office</body>"), []);
});

// --- form detection ----------------------------------------------------------------

test("a real contact form is detected, including plugin and embed forms", () => {
  assert.ok(detectContactForm(`<form class="wpcf7-form"><input type="text" name="n"><input type="email"><textarea></textarea><input type="submit"></form>`));
  assert.ok(detectContactForm(`<form><input name="your-name"><input type="email"><input name="message"><button>Send</button></form>`));
  assert.ok(detectContactForm(`<iframe src="https://share.hsforms.com/abc"></iframe>`));
  assert.ok(detectContactForm(`<div class="wpforms-container"></div>`));
});

test("search, login, newsletter and comment forms are not contact forms", () => {
  assert.equal(detectContactForm(`<form role="search"><input type="search"><button>Go</button></form>`), null);
  assert.equal(detectContactForm(`<form action="/login"><input type="email"><input type="password"><button>In</button></form>`), null);
  assert.equal(detectContactForm(`<form class="newsletter"><input type="email"><button>Subscribe</button></form>`), null);
  assert.equal(detectContactForm(`<form id="commentform" action="/wp-comments-post.php"><textarea name="comment"></textarea><input type="submit"></form>`), null);
  assert.equal(detectContactForm(`<p>Email us at hello@site.com</p>`), null);
});
