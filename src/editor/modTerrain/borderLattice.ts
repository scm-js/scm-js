/**
 * Drawn borders (`borderTable.ts`, `borderPass.ts`): where on a map a border between two terrains runs, and which
 * rect pattern (shape) each border cell is, read the way the game's own isometric brush would lay it.
 *
 * The diamond lattice is read off a map's cells (`diamondsOf`: a diamond is X when the cells around its centre lean
 * X), then laid with the game's brush on a **stand-in** pair of the game's own terrains (`standInShapes`): every rect the
 * stand-in lays an edge tile on is a border cell, and the stand-in's edge-set pattern there (its four side links, the
 * soft ones named A for the ground and B for the patch, with the stack values) and the tile's side (left or right of
 * the rect) is the cell's shape. Only the pattern is used, never the stand-in's pictures. The stand-in
 * is a flat/flat set for two terrains at one height, a cliff set when the patch is higher or lower than the ground.
 *
 * The stand-in's tileset is handed in (`StandIns`): in the editor the game's own Badlands beneath the data set in use
 * (`badlandsStandIns`), in a test one made from the brush's own shape definitions. Shape keys are the stand-in's, so a
 * table learned with one is laid with the same one. Pure; `tests/borders.test.ts`.
 */
import { createScenario } from "../../formats/chk/create";
import type { Scenario } from "../../formats/chk/scenario";
import type { Cv5Group, Tileset } from "../../formats/tileset/decode";
import { flatTerrain } from "../../formats/tileset/terrain";
import { ISOM_TABLES } from "../../data/isomTables";
import { isDiamond, paintIsomDiamonds, type Diamond } from "../isom";

/** Cell classes for a pair: the patch's terrain (X), the ground around (Y), a transition piece (T), anything else. */
export const C_O = 0, C_X = 1, C_Y = 2, C_T = 3;

/** How transition cells count when the lattice is read: as neither terrain, or as the ground. */
export type BorderMode = "neutral" | "asY";
export const BORDER_MODES: readonly BorderMode[] = ["neutral", "asY"];

const SOFT = 48;
const SIDES = ["left", "top", "right", "bottom"] as const;

/** One stand-in pair: a tileset, its ERA numbering, the ground (Y) and patch (X) terrains' CV5 index and the edge set's. */
export interface StandIn { ts: Tileset; era: number; y: number; x: number; set: number }

/** The three stand-ins: X and Y at one height, X higher, X lower. */
export interface StandIns { flat: StandIn; up: StandIn; down: StandIn }

/**
 * The game's Badlands as the stand-in: Grass on Dirt (a flat/flat set), High Dirt on Dirt and Dirt on High Dirt (the
 * cliff set). Indices are the game's Badlands CV5 terrain types, named in `data/isomTables.ts`.
 */
export const BADLANDS_STANDIN = { era: 0, dirt: 2, highDirt: 3, grass: 6, grassDirt: 20, dirtHighDirt: 34 } as const;
export function badlandsStandIns(ts: Tileset): StandIns {
  const b = BADLANDS_STANDIN;
  return {
    flat: { ts, era: b.era, y: b.dirt, x: b.grass, set: b.grassDirt },
    up: { ts, era: b.era, y: b.dirt, x: b.highDirt, set: b.dirtHighDirt },
    down: { ts, era: b.era, y: b.highDirt, x: b.dirt, set: b.dirtHighDirt },
  };
}

interface Flats { flatGroup: Map<number, number>; softTo: Map<number, number> }
const flatsCache = new WeakMap<Tileset, Flats>();

/** A tileset's flat terrains: index → first even group, and soft link → terrain index. */
export function flatTerrainsOf(ts: Tileset, era: number): Flats {
  const was = flatsCache.get(ts);
  if (was) return was;
  const types = ISOM_TABLES[era % ISOM_TABLES.length].terrainTypes;
  const half = Math.floor(types.length / 2);
  const flat = new Set(types.filter((t, i) => i >= 1 && i <= half && t.isomValue !== 0).map((t) => t.index));
  const flatGroup = new Map<number, number>();
  const softTo = new Map<number, number>();
  for (let g = 0; g < Math.min(1024, ts.groups.length); g += 2) {
    const grp = ts.groups[g];
    if (!flat.has(grp.index) || flatGroup.has(grp.index)) continue;
    const e = grp.edges;
    if (e.left !== e.top || e.left !== e.right || e.left !== e.bottom || e.left > SOFT) continue;
    flatGroup.set(grp.index, g);
    softTo.set(e.left, grp.index);
  }
  const out = { flatGroup, softTo };
  flatsCache.set(ts, out);
  return out;
}

/** A rect's pattern: per side `A` (the ground's soft link), `B` (the patch's), `h<n>` a hard link, `s<n>` another soft link. */
export function patternKey(e: Cv5Group["edges"], softTo: Map<number, number>, ground: number, patch: number): string {
  return SIDES.map((s) => {
    const l = e[s];
    if (l > SOFT) return `h${l}`;
    const terr = softTo.get(l);
    return terr === ground ? "A" : terr === patch ? "B" : `s${l}`;
  }).join(",");
}

