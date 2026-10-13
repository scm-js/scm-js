/**
 * The play set: the files the game itself reads to run a map, beyond the ones the editor
 * draws with. The editor never opens them. They are kept in a stored copy — written into
 * the same folder, under the game's own paths — for the site's play page (scmjs.dev/play),
 * which runs the game on the same origin and reads the copy in place of a second one.
 *
 * Three parts. The fixed list below is small (a few megabytes): the tables and scripts the
 * game's start reads, its interface's shared pictures, the creep edges and palette tables
 * of each tileset, the cursors. The sounds are the large part — eleven hundred files, about
 * 90 MB from a 1.16 installation and 280 MB from Remastered's — and which they are is the
 * game's own list (`arr/sfxdata.dat` over `arr/sfxdata.tbl`). And the pictures the editor
 * leaves out: it copies the graphics of what can be placed on a map and what those lead to
 * (885 of the 999 images), and the game in play draws the rest too — a building under
 * construction, a zerg birth, the protoss warp-in, every spell's mark on a unit, the
 * selection circles — about a hundred more files, with their Remastered sprites where the
 * installation has them.
 *
 * Only a full installation has all of it: Blizzard's free StarEdit package has no sounds,
 * and a copy made from it carries no `play` in its stamp. What the classic game's own
 * interface needs beyond this (fonts, dialogs, console art) is not here: a Remastered
 * installation has not got it, and the play page brings its own.
 *
 * Pure, and importing only what `extract.ts` does.
 */

import { animMember, animPath, slimAnim } from "../formats/dat/anim.ts";

/**
 * Bumped when the list grows. 2 (2026-10-12): the pictures of every image, not only the
 * ones the editor can place — the play page plays from a copy of an earlier version and
 * draws without what it lacks. 3 (2026-10-13): Remastered's cursors, wireframes, resource
 * icons and creep edges, which the play page falls back to the classic ones without. (What
 * its water and lava move by is among the editor's own files, in every Remastered copy.)
 */
export const PLAY_VERSION = 3;

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
  // And the rest of its interface at that size: the cursors, the wireframe of the selection window (the small ones
  // of a group and of a transport's load are the classic drawings doubled, and are left), the resource icons, and
  // each tileset's creep edges (the creep itself is among the terrain's pictures).
  ...CURSORS.map((c) => `hd2\\cursor\\${c}.dds.grp`),
  "hd2\\unit\\wirefram\\wirefram.dds.grp",
  "hd2\\game\\icons.dds.grp",
  ...TILESETS.map((t) => `hd2\\tileset\\${t}.dds.grp`),
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

const IMAGE_COUNT = 999;

/**
 * Everything images.dat can draw, as members: each image's GRP and the overlay position
 * files its six columns name (`unit\\…`, from `arr/images.tbl`), each once, and its
 * Remastered sprite by number. Empty when the tables are not the game's.
 */
export function playImageMembers(imagesDat: Uint8Array, imagesTbl: Uint8Array): { files: string[]; sprites: number[] } {
  if (imagesDat.length < IMAGE_COUNT * 38 || imagesTbl.length < 2) return { files: [], sprites: [] };
  const dat = new DataView(imagesDat.buffer, imagesDat.byteOffset, imagesDat.byteLength);
  const tbl = new DataView(imagesTbl.buffer, imagesTbl.byteOffset, imagesTbl.byteLength);
  const count = tbl.getUint16(0, true);
  const files = new Set<string>();
  const take = (index: number) => {
    if (index < 1 || index > count) return;
    let name = "";
    for (let at = tbl.getUint16(index * 2, true); at < imagesTbl.length && imagesTbl[at] !== 0; at++) name += String.fromCharCode(imagesTbl[at]);
    if (name) files.add(`unit\\${name.toLowerCase()}`);
  };
  for (let i = 0; i < IMAGE_COUNT; i++) {
    take(dat.getUint32(i * 4, true));
    // The GRP column, six columns of a byte, the script column, then the six overlay columns.
    for (let k = 0; k < 6; k++) take(dat.getUint32(IMAGE_COUNT * (14 + k * 4) + i * 4, true));
  }
  return { files: [...files], sprites: Array.from({ length: IMAGE_COUNT }, (_, i) => i) };
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
 * `tables`: the sound and image tables, which the extraction has already read. `has`:
 * whether the copy holds a path already (the editor's own files), so nothing is read twice.
 */
export async function copyPlaySet(
  read: (member: string) => Promise<Uint8Array | null>,
  write: (path: string, data: Uint8Array) => Promise<void>,
  tables: { sfxDat: Uint8Array | undefined; sfxTbl: Uint8Array | undefined; imagesDat?: Uint8Array; imagesTbl?: Uint8Array },
  progress?: (fraction: number, label: string) => void,
  has: (path: string) => boolean = () => false,
): Promise<PlayStamp | null> {
  const sounds = tables.sfxDat && tables.sfxTbl ? playSoundMembers(tables.sfxDat, tables.sfxTbl) : [];
  const images = tables.imagesDat && tables.imagesTbl ? playImageMembers(tables.imagesDat, tables.imagesTbl) : { files: [], sprites: [] };
  const pictures = images.files.filter((member) => !has(stored(member)));
  const sprites = images.sprites.filter((image) => !has(animPath(image)));
  const total = PLAY_MEMBERS.length + pictures.length + sprites.length + sounds.length;
  let done = 0, files = 0, heard = 0, bytes = 0, lacking = false;
  for (const member of PLAY_MEMBERS) {
    const data = await read(member);
    if (data) { await write(stored(member), data); files++; bytes += data.length; }
    else if (PLAY_REQUIRED.includes(member)) lacking = true;
    done++;
  }
  if (lacking) return null;
  // The pictures the editor's own copy leaves out, and their Remastered sprites cut down as the editor's are.
  for (const member of pictures) {
    const data = await read(member);
    if (data) { await write(stored(member), data); files++; bytes += data.length; }
    if (++done % 25 === 0) progress?.(done / total, "Game pictures");
  }
  for (const image of sprites) {
    const whole = await read(animMember(image));
    if (whole) { const data = slimAnim(whole); await write(animPath(image), data); files++; bytes += data.length; }
    if (++done % 25 === 0) progress?.(done / total, "Game pictures");
  }
  for (const member of sounds) {
    const data = await read(member);
    if (data) { await write(stored(member), data); heard++; bytes += data.length; }
    if (++done % 25 === 0) progress?.(done / total, `Game sounds · ${heard} of ${sounds.length}`);
  }
  progress?.(1, "Game sounds");
  return heard > 0 ? { version: PLAY_VERSION, files, sounds: heard, bytes } : null;
}
