/**
 * Files out of the player's own copy of StarCraft, for the commands that draw with the game's graphics
 * (`scmjs map preview`) and the mod commands. A Remastered installation keeps them in CASC storage, read with kascade;
 * a 1.16.1 one in StarDat.mpq, BrooDat.mpq and patch_rt.mpq, read with mopaq, the later archive winning as the game
 * layers them. Nothing is kept on disk: a tileset is a few megabytes and comes out of either in well under a second.
 *
 * Both answer a member by the game's own name, one file a call. A Remastered storage holds the classic files at
 * those names beside its own (`HD2\…`, `SD\…`, `Carbot\…`): every picture and overlay images.tbl names (the classic
 * GRPs and `.lo?` files, byte for byte 1.16.1's), the interface pictures (`game\tunit.pcx`, the wireframes), the
 * tables, and the sounds: Remastered's own WAVs at the classic names (1.16.1's are under `SD\`). Five of the 1,123
 * names sfxdata lists are not there, four of them missing from 1.16.1 too; the fifth, `protoss\archon\parmin00.wav`,
 * is only under `SD\`. The same names, read the same way, are the editor's play set (`src/gamedata/play.ts`);
 * `mod/overlay.ts` lays the pictures under a mod for the engine's runner from here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Archive } from "mopaq";
import { decodeFlingyDat, decodeImagesDat, decodeSpritesDat, decodeUnitsDat, type UnitsDat } from "../../src/formats/dat/dat";
import { decodeIscript } from "../../src/formats/dat/iscript";
import type { SpeedTables } from "../../src/formats/dat/speed";
import { loadTileset, type Tileset } from "../../src/formats/tileset/decode";
import { findGameCopy } from "./engine";
import { t } from "./i18n";
import { CliError } from "./ui";

/** An opened copy of the game: a member by its path (`tileset\jungle.cv5`), or null when the copy has none. */
export interface GameFiles {
  folder: string;
  kind: "remastered" | "classic";
  /** What the copy is, for a person: "StarCraft: Remastered 1.23.10.13515", "StarCraft 1.16.1 (3 archives)". */
  label: string;
  read(member: string): Promise<Uint8Array | null>;
}

/** The archives a 1.16.1 copy is read from, in the game's order: StarDat, BrooDat, then patch_rt (later wins). */
const ARCHIVES = ["stardat.mpq", "broodat.mpq", "patch_rt.mpq"];

/** The archives in `folder` the game reads, in its order, by their names on disk (any case). */
export function classicArchives(folder: string): string[] {
  let names: string[];
  try { names = readdirSync(folder); } catch { return []; }
  return ARCHIVES.map((want) => names.find((n) => n.toLowerCase() === want)).filter((n): n is string => !!n).map((n) => join(folder, n));
}

/** 1.16.1: each archive opened once; a member is read from the last archive that has it. */
export function archiveFiles(folder: string, paths = classicArchives(folder)): GameFiles {
  const archives: Archive[] = [];
  for (const p of paths) {
    try { archives.push(Archive.open(new Uint8Array(readFileSync(p)))); } catch (e) {
      throw new CliError(t("{path} could not be read as an archive ({reason}).", { path: p, reason: String(e instanceof Error ? e.message : e) }), t("The copy's StarDat.mpq and BrooDat.mpq are read as they are; a damaged one needs the game repaired."));
    }
  }
  return {
    folder, kind: "classic", label: t("StarCraft 1.16.1 ({n, plural, one {# archive} other {# archives}})", { n: archives.length }),
    read: async (member) => {
      const name = member.replaceAll("/", "\\");
      for (let i = archives.length - 1; i >= 0; i--) {
        try { return archives[i].readFile(name); } catch { /* not in this one */ }
      }
      return null;
    },
  };
}

/**
 * Remastered: the installation's CASC storage, opened with kascade (~0.2 s for its indices). A member is read when
 * asked for (any case, either slash; kascade looks the name up without case), null when the build does not list it or
 * this install has not got it (another language's files).
 */