/**
 * Which diamonds are X: the diamond on the top-left corner of rect (dx, dy) — tile corner (2dx, dy) — is X when the
 * cells around its centre lean X. The 2 × 2 cells at the centre count double, the 4 × 2 box around once; transition
 * cells count as `mode` says.
 */
export function diamondsOf(cls: Uint8Array, w: number, h: number, mode: BorderMode): Diamond[] {
  const out: Diamond[] = [];
  const iw = Math.floor(w / 2) + 1, ih = h + 1;
  const v = (c: number) => (c === C_X ? 1 : c === C_Y ? -1 : c === C_T && mode === "asY" ? -1 : 0);
  for (let dy = 0; dy < ih; dy++) {
    for (let dx = dy & 1; dx < iw; dx += 2) {
      let s = 0;
      for (let ty = dy - 1; ty <= dy; ty++) {
        if (ty < 0 || ty >= h) continue;
        for (let tx = 2 * dx - 2; tx <= 2 * dx + 1; tx++) {
          if (tx < 0 || tx >= w) continue;
          s += v(cls[ty * w + tx]) * (tx === 2 * dx - 1 || tx === 2 * dx ? 2 : 1);
        }
      }
      if (s > 0) out.push({ x: dx, y: dy });
    }
  }
  return out;
}

/** A window of the map, lined up so a diamond keeps its parity: x a multiple of 4 tiles, y even. */
export interface Window { x0: number; y0: number; w: number; h: number }

/** One border cell as the stand-in lays it: its shape (`pattern|L` or `|R`) and whether it leans to the patch. */
export interface BorderShape { shape: string; leansX: boolean }

/** What the stand-in lays over a window: per cell its border shape (null where none) and whether it is the patch's ground. */
export interface StandInLaid { shapes: (BorderShape | null)[]; inner: Uint8Array }

/**
 * Lay the X `diamonds` (map lattice coordinates) with the stand-in's X on its Y over `win`, and answer, per cell of the
 * window, the shape the stand-in gives it (null where it lays no edge tile of its set) and whether it lays the patch's
 * own ground there (the brush may widen a patch: a cliff keeps a margin).
 */
export function standInShapes(si: StandIn, win: Window, diamonds: Iterable<Diamond>): StandInLaid {
  const { flatGroup, softTo } = flatTerrainsOf(si.ts, si.era);
  const fill = flatTerrain(win.w, win.h, { id: si.y, group: flatGroup.get(si.y) ?? 2 }, si.ts, () => 0, si.era);
  const scn = createScenario({ width: win.w, height: win.h, era: si.era, name: "stand-in", tiles: fill.tiles, isom: fill.isom }) as Scenario & { isom: Uint16Array };
  const local: Diamond[] = [];
  const iw = Math.floor(win.w / 2) + 1;
  for (const d of diamonds) {
    const x = d.x - win.x0 / 2, y = d.y - win.y0;
    if (x >= 0 && y >= 0 && x < iw && y <= win.h && isDiamond({ x, y })) local.push({ x, y });
  }
  if (local.length) paintIsomDiamonds(scn, si.ts, local, si.x, () => 0);
  const out: (BorderShape | null)[] = Array.from({ length: win.w * win.h }, () => null);
  const inner = new Uint8Array(win.w * win.h);
  for (let i = 0; i < scn.tiles.length; i++) {
    const g = (scn.tiles[i] >> 4) & 0x7ff;
    const grp = si.ts.groups[g];
    if (grp && grp.index === si.x) inner[i] = 1;
    if (!grp || grp.index !== si.set) continue;
    const even = si.ts.groups[g & ~1];
    const key = patternKey(even.edges, softTo, si.y, si.x);
    const stack = even.stack.top || even.stack.bottom ? `|s${even.stack.top}.${even.stack.bottom}` : "";
    const side = g & 1;
    // the cell's three soft sides (its own outer side, top, bottom): more of the patch's than the ground's leans X
    const k = key.split(",");
    const softs = (side === 0 ? [k[0], k[1], k[3]] : [k[2], k[1], k[3]]).filter((s) => s === "A" || s === "B");
    out[i] = { shape: `${key}${stack}|${side ? "R" : "L"}`, leansX: softs.filter((s) => s === "B").length > softs.filter((s) => s === "A").length };
  }
  return { shapes: out, inner };
}

/** Which stand-in a pair takes: by the heights of the patch's and the ground's tiles (`megatileHeight`, 0–2). */
export function standInFor(sis: StandIns, patchHeight: number, groundHeight: number): StandIn {
  return patchHeight === groundHeight ? sis.flat : patchHeight > groundHeight ? sis.up : sis.down;
}
