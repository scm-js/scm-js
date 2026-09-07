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
 *                                      [--only editor,units,fog] [--scenes scmjs-ai] [--out docs/images]
 *
 * Needs the game data extracted (the pictures are of real graphics) and, in
 * `fixtures/maps/`, Big Game Hunters, Binary Burghs, Crescent Moon and Ground Zero from
 * the game's own Maps folder. Nothing here is a test: a picture that comes out wrong is
 * seen by looking at it.
 *
 * Coordinates are for a 1400×900 window with the default panel widths: the map area is
 * x 292..1150, y 85..870, which is why the strokes below are written against (292, 85).
 *
 * The scmjs.dev pictures (the account, My Maps, the AI dialogs) are taken against a
 * stand-in for the service, `lib/guide-scmjs-mock.mjs`, started here on port 8765: the
 * plugin is pointed at it through its stored settings, signed in as one account, and the
 * recipe answers are canned for the fixture maps. What those pictures show is the
 * editor's chrome around example content, not a model's output.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { startMock } from "./lib/guide-scmjs-mock.mjs";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => { const at = args.indexOf(name); return at === -1 ? fallback : args[at + 1]; };
const BASE = opt("--base", "http://localhost:5173/").replace(/\/?$/, "/");
const OUT = resolve(root, opt("--out", "docs/images"));
const ONLY = opt("--only", "")?.split(",").filter(Boolean) ?? [];
/** Scenes to run at all (`--only` filters pictures; a scene still runs for its side effects). */
const SCENES_ONLY = opt("--scenes", "")?.split(",").filter(Boolean) ?? [];
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

  /* ── scmjs.dev: the account, the maps, the AI ─────────────────────────────────── */

  scene("scmjs-account", "", async (p) => {
    await p.drop("(8)Big Game Hunters.scm");
    await p.minimap(0.22, 0.2);
    // Revision 1 of Big Game Hunters, as opened.
    await p.menu("Account", /^Save to scmjs\.dev/); await p.wait(800);
    await p.page.locator(".dlg textarea").fill("From the game's Maps folder, untouched.");
    await p.page.locator(".dlg button", { hasText: /^Save$/ }).click();
    await p.page.locator(".dlg").waitFor({ state: "detached", timeout: 30_000 }); await p.wait(500);
    // A change, then revision 2 — the Save dialog offers the map it was saved to.
    await p.page.click(rail(2)); await p.wait(600);
    await p.unit("Mineral Field (Type 1)"); await p.click(...at(430, 560)); await p.click(...at(430, 600)); await p.esc();
    await p.page.click(rail(0)); await p.wait(300);
    await p.menu("Account", /^Save to scmjs\.dev/); await p.wait(1200);
    await p.page.locator(".dlg textarea").fill("Two more mineral fields at the north-west natural.");
    await p.dialog("save-to-scmjs");
    await p.page.locator(".dlg button", { hasText: /^Save$/ }).click();
    await p.page.locator(".dlg").waitFor({ state: "detached", timeout: 30_000 }); await p.wait(500);
    // Two more maps on the account.
    for (const [file, note] of [["(2)Binary Burghs.scx", "Desert two-player, for the doodad tests."], ["(4)Crescent Moon.scx", ""]]) {
      await p.drop(file);
      await p.menu("Account", /^Save to scmjs\.dev/); await p.wait(1200);
      if (note) await p.page.locator(".dlg textarea").fill(note);
      await p.page.locator(".dlg button", { hasText: /^Save$/ }).click();
      await p.page.locator(".dlg").waitFor({ state: "detached", timeout: 30_000 }); await p.wait(500);
    }
    // Dates that read like a week's work rather than one minute's.
    const hours = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
    const byName = (n) => p.mock.state.maps.find((m) => m.name.includes(n));
    const bgh = byName("Big Game Hunters"), bb = byName("Binary Burghs"), cm = byName("Crescent Moon");
    bgh.createdAt = bgh.history[0].createdAt = hours(5 * 24 + 3); bgh.history[1].createdAt = bgh.updatedAt = hours(2);
    bb.createdAt = bb.updatedAt = bb.history[0].createdAt = hours(3 * 24 + 6);
    cm.createdAt = cm.updatedAt = cm.history[0].createdAt = hours(26);

    await p.menu("Account", /^My Maps/); await p.wait(1500);
    await p.page.locator(".dlg .sd-map", { hasText: /Big Game Hunters/ }).click(); await p.wait(1200);
    await p.dialog("my-maps"); await p.esc();
    await p.menu("Account", /^Account…/); await p.wait(1500);
    await p.dialog("account"); await p.esc();
  }, { seed: true }),

  scene("scmjs-ai", "", async (p) => {
    await p.drop("(8)Big Game Hunters.scm");
    await p.minimap(0.22, 0.2);
    await p.page.click('.menubar button:has-text("Tools")'); await p.wait(300);
    await p.page.locator(".menu-item", { hasText: /^AI$/ }).hover(); await p.wait(800);
    await p.take("ai-menu");
    await p.esc(); await p.esc(); await p.wait(300);

    await p.minimap(0.17, 0.12); // Player 1's start location and the ground beside it, left of where the panel opens
    await p.page.keyboard.press("Control+Shift+A"); await p.wait(1000);
    await p.page.locator(".plugin-panel textarea").fill("Give player 1 four marines and a siege tank beside their start location.");
    await p.page.keyboard.press("Enter");
    await p.page.locator(".plugin-panel .ai-msg", { hasText: /^Done\./ }).waitFor({ timeout: 60_000 }); await p.wait(1500);
    await p.take("assistant");
    await p.page.keyboard.press("Control+Shift+A"); await p.wait(400);

    await p.submenu("Tools", /^AI$/, /^Name and Describe/); await p.wait(800);
    await p.page.locator(".dlg button", { hasText: /^Suggest$/ }).click();
    await p.page.locator(".dlg .ai-item").first().waitFor({ timeout: 30_000 }); await p.wait(600);
    await p.page.locator(".dlg .ai-item").first().click(); await p.wait(300);
    await p.dialog("name-describe"); await p.esc();

    await p.submenu("Tools", /^AI$/, /^Review Map/); await p.wait(800);
    await p.page.locator(".dlg .ai-chip", { hasText: /Melee balance/ }).click();
    await p.page.locator(".dlg button", { hasText: /^Review$/ }).click();
    await p.page.locator(".dlg .ai-item").first().waitFor({ timeout: 60_000 }); await p.wait(600);
    await p.dialog("review-map"); await p.esc();

    await p.submenu("Tools", /^AI$/, /^Rewrite Strings/); await p.wait(800);
    await p.page.locator(".dlg textarea").first().fill("Translate into German.");
    await p.page.locator(".dlg button", { hasText: /^Rewrite$/ }).click();
    await p.page.locator(".dlg .ai-table tr").nth(1).waitFor({ timeout: 30_000 }); await p.wait(600);
    await p.dialog("rewrite-strings"); await p.esc();
  }, { seed: true }),

  scene("scmjs-generate", "", async (p) => {
    await p.submenu("Tools", /^AI$/, /^Generate Map/); await p.wait(800);
    await p.page.locator(".dlg select").nth(2).selectOption("jungle"); await p.wait(300); // width, height, tileset, …
    await p.page.locator(".dlg textarea").first().fill("A two-player jungle map with mains on high ground in opposite corners, a natural below each with one ramp, and a lake in the middle with two island expansions.");
    await p.page.locator(".dlg button", { hasText: /^Generate$/ }).click();
    await p.page.locator(".dlg .ai-cell").first().waitFor({ timeout: 60_000 }); await p.wait(800);
    await p.dialog("generate-map");
    await p.page.locator(".dlg button", { hasText: /^Apply$/ }).click();
    await p.page.locator(".dlg button", { hasText: /^Refine$/ }).waitFor({ state: "visible", timeout: 60_000 }); await p.wait(1500);
    await p.esc(); await p.wait(500);
    await p.page.keyboard.press("Control+Shift+0"); await p.wait(1500);
    await p.take("generated-map");

    await p.submenu("Tools", /^AI$/, /^Make Scenario/); await p.wait(800);
    await p.page.locator(".dlg textarea").first().fill("A four-player madness map.");
    await p.page.locator(".dlg button", { hasText: /^Design$/ }).click();
    await p.page.locator(".dlg", { hasText: /Systems \(/ }).waitFor({ timeout: 60_000 }); await p.wait(800);
    await p.dialog("make-scenario"); await p.esc();
  }, { seed: true }),

  /* ── TrigScript: the script editor, on a map with three named locations ──────── */

  scene("trigscript", "layer=locations", async (p) => {
    await p.drop("(8)Big Game Hunters.scm");
    // Three locations the script refers to, named through the Locations panel.
    for (const [name, from, to] of [["Beacon", [330, 470], [470, 570]], ["Spawn", [560, 250], [700, 360]], ["Hill", [700, 520], [860, 660]]]) {
      await p.drag(from, to);
      await p.page.locator(".props input[aria-label='Location name']").fill(name);
      await p.page.keyboard.press("Enter"); await p.wait(400);
    }
    await p.page.click(rail(0)); await p.wait(300);
    await p.menu("Triggers", /^TrigScript…/);
    await p.script(TRIGSCRIPT);
    await p.dialog("trigscript");

    // Completion on `locations.`: a new statement typed on the blank line between the programs.
    const line = TRIGSCRIPT.split("\n").findIndex((l, i) => i > 17 && l === "") + 1;
    await p.monaco((monaco, ed) => { ed.revealLineInCenter(line); ed.setPosition({ lineNumber: line, column: 1 }); ed.focus(); ed.trigger("keyboard", "type", { text: "trigger(P1, [elapsedTime(\">=\", 60)], [centerView(locations." }); }, { line });
    await p.page.locator(".suggest-widget .monaco-list-row").first().waitFor({ timeout: 15_000 }); await p.wait(800);
    // Open the list again once the editor has settled, so it sits at the cursor.
    await p.esc(); await p.monaco((monaco, ed) => { ed.trigger("keyboard", "editor.action.triggerSuggest", {}); }); await p.wait(1000);
    await p.page.locator(".suggest-widget .monaco-list-row").first().waitFor({ timeout: 15_000 }); await p.wait(400);
    // The list opens above or below the line; the picture holds the line either way.
    const box = await p.page.locator(".suggest-widget").boundingBox();
    const cursor = await p.page.locator(".tsd .monaco-editor .cursor").first().boundingBox();
    const left = (await p.page.locator(".tsd .monaco-editor").boundingBox()).x;
    const top = Math.min(cursor.y, box.y) - 24, bottom = Math.max(cursor.y + cursor.height, box.y + box.height) + 16;
    await p.take("trigscript-complete", { x: left, y: Math.max(0, top), width: Math.min(1400 - left, box.x + box.width + 40 - left), height: bottom - top }, { lossless: true });
    await p.esc(); await p.monaco((monaco, ed) => { ed.getModel().setValue(globalThis.__text); }, { __text: TRIGSCRIPT }); await p.wait(2500);

    await p.page.locator(".tsd button", { hasText: /^Simulate$/ }).click();
    await p.page.locator(".tsd-run li").first().waitFor({ timeout: 30_000 }); await p.wait(800);
    // The lower part of the window: the last lines of the code and the run beneath them.
    const first = await p.page.locator(".tsd-run li").first().boundingBox();
    const dlg = await p.page.locator(".dlg").last().boundingBox();
    const foot = await p.page.locator(".dlg .dlg-footer").last().boundingBox();
    await p.take("trigscript-simulate", { x: dlg.x, y: first.y - 72, width: dlg.width, height: foot.y - (first.y - 72) }, { lossless: true });

    await p.page.locator(".dlg-footer button", { hasText: /^Build & Close$/ }).click();
    await p.page.locator(".dlg").waitFor({ state: "detached", timeout: 30_000 }); await p.wait(800);
    await p.menu("Triggers", /^Trigger Editor/); await p.wait(1200);
    await p.page.locator(".dlg .trig-list .item", { has: p.page.locator(".badge") }).first().click(); await p.wait(600);
    await p.dialog("trigscript-triggers"); await p.esc();

    // Beside the map, on the Locations layer so the named locations show; the panel made
    // smaller by its corner grip and moved to the top right, so two of them stay in view.
    await p.page.click(rail(4)); await p.wait(400);
    await p.menu("Triggers", /^TrigScript beside the map/);
    await p.page.locator(".plugin-panel .monaco-editor .view-lines").waitFor({ timeout: 120_000 }); await p.wait(3000);
    const panel = await p.page.locator(".plugin-panel").boundingBox();
    await p.page.mouse.move(panel.x + panel.width - 6, panel.y + panel.height - 6); await p.page.mouse.down();
    await p.page.mouse.move(panel.x + panel.width - 100, panel.y + panel.height - 150, { steps: 8 }); await p.page.mouse.up(); await p.wait(400);
    await p.page.mouse.move(panel.x + 250, panel.y + 12); await p.page.mouse.down();
    await p.page.mouse.move(panel.x + 250 + (1146 - (panel.x + panel.width - 100)), panel.y + 12, { steps: 8 }); await p.page.mouse.up(); await p.wait(800);
    await p.take("trigscript-beside");
  }),
];

