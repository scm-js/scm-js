/**
 * The pictures in the user guide (`README.md` → `docs/images/*.webp`), taken again.
 *
 * Drives the dev server in a headless Chromium: opens the fixture maps, paints and
 * places what each picture shows, and writes the WebP files the guide names. Dialogs
 * are written lossless (flat colours, small anyway); a window full of terrain is
 * written at quality 88, which keeps forty pictures under 5 MB and leaves the chrome's
 * text crisp. Run it after a change to the chrome and commit what changed.
 *
 *   npm run dev                              # in another terminal
 *   npm i --no-save playwright sharp         # not dependencies: only this script needs them
 *   npx playwright install chromium          # once
 *   node scripts/guide-screenshots.mjs [--base http://localhost:5173] [--browser <chrome>]
 *                                      [--only editor,units,fog] [--out docs/images]
 *
 * Needs the game data extracted (the pictures are of real graphics) and, in
 * `fixtures/maps/`, Big Game Hunters, Binary Burghs, Crescent Moon and Ground Zero from
 * the game's own Maps folder. Nothing here is a test: a picture that comes out wrong is
 * seen by looking at it.
 *
 * Coordinates are for a 1400×900 window with the default panel widths: the map area is
 * x 292..1150, y 85..870, which is why the strokes below are written against (292, 85).
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => { const at = args.indexOf(name); return at === -1 ? fallback : args[at + 1]; };
const BASE = opt("--base", "http://localhost:5173/").replace(/\/?$/, "/");
const OUT = resolve(root, opt("--out", "docs/images"));
const ONLY = opt("--only", "")?.split(",").filter(Boolean) ?? [];
const BROWSER = opt("--browser", process.env.SCMJS_BROWSER ?? "");
const FIXTURES = join(root, "fixtures/maps");

const { chromium } = await load("playwright");
const sharp = (await load("sharp")).default;

async function load(name) {
  try { return await import(name); } catch {
    console.error(`${name} is not installed. Run: npm i --no-save playwright sharp   (and npx playwright install chromium)`);
    process.exit(1);
  }
}

/* ── the pictures ──────────────────────────────────────────────────────────────── */

const MAP = { x: 292, y: 85, width: 858, height: 785 };
const PALETTE = { x: 0, y: 62, width: 270, height: 820 };
const at = (x, y) => [292 + x, 85 + y];
const rail = (i) => `.rail-btn >> nth=${i}`;

/**
 * Each scene opens the editor once and takes one or more pictures. `take(name, clip?)`
 * writes the window (or a clip of it); `dialog(name)` clips to the topmost dialog.
 */
