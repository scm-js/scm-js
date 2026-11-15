/**
 * `scmjs replay export` (cli/src/export.ts, browser.ts, camera.ts, gif.ts) without a browser: the options read into a
 * clip, the files the loopback server serves and keeps, the DevTools protocol's framing on its pipe, the camera from a
 * player's clicks and from moments of the game, and the GIF read back pixel for pixel by a decoder written here. The
 * recording itself needs a browser and the game's files, which CI has not; it was run by hand (cli.md).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command, Replay, ReplayPlayer } from "@scm-js/replay";
import { describe, expect, it } from "vitest";
import { browserCandidates, Cdp, findBrowser, NulSplitter } from "../cli/src/browser";
import { actionTrack, aimOf, clickOf, placesFromAims, placesOf, trackOf } from "../cli/src/camera";
import { clipFormat, hostPage, pageCachePath, parseAt, parseFps, parseSize, parseSpeed, pickPlayer, planClip, rowsFor, servedGamePath } from "../cli/src/export";
import type { Input } from "../cli/src/files";
import { GifWriter, lzw } from "../cli/src/gif";
import { CliError } from "../cli/src/ui";

const player = (i: number, name: string, type = 2): ReplayPlayer => ({ index: i, slot: i, id: i, type, race: 1, team: 1, name, color: "#ff0000" });
const replayOf = (frames: number, players: ReplayPlayer[], commands: Command[] = []): Replay => ({ format: "1.21", header: { engine: 1, frames, started: null, title: "", mapWidth: 128, mapHeight: 128, speed: 6, gameType: 4, host: "", mapName: "m" }, players, commands, unknownCommands: 0, chk: new Uint8Array() });
const input = (path: string): Input => ({ path, name: path.split("/").pop()!, bytes: new Uint8Array(), kind: "replay" });
const refused = (f: () => unknown, pattern: RegExp, code = 2) => {
  try { f(); } catch (e) { expect(e).toBeInstanceOf(CliError); expect((e as CliError).message).toMatch(pattern); expect((e as CliError).exitCode).toBe(code); return; }
  throw new Error("not refused");
};

describe("the clip asked for", () => {
  it("reads the file kind, the size, the pictures a second and the speed", () => {
    expect(clipFormat("a/b.WEBM")).toBe("webm");
    expect(clipFormat("b.mp4")).toBe("mp4");
    expect(clipFormat("b.gif")).toBe("gif");
    refused(() => clipFormat("b.avi"), /\.webm, \.mp4 or \.gif/);
    // An odd side is made even, and said so (rounded).
    expect(parseSize("1281x721")).toEqual({ width: 1282, height: 722, rounded: true });
    expect(parseSize("1280x720")).toEqual({ width: 1280, height: 720, rounded: false });
    refused(() => parseSize("10x10"), /--resolution/);
    refused(() => parseSize("big"), /--resolution/);
    refused(() => clipFormat("ex/noext"), /no extension; a clip is \.webm, \.mp4 or \.gif/);
    expect(parseFps("30", "webm")).toBe(30);
    // A GIF's pictures last whole hundredths: 12 a second is a picture every 8, 12.5 a second.
    expect(parseFps("12", "gif")).toBe(12.5);
    expect(parseFps("60", "gif")).toBe(50);
    refused(() => parseFps("0", "webm"), /--fps/);
    expect(parseSpeed("8")).toBe(8);
    refused(() => parseSpeed("100"), /--speed/);
  });

  it("takes --at in tiles and keeps it on the map", () => {
    expect(parseAt("10,20", { width: 64, height: 64 })).toEqual({ x: 336, y: 656 });
    refused(() => parseAt("64,0", { width: 64, height: 64 }), /off the map/);
    refused(() => parseAt("here", { width: 64, height: 64 }), /x,y in tiles/);
  });

  it("finds the player to follow by number, name or the start of one; the first person by default", () => {
    const players = [player(0, "Computer", 1), player(1, "Flash"), player(2, "Jaedong")];
    expect(pickPlayer(players, undefined).name).toBe("Flash");
    expect(pickPlayer(players, "3").name).toBe("Jaedong");
    expect(pickPlayer(players, "jae").name).toBe("Jaedong");
    expect(pickPlayer(players, "FLASH").name).toBe("Flash");
    refused(() => pickPlayer(players, "Bisu"), /nobody in this replay/);
    refused(() => pickPlayer([player(0, "Jae"), player(1, "Jaedong")], "ja"), /more than one/);
  });

  it("shows the game's screen at a whole number of pixels a map pixel", () => {
    expect(rowsFor(720)).toBe(360);
    expect(rowsFor(1080)).toBe(540);
    expect(rowsFor(360)).toBe(360);
    expect(rowsFor(480)).toBe(480);
  });

  it("settles the clip: beside the replay, the defaults by kind, the frames and the pictures", () => {
    const rep = replayOf(24 * 600, [player(0, "Flash"), player(1, "Jaedong")]);
    const map = { width: 128, height: 128 };
    const webm = planClip(input("/maps/game.rep"), rep, { from: "1:00", to: "1:30" }, map);
    expect(webm).toMatchObject({ out: "/maps/game.webm", format: "webm", width: 1280, height: 720, fps: 24, speed: 1, rows: 360, from: 1429, to: 2143 });
    // 714 frames at 42 ms are 29.988 s: 24 a second and the first.
    expect(webm.pictures).toBe(720);
    expect(webm.camera).toMatchObject({ kind: "follow", player: { name: "Flash" } });
    const gif = planClip(input("/maps/game.rep"), rep, { out: "/tmp/x.gif", all: true, speed: "16" }, map);
    expect(gif).toMatchObject({ format: "gif", width: 640, height: 360, fps: 12.5, from: 0, to: 24 * 600, camera: { kind: "all" } });
    expect(planClip(input("/maps/game.rep"), rep, { at: "1,2" }, map).camera).toEqual({ kind: "at", x: 48, y: 80 });
    refused(() => planClip(input("/maps/game.rep"), rep, { at: "1,2", all: true }, map), /give one/);
    // --whole-map and --resolution, the new names; --all and --size, the old, the same.
    expect(planClip(input("/maps/game.rep"), rep, { out: "/tmp/x.gif", wholeMap: true, resolution: "320x200" }, map)).toMatchObject({ width: 320, height: 200, camera: { kind: "all" } });
    refused(() => planClip(input("/maps/game.rep"), rep, { at: "1,2", wholeMap: true }, map), /--whole-map each place the camera: give one/);
    refused(() => planClip(input("/maps/game.rep"), rep, { from: "20:00" }, map), /past the replay's end/);
    refused(() => planClip(input("/maps/game.rep"), rep, { from: "2:00", to: "1:00" }, map), /not after/);
    refused(() => planClip(input("/maps/game.rep"), rep, { to: "1:xx" }, map), /--to takes m:ss/);
  });
});

describe("the loopback server's files", () => {
  it("keeps the engine beside the other commands' copy and the page's assets by host; the page itself is asked each time", () => {
    expect(pageCachePath("/play/engine/abc123/core.js", "/play/", "scmjs.dev", "/c")).toBe(join("/c", "engine", "abc123", "core.js"));
    expect(pageCachePath("/play/assets/index-x.js", "/play/", "scmjs.dev", "/c")).toBe(join("/c", "page", "scmjs.dev", "assets", "index-x.js"));
    expect(pageCachePath("/play/bots/x/index.json", "/play/", "127.0.0.1:8790", "/c")).toBe(join("/c", "page", "127.0.0.1_8790", "bots", "x", "index.json"));
    expect(pageCachePath("/play/", "/play/", "scmjs.dev", "/c")).toBeNull();
    expect(pageCachePath("/play/engine/current.json", "/play/", "scmjs.dev", "/c")).toBeNull();
    expect(pageCachePath("/play/assets/../../x", "/play/", "scmjs.dev", "/c")).toBeNull();
  });

  it("serves the game's classic files by their names, and nothing of Remastered's own or outside the copy", () => {
    expect(servedGamePath("arr/units.dat")).toBe("arr\\units.dat");
    expect(servedGamePath("unit/terran/Marine.grp")).toBe("unit\\terran\\marine.grp");
    expect(servedGamePath("tileset/jungle/ofire.pcx")).toBe("tileset\\jungle\\ofire.pcx");
    for (const p of ["hd2/tileset/jungle.dds.grp", "tileset/jungle.hd.vr4", "unit/hd/main_000.anim", "anim/main.lit", "../secret", "a//b", "x/./y"]) expect(servedGamePath(p)).toBeNull();
  });

  it("frames the viewer and passes the recording back", () => {
    const page = hostPage();
    for (const said of ["scmjs.view.load", "scmjs.view.follow", "scmjs.view.record", "scmjs.view.taken", "e.origin !== location.origin"]) expect(page).toContain(said);
  });
});

describe("the DevTools protocol on a pipe", () => {
  it("splits messages on NUL, across chunks and inside a character", () => {
    const s = new NulSplitter();
    const bytes = Buffer.from('{"a":"é"}\0{"b":1}\0{"c"', "utf8");
    const at = bytes.indexOf(0xa9); // the second byte of é
    expect(s.push(bytes.subarray(0, at))).toEqual([]);
    expect(s.push(bytes.subarray(at))).toEqual(['{"a":"é"}', '{"b":1}']);
    expect(s.push(Buffer.from(":2}\0"))).toEqual(['{"c":2}']);
  });

  it("answers calls by id, passes events on, and fails what waits when the browser goes", async () => {
    const written: string[] = [];
    const cdp = new Cdp({ write: (s: string) => written.push(s) });
    const events: string[] = [];
    cdp.on((m) => events.push(m.method ?? ""));
    const a = cdp.send("Target.createTarget", { url: "about:blank" });
    const b = cdp.send("Runtime.enable", {}, "S1");
    expect(written.map((w) => w.at(-1))).toEqual(["\0", "\0"]);
    expect(JSON.parse(written[0].slice(0, -1))).toEqual({ id: 1, method: "Target.createTarget", params: { url: "about:blank" } });
    expect(JSON.parse(written[1].slice(0, -1))).toMatchObject({ id: 2, sessionId: "S1" });
    cdp.feed(Buffer.from('{"method":"Inspector.targetCrashed","params":{}}\0{"id":2,"error":{"message":"nope"}}\0{"id":1,"result":{"targetId":"T"}}\0'));
    await expect(a).resolves.toEqual({ targetId: "T" });
    await expect(b).rejects.toThrow("Runtime.enable: nope");
    expect(events).toEqual(["Inspector.targetCrashed"]);
    const c = cdp.send("Browser.close");
    cdp.close(new Error("gone"));
    await expect(c).rejects.toThrow("gone");
    await expect(cdp.send("Browser.close")).rejects.toThrow("gone");
  });

  it("looks for a browser on the PATH, in the usual places and in Playwright's cache, newest first", () => {
    const home = mkdtempSync(join(tmpdir(), "scmjs-browser-"));
    for (const b of ["chromium-1100", "chromium-1243", "chromium_headless_shell-1243"]) mkdirSync(join(home, ".cache", "ms-playwright", b, "chrome-linux64"), { recursive: true });
    const found = browserCandidates({ PATH: "/opt/x:/opt/y" }, "linux", home);
    expect(found.slice(0, 2)).toEqual(["/opt/x/google-chrome", "/opt/x/google-chrome-stable"]);
    expect(found).toContain("/usr/bin/chromium");
    const playwright = found.filter((p) => p.includes("ms-playwright"));
    expect(playwright[0]).toContain("chromium-1243");
    expect(playwright.some((p) => p.includes("headless_shell"))).toBe(false);
    expect(browserCandidates({ PATH: "C:\\bin", ProgramFiles: "C:\\Program Files" }, "win32", home)).toContain(join("C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"));
    expect(findBrowser("/named/chrome", () => false)).toBe("/named/chrome");
  });
});

describe("the camera", () => {
  const view = { width: 640, height: 360 }, map = { width: 4096, height: 4096 };
  const click = (frame: number, x: number, y: number, kind: Command["kind"] = "rightClick", p = 0): Command => ({ frame, player: p, kind, type: 0x14, x, y });

  it("takes the places clicks are, buildings in tiles, and not clicks without one", () => {
    expect(clickOf(click(0, 100, 200))).toEqual({ x: 100, y: 200 });
    expect(clickOf(click(0, 10, 20, "build"))).toEqual({ x: 336, y: 656 });
    expect(clickOf(click(0, 0, 0))).toBeNull();
    expect(clickOf({ frame: 0, player: 0, kind: "train", type: 0x1f })).toBeNull();
  });

  it("holds a place against a glance elsewhere, and moves on once the player stays", () => {
    const rate = 24;
    const cmds = [click(0, 1000, 1000), click(30, 1100, 1000), click(40, 3000, 3000), click(80, 1000, 1000), click(100, 3000, 3000), click(110, 3010, 3000)];
    const places = placesOf(cmds, 0, { view, map, rate });
    expect(places[0]).toMatchObject({ frame: 0, x: 1000, y: 1000 });
    // The glance at 40 is not followed (one click, and the camera came only now); at 110 two clicks there, a cut (far).
    const moved = places.filter((p) => p.x > 2000);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ frame: 110, cut: true });
    expect(moved[0].x).toBeCloseTo(3005, 6);
  });

  it("plays a track that holds, pans within reach, cuts further, and stays on the map", () => {
    const t = trackOf([{ frame: 0, x: 1000, y: 1000, cut: true }, { frame: 200, x: 1300, y: 1000, cut: false }, { frame: 400, x: 3500, y: 3500, cut: true }, { frame: 600, x: 0, y: 0, cut: true }], { view, map, frames: 800, rate: 24 });
    expect(t.every).toBe(2);
    expect(t.x[0]).toBeCloseTo(1000, 3);
    // A pan eases: it starts before the place changes and ends after, never at a jump.
    expect(t.x[100]).toBeGreaterThan(1100);
    expect(t.x[100]).toBeLessThan(1200);
    for (let i = 60; i < 140; i++) expect(Math.abs(t.x[i + 1] - t.x[i])).toBeLessThan(60);
    expect(t.cut[200]).toBe(1);
    expect(t.x[200]).toBeCloseTo(3500, 3);
    // Kept on the map: the middle at least half a view from its edges.
    expect(t.x[300]).toBeCloseTo(320, 3);
    expect(t.y[300]).toBeCloseTo(180, 3);
  });

  it("aims at the biggest fight, else the army, else home", () => {
    const u = (x: number, y: number, owner: number, cls: number) => [x, y, owner, cls];
    const army = [u(500, 500, 0, 2), u(520, 500, 0, 2), u(540, 520, 0, 2), u(500, 540, 0, 2)].flat();
    const home = [u(3000, 3000, 0, 3), u(3050, 3000, 0, 1)].flat();
    expect(aimOf([...army, ...home], 0, view)).toMatchObject({ fight: false, x: 515, y: 515 });
    // An enemy's army by a few of the player's: the fight, both sides' units in it.
    const fight = [u(2000, 2000, 0, 2), u(2020, 2000, 0, 2), u(2040, 2000, 0, 2), u(2100, 2000, 1, 2), u(2120, 2000, 1, 2)].flat();
    const aim = aimOf([...army, ...home, ...fight], 0, view)!;
    expect(aim.fight).toBe(true);
    expect(aim.x).toBeCloseTo(2056, 0);
    // One unit by an enemy (an overlord watching) is no fight.
    expect(aimOf([...army, ...u(2000, 2000, 0, 2), ...u(2050, 2000, 1, 3)], 0, view)!.fight).toBe(false);
    expect(aimOf(home, 0, view)).toMatchObject({ x: 3025, y: 3000, fight: false });
    expect(aimOf(u(10, 10, 1, 2), 0, view)).toBeNull();
  });

  it("moves to an aim elsewhere once it has lasted, a fight sooner", () => {
    const rate = 24;
    const aims = [{ frame: 0, x: 1000, y: 1000, fight: false }, { frame: 8, x: 3000, y: 1000, fight: false }, { frame: 16, x: 1000, y: 1000, fight: false },
      { frame: 24, x: 3000, y: 3000, fight: true }, { frame: 32, x: 3000, y: 3000, fight: true }, { frame: 40, x: 3000, y: 3000, fight: true }];
    const places = placesFromAims(aims, { view, rate });
    expect(places.map((p) => [p.frame, p.x, p.y, p.cut])).toEqual([[0, 1000, 1000, true], [40, 3000, 3000, true]]);
    const t = actionTrack([{ frame: 0, units: [1000, 1000, 0, 2] }, { frame: 8, units: [1000, 1000, 0, 2] }], 0, { view, map, frames: 100, rate });
    expect(t!.x[10]).toBeCloseTo(1000, 3);
    expect(actionTrack([{ frame: 0, units: [1000, 1000, 1, 2] }], 0, { view, map, frames: 100, rate })).toBeNull();
  });
});

/** A GIF read back: the size, and each picture's RGBA as shown (transparent pixels keep the picture before's). */
function decodeGif(b: Uint8Array): { width: number; height: number; delays: number[]; pictures: Uint8Array[] } {
  const width = b[6] | (b[7] << 8), height = b[8] | (b[9] << 8);
  let at = 13;
  const pictures: Uint8Array[] = [], delays: number[] = [];
  let screen = new Uint8Array(width * height * 4), transparent = -1, delay = 0;
  while (b[at] !== 0x3b) {
    if (b[at] === 0x21) {
      if (b[at + 1] === 0xf9) { transparent = b[at + 3] & 1 ? b[at + 6] : -1; delay = b[at + 4] | (b[at + 5] << 8); }
      at += 2;
      while (b[at] !== 0) at += b[at] + 1;
      at++;
      continue;
    }
    expect(b[at]).toBe(0x2c);
    const flags = b[at + 9];
    at += 10;
    const table = b.subarray(at, at + 3 * (2 << (flags & 7)));
    at += table.length;
    const minSize = b[at++];
    const data: number[] = [];
    while (b[at] !== 0) { data.push(...b.subarray(at + 1, at + 1 + b[at])); at += b[at] + 1; }
    at++;
    // LZW.
    const clear = 1 << minSize, end = clear + 1;
    let size = minSize + 1, dict: number[][] = [], prev: number[] | null = null, bit = 0;
    const out: number[] = [];
    const reset = () => { dict = Array.from({ length: clear + 2 }, (_, i) => [i]); size = minSize + 1; prev = null; };
    reset();
    for (;;) {
      let code = 0;
      for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
      if (code === clear) { reset(); continue; }
      if (code === end) break;
      const entry: number[] = code < dict.length ? dict[code] : [...prev!, prev![0]];
      out.push(...entry);
      if (prev) dict.push([...prev, entry[0]]);
      prev = entry;
      if (dict.length === 1 << size && size < 12) size++;
    }
    expect(out.length).toBe(width * height);
    const next = screen.slice();
    out.forEach((k, i) => { if (k !== transparent) next.set([table[k * 3], table[k * 3 + 1], table[k * 3 + 2], 255], i * 4); });
    screen = next;
    pictures.push(next);
    delays.push(delay);
  }
  return { width, height, delays, pictures };
}

