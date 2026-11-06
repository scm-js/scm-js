/** Reading what the person named: what kind of file it is, and a map or replay out of it, as the editor reads them. */
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { openMapBytes, type OpenedMap } from "../../src/editor/mapFile";
import { looksLikeMpq } from "../../src/formats/mpq/scm";
import { detectFormat, parseReplay, type Replay } from "@scm-js/replay";
import { CliError } from "./ui";

export type FileKind = "map" | "replay" | "bot";

export interface Input { path: string; name: string; bytes: Uint8Array; kind: FileKind | null }

export async function readInput(path: string): Promise<Input> {
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
    input.kind ? `Try: scmjs info "${input.path}"` : "scmjs reads maps (.scm, .scx, .chk) and replays (.rep).", 2);
}
