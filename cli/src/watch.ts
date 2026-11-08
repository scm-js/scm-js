/**
 * `scmjs replay watch x.rep`: a replay played in the terminal. The game is scm-sim's lifted engine (`engine.ts`),
 * whose replay runner plays the file as the game itself would and reports, as often as asked, each player's purse and
 * supply and where every unit is; this draws them as a minimap in braille — a dot a unit in its player's colour,
 * buildings as blocks, resources dim, the ground as shading where the terminal has 24-bit colour — with the clock, a
 * line per player (minerals, gas, supply, units, APM so far) and the chat as it was said, and redraws in place. The
 * replay's players, colours, chat and commands come from `@scm-js/replay`, as `replay info`'s do; the game is paced
 * from here (the runner steps only what the next picture needs), so `--speed` holds whatever the engine's speed.
 *
 * Not a terminal (a pipe, a file): a line per player at intervals instead, or JSON lines with `--json`.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { ChildProcess } from "node:child_process";
import { FRAME_MS, type Command, type Replay } from "@scm-js/replay";
import { ensureEngine, findGameCopy, runnerFor, startRunner } from "./engine";
import type { Input } from "./files";
import { CliError, columns, dot, duration, gameText, mark, num, pc, truecolor, unicode, visible } from "./ui";

/* ── The runner's lines (scm-sim's src/exact/runReplay.ts) ──────────── */

export interface WatchPlayer { slot: number; name: string; race: string; type: number }
export interface WatchStart { kind: "start"; map: { name: string; width: number; height: number; tileset: string }; frames: number; players: WatchPlayer[]; copy: string; terrain: string; ms: { load: number; start: number } }
/**
 * `players`: per player, minerals, gas, supply used, supply available, units alive. `units`: x, y (map pixels), owner,
 * class, four numbers a unit. `left`, once someone has left: per player the frame they left at, or null (a runner from
 * before it was added never sends it).
 */
export interface WatchFrame { kind: "frame"; frame: number; players: [number, number, number, number, number][]; units: number[]; left?: (number | null)[] }
/**
 * The runner's last line. `left`, `outcomes` (per player, what the game decided) and `by` (a side won, or the replay
 * ran out) came later: a runner deployed before them leaves them out.
 */
export interface WatchEnd {
  kind: "end"; frame: number; ended: boolean; reason: string | null; check: { named: number; gone: number; ahead: number; parted: number | null }; ms: { game: number; load: number; start: number; total: number };
  left?: (number | null)[]; outcomes?: ("victory" | "defeat" | "draw" | null)[]; by?: "victory" | "replay" | null;
}
export type WatchLine = WatchStart | WatchFrame | WatchEnd | { kind: "error"; message: string };

/** What a unit is on the picture: the runner's classes. */
export const CLASS = { other: 0, worker: 1, army: 2, building: 3, resource: 4 } as const;

/* ── Colour ─────────────────────────────────────────────────── */