/**
 * The script in the TrigScript pictures: the guide's wave-defence example, on the three
 * locations the scene makes, without hyper triggers so that Simulate's thirty cycles
 * reach the last wave (a sleep of twenty seconds is ten cycles at the plain rate).
 */
const TRIGSCRIPT = `const waves = [
  { unit: units.ZergZergling, n: 8 },
  { unit: units.ZergHydralisk, n: 6 },
  { unit: units.ZergUltralisk, n: 2 },
];

program(() => {
  displayText("The first wave arrives in twenty seconds.");
  sleep(seconds(20));
  for (const w of waves) {
    createUnit(P8, w.unit, w.n, locations.Spawn);
    order(P8, w.unit, locations.Spawn, locations.Hill, "attack");
    sleep(seconds(20));
  }
  while (command(P8, units.AnyUnit, ">=", 1)) {
    sleep(seconds(2));
  }
  displayText("The last wave is broken.");
  victory();
});

program(() => {
  let lives: u8 = 3;
  while (true) {
    if (deaths(CurrentPlayer, units.JimRaynorMarine, ">=", 1)) {
      setDeaths(CurrentPlayer, units.JimRaynorMarine, "set", 0);
      lives -= 1;
      if (lives == 0) defeat();
      else createUnit(CurrentPlayer, units.JimRaynorMarine, 1, locations.Beacon);
    }
  }
}, { owner: AllPlayers });
`;

