// Verification drive for the readability overhaul: ambient label economy,
// pinned spotlight, zoom behavior, and pin-vs-scrub interaction.
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const OUT = fileURLToPath(new URL("../smoke-artifacts/", import.meta.url));
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto("http://localhost:5173");
await page.fill('input[placeholder*="Search registrants"]', "comcast corporation");
await page.click("li:has-text('79 registrations')");
await page.waitForSelector(".quarter-slider input", { timeout: 180000 });
await page.waitForFunction(() => {
  const g = window.__lda?.graph;
  if (!g || g.order === 0) return false;
  let v = 0; g.forEachNode((_k, a) => { if (!a.hidden) v++; });
  return v > 0;
}, { timeout: 60000 });
await page.waitForTimeout(800);

// (a) ambient rest: how many labels are forced?
const ambient = await page.evaluate(() => {
  const { graph } = window.__lda;
  let forced = 0;
  graph.forEachNode((_k, a) => { if (a.forceLabel && !a.hidden) forced++; });
  return forced;
});
await page.screenshot({ path: OUT + "s1-ambient.png" });

// (b) pin a spotlight on the highest-degree registrant
const pinned = await page.evaluate(() => {
  const { graph, sigma } = window.__lda;
  let best = null, bestDeg = -1;
  graph.forEachNode((k, a) => {
    if (!a.hidden && a.nodeType === "registrant" && a.qDegree > bestDeg) { best = k; bestDeg = a.qDegree; }
  });
  sigma.emit("clickNode", { node: best });
  return { node: best, degree: bestDeg };
});
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + "s2-spotlight.png" });

// (c) zoomed-in ambient (unpin first)
await page.evaluate(() => window.__lda.sigma.emit("clickStage", {}));
await page.evaluate(() => {
  const cam = window.__lda.sigma.getCamera();
  cam.setState({ ...cam.getState(), ratio: cam.getState().ratio / 2.5 });
});
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "s3-zoomed.png" });
await page.evaluate(() => window.__lda.sigma.getCamera().animatedReset({ duration: 0 }));

// (d) pin again, scrub 4 quarters back — positions frozen, spotlight sane
await page.evaluate((n) => window.__lda.sigma.emit("clickNode", { node: n }), pinned.node);
await page.focus(".quarter-slider input");
for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + "s4-scrub-pinned.png" });

console.log(JSON.stringify({ ambientForcedLabels: ambient, pinned, errors }, null, 1));
await browser.close();
