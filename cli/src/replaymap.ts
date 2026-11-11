/**
 * `scmjs replay map game.rep`: the map a replay was played on, written out as a map file. A replay carries the
 * scenario the game loaded (its CHK, the game's own copy), so the map is there whole whether or not the file is still
 * around — what a replay site's "download the map" does, from the terminal. The scenario is written as it is in the
 * replay, no parse and re-encode, into an archive like a new map's (or bare, as `.chk`).
 */
import { mkdir } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { Writable } from "node:stream";
import type { Replay } from "@scm-js/replay";
import { parseScenario, scenarioName } from "../../src/formats/chk/scenario";
import { writeArchiveBytes } from "../../src/editor/mapFile";
import { plainText } from "../../src/editor/textColors";
import { writeOutput, type Written } from "./exchange";
import { STDIO } from "./files";
import { t } from "./i18n";
import { CliError } from "./ui";

/** The kinds of map file `replay map --out` writes, by extension. */
export const MAP_EXTENSIONS = [".scx", ".scm", ".chk"] as const;

/** `--out` for the map: standard output, or a file whose extension is a map's (`.scx`, `.scm`, `.chk`). */
export function checkMapOut(out: string): void {
  if (out === STDIO) return;
  const ext = extname(out).toLowerCase();
  if (!(MAP_EXTENSIONS as readonly string[]).includes(ext)) throw new CliError(ext ? t("--out names a {ext} file; a map is .scx, .scm or .chk", { ext }) : t("--out names a file with no extension; a map is .scx, .scm or .chk"), null, 2);
}

export interface ReplayMapResult {
  /** The map's name, as the scenario says it. */
  name: string;
  width: number;
  height: number;
  /** The scenario's bytes, before any archive around them. */
  chkBytes: number;
  written: Written;
}

/** A file name for the map beside the replay: the replay's name with `.scx`. */
export const mapFileFor = (replayPath: string): string => join(dirname(replayPath), `${basename(replayPath, extname(replayPath))}.scx`);

/**
 * The replay's scenario into `out` (`-` for standard output; `.chk` writes the bare scenario), as a fresh map is
 * saved: pkware-compressed and encrypted, with a file list. The scenario is parsed only to name and measure it.
 */
export async function writeReplayMap(rep: Replay, out: string, stdout?: Writable): Promise<ReplayMapResult> {
  const scn = parseScenario(rep.chk);
  const bare = out !== STDIO && /\.chk$/i.test(out);
  const bytes = bare ? rep.chk : await writeArchiveBytes(rep.chk, { compression: "pkware", encrypt: true, listfile: true });
  // (A folder that is not there yet is made, as the other commands that write a file make theirs.)
  if (out !== STDIO) await mkdir(dirname(out), { recursive: true }).catch(() => undefined);
  const written = await writeOutput(bytes, out, stdout);
  return { name: plainText(scenarioName(scn) ?? ""), width: scn.width, height: scn.height, chkBytes: rep.chk.length, written };
}
