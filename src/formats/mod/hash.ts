/**
 * A mod's hash: the name a mod goes by between people, the same wherever it is worked out — the play page (scm-sim's
 * `src/mods/inspect.ts` and `web/modDrop.ts#buildMod`), the command line, the editor's data sets and the plugins.
 *
 * It covers **every file the mod provides**, never compared with anyone's copy of the game:
 *
 * - one line for each game file the mod lays over the game — its loose files under its game folders and the members
 *   of its archives (an `.mpq`, the archive inside a self-executing loader exe), by the game's name (lower case,
 *   backslashes); a member an archive lists and does not hold is left out;
 * - one line for each plugin it carries as a file (`plugins\<file>.qdp`, `.bwl`, lower case);
 * - one line for its FireGraft project (`<file>.fgp`, lower case; FireGraft's `.fgd` database is not a line).
 *
 * Each line is `name<TAB>sha256 hex of the bytes`; the lines are sorted by name and joined with "\n", and the hash is
 * the first sixteen hex digits of their SHA-256. A page that does not run the plugins presents the hash of the lines
 * without the plugins' ("without plugins").
 *
 * **No line for an operating system's files** (`sources.ts#SYSTEM_FILES`: `desktop.ini`, `Thumbs.db`, `.DS_Store`, a
 * zip's `__MACOSX/` and the rest of that list), wherever one lies: loose in a game folder, or a member of an archive
 * that was packed from such a folder. The game never asks for one, and not every route hands them over (a browser's
 * folder handle hides `desktop.ini`), so with them a mod's hash followed how its folder was read. `hashLines` drops
 * such lines itself, so the hash is the same whatever list a caller made; the readers leave the files out too, so the
 * counts agree.
 *
 * **The older form.** Until 2026-11-09 those files had lines. A mod kept in a browser and a replay tagged before then
 * name the mod by that hash, so where hashes are matched it is still accepted: `hashLinesAsWere` is the rule as it
 * was, and `ModHash.older` the mod's hashes by it, there only when the files were seen (a route that never saw them
 * cannot work the older hash out).
 *
 * Pure: the command line, the editor's worker and any page share it.
 */
import { fileDigest, gameName, isSystemFile } from "./sources";

/** A plugin a mod carries: MPQDraft's `.qdp`, Chaoslauncher's `.bwl`. */
export const isPluginFile = (name: string): boolean => /\.(qdp|bwl)$/i.test(name);
/** FireGraft's project, the one FireGraft file the hash has a line for. */
export const isFiregraftProject = (name: string): boolean => /\.fgp$/i.test(name);
/** A file of a mod's code rather than the game's: a plugin, FireGraft's project or database. */
export const isModCode = (name: string): boolean => /\.(qdp|bwl|fgp|fgd)$/i.test(name);

const leafOf = (path: string): string => path.split(/[\\/]/).pop()!;

/** A plugin's line: `plugins\<file name>`, lower case. */
export const pluginLine = (name: string, sha256: string): string => `plugins\\${leafOf(name).toLowerCase()}\t${sha256}`;
/** The FireGraft project's line: `<file name>.fgp`, lower case. */
export const firegraftLine = (name: string, sha256: string): string => `${leafOf(name).toLowerCase()}\t${sha256}`;
/** A game file's line: its game name. */
export const gameLine = (name: string, sha256: string): string => `${gameName(name)}\t${sha256}`;

const lineName = (l: string) => l.slice(0, l.indexOf("\t"));

/** Whether a line `name<TAB>sha256` is of an operating system's file (`isSystemFile`), which the hash has no line for. */
export const isSystemLine = (line: string): boolean => isSystemFile(lineName(line));

/**
 * The hash of lines `name<TAB>sha256` in any order: sorted by name, joined with "\n", SHA-256, sixteen hex digits. A
 * line of an operating system's file (`isSystemLine`) is dropped first.
 */
export async function hashLines(lines: readonly string[]): Promise<string> {
  return hashLinesAsWere(lines.filter((l) => !isSystemLine(l)));
}

/**
 * `hashLines` as it was until 2026-11-09: every line given, an operating system's files among them. For matching a
 * hash made then (a replay's tag, a mod kept in a browser), never for naming a mod now.
 */
export async function hashLinesAsWere(lines: readonly string[]): Promise<string> {
  const sorted = [...lines].sort((a, b) => (lineName(a) < lineName(b) ? -1 : lineName(a) > lineName(b) ? 1 : 0));
  return (await fileDigest(new TextEncoder().encode(sorted.join("\n")))).slice(0, 16);
}

/** A file by its name and its bytes' SHA-256 (`fileDigest`). */
export interface Digest { name: string; sha256: string }

