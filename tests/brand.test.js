import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("header uses the supplied HANA METAL logo asset", async () => {
  const html = await read("index.html");
  assert.match(html, /assets\/hana-metal-logo\.png/);
  assert.match(html, /alt="HANA METAL"/);
  assert.doesNotMatch(html, /class="brand-mark">H</);
});

test("brand stylesheet exposes HANA red and gold design tokens", async () => {
  const css = await read("css/styles.css");
  assert.match(css, /--brand-red:\s*#c9232f/i);
  assert.match(css, /--brand-gold:\s*#e79a19/i);
  assert.match(css, /--header-dark:\s*#07111f/i);
});

test("dashboard includes approved visual hooks and preserves navigation behavior", async () => {
  const app = await read("js/app.js");
  assert.match(app, /hero-brand-mark/);
  assert.match(app, /metric-card metric-red/);
  assert.match(app, /quick-search-heading/);
  assert.match(app, /data-route="new"/);
  assert.match(app, /data-route="list"/);
  assert.match(app, /id="quickSearchForm"/);
});
