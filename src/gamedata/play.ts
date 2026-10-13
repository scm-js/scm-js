/**
 * The play set: the files the game itself reads to run a map, beyond the ones the editor
 * draws with. The editor never opens them. They are kept in a stored copy — written into
 * the same folder, under the game's own paths — for the site's play page (scmjs.dev/play),
 * which runs the game on the same origin and reads the copy in place of a second one.
 *
 * Two parts. The fixed list below is small (a few megabytes): the tables and scripts the
 * game's start reads, its interface's shared pictures, the creep edges and palette tables
 * of each tileset, the cursors. The sounds are the large part — eleven hundred files, about
 * 90 MB from a 1.16 installation and 280 MB from Remastered's — and which they are is the
 * game's own list (`arr/sfxdata.dat` over `arr/sfxdata.tbl`).
 *
 * Only a full installation has all of it: Blizzard's free StarEdit package has no sounds,
 * and a copy made from it carries no `play` in its stamp. What the classic game's own
 * interface needs beyond this (fonts, dialogs, console art) is not here: a Remastered
 * installation has not got it, and the play page brings its own.
 *
 * Pure and free of imports, like `extract.ts`.
 */

/** Bumped when the list changes in a way a copy made before cannot serve. */
export const PLAY_VERSION = 1;

const TILESETS = ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"];
const GAME_TYPES = ["melee", "ctf", "greed2500", "greed5000", "greed7500", "greed10000", "slaughter15", "slaughter30", "slaughter45", "slaughter60", "suddendeath"];
const CURSORS = ["arrow", "drag", "illegal", "magg", "magy", "magr", "targn", "targg", "targy", "targr", "time", "scrollu", "scrollur", "scrollr", "scrolldr", "scrolld", "scrolldl", "scrolll", "scrollul"];

/** The fixed part, as the game names its files. */
export const PLAY_MEMBERS: readonly string[] = [
  "arr\\portdata.dat", "arr\\portdata.tbl",
  "scripts\\aiscript.bin", "scripts\\bwscript.bin",
  ...GAME_TYPES.map((t) => `triggers\\${t}.trg`),
  ...["blink.grp", "icons.grp", "tblink.pcx", "tfontgam.pcx", "thpbar.pcx", "tminimap.pcx", "tselect.pcx", "twire.pcx"].map((n) => `game\\${n}`),
  "dlgs\\tile.grp",
  ...["grpwire", "tranwire", "wirefram"].map((n) => `unit\\wirefram\\${n}.grp`),
  ...TILESETS.flatMap((t) => [`tileset\\${t}.grp`, ...["dark", "green", "red", "shift", "trans50"].map((n) => `tileset\\${t}\\${n}.pcx`)]),
  ...CURSORS.map((c) => `cursor\\${c}.grp`),
  // StarCraft: Remastered's own console, which only a Remastered installation has: three pieces a race, and the
  // command icons at twice the size. The play page draws them with Remastered's graphics and the classic console without.
  ...["terran", "zerg", "protoss"].flatMap((race) => ["left", "center", "right"].map((piece) => `hd2\\game\\consoles\\${race}\\console_${piece}.dds`)),
  "hd2\\unit\\cmdicons\\cmdicons.dds.grp",
];

/**
 * Members of the fixed part a game cannot start without. The rest (the other game types'
 * rules, a cursor, Remastered's console) is copied when it is there and done without when
 * it is not.
 */
export const PLAY_REQUIRED: readonly string[] = PLAY_MEMBERS.filter((m) => !m.startsWith("cursor\\") && !m.startsWith("hd2\\") && (!m.startsWith("triggers\\") || m === "triggers\\melee.trg"));

/** How many sounds sfxdata.dat lists (the first is none). */
const SFX_COUNT = 1144;

/**
 * Every sound file the game's list names, as members (`sound\terran\marine\tmayes00.wav`),
 * each once. Empty when the tables are not the game's.
 */
export function playSoundMembers(sfxdataDat: Uint8Array, sfxdataTbl: Uint8Array): string[] {
  if (sfxdataDat.length !== SFX_COUNT * 9 || sfxdataTbl.length < 2) return [];
  const dat = new DataView(sfxdataDat.buffer, sfxdataDat.byteOffset, sfxdataDat.byteLength);
  const tbl = new DataView(sfxdataTbl.buffer, sfxdataTbl.byteOffset, sfxdataTbl.byteLength);
  const count = tbl.getUint16(0, true);
  const out = new Set<string>();
  for (let id = 1; id < SFX_COUNT; id++) {
    const index = dat.getUint32(id * 4, true);
    if (index < 1 || index > count) continue;
    let name = "";
    for (let at = tbl.getUint16(index * 2, true); at < sfxdataTbl.length && sfxdataTbl[at] !== 0; at++) name += String.fromCharCode(sfxdataTbl[at]);
    if (name) out.add(`sound\\${name.toLowerCase()}`);
  }
  return [...out];
}

/** What a stamp says of a copy's play set. */
export interface PlayStamp {
  version: number;
  /** Files of the fixed part that were there. */
  files: number;
  sounds: number;
  bytes: number;
}

/** A member under the stored copy: the game's path, lower case, forward slashes. */
const stored = (member: string) => member.toLowerCase().replaceAll("\\", "/");

/**
 * Copy the play set out of a source, a file at a time so that nothing but the file in hand
 * is held: `read` answers a member (null when the source has not got it), `write` stores
 * one. Returns what the stamp records, or null when the source is not a full installation
 * — a required file or every sound is missing — in which case what was written is left
 * (it is small) and the copy simply does not say it can be played from.
 *
 * `sfx`: the two sound tables, which the extraction has already read.
 */
export async function copyPlaySet(
  read: (member: string) => Promise<Uint8Array | null>,
  write: (path: string, data: Uint8Array) => Promise<void>,
  sfx: { dat: Uint8Array | undefined; tbl: Uint8Array | undefined },
  progress?: (fraction: number, label: string) => void,
): Promise<PlayStamp | null> {
  const sounds = sfx.dat && sfx.tbl ? playSoundMembers(sfx.dat, sfx.tbl) : [];
  const total = PLAY_MEMBERS.length + sounds.length;
  let done = 0, files = 0, heard = 0, bytes = 0, lacking = false;
  for (const member of PLAY_MEMBERS) {
    const data = await read(member);
    if (data) { await write(stored(member), data); files++; bytes += data.length; }
    else if (PLAY_REQUIRED.includes(member)) lacking = true;
    done++;
  }
  if (lacking) return null;
  for (const member of sounds) {
    const data = await read(member);
    if (data) { await write(stored(member), data); heard++; bytes += data.length; }
    if (++done % 25 === 0) progress?.(done / total, `Game sounds · ${heard} of ${sounds.length}`);
  }
  progress?.(1, "Game sounds");
  return heard > 0 ? { version: PLAY_VERSION, files, sounds: heard, bytes } : null;
}
