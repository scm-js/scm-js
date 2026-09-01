/**
 * The trigger script as part of the map: its source and build manifest live as extra
 * archive members (`archiveExtrasAtom`), and the triggers it generated are a contiguous
 * *block* of `scenario.triggers` that the manifest points at.
 *
 * The block is identified by content, not just position: the manifest records the
 * block's start, length and a hash of its encoded records. `scriptBlock` looks for the
 * records at the recorded start and, failing that, anywhere in the list — so a hand
 * trigger inserted before the block in the Classic editor moves the block without
 * breaking it (`relocateScriptBlock` then rewrites the manifest). Only an edit *inside*
 * the block makes it stale, in which case the next Build appends a fresh block and the
 * old records are left as ordinary hand triggers.
 *
 * Building replaces the block wholesale and interns the script's strings; nothing here
 * is in the undo model (a Build is a settings-style transaction).
 */
import type { Scenario } from "../formats/chk/scenario";
import { cloneTrigger, encodeTriggers, type TriggerRecord } from "../formats/chk/sections/triggers";
import type { CompileResult } from "../script/compiler";
import { applyTriggers } from "./triggers";
import { internString } from "./settings";

export const SCRIPT_MEMBER = "scmjs\\triggers.ts";
export const MANIFEST_MEMBER = "scmjs\\triggers.json";

export interface ScriptManifest {
  version: 1;
  /** Index of the first generated trigger. */
  start: number;
  count: number;
  /** `hashTriggers` of the generated records. */
  hash: string;
  /** Per generated trigger, the 1-based source line of its `trigger(` call. */
  lines: number[];
  /** `hashText` of the source the block was built from; absent in older manifests. */
  sourceHash?: string;
}

