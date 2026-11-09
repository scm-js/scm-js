/**
 * `scmjs bot run <bot.scmbot> <map>`: a BWAPI bot plays a melee game against the game's own computers, with no page
 * and no editor. The game is scm-sim's lifted engine, fetched once and kept, and the player's own copy of the game
 * (`engine.ts`); the bot runner is run in a process of its own and speaks JSON lines — start, text, progress, end —
 * which this turns into the terminal's lines.
 *
 * `--mod` lays a mod over the game with its code (overlay version 2, `mod/overlay.ts`): its plugins and FireGraft
 * project run beside the bot, its maps are played with their own settings, and the run says whether the bot was made
 * for the mod (its `.scmbot`'s `mod`, from `scmjs mod header --bot`), plays vanilla data, or was made for another.
 */
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { codeWords, ensureEngine, findGameCopy, fitWords, MOD_CODE, modArgs, modWords, runnerFor, startRunner, type BotFitReport, type RunnerCodeReport, type RunnerModReport } from "./engine";
import type { ModOverlay } from "./mod/overlay";
import { t, translate } from "./i18n";
import { CliError, dot, mark, pc, print, size } from "./ui";

// The engine, the cache and the copy of the game are `engine.ts`'s, shared with `scmjs replay watch`; named here still
// for what imports them from here (doctor.ts, the tests).
export { cacheRoot, ensureEngine, findGameCopy, gameCopyKind, PLAY_URL, usualGameFolders, type Engine, type EngineCurrent } from "./engine";

/* ── The runner's lines ───────────────────────────────────── */

export interface PlayerLine { slot: number; kind: "bot" | "computer"; race: string; minerals: number; gas: number; supplyUsed: number; supplyAvailable: number; outcome: "victory" | "defeat" | "draw" | null }
export interface StartLine {
  kind: "start"; bot: { name: string; commit: string; memoryPages: number; mod?: { name: string; hash: string; link?: string } }; map: { name: string; width: number; height: number; tileset: string }; copy: string; seed: number; players: PlayerLine[]; ms: { load: number; start: number };
  /** With `--mod`: what the game read of it; its code and name (overlay 2); the kind of game; how the bot fits the mod. */
  mod?: RunnerModReport; code?: RunnerCodeReport; game?: "melee" | "ums"; fit?: BotFitReport;
}
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
  /** A mod laid over the game with its code (`--mod`, `modOverlay(…, { code: true })`). */
  mod?: ModOverlay | null;
  /** The kind of game (`--ums`, `--melee`); the runner's rule without. */
  game?: "melee" | "ums";
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
const side = (p: PlayerLine) => `P${p.slot + 1} ${pc.bold(p.kind === "bot" ? t("bot") : t("computer"))} ${RACE_LETTER[p.race] ?? "?"} ${pc.dim(`${p.minerals}/${p.gas}`)} ${p.supplyUsed}/${p.supplyAvailable}`;

/** A runner's line as the terminal's. Null for lines that say nothing to a person. */
export function wordLine(l: RunnerLine): string | null {
  switch (l.kind) {
    case "start": {
      const first = `${t("{bot} on {map}", { bot: pc.bold(l.bot.name), map: pc.cyan(l.map.name) })} ${pc.dim(`${l.map.width} × ${l.map.height}, ${translate(l.map.tileset)}`)}${dot}${l.players.map((p) => `${p.kind === "bot" ? t("bot") : t("computer")} ${p.race}`).join(" vs ")}${dot}${t("seed {seed}", { seed: l.seed })}${dot}${l.copy === "remastered" ? t("Remastered files") : t("1.16.1 files")}`;
      // (with a mod: what the game read of it, its code, and how the bot fits it)
      const mod = [l.mod ? modWords(l.mod) : null, l.code ? codeWords(l.code, l.game) : null, l.fit && (l.code || l.fit.mod) ? fitWords(l.fit, l.code ? { name: l.code.name, hash: l.code.hash } : null) : null];
      return [first, ...mod.filter((x): x is string => !!x)].join("\n");
    }
    case "text": return `  ${pc.dim(l.text)}`;
    case "progress": return `  ${pc.dim(`${t("frame")} ${String(l.frame).padStart(6)}`)}  ${l.players.map(side).join(pc.dim("  |  "))}`;
    case "end": {
      const won = l.outcome === "victory" ? `${mark.ok} ${pc.bold(t("the bot won"))}` : l.outcome === "defeat" ? `${mark.error} ${pc.bold(t("the bot lost"))}` : l.outcome === "draw" ? `${mark.info} ${t("a draw")}` : `${mark.warn} ${t("no outcome after {n, plural, one {# frame} other {# frames}}", { n: l.frame })}`;
      const frames = Math.max(1, l.frame);
      return `${won}${l.ended ? ` ${t("at frame {frame}", { frame: l.frame })}` : ""}${dot}${t("{size} of orders", { size: size(l.commandBytes) })}${l.errors.length ? `${dot}${pc.red(t("{n, plural, one {# error} other {# errors}}", { n: l.errors.length }))}` : ""}${dot}${t("{game} ms a frame game, {bot} bot", { game: (l.ms.game / frames).toFixed(2), bot: (l.ms.bot / frames).toFixed(2) })}${dot}${(l.ms.total / 1000).toFixed(1)} s`;
    }
    case "error": return `${mark.error} ${l.message}`;
  }
}

