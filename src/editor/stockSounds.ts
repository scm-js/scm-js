/**
 * The game's own sounds, as a list a map maker can search: every file `sfxdata.tbl` names,
 * with the units that say it and when (`units.dat`'s voice columns, through `sfxdata.dat`).
 * A trigger plays one by its path in the game's archives — `sound\Terran\Marine\TMaYes00.wav`
 * — and the map needs neither the file nor a WAV entry for it.
 *
 * Pure: the tables come in decoded. `formats/units/load.ts` fetches them.
 */
import { VOICED_UNITS, type SfxdataDat, type UnitsDat } from "../formats/dat/dat";
import { normalizeMember } from "./sounds";

/** When a unit says a line: trained, clicked, clicked again and again, given an order. */
export type VoiceKind = "ready" | "what" | "annoyed" | "yes";
export const VOICE_KINDS: readonly VoiceKind[] = ["ready", "what", "yes", "annoyed"];

export interface StockVoice {
  unit: number;
  kind: VoiceKind;
}

export interface StockSound {
  /** The path a trigger plays, as the game's archives have it. */
  path: string;
  /**
   * The folders under `sound\`, for grouping: `Terran\Marine`, empty for a file at the top.
   * One spelling per folder — the table writes `Protoss\CARRIER` and `Protoss\Carrier` both.
   */
  folder: string;
  /** The file name alone. */
  file: string;
  /** The units whose voice this is, in unit order; empty for effects, alerts and the like. */
  voices: StockVoice[];
}

export interface StockSounds {
  /** By folder — the races, then effects — and the table's own order within a folder. */
  sounds: StockSound[];
  /** By `normalizeMember(path)`. */
  byPath: ReadonlyMap<string, StockSound>;
  /** Unit id → its lines, in `VOICE_KINDS` order and the table's order within a kind. */
  byUnit: ReadonlyMap<number, { kind: VoiceKind; sound: StockSound }[]>;
}

/** The voices first, race by race, then the rest — a list opening on weapon hits helps nobody. */
const FOLDER_ORDER = ["terran", "zerg", "protoss", "misc", "bullet", "glue"];
function rank(folder: string): number {
  const at = FOLDER_ORDER.indexOf(folder.split("\\")[0].toLowerCase());
  return at < 0 ? FOLDER_ORDER.length : at;
}

/** Every sound the game ships lives under this folder of its archives. */
export const STOCK_SOUND_ROOT = "sound\\";

/**
 * Build the list. `names` is `sfxdata.tbl` (paths under `sound\`), `sfx` maps a sound id to
 * a 1-based entry of it, and `units` — optional, the list is complete without it — says
 * which ids are whose voice.
 */
export function buildStockSounds(names: readonly string[], sfx: SfxdataDat | null, units: UnitsDat | null): StockSounds {
  const byPath = new Map<string, StockSound>();
  const byTblIndex: (StockSound | undefined)[] = [];
  const folders = new Map<string, string>();
  names.forEach((name, i) => {
    const rel = name.replace(/\//g, "\\").replace(/^\\+/, "");
    if (!rel) return;
    const path = STOCK_SOUND_ROOT + rel;
    const key = normalizeMember(path);
    // The table repeats a few files; the first spelling stands for all of them.
    let sound = byPath.get(key);
    if (!sound) {
      const cut = rel.lastIndexOf("\\");
      const folder = cut < 0 ? "" : rel.slice(0, cut);
      if (!folders.has(folder.toLowerCase())) folders.set(folder.toLowerCase(), folder);
      sound = { path, folder: folders.get(folder.toLowerCase())!, file: rel.slice(cut + 1), voices: [] };
      byPath.set(key, sound);
    }
    byTblIndex[i + 1] = sound;
  });

  const byUnit = new Map<number, { kind: VoiceKind; sound: StockSound }[]>();
  if (sfx && units) {
    const soundOf = (id: number) => (id > 0 && id < sfx.file.length ? byTblIndex[sfx.file[id]] : undefined);
    const give = (unit: number, kind: VoiceKind, first: number, last: number) => {
      // A range that runs backwards or off the table is a mod's mistake, not a thousand lines.
      if (first === 0 || last < first || last - first > 64) last = first;
      for (let id = first; id <= last; id++) {
        const sound = soundOf(id);
        if (!sound || sound.voices.some((v) => v.unit === unit && v.kind === kind)) continue;
        sound.voices.push({ unit, kind });
        let lines = byUnit.get(unit);
        if (!lines) byUnit.set(unit, (lines = []));
        lines.push({ kind, sound });
      }
    };
    for (let unit = 0; unit < units.whatSoundStart.length; unit++) {
      for (const kind of VOICE_KINDS) {
        if (kind === "what") give(unit, kind, units.whatSoundStart[unit], units.whatSoundEnd[unit]);
        else if (unit >= VOICED_UNITS) continue;
        else if (kind === "ready") give(unit, kind, units.readySound[unit], units.readySound[unit]);
        else if (kind === "yes") give(unit, kind, units.yesSoundStart[unit], units.yesSoundEnd[unit]);
        else give(unit, kind, units.annoyedSoundStart[unit], units.annoyedSoundEnd[unit]);
      }
    }
  }

  const order = new Map<StockSound, number>();
  let n = 0;
  for (const s of byPath.values()) order.set(s, n++);
  const sounds = [...byPath.values()].sort((a, b) => rank(a.folder) - rank(b.folder) || a.folder.toLowerCase().localeCompare(b.folder.toLowerCase()) || order.get(a)! - order.get(b)!);
  return { sounds, byPath, byUnit };
}

/** The stock sound at a trigger's path, or null — for a path in any case with either slash. */
export function findStockSound(stock: StockSounds, path: string): StockSound | null {
  return stock.byPath.get(normalizeMember(path.trim())) ?? null;
}

/** Whether a path points into the game's sound folder at all, listed or not. */
export function isStockPath(path: string): boolean {
  return normalizeMember(path.trim()).startsWith(STOCK_SOUND_ROOT);
}

/**
 * The sounds matching what was typed: every word must be in the path, or in the name of a
 * unit that says the line, or be the moment it says it ("marine yes"). `unitName` is the
 * caller's so the search follows the names on screen (a mod's, or another language's).
 */
export function searchStockSounds(stock: StockSounds, query: string, unitName: (id: number) => string, kindName: (kind: VoiceKind) => string): StockSound[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return stock.sounds;
  const text = new Map<StockSound, string>();
  const textOf = (s: StockSound) => {
    let v = text.get(s);
    if (v === undefined) {
      // "pissed" is what the game's files and every map maker call the annoyed lines.
      v = [s.path, ...s.voices.flatMap((x) => [unitName(x.unit), x.kind, x.kind === "annoyed" ? "pissed" : "", kindName(x.kind)])].join("\n").toLowerCase();
      text.set(s, v);
    }
    return v;
  };
  return stock.sounds.filter((s) => words.every((w) => textOf(s).includes(w)));
}
