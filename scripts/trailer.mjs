/**
 * The editor trailer's shots (`trailer/script.md`), recorded from the dev server.
 *
 * Recording is stop-motion, not real time: every frame of the video is one step of the
 * script (the pointer moved a little, the view scrolled a little) followed by a
 * screenshot, and a pause is the same picture repeated. The video is therefore smooth
 * at 30 fps however long the browser takes to draw a frame. Only the editor's own
 * animations (a fade, the water) run on the wall clock, so they come out faster or
 * slower than life; the shots avoid leaning on them.
 *
 * The window is 1600×900 at a device scale of 1.2, so frames are 1920×1080 and the
 * chrome's text reads at video size. Headless Chromium draws no pointer, so one is drawn
 * into the page, following the real mouse events.
 *
 *   npm run dev                              # in another terminal
 *   npm i --no-save playwright               # not a dependency: only this script and the guide pictures need it
 *   node scripts/trailer.mjs [--shots 1,4] [--base http://localhost:5173] [--browser <chrome>]
 *
 * Frames go to trailer/build/frames/shot-NN/, and each shot is encoded to
 * trailer/build/shots/shot-NN.mp4 by the ffmpeg named in FFMPEG (default `ffmpeg`). A
 * Windows ffmpeg.exe works under WSL: it is run from trailer/build/ with relative paths.
 *
 * Needs the game data extracted and, in fixtures/maps/, the maps a shot opens.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import "./lib/load-ts.mjs";
import { startMock } from "./lib/guide-scmjs-mock.mjs";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => { const at = args.indexOf(name); return at === -1 ? fallback : args[at + 1]; };
const BASE = opt("--base", "http://localhost:5173/").replace(/\/?$/, "/");
/** `--shots 1,4` records shot 1 and every cut of shot 4 (4a, 4b, …); `--shots 4c` just that cut. */
const ONLY = opt("--shots", "").split(",").filter(Boolean);
const wanted = (id) => !ONLY.length || ONLY.some((o) => id === o || (id.startsWith(o) && /^[a-z]$/.test(id.slice(o.length))));
const fileName = (id) => `shot-${id.padStart(/[a-z]$/.test(id) ? 3 : 2, "0")}`;
const BROWSER = opt("--browser", process.env.SCMJS_BROWSER ?? "");
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const BUILD = join(root, "trailer/build");
const FIXTURES = join(root, "fixtures/maps");
const FPS = 30;
/**
 * How much slower than written the pointer moves. The shots' timings were first written too
 * fast to follow; every pointer glide is stretched by this, camera moves and typing are not.
 */
const PACE = 1.8;
/** How long the pointer rests on what it is about to click, so the highlight shows first. */
const HOVER = 0.35;
const VIEW = { width: 1600, height: 900 };
const SCALE = 1.2;

let chromium;
try { ({ chromium } = await import("playwright")); } catch {
  console.error("playwright is not installed. Run: npm i --no-save playwright   (and npx playwright install chromium)");
  process.exit(1);
}

/* ── the shots ─────────────────────────────────────────────────────────────────── */