describe("the GIF made without ffmpeg", () => {
  it("packs codes as GIF's LZW, past the table's 4,096", () => {
    const noise = new Uint8Array(40_000);
    let s = 7;
    for (let i = 0; i < noise.length; i++) { s = (s * 1103515245 + 12345) >>> 0; noise[i] = (s >>> 16) & 0xff; }
    const packed = lzw(noise);
    expect(packed[0]).toBe(8);
    expect(packed.at(-1)).toBe(0);
    // Read back through a whole GIF of it.
    const gif = new GifWriter(200, 200, 8);
    const rgba = new Uint8Array(200 * 200 * 4);
    for (let i = 0; i < 40_000; i++) rgba.set([noise[i] & 0xf8, 0, 0, 255], i * 4);
    gif.add(rgba);
    const d = decodeGif(gif.finish());
    for (let i = 0; i < 40_000; i += 997) expect(d.pictures[0][i * 4]).toBe(noise[i] & 0xf8);
  });

  it("keeps a picture of few colours exact, and leaves what did not change transparent", () => {
    const w = 64, h = 32;
    const picture = (shift: number) => {
      const p = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const c = ((x + shift) >> 3) % 4;
        p.set([[200, 40, 40], [40, 200, 40], [40, 40, 200], [16, 16, 16]][c], (y * w + x) * 4);
        p[(y * w + x) * 4 + 3] = 255;
      }
      return p;
    };
    const gif = new GifWriter(w, h, 8);
    const a = picture(0), b = picture(0);
    b.set([240, 240, 0, 255], 0); // one pixel changes
    gif.add(a); gif.add(b); gif.add(picture(8));
    const bytes = gif.finish();
    expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe("GIF89a");
    const d = decodeGif(bytes);
    expect(d).toMatchObject({ width: w, height: h, delays: [8, 8, 8] });
    expect(d.pictures[0]).toEqual(a);
    expect(d.pictures[1]).toEqual(b);
    expect(d.pictures[2]).toEqual(picture(8));
    // The second picture is one pixel and transparency: far smaller than the first.
    writeFileSync(join(mkdtempSync(join(tmpdir(), "scmjs-gif-")), "t.gif"), bytes);
  });
});
