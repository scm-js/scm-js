/** Reading what the person named: what kind of file it is, and a map or replay out of it, as the editor reads them. */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { Readable } from "node:stream";
import { openMapBytes, type OpenedMap } from "../../src/editor/mapFile";
import { looksLikeMpq } from "../../src/formats/mpq/scm";
import { detectFormat, parseReplay, type Replay } from "@scm-js/replay";
import { t } from "./i18n";
import { CliError } from "./ui";

export type FileKind = "map" | "replay" | "bot";

export interface Input { path: string; name: string; bytes: Uint8Array; kind: FileKind | null }

/** The path that means standard input (as a file to read) or standard output (as a file to write), as `-` does in Unix tools. */
export const STDIO = "-";

/** Whether writing to `out` (or back over `input` when there is no `out`) means standard output. */
export const toStdout = (inputPath: string, out: string | null | undefined): boolean => out === STDIO || (!out && inputPath === STDIO);

/**
 * The file named, or standard input for `-`. What comes down a pipe has no name, so its kind is read from its bytes
 * alone — an archive, a replay, a bot, or a bare scenario (a section name first) — and it is named `stdin.<ext>` so
 * that the writers know what form to write it back in.
 */
export async function readInput(path: string, stdin: Readable = process.stdin): Promise<Input> {
  if (path === STDIO) {
    const chunks: Uint8Array[] = [];
    for await (const c of stdin) chunks.push(typeof c === "string" ? new TextEncoder().encode(c) : c);
    const bytes = new Uint8Array(Buffer.concat(chunks));
    if (!bytes.length) throw new CliError(t("Nothing came on standard input"), t("`-` reads a map or replay from a pipe: cat a.scx | scmjs map info -"), 2);
    const kind = kindOf("", bytes) ?? (looksLikeChk(bytes) ? "map" : null);
    const ext = kind === "replay" ? "rep" : kind === "bot" ? "scmbot" : looksLikeMpq(bytes) ? "scx" : "chk";
    return { path: STDIO, name: `stdin.${ext}`, bytes, kind };
  }
  let bytes: Uint8Array;
  try {
    if ((await stat(path)).isDirectory()) throw new CliError(t("{path} is a folder", { path }), t("Name a map (.scm, .scx, .chk) or a replay (.rep)."), 2);
    bytes = new Uint8Array(await readFile(path));
  } catch (e) {
    if (e instanceof CliError) throw e;
    const code = (e as NodeJS.ErrnoException).code;
    throw new CliError(code === "ENOENT" ? t("No file {path}", { path }) : t("{path} cannot be read ({code})", { path, code: String(code ?? e) }), code === "ENOENT" ? t("Check the name; put quotes round a name with spaces or brackets.") : null, 2);
  }
  return { path, name: basename(path), bytes, kind: kindOf(basename(path), bytes) };
}

/** A bare scenario starts with a section name: four bytes of capitals, digits or spaces (`VER `, `TYPE`, `MTXM`). */
export function looksLikeChk(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (const b of bytes.subarray(0, 4)) if (!((b >= 0x41 && b <= 0x5a) || (b >= 0x30 && b <= 0x39) || b === 0x20)) return false;
  return true;
}

/**
 * Whether a bot is a JavaScript bot's module (`.js`, `.mjs`, `.ts`): a bot written for the play page's own interface
 * (scm-sim's `BOT_API`), which the runners play as BWAPI's client. A `.scmbot` is told by its first bytes instead.
 */
export const isJsBot = (name: string): boolean => /\.(m?js|ts)$/i.test(name);

/** A JavaScript bot's name: its file's, without the extension. */
export const jsBotName = (name: string): string => name.replace(/^.*[\\/]/, "").replace(/\.(m?js|ts)$/i, "");

/**
 * Why this Node cannot run a TypeScript bot as it is, or null: Node strips the types itself from 22.18 (and 23.6); an
 * older one needs the bot compiled to JavaScript first.
 */
export function typeScriptBotProblem(name: string, features: { typescript?: unknown } = process.features as { typescript?: unknown }): string | null {
  return /\.ts$/i.test(name) && !features.typescript ? t("Node {version} cannot run a TypeScript bot as it is (Node 22.18 or newer strips the types itself): use a newer Node, or compile {file} to JavaScript.", { version: process.versions.node, file: `${jsBotName(name)}.ts` }) : null;
}