const SHOTS = {
  /**
   * Cold open and title: a slow drift across Enslavers 1, Blizzard's own UMS campaign map (a
   * scenario full of bases and units that shipped with the game), with nothing but the map on
   * screen and the location boxes hidden, and the turning globe with the name fading in over
   * it in place of a title card.
   */
  1: {
    query: "zoom=1",
    async run(r) {
      await r.drop("(1)Enslavers01.scm");
      // The map's own content only: no location boxes, no start-location markers.
      await r.menu("View", /^Locations$/);
      await r.menu("View", /^Start Locations$/);
      await r.bare();
      await r.logo();
      await r.pointer(false);
      // Seconds into the shot: the logo fades in over 3.2–4.8 and out over 8.2–9.
      const fade = (t) => t < 3.2 ? 0 : t < 4.8 ? ease((t - 3.2) / 1.6) : t < 8.2 ? 1 : Math.max(0, 1 - ease((t - 8.2) / 0.8));
      r.beforeFrame = (i) => r.page.evaluate(([el, a]) => window.__trailerLogo(el, a), [(i * 1000) / FPS, fade(i / FPS)]);
      await r.pan(SHOT1.from[0], SHOT1.from[1], SHOT1.to[0], SHOT1.to[1], 9);
    },
  },

  /**
   * Opening maps: File ▸ Open… shows the Open dialog, a map file is dragged onto its drop
   * zone, two more are dragged onto the window and open in their own tabs, then back to the first.
   */
  2: {
    query: "zoom=0.5",
    async run(r) {
      await r.moveTo(700, 420, 0);
      await r.hold(0.3);
      await r.click(...await r.at(".menubar button", "File"), 0.6);
      await r.hold(0.2);
      await r.toMenuItem(/^Open…/);
      await r.press();
      // The dialog's code loads on first use; that wait stays off camera.
      r.off(); await r.page.locator(".dlg .dropzone").waitFor(); await r.wait(300); await r.on();
      await r.hold(0.6);
      await r.dragFile("(8)Big Game Hunters.scm", [1596, 640], await r.at(".dlg .dropzone"), 1.0, ".dlg .dropzone");
      await r.hold(0.8);
      await r.dragFile("(4)Crescent Moon.scx", [1596, 700], [960, 560], 0.8);
      await r.hold(0.5);
      await r.dragFile("(2)Ice Floes.scx", [1596, 760], [1000, 600], 0.8);
      await r.hold(0.5);
      await r.click(...await r.mapTabAt("Big Game Hunters"), 0.6);
      await r.hold(0.8);
    },
  },

  /**
   * Bases: the Melee Wizard on a four-player map. The ground (four high-ground mains and a
   * lake, painted with rotational symmetry) is laid off camera; then the wizard places the
   * four start locations with one click and every base's minerals and geyser with another.
   */
  "5a": {
    query: "zoom=0.35&mode=isom&dialog=newMap",
    plugins: ["github:scm-js/plugin-melee-wizard@v1.1.0"],
    async run(r) {
      r.off();
      // A 64×64 map, so the whole of it and its minerals fit on screen together.
      await r.newMap("Jungle World", 64, 64);
      await r.symmetry("Rotational 90°");
      await r.terrain("High Jungle");
      await r.brush(7);
      await r.stroke([[370, 160], [500, 160], [500, 270], [390, 290], [370, 200], [440, 220]], 0.6);
      await r.terrain("Water");
      await r.brush(5);
      await r.stroke([[610, 410], [690, 450], [650, 490]], 0.4);
      // Off again, or the editor would mirror what the wizard places on top of its own images.
      await r.symmetry("None");
      await r.moveTo(760, 560, 0);
      await r.on();
      await r.hold(0.4);
      await r.click(...await r.at(".menubar button", "Tools"), 0.5);
      await r.hold(0.45);
      await r.toMenuItem(/^Melee Wizard/);
      await r.press();
      r.off(); await r.page.getByText("Bases at every start location", { exact: true }).first().waitFor(); await r.wait(400); await r.on();
      await r.hold(0.4);
      const layout = r.page.locator("select", { has: r.page.locator("option", { hasText: /Rotate 90/ }) }).first();
      await r.click(...await r.boxOf(layout), 0.5);
      await layout.selectOption({ label: await layout.locator("option", { hasText: /Rotate 90/ }).first().innerText() });
      await r.hold(0.4);
      await r.click(...await r.at("button", "Start locations"), 0.5);
      await r.moveTo(435, 220, 0.6);
      await r.hold(0.3);
      await r.click(435, 220, 0);
      await r.key("Escape", 0.4);
      await r.click(...await r.at("button", "Bases at every start location"), 0.6);
      await r.moveTo(1100, 700, 0.5);
      await r.hold(1.4);
    },
  },

  /** 5b: Tools ▸ Replace Terrain turning every tile of Dirt on Crescent Moon into Water, one undo step. */
  "5b": {
    query: "zoom=0.25",
    async run(r) {
      r.off(); await r.drop("(4)Crescent Moon.scx"); await r.moveTo(900, 520, 0); await r.on();
      await r.hold(0.3);
      await r.click(...await r.at(".menubar button", "Tools"), 0.5);
      await r.hold(0.45);
      await r.toMenuItem(/^Replace Terrain/);
      await r.press();
      r.off(); await r.page.locator(".dlg button", { hasText: /^Replace$/ }).waitFor(); await r.wait(400); await r.on();
      await r.hold(0.4);
      const selects = r.page.locator(".dlg select");
      const withTerrain = selects.nth(3);
      await r.click(...await r.boxOf(withTerrain), 0.5);
      await withTerrain.selectOption({ label: "Water" });
      await r.hold(0.5);
      await r.click(...await r.at(".dlg button", /^Replace$/), 0.5);
      r.off(); await r.wait(1500); await r.moveTo(1500, 860, 0); await r.on();
      await r.hold(1.6);
    },
  },

  /** 5c: Tools ▸ Check Map on Crescent Moon: what the game would object to, each with where it is. */
  "5c": {
    query: "zoom=0.25",
    async run(r) {
      r.off(); await r.drop("(4)Crescent Moon.scx"); await r.moveTo(900, 520, 0); await r.on();
      await r.hold(0.3);
      await r.click(...await r.at(".menubar button", "Tools"), 0.5);
      await r.hold(0.45);
      await r.toMenuItem(/^Check Map/);
      await r.press();
      r.off(); await r.page.locator(".dlg", { hasText: /Check Map/ }).waitFor(); await r.wait(800); await r.on();
      await r.hold(0.4);
      await r.moveTo(...await r.at(".dlg li, .dlg [class*=issue]", /./), 0.6).catch(() => {});
      await r.hold(1.8);
    },
  },

  /** 5d: File ▸ Export ▸ Image: the whole map as a picture, with the layers to include. */
  "5d": {
    query: "zoom=0.25",
    async run(r) {
      r.off(); await r.drop("(4)Crescent Moon.scx"); await r.moveTo(900, 520, 0); await r.on();
      await r.hold(0.3);
      await r.click(...await r.at(".menubar button", "File"), 0.5);
      await r.hold(0.45);
      await r.toMenuItem(/^Export/);
      r.off(); await r.wait(600); await r.on();
      await r.hold(0.3);
      const [x, y] = await r.boxOf(r.page.locator(".menu-content").last().locator(".menu-item", { hasText: /Image/ }).first());
      await r.moveTo(x, y, 0.5);
      await r.press();
      r.off(); await r.page.locator(".dlg", { hasText: /Export Image/ }).waitFor(); await r.wait(1500); await r.on();
      await r.hold(0.4);
      for (const label of ["Start locations", "Grid (32 px)"]) {
        await r.click(...await r.at(".dlg label", label), 0.45);
        r.off(); await r.wait(900); await r.on();
        await r.hold(0.4);
      }
      await r.hold(1.2);
    },
  },

  /**
   * Walkability on Big Game Hunters: View ▸ Walkability draws the ground as a unit walks it
   * (areas in colour, the chokes circled with their widths), the view drifts across it, and two
   * Supply Depots go down in a ramp: the first narrows its choke from 6.8 tiles to 3.8, the
   * second closes it.
   */
  6: {
    query: "zoom=0.5",
    async run(r) {
      r.off();
      await r.drop("(8)Big Game Hunters.scm");
      await r.scrollTo(0.1, 0.12);
      await r.moveTo(760, 520, 0);
      await r.on();
      await r.hold(0.6);
      await r.click(...await r.at(".menubar button", "View"), 0.5);
      await r.hold(0.45);
      await r.toMenuItem(/^Walkability/);
      await r.press();
      // The analysis runs once, in a moment; that wait stays off camera.
      r.off();
      await r.page.locator(".statusbar", { hasText: "Walkability:" }).waitFor({ timeout: 60_000 });
      await r.moveTo(900, 600, 0); await r.moveTo(905, 600, 0);
      await r.wait(500);
      await r.on();
      await r.hold(0.8);
      // Off the map, so the brush outline doesn't ride along with the drift.
      r.off(); await r.moveTo(1560, 880, 0); await r.on();
      await r.pointer(false);
      await r.pan(0.1, 0.12, 0.34, 0.3, 4.5);
      await r.hold(0.3);
      // Buildings are walls to a walking unit: a depot in the ramp narrows its choke, a second closes it.
      await r.pointer(true);
      await r.click(...await r.at(".rail-btn >> nth=2"), 0.6);
      r.off(); await r.pickUnit("Terran Supply Depot"); await r.on();
      await r.hold(0.2);
      await r.moveTo(1010, 488, 0.7);
      await r.hold(0.3);
      await r.placeAndWait(1010, 488);
      await r.hold(0.9);
      await r.moveTo(1050, 488, 0.4);
      await r.placeAndWait(1050, 488);
      await r.hold(1.2);
    },
  },

  /**
   * Shot 7 is a TrigScript montage, recorded in one session and split into cuts as it goes:
   * (a) the workspace opened from the Triggers menu and a start-up trigger typed, (b) a loop
   * making a trigger per player, with completion, (c) a wave program, (d) Simulate, (e) a test
   * that passes, (f) Apply and the triggers it made in the Trigger Editor. Between cuts the
   * code jumps ahead off camera, as a montage would.
   */
  "7a": {
    query: "layer=locations&zoom=0.5",
    // A taller panel than the default, so Simulate's run has room.
    init: `localStorage.setItem("scmjs.plugin.trigscript.layout.dialog", JSON.stringify({ panelHeight: 300 }));`,
    async run(r) {
      r.off();
      await r.drop("(8)Big Game Hunters.scm");
      // Three named locations the script uses.
      for (const [name, from, to] of [["Beacon", [620, 560], [760, 660]], ["Spawn", [850, 340], [990, 450]], ["Hill", [990, 610], [1150, 750]]]) {
        await r.page.mouse.move(...from); await r.page.mouse.down(); await r.page.mouse.move(...to, { steps: 8 }); await r.page.mouse.up(); await r.wait(500);
        await r.page.locator(".props input[aria-label='Location name']").fill(name);
        await r.page.keyboard.press("Enter"); await r.wait(400);
      }
      await r.page.click(".rail-btn >> nth=0"); await r.wait(300);
      await r.moveTo(760, 480, 0);
      await r.on();

      // (a) Triggers ▸ TrigScript…, then a start-up trigger.
      await r.hold(0.3);
      await r.click(...await r.at(".menubar button", "Triggers"), 0.5);
      await r.hold(0.45);
      await r.toMenuItem(/^TrigScript…/);
      await r.press();
      r.off();
      await r.page.locator(".tsd .monaco-editor .view-lines").waitFor({ timeout: 120_000 });
      await r.wait(2500);
      await r.setCode("");
      await r.moveTo(1500, 860, 0);
      await r.on();
      await r.hold(0.3);
      await r.typeCode(TS.start, FAST);
      await r.hold(1.5);

      // (b) One trigger per player, with completion on the unit's name.
      r.cut("7b");
      r.off(); await r.setCode(TS.start + "\n"); await r.wait(1500); await r.on();
      await r.typeCode(TS.loopHead, FAST);
      // The list opens once to settle and again at the cursor (the first opening lands elsewhere).
      r.off();
      await r.monaco((m, ed) => ed.trigger("keyboard", "editor.action.triggerSuggest", {}));
      await r.page.locator(".suggest-widget .monaco-list-row").first().waitFor({ timeout: 15_000 }).catch(() => {});
      await r.wait(800);
      await r.monaco((m, ed) => ed.trigger("keyboard", "hideSuggestWidget", {}));
      await r.wait(300);
      await r.monaco((m, ed) => ed.trigger("keyboard", "editor.action.triggerSuggest", {}));
      await r.page.locator(".suggest-widget .monaco-list-row").first().waitFor({ timeout: 15_000 }).catch(() => {});
      await r.wait(600);
      await r.on();
      await r.hold(0.5);
      await r.monaco((m, ed) => ed.trigger("keyboard", "selectNextSuggestion", {}));
      await r.hold(0.4);
      await r.monaco((m, ed) => ed.trigger("keyboard", "acceptSelectedSuggestion", {}));
      await r.hold(0.2);
      await r.monaco((m, ed) => {
        // Whatever the list put in, the rest of the line continues from the unit's full name.
        const p = ed.getPosition(), line = ed.getModel().getLineContent(p.lineNumber);
        const at = line.lastIndexOf("units.");
        ed.executeEdits("trailer", [{ range: new m.Range(p.lineNumber, at + 1, p.lineNumber, line.length + 1), text: "units.TerranSiegeTankTankMode" }]);
        ed.setPosition({ lineNumber: p.lineNumber, column: at + 1 + "units.TerranSiegeTankTankMode".length });
      });
      await r.typeCode(TS.loopTail, FAST);
      await r.hold(1.5);

      // (c) A program: waves from an array, each after the last.
      r.cut("7c");
      r.off(); await r.setCode(TS.start + "\n" + TS.loop + "\n"); await r.wait(1500); await r.on();
      await r.typeCode(TS.waves, FAST);
      await r.hold(1.8);

      // (d) Simulate: the script played through, each action with its frame and line.
      r.cut("7d");
      r.off(); await r.setCode(TS.all); await r.wait(3000); await r.on();
      await r.hold(0.3);
      await r.page.keyboard.press("Control+F5");
      await r.frame(3);
      r.off(); await r.page.locator(".tsd-view .tsd-list li").nth(1).waitFor({ timeout: 30_000 }); await r.wait(800); await r.on();
      await r.hold(1.6);

      // (e) A test, and it passes.
      r.cut("7e");
      r.off(); await r.setCode(TS.testHead + TS.all + "\n"); await r.wait(2500); await r.on();
      await r.typeCode(TS.test, FAST);
      r.off(); await r.page.locator(".tsd-statusbar", { hasText: /passed/ }).waitFor({ timeout: 30_000 }).catch(() => {}); await r.wait(500); await r.on();
      await r.hold(0.3);
      await r.click(...await r.at('.tsd-activity button[title="Testing"]'), 0.5);
      await r.hold(1.2);

      // (f) Apply, and the triggers it made, in the Trigger Editor.
      r.cut("7f");
      await r.page.keyboard.press("Control+Shift+KeyB");
      r.off(); await r.page.locator(".tsd-statusbar", { hasText: /triggers? at #/ }).waitFor({ timeout: 30_000 }); await r.wait(400); await r.on();
      await r.hold(0.6);
      r.off();
      await r.page.locator(".dlg .dlg-close").last().click();
      await r.page.locator(".dlg").waitFor({ state: "detached", timeout: 30_000 }); await r.wait(600);
      await r.menu("Triggers", /^Trigger Editor/); await r.wait(1200);
      await r.moveTo(760, 480, 0);
      await r.on();
      await r.hold(0.3);
      await r.click(...await r.at(".dlg .trig-list .item:has(.badge) >> nth=1"), 0.6);
      await r.hold(1.4);
    },
  },

  /**
   * The assistant, against the stand-in scmjs.dev server: one request on an empty map, and the
   * turn that answers it. The steps are scripted in the stand-in, but each is one of the
   * assistant's real tools and runs for real in the editor: the players set, a preset laid over
   * the whole map (camps, ramps, roads, Command Centers, locations), a walk checked, the trigger
   * systems built, the game's rules checked, a picture taken. Then (b) the triggers it wrote.
   *
   * The turn is recorded with the page's clock stepped a frame at a time and the stand-in's
   * stream waiting on the same count, so the words, the view's glide and the gold flash over a
   * change all play at their real speed.
   */
  "8a": {
    query: "zoom=0.25&mode=isom&dialog=newMap",
    mock: true,
    async run(r) {
      const page = r.page;
      r.off();
      await r.newMap("Jungle World", 96, 96);
      await page.keyboard.press("Control+Shift+A");
      const panel = page.locator(".plugin-panel");
      const box = panel.locator("textarea");
      await box.waitFor({ timeout: 60_000 }); await r.wait(800);
      // The panel opens over the map; it goes to the right, over the side panels, so the whole map shows.
      const frame = await panel.boundingBox();
      const grab = [frame.x + 160, frame.y + 16];
      await page.mouse.move(...grab); await page.mouse.down();
      await page.mouse.move(grab[0] + (VIEW.width - frame.width - 10 - frame.x), grab[1] + (92 - frame.y), { steps: 8 });
      await page.mouse.up(); await r.wait(400);
      await r.moveTo(700, 520, 0);
      await r.on();

      await r.hold(0.6);
      await r.click(...await r.boxOf(box), 0.6);
      for (const piece of ASK.match(/[^]{1,2}/g)) { await page.keyboard.type(piece); await r.frame(); }
      await r.hold(0.6);
      // The stand-in's stream waits on the frames recorded, as the page's clock now does.
      let now = 0;
      let waiting = [];
      r.mock.state.pause = (ms) => new Promise((done) => waiting.push({ at: now + ms * STREAM_PACE, done }));
      r.beforeFrame = async () => {
        now += 1000 / FPS;
        const due = waiting.filter((w) => w.at <= now);
        waiting = waiting.filter((w) => w.at > now);
        for (const w of due) w.done();
        await page.waitForTimeout(40);
      };
      await r.stepClock(true);
      await page.keyboard.press("Enter");
      // Off the panel's buttons and off the map, where it lights nothing up.
      await r.moveTo(1230, 800, 0.5);
      const answered = panel.locator(".ai-msg", { hasText: /^Done\./ });
      const idle = panel.locator(".ai-state.is-idle");
      for (let i = 0; i < 90 * FPS && !((await answered.count()) && (await idle.count())); i++) await r.frame();
      if (!(await answered.count())) throw new Error("the assistant's turn did not finish");
      await r.hold(3);
      r.beforeFrame = null;
      r.mock.state.pause = null;
      await r.stepClock(false);

      // (b) The triggers it wrote.
      r.cut("8b");
      r.off();
      await panel.locator(".dlg-close").click(); await r.wait(300);
      await r.menu("Triggers", /^Trigger Editor/); await r.wait(1500);
      await r.moveTo(760, 480, 0);
      await r.on();
      await r.hold(0.5);
      await r.click(...await r.at(".dlg .trig-list .item >> nth=3"), 0.6);
      await r.hold(0.6);
      await r.click(...await r.boxOf(page.locator(".dlg").getByText(/^Actions \(\d+\)$/).first()), 0.5);
      await r.hold(2.2);
    },
  },

  /**
   * A shared map, against the stand-in scmjs.dev server: (a) the map shared from the Account
   * menu and its link copied; (b) Kim, in an editor of her own, opens the link and joins;
   * (c) back in the first editor, Kim's pointer comes in and her Siege Tanks appear as she places
   * them, Sam (a seat the stand-in drives) moves about with Player Settings open, and high
   * ground is painted here; (d) Kim writes in the chat and gets an answer.
   */
  "4a": {
    query: "zoom=0.5",
    mock: true,
    async run(r) {
      const page = r.page;
      r.off();
      await r.drop("(8)Big Game Hunters.scm");
      await r.scrollTo(0.14, 0.2);
      await r.moveTo(900, 520, 0);
      await r.on();

      // (a) Share this Map, Start sharing, Copy.
      await r.hold(0.4);
      await r.click(...await r.at(".menubar button", "Account"), 0.5);
      await r.hold(0.45);
      await r.toMenuItem(/^Share this Map/);
      await r.press();
      r.off(); await page.locator(".dlg button", { hasText: /^Start sharing$/ }).waitFor({ timeout: 30_000 }); await r.wait(400); await r.on();
      await r.hold(0.6);
      await r.click(...await r.at(".dlg button", /^Start sharing$/), 0.5);
      r.off(); await page.locator(".dlg .sd-link input").waitFor({ timeout: 30_000 }); await r.wait(500); await r.on();
      // The link is the dev server's; the dialog shows it as the released editor's would read.
      const link = await page.locator(".dlg .sd-link input").inputValue();
      await page.locator(".dlg .sd-link input").evaluate((el, shown) => { el.value = shown; }, `https://scmjs.dev/editor${new URL(link).pathname}`);
      await r.hold(0.5);
      await r.click(...await r.at(".dlg button", /^Copy$/), 0.5);
      await r.hold(0.7);
      r.off(); await r.key("Escape", 0); await r.moveTo(900, 520, 0); await r.on();

      // (b) Kim opens the link in her own editor and joins.
      const room = r.mock.rooms.last;
      const kimPage = await r.newEditor(seedScmjs(null));
      const u = new URL(link);
      // At this editor's zoom, so the two views line up and her pointer lands where she points.
      await kimPage.goto(`${BASE}${u.pathname.replace(/^\//, "")}?nosplash&zoom=0.5&${u.search.slice(1)}`);
      const nameBox = kimPage.locator(".dlg input[placeholder='How the others see you']");
      await nameBox.waitFor({ timeout: 60_000 }); await kimPage.waitForTimeout(1200);
      const kim = r.also(kimPage, "4b");
      await kim.moveTo(700, 420, 0);
      await kim.hold(0.4);
      await kim.click(...await kim.boxOf(nameBox), 0.5);
      for (const ch of "Kim") { await kimPage.keyboard.type(ch); await kim.frame(3); }
      kim.off(); await kimPage.locator(".dlg", { hasText: /editing now/ }).waitFor({ timeout: 15_000 }); await kim.wait(300); await kim.on();
      await kim.hold(0.5);
      await kim.click(...await kim.at(".dlg button", /^Join$/), 0.5);
      kim.off();
      await kimPage.locator(".dlg").waitFor({ state: "detached", timeout: 30_000 }); await kim.wait(2500);
      await kim.scrollTo(0.14, 0.2);
      await kim.wait(800);
      console.log("  views:", await page.evaluate(() => { const s = document.querySelector(".scroller"); return [s.scrollLeft, s.scrollTop, s.clientWidth]; }), await kimPage.evaluate(() => { const s = document.querySelector(".scroller"); return [s.scrollLeft, s.scrollTop, s.clientWidth]; }));
      await kim.on();
      await kim.hold(0.9);

      // (c) Back here: Kim places Siege Tanks, Sam looks around with Player Settings open, and this editor paints.
      r.cut("4c");
      kim.off();
      await kimPage.click(".rail-btn >> nth=2"); await kim.wait(500);
      await kim.pickUnit("Terran Siege Tank (Tank Mode)");
      await kim.moveTo(1300, 760, 0);
      const toMap = await page.evaluate(() => { const s = document.querySelector(".scroller"); const b = s.getBoundingClientRect(); return { left: b.left, top: b.top, sx: s.scrollLeft, sy: s.scrollTop }; });
      const zoom = 0.5;
      const mapAt = (x, y) => ({ px: Math.round((toMap.sx + x - toMap.left) / zoom), py: Math.round((toMap.sy + y - toMap.top) / zoom) });
      const view = r.mock.rooms.presenceOf(room, "Jeany")?.view;
      r.mock.rooms.guest(room, "Sam", { ...mapAt(1200, 250), layer: "units", dialog: "playerSettings",
        view: view ? { x0: view.x0 + 20, y0: view.y0 + 12, x1: view.x1 + 20, y1: view.y1 + 12 } : null });
      await r.wait(800);
      // This editor's pointer waits on the side panel while Kim works, its brush outline off the map.
      await r.moveTo(1500, 860, 0);
      // Sam's pointer wanders on every frame from here, whatever else happens.
      let samT = 0;
      r.beforeFrame = async () => {
        samT += 1 / FPS;
        r.mock.rooms.pin(room, "Sam", mapAt(1150 - 260 * Math.sin(samT * 0.5), 260 + 130 * Math.sin(samT * 0.9)));
        await page.waitForTimeout(60);
      };
      await r.on();
      await r.hold(0.4);
      // Kim's pointer comes in and places four Siege Tanks on the dirt by the lake, one at a time.
      const kimPath = async (to, seconds) => {
        const from = { x: kimPage.__x ?? 1300, y: kimPage.__y ?? 760 };
        const n = Math.round(seconds * PACE * FPS);
        for (let i = 1; i <= n; i++) {
          const t = ease(i / n);
          kimPage.__x = from.x + (to[0] - from.x) * t; kimPage.__y = from.y + (to[1] - from.y) * t;
          await kimPage.mouse.move(kimPage.__x, kimPage.__y);
          await r.frame();
        }
      };
      await kimPath([1000, 700], 1.0);
      for (const [x, y] of [[985, 690], [1050, 720], [1115, 690], [1050, 660]]) {
        await kimPath([x, y], 0.45);
        await kimPage.mouse.click(x, y);
        await page.waitForTimeout(250);
        await r.frame(4);
      }
      await kimPath([1120, 610], 0.5);
      await r.hold(0.4);
      // This editor paints high ground while the others work.
      await r.terrain("High Jungle");
      await r.brush(3);
      await r.stroke([[430, 640], [560, 700], [660, 660]], 1.2, 0.6);
      await r.hold(0.8);

      // (d) The chat: Kim writes, the Chat window opens here and gets an answer.
      r.cut("4d");
      r.mock.rooms.say(room, "Kim", "Tanks are on the dirt by the lake. Sam, the forces are yours.");
      r.off(); await r.wait(700); await r.on();
      await r.hold(1.0);
      await r.click(...await r.at(".hud-btn", /^Chat/), 0.6);
      r.off(); await page.locator(".sd-chat-input input, .sd-chat-input textarea").first().waitFor({ timeout: 15_000 }); await r.wait(300); await r.on();
      await r.hold(0.6);
      const input = page.locator(".sd-chat-input input, .sd-chat-input textarea").first();
      await r.click(...await r.boxOf(input), 0.4);
      for (const ch of "On it. I'll raise the west side.") { await page.keyboard.type(ch); await r.frame(); }
      await page.keyboard.press("Enter");
      r.off(); await r.wait(500); await r.on();
      await r.hold(1.4);
      r.beforeFrame = null;
      await kimPage.context().close();
    },
  },

  /**
   * Plugins: Tools ▸ API Playground, a snippet typed into it (a panel with a unit, a count and a
   * button that places a ring of that unit around the middle of the view), Run, and the panel it
   * made used on the map with the playground closed: three rings, one inside the other.
   */
  9: {
    query: "zoom=1",
    plugins: ["github:scm-js/plugin-api-playground@v0.1.2"],
    async run(r) {
      const page = r.page;
      r.off();
      await r.drop("(8)Big Game Hunters.scm");
      await r.scrollTo(0.5, 0.5);
      await r.moveTo(520, 480, 0);
      await r.on();

      await r.hold(0.4);
      await r.click(...await r.at(".menubar button", "Tools"), 0.5);
      await r.hold(0.45);
      await r.toMenuItem(/^API Playground/);
      await r.press();
      // The code editor loads on first use; off camera, and the panel made taller so more of the snippet shows.
      r.off();
      await page.locator(".apg .monaco-editor .view-lines").waitFor({ timeout: 120_000 }); await r.wait(2500);
      const titled = (title) => page.locator(".plugin-panel", { has: page.locator(".plugin-panel-title", { hasText: title }) });
      const playground = titled("API Playground");
      const box = await playground.boundingBox();
      await page.mouse.move(box.x + box.width - 6, box.y + box.height - 6); await page.mouse.down();
      await page.mouse.move(box.x + box.width - 6, box.y + box.height + 194, { steps: 8 }); await page.mouse.up(); await r.wait(400);
      r.useMonaco(PLAYGROUND_MONACO);
      await r.setCode("", 15);
      await r.wait(800);
      // The pointer waits over the playground's output, not on the map, where it would draw a brush.
      await r.moveTo(1100, 700, 0);
      await r.on();
      await r.hold(0.5);
      await r.typeCode(RING, 220);
      await r.hold(1.6);
      await r.click(...await r.at(".apg-bar button", /^Run$/), 0.6);
      const maker = titled("Ring Maker");
      r.off(); await maker.waitFor({ timeout: 15_000 }); await r.wait(400); await r.on();
      await r.hold(1.2);
      // The playground closed: what the snippet made stays, as a plugin's panel would.
      await r.click(...await r.boxOf(playground.locator(".dlg-close")), 0.6);
      await r.hold(0.6);
      const summon = maker.locator("button", { hasText: "Summon" });
      for (const [i, [unit, count]] of [["65", "10"], ["37", "20"], ["0", "30"]].entries()) {
        if (i) {
          // A headless page shows no list for a select; the choice is made as the pointer clicks it.
          await r.click(...await r.boxOf(maker.locator("select")), 0.5);
          await maker.locator("select").selectOption(unit);
          await r.hold(0.4);
          await r.click(...await r.boxOf(maker.locator("input")), 0.4);
          await page.keyboard.press("Control+A");
          for (const ch of count) { await page.keyboard.type(ch); await r.frame(4); }
          await r.hold(0.2);
        }
        await r.click(...await r.boxOf(summon), 0.5);
        await r.hold(0.8);
      }
      await r.moveTo(1500, 860, 0.6);
      await r.hold(2);
    },
  },

  /**
   * Repair: a protected map dragged in, the Repair dialog that comes up over it with what is
   * wrong, the repair run, and the isometric brush working on the map again. The map is one of
   * the game's own, put through what a map protector does (`protectedMap`).
   */
  10: {
    query: "zoom=0.5&mode=isom",
    async run(r) {
      const page = r.page;
      r.give(PROTECTED, await protectedMap("(4)Crescent Moon.scx"));
      await r.moveTo(700, 420, 0);
      await r.hold(0.4);
      await r.dragFile(PROTECTED, [1596, 640], [860, 520], 1.0);
      await r.hold(2.2);
      await r.click(...await r.at(".dlg button", /^Repair \d+ selected$/), 0.7);
      // The file is rewritten and read again, and the lattice rebuilt; that wait stays off camera.
      r.off(); await page.locator(".dlg .rp-log").waitFor({ timeout: 60_000 }); await r.wait(1500); await r.on();
      await r.hold(1.8);
      await r.click(...await r.at(".dlg button", /^Close$/), 0.6);
      r.off(); await r.terrain("High Dirt"); await r.brush(3); await r.on();
      await r.hold(0.4);
      await r.stroke([[560, 600], [760, 500], [980, 560]], 1.6, 0.6);
      await r.moveTo(1500, 860, 0.5);
      await r.hold(1.2);
    },
  },

  /**
   * The end card, drawn frame by frame over a black page (nothing of the editor shows, from the
   * first frame): the splash screen's stars and clouds come up, the globe draws itself line by
   * line and settles, the name arrives a letter at a time, then what the editor does, and where
   * to find it.
   */
  11: {
    query: "",
    async run(r) {
      r.off();
      await r.endCard();
      await r.pointer(false);
      await r.on();
      r.beforeFrame = (i) => r.page.evaluate((t) => window.__trailerEnd(t), i / FPS);
      for (let i = 0; i < END_SECONDS * FPS; i++) await r.frame();
      r.beforeFrame = null;
    },
  },

  /*
   * Shot 3 is a montage: six short cuts, each on its own tileset, cut together in the edit.
   * They move faster than the other shots, and whatever set-up a cut needs runs off camera.
   */

  /** 3a: the isometric brush raising a ridge of high ground on Jungle, the cliffs laying themselves around it. */
  "3a": {
    query: "mode=isom&tileset=jungle",
    async run(r) {
      await r.terrain("High Jungle");
      await r.brush(3);
      await r.moveTo(470, 700, 0);
      await r.hold(0.45);
      await r.stroke([[470, 700], [1150, 360]], 1.5, 0);
      await r.hold(0.3);
    },
  },

  /** 3b: the Rect brush laying an asphalt road on Badlands: flat tile pairs, no cliffs or edges. */
  "3b": {
    query: "mode=isom&tileset=badlands",
    async run(r) {
      await r.brush(3);
      await r.moveTo(160, 200, 0);
      await r.click(...await r.tabAt("Rect"), 0.3);
      await r.click(...await r.terrainAt("Asphalt"), 0.3);
      await r.stroke([[500, 640], [1150, 330]], 1.2, 0.3);
      await r.hold(0.3);
    },
  },

  /** 3c: the Tile brush painting one chosen tile, roof plating on Installation. */
  "3c": {
    query: "mode=isom&tileset=install",
    async run(r) {
      await r.moveTo(160, 200, 0);
      await r.click(...await r.tabAt("Tile"), 0.3);
      await r.click(...await r.groupAt("Roof L"), 0.35);
      await r.brush(2);
      await r.stroke([[560, 330], [960, 530], [760, 650]], 1.2, 0.3);
      await r.hold(0.3);
    },
  },

  /**
   * 3d: the Blend brush mending a cliff on Desert. Off camera, three tiles of a plateau's cliff
   * face are knocked out with the Tile brush; on camera, the tile beside the gap is picked and
   * the palette offers the tiles whose edges continue it. Taking the right one each time, with
   * Follow moving the anchor along, puts the cliff back tile by tile.
   */
  "3d": {
    query: "mode=isom&tileset=desert&zoom=1",
    async run(r) {
      const page = r.page;
      r.off();
      await r.terrain("High Dirt");
      await r.brush(4);
      await page.mouse.click(640, 380); await r.wait(800);
      // The face along y 500: the three tiles after x 673 go, a flat tile in their place.
      const row = [673, 705, 737, 769].map((x) => [x, 500]);
      const lost = [];
      for (const [x, y] of row.slice(1)) lost.push(await r.tileIdAt(x, y));
      await r.tab("Tile");
      await page.locator(".palette input.mono").first().fill(String(await r.tileIdAt(833, 500)));
      await page.keyboard.press("Enter");
      await r.brush(1);
      for (const [x, y] of row.slice(1)) { await page.mouse.click(x, y); await r.wait(200); }
      // Blend offers edge tiles only (the filter under Tolerance), so the lists are short enough
      // that the Right side shows without scrolling the palette.
      await r.tab("Blend");
      await page.locator(".palette select").last().selectOption("edge");
      await r.tab("Isometric");
      await r.moveTo(900, 640, 0);
      await r.on();

      await r.hold(0.6);
      await r.click(...await r.tabAt("Blend"), 0.5);
      await r.hold(0.2);
      await r.click(...row[0], 0.5);
      await r.hold(0.6);
      for (const id of lost) {
        const hex = "0x" + id.toString(16).toUpperCase().padStart(4, "0");
        const right = page.locator(".blend-side", { has: page.locator("header", { hasText: "Right" }) });
        let pick = right.locator(`.blend-tile[title^="${hex}"]`).first();
        if (!(await pick.count())) pick = right.locator(".blend-tile").first();
        await pick.scrollIntoViewIfNeeded();
        await r.click(...await r.boxOf(pick), 0.45);
        await r.hold(0.35);
      }
      await r.moveTo(900, 640, 0.5);
      await r.hold(1.0);
    },
  },

  /** 3e: one stroke on Ash World, repeated at each quarter turn by the symmetry tool. */
  "3e": {
    query: "mode=isom&tileset=ashworld&zoom=0.2",
    async run(r) {
      r.off();
      await r.symmetry("Rotational 90°");
      await r.terrain("High Lava");
      await r.brush(7);
      await r.moveTo(560, 250, 0);
      await r.on();
      await r.hold(0.45);
      await r.stroke([[560, 250], [640, 320], [620, 420], [700, 470]], 1.6, 0);
      await r.hold(0.4);
    },
  },

  /** 3f: the elevation overlay switched on over Crescent Moon (Big Game Hunters is nearly all low ground). */
  "3f": {
    query: "zoom=0.3",
    async run(r) {
      r.off();
      await r.drop("(4)Crescent Moon.scx");
      await r.scrollTo(0.5, 0.5);
      await r.moveTo(1200, 720, 0);
      await r.on();
      await r.hold(0.7);
      r.off();
      await r.menu("View", /Elevation Overlay/);
      // The map repaints on the next pointer move, not on the menu click.
      await r.moveTo(1190, 710, 0);
      await r.moveTo(1200, 720, 0);
      await r.wait(500);
      await r.on();
      await r.hold(1.1);
    },
  },
};

/* ── the recorder ──────────────────────────────────────────────────────────────── */

/** A pointer drawn into the page: headless Chromium draws none. It follows the real mouse events. */
const POINTER = `(() => {
  const install = () => {
    const el = document.createElement("div");
    el.id = "trailer-pointer";
    el.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18.5 L12.5 28 L16.5 26.2 L12 17 L20 17 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(el.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none",
      transformOrigin: "2px 2px", transition: "none", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.45))" });
    document.documentElement.append(el);
    // A map file being dragged in: a label that rides beside the pointer.
    const chip = document.createElement("div");
    Object.assign(chip.style, { position: "absolute", left: "20px", top: "24px", display: "none", whiteSpace: "nowrap",
      font: "600 13px/1 system-ui, sans-serif", color: "#f4f5f8", background: "rgba(24, 27, 38, .92)",
      border: "1px solid rgba(230, 185, 92, .8)", borderRadius: "6px", padding: "7px 10px 7px 9px",
      boxShadow: "0 4px 14px rgba(0,0,0,.5)" });
    el.append(chip);
    const doc = '<svg width="11" height="13" viewBox="0 0 11 13" style="vertical-align:-2px;margin-right:7px"><path d="M1 1h6l3 3v8H1z" fill="none" stroke="#e6b95c" stroke-width="1.3"/><path d="M7 1v3h3" fill="none" stroke="#e6b95c" stroke-width="1.3"/></svg>';
    window.__trailerCarry = (label) => { chip.innerHTML = label ? doc : ""; if (label) chip.append(label); chip.style.display = label ? "" : "none"; };
    let x = -50, y = -50, down = false;
    const place = () => { el.style.transform = "translate(" + (x - 2) + "px," + (y - 2) + "px) scale(" + (down ? 0.86 : 1) + ")"; };
    // Pointer events, not mouse events: the editor cancels pointerdown while painting, which stops the mouse ones.
    addEventListener("pointermove", (e) => { x = e.clientX; y = e.clientY; place(); }, true);
    addEventListener("pointerdown", () => { down = true; place(); }, true);
    addEventListener("pointerup", () => { down = false; place(); }, true);
    // Moves the drawn pointer without the page seeing a mouse move (the recorder's menu travel).
    window.__trailerPointerAt = (nx, ny) => { x = nx; y = ny; place(); };
    place();
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install); else install();
})();`;

/** Everything but the map, hidden, and the map given the whole window. */
const BARE = `
  .app > :not(.body), .body > :not(.viewport), .ruler, .ruler-corner, .map-hud, .viewport-notices { display: none !important; }
  .viewport { grid-template-columns: 0 1fr !important; grid-template-rows: 0 1fr !important; }
  .scroller { grid-area: 2 / 2; scrollbar-width: none; }
`;

const centre = (box) => [box.x + box.width / 2, box.y + box.height / 2];
const LOGO_CSS = `
  #trailer-logo { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; display: grid; place-content: center;
    justify-items: center; gap: 18px; background: radial-gradient(closest-side, rgba(6, 4, 14, .78), rgba(6, 4, 14, .35) 65%, rgba(6, 4, 14, .08)); }
  #trailer-logo canvas { width: 440px; height: 440px; }
  #trailer-logo h1 { margin: 0; font-size: 72px; font-weight: 800; letter-spacing: .18em; padding-left: .18em; line-height: 1;
    color: #ff5fa2; text-shadow: 0 2px 18px rgba(0, 0, 0, .7); }
  #trailer-logo h1 span { color: #eef0f6; }
  #trailer-logo p { margin: -4px 0 0; font-size: 20px; font-weight: 600; letter-spacing: .32em; padding-left: .32em;
    text-transform: uppercase; color: #c9b3ff; text-shadow: 0 0 20px rgba(160, 100, 240, .45), 0 2px 10px rgba(0, 0, 0, .8); }
`;

const LOGO_SCRIPT = `
  import { buildSphere, drawSphereGlow, drawSphereWire, projectSphere } from "/src/components/splash/starfield.ts";
  const box = document.createElement("div");
  box.id = "trailer-logo";
  box.innerHTML = '<canvas></canvas><h1>scm<span>JS</span></h1><p>A StarCraft 1 / Brood War Map Editor</p>';
  document.body.append(box);
  const canvas = box.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const sphere = buildSphere(16, 24, 1.15);
  // WireSphere's paint(), with the lines thickened for a logo this size, over a dark disc so the
  // map doesn't show through the wireframe (the splash draws it on black space).
  window.__trailerLogo = (el, alpha) => {
    box.style.opacity = String(alpha);
    const cw = canvas.clientWidth, ch = canvas.clientHeight, dpr = devicePixelRatio;
    if (canvas.width !== cw * dpr) { canvas.width = cw * dpr; canvas.height = ch * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const cx = cw / 2, cy = ch / 2, fov = Math.min(cw, ch) * 1.55;
    const pts = projectSphere(sphere, cx, cy, fov, el * 0.00035, 0.32 + 0.14 * Math.sin(el * 0.00017));
    const radius = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)));
    const disc = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.08);
    disc.addColorStop(0, "rgba(14, 8, 24, 0.96)");
    disc.addColorStop(0.9, "rgba(10, 6, 18, 0.94)");
    disc.addColorStop(1, "rgba(10, 6, 18, 0)");
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(cx, cy, radius * 1.08, 0, Math.PI * 2); ctx.fill();
    drawSphereGlow(ctx, cx, cy, Math.min(cw, ch) * 0.5);
    drawSphereWire(ctx, sphere, pts, 2.2);
  };
`;

/** How long the end card runs. */
const END_SECONDS = 11;

const END_CSS = `
  #trailer-end { position: fixed; inset: 0; z-index: 2147483646; background: #07050d; overflow: hidden; font-family: inherit; }
  #trailer-end canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  #trailer-end .stack { position: absolute; left: 0; right: 0; top: 478px; display: grid; justify-items: center; }
  #trailer-end h1 { margin: 0; font-size: 84px; font-weight: 800; letter-spacing: .18em; padding-left: .18em; line-height: 1; color: #ff5fa2; }
  #trailer-end h1 span { display: inline-block; text-shadow: 0 0 34px rgba(255, 95, 162, .55); }
  #trailer-end h1 span.js { color: #eef0f6; text-shadow: 0 0 34px rgba(200, 180, 255, .5); }
  #trailer-end .sub { margin: 14px 0 0; font-size: 20px; font-weight: 600; text-transform: uppercase; color: #c9b3ff; white-space: nowrap;
    text-shadow: 0 0 20px rgba(160, 100, 240, .45); }
  #trailer-end .rule { margin-top: 26px; height: 2px; background: linear-gradient(90deg, transparent, #ff5fa2 30%, #ffd0e4 50%, #ff5fa2 70%, transparent);
    box-shadow: 0 0 14px rgba(255, 95, 162, .7); }
  #trailer-end .feats { margin: 26px 0 0; padding: 0; list-style: none; display: flex; gap: 12px; }
  #trailer-end .feats li { padding: 9px 16px; font-size: 17px; font-weight: 600; letter-spacing: .04em; color: #e9e6f5; border-radius: 999px;
    border: 1px solid rgba(201, 179, 255, .35); background: rgba(40, 24, 66, .55); }
  #trailer-end .where { margin-top: 34px; font-size: 22px; font-weight: 500; letter-spacing: .04em; color: #cfd2e0; display: flex; gap: 18px; align-items: baseline; }
  #trailer-end .where b { font-size: 30px; font-weight: 700; letter-spacing: .03em; color: transparent; -webkit-background-clip: text; background-clip: text;
    background-image: linear-gradient(100deg, #ff5fa2 42%, #ffffff 50%, #ff5fa2 58%); background-size: 300% 100%; }
`;

/** What the end card says the editor has (the user's list). */
const END_FEATURES = ["Terrain", "Shared Maps", "Triggers", "TrigScript", "Plugins", "AI Enabled"];

const END_SCRIPT = `
  import { buildSphere, drawNebula, drawSphereGlow, drawSphereWire, drawStars, projectSphere } from "/src/components/splash/starfield.ts";
  const FEATURES = ${JSON.stringify(END_FEATURES)};
  const box = document.createElement("div");
  box.id = "trailer-end";
  box.innerHTML = '<canvas></canvas><div class="stack"><h1><span>s</span><span>c</span><span>m</span><span class="js">J</span><span class="js">S</span></h1>'
    + '<p class="sub">A StarCraft 1 / Brood War Map Editor</p><div class="rule"></div>'
    + '<ul class="feats">' + FEATURES.map((f) => "<li>" + f + "</li>").join("") + '</ul>'
    + '<div class="where"><span>In your browser and on your desktop</span><b>scmjs.dev</b></div></div>';
  document.body.append(box);
  const canvas = box.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const letters = [...box.querySelectorAll("h1 span")];
  const sub = box.querySelector(".sub"), rule = box.querySelector(".rule"), where = box.querySelector(".where"), url = box.querySelector(".where b");
  const feats = [...box.querySelectorAll(".feats li")];
  const sphere = buildSphere(16, 24, 1.15);
  // The same stars every recording.
  let seed = 20260929;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const stars = Array.from({ length: 260 }, () => ({ x: rnd(), y: rnd(), r: 0.3 + rnd() * 1.5, phase: rnd() * Math.PI * 2, speed: 0.0008 + rnd() * 0.003, bright: 0.3 + rnd() * 0.7 }));
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const out = (x) => 1 - Math.pow(1 - x, 3);
  const rise = (el, p, lift = 36, blur = 10) => { el.style.opacity = String(p); el.style.transform = "translateY(" + (1 - p) * lift + "px)"; el.style.filter = p < 1 ? "blur(" + (1 - p) * blur + "px)" : "none"; };
  window.__trailerEnd = (t) => {
    const cw = box.clientWidth, ch = box.clientHeight, dpr = devicePixelRatio;
    if (canvas.width !== Math.round(cw * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#07050d";
    ctx.fillRect(0, 0, cw, ch);
    const ms = t * 1000;
    // The sky comes up first; it drifts faster than the splash's so the movement shows in a few seconds.
    ctx.globalAlpha = out(seg(t, 0.1, 2));
    drawNebula(ctx, cw, ch, ms * 14);
    ctx.globalAlpha = out(seg(t, 0.2, 1.8));
    drawStars(ctx, cw, ch, ms * 3, stars);
    ctx.globalAlpha = 1;

    // The globe draws itself an edge at a time, spinning down and growing to its place.
    const build = seg(t, 0.5, 2.6), settle = out(build);
    const cx = cw / 2, cy = 262, size = 380 * (0.55 + 0.45 * settle);
    const fov = size * 1.55;
    const pts = projectSphere(sphere, cx, cy, fov, ms * 0.00035 + (1 - settle) * 5, 0.32 + 0.14 * Math.sin(ms * 0.00017));
    const radius = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)));
    if (build > 0) {
      // The glow comes up to full as the last line lands, and stays.
      const pulse = t >= 2.6 ? 1 : 0;
      ctx.globalAlpha = 0.6 + 0.4 * settle;
      drawSphereGlow(ctx, cx, cy, size * (0.5 + 0.25 * pulse) * 1.25);
      if (pulse > 0) drawSphereGlow(ctx, cx, cy, size * (0.6 + 0.5 * pulse));
      ctx.globalAlpha = 1;
      drawSphereWire(ctx, { ...sphere, edges: sphere.edges.slice(0, Math.ceil(sphere.edges.length * build)) }, pts, 2.2);
      // One ring of light going out from the globe as it completes.
      const p = seg(t, 2.6, 3.7);
      if (p > 0 && p < 1) {
        ctx.strokeStyle = "rgba(255,190,220," + 0.7 * (1 - p) + ")";
        ctx.lineWidth = 3 * (1 - p) + 0.5;
        ctx.beginPath(); ctx.arc(cx, cy, radius * (1 + 1.9 * out(p)), 0, Math.PI * 2); ctx.stroke();
      }
    }

    letters.forEach((el, i) => rise(el, out(seg(t, 2.5 + i * 0.13, 3.2 + i * 0.13)), 44, 14));
    const s = out(seg(t, 3.3, 4.3));
    sub.style.opacity = String(s);
    sub.style.letterSpacing = 0.32 + (1 - s) * 0.7 + "em";
    sub.style.paddingLeft = sub.style.letterSpacing;
    rule.style.width = out(seg(t, 4.0, 4.9)) * 620 + "px";
    feats.forEach((el, i) => {
      const at = 4.6 + i * 0.3, p = out(seg(t, at, at + 0.45)), lit = 1 - seg(t, at + 0.2, at + 1.1);
      rise(el, p, 18, 6);
      el.style.borderColor = "rgba(" + Math.round(201 + 54 * lit) + "," + Math.round(179 - 84 * lit) + "," + Math.round(255 - 93 * lit) + "," + (0.35 + 0.65 * lit) + ")";
      el.style.boxShadow = lit > 0 && p > 0 ? "0 0 " + 22 * lit + "px rgba(255,95,162," + 0.7 * lit + ")" : "none";
    });
    rise(where, out(seg(t, 7.2, 8.0)), 20, 8);
    url.style.backgroundPosition = 100 - seg(t, 8.0, 9.2) * 100 + "% 0";
  };
`;

const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const frames = (seconds) => Math.max(1, Math.round(seconds * FPS));

/**
 * How fast shot 7 types, in characters a second. Watching the typing is not the point: the
 * code goes in quickly and then stays on screen long enough to read.
 */
const FAST = 140;

/** Where shot 1's drift starts and ends, as fractions of how far the view can scroll. */
const SHOT1 = { from: [0.0, 0.3], to: [0.32, 0.55] };

/** The code typed in shot 7, piece by piece. */
const TS = {
  start: `trigger(AllPlayers, [always()], [
  setResources(CurrentPlayer, "set", 500, "ore"),
  displayText("Hold the hill against three waves."),
]);
`,
  loopHead: `for (const p of [P1, P2, P3, P4]) {
  trigger(p, [deaths(p, units.TerranMarine, ">=", 10)], [
    createUnit(p, units.TerranSie`,
  loopTail: `, 1, locations.Beacon),
    setDeaths(p, units.TerranMarine, "subtract", 10),
  ], { preserve: true });
}
`,
  waves: `const waves = [
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
});
`,
  testHead: `import { test, expect } from "trigscript";

`,
  test: `
test("three waves reach the hill", (sim) => {
  sim.seconds(13);
  expect(sim.count(P8, units.AnyUnit)).toBe(16);
});
`,
};
TS.loop = TS.loopHead.replace("units.TerranSie", "units.TerranSiegeTankTankMode") + TS.loopTail;
TS.all = TS.start + "\n" + TS.loop + "\n" + TS.waves;

/** The snippet shot 9 types into the playground. */
const RING = `// A panel that summons a ring of units where you are looking.
const w = api.ui.widgets;
const tile = api.consts.tile;

function ring(unit: number, count: number, player: number) {
  const v = api.view.visible();
  const cx = ((v.x0 + v.x1) / 2) * tile;
  const cy = ((v.y0 + v.y1) / 2) * tile;
  const r = (2 + count / 5) * tile;
  api.document.edit("Ring of units", (tx) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * r);
      const y = Math.round(cy + Math.sin(a) * r);
      tx.placeUnit(unit, player, x, y);
    }
  });
}

api.ui.panel({
  title: "Ring Maker",
  mount(body) {
    const unit = w.select([
      { value: "65", label: "Protoss Zealot" },
      { value: "37", label: "Zerg Zergling" },
      { value: "0", label: "Terran Marine" },
    ]);
    const count = w.number({ value: 10, min: 3, max: 40 });
    const summon = () =>
      ring(+unit.value, +count.value, unit.selectedIndex);
    body.append(
      w.row(unit, count),
      w.button("Summon", { primary: true, onClick: summon }),
    );
  },
});
`;

/** The name shot 10's protected map is dragged in under. */
const PROTECTED = "(4)Crescent Moon (protected).scx";

/**
 * One of the fixture maps as a map protector leaves it, for shot 10: the editor's own records
 * of the terrain gone (no ISOM, TILE zeroed), junk sections the game skips over, and bytes
 * after a header with a negative length, where the game stops reading. The game plays the
 * result as it played the original.
 */
async function protectedMap(file) {
  const load = (path) => import(pathToFileURL(join(root, "src", path)).href);
  const { loadMap, saveMap } = await load("formats/mpq/scm.ts");
  const { parseChk } = await load("formats/chk/reader.ts");
  const latin1 = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));
  const junk = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + seed) & 255);
  const { chk } = await loadMap(new Uint8Array(readFileSync(join(FIXTURES, file))));
  const sections = parseChk(chk).sections.filter((s) => s.name !== "ISOM").map((s) => ({ name: s.name, data: s.name === "TILE" ? new Uint8Array(s.data.length) : s.data }));
  sections.splice(2, 0, { name: "LOCK", data: junk(96, 11) });
  sections.push({ name: "\u00a7\u00a7\u00a7\u00a7", data: junk(40, 5) });
  const parts = [];
  for (const s of sections) {
    const head = new Uint8Array(8);
    head.set(latin1(s.name.padEnd(4, " ").slice(0, 4)));
    new DataView(head.buffer).setInt32(4, s.data.length, true);
    parts.push(head, s.data);
  }
  const stop = new Uint8Array(8);
  stop.set(latin1("STOP"));
  new DataView(stop.buffer).setInt32(4, -1, true);
  parts.push(stop, junk(64, 3));
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  return saveMap(bytes, { compress: "pkware" });
}