const SCENES = [
  scene("dialogs", "", async (p) => {
    // One deep link per dialog: `?dialog=` opens it over the blank startup map.
    if (!ONLY.length || ONLY.includes("game-data")) {
      // The first-use state: with the bundled manifests unreachable the resolver ends at
      // "none" and the editor opens Game Data on its own, as it does on a fresh machine.
      await p.page.route(/\/(tileset|unit)\/manifest\.json(\?.*)?$/, (route) => route.abort());
      await p.goto("");
      await p.wait(2000);
      await p.dialog("game-data");
      await p.page.unroute(/\/(tileset|unit)\/manifest\.json(\?.*)?$/);
    }
    for (const [name, id] of Object.entries({
      "new-scenario": "newMap", save: "saveAs", "export-image": "exportImage", "check-map": "validateMap",
      preferences: "preferences", "player-settings": "playerSettings", "force-settings": "forceSettings", "player-colors": "playerColors",
      "unit-settings": "unitSettings", symmetry: "symmetry", cuwp: "cuwpEditor", "map-properties": "mapProperties", "test-map": "testMap",
    })) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      await p.goto(`dialog=${id}`);
      await p.dialog(name);
    }
    if (!ONLY.length || ONLY.includes("browse-plugins")) {
      await p.goto("dialog=plugins");
      await p.page.locator(".dlg [role=tab]", { hasText: /Browse/ }).first().click();
      await p.wait(4000);
      await p.dialog("browse-plugins");
    }
  }),

  scene("terrain", "mode=isom", async (p) => {
    await p.brush(3);
    await p.terrain("High Dirt");
    await p.stroke([[520, 300], [620, 320], [700, 380], [680, 470], [560, 480], [500, 400]]);
    await p.terrain("Water");
    await p.stroke([[850, 600], [950, 620], [1020, 700], [900, 760], [820, 700]]);
    await p.take("terrain-isometric", MAP);
    await p.tab("Rect"); await p.take("palette-rect", PALETTE);
    await p.tab("Tile"); await p.take("palette-tile", PALETTE);
    await p.tab("Blend"); await p.page.mouse.click(600, 400); await p.wait(1500); await p.take("palette-blend", PALETTE);
    await p.tab("Isometric");
    await p.menu("View", /Elevation Overlay/); await p.take("terrain-elevation", MAP); await p.menu("View", /Elevation Overlay/);
    await p.menu("View", /Buildability Overlay/); await p.take("terrain-buildability", MAP);
  }),

  scene("tutorial", "mode=isom", async (p) => {
    await p.brush(3);
    await p.terrain("High Dirt");
    await p.stroke([[420, 260], [700, 240], [900, 300], [950, 450], [800, 560], [560, 580], [420, 450]]);
    await p.brush(1);
    await p.terrain("Dirt");
    await p.stroke([[700, 600], [700, 520]]);
    await p.take("tutorial-terrain", MAP);
    await p.page.click(rail(2)); await p.wait(600);
    await p.unit("Start Location"); await p.click(...at(640, 400));
    await p.unit("Mineral Field (Type 1)");
    for (const [x, y] of [[470, 300], [470, 340], [480, 380], [500, 420], [520, 460], [560, 490]]) await p.click(...at(x, y));
    await p.unit("Vespene Geyser"); await p.click(...at(800, 300));
    await p.esc(); await p.search("");
    await p.take("tutorial-base");
    await p.page.click(rail(0)); await p.wait(300);
    await p.menu("Tools", /^Paint/); await p.wait(1200);
    await p.take("paint");
  }),

  scene("bgh", "", async (p) => {
    await p.drop("(8)Big Game Hunters.scm");
    await p.minimap(0.22, 0.2);
    await p.take("editor-plain");
    if (!ONLY.length || ONLY.includes("editor")) await annotate(join(OUT, "editor-plain.webp"), join(OUT, "editor.webp"));
    await p.menu("Scenario", /String Editor/); await p.wait(1000); await p.dialog("string-editor"); await p.esc();
    await p.menu("Triggers", /^Trigger Editor/); await p.wait(1200);
    await p.page.locator(".dlg .trig-list .item").nth(1).click().catch(() => {}); await p.wait(600);
    await p.dialog("trigger-editor"); await p.esc();
    await p.menu("Triggers", /^Text Trigger Editor/); await p.wait(1200); await p.dialog("text-triggers"); await p.esc();
    await p.page.keyboard.press("Control+Shift+W"); await p.wait(4000); await p.take("walkability");
    await p.page.keyboard.press("Control+Shift+W"); await p.wait(500);
  }),

  scene("objects", "layer=units", async (p) => {
    await p.drop("(8)Big Game Hunters.scm");
    // Scroll is 0,0 after a load; the top-left of BGH has empty ground around (250..750, 400..700).
    await p.unit("Terran Marine");
    for (const [x, y] of [[400, 520], [440, 545], [480, 520], [520, 545]]) await p.click(...at(x, y));
    await p.unit("Terran Siege Tank (Tank Mode)"); await p.click(...at(600, 600));
    await p.search(""); // the whole tree in the picture, not the search's one row
    await p.page.mouse.move(...at(700, 650)); await p.page.mouse.down(); await p.page.mouse.move(...at(450, 530), { steps: 6 }); await p.wait(500);
    await p.take("units");
    await p.page.mouse.up(); await p.esc();
    await p.page.mouse.dblclick(...at(600, 600)); await p.wait(1500); await p.dialog("unit-properties"); await p.esc();
    await p.page.click(rail(4)); await p.wait(600);
    await p.drag([330, 470], [560, 600]); await p.drag([560, 250], [790, 400]);
    await p.take("locations");
    await p.page.mouse.dblclick(...at(640, 320)); await p.wait(1500); await p.dialog("location-properties"); await p.esc();
    await p.page.click(rail(6)); await p.wait(600);
    await p.drag([330, 420], [680, 680]);
    await p.page.keyboard.press("Control+c"); await p.wait(400);
    await p.page.keyboard.press("Control+v"); await p.wait(400);
    await p.page.mouse.move(...at(100, 150)); await p.page.mouse.down(); await p.page.mouse.move(...at(110, 160), { steps: 2 }); await p.wait(500);
    await p.take("clipboard");
    await p.page.mouse.up();
  }),

  scene("desert", "layer=doodads", async (p) => {
    await p.drop("(2)Binary Burghs.scx");
    await p.minimap(0.5, 0.5);
    await p.page.locator(".palette .doodad").nth(3).click(); await p.wait(400);
    await p.take("doodads");
    await p.esc();
    await p.page.click(rail(3)); await p.wait(800);
    await p.take("sprites");
  }),

  scene("fog", "layer=fog&fogPlayer=1&zoom=0.5", async (p) => {
    await p.drop("(4)Crescent Moon.scx");
    await p.page.locator(".palette .seg button", { hasText: /^Clear$/ }).click();
    await p.page.locator(".palette select[aria-label='Brush size']").selectOption({ index: 6 });
    await p.stroke([[492, 285], [592, 305], [712, 385], [812, 345], [892, 465], [792, 565], [672, 555], [572, 485]]);
    await p.take("fog");
  }),

  scene("briefing", "", async (p) => {
    await p.drop("(6)Ground Zero.scm");
    await p.menu("Triggers", /^Mission Briefing/); await p.wait(1200);
    await p.page.locator(".dlg .trig-list .item").nth(0).click().catch(() => {}); await p.wait(600);
    await p.dialog("briefing");
  }),
];