/** What a mod's hash is made of: its game files by game name, the plugins it carries and its FireGraft files. */
export interface ModHashInput {
  files: readonly Digest[];
  /** Plugins carried as files (a plugin inside the mod's archive is not one: the play page does not load it). */
  plugins?: readonly Digest[];
  /** FireGraft's files; only the project (`.fgp`) has a line. */
  firegraft?: readonly Digest[];
}

export interface ModHash {
  /** The mod's hash: every line. */
  hash: string;
  /** The hash without the plugins' lines: what a page that does not run them presents. */
  withoutPlugins: string;
  /** The lines without the plugins' (sorted): what `hashLines` makes `withoutPlugins` of. */
  lines: string[];
  /** The plugins' lines (sorted). */
  pluginLines: string[];
  /**
   * There when an operating system's files were among what was given (`isSystemFile`): the mod's hashes as they were
   * while those files had lines (`hashLinesAsWere`), and the names left out. Matched as an older form, never presented.
   */
  older?: { hash: string; withoutPlugins: string; left: string[] };
}

/**
 * The mod's hash and its hash without plugins. Game files are taken once by game name (the last given wins, as a
 * later layer does in the game); plugins and FireGraft projects once by file name, any case (the first given wins,
 * as on the play page). An operating system's files have no line, and `older` says what the hashes were with them.
 */
export async function modHashOfDigests(input: ModHashInput): Promise<ModHash> {
  // Every line as the rule had it until 2026-11-09, each marked when it is of an operating system's file (by the name
  // given, folders and all: a plugin's line keeps only the file's name).
  const game = new Map<string, { sha256: string; system: boolean }>();
  for (const f of input.files) game.set(gameName(f.name), { sha256: f.sha256, system: isSystemFile(f.name) });
  const once = (list: readonly Digest[], keep: (name: string) => boolean, line: (name: string, sha: string) => string) => {
    const seen = new Set<string>(), out: { line: string; system: boolean }[] = [];
    for (const f of list) {
      const key = leafOf(f.name).toLowerCase();
      if (!keep(f.name) || seen.has(key)) continue;
      seen.add(key);
      out.push({ line: line(f.name, f.sha256), system: isSystemFile(f.name) });
    }
    return out;
  };
  const byLine = (a: { line: string }, b: { line: string }) => (a.line < b.line ? -1 : a.line > b.line ? 1 : 0);
  const were = [...[...game].map(([name, f]) => ({ line: `${name}\t${f.sha256}`, system: f.system })), ...once(input.firegraft ?? [], isFiregraftProject, firegraftLine)].sort(byLine);
  const pluginsWere = once(input.plugins ?? [], isPluginFile, pluginLine).sort(byLine);
  const lines = were.filter((l) => !l.system).map((l) => l.line), pluginLines = pluginsWere.filter((l) => !l.system).map((l) => l.line);
  const left = [...were, ...pluginsWere].filter((l) => l.system).map((l) => lineName(l.line));
  return {
    hash: await hashLines([...lines, ...pluginLines]), withoutPlugins: await hashLines(lines), lines, pluginLines,
    ...(left.length ? { older: { hash: await hashLinesAsWere([...were, ...pluginsWere].map((l) => l.line)), withoutPlugins: await hashLinesAsWere(were.map((l) => l.line)), left } } : {}),
  };
}

/** `modHashOfDigests` from the files' bytes. */
export async function modHash(input: { files: readonly { name: string; bytes: Uint8Array }[]; plugins?: readonly { name: string; bytes: Uint8Array }[]; firegraft?: readonly { name: string; bytes: Uint8Array }[] }): Promise<ModHash> {
  const digest = async (list: readonly { name: string; bytes: Uint8Array }[] = []) => {
    const out: Digest[] = [];
    for (const f of list) out.push({ name: f.name, sha256: await fileDigest(f.bytes) });
    return out;
  };
  return modHashOfDigests({ files: await digest(input.files), plugins: await digest(input.plugins), firegraft: await digest(input.firegraft) });
}

/* ── An archive with no list of its files ─────────────────────────────── */

const TILESETS = ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"];
const RACES = ["zerg", "terran", "protoss"];

/**
 * The names looked for in a mod's archive that has no list of its files: the play page's list (scm-sim
 * `web/modDrop.ts#namesToProbe`: what the game reads at its start and for a game, every tileset's files, the eleven
 * tables in both layouts), and every path the archive's own `arr\images.tbl`, `sfxdata.tbl` and `portdata.tbl` name.
 * `read` answers a member of the archive, or null. (The play page also reads those three tables from the person's own
 * game; this does not, so the set never depends on a copy.)
 */