/** How much slower than the stand-in server streams by default shot 8's answer comes, so each step can be read. */
const STREAM_PACE = 1.5;

/** What shot 8 asks the assistant for (the stand-in server answers a request that says "madness"). */
const ASK = "Make this a four-player madness map: a camp in each corner, Marines that spawn and charge the middle, kills pay minerals, last base standing wins.";

/** The Monaco the TrigScript plugin loads (its `DIST_TAG`): importing the same address reaches the same editor. */
const MONACO = "https://cdn.jsdelivr.net/gh/scm-js/plugin-trigscript@monaco-0.56.0-2/dist/monaco.js";
/** The API Playground imports the same bundle under its own name, so its editor is a separate instance. */
const PLAYGROUND_MONACO = `${MONACO}?instance=playground`;

const frameDir = (id) => { const d = join(BUILD, "frames", fileName(id)); rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); return d; };

/** The scmjs.dev plugin as the editor pins it, for the shots that use the stand-in server. */
const PINNED_SCMJS = /"(github:scm-js\/plugin-scmjs-dev@v[^"]+)"/.exec(readFileSync(join(root, "src/plugins/defaults.ts"), "utf8"))?.[1] ?? "github:scm-js/plugin-scmjs-dev";

/**
 * The scmjs.dev plugin on, and (with `mockUrl`) signed in against the stand-in server, as the
 * guide pictures do it (`guide-screenshots.mjs`, `seedScmjs`). Without it, a second editor
 * that learns the server from the link it opens.
 */