export async function storageFiles(folder: string): Promise<GameFiles> {
  const { Storage } = await import("kascade");
  const { nodeSource } = await import("kascade/node");
  let storage: Awaited<ReturnType<typeof Storage.open>>;
  try { storage = await Storage.open(nodeSource(folder)); } catch (e) {
    throw new CliError(t("{folder} could not be read as a StarCraft: Remastered installation ({reason}).", { folder, reason: String(e instanceof Error ? e.message : e) }), t("Name another copy with --starcraft, or let the Battle.net app repair this one."));
  }
  return {
    folder, kind: "remastered", label: `StarCraft: Remastered ${storage.build.version}`.trim(),
    read: async (member) => {
      const name = member.replaceAll("\\", "/").toLowerCase();
      const info = storage.fileInfo(name);
      if (!info?.installed) return null;
      return storage.readFile(name);
    },
  };
}

/**
 * The copy named with `--starcraft` (or `SCMJS_STARCRAFT`), else the first in the usual places, opened. `why` is said in
 * the hint when there is none: what the command wanted the game's files for.
 */
export async function openGameFiles(named: string | undefined, why = t("The picture is drawn with your own installation's tileset graphics")): Promise<GameFiles> {
  let copy: ReturnType<typeof findGameCopy>;
  try { copy = findGameCopy(named); } catch (e) {
    if (e instanceof CliError && !named) throw new CliError(e.message, t("{why}: name its folder with --starcraft (or SCMJS_STARCRAFT).", { why }), e.exitCode);
    throw e;
  }
  return copy.kind === "remastered" ? storageFiles(copy.folder) : archiveFiles(copy.folder);
}

/**
 * One tileset's graphics: cv5, vf4, vr4, wpe and the megatile table — Remastered's `.vx4ex` where the copy has it (its
 * 32-bit table; every 1.16.1 tile is in it unchanged), else the classic `.vx4`.
 */
export async function readTileset(files: GameFiles, name: string): Promise<Tileset> {
  const part = async (ext: string) => files.read(`tileset\\${name}.${ext}`);
  const [cv5, vf4, vr4, wpe, vx4ex] = await Promise.all(["cv5", "vf4", "vr4", "wpe", "vx4ex"].map(part));
  const vx4 = vx4ex ?? await part("vx4");
  const missing = Object.entries({ cv5, vf4, vr4, wpe, vx4 }).filter(([, v]) => !v).map(([k]) => `${name}.${k}`);
  if (missing.length) throw new CliError(t("{copy} in {folder} has no {files}.", { copy: files.label, folder: files.folder, files: missing.join(", ") }), t("The copy may be incomplete; name another with --starcraft."));
  return loadTileset({ cv5: cv5!, vf4: vf4!, vr4: vr4!, wpe: wpe!, vx4: vx4!, vx4Extended: !!vx4ex });
}

/** units.dat, for the sizes units are drawn at; null when the copy's cannot be read (each unit is then a tile). */
export async function readUnitsDat(files: GameFiles): Promise<UnitsDat | null> {
  try {
    const bytes = await files.read("arr\\units.dat");
    return bytes ? decodeUnitsDat(bytes) : null;
  } catch {
    return null;
  }
}

/**
 * What a unit's walking speed is read from (`walkSpeed`): units.dat, flingy.dat, sprites.dat, images.dat and
 * iscript.bin; null when the copy lacks one or one cannot be read.
 */
export async function readSpeedTables(files: GameFiles, units?: UnitsDat | null): Promise<SpeedTables | null> {
  try {
    const [u, flingy, sprites, images, iscript] = await Promise.all(["arr\\units.dat", "arr\\flingy.dat", "arr\\sprites.dat", "arr\\images.dat", "scripts\\iscript.bin"].map((m, i) => (i === 0 && units ? null : files.read(m))));
    const table = units ?? (u ? decodeUnitsDat(u) : null);
    if (!table || !flingy || !sprites || !images || !iscript) return null;
    return { units: table, flingy: decodeFlingyDat(flingy), sprites: decodeSpritesDat(sprites), images: decodeImagesDat(images), iscript: decodeIscript(iscript) };
  } catch {
    return null;
  }
}
