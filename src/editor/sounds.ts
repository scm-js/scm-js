/**
 * The Sound Editor's view of a map's sounds: the WAV table (`scn.wavs`, 512 string indices
 * of archive paths) joined with the archive members that actually hold the bytes
 * (`archiveExtrasAtom`). Play WAV / Transmission actions store the *string index*, so a
 * sound is "used" when a trigger's `wav` field equals its string.
 */
import { markDirty, type Scenario } from "../formats/chk/scenario";
import { getString } from "../formats/chk/sections/strings";
import { defaultWavs, WAV_SLOTS } from "../formats/chk/sections/sounds";
import { actionStrings } from "./triggers";
import type { TriggerRecord } from "../formats/chk/sections/triggers";
import { internString } from "./settings";

export type Extras = ReadonlyMap<string, Uint8Array>;

export interface SoundRow {
  slot: number;
  stringIndex: number;
  /** The path as the string table has it. */
  path: string;
  /** Whether the archive carries a member at that path. */
  present: boolean;
  /** Bytes in the archive, 0 when absent. */
  size: number;
  /** The archive member's name as stored (case may differ from the path). */
  member: string | null;
  usedBy: string[];
}

/** Archive member names compare case-insensitively with either slash. */
export function normalizeMember(name: string): string {
  return name.replace(/\//g, "\\").toLowerCase();
}

/** The stored key of the member at `path`, or null. */
export function findMember(extras: Extras, path: string): string | null {
  const key = normalizeMember(path);
  for (const name of extras.keys()) if (normalizeMember(name) === key) return name;
  return null;
}

/** Where StarEdit keeps imported sounds. */
export function wavMemberName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return `staredit\\wav\\${base}`;
}

/** Labels of the trigger / briefing actions that play the string at `stringIndex`. */
export function wavUsage(scn: Scenario, stringIndex: number): string[] {
  const out: string[] = [];
  const scan = (noun: string, list: TriggerRecord[], briefing: boolean) => {
    list.forEach((t, i) => {
      for (const a of t.actions) for (const s of actionStrings(a, briefing)) if (s.kind === "wav" && s.index === stringIndex) out.push(`${noun} ${i + 1}: ${s.action}`);
    });
  };
  scan("Trigger", scn.triggers, false);
  scan("Briefing", scn.briefing, true);
  return out;
}

export function readWavs(scn: Scenario): number[] {
  return scn.wavs ? scn.wavs.slice() : defaultWavs();
}

/** The table's filled slots, in slot order. */
export function soundList(scn: Scenario, extras: Extras, wavs: readonly number[] = scn.wavs ?? []): SoundRow[] {
  const out: SoundRow[] = [];
  wavs.forEach((stringIndex, slot) => {
    if (stringIndex === 0) return;
    const path = getString(scn.strings, stringIndex) ?? "";
    const member = path ? findMember(extras, path) : null;
    out.push({ slot, stringIndex, path, present: member !== null, size: member ? extras.get(member)!.length : 0, member, usedBy: wavUsage(scn, stringIndex) });
  });
  return out;
}

const SOUND_EXT = /\.(wav|ogg)$/i;

/** Archive members that look like sounds but are in no WAV slot. */
export function orphanSounds(scn: Scenario, extras: Extras, wavs: readonly number[] = scn.wavs ?? []): string[] {
  const listed = new Set(wavs.filter((i) => i !== 0).map((i) => normalizeMember(getString(scn.strings, i) ?? "")));
  return [...extras.keys()].filter((name) => SOUND_EXT.test(name) && !listed.has(normalizeMember(name))).sort();
}

/** The slot holding `path` (by string, then by normalised text), or -1. */
export function slotOf(scn: Scenario, wavs: readonly number[], path: string): number {
  const key = normalizeMember(path);
  return wavs.findIndex((i) => i !== 0 && normalizeMember(getString(scn.strings, i) ?? "") === key);
}

/**
 * Put `path` in the first free slot (interning the string, which may append to the
 * table). Returns the slot, the existing one when the path is already listed, or -1
 * when all 512 are taken. `wavs` is edited in place.
 */
export function addSound(scn: Scenario, wavs: number[], path: string): number {
  const existing = slotOf(scn, wavs, path);
  if (existing >= 0) return existing;
  const slot = wavs.findIndex((i) => i === 0);
  if (slot < 0) return -1;
  wavs[slot] = internString(scn, path);
  return slot;
}

/** A copy of the table with `slot` cleared. */
export function removeSound(wavs: readonly number[], slot: number): number[] {
  const next = wavs.slice();
  if (slot >= 0 && slot < next.length) next[slot] = 0;
  return next;
}

/** Install an edited table, creating the section when the file had none. Marks WAV dirty only on a change. */
export function applySounds(scn: Scenario, wavs: readonly number[]): boolean {
  const next = Array.from({ length: WAV_SLOTS }, (_, i) => wavs[i] ?? 0);
  if (scn.wavs && scn.wavs.length === WAV_SLOTS && scn.wavs.every((v, i) => v === next[i])) return false;
  scn.wavs = next;
  markDirty(scn, "WAV ");
  return true;
}

/** Total bytes of the archive's sound members. */
export function soundBytes(extras: Extras): number {
  let n = 0;
  for (const [name, data] of extras) if (SOUND_EXT.test(name)) n += data.length;
  return n;
}