function seedScmjs(mockUrl) {
  const plugins = `localStorage.setItem("scmjs.plugins", ${JSON.stringify(JSON.stringify([{ spec: PINNED_SCMJS, enabled: true }]))});`;
  if (!mockUrl) return plugins;
  return `${plugins}
  localStorage.setItem("scmjs.plugin.scmjs-dev.settings", ${JSON.stringify(JSON.stringify({
    serverUrl: mockUrl, session: "guide-session", deviceId: "guide-device", statusItem: true,
    ai: true, quality: "standard", showThinking: true, maxRounds: 24, attachView: false, dockAssistant: false,
  }))});`;
}

/** The browser and, for the shots that need it, the stand-in server; set by `main`. */
let browser, mock;

/** A DataTransfer in the page holding a fixture map, for drag and drop events. */
let fileTransfer;

/** Map files a shot made itself (`r.give`), by the name they are dropped under. */
const given = new Map();

function recorder(page, firstId, ids = []) {
  fileTransfer = async (file) => {
    const path = join(FIXTURES, file);
    if (!given.has(file) && !existsSync(path)) throw new Error(`fixture map missing: ${path}`);
    const b64 = Buffer.from(given.get(file) ?? readFileSync(path)).toString("base64");
    return page.evaluateHandle(({ b64, name }) => {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([arr], name)); return dt;
    }, { b64, name: file });
  };
  let n = 0;
  let dir = frameDir(firstId);
  let current = firstId;
  ids.push(firstId);
  let recording = true;
  let stepped = false, owed = 0;
  let monacoUrl = MONACO;
  let mouse = { x: -50, y: -50 };
  const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const r = {
    page,
    /** Stop and start recording: what runs in between is set-up the video doesn't show. */
    off() { recording = false; },
    /** Recording back on, with the mouse returned to where the camera last saw the pointer (set-up clicks move it). */
    async on() { await page.mouse.move(mouse.x, mouse.y); recording = true; },
    /** Called before each frame is taken, with the frame's number (a shot's own animation, drawn in step). */
    beforeFrame: null,
    async frame(count = 1) {
      if (!recording) return;
      if (r.beforeFrame) await r.beforeFrame(n);
      if (stepped) { owed += 1000 / FPS; const ms = Math.floor(owed); owed -= ms; await page.clock.runFor(ms); }
      else await settle();
      const jpg = await page.screenshot({ type: "jpeg", quality: 92 });
      for (let i = 0; i < count; i++) writeFileSync(join(dir, `${String(n++).padStart(5, "0")}.jpg`), jpg);
    },
    /**
     * The page's clock stepped by the recorder, one frame's worth before each picture, so what
     * the page animates on its own (a glide, a flash, a counter of seconds) plays at video speed
     * rather than at the speed the frames happen to be taken. Off again, time runs on its own.
     */
    async stepClock(on) {
      if (on) { await page.clock.install(); await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 100); }
      else await page.clock.resume();
      stepped = on; owed = 0;
    },
    /** A map file the shot made itself, to drop or drag in by `name` like a fixture. */
    give(name, bytes) { given.set(name, bytes); },
    /** The picture held still. */
    hold: (seconds) => r.frame(frames(seconds)),
    /** Set-up that is not recorded. */
    wait: (ms) => page.waitForTimeout(ms),
    async moveTo(x, y, seconds = 0.6) {
      const from = { ...mouse };
      const count = frames(seconds * PACE);
      if (!seconds || !recording) { await page.mouse.move(x, y); mouse = { x, y }; return; }
      for (let i = 1; i <= count; i++) {
        const t = ease(i / count);
        mouse = { x: from.x + (x - from.x) * t, y: from.y + (y - from.y) * t };
        await page.mouse.move(mouse.x, mouse.y);
        await r.frame();
      }
    },
    /** Press, drag along the points at an even speed over `seconds`, release. The pointer glides to the start first. */
    async stroke(points, seconds, glide = 0.5) {
      await r.moveTo(points[0][0], points[0][1], glide);
      await page.mouse.down();
      const legs = points.slice(1).map((p, i) => [points[i], p, Math.hypot(p[0] - points[i][0], p[1] - points[i][1])]);
      const total = legs.reduce((s, l) => s + l[2], 0);
      // Keep strokes 60 px or more inside the map: nearer its edge the view scrolls on its own.
      const count = frames(seconds);
      for (let i = 1; i <= count; i++) {
        let d = total * (i / count);
        const leg = legs.find((l) => (d -= l[2]) <= 0) ?? legs.at(-1);
        const t = Math.min(1, 1 + d / leg[2]);
        mouse = { x: leg[0][0] + (leg[1][0] - leg[0][0]) * t, y: leg[0][1] + (leg[1][1] - leg[0][1]) * t };
        await page.mouse.move(mouse.x, mouse.y);
        await r.frame();
      }
      await page.mouse.up();
    },
    async click(x, y, seconds = 0.6) {
      await r.moveTo(x, y, seconds);
      await r.press();
      await r.frame(4);
    },
    /** Press and release where the pointer is, after resting on it long enough for the highlight to show. */
    async press() {
      await r.hold(HOVER);
      await page.mouse.down(); await r.frame(2); await page.mouse.up();
    },
    async key(key, seconds = 0.3) { await page.keyboard.press(key); await r.hold(seconds); },
    /** The view's scroll as a fraction of how far it can go. */
    async scrollTo(fx, fy) {
      await page.evaluate(([fx, fy]) => {
        const s = document.querySelector(".scroller");
        s.scrollLeft = fx * (s.scrollWidth - s.clientWidth);
        s.scrollTop = fy * (s.scrollHeight - s.clientHeight);
      }, [fx, fy]);
    },
    /** A camera move from one scroll fraction to another, eased. */
    async pan(fx0, fy0, fx1, fy1, seconds) {
      const count = frames(seconds);
      for (let i = 0; i <= count; i++) {
        const t = ease(i / count);
        await r.scrollTo(fx0 + (fx1 - fx0) * t, fy0 + (fy1 - fy0) * t);
        await r.frame();
      }
    },
    /**
     * The splash screen's turning globe and the name, over the map, drawn by the splash's own
     * code (served by the dev server) so it matches the editor. `__trailerLogo(ms, alpha)` draws
     * one frame of it: the globe as it is `ms` into its turn, at `alpha` opacity.
     */
    async logo() {
      await page.addStyleTag({ content: LOGO_CSS });
      await page.addScriptTag({ type: "module", content: LOGO_SCRIPT });
      await page.waitForFunction(() => typeof window.__trailerLogo === "function");
      await page.evaluate(() => window.__trailerLogo(0, 0));
    },
    /** The end card over the whole page; `__trailerEnd(seconds)` draws it as it is that far in. */
    async endCard() {
      await page.addStyleTag({ content: END_CSS });
      await page.addScriptTag({ type: "module", content: END_SCRIPT });
      await page.waitForFunction(() => typeof window.__trailerEnd === "function");
      await page.evaluate(() => window.__trailerEnd(0));
    },
    async bare() { await page.addStyleTag({ content: BARE }); await r.wait(800); },
    async pointer(show) { await page.evaluate((show) => { document.getElementById("trailer-pointer").style.display = show ? "" : "none"; }, show); },
    /**
     * A map file dragged from `from` to `to` and dropped on `target`: the label rides with the
     * pointer, the target shows its drop state once the file is over it, and the map's loading
     * is skipped. Start `from` at the window's edge, as if the file came from the desktop.
     */
    async dragFile(file, from, to, seconds, target = ".app") {
      const dt = await fileTransfer(file);
      await page.evaluate((label) => window.__trailerCarry(label), file);
      await r.moveTo(...from, 0);
      const before = r.beforeFrame;
      // The drop target reacts only once the file is over it, as a real drag would make it.
      const box = await page.locator(target).first().boundingBox();
      const over = () => mouse.x >= box.x && mouse.x <= box.x + box.width && mouse.y >= box.y && mouse.y <= box.y + box.height;
      r.beforeFrame = async (i) => { if (over()) await page.dispatchEvent(target, "dragover", { dataTransfer: dt }); if (before) await before(i); };
      await r.moveTo(...to, seconds);
      await r.hold(0.2);
      r.beforeFrame = before;
      await page.evaluate(() => window.__trailerCarry(null));
      r.off();
      await page.dispatchEvent(target, "drop", { dataTransfer: dt });
      await r.wait(3000);
      await page.mouse.move(to[0] + 1, to[1]); await page.mouse.move(...to);
      await r.on();
    },
    /** Where the first element matching `selector` (and `text`, if given) is on screen. */
    async at(selector, text) {
      const loc = text === undefined ? page.locator(selector) : page.locator(selector, { hasText: text });
      return centre(await loc.first().boundingBox());
    },
    /**
     * Into an open menu to one of its items. Only the drawn pointer travels; the real mouse
     * lands on the item at the end. Hovering on the way would open the submenus it passes
     * (Brush Size, Import…) or, crossing the menu bar, swap to the neighbouring menu.
     */
    async toMenuItem(label, seconds = 0.5) {
      const [x, y] = await r.at(".menu-item", label);
      const from = { ...mouse };
      const count = frames(seconds * PACE);
      for (let i = 1; i <= count; i++) {
        const t = ease(i / count);
        await page.evaluate(([px, py]) => window.__trailerPointerAt(px, py), [from.x + (x - from.x) * t, from.y + (y - from.y) * t]);
        if (i === count) { await page.mouse.move(x, y); mouse = { x, y }; }
        await r.frame();
      }
    },
    /** Where a locator's element is on screen. */
    async boxOf(locator) { return centre(await locator.boundingBox()); },
    /** Tools ▸ Symmetry… set to the mode whose label starts with `label` (set-up; not for the camera). */
    async symmetry(label) {
      await r.menu("Tools", /^Symmetry/);
      await page.locator(".dlg label.check", { hasText: label }).first().click();
      await page.locator(".dlg button", { hasText: /^OK$/ }).first().click();
      await r.wait(400);
    },
    /** Fill in the New Map dialog (opened by the shot's `dialog=newMap`) with a tileset and size, and create it (set-up). */
    async newMap(tileset, w, h) {
      await page.locator(".dlg .tileset-card", { hasText: tileset }).first().click();
      const sizes = page.locator(".dlg select");
      await sizes.nth(0).selectOption(String(w));
      await sizes.nth(1).selectOption(String(h));
      await page.locator(".dlg button", { hasText: /^Create$/ }).first().click();
      await r.wait(1500);
    },
    /** The Units palette set to place `name` (set-up; the Units layer must already be showing). */
    async pickUnit(name) {
      await page.locator(".palette input[type=search], .palette input[placeholder*='Search']").first().fill(name);
      await page.locator(".palette .node", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }).first().click();
      await r.wait(300);
    },
    /**
     * A click that places something, recorded, then (off camera) the wait for Walkability to
     * recount the ground, which it reports in the status bar.
     */
    async placeAndWait(x, y) {
      const status = page.locator(".statusbar");
      const before = await status.innerText();
      await page.mouse.move(x, y); await r.press();
      r.off();
      await page.waitForFunction((b) => document.querySelector(".statusbar").innerText !== b && /Walkability:/.test(document.querySelector(".statusbar").innerText), before, { timeout: 30_000 }).catch(() => {});
      await r.wait(300);
      await page.mouse.move(x + 1, y); await page.mouse.move(x, y);
      await r.on();
    },
    /** Draw and name locations on the Locations layer (set-up; the layer must be showing). Each is [name, from, to]. */
    async locations(list) {
      for (const [name, from, to] of list) {
        await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to, { steps: 8 }); await page.mouse.up(); await r.wait(500);
        await page.locator(".props input[aria-label='Location name']").fill(name);
        await page.keyboard.press("Enter"); await r.wait(400);
      }
    },
    /** Put `code` in the map's TrigScript and apply it, through the TrigScript window (set-up). */
    async applyTrigScript(code) {
      await r.menu("Triggers", /^TrigScript…/);
      await page.locator(".tsd .monaco-editor .view-lines").waitFor({ timeout: 120_000 });
      await r.wait(2500);
      await r.setCode(code);
      await r.wait(2500);
      await page.keyboard.press("Control+Shift+KeyB");
      await page.locator(".tsd-statusbar", { hasText: /triggers? at #/ }).waitFor({ timeout: 30_000 });
      await page.locator(".dlg .dlg-close").last().click();
      await page.locator(".dlg").waitFor({ state: "detached", timeout: 30_000 });
      await r.wait(600);
    },
    /** Where a map's tab is in the tab strip. */
    async mapTabAt(title) { return centre(await page.locator(".tabstrip .tab", { hasText: title }).first().boundingBox()); },
    async drop(file) {
      const dt = await fileTransfer(file);
      await page.dispatchEvent(".app", "drop", { dataTransfer: dt });
      await r.wait(3000);
    },
    async menu(top, item) {
      await page.click(`.menubar button:has-text("${top}")`); await r.wait(200);
      await page.locator(".menu-item", { hasText: item }).first().click(); await r.wait(800);
    },
    async brush(size) { await page.locator(".palette select").first().selectOption({ index: size - 1 }); await r.wait(200); },
    async terrain(name) { await page.locator(".palette .terrain-list .item", { hasText: new RegExp(`^${name}`) }).first().click(); await r.wait(200); },
    /** The id of the map tile under a point, as the status bar reports it (set-up). */
    async tileIdAt(x, y) {
      await page.mouse.move(x, y); await r.wait(150);
      return parseInt(/ID\s+0x([0-9A-F]{4})/.exec(await page.locator(".statusbar").innerText())[1], 16);
    },
    /** A palette tab chosen (set-up). */
    async tab(name) { await page.locator(".palette [role=tab]", { hasText: new RegExp(`^${name}$`) }).first().click(); await r.wait(500); },
    /** Where a palette tab is (Isometric, Rect, Tile, Blend). */
    async tabAt(name) {
      return centre(await page.locator(".palette [role=tab]", { hasText: new RegExp(`^${name}$`) }).first().boundingBox());
    },
    /** Where a tile group's first tile is in the Tile tab (a row is a label beside a canvas of its tiles). */
    async groupAt(label) {
      const box = await page.evaluate((label) => {
        const text = [...document.querySelectorAll(".tile-browser *")].find((e) => e.children.length === 0 && e.textContent.includes(label));
        let row = text;
        while (row && !row.querySelector("canvas")) row = row.parentElement;
        const r = row.querySelector("canvas").getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.height / 2, height: r.height / 2 };
      }, label);
      return centre(box);
    },
    /** Where the Blend tab's i-th match is (the first side's list first). */
    async blendAt(i) { return centre(await page.locator(".palette .blend-tile").nth(i).boundingBox()); },
    /** Where a terrain's row in the palette is, for the pointer to click on camera. */
    async terrainAt(name) {
      const box = await page.locator(".palette .terrain-list .item", { hasText: new RegExp(`^${name}`) }).first().boundingBox();
      return [box.x + 60, box.y + box.height / 2];
    },
    get count() { return n; },
    /** The cut this recorder is on. */
    get id() { return current; },
    /** Every cut this shot recorded, in order. */
    get ids() { return ids; },
    /** The stand-in scmjs.dev server, for a shot marked `mock`. */
    get mock() { return mock; },
    /** A recorder for another window, whose cuts go in this shot's list (a second person's view). */
    also(otherPage, id) { return recorder(otherPage, id, ids); },
    /** Another editor window, its own browser profile: `init` runs before the page's scripts. */
    async newEditor(init) {
      const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE });
      await ctx.addInitScript(POINTER);
      if (init) await ctx.addInitScript(init);
      const other = await ctx.newPage();
      other.on("pageerror", (e) => console.error("[second editor] page error:", e.message));
      return other;
    },
    /** Start the next cut of a montage recorded in one session: its frames go to their own folder. */
    cut(id) {
      console.log(`  cut ${current}: ${n} frames (${(n / FPS).toFixed(1)} s)`);
      dir = frameDir(id); ids.push(id); current = id; n = 0;
    },
    /** Which Monaco `monaco`, `typeCode` and `setCode` reach: TrigScript's unless a shot says otherwise. */
    useMonaco(url) { monacoUrl = url; },
    /** Run `fn(monaco, editor)` in the page against the TrigScript editor (the plugin's own Monaco, imported by the same address). */
    async monaco(fn, args = {}) {
      return page.evaluate(async ({ src, args, url }) => {
        const monaco = await import(url);
        const ed = monaco.editor.getEditors().find((e) => e.getModel()?.uri.path.endsWith("main.ts")) ?? monaco.editor.getEditors()[0];
        Object.assign(globalThis, args);
        return new Function("monaco", "ed", `return (${src})(monaco, ed)`)(monaco, ed);
      }, { src: fn.toString(), args, url: monacoUrl });
    },
    /** Type `text` at the cursor, `cps` characters a second, one frame at a time (no auto-closing brackets). */
    async typeCode(text, cps = 40) {
      let done = 0, owed = 0;
      while (done < text.length) {
        owed += cps / FPS;
        const k = Math.floor(owed);
        if (k > 0) {
          owed -= k;
          const chunk = text.slice(done, done + k);
          done += k;
          await r.monaco((m, ed) => {
            const p = ed.getPosition();
            ed.executeEdits("trailer", [{ range: new m.Range(p.lineNumber, p.column, p.lineNumber, p.column), text: globalThis.__chunk, forceMoveMarkers: true }]);
            ed.revealPositionInCenterIfOutsideViewport(ed.getPosition());
          }, { __chunk: chunk });
        }
        await r.frame();
      }
    },
    /** The TrigScript file set to `text` in one go, cursor at its end (set-up). */
    async setCode(text, fontSize = 17) {
      await r.monaco((m, ed) => {
        ed.getModel().setValue(globalThis.__text);
        const last = ed.getModel().getLineCount();
        ed.setPosition({ lineNumber: last, column: ed.getModel().getLineMaxColumn(last) });
        ed.revealLine(last);
        // Bigger than the editor's default, so the code reads at video size.
        ed.updateOptions({ cursorBlinking: "solid", fontSize: globalThis.__size, lineHeight: Math.round(globalThis.__size * 1.47) });
        ed.focus();
      }, { __text: text, __size: fontSize });
    },
  };
  return r;
}