/** What a file is, from its first bytes, then its extension. */
export function kindOf(name: string, bytes: Uint8Array): FileKind | null {
  if (detectFormat(bytes)) return "replay";
  if (bytes.length >= 8 && String.fromCharCode(...bytes.subarray(0, 8)) === "SCMBOT1\n") return "bot";
  if (looksLikeMpq(bytes) || /\.(scm|scx|chk)$/i.test(name)) return "map";
  return null;
}

/** A file that is not a map this can read; `reason` is why, without the file's name (the message has both). */
export class MapReadError extends CliError {
  readonly reason: string;
  constructor(name: string, reason: string) { super(t("{name} is not a map this can read: {reason}", { name, reason }), null, 2); this.reason = reason; }
}

export async function loadMapInput(input: Input): Promise<OpenedMap> {
  try {
    return await openMapBytes(input.bytes, input.name);
  } catch (e) {
    throw new MapReadError(input.name, e instanceof Error ? e.message : String(e));
  }
}

export async function loadReplayInput(input: Input): Promise<Replay> {
  try {
    return await parseReplay(input.bytes);
  } catch (e) {
    throw new CliError(t("{name} is not a replay this can read: {reason}", { name: input.name, reason: e instanceof Error ? e.message : String(e) }), null, 2);
  }
}

/** The input's kind, or an error saying it is not one this command takes. */
export function expectKind(input: Input, ...kinds: FileKind[]): FileKind {
  if (input.kind && kinds.includes(input.kind)) return input.kind;
  const what = (k: FileKind) => (k === "map" ? t("a map") : k === "replay" ? t("a replay") : t("a bot (.scmbot)"));
  throw new CliError(
    input.kind ? t("{name} is {kind}, not {wanted}", { name: input.name, kind: what(input.kind), wanted: kinds.map(what).join(t(" or ")) }) : t("{name} is not a map or a replay", { name: input.name }),
    input.kind && input.path !== STDIO ? t("Try: scmjs info \"{path}\"", { path: input.path }) : t("scmjs reads maps (.scm, .scx, .chk) and replays (.rep)."), 2);
}

/**
 * Why a file could not be written, in a line a person can act on: the folder in the way, a file where a folder should
 * be, no permission. Exit 2 — the command could not do its work for where it was pointed.
 */
export function writeError(path: string, e: unknown): CliError {
  const code = String((e as NodeJS.ErrnoException).code ?? "");
  if (code === "EISDIR") return new CliError(t("{path} is a folder", { path }), t("Name a file to write."), 2);
  if (code === "ENOTDIR" || code === "EEXIST") return new CliError(t("{path} could not be written: a part of the path is a file, not a folder", { path }), null, 2);
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return new CliError(t("{path} could not be written: no permission to write there", { path }), null, 2);
  return new CliError(t("{path} could not be written ({code})", { path, code: code || String(e) }), null, 2);
}

/** Bytes or text to a file, its folder made first when it is missing; a failure is `writeError`'s line. */
export async function writeFileMade(path: string, data: Uint8Array | string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  } catch (e) {
    throw writeError(path, e);
  }
}

/**
 * A text file a command reads (triggers, strings), or standard input for `-`: its bytes, or one line saying what is
 * wrong with the name (missing, a folder) and exit 2.
 */
export async function readTextArg(path: string, stdin: Readable = process.stdin): Promise<Uint8Array> {
  if (path === STDIO) {
    const chunks: Uint8Array[] = [];
    for await (const c of stdin) chunks.push(typeof c === "string" ? new TextEncoder().encode(c) : c);
    return new Uint8Array(Buffer.concat(chunks));
  }
  try {
    if ((await stat(path)).isDirectory()) throw new CliError(t("{path} is a folder", { path }), t("Name the file to read."), 2);
    return new Uint8Array(await readFile(path));
  } catch (e) {
    if (e instanceof CliError) throw e;
    const code = (e as NodeJS.ErrnoException).code;
    throw new CliError(code === "ENOENT" ? t("No file {path}", { path }) : t("{path} cannot be read ({code})", { path, code: String(code ?? e) }), code === "ENOENT" ? t("Check the name; put quotes round a name with spaces or brackets.") : null, 2);
  }
}