/* ── the annotated overview ────────────────────────────────────────────────────── */

/** Numbered callouts over the overview, in the order "The editor window" lists them. */
async function annotate(from, to) {
  const marks = [[1, 640, 13], [2, 1000, 45], [3, 18, 345], [4, 200, 75], [5, 720, 300], [6, 1335, 75], [7, 1335, 347], [8, 1335, 596], [9, 1000, 888]];
  const svg = `<svg width="1400" height="900" xmlns="http://www.w3.org/2000/svg">${marks.map(([n, x, y]) =>
    `<circle cx="${x}" cy="${y}" r="13" fill="#f3c04e" stroke="#1a1a1a" stroke-width="2"/>` +
    `<text x="${x}" y="${y + 5}" font-size="15" font-weight="bold" font-family="DejaVu Sans, sans-serif" fill="#1a1a1a" text-anchor="middle">${n}</text>`).join("")}</svg>`;
  await sharp(from).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).webp({ quality: 88 }).toFile(to);
  console.log("wrote editor (annotated)");
}

/* ── the driver ────────────────────────────────────────────────────────────────── */

function scene(name, query, run) { return { name, query, run }; }

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ ...(BROWSER ? { executablePath: BROWSER } : {}), args: ["--no-sandbox"] });
  try {
    for (const s of SCENES) {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.error(`[${s.name}] page error:`, e.message));
      const p = driver(page);
      await p.goto(s.query);
      await s.run(p);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

function driver(page) {
  const wait = (ms) => page.waitForTimeout(ms);
  const p = {
    page, wait,
    async goto(query) { await page.goto(`${BASE}?nosplash${query ? "&" + query : ""}`); await wait(2500); },
    async take(name, clip, { lossless = !!clip && clip.width < 858 } = {}) {
      if (ONLY.length && !ONLY.includes(name)) return;
      await wait(400);
      const png = await page.screenshot({ clip });
      const lossy = !lossless; // terrain in the picture: lossy; a dialog or a palette: lossless
      const out = join(OUT, `${name}.webp`);
      const info = await sharp(png).webp(lossy ? { quality: 88 } : { lossless: true }).toFile(out);
      console.log(`wrote ${name} (${(info.size / 1024).toFixed(0)} KB)`);
    },
    async dialog(name, pad = 28) {
      const box = await page.locator(".dlg").last().boundingBox();
      if (!box) throw new Error(`no dialog on screen for ${name}`);
      const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
      await p.take(name, { x, y, width: Math.min(1400 - x, box.width + 2 * pad), height: Math.min(900 - y, box.height + 2 * pad) }, { lossless: true });
    },
    async drop(file) {
      const path = join(FIXTURES, file);
      if (!existsSync(path)) throw new Error(`fixture map missing: ${path}`);
      const b64 = readFileSync(path).toString("base64");
      const dt = await page.evaluateHandle(({ b64, name }) => {
        const bin = atob(b64); const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const dt = new DataTransfer(); dt.items.add(new File([arr], name)); return dt;
      }, { b64, name: file });
      await page.dispatchEvent(".app", "drop", { dataTransfer: dt });
      await wait(3000);
    },
    async menu(top, item) {
      await page.click(`.menubar button:has-text("${top}")`); await wait(200);
      await page.locator(".menu-item", { hasText: item }).first().click(); await wait(800);
    },
    async minimap(fx, fy) {
      const mm = await page.locator(".minimap").first().boundingBox();
      await page.mouse.click(mm.x + mm.width * fx, mm.y + mm.height * fy); await wait(1500);
    },
    async esc() { await page.keyboard.press("Escape"); await wait(200); },
    async click(x, y) { await page.mouse.click(x, y); await wait(250); },
    async stroke(pts) {
      await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
      for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 6 });
      await page.mouse.up(); await wait(500);
    },
    async drag(from, to) {
      await page.mouse.move(...at(...from)); await page.mouse.down(); await page.mouse.move(...at(...to), { steps: 8 }); await page.mouse.up(); await wait(600);
    },
    async brush(n) { await page.locator(".palette select").first().selectOption({ index: n - 1 }); await wait(200); },
    async tab(name) { await page.locator(".palette [role=tab]", { hasText: new RegExp(`^${name}$`) }).first().click(); await wait(600); },
    async terrain(name) { await page.locator(".palette .terrain-list .item", { hasText: new RegExp(`^${name}`) }).first().click(); await wait(200); },
    async search(text) { await page.locator(".palette input[type=search], .palette input[placeholder*='Search']").first().fill(text); await wait(300); },
    async unit(name) {
      await p.search(name);
      await page.locator(".palette .node", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }).first().click(); await wait(200);
    },
  };
  return p;
}

await main();
