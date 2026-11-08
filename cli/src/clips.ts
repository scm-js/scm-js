/**
 * `scmjs map test --clips [folder]`: a short clip of each scenario that failed — the last seconds of its game up to the
 * frame it ended on, and a little after — drawn by `replay export`'s machinery (export.ts: the play page's replay
 * viewer in a browser on this computer, with the person's own copy of the game) from the replay map test keeps of a
 * failed scenario anyway. A GIF by default, so it shows inline wherever it is attached; a WebM with `--clips-format`.
 *
 * Making a clip needs more than the test did (a browser, and the play page's viewer beside the engine), so when that
 * is missing the command says so once and the run's result stands: the clips are a help in reading a failure, not part
 * of the verdict. A clip that fails for the same want would fail for every scenario, so the first failure ends it.
 */
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { FRAME_MS } from "@scm-js/replay";
import { findBrowser, NO_BROWSER } from "./browser";
import { exportReplay, type ExportOptions, type ExportResult } from "./export";
import { loadReplayInput, readInput, STDIO, type Input } from "./files";
import { slug, type ScenarioResult } from "./maptest";
import { t, translate } from "./i18n";
import { CliError, dot, duration, mark, pc, size } from "./ui";

/** The game before the frame a scenario ended on, and after it, that a clip shows. */
export const CLIP_BEFORE_MS = 8000;
export const CLIP_AFTER_MS = 2000;

export type ClipKind = "gif" | "webm";
export const CLIP_KINDS: readonly ClipKind[] = ["gif", "webm"];

/** Where the clips go when `--clips` names no folder: `<map>.clips/` beside the map. */
export function defaultClips(map: string): string {
  return join(dirname(map), `${basename(map).replace(/\.(scm|scx|chk)$/i, "")}.clips`);
}

/** The frames a clip shows: `CLIP_BEFORE_MS` before the end frame to `CLIP_AFTER_MS` after, within the game. */
export function clipWindow(frame: number, length: number): { from: number; to: number } {
  const end = Math.max(1, length);
  const from = Math.max(0, Math.min(frame, end) - Math.round(CLIP_BEFORE_MS / FRAME_MS));
  const to = Math.min(end, Math.max(frame, 0) + Math.round(CLIP_AFTER_MS / FRAME_MS));
  return { from: Math.min(from, end - 1), to: Math.max(to, Math.min(from, end - 1) + 1) };
}

/** A clip's file name: the tests file's name without `.json`, the scenario's, the kind (`ums.tests.marine-placed.gif`). */
export function clipName(testsFile: string, scenario: string, kind: ClipKind): string {
  return `${basename(testsFile).replace(/\.json$/i, "")}.${slug(scenario)}.${kind}`;
}

export interface Clip {
  /** The scenario's name and its tests file. */
  scenario: string;
  tests: string;
  /** The clip written; null when none was (see `skipped`). */
  file: string | null;
  bytes: number | null;
  /** Game frames shown, and the clip's own seconds. */
  from: number;
  to: number;
  seconds: number | null;
  /** Why there is no clip, in words; null when there is one. */
  skipped: string | null;
  /** made; the scenario played a replay of its own; none was kept of its game; this computer could not make it. */
  cause: "made" | "replay" | "no-replay" | "computer";
}

export interface ClipRun {
  dir: string;
  kind: ClipKind;
  clips: Clip[];
  /** Said once when no clip could be made at all (no browser, the play page could not record…). */
  missing: string | null;
}

export interface ClipOptions {
  dir: string;
  kind: ClipKind;
  starcraft?: string;
  browser?: string;
  /** The play page's address (`--engine` when it is one; SCMJS_PLAY_URL otherwise). */
  play?: string;
  /** Each clip's line as it is made. */
  live?: (line: string) => void;
  /** Stands in for `exportReplay` (the tests). */
  exporter?: (input: Input, rep: Awaited<ReturnType<typeof loadReplayInput>>, o: ExportOptions) => Promise<ExportResult>;
  /** Stands in for finding a browser (the tests); a path or null. */
  browserFound?: string | null;
}

const shown = (path: string) => { const r = relative(process.cwd(), path); return r && !r.startsWith("..") ? r : path; };

