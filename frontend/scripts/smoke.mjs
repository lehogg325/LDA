// Headless smoke drive: search -> anchor Comcast group -> graph renders ->
// scrub the quarter slider -> screenshots prove pinned layout (nodes appear/
// disappear, never move). Run: node scripts/smoke.mjs
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const OUT = fileURLToPath(new URL("../smoke-artifacts/", import.meta.url));
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://localhost:5173");
await page.waitForSelector("text=LDA Lobbying Network");

await page.fill('input[placeholder*="Search registrants"]', "comcast corporation");
await page.waitForSelector("li:has-text('COMCAST CORPORATION')", { timeout: 15000 });
await page.click("li:has-text('COMCAST CORPORATION')");

// Window load: slider appears once all quarters are fetched AND the layout worker
// returned; then wait for visible nodes.
await page.waitForSelector(".quarter-slider input", { timeout: 180000 });
await page.waitForFunction(() => {
  const g = window.__lda?.graph;
  if (!g || g.order === 0) return false;
  let visible = 0;
  g.forEachNode((_k, a) => { if (!a.hidden) visible++; });
  return visible > 0;
}, { timeout: 60000 });
await page.waitForTimeout(800); // let sigma paint
await page.screenshot({ path: OUT + "1-latest-quarter.png" });
const label1 = await page.textContent(".quarter-label");

// Step back 6 quarters with the keyboard (fires React onChange).
await page.focus(".quarter-slider input");
for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(800);
await page.screenshot({ path: OUT + "2-six-quarters-back.png" });
const label2 = await page.textContent(".quarter-label");

// Jump near the start of the window via the timeline strip (leftmost column).
await page.locator(".timeline-strip svg g").first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: OUT + "3-window-start.png" });
const label3 = await page.textContent(".quarter-label");

const status = await page.textContent(".status-row");
console.log(JSON.stringify({ label1, label2, label3, status, errors }, null, 1));
await browser.close();
