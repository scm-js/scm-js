/**
 * Where the resources of a base go: the Melee Wizard plugin's rules (scmjs-plugin-melee-wizard 1.1.0, `layout.ts`,
 * MIT, by the same authors), copied here because a plugin is not part of the command's bundle. Only the base layout is
 * taken; the wizard's own symmetry is not, since `map generate` mirrors whole bases itself.
 *
 * Units of measure: a *tile* is 32 map pixels. Rectangles are in tiles with an exclusive far edge; unit positions are
 * the pixel centres of those rectangles, which is what a UNIT record stores.
 *
 * The one rule everything else follows: the game refuses a resource depot within three tiles of a mineral field or
 * geyser — the *gap*, measured as the larger of the empty columns and the empty rows between the two footprints
 * (Chebyshev) — and mining is fastest when the gap is exactly that. So a mineral line is a set of 2 × 1 patches on the
 * ring of positions whose gap to the town hall's 4 × 3 footprint is exactly three, spread around a direction, wrapping
 * round the hall's corners the way the lines on Blizzard's own maps do; the geyser is a 4 × 2 box on the same ring,
 * just past one end of the line.
 */

export const TILE = 32;

export interface Size { w: number; h: number }

/** A footprint in tiles, far edges exclusive. */
export interface TileRect { x: number; y: number; w: number; h: number }

/** units.dat placement boxes, in tiles. */
export const HALL: Size = { w: 4, h: 3 };
export const MINERAL: Size = { w: 2, h: 1 };
export const GEYSER: Size = { w: 4, h: 2 };

export function overlaps(a: TileRect, b: TileRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The gap between two footprints as the game measures it for resource placement; -1 when they overlap. */
export function chebGap(a: TileRect, b: TileRect): number {
  const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (gx < 0 && gy < 0) return -1;
  return Math.max(gx, gy);
}

/** The pixel centre of a footprint: what a UNIT record stores for it. */
export function centreOf(r: TileRect): { x: number; y: number } {
  return { x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2) * TILE };
}

/** The signed difference `a - b` folded into (-π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d <= -Math.PI) d += Math.PI * 2;
  while (d > Math.PI) d -= Math.PI * 2;
  return d;
}

/** The direction from a hall's centre to a footprint's centre. Screen coordinates: 0 is east, π/2 south. */
export function angleOf(hall: TileRect, r: TileRect): number {
  const h = centreOf(hall), c = centreOf(r);
  return Math.atan2(c.y - h.y, c.x - h.x);
}

/** Every tile position of a `size` box whose gap to `hall` is exactly `gap`, in order of angle around the hall's centre. */
export function ringPositions(hall: TileRect, size: Size, gap: number): TileRect[] {
  const out: TileRect[] = [];
  for (let y = hall.y - gap - size.h; y <= hall.y + hall.h + gap; y++) {
    for (let x = hall.x - gap - size.w; x <= hall.x + hall.w + gap; x++) {
      const r = { x, y, w: size.w, h: size.h };
      if (chebGap(r, hall) === gap) out.push(r);
    }
  }
  return out.sort((a, b) => angleOf(hall, a) - angleOf(hall, b));
}

export interface BaseSpec {
  minerals: number;
  /** 0, 1 or 2. */
  geysers: number;
  /** Where the line goes, from the hall's centre; screen angle, 0 east, π/2 south. */
  direction: number;
  /** Which ring positions a patch or geyser may take; every position when omitted. */
  fits?: (rect: TileRect) => boolean;
}

export interface BaseLayout {
  hall: TileRect;
  /** In line order, from one end to the other. */
  minerals: TileRect[];
  geysers: TileRect[];
  /** What the ring had no room for. */
  short: { minerals: number; geysers: number };
}

/** The wizard's defaults: the patches three tiles from the hall, the geyser too, a tile kept between it and the line. */
const GAP = 3, GEYSER_GAP = 3, GEYSER_SPACING = 1;

/**
 * Lay a base out around a hall footprint. Patches go on the ring at the gap, starting with the position nearest the
 * direction and growing along the ring to either side, always taking the side that keeps the line centred on the
 * direction; the line wraps round a corner on its own. A geyser then goes on its ring past the nearer end of the line,
 * keeping a tile from every patch; two geysers take one end each. Positions `fits` refuses are not on the ring at all,
 * so the line closes over them.
 */