/** One clip's line: where it went, its size and length, and the stretch of the game. */
export function clipLine(c: Clip): string {
  const span = t("{from}–{to} of the game", { from: duration(c.from * FRAME_MS), to: duration(c.to * FRAME_MS) });
  if (!c.file) return `  ${pc.dim(`· ${t("no clip of {scenario}: {why}", { scenario: c.scenario, why: c.skipped ?? "" })}`)}`;
  return `  ${mark.ok} ${pc.bold(shown(c.file))}${pc.dim(`${dot}${size(c.bytes ?? 0)}${dot}${duration((c.seconds ?? 0) * 1000)}${dot}${span}`)}`;
}

/**
 * A clip of each failed scenario that kept a replay, into `o.dir`. Never throws for a clip that could not be made: it
 * is listed as skipped, and `missing` says why once when the cause is this computer's (no browser, the play page).
 */
export async function makeClips(results: readonly ScenarioResult[], o: ClipOptions): Promise<ClipRun> {
  const failed = results.filter((r) => !r.ok);
  const run: ClipRun = { dir: o.dir, kind: o.kind, clips: [], missing: null };
  if (!failed.length) return run;
  const browser = o.browserFound !== undefined ? o.browserFound : findBrowser(o.browser ?? process.env.SCMJS_BROWSER);
  if (!browser) run.missing = t("No clips: no browser to draw them with was found. {hint}", { hint: translate(NO_BROWSER) });
  const exporter = o.exporter ?? exportReplay;
  const taken = new Set<string>();
  for (const r of failed) {
    let name = clipName(r.file, r.name, o.kind);
    for (let n = 2; taken.has(name); n++) name = clipName(r.file, `${r.name}-${n}`, o.kind);
    taken.add(name);
    const base = { scenario: r.name, tests: r.file, file: null, bytes: null, seconds: null };
    if (!r.replay || !existsSync(r.replay)) {
      const why = r.playing ? t("it plays {replay}; scmjs replay export draws that game", { replay: basename(r.playing) }) : t("no replay was kept of its game");
      const clip: Clip = { ...base, from: 0, to: r.frame, skipped: why, cause: r.playing ? "replay" : "no-replay" };
      run.clips.push(clip);
      o.live?.(clipLine(clip));
      continue;
    }
    if (run.missing) { run.clips.push({ ...base, from: 0, to: r.frame, skipped: run.missing, cause: "computer" }); continue; }
    try {
      const input = await readInput(r.replay);
      const rep = await loadReplayInput(input);
      const length = Math.max(rep.header.frames, rep.commands.at(-1)?.frame ?? 0);
      const w = clipWindow(r.frame, length);
      const out = resolve(o.dir, name);
      const made = await exporter(input, rep, { out, fromFrame: w.from, toFrame: w.to, starcraft: o.starcraft, browser: o.browser, play: o.play });
      const clip: Clip = { ...base, file: made.file, bytes: made.bytes, from: made.from, to: made.to, seconds: made.seconds, skipped: null, cause: "made" };
      run.clips.push(clip);
      o.live?.(clipLine(clip));
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      // The same want would stop every clip: said once, the rest not tried.
      run.missing = t("No clips: {reason}", { reason: `${e.message}${e.hint ? ` ${e.hint}` : ""}` });
      run.clips.push({ ...base, from: 0, to: r.frame, skipped: run.missing, cause: "computer" });
    }
  }
  return run;
}

/** The line after the clips: the one reason the rest could not be made, or how many were written where. */
export function clipsSummary(run: ClipRun): string[] {
  const made = run.clips.filter((c) => c.file).length;
  const out: string[] = [];
  if (run.missing) out.push(`${mark.warn} ${pc.yellow(run.missing)}`);
  else if (made) out.push(pc.dim(`  ${t("{n, plural, one {# clip of the failed scenario} other {# clips of the failed scenarios}} in {dir}", { n: made, dir: shown(run.dir) })}`));
  return out;
}

/** The folder the clips go to for a map given as `path` (standard input: the working directory). */
export function clipsDir(path: string, name: string, asked: string | true): string {
  return typeof asked === "string" ? resolve(asked) : resolve(defaultClips(path === STDIO ? name : path));
}
