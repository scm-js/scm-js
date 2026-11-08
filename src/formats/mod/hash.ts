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
 * Pure: the command line, the editor's worker and any page share it.
 */
import { fileDigest, gameName } from "./sources";

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

/** The hash of lines `name<TAB>sha256` in any order: sorted by name, joined with "\n", SHA-256, sixteen hex digits. */
export async function hashLines(lines: readonly string[]): Promise<string> {
  const name = (l: string) => l.slice(0, l.indexOf("\t"));
  const sorted = [...lines].sort((a, b) => (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0));
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
}

/**
 * The mod's hash and its hash without plugins. Game files are taken once by game name (the last given wins, as a
 * later layer does in the game); plugins and FireGraft projects once by file name, any case (the first given wins,
 * as on the play page).
 */
export async function modHashOfDigests(input: ModHashInput): Promise<ModHash> {
  const game = new Map<string, string>();
  for (const f of input.files) game.set(gameName(f.name), f.sha256);
  const once = (list: readonly Digest[], keep: (name: string) => boolean, line: (name: string, sha: string) => string) => {
    const seen = new Set<string>(), out: string[] = [];
    for (const f of list) {
      const key = leafOf(f.name).toLowerCase();
      if (!keep(f.name) || seen.has(key)) continue;
      seen.add(key);
      out.push(line(f.name, f.sha256));
    }
    return out;
  };
  const lines = [...[...game].map(([name, sha]) => `${name}\t${sha}`), ...once(input.firegraft ?? [], isFiregraftProject, firegraftLine)].sort();
  const pluginLines = once(input.plugins ?? [], isPluginFile, pluginLine).sort();
  return { hash: await hashLines([...lines, ...pluginLines]), withoutPlugins: await hashLines(lines), lines, pluginLines };
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
