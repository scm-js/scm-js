/**
 * `scmjs bot run <bot.scmbot> <map>`: a BWAPI bot plays a melee game against the game's own computers, with no page
 * and no editor. The game is scm-sim's lifted engine, the one the play page runs, fetched and found as `engine.ts`
 * says; the bot runner it stages speaks JSON lines — start, text, progress, end — which this turns into the terminal's
 * lines.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensureEngine, findGameCopy, runRunner } from "./engine";
import { CliError, dot, mark, pc, plural, print, size } from "./ui";

// The engine, the cache and the copy of the game are `engine.ts`'s, shared with `scmjs map trace|cost`; re-exported
// here for what imports them from the bot run.
export { cacheRoot, ensureEngine, findGameCopy, gameCopyKind, PLAY_URL, usualGameFolders, type Engine, type EngineCurrent } from "./engine";

/* ── The runner's lines ───────────────────────────────────── */

export interface PlayerLine { slot: number; kind: "bot" | "computer"; race: string; minerals: number; gas: number; supplyUsed: number; supplyAvailable: number; outcome: "victory" | "defeat" | "draw" | null }
export interface StartLine { kind: "start"; bot: { name: string; commit: string; memoryPages: number }; map: { name: string; width: number; height: number; tileset: string }; copy: string; seed: number; players: PlayerLine[]; ms: { load: number; start: number } }
export interface ProgressLine { kind: "progress"; frame: number; units: { visible: number; hidden: number }; players: PlayerLine[]; ms: { game: number; bot: number } }
export interface EndLine extends Omit<ProgressLine, "kind"> { kind: "end"; bot: StartLine["bot"]; seed: number; ended: boolean; outcome: "victory" | "defeat" | "draw" | null; reason: string | null; commandBytes: number; errors: string[]; hash: number; ms: { game: number; bot: number; load: number; start: number; total: number } }
export type RunnerLine = StartLine | { kind: "text"; text: string } | ProgressLine | EndLine | { kind: "error"; message: string };

export interface BotRunOptions {
  race?: string;
  opponents?: string[];
  seed?: number;
  frames?: number;
  every?: number;
  /** A folder the bot keeps its files in between games. */
  data?: string;
  starcraft?: string;
  /** The play page's address, or a folder holding the engine. */
  engine?: string;
  /** Each line as it comes, already worded; absent, nothing is printed as it goes. */
  live?: (line: string) => void;
  /** The `node` to run the runner with. */
  node?: string;
}

export interface BotRunOutcome {
  engine: { build: string; dir: string; fetched: number };
  game: { folder: string; kind: "remastered" | "classic" };
  start: StartLine | null;
  texts: string[];
  progress: ProgressLine[];
  end: EndLine | null;
  /** The runner's exit code: 0 the game ran, 1 the bot printed errors, 2 it could not start. */
  exitCode: number;
}

const RACE_LETTER: Record<string, string> = { zerg: "Z", terran: "T", protoss: "P" };
const side = (p: PlayerLine) => `P${p.slot + 1} ${pc.bold(p.kind === "bot" ? "bot" : "computer")} ${RACE_LETTER[p.race] ?? "?"} ${pc.dim(`${p.minerals}/${p.gas}`)} ${p.supplyUsed}/${p.supplyAvailable}`;