/**
 * The scmjs.dev plugin turned on and signed in against the stand-in server.
 *
 * Two keys. `scmjs.plugins` is the installed list: the plugin is a default, but one that
 * ships *off* (`src/plugins/defaults.ts`), so without a stored row saying otherwise there
 * is no Account menu and no Tools ▸ AI to photograph. The spec is left unpinned on
 * purpose — `effectiveInstalls` matches a stored row to a default by `pluginKey` and then
 * runs the *default's* spec, so this says "on" without also freezing which version these
 * pictures are of. The other key is the editor's per-plugin storage prefix and the
 * plugin's own `settings` key, holding the server and a session.
 */
function seedScmjs(mockUrl) {
  return `localStorage.setItem("scmjs.plugins", ${JSON.stringify(JSON.stringify([
    { spec: "github:scm-js/plugin-scmjs-dev", enabled: true },
  ]))});
  localStorage.setItem("scmjs.plugin.scmjs-dev.settings", ${JSON.stringify(JSON.stringify({
    serverUrl: mockUrl, session: "guide-session", deviceId: "guide-device", statusItem: true,
    ai: true, quality: "standard", showThinking: true, maxRounds: 24, attachView: false, dockAssistant: false,
  }))});`;
}

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

function scene(name, query, run, { seed = false } = {}) { return { name, query, run, seed }; }

