// Verification drive: orbit layout (company-centered, omni hubs at 12 o'clock),
// filing-chain spotlight from a lobbyist, pin + scrub, and a SENATE-anchored view.
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const OUT = fileURLToPath(new URL("../smoke-artifacts/", import.meta.url));
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const waitForGraph = async () => {
  await page.waitForSelector(".quarter-slider input", { timeout: 180000 });
  await page.waitForFunction(() => {
    const g = window.__lda?.graph;
    if (!g || g.order === 0) return false;
    let v = 0; g.forEachNode((_k, a) => { if (!a.hidden) v++; });
    return v > 0;
  }, { timeout: 60000 });
  await page.waitForTimeout(800);
};

await page.goto("http://localhost:5173");
await page.fill('input[placeholder*="Search registrants"]', "comcast corporation");
await page.click("li:has-text('79 registrations')");
await waitForGraph();

// (a) ambient: company should be central, omni entities (SENATE/HOUSE) at the top.
const geometry = await page.evaluate(() => {
  const { graph } = window.__lda;
  const of = (pred) => {
    const out = [];
    graph.forEachNode((k, a) => { if (!a.hidden && pred(k, a)) out.push({ k, x: a.x, y: a.y, label: a.label }); });
    return out;
  };
  // The name-group collapses to ONE display node labeled "… · N registrations".
  const anchors = of((_k, a) => a.nodeType === "client" && a.label.startsWith("COMCAST CORPORATION"));
  const senate = of((_k, a) => a.label === "SENATE")[0];
  const house = of((_k, a) => a.label === "HOUSE OF REPRESENTATIVES")[0];
  const anchorR = Math.max(...anchors.map((n) => Math.hypot(n.x, n.y)));
  return { anchorCount: anchors.length, anchorMaxRadius: anchorR,
           senate: senate && { r: Math.hypot(senate.x, senate.y), y: senate.y },
           house: house && { r: Math.hypot(house.x, house.y), y: house.y } };
});
await page.screenshot({ path: OUT + "o1-orbit-ambient.png" });

// (b) hover-chain from a lobbyist: chain should include gov entities (2 semantic hops).
const chain = await page.evaluate(() => {
  const { graph, sigma } = window.__lda;
  let lob = null, best = -1;
  graph.forEachNode((k, a) => {
    if (!a.hidden && a.nodeType === "lobbyist" && a.qDegree > best) { lob = k; best = a.qDegree; }
  });
  sigma.emit("clickNode", { node: lob });
  return new Promise((resolve) => setTimeout(() => {
    const spot = { nodes: 0, types: {} };
    graph.forEachNode((k, a) => {
      const d = sigma.getNodeDisplayData(k);
      if (!a.hidden && d.color !== "#23262f") {
        spot.nodes++;
        spot.types[a.nodeType] = (spot.types[a.nodeType] ?? 0) + 1;
      }
    });
    resolve({ lobbyist: lob, lit: spot });
  }, 600));
});
await page.screenshot({ path: OUT + "o2-lobbyist-chain.png" });

// (c) keep the pin, scrub back 4 quarters — positions frozen, chain follows.
await page.focus(".quarter-slider input");
for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + "o3-scrub-pinned.png" });

// (d) SENATE as anchor: hops=1 annulus of clients.
await page.evaluate(() => window.__lda.sigma.emit("clickStage", {}));
await page.fill('input[placeholder*="Search registrants"]', "senate");
await page.click("li:has-text('SENATE')");
await waitForGraph();
await page.screenshot({ path: OUT + "o4-senate-anchor.png" });

console.log(JSON.stringify({ geometry, chain, errors }, null, 1));
await browser.close();
