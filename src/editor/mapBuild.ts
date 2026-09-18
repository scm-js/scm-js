/**
 * A built map: what a build step (a plugin's compiler — eudplib is the case) made of the map
 * on its way to the disk, with the map as the editor holds it kept inside the same file.
 *
 * The file the game reads is the step's output: `staredit\scenario.chk` is the built
 * scenario. Next to it sit two members the game never looks at — `scmjs\source.chk`, the
 * scenario exactly as Save would have written it without the step, and `scmjs\build.json`,
 * which names the steps, the members they added and the SHA-256 of the built scenario. On
 * open, a file whose scenario still has that hash gives back the source, so the editor shows
 * the map the user was editing and not the step's output; one whose scenario has changed
 * since (another editor, a protector) opens as it is, with a warning, and keeps both members.
 *
 * Pure: no store, no DOM. `services/mapBuild.ts` runs the steps; this file packs and unpacks.
 */
import { loadMap, readMembers, requiredSectorSize, saveMap, STAREDIT_SECTOR_SIZE, type StoredMembers } from "../formats/mpq/scm";
import type { SaveOptions } from "./save";

/** The archive folder the editor keeps its own members in. */
export const BUILD_FOLDER = "scmjs\\";
export const BUILD_SOURCE_MEMBER = `${BUILD_FOLDER}source.chk`;
export const BUILD_MANIFEST_MEMBER = `${BUILD_FOLDER}build.json`;

/** A step as the manifest remembers it. */
export interface BuiltBy {
  /** `plugin id/step id`. */
  id: string;
  /** The step's label when it ran, for a notice about a step that is no longer there. */
  label: string;
}

export interface BuildManifest {
  version: 1;
  /** SHA-256 of `staredit\scenario.chk` as written, lower-case hex. */
  chk: string;
  steps: BuiltBy[];
  /** Members the steps added to the archive; they belong to the built file, not to the map. */
  added: string[];
}

const normalize = (name: string) => name.replace(/\//g, "\\").toLowerCase();
const isBuildMember = (name: string) => normalize(name).startsWith(BUILD_FOLDER);

const K = new Uint32Array(64);
{
  // The round constants: the fractional parts of the cube roots of the first 64 primes.
  let n = 0;
  for (let p = 2; n < 64; p++) {
    let prime = true;
    for (let d = 2; d * d <= p; d++) if (p % d === 0) { prime = false; break; }
    if (prime) K[n++] = (Math.cbrt(p) % 1) * 0x100000000;
  }
}

/**
 * SHA-256, lower-case hex. Written out rather than `crypto.subtle`, which a page served over
 * plain http (the container image on a LAN address) does not have — and a built map has to
 * open there too. A scenario is a few megabytes at most.
 */
export function sha256Hex(bytes: Uint8Array): string {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(padded.length - 4, (bytes.length << 3) >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let at = 0; at < padded.length; at += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(at + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return [...h].map((x) => x.toString(16).padStart(8, "0")).join("");
}

export interface PackInput {
  /** The scenario as Save would write it without the steps. */
  sourceChk: Uint8Array;
  /** The archive members Save keeps, and the ones it carries as stored. */
  extras: Map<string, Uint8Array>;
  stored: StoredMembers | null;
  /** The last step's output: an archive, or a bare scenario. */
  built: Uint8Array;
  steps: BuiltBy[];
  options: Pick<SaveOptions, "compression" | "encrypt">;
}

/**
 * The file that goes to the disk: the built scenario in an archive laid out by the user's
 * save options, the map's own members as they were (a step can add a member, not change
 * one), and the source beside it.
 */
export async function packBuiltMap(input: PackInput): Promise<Uint8Array> {
  const out = await loadMap(input.built);
  const members = new Map<string, Uint8Array>();
  for (const [name, data] of input.extras) if (!isBuildMember(name)) members.set(name, data);
  const have = new Set([...members.keys()].map(normalize));
  const added: string[] = [];
  if (out.archive) {
    for (const [name, data] of (await readMembers(out.archive, out.files)).extras) {
      if (have.has(normalize(name)) || isBuildMember(name)) continue;
      members.set(name, data);
      added.push(name);
    }
  }
  const manifest: BuildManifest = { version: 1, chk: sha256Hex(out.chk), steps: input.steps, added };
  const { compression, encrypt } = input.options;
  return saveMap(out.chk, {
    extras: members,
    editorMembers: new Map([
      [BUILD_SOURCE_MEMBER, input.sourceChk],
      [BUILD_MANIFEST_MEMBER, new TextEncoder().encode(JSON.stringify(manifest))],
    ]),
    stored: input.stored,
    compress: compression,
    encrypt,
    sectorSize: requiredSectorSize(input.stored, compression === "zlib" ? 0x10000 : STAREDIT_SECTOR_SIZE),
  });
}

export function readBuildManifest(bytes: Uint8Array): BuildManifest | null {
  try {
    const m = JSON.parse(new TextDecoder().decode(bytes)) as Partial<BuildManifest>;
    if (m.version !== 1 || typeof m.chk !== "string" || !Array.isArray(m.steps) || !Array.isArray(m.added)) return null;
    const steps = m.steps.filter((s): s is BuiltBy => !!s && typeof s.id === "string" && typeof s.label === "string");
    return { version: 1, chk: m.chk, steps, added: m.added.filter((n): n is string => typeof n === "string") };
  } catch {
    return null;
  }
}

export type Restored =
  /** Not a built map. */
  | { kind: "plain" }
  /** The source, with the editor's members and the steps' additions taken out of `extras`. */
  | { kind: "restored"; chk: Uint8Array; extras: Map<string, Uint8Array>; builtBy: BuiltBy[] }
  /** A built map whose scenario is no longer the one the steps wrote; nothing is taken out. */
  | { kind: "changed"; builtBy: BuiltBy[] };

/** What an opened archive's scenario and members say about a build. */
export async function restoreBuiltMap(chk: Uint8Array, extras: ReadonlyMap<string, Uint8Array>): Promise<Restored> {
  let source: Uint8Array | null = null;
  let manifest: BuildManifest | null = null;
  for (const [name, data] of extras) {
    if (normalize(name) === BUILD_SOURCE_MEMBER) source = data;
    else if (normalize(name) === BUILD_MANIFEST_MEMBER) manifest = readBuildManifest(data);
  }
  if (!source || !manifest) return { kind: "plain" };
  if (sha256Hex(chk) !== manifest.chk) return { kind: "changed", builtBy: manifest.steps };
  const drop = new Set(manifest.added.map(normalize));
  const rest = new Map<string, Uint8Array>();
  for (const [name, data] of extras) if (!isBuildMember(name) && !drop.has(normalize(name))) rest.set(name, data);
  return { kind: "restored", chk: source, extras: rest, builtBy: manifest.steps };
}
