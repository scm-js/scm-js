/**
 * `scmjs map sounds <map>` and `scmjs map sounds export <map>`: the sounds a map carries, listed and written out as
 * files that play. The archive is read as the editor reads it (`readArchive`), and mopaq decodes the game's own
 * sound compression on the way (Huffman and IMA ADPCM sectors, as StarEdit stores a WAV), so what comes out is the
 * WAV file that went in; an Ogg is written as it is. The list is the WAV table's entries (the Sound Editor's) and any
 * other member that is audio by name or by its first bytes. A name in the table the archive does not hold is said,
 * not fatal: it may be one of the game's own sounds.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readArchive } from "../../src/editor/mapFile";
import { parseScenario } from "../../src/formats/chk/scenario";
import { soundList } from "../../src/editor/sounds";
import { parseWavHeader, wavDuration, wavFormatLabel } from "../../src/formats/wav";
import { fileFor } from "./archive";
import type { Input } from "./files";
import { CliError, dot, mark, num, pc, plural, size } from "./ui";

export type SoundState = "present" | "missing" | "unreadable";

export interface SoundEntry {
  /** The member's path in the archive (as the WAV table or the archive names it). */
  name: string;
  /** The WAV table's slot (0–511), or null for a member the table does not list. */
  slot: number | null;
  state: SoundState;
  /** `wav`, `ogg`, `mp3`, or null when the bytes are none of these. */
  type: "wav" | "ogg" | "mp3" | null;
  bytes: number;
  /** Length in seconds, when the header says. */
  seconds: number | null;
  /** `22050 Hz · 16-bit · mono`, for a WAV. */
  format: string | null;
  /** Trigger and briefing actions that play it. */
  usedBy: string[];
  /** A path under `sound\`: the game's own sound, which plays without a member in the map. */
  stock: boolean;
}

export interface SoundsReport { file: string; sounds: SoundEntry[]; problems: string[] }

const AUDIO_NAME = /\.(wav|ogg|mp3)$/i;
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** What audio the bytes are, from their first bytes. */
export function audioType(b: Uint8Array): SoundEntry["type"] {
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "wav";
  if (b.length >= 4 && ascii(b, 0, 4) === "OggS") return "ogg";
  if (b.length >= 3 && (ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0))) return "mp3";
  return null;
}

/**
 * An Ogg file's length: the last page's granule position over the stream's rate (Vorbis's identification header,
 * or Opus at 48 kHz less its pre-skip). Null when the bytes do not say.
 */
export function oggSeconds(b: Uint8Array): number | null {
  const head = ascii(b, 0, Math.min(b.length, 512));
  let rate = 0, skip = 0;
  const vorbis = head.indexOf("\x01vorbis");
  const opus = head.indexOf("OpusHead");
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (vorbis >= 0 && vorbis + 16 <= b.length) rate = view.getUint32(vorbis + 12, true);
  else if (opus >= 0 && opus + 12 <= b.length) { rate = 48000; skip = view.getUint16(opus + 10, true); }
  if (!rate) return null;
  for (let i = b.length - 27; i >= 0; i--) {
    if (b[i] !== 0x4f || ascii(b, i, 4) !== "OggS") continue;
    const granule = Number(view.getBigInt64(i + 6, true));
    return granule > 0 ? Math.max(0, granule - skip) / rate : null;
  }
  return null;
}

function describe(bytes: Uint8Array): Pick<SoundEntry, "type" | "seconds" | "format"> {
  const type = audioType(bytes);
  if (type === "wav") {
    const info = parseWavHeader(bytes);
    return { type, seconds: info ? wavDuration(info) : null, format: info ? wavFormatLabel(info) : null };
  }
  if (type === "ogg") return { type, seconds: oggSeconds(bytes), format: null };
  return { type, seconds: null, format: null };
}