function encode(id) {
  const name = fileName(id);
  mkdirSync(join(BUILD, "shots"), { recursive: true });
  const res = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(FPS),
    "-i", `frames/${name}/%05d.jpg`, "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", `shots/${name}.mp4`], { cwd: BUILD, stdio: "inherit" });
  if (res.status !== 0) console.error(`ffmpeg failed for ${name}; the frames are in trailer/build/frames/${name}/`);
  else console.log(`wrote trailer/build/shots/${name}.mp4`);
}

async function main() {
  browser = await chromium.launch({ ...(BROWSER ? { executablePath: BROWSER } : {}), args: ["--no-sandbox"] });
  try {
    for (const [id, shot] of Object.entries(SHOTS)) {
      if (!wanted(id)) continue;
      // The clipboard allowed, so a Copy button says it copied rather than asking for the text to be selected.
      const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, permissions: ["clipboard-read", "clipboard-write"] });
      await ctx.addInitScript(POINTER);
      // Plugins a shot needs that are not on by default, turned on for its browser only.
      if (shot.plugins) await ctx.addInitScript(`localStorage.setItem("scmjs.plugins", ${JSON.stringify(JSON.stringify(shot.plugins.map((spec) => ({ spec, enabled: true }))))});`);
      if (shot.init) await ctx.addInitScript(shot.init);
      // The scmjs.dev shots: the stand-in server, and this window signed in to it.
      if (shot.mock) { mock = await startMock({ port: 8765 }); await ctx.addInitScript(seedScmjs(mock.url)); }
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.error(`[shot ${id}] page error:`, e.message));
      await page.goto(`${BASE}?nosplash${shot.query ? "&" + shot.query : ""}`);
      await page.waitForTimeout(shot.plugins || shot.mock ? 8000 : 2500);
      const r = recorder(page, id);
      const started = Date.now();
      try { await shot.run(r); } catch (err) { await page.screenshot({ path: join(BUILD, `failed-${id}.png`) }); throw err; }
      console.log(`shot ${r.id}: ${r.count} frames (${(r.count / FPS).toFixed(1)} s); ${((Date.now() - started) / 1000).toFixed(0)} s to record ${r.ids.join(", ")}`);
      await ctx.close();
      if (mock) { await mock.close(); mock = null; }
      for (const cut of r.ids) encode(cut);
    }
  } finally {
    await browser.close();
  }
}

await main();