/**
 * Run the bot over the map. The engine is fetched when it is not cached; the runner's lines go to `live` as they
 * come and into the outcome. A runner that could not start throws a CliError with its own words.
 */
export async function runBotGame(bot: string, map: string, o: BotRunOptions = {}): Promise<BotRunOutcome> {
  if (!existsSync(bot)) throw new CliError(t("No file {path}", { path: bot }), t("scmjs bot build writes out/<key>.scmbot in the bot's folder."), 2);
  if (!existsSync(map)) throw new CliError(t("No file {path}", { path: map }), null, 2);
  const game = findGameCopy(o.starcraft);
  const engine = await ensureEngine(o.engine, undefined, o.live ?? (() => {}));
  const args = [resolve(map), resolve(bot), "--engine", engine.dir, "--starcraft", game.folder];
  if (o.race) args.push("--race", o.race);
  if (o.opponents?.length) args.push("--opponents", o.opponents.join(","));
  if (o.seed !== undefined) args.push("--seed", String(o.seed));
  if (o.frames !== undefined) args.push("--frames", String(o.frames));
  if (o.every !== undefined) args.push("--every", String(o.every));
  if (o.data) args.push("--data", resolve(o.data));
  // (the engine is asked first, so that an older one is said before the mod is written out)
  if (o.mod) { modArgs(engine, "?", MOD_CODE); args.push(...modArgs(engine, await o.mod.layers(), MOD_CODE)); }
  if (o.game) args.push(`--${o.game}`);
  const outcome: BotRunOutcome = { engine: { build: engine.build, dir: engine.dir, fetched: engine.fetched }, game, start: null, texts: [], progress: [], end: null, exitCode: 0 };
  const child = startRunner(runnerFor(engine, "bot"), args, { node: o.node });
  let stderr = "";
  child.stderr!.on("data", (d) => { stderr += d; });
  let error: string | null = null;
  const lines = createInterface({ input: child.stdout! });
  for await (const raw of lines) {
    let l: RunnerLine;
    try { l = JSON.parse(raw) as RunnerLine; } catch { continue; }
    if (l.kind === "start") { if (l.mod && o.mod) l.mod = o.mod.report(l.mod); outcome.start = l; }
    else if (l.kind === "text") outcome.texts.push(l.text);
    else if (l.kind === "progress") outcome.progress.push(l);
    else if (l.kind === "end") outcome.end = l;
    else if (l.kind === "error") error = l.message;
    const worded = wordLine(l);
    if (worded && l.kind !== "error") o.live?.(worded);
  }
  outcome.exitCode = await new Promise<number>((done) => { child.on("error", () => done(2)); child.on("close", (c) => done(c ?? 2)); });
  if (error) throw new CliError(error, t("The runner is scm-sim's; a map StarCraft itself opens, a .scmbot the toolchain built, and your own copy of the game are what it needs."));
  if (!outcome.end) throw new CliError(`${t("The game did not finish: the runner stopped without a result (exit {code}).", { code: outcome.exitCode })}${stderr.trim() ? `\n${stderr.trim().split("\n").slice(-6).join("\n")}` : ""}`);
  return outcome;
}

/** Prints the outcome's lines when they were not printed as they came. */
export function printBotRun(r: BotRunOutcome): void {
  if (r.start) print(wordLine(r.start)!);
  for (const text of r.texts) print(wordLine({ kind: "text", text })!);
  for (const p of r.progress) print(wordLine(p)!);
  if (r.end) print(wordLine(r.end)!);
}
