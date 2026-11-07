/** Reading what the person named: what kind of file it is, and a map or replay out of it, as the editor reads them. */
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { Readable } from "node:stream";
import { openMapBytes, type OpenedMap } from "../../src/editor/mapFile";
import { looksLikeMpq } from "../../src/formats/mpq/scm";
import { detectFormat, parseReplay, type Replay } from "@scm-js/replay";
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
    if (!bytes.length) throw new CliError("Nothing came on standard input", "`-` reads a map or replay from a pipe: cat a.scx | scmjs map info -", 2);
    const kind = kindOf("", bytes) ?? (looksLikeChk(bytes) ? "map" : null);
    const ext = kind === "replay" ? "rep" : kind === "bot" ? "scmbot" : looksLikeMpq(bytes) ? "scx" : "chk";
    return { path: STDIO, name: `stdin.${ext}`, bytes, kind };
  }
  let bytes: Uint8Array;
  try {
    if ((await stat(path)).isDirectory()) throw new CliError(`${path} is a folder`, "Name a map (.scm, .scx, .chk) or a replay (.rep).", 2);
    bytes = new Uint8Array(await readFile(path));
  } catch (e) {
    if (e instanceof CliError) throw e;
    const code = (e as NodeJS.ErrnoException).code;
    throw new CliError(code === "ENOENT" ? `No file ${path}` : `${path} cannot be read (${code ?? e})`, code === "ENOENT" ? "Check the name; put quotes round a name with spaces or brackets." : null, 2);
  }
  return { path, name: basename(path), bytes, kind: kindOf(basename(path), bytes) };
}

/** A bare scenario starts with a section name: four bytes of capitals, digits or spaces (`VER `, `TYPE`, `MTXM`). */
export function looksLikeChk(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (const b of bytes.subarray(0, 4)) if (!((b >= 0x41 && b <= 0x5a) || (b >= 0x30 && b <= 0x39) || b === 0x20)) return false;
  return true;
}

/** What a file is, from its first bytes, then its extension. */
export function kindOf(name: string, bytes: Uint8Array): FileKind | null {
  if (detectFormat(bytes)) return "replay";
  if (bytes.length >= 8 && String.fromCharCode(...bytes.subarray(0, 8)) === "SCMBOT1\n") return "bot";
  if (looksLikeMpq(bytes) || /\.(scm|scx|chk)$/i.test(name)) return "map";
  return null;
}

export async function loadMapInput(input: Input): Promise<OpenedMap> {
  try {
    return await openMapBytes(input.bytes, input.name);
  } catch (e) {
    throw new CliError(`${input.name} is not a map this can read: ${e instanceof Error ? e.message : e}`);
  }
}

export async function loadReplayInput(input: Input): Promise<Replay> {
  try {
    return await parseReplay(input.bytes);
  } catch (e) {
    throw new CliError(`${input.name} is not a replay this can read: ${e instanceof Error ? e.message : e}`);
  }
}

/** The input's kind, or an error saying it is not one this command takes. */
export function expectKind(input: Input, ...kinds: FileKind[]): FileKind {
  if (input.kind && kinds.includes(input.kind)) return input.kind;
  const what = { map: "a map", replay: "a replay", bot: "a bot (.scmbot)" };
  throw new CliError(
    input.kind ? `${input.name} is ${what[input.kind]}, not ${kinds.map((k) => what[k]).join(" or ")}` : `${input.name} is not a map or a replay`,
    input.kind && input.path !== STDIO ? `Try: scmjs info "${input.path}"` : "scmjs reads maps (.scm, .scx, .chk) and replays (.rep).", 2);
}
