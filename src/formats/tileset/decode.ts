/**
 * StarCraft tileset graphics.
 *
 * A map's MTXM entry is only an index. Resolving it to pixels walks four files:
 *
 *   MTXM id ──(id >> 4)──▶ CV5 group ──(id & 15)──▶ VX4 megatile
 *   VX4 megatile ──▶ 16 minitile refs ──▶ VR4 8x8 palette-index bitmaps ──▶ WPE palette
 *
 * VF4 carries the per-minitile walkability/height flags the editor overlays.
 */

export const MINITILE_PX = 8;
export const MEGATILE_PX = 32;
/** Minitiles per megatile edge. */
export const MINITILES_PER_EDGE = 4;
const MINITILE_BYTES = MINITILE_PX * MINITILE_PX;
const CV5_ENTRY_BYTES = 52;
const CV5_MEGATILE_OFFSET = 20;
const MEGATILES_PER_GROUP = 16;

export interface Cv5Group {
  /** Doodad groups store 1 here; terrain groups store a group type. */
  index: number;
  /** The full u16 flag word; see GroupFlag. */
  flags: number;
  /** Low byte of `flags`: walkability, creep and the unbuildable bit. */
  buildability: number;
  /** High byte of `flags`: view-blocking and the ground-height bits. */
  groundHeight: number;
  /**
   * ISOM link on each side: values up to 48 are "soft" links shared with whatever
   * terrain borders this piece, higher ones are "hard" links that pair pieces of the
   * same edge set. Flat ground has the same soft link on all four sides.
   */
  edges: { left: number; top: number; right: number; bottom: number };
  /**
   * How cliff pieces stack vertically: a group whose `top` equals the `bottom` of the
   * group above it continues that cliff face. Zero means nothing stacks that way.
   */
  stack: { left: number; top: number; right: number; bottom: number };
  /** VX4 megatile index for each of the 16 slots in the group. */
  megatiles: Uint16Array;
  /** Set on doodad groups (`index` 1), which store a different record in the edge/stack bytes. */
  doodad?: Cv5Doodad;
}

/**
 * What a doodad group stores where terrain groups keep their ISOM links. A doodad spans
 * one group per row: row `r` of the doodad whose first group is `g` is group `g + r`,
 * with column `c` in megatile slot `c` (so its MTXM id is `((g + r) << 4) | c`). Every
 * group of the doodad repeats the same `ddData`, `width` and `height`.
 */
export interface Cv5Doodad {
  /** sprites.dat id (DoodadFlag.SpriteOverlay) or units.dat id (DoodadFlag.UnitOverlay) drawn over the tiles. */
  overlay: number;
  /** 1-based `rez\stat_txt.tbl` index of the palette category ("Trees", "Cliff", …); 0 for the unlisted ones. */
  nameIndex: number;
  /** Index into `tileset\<name>\dddata.bin`, and what DD2 records store. */
  ddData: number;
  width: number;
  height: number;
}

/** Doodad groups mark themselves with this `index`. */
export const DOODAD_GROUP_INDEX = 1;

export interface Tileset {
  /** 256 RGBA entries, 4 bytes each. */
  palette: Uint8Array;
  /** VR4: `minitiles[i * 64 + n]` is a palette index. */
  minitiles: Uint8Array;
  /** VX4 refs, 16 per megatile: bit 0 is horizontal flip, the rest is the minitile index. */
  megatileRefs: Uint32Array;
  megatileCount: number;
  /** True when the source was .vx4ex (Remastered, 32-bit refs). */
  extended: boolean;
  /** VF4 flags, 16 per megatile. */
  megatileFlags: Uint16Array;
  groups: Cv5Group[];
}

export interface TilesetFiles {
  cv5: Uint8Array;
  vf4: Uint8Array;
  vr4: Uint8Array;
  /** Pass either the classic .vx4 or the Remastered .vx4ex. */
  vx4: Uint8Array;
  vx4Extended?: boolean;
  wpe: Uint8Array;
}

