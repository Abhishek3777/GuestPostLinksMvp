import test from "node:test";
import assert from "node:assert/strict";
import { isProxyJunk } from "./proxyJunk.js";

test("blocks tag managers, ads, video and captcha widgets", () => {
  for (const url of [
    "https://www.googletagmanager.com/gtm.js?id=GTM-1",
    "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
    "https://www.youtube.com/embed/abc",
    "https://newassets.hcaptcha.com/captcha/v1/api.js",
    "https://www.gstatic.com/recaptcha/releases/x/recaptcha__en.js",
    "https://www.google.com/recaptcha/api.js",
    "https://assets.calendly.com/assets/external/widget.js",
  ]) {
    assert.equal(isProxyJunk(url, "script"), true, url);
  }
});

test("never blocks the Cloudflare challenge or the target site itself", () => {
  for (const url of [
    "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1",
    "https://example.com/contact",
    "https://www.google.com/search?q=x",
    "https://cdn.jsdelivr.net/npm/foo.js",
  ]) {
    assert.equal(isProxyJunk(url, "script"), false, url);
  }
});

test("does not match look-alike hosts", () => {
  assert.equal(isProxyJunk("https://notyoutube.com/x", "document"), false);
  assert.equal(isProxyJunk("https://youtube.com.evil.example/x", "document"), false);
});

test("beacons and websockets are blocked regardless of host", () => {
  assert.equal(isProxyJunk("https://example.com/beacon", "ping"), true);
  assert.equal(isProxyJunk("wss://example.com/socket", "websocket"), true);
});