export function probeNames(read: (name: string) => Uint8Array | null): string[] {
  const names = new Set<string>(["scripts\\iscript.bin", "arr\\images.dat", "game\\tselect.pcx", "arr\\images.tbl", "arr\\sfxdata.dat", "arr\\sfxdata.tbl", "arr\\mapdata.dat", "arr\\mapdata.tbl"]);
  const iface = [
    ...["font8", "font10", "font12", "font14", "font16", "font16x"].map((n) => `font\\${n}.fnt`),
    "parallax\\star.spk",
    ...["minimap", "stat_f10", "statdata", "statfluf", "statlb", "statport", "statres"].map((n) => `rez\\${n}.bin`),
    ...RACES.flatMap((race) => { const r = race[0]; return [`game\\${r}console.pcx`, `game\\${r}conover.pcx`, `game\\${r}pbrempt.pcx`, `game\\${r}pbrfull.pcx`, `rez\\statbtn${r}.bin`, `rez\\${r}textbox.bin`, `dlgs\\${race}.grp`, `unit\\cmdbtns\\${r}cmdbtns.grp`]; }),
    "game\\nconsole.pcx", "game\\nconover.pcx", "rez\\statbtnn.bin",
    "unit\\cmdbtns\\cmdicons.grp", "unit\\cmdbtns\\ticon.pcx",
    ...["abrtmenu", "allyfltr", "dlgfatal", "gamemenu", "help", "helpmenu", "lmission", "loadgame", "minimappreview", "msgfltr", "netdlg", "objctdlg", "ok", "okcancel", "options",
      "quit", "quit2mnu", "quitrepl", "restart", "savegame", "snd_dlg", "spd_dlg", "teamfltr", "timeout", "tips_dlg", "video", "wait", "wmission"].map((n) => `rez\\${n}.bin`),
    "rez\\help_txt.tbl", "rez\\network.tbl", "rez\\tips.tbl",
  ];
  for (const tileset of TILESETS) {
    for (const n of [
      ...["flingy", "orders", "portdata", "sprites", "techdata", "units", "upgrades", "weapons"].map((n) => `arr\\${n}.dat`), "arr\\portdata.tbl",
      ...["blink.grp", "icons.grp", "tblink.pcx", "tfontgam.pcx", "thpbar.pcx", "tminimap.pcx", "tselect.pcx", "tunit.pcx", "twire.pcx"].map((n) => `game\\${n}`),
      "dlgs\\tile.grp", "rez\\stat_txt.tbl", "scripts\\aiscript.bin", "scripts\\bwscript.bin", "triggers\\melee.trg",
      ...["grpwire", "tranwire", "wirefram"].map((n) => `unit\\wirefram\\${n}.grp`),
      ...["cv5", "grp", "vf4", "vr4", "vx4", "wpe"].map((e) => `tileset\\${tileset}.${e}`),
      ...["bexpl", "bfire", "dark", "gfire", "green", "ofire", "red", "shift", "trans50"].map((n) => `tileset\\${tileset}\\${n}.pcx`),
      ...iface,
    ]) names.add(n);
    names.add(`tileset\\${tileset}.vx4ex`);
  }
  for (const t of ["units", "weapons", "flingy", "sprites", "images", "orders", "upgrades", "techdata", "portdata", "sfxdata", "mapdata"]) { names.add(`arr\\${t}.dat`); names.add(`arr\\${t}.datex`); }
  for (const n of ["rez\\unitnames.tbl", "unit\\cmdbtns\\uniticons.grp", "rez\\network.tbl"]) names.add(n);
  for (const [table, under] of [["arr\\images.tbl", "unit\\"], ["arr\\sfxdata.tbl", "sound\\"], ["arr\\portdata.tbl", "portrait\\"]] as const) {
    let bytes: Uint8Array | null = null;
    try { bytes = read(table); } catch { bytes = null; }
    if (!bytes) continue;
    try { for (const n of tblPaths(bytes)) if (n) names.add(gameName(under + n)); } catch { /* not a string table */ }
  }
  return [...names];
}

const latin = new TextDecoder("windows-1252");

/** A string table's strings, each to its first NUL, as the play page reads one for names. */
function tblPaths(bytes: Uint8Array): string[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = v.getUint16(0, true), out: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = v.getUint16(2 + i * 2, true);
    if (at > bytes.length) throw new Error(`string ${i} starts past the end`);
    const end = bytes.indexOf(0, at);
    out.push(latin.decode(bytes.subarray(at, end < 0 ? bytes.length : end)));
  }
  return out;
}