/** WPE is 256 entries of R,G,B,pad. Expanded to RGBA with a fully opaque alpha. */
export function decodePalette(wpe: Uint8Array): Uint8Array {
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const at = i * 4;
    out[at] = wpe[at] ?? 0;
    out[at + 1] = wpe[at + 1] ?? 0;
    out[at + 2] = wpe[at + 2] ?? 0;
    out[at + 3] = 255;
  }
  return out;
}

export function decodeCv5(cv5: Uint8Array): Cv5Group[] {
  const view = new DataView(cv5.buffer, cv5.byteOffset, cv5.byteLength);
  const count = Math.floor(cv5.length / CV5_ENTRY_BYTES);
  const groups: Cv5Group[] = Array.from({ length: count });

  for (let g = 0; g < count; g++) {
    const at = g * CV5_ENTRY_BYTES;
    const megatiles = new Uint16Array(MEGATILES_PER_GROUP);
    for (let m = 0; m < MEGATILES_PER_GROUP; m++) {
      megatiles[m] = view.getUint16(at + CV5_MEGATILE_OFFSET + m * 2, true);
    }
    const index = view.getUint16(at, true);
    groups[g] = {
      index,
      flags: view.getUint16(at + 2, true),
      buildability: cv5[at + 2],
      groundHeight: cv5[at + 3],
      edges: {
        left: view.getUint16(at + 4, true),
        top: view.getUint16(at + 6, true),
        right: view.getUint16(at + 8, true),
        bottom: view.getUint16(at + 10, true),
      },
      stack: {
        left: view.getUint16(at + 12, true),
        top: view.getUint16(at + 14, true),
        right: view.getUint16(at + 16, true),
        bottom: view.getUint16(at + 18, true),
      },
      megatiles,
    };
    if (index === DOODAD_GROUP_INDEX) {
      groups[g].doodad = {
        overlay: view.getUint16(at + 4, true),
        nameIndex: view.getUint16(at + 8, true),
        ddData: view.getUint16(at + 12, true),
        width: view.getUint16(at + 14, true),
        height: view.getUint16(at + 16, true),
      };
    }
  }
  return groups;
}

export function decodeMegatileRefs(vx4: Uint8Array, extended: boolean): Uint32Array {
  const view = new DataView(vx4.buffer, vx4.byteOffset, vx4.byteLength);
  const stride = extended ? 4 : 2;
  const count = Math.floor(vx4.length / stride);
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = extended ? view.getUint32(i * stride, true) : view.getUint16(i * stride, true);
  }
  return out;
}

export function decodeMegatileFlags(vf4: Uint8Array): Uint16Array {
  const view = new DataView(vf4.buffer, vf4.byteOffset, vf4.byteLength);
  const count = Math.floor(vf4.length / 2);
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getUint16(i * 2, true);
  return out;
}

/** A .vx4ex file is 64 bytes per megatile where .vx4 is 32; the caller usually knows which. */
export function loadTileset(files: TilesetFiles): Tileset {
  const extended = files.vx4Extended ?? false;
  const megatileRefs = decodeMegatileRefs(files.vx4, extended);
  return {
    palette: decodePalette(files.wpe),
    minitiles: files.vr4,
    megatileRefs,
    megatileCount: Math.floor(megatileRefs.length / 16),
    extended,
    megatileFlags: decodeMegatileFlags(files.vf4),
    groups: decodeCv5(files.cv5),
  };
}

/** Resolve an MTXM tile id to a VX4 megatile index, or -1 when the id is out of range. */
export function megatileForTile(tileset: Tileset, tileId: number): number {
  const group = tileset.groups[tileId >> 4];
  if (!group) return -1;
  const megatile = group.megatiles[tileId & 0xf];
  return megatile < tileset.megatileCount ? megatile : -1;
}