/** The terminal's sixteen colours as xterm paints them, for a terminal without 24-bit colour. */
const ANSI16: [number, number, number][] = [
  [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0], [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
  [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0], [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];

const hexRgb = (hex: string): [number, number, number] => { const n = parseInt(hex.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** The nearest of the sixteen (0–15) to a `#rrggbb`. */
export function nearestAnsi(hex: string): number {
  const [r, g, b] = hexRgb(hex);
  let best = 7, score = Infinity;
  ANSI16.forEach(([cr, cg, cb], i) => { const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2; if (d < score) { score = d; best = i; } });
  return best;
}

/** The SGR for a foreground: 24-bit where the terminal has it, else its nearest of the sixteen. */
export function fg(hex: string, full = truecolor): string {
  if (full) { const [r, g, b] = hexRgb(hex); return `\x1b[38;2;${r};${g};${b}m`; }
  const i = nearestAnsi(hex);
  return `\x1b[${i < 8 ? 30 + i : 90 + i - 8}m`;
}
const bg = (hex: string): string => { const [r, g, b] = hexRgb(hex); return `\x1b[48;2;${r};${g};${b}m`; };

/** The ground's shades, by level (1 low, 2 middle, 3 high); unwalkable ground is left dark. */
const GROUND = ["", "#1c2026", "#293038", "#3a434e"];
const RESOURCE = "#6f7a86";

/* ── The picture ────────────────────────────────────────────── */

export interface Side { slot: number; name: string; race: string; color: string }
export interface PictureSize { cols: number; rows: number; scale: number }

/**
 * The picture's cells for a map in a terminal: the largest braille grid (2 × 4 dots a cell) within `cols` × `rows`
 * that keeps the map's shape, at most two dots a tile. `scale` is dots a tile.
 */
export function fitPicture(mapW: number, mapH: number, cols: number, rows: number): PictureSize {
  const scale = Math.min(2, (Math.max(4, cols) * 2) / mapW, (Math.max(2, rows) * 4) / mapH);
  return { cols: Math.ceil((mapW * scale) / 2), rows: Math.ceil((mapH * scale) / 4), scale };
}

const BRAILLE = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
/** The braille character for the 2 × 4 dots of one cell (`dots[dy][dx]`). */
export function brailleCell(dots: readonly (readonly boolean[])[]): string {
  let bits = 0;
  for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) if (dots[dy]?.[dx]) bits |= BRAILLE[dy][dx];
  return String.fromCharCode(0x2800 + bits);
}

export interface PictureOptions {
  size: PictureSize;
  /** ASCII glyphs instead of braille (the old Windows console). */
  ascii?: boolean;
  /** Colour at all; 24-bit when `full`. */
  color?: boolean;
  full?: boolean;
}

/**
 * The minimap: `units` as the runner reports them, a dot each (a 2 × 2 block for a building where there is room) in
 * its owner's colour; a cell with several owners' dots takes the one with most in it, buildings counting most. Resource
 * fields are dim and lose to any player's unit. The ground is a shade behind the dots, where there is 24-bit colour.
 */
export function drawMinimap(map: { width: number; height: number; terrain: string }, units: readonly number[], sides: readonly Side[], o: PictureOptions): string[] {
  const { cols, rows, scale } = o.size;
  const dw = cols * 2, dh = rows * 4;
  const color = o.color ?? pc.isColorSupported, full = o.full ?? truecolor;
  const colorOf = new Map<number, string>(sides.map((s) => [s.slot, s.color]));
  const dots = new Uint8Array(dw * dh);              // 1 where a dot is lit
  const weight = new Map<number, number>();           // cell * 16 + owner → weight
  const own = (cell: number, owner: number, w: number) => { const k = cell * 16 + owner; weight.set(k, (weight.get(k) ?? 0) + w); };
  const put = (dx: number, dy: number, owner: number, w: number) => {
    if (dx < 0 || dy < 0 || dx >= dw || dy >= dh) return;
    dots[dy * dw + dx] = 1;
    own((dy >> 2) * cols + (dx >> 1), owner, w);
  };
  for (let i = 0; i + 3 < units.length; i += 4) {
    const x = units[i], y = units[i + 1], owner = units[i + 2], cls = units[i + 3];
    const dx = Math.floor((x / 32) * scale), dy = Math.floor((y / 32) * scale);
    if (cls === CLASS.resource) { put(dx, dy, 15, 0.5); continue; }
    if (!colorOf.has(owner)) continue;                 // a critter, a neutral unit: not on the picture
    if (cls === CLASS.building) {
      const w = 3;
      put(dx, dy, owner, w);
      if (scale >= 1) { put(dx + 1, dy, owner, w); put(dx, dy + 1, owner, w); put(dx + 1, dy + 1, owner, w); }
    } else put(dx, dy, owner, cls === CLASS.army ? 2 : 1);
  }
  const ground = (c: number, r: number): string => {
    if (!full || !map.terrain) return "";
    const tx = Math.min(map.width - 1, Math.floor((2 * c + 1) / scale)), ty = Math.min(map.height - 1, Math.floor((4 * r + 2) / scale));
    return GROUND[Number(map.terrain[ty * map.width + tx]) || 0] ?? "";
  };
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "", last = "", used = false;
    for (let c = 0; c < cols; c++) {
      const cell = r * cols + c;
      let owner = -1, best = 0, building = false, lit = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) lit += dots[(r * 4 + dy) * dw + c * 2 + dx];
      if (lit) for (const [k, w] of weight) if ((k >> 4) === cell && w > best) { best = w; owner = k & 15; building = w >= 3; }
      let glyph: string;
      if (o.ascii) glyph = !lit ? " " : owner === 15 ? "." : building ? "#" : "o";
      else glyph = lit ? brailleCell([0, 1, 2, 3].map((dy) => [0, 1].map((dx) => dots[(r * 4 + dy) * dw + c * 2 + dx] === 1))) : " ";
      let code = "";
      if (color) {
        const back = ground(c, r);
        const fore = lit ? (owner === 15 ? fg(RESOURCE, full) : fg(colorOf.get(owner) ?? "#ffffff", full)) : "";
        code = (back ? bg(back) : "\x1b[49m") + (fore || "\x1b[39m");
      }
      if (code !== last) { line += code; last = code; used = used || !!code; }
      line += glyph;
    }
    out.push(used ? line + "\x1b[0m" : line);
  }
  return out;
}

/* ── The lines around it ────────────────────────────────────── */

export interface View {
  start: WatchStart;
  frame: WatchFrame;
  sides: Side[];
  /** APM so far, per side. */
  apm: number[];
  /** The chat said so far, newest last. */
  chat: { frame: number; name: string; color: string; text: string }[];
  speed: number;
  paused: boolean;
  /** Per side, the frame they left the game at, or null while they play on. */
  left?: (number | null)[];
}

const RACE_LETTER: Record<string, string> = { zerg: "Z", terran: "T", protoss: "P" };
/** `m:ss` for a frame of the game. */
export const clock = (frame: number) => duration(frame * FRAME_MS);

/** The whole picture: the title and clock, the minimap, a line per player, the last three lines of chat. One list, the same height every time. */
export function pictureLines(v: View, o: PictureOptions): string[] {
  const { start, frame } = v;
  const width = o.size.cols;
  const title = `${pc.bold(gameText(start.map.name))} ${pc.dim(`${start.map.width} × ${start.map.height}${dot}${start.map.tileset}`)}`;
  const right = `${pc.bold(clock(frame.frame))} ${pc.dim(`frame ${num(frame.frame)}`)}  ${v.paused ? pc.yellow("paused") : pc.dim(`${v.speed}×`)}`;
  const gap = Math.max(1, width - columns(title) - columns(right));
  const out = [title + " ".repeat(gap) + right, ...drawMinimap({ ...start.map, terrain: start.terrain }, frame.units, v.sides, o), ""];
  const color = o.color ?? pc.isColorSupported;
  const swatch = (s: Side) => (color ? `${fg(s.color, o.full ?? truecolor)}■\x1b[39m` : "■");
  // A player who left has no figures (the game keeps zeros for them): "left at m:ss" across the three columns instead.
  const gone = (k: number) => v.left?.[k] ?? null;
  const cells = v.sides.map((s, k) => {
    const p = frame.players[k] ?? [0, 0, 0, 0, 0];
    const at = gone(k);
    const figures = at === null ? [`${num(p[0])}${pc.dim("/")}${num(p[1])}`, `${p[2]}${pc.dim("/")}${p[3]}`, pc.dim(`${num(p[4])} units`)] : [pc.yellow(`left at ${clock(at)}`), "", ""];
    return [`${swatch(s)} ${gameText(s.name)}`, RACE_LETTER[s.race] ?? "?", ...figures, pc.dim(`${num(v.apm[k] ?? 0)} APM`)];
  });
  const playing = cells.filter((_, k) => gone(k) === null);
  const widths = cells[0]?.map((_, i) => Math.max(0, ...(i >= 2 && i <= 4 ? playing : cells).map((r) => columns(r[i])))) ?? [];
  const pad = (c: string, w: number) => c + " ".repeat(Math.max(0, w - columns(c)));
  for (const [k, r] of cells.entries()) {
    if (gone(k) === null) { out.push(r.map((c, i) => pad(c, widths[i])).join("  ").trimEnd()); continue; }
    out.push([pad(r[0], widths[0]), pad(r[1], widths[1]), pad(r[2], widths[2] + widths[3] + widths[4] + 4), pad(r[5], widths[5])].join("  ").trimEnd());
  }
  const said = v.chat.slice(-3);
  for (let i = 0; i < 3; i++) {
    const c = said[i];
    out.push(c ? `${pc.dim(clock(c.frame))} ${color ? `${fg(c.color, o.full ?? truecolor)}${gameText(c.name)}\x1b[39m` : gameText(c.name)}${pc.dim(":")} ${gameText(c.text)}` : "");
  }
  return out;
}

/** One line for a frame where there is no terminal to draw in: the clock, then each player's figures. */
export function summaryLine(v: View): string {
  return `${pc.bold(clock(v.frame.frame).padStart(5))}  ${v.sides.map((s, k) => {
    const p = v.frame.players[k] ?? [0, 0, 0, 0, 0], at = v.left?.[k] ?? null;
    return `${gameText(s.name)} ${RACE_LETTER[s.race] ?? "?"} ${at === null ? `${pc.dim(`${p[0]}/${p[1]}`)} ${p[2]}/${p[3]} ${pc.dim(`${p[4]}u ${v.apm[k]} APM`)}` : `${pc.yellow(`left at ${clock(at)}`)} ${pc.dim(`${v.apm[k]} APM`)}`}`;
  }).join(pc.dim("  |  "))}`;
}

/* ── The replay's own part: colours, chat, APM ───────────────── */

/** The players as the picture names them: the runner's slots joined to the replay's colours and names. */
export function sidesOf(start: WatchStart, replay: Replay): Side[] {
  return start.players.map((p) => {
    const r = replay.players.find((q) => q.slot === p.slot);
    return { slot: p.slot, name: r?.name || p.name, race: p.race, color: r?.color ?? "#ffffff" };
  });
}

/** APM as `replay info` counts it, up to `frame`: what each player did, not chat, leaving or the session's traffic, over the time until they left. */
export class Tally {
  private readonly actions: number[];
  private readonly left: (number | null)[];
  private at = 0;
  readonly chat: View["chat"] = [];
  private readonly ids: number[];
  private readonly replay: Replay;
  private readonly sides: Side[];
  constructor(replay: Replay, sides: Side[]) {
    this.replay = replay;
    this.sides = sides;
    this.ids = sides.map((s) => replay.players.find((p) => p.slot === s.slot)?.id ?? -1);
    this.actions = sides.map(() => 0);
    this.left = sides.map(() => null);
  }
  /** Takes in every command up to and including `frame`; returns the chat said since the last call. */
  advance(frame: number): View["chat"] {
    const said: View["chat"] = [];
    const cmds = this.replay.commands;
    for (; this.at < cmds.length && cmds[this.at].frame <= frame; this.at++) {
      const c: Command = cmds[this.at];
      const k = this.ids.indexOf(c.player);
      if (c.kind === "chat") { if (k >= 0 && c.text) { const line = { frame: c.frame, name: this.sides[k].name, color: this.sides[k].color, text: c.text }; said.push(line); this.chat.push(line); } continue; }
      if (k < 0) continue;
      if (c.kind === "leave") { this.left[k] ??= c.frame; continue; }
      if (c.kind !== "system") this.actions[k]++;
    }
    return said;
  }
  /** The frame each side left at by the replay's own commands, as far as they have been taken in; null for one still playing. */
  leftBy(): (number | null)[] { return [...this.left]; }
  apm(frame: number): number[] {
    return this.sides.map((_, k) => { const end = this.left[k] ?? frame; return end > 0 ? Math.round(this.actions[k] / ((end * FRAME_MS) / 60000)) : 0; });
  }
}

/** `m:ss`, `h:mm:ss` or seconds, as a frame of the game; a CliError for anything else. */
export function parseClock(spec: string, option = "--from"): number {
  const parts = spec.trim().split(":");
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) throw new CliError(`${option} takes m:ss (or h:mm:ss), not "${spec}"`, null, 2);
  const seconds = parts.reduce((n, p) => n * 60 + Number(p), 0);
  return Math.round((seconds * 1000) / FRAME_MS);
}

/* ── Watching ───────────────────────────────────────────────── */

export interface WatchOptions {
  /** 1 is the game's Fastest, 24 frames a second; 8 by default. */
  speed?: number;
  /** Start here (a frame). */
  from?: number;
  /** The picture's cells; the terminal's size by default. */
  size?: { cols: number; rows: number };
  /** Frames between lines when not drawing (a pipe); 1,440 (a minute of game) by default. */
  every?: number;
  json?: boolean;
  starcraft?: string;
  engine?: string;
  node?: string;
  /** Draw and take keys (a terminal); by default whether standard output is one. */
  tty?: boolean;
  /** The terminal's size, when drawing. */
  columns?: number;
  rows?: number;
  /** Where the lines go (standard output by default). */
  out?: (text: string) => void;
  /** Keys, when drawing: `q` stops, space pauses, `+` and `-` change the speed. Standard input by default. */
  keys?: NodeJS.ReadStream | null;
  /** How often the picture is drawn, a second. */
  fps?: number;
}

export interface WatchOutcome {
  engine: { build: string; dir: string; fetched: number };
  start: WatchStart;
  end: WatchEnd | null;
  /** Frames drawn or reported. */
  pictures: number;
  /** The last frame seen. */
  frame: number;
  /** Stopped by a key, not by the replay's end. */
  stopped: boolean;
  /** The players as the picture named them. */
  sides?: Side[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The runner's lines as they come, one at a time, and the process behind them. */
class Runner {
  private readonly queue: WatchLine[] = [];
  private waiting: ((l: WatchLine | null) => void) | null = null;
  private closed = false;
  stderr = "";
  readonly child: ChildProcess;
  constructor(child: ChildProcess) {
    this.child = child;
    child.stderr!.on("data", (d) => { this.stderr += d; });
    createInterface({ input: child.stdout! }).on("line", (raw) => {
      let l: WatchLine;
      try { l = JSON.parse(raw) as WatchLine; } catch { return; }
      if (this.waiting) { const w = this.waiting; this.waiting = null; w(l); } else this.queue.push(l);
    }).on("close", () => { this.closed = true; this.waiting?.(null); this.waiting = null; });
  }
  /** The next line, or null when the runner has gone. */
  next(): Promise<WatchLine | null> {
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    if (this.closed) return Promise.resolve(null);
    return new Promise((r) => { this.waiting = r; });
  }
  /** Asks for `frames` more frames (the paced protocol). */
  step(frames: number): void { this.child.stdin?.write(`${frames}\n`); }
  /** Ends the paced protocol: the runner prints its end and leaves. */
  stop(): void { this.child.stdin?.end(); }
  exit(): Promise<number> { return new Promise((done) => { if (this.child.exitCode !== null) done(this.child.exitCode); this.child.on("error", () => done(2)); this.child.on("close", (c) => done(c ?? 2)); }); }
}

/**
 * Watch the replay: the engine fetched when it is not cached, the copy of the game found, the runner run paced (or
 * free, for a pipe) and the picture drawn as it goes. Resolves when the replay ends or a key stops it.
 */
export async function watchReplay(input: Input, replay: Replay, o: WatchOptions = {}): Promise<WatchOutcome> {
  if (!existsSync(input.path)) throw new CliError(`No file ${input.path}`, null, 2);
  const out = o.out ?? ((text: string) => process.stdout.write(text));
  const tty = o.tty ?? !!process.stdout.isTTY;
  const game = findGameCopy(o.starcraft);
  const engine = await ensureEngine(o.engine, undefined, (l) => out(l + "\n"));
  const runner = runnerFor(engine, "replay");
  const paced = tty && !o.json;
  const args = [resolve(input.path), "--engine", engine.dir, "--starcraft", game.folder];
  if (o.from) args.push("--from", String(o.from));
  if (!paced) args.push("--every", String(o.every ?? 1440));
  let speed = o.speed ?? 8;
  const fps = o.fps ?? 12;
  const starting = pc.dim(`Starting the game${dot}${game.kind === "remastered" ? "Remastered" : "1.16.1"} files${dot}${pc.cyan(input.name)}`);
  if (paced) out(starting + "\n");
  const r = new Runner(startRunner(runner, args, { node: o.node, stdin: paced }));
  const first = await r.next();
  if (!first || first.kind !== "start") {
    await r.exit();
    if (first?.kind === "error") throw new CliError(first.message, "The runner is scm-sim's; a replay the game itself plays and your own copy of the game are what it needs.");
    throw new CliError(`The game did not start: the runner stopped without a word.${r.stderr.trim() ? `\n${r.stderr.trim().split("\n").slice(-6).join("\n")}` : ""}`);
  }
  const start = first;
  const sides = sidesOf(start, replay);
  const tally = new Tally(replay, sides);
  const outcome: WatchOutcome = { engine: { build: engine.build, dir: engine.dir, fetched: engine.fetched }, start, end: null, pictures: 0, frame: 0, stopped: false, sides };
  if (o.json) out(JSON.stringify({ ...start, kind: "start", players: sides.map((s, k) => ({ ...s, type: start.players[k].type })) }) + "\n");

  let said: View["chat"] = [];
  // Who left: the runner says, from the game's own player records; a runner from before that is said is answered by the
  // replay's own leave commands, which the game follows.
  const view = (frame: WatchFrame, paused = false): View => {
    said = tally.advance(frame.frame);
    const byReplay = tally.leftBy();
    return { start, frame, sides, apm: tally.apm(frame.frame), chat: tally.chat, speed, paused, left: sides.map((_, k) => frame.left?.[k] ?? byReplay[k]) };
  };

  if (!paced) {
    for (let l = await r.next(); l; l = await r.next()) {
      if (l.kind === "frame") {
        const v = view(l);
        outcome.pictures++; outcome.frame = l.frame;
        if (o.json) out(JSON.stringify({ kind: "frame", frame: l.frame, clock: clock(l.frame), players: sides.map((s, k) => { const p = l.players[k], at = v.left?.[k] ?? null; return { slot: s.slot, name: s.name, race: s.race, minerals: p[0], gas: p[1], supplyUsed: p[2], supplyAvailable: p[3], units: p[4], apm: v.apm[k], ...(at === null ? {} : { left: at }) }; }), chat: said.map(({ frame, name, text }) => ({ frame, name, text })), units: l.units }) + "\n");
        else { for (const c of said) out(`${pc.dim(clock(c.frame).padStart(5))}  ${gameText(c.name)}${pc.dim(":")} ${gameText(c.text)}\n`); out(summaryLine(v) + "\n"); }
      } else if (l.kind === "end") { outcome.end = l; if (o.json) out(JSON.stringify(l) + "\n"); }
      else if (l.kind === "error") { await r.exit(); throw new CliError(l.message); }
    }
    await r.exit();
    if (!outcome.end) throw new CliError(`The game did not finish: the runner stopped without a result.${r.stderr.trim() ? `\n${r.stderr.trim().split("\n").slice(-6).join("\n")}` : ""}`);
    return outcome;
  }

  // Drawing: the picture's size from the terminal's, a line left for the prompt; the lines around it are fixed in number.
  const cols = o.columns ?? process.stdout.columns ?? 80, rows = o.rows ?? process.stdout.rows ?? 24;
  const around = 1 + 1 + sides.length + 3;
  const size = o.size ? fitPicture(start.map.width, start.map.height, o.size.cols, o.size.rows) : fitPicture(start.map.width, start.map.height, Math.max(16, cols - 1), Math.max(6, rows - around - 1));
  const picture: PictureOptions = { size, ascii: !unicode };
  let drawn = 0;
  const draw = (lines: string[]) => {
    out((drawn ? `\x1b[${drawn}A` : "") + lines.map((l) => `\x1b[2K${l}`).join("\n") + "\n");
    drawn = lines.length;
  };
  const keys = o.keys === undefined ? process.stdin : o.keys;
  let paused = false, quit = false;
  const onKey = (d: Buffer | string) => {
    for (const ch of d.toString()) {
      if (ch === "q" || ch === "\x03" || ch === "\x1b") quit = true;
      else if (ch === " ") paused = !paused;
      else if (ch === "+" || ch === "=") speed = Math.min(64, speed * 2);
      else if (ch === "-" || ch === "_") speed = Math.max(0.25, speed / 2);
    }
  };
  const raw = keys && "setRawMode" in keys && typeof keys.setRawMode === "function" && keys.isTTY;
  if (keys) { if (raw) keys.setRawMode(true); keys.resume(); keys.on("data", onKey); }
  out("\x1b[?25l");
  try {
    // The runner stands at the first frame already; the picture of it first, then a step a picture.
    let l = await r.next();
    while (l && l.kind === "frame") {
      const due = Date.now() + 1000 / fps;
      const v = view(l, paused);
      draw(pictureLines(v, picture));
      outcome.pictures++; outcome.frame = l.frame;
      if (quit) break;
      while (paused && !quit) { await sleep(50); draw(pictureLines(view(l, true), picture)); }
      if (quit) break;
      const wait = due - Date.now();
      if (wait > 0) await sleep(wait);
      r.step(Math.max(1, Math.round((24 * speed) / fps)));
      l = await r.next();
    }
    if (l && l.kind === "error") throw new CliError(l.message);
    if (quit) { outcome.stopped = true; r.stop(); l = await r.next(); while (l && l.kind !== "end") l = await r.next(); }
    if (l && l.kind === "end") outcome.end = l;
    else if (!quit) { r.stop(); for (let e = await r.next(); e; e = await r.next()) if (e.kind === "end") { outcome.end = e; break; } }
  } finally {
    out("\x1b[?25h");
    if (keys) { keys.off("data", onKey); if (raw) keys.setRawMode(false); keys.pause(); }
    r.stop();
    await r.exit();
  }
  return outcome;
}

/** The line after the picture: how far it went, and how the game kept to the replay. */
export function watchSummary(input: Input, r: WatchOutcome): string {
  const where = `${clock(r.frame)} ${pc.dim(`(frame ${num(r.frame)} of ${num(r.start.frames)})`)}`;
  const kept = r.end?.check.parted !== null && r.end?.check.parted !== undefined ? `${dot}${pc.yellow(`the game parted from the replay at ${clock(r.end.check.parted)}`)}` : "";
  return `${r.stopped ? mark.info : mark.ok} ${pc.bold(input.name)}: ${r.stopped ? "stopped at" : r.end?.ended ? "watched to the end," : "watched to"} ${where}${kept}${r.stopped ? "" : endedBy(r)}${r.end ? `${dot}${pc.dim(`${(r.end.ms.total / 1000).toFixed(1)} s`)}` : ""}`;
}

/** How the game ended, where the runner says (one deployed before it did says nothing): who won, or that the replay ran out. */
function endedBy(r: WatchOutcome): string {
  const end = r.end;
  if (!end?.ended) return "";
  const names = (r.sides ?? r.start.players).map((s) => gameText(s.name));
  const won = (end.outcomes ?? []).flatMap((o, k) => (o === "victory" && names[k] ? [names[k]] : []));
  if (won.length) return `${dot}${pc.green(`${won.join(" and ")} won`)}`;
  if (end.by === "replay") return `${dot}ended at the replay's end`;
  return "";
}

/** For `--json` and the tests: a picture as plain text, no colour. */
export const plainPicture = (lines: string[]) => lines.map(visible);