/** A runner's line as the terminal's. Null for lines that say nothing to a person. */
export function wordLine(l: RunnerLine): string | null {
  switch (l.kind) {
    case "start": return `${pc.bold(l.bot.name)} on ${pc.cyan(l.map.name)} ${pc.dim(`${l.map.width} × ${l.map.height}, ${l.map.tileset}`)}${dot}${l.players.map((p) => `${p.kind === "bot" ? "bot" : "computer"} ${p.race}`).join(" vs ")}${dot}seed ${l.seed}${dot}${l.copy === "remastered" ? "Remastered" : "1.16.1"} files`;
    case "text": return `  ${pc.dim(l.text)}`;
    case "progress": return `  ${pc.dim(`frame ${String(l.frame).padStart(6)}`)}  ${l.players.map(side).join(pc.dim("  |  "))}`;
    case "end": {
      const won = l.outcome === "victory" ? `${mark.ok} ${pc.bold("the bot won")}` : l.outcome === "defeat" ? `${mark.error} ${pc.bold("the bot lost")}` : l.outcome === "draw" ? `${mark.info} a draw` : `${mark.warn} no outcome after ${plural(l.frame, "frame")}`;
      const frames = Math.max(1, l.frame);
      return `${won}${l.ended ? ` at frame ${l.frame}` : ""}${dot}${size(l.commandBytes)} of orders${l.errors.length ? `${dot}${pc.red(plural(l.errors.length, "error"))}` : ""}${dot}${(l.ms.game / frames).toFixed(2)} ms a frame game, ${(l.ms.bot / frames).toFixed(2)} bot${dot}${(l.ms.total / 1000).toFixed(1)} s`;
    }
    case "error": return `${mark.error} ${l.message}`;
  }
}

/**
 * Run the bot over the map. The engine is fetched when it is not cached; the runner's lines go to `live` as they
 * come and into the outcome. A runner that could not start throws a CliError with its own words.
 */
export async function runBotGame(bot: string, map: string, o: BotRunOptions = {}): Promise<BotRunOutcome> {
  if (!existsSync(bot)) throw new CliError(`No file ${bot}`, "scmjs bot build writes out/<key>.scmbot in the bot's folder.", 2);
  if (!existsSync(map)) throw new CliError(`No file ${map}`, null, 2);
  const game = findGameCopy(o.starcraft);
  const engine = await ensureEngine(o.engine, undefined, o.live ?? (() => {}));
  const args = [resolve(map), resolve(bot), "--engine", engine.dir, "--starcraft", game.folder];
  if (o.race) args.push("--race", o.race);
  if (o.opponents?.length) args.push("--opponents", o.opponents.join(","));
  if (o.seed !== undefined) args.push("--seed", String(o.seed));
  if (o.frames !== undefined) args.push("--frames", String(o.frames));
  if (o.every !== undefined) args.push("--every", String(o.every));
  if (o.data) args.push("--data", resolve(o.data));
  const outcome: BotRunOutcome = { engine: { build: engine.build, dir: engine.dir, fetched: engine.fetched }, game, start: null, texts: [], progress: [], end: null, exitCode: 0 };
  const failed = { message: null as string | null };
  const { exitCode, stderr } = await runRunner(join(engine.dir, engine.runner), args, (raw) => {
    const l = raw as unknown as RunnerLine;
    if (l.kind === "start") outcome.start = l;
    else if (l.kind === "text") outcome.texts.push(l.text);
    else if (l.kind === "progress") outcome.progress.push(l);
    else if (l.kind === "end") outcome.end = l;
    else if (l.kind === "error") failed.message = l.message;
    const worded = wordLine(l);
    if (worded && l.kind !== "error") o.live?.(worded);
  }, o.node);
  outcome.exitCode = exitCode;
  if (failed.message) throw new CliError(failed.message, "The runner is scm-sim's; a map StarCraft itself opens, a .scmbot the toolchain built, and your own copy of the game are what it needs.");
  if (!outcome.end) throw new CliError(`The game did not finish: the runner stopped without a result (exit ${outcome.exitCode}).${stderr ? `\n${stderr.split("\n").slice(-6).join("\n")}` : ""}`);
  return outcome;
}

/** Prints the outcome's lines when they were not printed as they came. */
export function printBotRun(r: BotRunOutcome): void {
  if (r.start) print(wordLine(r.start)!);
  for (const t of r.texts) print(wordLine({ kind: "text", text: t })!);
  for (const p of r.progress) print(wordLine(p)!);
  if (r.end) print(wordLine(r.end)!);
}
