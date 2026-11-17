/**
 * The pictures in the user guide (`docs/guide.md` → `docs/images/*.webp`), taken again.
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
 *                                      [--plugin http://localhost:3121/]   # a local scmjs.dev plugin build
 *                                      [--playground http://localhost:3110/]  # a local API Playground build
 *                                      [--remastered "/path/to/StarCraft"]    # a StarCraft: Remastered installation
 *                                      [--mod <folder> --mod-maps <folder>]   # a mod and maps made for it
 *
 * Needs the game data extracted (the pictures are of real graphics) and, in
 * `fixtures/maps/`, Big Game Hunters, Binary Burghs, Crescent Moon and Ground Zero from
 * the game's own Maps folder. Nothing here is a test: a picture that comes out wrong is
 * seen by looking at it.
 *
 * The Remastered pictures need the real thing: `--remastered` (or `SCM_REMASTERED_DIR`)
 * names an installation, which the scene installs through Help ▸ Game Data… as a user
 * would, beside the copy the dev server serves. Without it that scene is skipped and its
 * pictures are left as they are.
 *
 * The pictures of a mod's terrain likewise: `--mod` (or `SCM_MOD_DIR`) names the mod's
 * folder, added as a data set through Help ▸ Game Data…, and `--mod-maps` (or
 * `SCM_MOD_MAPS`) a folder of maps made for it, which Learn from Maps… reads. They were
 * taken with Cosmonarchy's Badlands; without the options that scene is skipped.
 *
 * The replay pictures need what scmjs.dev has: `--base` an editor served under `/editor/`
 * with scm-sim's play page beside it at `/play/` (the plain dev server has no play page,
 * so no Replay view and no analysis), `--starcraft` (or `SCMJS_STARCRAFT`) a StarCraft
 * 1.16.1 folder (StarDat, BrooDat and patch_rt.mpq: without patch_rt the analysis parts
 * from the replay a few minutes in), installed through the first-use Game Data dialog as a
 * user would, and `--replays` a folder of replays of one map. They were taken with six games
 * on Crescent Moon from `scmjs bot ladder` (seeds 1–3), Starter as protoss (scmbot's
 * `examples/starter/starter.mjs`) against Vanta as terran (scm-sim's
 * `src/bot/samples/vanta.ts`, its type import pointed at `@scm-js/bot`); `--replay` names
 * the one in front and `--replay-at` the moment shown. Without the options the scene is
 * skipped.
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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
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
/** The scmjs.dev plugin as the editor pins it (`src/plugins/defaults.ts`), so the pictures are of the version that ships. */
const PINNED_SCMJS = /"(github:scm-js\/plugin-scmjs-dev@v[^"]+)"/.exec(readFileSync(join(root, "src/plugins/defaults.ts"), "utf8"))?.[1] ?? "github:scm-js/plugin-scmjs-dev";
/** `--plugin <address>`: a local build of it instead, while working on the plugin (the pinned one is turned off). */
const SCMJS_PLUGIN = opt("--plugin", PINNED_SCMJS);
const FIXTURES = join(root, "fixtures/maps");
/** The API Playground plugin: not a default, so it is installed for its scene; `--playground` points at a local build. */
const PLAYGROUND_PLUGIN = opt("--playground", "github:scm-js/plugin-api-playground");
/** A StarCraft: Remastered installation folder, for the scene that pictures its graphics. */
const REMASTERED = opt("--remastered", process.env.SCM_REMASTERED_DIR ?? "");
/** A mod's folder (its archives or loose files) and a folder of maps made for it, for the scene that pictures a mod's terrain. */
const MOD = opt("--mod", process.env.SCM_MOD_DIR ?? "");
const MOD_MAPS = opt("--mod-maps", process.env.SCM_MOD_MAPS ?? "");
/** The data set's name, which the Tile tab's filter shows ("Added by …"). */
const MOD_NAME = opt("--mod-name", process.env.SCM_MOD_NAME ?? "Cosmonarchy");
/** A StarCraft 1.16.1 folder and a folder of replays of one map, for the replay scene. */
const STARCRAFT = opt("--starcraft", process.env.SCMJS_STARCRAFT ?? "");
const REPLAYS = opt("--replays", "");
/** The replay in front (a file in `--replays`), and the moment of it the pictures show. */
const REPLAY = opt("--replay", "vanta-vs-starter_crescent-moon_TvP_seed2.rep");
const REPLAY_AT = opt("--replay-at", "10:15");

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
    // One deep link per dialog: `?dialog=` opens it over the blank startup map. (Symmetry's is
    // taken by the symmetry scene, on a map with something to measure.)
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
      "unit-settings": "unitSettings", cuwp: "cuwpEditor", "map-properties": "mapProperties", "test-map": "testMap",
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
    await p.quiet({ updates: true });
    await p.take("paint");
  }),

  scene("bgh", "", async (p) => {
    await p.drop("(8)Big Game Hunters.scm");
    await p.minimap(0.22, 0.2);
    await p.quiet({ updates: true });
    await p.take("editor-plain");
    if (!ONLY.length || ONLY.includes("editor")) await annotate(join(OUT, "editor-plain.webp"), join(OUT, "editor.webp"));
    await p.menu("Scenario", /String Editor/); await p.wait(1000); await p.dialog("string-editor"); await p.esc();
    await p.menu("Triggers", /^Trigger Editor/); await p.wait(1200);
    await p.page.locator(".dlg .trig-list .item").nth(1).click().catch(() => {}); await p.wait(600);
    await p.dialog("trigger-editor"); await p.esc();
    // The Text Trigger Editor is the TrigEdit plugin, installed but off by default: its
    // picture is taken only when the build has it turned on.
    await p.page.click('.menubar button:has-text("Triggers")'); await p.wait(200);
    const textTriggers = p.page.locator(".menu-item", { hasText: /^Text Trigger Editor/ }).first();
    if (await textTriggers.count()) {
      await textTriggers.click(); await p.wait(2000); await p.dialog("text-triggers"); await p.esc();
    } else {
      await p.esc();
      console.log("text-triggers: skipped — TrigEdit is off");
    }
    await p.page.keyboard.press("Control+Shift+W"); await p.wait(4000); await p.take("walkability");
    await p.page.keyboard.press("Control+Shift+W"); await p.wait(500);
  }),

  scene("remastered", "dialog=gameData&zoom=2", async (p) => {
    if (!REMASTERED) { console.log("remastered: skipped — no --remastered <StarCraft folder>"); return; }
    // Installed as a user would: the dialog's own button, the folder handed to its chooser.
    const [chooser] = await Promise.all([p.page.waitForEvent("filechooser"), p.page.locator(".dlg button", { hasText: "Add StarCraft: Remastered" }).click()]);
    await chooser.setFiles(REMASTERED);
    await p.page.locator(".toast", { hasText: "Data set ready" }).waitFor({ timeout: 300_000 });
    await p.wait(1500);
    await p.dialog("game-data-remastered");
    await p.page.locator(".dlg .dlg-close").last().click(); await p.wait(400);

    // The top-left start of Big Game Hunters, scrolled so that the start location's middle
    // (384, 240 on the map) is under the rule: the Command Center put in its place is drawn
    // half in each look, and the same units stand on either side of it. The start location
    // goes first, since a click on it would select it rather than place anything.
    await p.drop("(8)Big Game Hunters.scm");
    await p.page.evaluate(() => { const el = document.querySelector(".scroller"); el.scrollLeft = 384 * 2 - 429; el.scrollTop = 60; });
    await p.wait(800);
    await p.page.click(rail(2)); await p.wait(600);
    await p.click(...at(429, 420)); await p.page.keyboard.press("Delete"); await p.wait(300);
    const place = async (name, spots) => { await p.unit(name); for (const [x, y] of spots) await p.click(...at(x, y)); };
    const both = (name, spots) => place(name, spots.flatMap(([x, y]) => [[x, y], [858 - x, y]]));
    await place("Terran Command Center", [[429, 420]]);
    await both("Terran SCV", [[330, 210], [250, 270]]);
    await both("Terran Marine", [[200, 420], [160, 470]]);
    await both("Terran Siege Tank (Tank Mode)", [[176, 568]]);
    await both("Protoss Zealot", [[384, 672]]);
    await both("Protoss Dragoon", [[296, 704]]);
    await both("Zerg Hydralisk", [[56, 700]]);
    await both("Zerg Mutalisk", [[110, 300]]);
    await p.esc(); await p.search("");
    await p.page.click(rail(0)); await p.wait(600);
    await p.page.mouse.move(1300, 500);

    // The option is on after the install. One picture of each, the same view, joined down the middle.
    await p.wait(3000);
    const remastered = await p.page.screenshot({ clip: MAP });
    await p.menu("View", /Remastered Graphics/); await p.wait(1500);
    const classic = await p.page.screenshot({ clip: MAP });
    await p.menu("View", /Remastered Graphics/); await p.wait(1500);
    if (!ONLY.length || ONLY.includes("remastered-compare")) await sideBySide(classic, remastered, join(OUT, "remastered-compare.webp"));

    // Water, which a still picture can only show standing: the shore at 100%.
    await p.goto("zoom=1");
    await p.drop("(8)Big Game Hunters.scm");
    await p.page.evaluate(() => { const el = document.querySelector(".scroller"); el.scrollLeft = 30 * 32; el.scrollTop = 34 * 32; });
    await p.wait(3000);
    await p.take("remastered-water", MAP);

    // Where the water and lava are adjusted.
    await p.goto("dialog=preferences&page=view");
    await p.page.locator(".dlg summary", { hasText: "Water and lava" }).click(); await p.wait(400);
    // The page is longer than the dialog: its foot at the bottom, so the settings opened are in the picture.
    await p.page.locator(".dlg details", { hasText: "Water and lava" }).evaluate((el) => el.scrollIntoView({ block: "end" })); await p.wait(300);
    await p.dialog("preferences-graphics");
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

  // A cliff ramp pulled out along its cliff: a plateau laid with the isometric brush, the ramp picked,
  // pressed where it fits and dragged, the picture taken with the button still down.
  scene("stretch", "mode=isom", async (p) => {
    await p.brush(7);
    await p.terrain("High Dirt");
    await p.stroke(Array.from({ length: 21 }, (_, i) => at(330 + i * 16, 200 + i * 8)));
    await p.page.click(rail(1)); await p.wait(800);
    await p.search("#77");
    await p.page.locator(".palette .doodad").first().click(); await p.wait(400);
    // The ramp fits one edge of the plateau only: try spots until the status bar says it went down.
    const placed = async () => /Placed Cliff/.test((await p.page.locator("body").innerText()).split("\n").filter((l) => /Placed|Can't place/.test(l)).at(-1) ?? "");
    let spot = null;
    for (let y = 230; y < 520 && !spot; y += 16) {
      for (let x = 180; x < 520 && !spot; x += 32) {
        await p.page.mouse.click(...at(x, y)); await p.wait(40);
        if (await placed()) spot = [x, y];
      }
    }
    if (!spot) throw new Error("no place on the plateau took the ramp");
    await p.page.keyboard.press("Control+z"); await p.wait(300);
    await p.page.mouse.move(...at(...spot)); await p.page.mouse.down();
    await p.page.mouse.move(...at(spot[0] + 192, spot[1] + 96), { steps: 12 }); await p.wait(400);
    // A plugin's update notice, if one is up, is not part of the picture.
    await p.page.evaluate(() => document.querySelectorAll(".toasts").forEach((el) => { el.style.visibility = "hidden"; }));
    await p.take("doodad-stretch", MAP);
    await p.page.mouse.up();
    // The same ramp, placed, with the joins that show drawn over it.
    await p.esc();
    await p.menu("View", /Seam Overlay/);
    await p.page.mouse.move(...at(820, 40));
    await p.take("terrain-seams", MAP);
  }),

  // The Tile tab's sheet at full size, a Jungle temple picked by dragging over it, and the
  // block laid on the map: pressed once and dragged, so the copies run on side by side.
  scene("tile-sheet", "mode=isom&tileset=jungle", async (p) => {
    await p.brush(7);
    await p.terrain("Dirt");
    for (const y of [260, 380, 500, 620]) await p.steadyStroke([at(40, y), at(820, y)]);
    await p.tab("Tile");
    await p.page.locator(".palette button[aria-label='Sheet']").click(); await p.wait(600);
    await p.page.locator(".palette select[aria-label='Group filter']").selectOption("doodad"); await p.wait(600);
    await p.page.locator(".palette button[aria-label='Tiles at full size']").click(); await p.wait(600);
    await p.sheetScroll(1198);
    await p.sheetDrag([1202, 0], [1207, 5]);
    await p.quiet();
    await p.take("palette-sheet", PALETTE);
    await p.steadyStroke([at(110, 300), at(530, 300)]);
    await p.page.mouse.move(1300, 500); await p.wait(300);
    await p.take("terrain-block", MAP);
  }, { init: () => SEEDED_RANDOM }),

  // What pinning is for: a ramp stretched along a plateau (its tiles pinned as it goes down)
  // and a stroke of the isometric brush along its foot that leaves it whole, the Pin tab open
  // so the pins are marked.
  scene("pin", "mode=isom", async (p) => {
    await p.brush(7);
    await p.terrain("High Dirt");
    await p.steadyStroke(Array.from({ length: 21 }, (_, i) => at(330 + i * 16, 200 + i * 8)));
    await p.page.click(rail(1)); await p.wait(800);
    await p.search("#77");
    await p.page.locator(".palette .doodad").first().click(); await p.wait(400);
    const spot = await p.spot(/Placed Cliff/, [330, 640, 32], [300, 600, 16]);
    await p.page.keyboard.press("Control+z"); await p.wait(300);
    await p.drag(spot, [spot[0] + 192, spot[1] + 96]);
    console.log(`pin: ${await p.status()}`);
    await p.esc();
    await p.page.click(rail(0)); await p.wait(600);
    await p.tab("Isometric");
    await p.brush(3);
    await p.terrain("Grass");
    await p.steadyStroke([at(spot[0] - 60, spot[1] + 150), at(spot[0] + 300, spot[1] + 150)]);
    console.log(`pin: ${await p.status()}`);
    await p.tab("Pin");
    await p.page.mouse.move(1300, 500);
    await p.quiet();
    // The palette and the part of the map that holds the ramp.
    await p.take("terrain-pin", { x: 0, y: 62, width: 940, height: 808 }, { lossless: false });
  }, { init: () => SEEDED_RANDOM }),

  // A small symmetric Desert map made under Left ↔ right: high ground, a cliff ramp whose twin
  // lands across the axis (the doodad-twin picture, taken with the button still down), a start
  // location with its mineral line. Then the Symmetry dialog's measure of it, and the
  // differences drawn on the map.
  scene("symmetry", "mode=isom&dialog=newMap", async (p) => {
    // 64 × 64, no start locations: they are placed below, mirrored.
    await p.page.locator(".dlg .tileset-card", { hasText: "Desert" }).click();
    for (const i of [0, 1]) await p.page.locator(".dlg select").nth(i).selectOption("64");
    const auto = p.page.locator(".dlg label", { hasText: "Place automatically" }).locator("input");
    if (await auto.isChecked()) await auto.uncheck();
    await p.page.locator(".dlg button", { hasText: /^Create$/ }).click(); await p.wait(1500);
    await p.symmetry(/Left ↔ right/);
    // A tar pit low on the left, copied to the right.
    await p.zoom(1); await p.scrollTo(0, 38 * 32);
    await p.brush(3);
    await p.terrain("Tar"); await p.steadyStroke([await p.tile(10, 46), await p.tile(20, 50)]);
    // High ground left of the axis and its copy right of it: the view moved eight tiles left of
    // the map's middle to paint, then back.
    await p.scrollTo(32 * 32 - 429 - 256, 32 * 32 - 392);
    await p.brush(5);
    await p.terrain("High Dirt"); await p.steadyStroke([at(160, 300), at(200, 400), at(330, 335)]);
    await p.scrollTo(32 * 32 - 429, 32 * 32 - 392);
    await p.page.click(rail(1)); await p.wait(800);
    await p.search("#230");
    await p.page.locator(".palette .doodad").first().click(); await p.wait(400);
    // Where the ramp and its twin both fit ("Placed 2 ×").
    const spot = await p.spot(/Placed 2 × Cliff/, [20, 420, 32], [150, 700, 16]);
    await p.page.keyboard.press("Control+z"); await p.wait(300);
    await p.page.mouse.move(...at(...spot)); await p.page.mouse.down();
    await p.page.mouse.move(...at(spot[0] + 20, spot[1] + 6), { steps: 4 }); await p.wait(400);
    await p.quiet();
    await p.take("doodad-twin", MAP);
    await p.page.mouse.up(); await p.wait(300);
    console.log(`symmetry: ${await p.status()}`);
    await p.esc();
    // A start location on the high ground and its mineral line, copied for Player 2.
    await p.page.click(rail(2)); await p.wait(600);
    await p.unit("Start Location"); await p.click(...at(190, 330));
    await p.unit("Mineral Field (Type 1)");
    for (const [x, y] of [[96, 266], [86, 298], [82, 330], [86, 362], [96, 394]]) await p.click(...at(x, y));
    // One more on the right only, with symmetry off for it.
    await p.symmetry(/^Off/);
    await p.click(...at(820, 200));
    console.log(`symmetry: ${await p.status()}`);
    await p.symmetry(/Left ↔ right/);
    await p.esc(); await p.search("");
    await p.page.click(rail(0)); await p.wait(400);
    await p.menu("Tools", /^Symmetry…/); await p.wait(2500);
    await p.dialog("symmetry");
    // The dialog's first place: the differences drawn, the view at 50% on the whole map.
    await p.page.locator(".dlg button", { hasText: /^Tiles / }).first().click(); await p.wait(1500);
    await p.zoom(0.5); await p.minimap(0.5, 0.56);
    await p.page.mouse.move(1300, 500);
    await p.take("symmetry-differences", MAP);
  }, { init: () => SEEDED_RANDOM }),

  // Heal over the whole of Big Game Hunters, at 200% with the seam overlay on: the same
  // shore before and after, side by side.
  scene("heal", "mode=heal&zoom=2", async (p) => {
    await p.drop("(8)Big Game Hunters.scm");
    await p.page.locator(".palette label", { hasText: /Seam Overlay/ }).click();
    await p.minimap(0.25, 0.27);
    await p.quiet();
    const view = { ...MAP, width: 429 };
    const before = await p.page.screenshot({ clip: view });
    await p.page.locator(".palette button", { hasText: /^Heal the Whole Map$/ }).click(); await p.wait(2500);
    console.log(`heal: ${await p.status()}`);
    const after = await p.page.screenshot({ clip: view });
    if (!ONLY.length || ONLY.includes("terrain-heal")) await sideBySide(before, after, join(OUT, "terrain-heal.webp"), { labels: ["Before", "After"], halves: false });
  }),

  // A mod's Badlands (Cosmonarchy's when these were taken): the mod added as a data set
  // through Game Data, its terrain from other tilesets found, its maps learned from, then the
  // sheet, a piece, Installation's Floor laid over Dirt, and that floor with and without the
  // borders the maps draw. The folder of maps goes in through the folder input: the scene
  // takes the folder picker away (as a browser without one has it), since a headless browser
  // cannot answer it.
  scene("mod-terrain", "dialog=gameData", async (p) => {
    if (!MOD || !MOD_MAPS) { console.log("mod-terrain: skipped — no --mod <folder> --mod-maps <folder>"); return; }
    const t0 = Date.now();
    await p.page.locator(".dlg button", { hasText: "Add a data set…" }).click();
    await p.page.locator(".dlg input[placeholder^='Name of the data set']").fill(MOD_NAME);
    const [chooser] = await Promise.all([p.page.waitForEvent("filechooser"), p.page.locator(".dlg button", { hasText: "Choose the folder…" }).click()]);
    await chooser.setFiles(MOD);
    await p.page.locator(".toast", { hasText: "Data set ready" }).waitFor({ timeout: 900_000 });
    console.log(`mod-terrain: installed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    await p.goto("mode=isom&tileset=badlands");
    await p.quiet();
    // The other tilesets' terrain this one holds copies of, then what the mod's maps lay.
    await p.page.locator(".palette button", { hasText: "Find terrain from other tilesets" }).click();
    await p.page.locator(".palette .borrowed-source").first().waitFor({ timeout: 300_000 });
    await p.page.locator(".palette", { hasText: "Looking through" }).waitFor({ state: "detached", timeout: 300_000 }).catch(() => {});
    console.log(`mod-terrain: ${await p.status()}`);
    await p.tab("Tile");
    await p.page.locator(".palette button[aria-label='Pieces']").click(); await p.wait(800);
    const [maps] = await Promise.all([p.page.waitForEvent("filechooser"), p.page.locator(".palette button", { hasText: "Learn from Maps…" }).click()]);
    await maps.setFiles(MOD_MAPS);
    await p.page.locator(".palette .pieces-source", { hasText: /learned map/ }).waitFor({ state: "attached", timeout: 600_000 });
    await p.wait(2000);
    console.log(`mod-terrain: ${(await p.status()).replace(/\. /g, ".\n")}`);
    await p.quiet();
    // The sheet, the mod's own groups only: a block of its floor plating picked by dragging over
    // it and run along in three drags, then a shopfront picked the same way and laid on it.
    await p.page.locator(".palette select[aria-label='Group filter']").selectOption("added"); await p.wait(800);
    await p.page.locator(".palette button[aria-label='Sheet']").click(); await p.wait(800);
    await p.sheetScroll(2470);
    await p.sheetDrag([2477, 0], [2480, 7]);
    await p.scrollTo(0, 0);
    for (const y of [130, 258, 386]) await p.steadyStroke([at(100, y), at(740, y)]);
    await p.sheetDrag([2491, 8], [2496, 15]);
    console.log(`mod-terrain: ${await p.status()}`);
    await p.click(...at(260, 200));
    await p.page.mouse.move(1300, 500); await p.wait(300);
    await p.take("mod-sheet", { x: 0, y: 62, width: 940, height: 808 }, { lossless: false });

    // The pieces the maps lay: one picked and laid.
    await p.page.locator(".palette button[aria-label='Pieces']").click(); await p.wait(800);
    // Down the list (it draws only what is in view) to the first piece past the mod's rocks
    // (groups 2200 on) of 30 tiles or more that the maps lay ten times or more.
    const wanted = (t) => { const m = /(\d+) tiles · laid about ([\d,]+) times · group (\d+)/.exec(t ?? ""); return !!m && +m[1] >= 30 && +m[2].replace(",", "") >= 10 && +m[3] >= 2200; };
    const list = p.page.locator(".tile-pieces");
    for (let y = 0; ; y += 300) {
      await list.evaluate((el, y) => { el.scrollTop = y; }, y); await p.wait(250);
      const titles = await p.page.locator(".palette .piece-thumb").evaluateAll((els) => els.map((e) => e.getAttribute("title")));
      const found = titles.findIndex(wanted);
      if (found >= 0) { const thumb = p.page.locator(".palette .piece-thumb").nth(found); await thumb.scrollIntoViewIfNeeded(); await thumb.click(); break; }
      if (await list.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight)) throw new Error("no piece of the mod's buildings in the list");
    }
    await p.wait(500);
    console.log(`mod-terrain: ${await p.status()}`);
    await p.scrollTo(40 * 32, 0);
    await p.click(...at(300, 300));
    await p.page.mouse.move(1300, 500); await p.wait(300);
    await p.take("mod-pieces", { x: 0, y: 62, width: 940, height: 808 }, { lossless: false });

    // Installation's Floor, from the Isometric tab's list of other tilesets' terrain, over Dirt.
    await p.tab("Isometric");
    await p.page.locator(".palette .terrain-list .item", { hasText: /^Floor$/ }).click(); await p.wait(300);
    await p.brush(3);
    await p.scrollTo(0, 40 * 32);
    await p.steadyStroke([at(200, 250), at(420, 360), at(560, 300)]);
    console.log(`mod-terrain: ${await p.status()}`);
    await p.page.mouse.move(1300, 500); await p.wait(300);
    await p.take("mod-borrowed", { x: 0, y: 62, width: 940, height: 808 }, { lossless: false });

    // The same stroke with Drawn borders off, then on: the same view, side by side.
    const drawn = p.page.locator(".palette label", { hasText: "Drawn borders" }).locator("input");
    const view = { x: MAP.x, y: MAP.y + 280, width: 520, height: 400 };
    const stroke = async (on) => {
      if ((await drawn.isChecked()) !== on) await drawn.click();
      await p.scrollTo(40 * 32 - 80, 40 * 32);
      await p.steadyStroke([at(250, 380), at(330, 420)]);
      console.log(`mod-terrain: drawn borders ${on ? "on" : "off"}: ${await p.status()}`);
      await p.page.mouse.move(1300, 500); await p.wait(400);
      return p.page.screenshot({ clip: view });
    };
    await p.brush(2);
    const plain = await stroke(false);
    await p.page.keyboard.press("Control+z"); await p.wait(600);
    const bordered = await stroke(true);
    if (!ONLY.length || ONLY.includes("mod-borders")) await sideBySide(plain, bordered, join(OUT, "mod-borders.webp"), { labels: ["Plain edge", "Drawn borders"], halves: false });
  }, { init: () => `delete window.showDirectoryPicker; ${SEEDED_RANDOM}` }),

  scene("desert", "layer=doodads", async (p) => {
    await p.drop("(2)Binary Burghs.scx");
    await p.minimap(0.5, 0.5);
    await p.page.locator(".palette .doodad").nth(3).click(); await p.wait(400);
    await p.quiet({ updates: true });
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

  scene("debug-console", "", async (p) => {
    // The strip along the bottom, with a session's worth of the always-on tier in it: the
    // startup lines are already there by the time the map is dropped.
    await p.menu("View", /^Debug Console$/);
    await p.drop("(6)Ground Zero.scm");
    await p.wait(1200);
    const box = await p.page.locator(".debug-console").boundingBox();
    if (box) await p.take("debug-console", { x: 0, y: Math.round(box.y), width: 1400, height: Math.round(Math.min(box.height + 26, 900 - box.y)) }, { lossless: true });
  }),

  scene("briefing", "", async (p) => {
    await p.drop("(6)Ground Zero.scm");
    await p.menu("Triggers", /^Mission Briefing/); await p.wait(1200);
    await p.page.locator(".dlg .trig-list .item").nth(0).click().catch(() => {}); await p.wait(600);
    await p.dialog("briefing");
  }),

  scene("replays", "", async (p) => {
    if (!STARCRAFT || !REPLAYS) { console.log("replays: skipped — no --starcraft <1.16.1 folder> --replays <folder>"); return; }
    // As on scmjs.dev, where nothing is bundled: the first-use Game Data dialog, given the
    // game's folder. The badge in the menu bar then says what the browser keeps.
    const editorPath = new URL(BASE).pathname.replace(/\/$/, "");
    await p.page.route(new RegExp(`${editorPath}/(tileset|unit)/manifest\\.json(\\?.*)?$`), (route) => route.abort());
    await p.goto("");
    const [chooser] = await Promise.all([p.page.waitForEvent("filechooser"), p.page.locator(".dlg button", { hasText: "Choose the StarCraft folder" }).click()]);
    await chooser.setFiles(STARCRAFT);
    await p.page.locator(".toast", { hasText: /ready/i }).waitFor({ timeout: 300_000 });
    await p.goto("");

    // Every replay of the map, the one in front last; each is analysed in the background.
    const files = readdirSync(REPLAYS).filter((f) => f.endsWith(".rep") && f !== REPLAY).sort();
    for (const f of [...files, REPLAY]) await p.drop(join(REPLAYS, f));
    await p.page.locator(".afm", { hasText: / won\b|cannot be told/ }).waitFor({ timeout: 600_000 });
    await p.page.locator(".afm-tl button", { hasText: `Map stats · ${files.length + 1}` }).waitFor({ timeout: 600_000 });
    await p.wait(3000);

    // The moment: a press on the timeline's graph, which spans the whole game.
    const seconds = (s) => s.split(":").reduce((a, b) => a * 60 + Number(b), 0);
    const length = seconds((await p.page.locator(".afm-time").innerText()).split(" / ")[1]);
    const graph = await p.page.locator(".afm-tl canvas").last().boundingBox();
    await p.page.mouse.click(graph.x + graph.width * (seconds(REPLAY_AT) / length), graph.y + graph.height * 0.5);
    await p.page.mouse.move(1280, 620); // off the timeline, whose hover card would cover the map
    await p.wait(8000);
    await p.quiet();
    await p.take("replay-view");

    await p.page.locator("button", { hasText: /^Map$/ }).first().click(); await p.wait(3000);
    await p.quiet();
    await p.take("replay-map");

    await p.page.locator(".afm-tl button", { hasText: /^Analysis$/ }).click(); await p.wait(5000);
    const win = p.page.locator(".plugin-panel[aria-label='Replay Analysis']");
    const box = await win.boundingBox();
    await p.take("replay-analysis", { x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height + 24 }, { lossless: false });
    await win.locator("button[aria-label='Close']").click(); await p.wait(500);

    // Map stats: every game at once, the whole map in view.
    await p.page.locator(".afm-tl button", { hasText: /^Map stats/ }).click(); await p.wait(4000);
    await p.menu("View", /^Zoom to Fit/); await p.wait(3000);
    await p.page.mouse.move(1280, 620);
    await p.page.evaluate(() => document.activeElement?.blur());
    await p.quiet();
    await p.take("replay-map-stats");
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
    await p.quiet({ updates: true });
    await p.take("ai-menu");
    await p.esc(); await p.esc(); await p.wait(300);

    await p.minimap(0.17, 0.12); // Player 1's start location and the ground beside it, left of where the panel opens
    await p.page.keyboard.press("Control+Shift+A"); await p.wait(1000);
    await p.page.locator(".plugin-panel textarea").fill("Give player 1 four marines and a siege tank beside their start location.");
    await p.page.keyboard.press("Enter");
    await p.page.locator(".plugin-panel .ai-msg", { hasText: /^Done\./ }).waitFor({ timeout: 60_000 }); await p.wait(1500);
    await p.quiet({ updates: true });
    await p.take("assistant");
    await p.page.keyboard.press("Control+Shift+A"); await p.wait(400);

    await p.submenu("Tools", /^AI$/, /^Review Map/); await p.wait(800);
    await p.page.locator(".dlg .ai-chip", { hasText: /Melee balance/ }).click();
    await p.page.locator(".dlg button", { hasText: /^Review$/ }).click();
    await p.page.locator(".dlg .ai-item").first().waitFor({ timeout: 60_000 }); await p.wait(600);
    await p.dialog("review-map"); await p.esc();
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
    await p.quiet({ updates: true });
    await p.take("generated-map");

    await p.submenu("Tools", /^AI$/, /^Make Scenario/); await p.wait(800);
    await p.page.locator(".dlg textarea").first().fill("A four-player madness map.");
    await p.page.locator(".dlg button", { hasText: /^Design$/ }).click();
    await p.page.locator(".dlg", { hasText: /Systems \(/ }).waitFor({ timeout: 60_000 }); await p.wait(800);
    await p.dialog("make-scenario"); await p.esc();
  }, { seed: true }),

  /* ── scmjs.dev: a shared map, two editors on one map through the stand-in ─────── */

  scene("scmjs-share", "", async (p) => {
    await p.drop("(8)Big Game Hunters.scm");
    await p.minimap(0.22, 0.2);
    await p.menu("Account", /^Share this Map/); await p.wait(800);
    // Kept open for a week (the dialog starts on Until everyone leaves), so My Maps has it.
    await p.page.locator(".dlg select").first().selectOption("7"); await p.wait(300);
    await p.dialog("share-keep");
    await p.page.locator(".dlg button", { hasText: /^Start sharing$/ }).click();
    await p.page.locator(".dlg .sd-link input").waitFor({ timeout: 30_000 }); await p.wait(500);
    const link = await p.page.locator(".dlg .sd-link input").inputValue();
    await p.esc();

    // Kim opens the link in an editor of her own, signed out, and joins.
    const kim = await p.other();
    // The invite is in the path (`share/<invite>`), the stand-in's address in the query.
    const opened = new URL(link);
    await kim.goto(opened.search.slice(1), opened.pathname.slice(new URL(BASE).pathname.length));
    await kim.page.locator(".dlg input[placeholder='How the others see you']").fill("Kim");
    await kim.page.locator(".dlg", { hasText: /editing now/ }).waitFor({ timeout: 15_000 }); await kim.wait(300);
    await kim.dialog("share-join");
    await kim.page.locator(".dlg button", { hasText: /^Join$/ }).click();
    await kim.page.locator(".dlg").waitFor({ state: "detached", timeout: 30_000 }); await kim.wait(2500);
    // Her changes, from the same view as Jeany's: a few marines by the ramp. Then she looks up and to the left.
    await kim.minimap(0.22, 0.2);
    await kim.page.click(rail(2)); await kim.wait(600);
    await kim.unit("Terran Marine");
    const marines = [[250, 270], [285, 290], [320, 270], [285, 250]];
    for (const [x, y] of marines) await kim.click(...at(x, y));
    await kim.esc();
    await kim.minimap(0.17, 0.15);
    await p.wait(1500);

    // Where the others are drawn is worked out from Jeany's view, which her editor has told the room.
    const room = p.mock.rooms.last;
    const view = p.mock.rooms.presenceOf(room, "Jeany")?.view;
    if (!view) throw new Error("the owner's view never reached the room");
    const px = (x, y) => ({ px: view.x0 * 32 + x, py: view.y0 * 32 + y });
    p.mock.rooms.pin(room, "Kim", px(340, 300));
    p.mock.rooms.guest(room, "Sam", {
      ...px(690, 560), layer: "units", dialog: "playerSettings",
      view: { x0: view.x0 + 18, y0: view.y0 + 14, x1: view.x1 + 18, y1: view.y1 + 14 },
    });
    await p.wait(1500);
    await p.quiet({ updates: true });
    await p.take("share-editing");
    await p.menu("Account", /^Share this Map/); await p.wait(800);
    // The link as the hosted editor makes it, not the dev server and the stand-in's address.
    await p.page.locator(".dlg .sd-link input").evaluate((el, invite) => { el.value = `https://scmjs.dev/editor/share/${invite}`; }, room.invite);
    await p.dialog("share-dialog"); await p.esc();

    // The account's list of shared maps: this one, plus two from earlier for the list to hold.
    const ago = (days, hours = 0) => new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString();
    p.mock.rooms.seed("Lost Temple Remake", ago(9), { keepDays: 30, lastEditAt: ago(2, 3), lastEditBy: "Kim" });
    p.mock.rooms.seed("Quick 1v1 test", ago(0, 1));
    await p.menu("Account", /^Account…/); await p.wait(1500);
    const list = p.page.locator(".dlg .sd-shared").locator("xpath=..");
    await list.scrollIntoViewIfNeeded(); await p.wait(300);
    const box = await list.boundingBox();
    if (!box) throw new Error("no Shared maps list in the Account dialog");
    await p.take("share-account", { x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height + 24 }, { lossless: true });
    await p.esc();

    // My Maps: the shared map, marked, with the owner's way back to an earlier revision.
    await p.menu("Account", /^My Maps/); await p.wait(1500);
    await p.page.locator(".dlg .sd-map", { hasText: "Big Game Hunters" }).first().click(); await p.wait(1000);
    await p.dialog("share-mymaps"); await p.esc();
    await kim.close();
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
    // A taller panel than the default, so the Simulate picture holds the whole run.
    await p.page.evaluate(() => localStorage.setItem("scmjs.plugin.trigscript.layout.dialog", JSON.stringify({ panelHeight: 330 })));
    await p.menu("Triggers", /^TrigScript…/);
    await p.script(TRIGSCRIPT);
    await p.dialog("trigscript");

    // Completion on `locations.`: a new statement typed on the blank line between the programs.
    const blanks = TRIGSCRIPT.split("\n").flatMap((l, i) => (l === "" ? [i] : []));
    const line = blanks[blanks.length - 2] + 1; // The text ends with a newline, so the last blank is the end of the file.
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

    await p.page.locator(".tsd .monaco-editor textarea, .tsd .monaco-editor .native-edit-context").first().focus();
    await p.page.keyboard.press("Control+F5");
    await p.page.locator(".tsd-view .tsd-list li").nth(1).waitFor({ timeout: 30_000 }); await p.wait(800);
    // The lower part of the window: the last lines of the code, the run beneath them and the status bar.
    const head = await p.page.locator(".tsd-panel-head").boundingBox();
    const dlg = await p.page.locator(".dlg").last().boundingBox();
    await p.take("trigscript-simulate", { x: dlg.x, y: head.y - 72, width: dlg.width, height: dlg.y + dlg.height - (head.y - 72) }, { lossless: true });

    // Tests: the script with two of its own, one of which fails, the Testing view open and the failing one chosen.
    await p.monaco((monaco, ed) => { ed.getModel().setValue(globalThis.__text); }, { __text: TRIGSCRIPT_TESTS });
    await p.page.locator(".tsd-statusbar", { hasText: /1 failed/ }).waitFor({ timeout: 30_000 });
    await p.page.locator('.tsd-activity button[title="Testing"]').click(); await p.wait(400);
    await p.page.locator(".tsd-sidebar .tsd-rows li", { hasText: "second wave" }).click(); await p.wait(600);
    const failing = TRIGSCRIPT_TESTS.split("\n").findIndex((l) => l.includes("toBe(7)")) + 1;
    await p.monaco((monaco, ed) => { ed.revealLineInCenter(globalThis.__line); ed.setPosition({ lineNumber: globalThis.__line, column: 1 }); }, { __line: failing }); await p.wait(600);
    await p.dialog("trigscript-tests");
    await p.page.locator('.tsd-activity button[title="Explorer"]').click(); await p.wait(300);
    await p.monaco((monaco, ed) => { ed.getModel().setValue(globalThis.__text); }, { __text: TRIGSCRIPT }); await p.wait(2500);

    // Apply, then close by the title strip: the workspace has no footer.
    await p.page.keyboard.press("Control+Shift+KeyB");
    await p.page.locator(".tsd-statusbar", { hasText: /triggers? at #/ }).waitFor({ timeout: 30_000 });
    await p.page.locator(".dlg .dlg-close").last().click();
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

  // The plugin guide's pictures of the API Playground: an example run beside the map it
  // changed, and the reference on hover. Installed for the scene, since it is not a default.
  scene("api-playground", "", async (p) => {
    await p.drop("(4)Crescent Moon.scx");
    await p.minimap(0.3, 0.72); await p.wait(800);
    await p.menu("Tools", /^API Playground/);
    await p.page.locator(".apg .monaco-editor .view-lines").waitFor({ timeout: 120_000 }); await p.wait(1500);
    // Narrower and taller than it opens, at the right of the map, so the ring shows beside it.
    const panel = await p.page.locator(".plugin-panel").boundingBox();
    await p.page.mouse.move(panel.x + panel.width - 6, panel.y + panel.height - 6); await p.page.mouse.down();
    await p.page.mouse.move(panel.x + panel.width - 210, panel.y + panel.height + 180, { steps: 8 }); await p.page.mouse.up(); await p.wait(300);
    const narrow = await p.page.locator(".plugin-panel").boundingBox();
    await p.page.mouse.move(narrow.x + 150, narrow.y + 12); await p.page.mouse.down();
    await p.page.mouse.move(narrow.x + 150 + (1144 - (narrow.x + narrow.width)), 100, { steps: 8 }); await p.page.mouse.up(); await p.wait(400);
    await p.page.locator(".apg-bar select").selectOption("example:place-units"); await p.wait(800);
    await p.page.locator(".apg-bar button", { hasText: /^Run$/ }).click(); await p.wait(1500);
    // The view scrolled right, so the ring the snippet placed at its middle sits left of the panel.
    await p.page.mouse.move(...at(100, 400)); await p.page.mouse.wheel(270, 0); await p.wait(1200);
    // The pointer off the map, so no tile cursor is drawn.
    await p.page.mouse.move(1270, 800); await p.wait(300);
    await p.quiet({ updates: true });
    await p.take("api-playground");

    // The reference on hover: `edit` in a line that calls it.
    await p.playground((monaco, ed) => {
      ed.getModel().setValue('api.document.edit("Fill", (tx) => {\n  tx.fillFlat({ x0: 0, y0: 0, x1: 8, y1: 8 }, api.terrain.types()[1].id);\n});\n');
      ed.setPosition({ lineNumber: 1, column: 16 }); ed.focus();
    });
    await p.wait(2500);
    await p.playground((monaco, ed) => { ed.trigger("keyboard", "editor.action.showHover", {}); });
    await p.page.locator(".monaco-hover:not(.hidden) .hover-contents").first().waitFor({ timeout: 15_000 }); await p.wait(800);
    // The panel's width, from the top of the editor to the foot of the hover.
    const hover = await p.page.locator(".monaco-hover:not(.hidden)").first().boundingBox();
    const box = await p.page.locator(".plugin-panel").boundingBox();
    const editor = await p.page.locator(".apg .monaco-editor").boundingBox();
    const top = editor.y - 8, bottom = Math.max(hover.y + hover.height, editor.y + 80) + 14;
    const right = Math.min(1400, Math.max(box.x + box.width, hover.x + hover.width + 12));
    await p.take("api-playground-hover", { x: box.x, y: top, width: right - box.x, height: Math.min(900, bottom) - top }, { lossless: true });
  }, { init: () => `localStorage.setItem("scmjs.plugins", ${JSON.stringify(JSON.stringify([{ spec: PLAYGROUND_PLUGIN, enabled: true }]))});` }),

  // The plugin guide's pictures of what its own examples put on the screen. Each one is an
  // example out of `docs/plugins.md`, found by a line of it and run in the API Playground —
  // so a picture cannot show code the guide does not have — on a map the scene makes itself
  // (no fixture map). The playground's panel is closed before each picture; a run outlives it.
  scene("plugin-guide", "", async (p) => {
    await p.example([], { before: PLUGIN_GUIDE_MAP, wait: 4000 });

    // Your first plugin: the finished Base Check, opened from its menu item.
    await p.example(['api.menu.add("Tools", { label: "Base Check…"']);
    await p.menu("Tools", /^Base Check/);
    await p.page.locator(".plugin-panel .list, .plugin-panel [role=listbox], .plugin-panel-body").first().waitFor(); await p.wait(600);
    await p.page.mouse.move(1270, 800);
    await p.quiet({ updates: true });
    await p.take("plugin-base-check");
    await p.page.locator(".plugin-panel .dlg-close").first().click(); await p.wait(300);

    // A dialog built from widgets.
    await p.example(['title: "Place marines"']);
    await p.dialog("plugin-dialog");
    await p.esc();

    // The waiting widgets, caught mid-search.
    await p.example(['title: "Find units"']);
    await p.page.locator(".dlg input[type=text], .dlg input:not([type])").last().fill("marine");
    await p.page.locator(".dlg button", { hasText: /^Search$/ }).click(); await p.wait(500);
    await p.dialog("plugin-waiting");
    await p.wait(1600); await p.esc();

    // A map tool: two marines dropped, the ring under the pointer, the tool named in the status bar.
    await p.example(['name: "Drop marines"']);
    await p.click(...at(330, 300)); await p.click(...at(420, 340));
    await p.page.mouse.move(...at(500, 300), { steps: 4 }); await p.wait(400);
    await p.quiet({ updates: true });
    await p.take("plugin-map-tool");
    await p.esc();

    // An overlay, zoomed out far enough to see the rings, with its row in the Layers panel.
    await p.example(['name: "Start rings"'], { after: "api.view.setZoom(0.25);\napi.view.center(48, 48);" });
    await p.page.mouse.move(1270, 800);
    await p.quiet({ updates: true });
    await p.take("plugin-overlay");

    // A claimed trigger and a button in the Trigger Editor's slot, in one picture.
    await p.example(['label: "the wave generator"', 'api.ui.dialogSlot("triggerEditor"'], { after: "api.view.setZoom(1);" });
    await p.menu("Triggers", /^Trigger Editor/);
    await p.page.locator(".dlg").last().waitFor(); await p.wait(800);
    await p.dialog("plugin-trigger-editor");
    await p.esc();

    // Two of the recipes at once: the problems panel in the dock, the density overlay on the map.
    await p.example(['title: "Problems"', 'name: "Unit density"'], { after: "api.view.setZoom(0.5);\napi.view.center(24, 24);" });
    await p.page.mouse.move(1270, 500);
    await p.quiet({ updates: true });
    await p.take("plugin-recipes");

    // Where plugin UI appears: a menu item, a floating and a docked panel, a status bar
    // cell and a map button, numbered. The map button has no example in the guide.
    await p.example(['label: "Count units…",\n  icon: "plugin"', 'title: "Unit count"', 'api.ui.open("validateMap")', 'title: "Marine"'], {
      after: 'api.ui.mapButton({ label: "Notes", badge: 3, onClick: () => {} });\napi.view.setZoom(1);\napi.view.goTo({ kind: "unit", index: api.query.startLocations()[0].index });',
      wait: 2500,
    });
    await p.page.click('.menubar button:has-text("Tools")'); await p.wait(400);
    const boxOf = async (locator) => { const b = await locator.first().boundingBox(); if (!b) throw new Error("plugin-surfaces: a surface is not on screen"); return b; };
    const item = await boxOf(p.page.locator(".menu-item", { hasText: /^Count units/ }));
    const floating = await boxOf(p.page.locator(".plugin-panel .plugin-panel-title"));
    const docked = await boxOf(p.page.locator(".plugin-docked .panel-head"));
    const cell = await boxOf(p.page.locator(".statusbar *", { hasText: /^\d+ problems$/ }));
    const button = await boxOf(p.page.locator(".hud-btn", { hasText: "Notes" }));
    await p.page.mouse.move(item.x + 20, item.y + item.height / 2); await p.wait(300);
    await p.quiet({ updates: true });
    if (!ONLY.length || ONLY.includes("plugin-surfaces")) {
      const raw = join(OUT, ".plugin-surfaces.png");
      await p.page.screenshot({ path: raw });
      await annotate(raw, join(OUT, "plugin-surfaces.webp"), [
        [1, item.x + item.width + 16, item.y + item.height / 2],
        [2, floating.x - 16, floating.y + floating.height / 2],
        [3, docked.x - 16, docked.y + docked.height / 2],
        [4, cell.x + cell.width / 2, cell.y - 16],
        [5, button.x + button.width / 2, button.y - 16],
      ]);
      rmSync(raw);
    }
  }, { init: () => `localStorage.setItem("scmjs.plugins", ${JSON.stringify(JSON.stringify([{ spec: PLAYGROUND_PLUGIN, enabled: true }]))});` }),
];

/**
 * `Math.random` from a fixed seed, for a scene whose numbers should come out the same on
 * every run: the isometric brush picks among a tile group's variations at random, and the
 * variations of a cliff do not all walk alike, so the symmetry measure would move a little.
 * Other code draws from it too, so a scene sets the seed (`__seed(n)`) before each stroke.
 */
const SEEDED_RANDOM = `{ let s = 0x5eed; globalThis.__seed = (n) => { s = n; }; Math.random = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }`;

/**
 * The map the plugin guide's pictures are taken on, made through the plugin API: a 96 × 96
 * Jungle map with four start locations, a mineral line and a geyser by each (some fields
 * short, for Base Check to top up), a few marines, and a lake and a plateau so that it reads
 * as a map. Nothing of Blizzard's but the tileset.
 */
const PLUGIN_GUIDE_MAP = `await api.document.create({ width: 96, height: 96, tileset: "jungle", name: "Four Corners", startLocations: 4, startLayout: "corners", into: "current" });
await api.graphics.load();
const terrain = (name) => api.terrain.types().find((t) => t.name === name)?.id;
api.document.edit("Lay out the map", (tx) => {
  const paint = (rect, name) => { const id = terrain(name); if (id !== undefined) for (const d of api.terrain.diamondsIn(rect)) tx.paintIsom(d, id); };
  paint({ x0: 40, y0: 40, x1: 56, y1: 56 }, "Water");
  paint({ x0: 26, y0: 6, x1: 40, y1: 14 }, "High Dirt");
  paint({ x0: 56, y0: 82, x1: 70, y1: 90 }, "High Dirt");
  for (const s of api.query.startLocations()) {
    const side = s.ty < 48 ? 1 : -1;
    for (let i = 0; i < 7; i++) {
      const at = tx.placeUnit(api.consts.unit.mineralFields[i % 3], 11, s.x - 192 + i * 64, s.y + side * 176);
      if (i % 3 === 0 && s.owner < 2) tx.updateUnits([at], () => ({ resourceAmount: 500 }));
    }
    tx.placeUnit(api.consts.unit.vespeneGeyser, 11, s.x + (s.tx < 48 ? 224 : -224), s.y);
    for (let i = 0; i < 4; i++) tx.placeUnit(0, s.owner, s.x - 48 + i * 32, s.y - side * 96);
  }
});
api.view.setZoom(1);
api.view.goTo({ kind: "unit", index: api.query.startLocations()[0].index });
api.selection.setUnits([]);`;

/**
 * The script in the TrigScript pictures: a few plain triggers (what the Trigger Editor
 * picture shows badged — a program adds nothing to the trigger list) and the guide's
 * wave-defence and lives programs, on the three locations the scene makes. The waves come
 * four seconds apart so that Simulate's 480 frames, twenty seconds, reach the last one.
 */
const TRIGSCRIPT = `trigger(AllPlayers, [always()], [
  setResources(CurrentPlayer, "set", 500, "ore"),
  displayText("Hold the hill against three waves."),
]);

for (const p of [P1, P2, P3, P4]) {
  trigger(p, [deaths(p, units.TerranMarine, ">=", 10)], [
    createUnit(p, units.TerranSiegeTankTankMode, 1, locations.Beacon),
    setDeaths(p, units.TerranMarine, "subtract", 10),
  ], { preserve: true });
}

const waves = [
  { unit: units.ZergZergling, n: 8 },
  { unit: units.ZergHydralisk, n: 6 },
  { unit: units.ZergUltralisk, n: 2 },
];

program(() => {
  sleep(seconds(4));
  for (const w of waves) {
    createUnit(P8, w.unit, w.n, locations.Spawn);
    order(P8, w.unit, locations.Spawn, locations.Hill, "attack");
    sleep(seconds(4));
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
    sleep(frames(1));
  }
}, { owner: AllPlayers });
`;

/**
 * The same script with two tests of its own, for the Tests picture. The first passes: the
 * waves come and, once the test has killed them (nothing fights in the simulator), the
 * map is won. The second expects one Hydralisk too many, so the picture has a failure in it.
 */
const TRIGSCRIPT_TESTS = `import { test, expect } from "trigscript";

${TRIGSCRIPT}
test("the map is won when the last wave is dead", (sim) => {
  sim.seconds(13);
  expect(sim.count(P8, units.AnyUnit)).toBe(16);
  for (const unit of sim.units({ owner: P8 })) sim.kill(unit);
  sim.until(() => sim.printed().includes("The last wave is broken."), 240);
});

test("the second wave is six Hydralisks", (sim) => {
  sim.seconds(9);
  expect(sim.count(P8, units.ZergHydralisk, locations.Spawn)).toBe(7);
});
`;

/**
 * The scmjs.dev plugin turned on and signed in against the stand-in server.
 *
 * Two keys. `scmjs.plugins` is the installed list: the plugin is a default and ships on
 * (`src/plugins/defaults.ts`), but a stored row keeps the pictures from depending on that.
 * The spec is left unpinned on purpose — `effectiveInstalls` matches a stored row to a
 * default by `pluginKey` and then runs the *default's* spec, so this says "on" without
 * also freezing which version these pictures are of. The other key is the editor's
 * per-plugin storage prefix and the plugin's own `settings` key, holding the server and a
 * session. With no `mockUrl` only the first is written: a second editor, signed out, that
 * learns the server from the link it opens (`?scmjs-server=`).
 */
function seedScmjs(mockUrl) {
  const plugins = `localStorage.setItem("scmjs.plugins", ${JSON.stringify(JSON.stringify([
    ...(SCMJS_PLUGIN === PINNED_SCMJS ? [] : [{ spec: PINNED_SCMJS, enabled: false }]),
    { spec: SCMJS_PLUGIN, enabled: true },
  ]))});`;
  if (!mockUrl) return plugins;
  return `${plugins}
  localStorage.setItem("scmjs.plugin.scmjs-dev.settings", ${JSON.stringify(JSON.stringify({
    serverUrl: mockUrl, session: "guide-session", deviceId: "guide-device", statusItem: true,
    ai: true, quality: "standard", showThinking: true, maxRounds: 24, attachView: false, dockAssistant: false,
  }))});`;
}

/* ── the annotated overview ────────────────────────────────────────────────────── */

/** The overview's callouts, in the order "The editor window" lists them. */
const EDITOR_MARKS = [[1, 790, 13], [2, 1110, 45], [3, 18, 345], [4, 200, 75], [5, 720, 300], [6, 1335, 75], [7, 1335, 347], [8, 1335, 621], [9, 1000, 888]];

/** Numbered callouts (`[n, x, y]`) over a picture of the window. */
async function annotate(from, to, marks = EDITOR_MARKS) {
  const svg = `<svg width="1400" height="900" xmlns="http://www.w3.org/2000/svg">${marks.map(([n, x, y]) =>
    `<circle cx="${x}" cy="${y}" r="13" fill="#f3c04e" stroke="#1a1a1a" stroke-width="2"/>` +
    `<text x="${x}" y="${y + 5}" font-size="15" font-weight="bold" font-family="DejaVu Sans, sans-serif" fill="#1a1a1a" text-anchor="middle">${n}</text>`).join("")}</svg>`;
  await sharp(from).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).webp({ quality: 88 }).toFile(to);
  console.log(`wrote ${to.slice(to.lastIndexOf("/") + 1)} (annotated)`);
}

/* ── the driver ────────────────────────────────────────────────────────────────── */

/**
 * Two pictures of the same view as one, a rule between them and a label on each side: the
 * left half of `left` and the right half of `right`, or with `halves: false` both whole,
 * next to each other (two pictures of the same clip, each half as wide as the result).
 */
async function sideBySide(left, right, to, { labels: [first, second] = ["Classic", "Remastered"], halves = true } = {}) {
  const { width: w, height } = await sharp(left).metadata();
  const width = halves ? w : w * 2;
  const half = halves ? Math.floor(width / 2) : w;
  const rightPart = halves ? await sharp(right).extract({ left: half, top: 0, width: width - half, height }).toBuffer() : right;
  const label = (text, x, anchor) => `<rect x="${anchor === "start" ? x - 10 : x - 10 - text.length * 9.6}" y="14" width="${text.length * 9.6 + 20}" height="30" rx="4" fill="#0b0d12" fill-opacity="0.82"/>` +
    `<text x="${x}" y="35" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="16" font-weight="600" fill="#e8c06a" text-anchor="${anchor}">${text}</text>`;
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect x="${half - 1}" y="0" width="2" height="${height}" fill="#e8c06a"/>${label(first, 24, "start")}${label(second, width - 24, "end")}</svg>`);
  const base = halves ? sharp(left) : sharp({ create: { width, height, channels: 3, background: "#000" } }).composite([{ input: left, left: 0, top: 0 }]);
  const joined = halves ? base : sharp(await base.png().toBuffer());
  const info = await joined.composite([{ input: rightPart, left: half, top: 0 }, { input: overlay, left: 0, top: 0 }]).webp({ quality: 90 }).toFile(to);
  console.log(`wrote ${to.split("/").pop().replace(/\.webp$/, "")} (${(info.size / 1024).toFixed(0)} KB)`);
}

function scene(name, query, run, { seed = false, init = null } = {}) { return { name, query, run, seed, init }; }

async function main() {
  mkdirSync(OUT, { recursive: true });
  const mock = await startMock({ port: 8765 });
  const browser = await chromium.launch({ ...(BROWSER ? { executablePath: BROWSER } : {}), args: ["--no-sandbox"] });
  try {
    for (const s of SCENES) {
      if (SCENES_ONLY.length && !SCENES_ONLY.includes(s.name)) continue;
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
      if (s.seed) await ctx.addInitScript(seedScmjs(mock.url));
      if (s.init) await ctx.addInitScript(s.init());
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.error(`[${s.name}] page error:`, e.message));
      const p = driver(page, mock, async () => {
        // A second editor in the same scene: its own browser profile, nobody signed in.
        const other = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
        if (s.seed) await other.addInitScript(seedScmjs(null));
        const q = driver(await other.newPage(), mock, null);
        q.close = () => other.close();
        return q;
      });
      await p.goto(s.query);
      await s.run(p);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await mock.close();
  }
}

function driver(page, mock, other) {
  const wait = (ms) => page.waitForTimeout(ms);
  const p = {
    page, wait, mock,
    /** Another editor beside this one (the shared-map scene's second person). */
    other,
    /** The editor at `BASE` + `path` (a link's `share/<invite>`), with `query` after `nosplash`. */
    async goto(query, path = "") { await page.goto(`${BASE}${path}?nosplash${query ? "&" + query : ""}`); await wait(2500); },
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
      const path = isAbsolute(file) ? file : join(FIXTURES, file);
      if (!existsSync(path)) throw new Error(`fixture map missing: ${path}`);
      const b64 = readFileSync(path).toString("base64");
      const dt = await page.evaluateHandle(({ b64, name }) => {
        const bin = atob(b64); const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const dt = new DataTransfer(); dt.items.add(new File([arr], name)); return dt;
      }, { b64, name: basename(file) });
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
    /**
     * With a doodad picked, click map spots ([from, to, step] in x and y, against the map
     * area's corner) until the status bar's last word on placing matches `placed`; a placing
     * that does not match is undone.
     */
    async spot(placed, [x0, x1, dx], [y0, y1, dy]) {
      const last = async () => (await page.locator("body").innerText()).split("\n").filter((l) => /Placed|Can't place/.test(l)).at(-1) ?? "";
      for (let y = y0; y < y1; y += dy) {
        for (let x = x0; x < x1; x += dx) {
          await page.mouse.click(...at(x, y)); await wait(40);
          const word = await last();
          if (placed.test(word)) return [x, y];
          if (word.startsWith("Placed")) { await page.keyboard.press("Control+z"); await wait(150); }
        }
      }
      throw new Error(`no spot took the doodad (${placed}); the last word was: ${await last()}`);
    },
    /** Scroll the map so that map pixel (x, y) is at the map area's top-left. */
    async scrollTo(x, y) { await page.evaluate(([x, y]) => { const el = document.querySelector(".scroller"); el.scrollLeft = x; el.scrollTop = y; }, [x, y]); await wait(500); },
    /** The window point over the middle of map tile (tx, ty) at the zoom and scroll the view has now. */
    async tile(tx, ty) {
      const [sx, sy] = await page.evaluate(() => { const el = document.querySelector(".scroller"); return [el.scrollLeft, el.scrollTop]; });
      const z = Number((await page.locator(".zoom-readout").first().innerText()).replace("%", "")) / 100;
      return [MAP.x + (tx + 0.5) * 32 * z - sx, MAP.y + (ty + 0.5) * 32 * z - sy];
    },
    /** Pick a mode in the toolbar's symmetry list. */
    async symmetry(label) {
      await page.locator("[aria-label='Symmetry mode']").click(); await wait(300);
      await page.locator(".select-item", { hasText: label }).first().click(); await wait(400);
    },
    /** Step the toolbar's zoom until it reads `to` (1 = 100%). */
    async zoom(to) {
      for (let i = 0; i < 8; i++) {
        const now = Number((await page.locator(".zoom-readout").first().innerText()).replace("%", "")) / 100;
        if (Math.abs(now - to) < 0.01) return;
        await page.locator(`button[aria-label='${now > to ? "Zoom Out" : "Zoom In"}']`).first().click(); await wait(500);
      }
    },
    /**
     * Notices (a plugin's update, a finished job) are not part of a picture. With `updates`,
     * only the notices of a new version (of the editor or a plugin), which depend on the day
     * the picture is taken; a notice the picture is about stays.
     */
    async quiet({ updates = false } = {}) {
      await page.evaluate((updates) => {
        const notices = updates ? [...document.querySelectorAll(".toast")].filter((el) => /has been updated|updates? (is|are) available/.test(el.textContent ?? "")) : [...document.querySelectorAll(".toasts")];
        for (const el of notices) el.style.visibility = "hidden";
      }, updates);
    },
    /** The status bar's message, the last cell before the right-hand ones. */
    async status() { return (await page.locator(".statusbar").innerText()).split("\n").find((l) => /\w{4,}.*\s\w+\s/.test(l) && !/^(TILE|PX|ID|MAP|LAYER)$/.test(l)) ?? ""; },
    /** The middle of tile `col` of group `group`'s row in the Tile tab's sheet, in the window. */
    async sheetCell(group, col) {
      const box = await page.locator(".tile-sheet-content").boundingBox();
      const { top, px, left } = await page.locator(".tile-sheet-content").evaluate((el, g) => {
        const rows = [...el.querySelectorAll(".tile-sheet-row")];
        const px = parseFloat(rows[0].style.height), left = parseFloat(rows[0].style.left);
        const labels = [...el.querySelectorAll(".tile-sheet-lbl")].map((l) => ({ g: Number(l.textContent), top: parseFloat(l.style.top) }));
        const near = labels.reduce((a, b) => (Math.abs(b.g - g) < Math.abs(a.g - g) ? b : a));
        return { top: near.top + (g - near.g) * px, px, left };
      }, group);
      return [box.x + left + col * px + px / 2, box.y + top + px / 2];
    },
    /** Scroll the sheet so that group `group`'s row is at the top. */
    async sheetScroll(group) {
      for (let i = 0; i < 4; i++) {
        const [, y] = await p.sheetCell(group, 0);
        const view = await page.locator(".tile-sheet").boundingBox();
        await page.locator(".tile-sheet").evaluate((el, dy) => { el.scrollTop += dy; }, y - view.y - 20); await wait(400);
      }
    },
    /** Drag over the sheet from one [group, col] to another: picks that block. */
    async sheetDrag(from, to) {
      await page.mouse.move(...(await p.sheetCell(...from))); await page.mouse.down();
      await page.mouse.move(...(await p.sheetCell(...to)), { steps: 6 }); await page.mouse.up(); await wait(500);
    },
    async click(x, y) { await page.mouse.click(x, y); await wait(250); },
    async stroke(pts) {
      await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down();
      for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 6 });
      await page.mouse.up(); await wait(500);
    },
    /**
     * A stroke the editor sees the same way on every run: a move every 8 pixels, each given
     * time to be drawn, so that no two are taken as one.
     */
    async steadyStroke(pts) {
      // The same random choices too, where the scene seeded them (SEEDED_RANDOM).
      await page.evaluate(() => globalThis.__seed?.(0x5eed));
      await page.mouse.move(pts[0][0], pts[0][1]); await page.mouse.down(); await wait(60);
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8));
        for (let k = 1; k <= n; k++) { await page.mouse.move(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n); await wait(30); }
      }
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
    /** `monaco`, against the API Playground's own copy of Monaco (it imports the same bundle under `?instance=playground`). */
    async playground(fn, args = {}) {
      await page.evaluate(async ({ src, args }) => {
        const monaco = await import("https://cdn.jsdelivr.net/gh/scm-js/plugin-trigscript@monaco-0.56.0-2/dist/monaco.js?instance=playground");
        const ed = monaco.editor.getEditors().find((e) => e.getModel()?.uri.toString() === "file:///snippet.ts");
        Object.assign(globalThis, args);
        new Function("monaco", "ed", `(${src})(monaco, ed)`)(monaco, ed);
      }, { src: fn.toString(), args });
    },
    /**
     * Run examples out of the plugin guide in the API Playground, then close its panel.
     * Each of `markers` is a piece of one fenced block in `docs/plugins.md`; the blocks are
     * joined into one snippet, since a new run stops the one before. `before` / `after` are
     * lines of the scene's own around them.
     */
    async example(markers, { before = "", after = "", wait: settle = 1500 } = {}) {
      const blocks = [...readFileSync(join(root, "docs/plugins.md"), "utf8").matchAll(/^```ts\n([\s\S]*?)^```/gm)].map((m) => m[1]);
      // The API reference's own examples too: the guide links to those rather than repeating them.
      for (const m of readFileSync(join(root, "src/plugins/api.ts"), "utf8").matchAll(/^\s*\* @example\n((?:\s*\*(?! @|\/).*\n)+)/gm)) {
        blocks.push(m[1].split("\n").map((l) => l.replace(/^\s*\* ?/, "")).filter((l) => !l.startsWith("```")).join("\n"));
      }
      const code = [before, ...markers.map((marker) => {
        const found = blocks.filter((b) => b.includes(marker));
        if (found.length === 0) throw new Error(`neither docs/plugins.md nor api.ts has an example containing: ${marker}`);
        // The whole plugin (the block with `activate`) over a step of the same code.
        return found.find((b) => b.includes("export default")) ?? found[0];
      }), after].filter(Boolean).join("\n");
      if (!(await page.locator(".apg").count())) await p.menu("Tools", /^API Playground/);
      await page.locator(".apg .monaco-editor .view-lines").waitFor({ timeout: 120_000 }); await wait(1200);
      await p.playground((monaco, ed) => { ed.getModel().setValue(globalThis.__code); }, { __code: code });
      await wait(1500);
      await page.locator(".apg-bar button", { hasText: /^Run$/ }).click(); await wait(settle);
      // A modal dialog the example opened covers the panel; it is closed on the next call.
      if (!(await page.locator(".dlg").count())) { await page.locator(".plugin-panel:has(.apg) .dlg-close").click(); await wait(400); }
    },
    /** Wait for the TrigScript editor, put `text` in `main.ts`, and wait for the check to settle. */
    async script(text) {
      await page.locator(".tsd .monaco-editor .view-lines").waitFor({ timeout: 120_000 }); await wait(1500);
      await p.monaco((monaco, ed) => { ed.getModel().setValue(globalThis.__text); }, { __text: text });
      await wait(2500);
      // The problem count in the status bar says "No problems" in its tooltip once a check has come back.
      await page.locator(".tsd-status-left button[title*='roblem']").first().waitFor({ timeout: 60_000 }); await wait(1500);
    },
  };
  return p;
}

await main();