/**
 * Paint one 32x32 megatile as RGBA into `dest` at (dx, dy) of a `destWidth`-pixel row.
 * Works on a plain array, so it is equally usable against ImageData in the browser and
 * a bare buffer in tests. `palette` defaults to the tileset's own; colour cycling passes
 * a rotated copy (see cycle.ts).
 */
export function drawMegatile(
  tileset: Tileset,
  megatile: number,
  dest: Uint8ClampedArray | Uint8Array,
  destWidth: number,
  dx: number,
  dy: number,
  palette: Uint8Array = tileset.palette,
) {
  const { megatileRefs, minitiles } = tileset;
  const base = megatile * 16;

  for (let my = 0; my < MINITILES_PER_EDGE; my++) {
    for (let mx = 0; mx < MINITILES_PER_EDGE; mx++) {
      const ref = megatileRefs[base + my * MINITILES_PER_EDGE + mx] ?? 0;
      const flipped = (ref & 1) === 1;
      const src = (ref >>> 1) * MINITILE_BYTES;

      for (let y = 0; y < MINITILE_PX; y++) {
        const row = src + y * MINITILE_PX;
        let out = ((dy + my * MINITILE_PX + y) * destWidth + dx + mx * MINITILE_PX) * 4;
        for (let x = 0; x < MINITILE_PX; x++) {
          const colour = (minitiles[row + (flipped ? MINITILE_PX - 1 - x : x)] ?? 0) * 4;
          dest[out] = palette[colour];
          dest[out + 1] = palette[colour + 1];
          dest[out + 2] = palette[colour + 2];
          dest[out + 3] = 255;
          out += 4;
        }
      }
    }
  }
}

/* ── CV5 group flags ─────────────────────────────────────── */

/** Per-group flags; the walk/height bits are overridden per minitile by VF4. */
export const GroupFlag = {
  Walkable: 0x0001,
  Unwalkable: 0x0004,
  HasDoodadCover: 0x0010,
  Creep: 0x0040,
  Unbuildable: 0x0080,
  BlocksView: 0x0100,
  MidGround: 0x0200,
  HighGround: 0x0400,
  Occupied: 0x0800,
  RecedingCreep: 0x1000,
  CliffEdge: 0x2000,
  TemporaryCreep: 0x4000,
  Startable: 0x8000,
} as const;

/**
 * The high bits of a doodad group's flag word, where terrain groups keep creep/cliff
 * bits. StarEdit copies the whole word into the overlay's THG2 record, which is how
 * `SpriteFlag.PureSprite` (0x1000) ends up set on doodad sprites.
 */
export const DoodadFlag = {
  /** `overlay` is a sprites.dat id, placed as a pure sprite. */
  SpriteOverlay: 0x1000,
  /** `overlay` is a units.dat id, placed as a unit sprite (Installation doors and traps). */
  UnitOverlay: 0x2000,
  /** The overlay is drawn mirrored. */
  OverlayFlipped: 0x4000,
} as const;

/** Ground height 0/1/2 a group is flagged with. */
export function groupHeight(group: Cv5Group): 0 | 1 | 2 {
  if (group.flags & GroupFlag.HighGround) return 2;
  if (group.flags & GroupFlag.MidGround) return 1;
  return 0;
}

export function groupBuildable(group: Cv5Group): boolean {
  return (group.flags & GroupFlag.Unbuildable) === 0;
}

/* ── VF4 flags ───────────────────────────────────────────── */

export const TileFlag = {
  Walkable: 0x0001,
  MidGround: 0x0002,
  HighGround: 0x0004,
  BlocksView: 0x0008,
  Ramp: 0x0010,
} as const;

/** Ground height 0/1/2 for a minitile, as the elevation overlay draws it. */
export function minitileHeight(tileset: Tileset, megatile: number, minitile: number): 0 | 1 | 2 {
  const flags = tileset.megatileFlags[megatile * 16 + minitile] ?? 0;
  if (flags & TileFlag.HighGround) return 2;
  if (flags & TileFlag.MidGround) return 1;
  return 0;
}
