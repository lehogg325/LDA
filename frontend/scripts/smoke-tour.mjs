// Headless smoke drive for GuidedTour: click through all 5 steps + the closing
// suggestions card against the real Walmart Inc / Hogan Lovells / House of
// Representatives network, asserting each step's scripted state actually landed.
// Run: node scripts/smoke-tour.mjs
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const OUT = fileURLToPath(new URL("../smoke-artifacts/", import.meta.url));
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://localhost:5173");
await page.waitForSelector("text=The Lobbying Network");

await page.waitForSelector("button:has-text('New here? Take the tour')");
await page.click("button:has-text('New here? Take the tour')");

// Step 1 — Search Any Entity: Next is disabled until the ego window finishes loading.
await page.waitForSelector(".guided-tour-title:has-text('Search Any Entity')");
await page.waitForFunction(() => {
  const btn = document.querySelector(".guided-tour-btn.primary");
  return btn && !btn.disabled;
}, { timeout: 60000 });
const anchorLabel = await page.textContent(".status-row strong");
await page.waitForFunction(() => {
  const g = window.__lda?.graph;
  if (!g || g.order === 0) return false;
  let visible = 0;
  g.forEachNode((_k, a) => { if (!a.hidden) visible++; });
  return visible > 0;
}, { timeout: 60000 });
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + "t1-search.png" });
await page.click(".guided-tour-btn.primary");

// Step 2 — A Company and Its Firm: Hogan Lovells selected and spotlighted.
await page.waitForSelector(".guided-tour-title:has-text('A Company and Its Firm')");
await page.waitForSelector(".node-title:has-text('HOGAN LOVELLS')");
await page.screenshot({ path: OUT + "t2-firm.png" });
await page.click(".guided-tour-btn.primary");

// Step 3 — Who They Lobbied: House of Representatives selected.
await page.waitForSelector(".guided-tour-title:has-text('Who They Lobbied')");
await page.waitForSelector(".node-title:has-text('HOUSE OF REPRESENTATIVES')");
await page.screenshot({ path: OUT + "t3-gov.png" });
await page.click(".guided-tour-btn.primary");

// Step 4 — Issues Lobbied: back on the anchor's own issues, panel glowing.
await page.waitForSelector(".guided-tour-title:has-text('Issues Lobbied')");
await page.waitForSelector(".node-panel.tour-highlight");
await page.waitForSelector(".issue-group", { timeout: 15000 });
const issueGroupCount = await page.locator(".issue-group").count();
const nodeTitle4 = await page.textContent(".node-title");
await page.screenshot({ path: OUT + "t4-issues.png" });
await page.click(".guided-tour-btn.primary");

// Step 5 — Move Through Time: slider glowing, node panel closed.
await page.waitForSelector(".guided-tour-title:has-text('Move Through Time')");
await page.waitForSelector(".quarter-slider.tour-highlight");
const nodePanelGone = (await page.locator(".node-panel").count()) === 0;
await page.screenshot({ path: OUT + "t5-slider.png" });
await page.click(".guided-tour-btn.primary");

// Closing suggestions card, then hand back to the app.
await page.waitForSelector("text=TOUR COMPLETE");
const sliderHighlightGone = (await page.locator(".quarter-slider.tour-highlight").count()) === 0;
await page.screenshot({ path: OUT + "t6-suggestions.png" });
await page.click("button:has-text('START EXPLORING')");
await page.waitForTimeout(300);
const tourGone = (await page.locator(".guided-tour").count()) === 0;
await page.screenshot({ path: OUT + "t7-after-tour.png" });

console.log(JSON.stringify({
  anchorLabel, issueGroupCount, nodeTitle4, nodePanelGone, sliderHighlightGone, tourGone, errors,
}, null, 1));
await browser.close();