export function layoutBase(hall: TileRect, spec: BaseSpec): BaseLayout {
  const fits = spec.fits ?? (() => true);
  const ring = ringPositions(hall, MINERAL, GAP).filter(fits);
  const n = ring.length;
  const minerals: TileRect[] = [];
  const short = { minerals: 0, geysers: 0 };
  let leftEnd = spec.direction, rightEnd = spec.direction;
  if (n > 0 && spec.minerals > 0) {
    const angles = ring.map((r) => angleOf(hall, r));
    let i0 = 0;
    for (let i = 1; i < n; i++) if (Math.abs(angleDiff(angles[i], spec.direction)) < Math.abs(angleDiff(angles[i0], spec.direction))) i0 = i;
    const used = new Set<number>([i0]);
    minerals.push(ring[i0]);
    const free = (i: number) => minerals.every((m) => !overlaps(m, ring[i]));
    let left = i0, right = i0;
    const nextLeft = () => { for (let k = 1; k < n; k++) { const i = (left - k + n) % n; if (used.has(i)) return -1; if (free(i)) return i; } return -1; };
    const nextRight = () => { for (let k = 1; k < n; k++) { const i = (right + k) % n; if (used.has(i)) return -1; if (free(i)) return i; } return -1; };
    while (minerals.length < spec.minerals) {
      const l = nextLeft(), r = nextRight();
      if (l < 0 && r < 0) break;
      const dl = l < 0 ? Infinity : Math.abs(angleDiff(angles[l], spec.direction));
      const dr = r < 0 ? Infinity : Math.abs(angleDiff(angles[r], spec.direction));
      if (dl <= dr) { minerals.unshift(ring[l]); used.add(l); left = l; } else { minerals.push(ring[r]); used.add(r); right = r; }
    }
    short.minerals = spec.minerals - minerals.length;
    leftEnd = angles[left];
    rightEnd = angles[right];
  } else {
    short.minerals = spec.minerals;
  }

  const geysers: TileRect[] = [];
  if (spec.geysers > 0) {
    const gring = ringPositions(hall, GEYSER, GEYSER_GAP).filter(fits);
    const clear = (g: TileRect) => minerals.every((m) => chebGap(m, g) >= GEYSER_SPACING) && geysers.every((o) => chebGap(o, g) >= 1);
    const pastEnd = (side: "left" | "right"): TileRect | null => {
      let best: TileRect | null = null, bestD = Infinity;
      for (const g of gring) {
        if (!clear(g)) continue;
        const d = side === "left" ? -angleDiff(angleOf(hall, g), leftEnd) : angleDiff(angleOf(hall, g), rightEnd);
        if (d < 0) continue;
        if (d < bestD) { bestD = d; best = g; }
      }
      return best;
    };
    if (spec.geysers === 1) {
      const l = pastEnd("left"), r = pastEnd("right");
      const dl = l ? Math.abs(angleDiff(angleOf(hall, l), spec.direction)) : Infinity;
      const dr = r ? Math.abs(angleDiff(angleOf(hall, r), spec.direction)) : Infinity;
      const pick = dl < dr ? l : r;
      if (pick) geysers.push(pick);
    } else {
      for (const side of ["left", "right"] as const) { const g = pastEnd(side); if (g) geysers.push(g); }
    }
    short.geysers = spec.geysers - geysers.length;
  }
  return { hall, minerals, geysers, short };
}

/** units.dat ids of the three mineral field types. */
export const MINERAL_FIELDS = [176, 177, 178] as const;

/** A number fixed by a tile, spread evenly over the tiles around it. */
function tileNoise(x: number, y: number): number {
  const h = Math.imul((x * 73856093) ^ (y * 19349663), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * The mineral types along a line of patches, in order: each patch takes its type from its own tile, never the type of
 * the patch beside it — the mix of Blizzard's own maps, and the same line every time. The three mine alike.
 */
export function mineralLooks(rects: readonly TileRect[]): number[] {
  const all = MINERAL_FIELDS as readonly number[];
  let prev = -1;
  return rects.map((rect) => {
    const others = all.filter((id) => id !== prev);
    prev = others[tileNoise(rect.x, rect.y) % others.length];
    return prev;
  });
}
