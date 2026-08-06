import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("header loads the supplied HANA METAL logo through the brand stylesheet", async () => {
  const html = await read("index.html");
  const css = await read("css/brand-dashboard.css");
  assert.match(html, /css\/brand-dashboard\.css\?v=1\.8/);
  assert.match(css, /assets\/hana-metal-logo\.png/);
});

test("brand stylesheet exposes HANA red and gold design tokens", async () => {
  const css = await read("css/brand-dashboard.css");
  assert.match(css, /--brand-red:\s*#d6292f/i);
  assert.match(css, /--brand-gold:\s*#f8bd45/i);
  assert.match(css, /--brand-ink:\s*#0a1322/i);
});

test("dashboard keeps the approved brand, analytics, navigation, image, and print hooks", async () => {
  const app = await read("js/app.js");
  assert.match(app, /hero brand-hero/);
  assert.match(app, /workflow-metric-grid/);
  assert.match(app, /brand-quick-search/);
  assert.match(app, /analytics-dashboard/);
  assert.match(app, /data-route="new"/);
  assert.match(app, /data-route="list"/);
  assert.match(app, /id="quickSearchForm"/);
  assert.match(app, /initializeFormImageSelections/);
  assert.match(app, /buildPrintModel/);
});