export interface ScriptBlock {
  start: number;
  count: number;
  lines: number[];
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function member(extras: Map<string, Uint8Array>, name: string): Uint8Array | undefined {
  const key = name.toLowerCase();
  for (const [k, v] of extras) if (k.replace(/\//g, "\\").toLowerCase() === key) return v;
  return undefined;
}

function withMember(extras: Map<string, Uint8Array>, name: string, data: Uint8Array | null): Map<string, Uint8Array> {
  const next = new Map(extras);
  const key = name.toLowerCase();
  for (const k of next.keys()) if (k.replace(/\//g, "\\").toLowerCase() === key) next.delete(k);
  if (data) next.set(name, data);
  return next;
}

export function readScript(extras: Map<string, Uint8Array>): string | null {
  const bytes = member(extras, SCRIPT_MEMBER);
  return bytes ? decoder.decode(bytes) : null;
}

export function withScript(extras: Map<string, Uint8Array>, source: string | null): Map<string, Uint8Array> {
  return withMember(extras, SCRIPT_MEMBER, source === null ? null : encoder.encode(source));
}

export function readManifest(extras: Map<string, Uint8Array>): ScriptManifest | null {
  const bytes = member(extras, MANIFEST_MEMBER);
  if (!bytes) return null;
  try {
    const m = JSON.parse(decoder.decode(bytes)) as Partial<ScriptManifest>;
    if (m.version !== 1 || typeof m.start !== "number" || typeof m.count !== "number" || typeof m.hash !== "string") return null;
    return { version: 1, start: m.start, count: m.count, hash: m.hash, lines: Array.isArray(m.lines) ? m.lines : [], sourceHash: typeof m.sourceHash === "string" ? m.sourceHash : undefined };
  } catch {
    return null;
  }
}

export function withManifest(extras: Map<string, Uint8Array>, manifest: ScriptManifest | null): Map<string, Uint8Array> {
  return withMember(extras, MANIFEST_MEMBER, manifest ? encoder.encode(JSON.stringify(manifest)) : null);
}

function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** FNV-1a over the encoded records, prefixed with the count. */
export function hashTriggers(list: TriggerRecord[]): string {
  return `${list.length}:${fnv1a(encodeTriggers(list))}`;
}

export function hashText(text: string): string {
  return fnv1a(encoder.encode(text));
}

/** Where the manifest's block actually is in the list, or null when its records are gone. */
export function findBlock(list: TriggerRecord[], manifest: ScriptManifest): ScriptBlock | null {
  const { start, count } = manifest;
  const at = (s: number) => s >= 0 && s + count <= list.length && hashTriggers(list.slice(s, s + count)) === manifest.hash;
  if (at(start)) return { start, count, lines: manifest.lines };
  if (count === 0) return { start: Math.min(start, list.length), count, lines: manifest.lines };
  for (let s = 0; s + count <= list.length; s++) if (s !== start && at(s)) return { start: s, count, lines: manifest.lines };
  return null;
}

export interface ScriptState {
  source: string | null;
  manifest: ScriptManifest | null;
  /** The generated block, when the manifest's records are still in the list. */
  block: ScriptBlock | null;
  /** A manifest exists but its records were edited or removed. */
  stale: boolean;
  /** The source differs from what the block was built from (or was never built). */
  unbuilt: boolean;
}

export function scriptState(scn: Scenario | null, extras: Map<string, Uint8Array>): ScriptState {
  const source = readScript(extras);
  const manifest = readManifest(extras);
  const block = scn && manifest ? findBlock(scn.triggers, manifest) : null;
  const unbuilt = source !== null && (!manifest || manifest.sourceHash !== hashText(source));
  return { source, manifest, block, stale: !!manifest && !block, unbuilt };
}

export function isGenerated(state: ScriptState, index: number): boolean {
  return !!state.block && index >= state.block.start && index < state.block.start + state.block.count;
}

/** After another editor rewrote the list: point the manifest at where the block went. Null when nothing changed. */
export function relocateScriptBlock(scn: Scenario, extras: Map<string, Uint8Array>): Map<string, Uint8Array> | null {
  const manifest = readManifest(extras);
  if (!manifest) return null;
  const block = findBlock(scn.triggers, manifest);
  if (!block || block.start === manifest.start) return null;
  return withManifest(extras, { ...manifest, start: block.start });
}

/** The compiled records with their local string ids resolved against the scenario's string table. */
export function resolveStrings(scn: Scenario, compiled: CompileResult): TriggerRecord[] {
  const cache = new Map<number, number>();
  const resolve = (local: number): number => {
    if (local === 0) return 0;
    const hit = cache.get(local);
    if (hit !== undefined) return hit;
    const s = compiled.strings[local - 1];
    const index = !s ? 0 : "index" in s ? s.index : internString(scn, s.text);
    cache.set(local, index);
    return index;
  };
  return compiled.triggers.map((t) => {
    const next = cloneTrigger(t);
    for (const a of next.actions) {
      a.text = resolve(a.text);
      a.wav = resolve(a.wav);
    }
    return next;
  });
}

export interface BuildOptions {
  /** Replace the *whole* list with the script's triggers (ejecting every hand trigger into the block). */
  takeOver?: boolean;
}

/**
 * Install a successful compile: replace the current block (or append one) and write the
 * source and manifest. Returns the new extras and where the block landed.
 */
export function buildScript(scn: Scenario, extras: Map<string, Uint8Array>, source: string, compiled: CompileResult, options: BuildOptions = {}): { extras: Map<string, Uint8Array>; block: ScriptBlock } {
  const records = resolveStrings(scn, compiled);
  const state = scriptState(scn, extras);
  const list = scn.triggers;
  let start: number;
  let before: TriggerRecord[];
  let after: TriggerRecord[];
  if (options.takeOver) {
    start = 0; before = []; after = [];
  } else if (state.block) {
    start = state.block.start;
    before = list.slice(0, start);
    after = list.slice(start + state.block.count);
  } else {
    start = list.length; before = list.slice(); after = [];
  }
  applyTriggers(scn, [...before, ...records, ...after]);
  const manifest: ScriptManifest = { version: 1, start, count: records.length, hash: hashTriggers(records), lines: compiled.lines, sourceHash: hashText(source) };
  return { extras: withManifest(withScript(extras, source), manifest), block: { start, count: records.length, lines: manifest.lines } };
}

/** Which trigger a source line belongs to (the trigger whose call starts at or before the line), if any. */
export function triggerAtLine(block: ScriptBlock, line: number): number | null {
  let hit: number | null = null;
  block.lines.forEach((l, i) => { if (l <= line) hit = block.start + i; });
  return hit;
}