const key = (name: string) => name.replace(/\//g, "\\").toLowerCase();

/** Every sound the map names or carries, with the bytes of those it carries. */
export async function readSounds(input: Input): Promise<{ report: SoundsReport; data: Map<string, Uint8Array> }> {
  let archive;
  try {
    archive = await readArchive(input.bytes);
  } catch (e) {
    throw new CliError(`${input.name} is not a map this can read: ${e instanceof Error ? e.message : e}`);
  }
  const scn = parseScenario(archive.chk);
  const unreadable = new Set((archive.stored?.unreadable ?? []).map(key));
  const sounds: SoundEntry[] = [];
  const data = new Map<string, Uint8Array>();
  const listed = new Set<string>();
  for (const row of soundList(scn, archive.extras)) {
    listed.add(key(row.path));
    const stock = /^sound\\/i.test(row.path.replace(/\//g, "\\"));
    if (!row.member) {
      sounds.push({ name: row.path, slot: row.slot, state: unreadable.has(key(row.path)) ? "unreadable" : "missing", type: null, bytes: 0, seconds: null, format: null, usedBy: row.usedBy, stock });
      continue;
    }
    const bytes = archive.extras.get(row.member)!;
    data.set(row.member, bytes);
    sounds.push({ name: row.member, slot: row.slot, state: "present", ...describe(bytes), bytes: bytes.length, usedBy: row.usedBy, stock });
  }
  // Members the table does not list that are sounds by name or by their bytes.
  for (const [name, bytes] of [...archive.extras].sort(([a], [b]) => a.localeCompare(b))) {
    if (listed.has(key(name)) || (!AUDIO_NAME.test(name) && !audioType(bytes))) continue;
    data.set(name, bytes);
    sounds.push({ name, slot: null, state: "present", ...describe(bytes), bytes: bytes.length, usedBy: [], stock: false });
  }
  return { report: { file: input.name, sounds, problems: archive.problems }, data };
}

export interface ExportedSound extends SoundEntry { file: string | null }
export interface SoundsExport { file: string; dir: string | null; sounds: ExportedSound[]; written: number; bytes: number; problems: string[] }

/** The file name a member is written as: its base name made safe, with the extension its bytes call for. */
export function soundFileName(member: string, type: SoundEntry["type"]): string {
  const base = fileFor(member.split(/[\\/]/).pop() || "sound");
  return type && !new RegExp(`\\.${type}$`, "i").test(base) ? `${base}.${type}` : base;
}

/** The sounds into `dir` (made when there is one to write). Two members with one base name get `-2`, `-3`… */
export async function exportSounds(input: Input, dir: string): Promise<SoundsExport> {
  const { report, data } = await readSounds(input);
  const out = resolve(dir);
  const taken = new Set<string>();
  const sounds: ExportedSound[] = [];
  let written = 0, bytes = 0;
  for (const s of report.sounds) {
    const member = data.get(s.name);
    if (!member) { sounds.push({ ...s, file: null }); continue; }
    let name = soundFileName(s.name, s.type);
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = soundFileName(s.name, s.type).replace(/(\.[^.]*)?$/, (ext) => `-${n}${ext}`);
    taken.add(name.toLowerCase());
    const path = join(out, name);
    try {
      if (!written) await mkdir(out, { recursive: true });
      await writeFile(path, member);
    } catch (e) {
      throw new CliError(`${path} could not be written (${(e as NodeJS.ErrnoException).code ?? e})`);
    }
    written++; bytes += member.length;
    sounds.push({ ...s, file: path });
  }
  return { file: input.name, dir: written ? out : null, sounds, written, bytes, problems: report.problems };
}

/** `0:03.4`-style, short sounds in tenths. */
export const seconds = (s: number | null) => (s === null ? "" : s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(0).padStart(2, "0")}`);

function why(s: SoundEntry): string {
  if (s.state === "unreadable") return pc.yellow("in the archive, but could not be read");
  if (s.stock) return pc.dim("the game's own sound; not in the map");
  return pc.yellow("not in the archive");
}

/** The list's lines: one a sound, its slot, length, format, size, and what plays it. */
export function printSounds(r: SoundsReport | SoundsExport, shown: (s: SoundEntry & { file?: string | null }) => string = (s) => s.name): string[] {
  const present = r.sounds.filter((s) => s.state === "present");
  const total = present.reduce((n, s) => n + s.bytes, 0);
  const head = `${pc.bold(r.file)}${dot}${r.sounds.length ? `${plural(present.length, "sound")}${present.length ? `, ${size(total)}` : ""}` : "no sounds"}`;
  const width = Math.max(0, ...r.sounds.map((s) => shown(s).length));
  const lines = [head, ...r.sounds.map((s) => {
    const slot = pc.dim((s.slot === null ? "  -" : String(s.slot + 1).padStart(3)));
    if (s.state !== "present") return `  ${slot}  ${shown(s).padEnd(width)}  ${why(s)}`;
    const facts = [seconds(s.seconds), s.format ?? (s.type ? s.type.toUpperCase() : "not audio"), size(s.bytes)].filter(Boolean).join(dot);
    const used = s.usedBy.length ? pc.dim(`  ${s.usedBy.length === 1 ? s.usedBy[0] : `${num(s.usedBy.length)} actions`}`) : "";
    return `  ${slot}  ${shown(s).padEnd(width)}  ${facts}${used}`;
  })];
  return [...lines, ...r.problems.map((p) => `${mark.warn} ${p}`)];
}