async function main() {
  mkdirSync(OUT, { recursive: true });
  const mock = await startMock({ port: 8765 });
  const browser = await chromium.launch({ ...(BROWSER ? { executablePath: BROWSER } : {}), args: ["--no-sandbox"] });
  try {
    for (const s of SCENES) {
      if (SCENES_ONLY.length && !SCENES_ONLY.includes(s.name)) continue;
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
      if (s.seed) await ctx.addInitScript(seedScmjs(mock.url));
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.error(`[${s.name}] page error:`, e.message));
      const p = driver(page, mock);
      await p.goto(s.query);
      await s.run(p);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await mock.close();
  }
}

function driver(page, mock) {
  const wait = (ms) => page.waitForTimeout(ms);
  const p = {
    page, wait, mock,
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
    /** An item inside a submenu: open the top menu, hover the submenu's row, click the item. */
    async submenu(top, sub, item) {
      await page.click(`.menubar button:has-text("${top}")`); await wait(200);
      await page.locator(".menu-item", { hasText: sub }).hover(); await wait(500);
      await page.locator(".menu-content").last().locator(".menu-item", { hasText: item }).click(); await wait(800);
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
    /**
     * Run `fn(monaco, editor)` in the page against the Monaco the TrigScript plugin loaded —
     * the same module instance, since it is imported by the same URL (the plugin's `DIST_TAG`).
     */
    async monaco(fn, args = {}) {
      await page.evaluate(async ({ src, args }) => {
        const monaco = await import("https://cdn.jsdelivr.net/gh/scm-js/plugin-trigscript@monaco-0.56.0-2/dist/monaco.js");
        const ed = monaco.editor.getEditors()[0];
        Object.assign(globalThis, args);
        new Function("monaco", "ed", `(${src})(monaco, ed)`)(monaco, ed);
      }, { src: fn.toString(), args });
    },
    /** Wait for the TrigScript editor, put `text` in `main.ts`, and wait for the check to settle. */
    async script(text) {
      await page.locator(".tsd .monaco-editor .view-lines").waitFor({ timeout: 120_000 }); await wait(1500);
      await p.monaco((monaco, ed) => { ed.getModel().setValue(globalThis.__text); }, { __text: text });
      await wait(2500);
      await page.locator(".tsd > .row .hint", { hasText: /problem/ }).waitFor({ timeout: 60_000 }); await wait(1500);
    },
  };
  return p;
}

await main();
