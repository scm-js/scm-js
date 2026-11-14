/**
 * The Pieces view's layout: pieces of every size (two tiles to a dozen by ten) laid left to
 * right in shelves at one tile size, a new shelf when the next piece does not fit, a piece
 * wider than the panel scaled down to its width. Pure, so the windowing can find the shelves
 * on screen by their tops.
 */

export interface ShelfBox {
  /** Which item of the list this is. */
  index: number;
  x: number;
  y: number;
  /** Its drawn size in pixels, after any scaling. */
  w: number;
  h: number;
  /** The size of one tile in it, in pixels: the layout's tile size, or less for an oversize piece. */
  tile: number;
}

export interface Shelf {
  top: number;
  height: number;
  /** Its boxes, `boxes[first]` to `boxes[last]` inclusive. */
  first: number;
  last: number;
}

export interface ShelfLayout {
  boxes: ShelfBox[];
  shelves: Shelf[];
  height: number;
}

/**
 * Lay `sizes` (in tiles) out `width` pixels wide at `tile` pixels a tile with `gap` between
 * boxes and shelves. A piece wider than the width is drawn at the whole tile fraction that
 * fits, never under one pixel a tile.
 */
export function shelfLayout(sizes: readonly { cols: number; rows: number }[], width: number, tile: number, gap: number): ShelfLayout {
  const boxes: ShelfBox[] = [];
  const shelves: Shelf[] = [];
  let x = 0, top = 0, height = 0, first = 0;
  const close = () => {
    if (boxes.length > first) {
      shelves.push({ top, height, first, last: boxes.length - 1 });
      top += height + gap;
    }
    x = 0;
    height = 0;
    first = boxes.length;
  };
  sizes.forEach((s, index) => {
    const fit = s.cols * tile > width ? Math.max(1, Math.floor(width / s.cols)) : tile;
    const w = s.cols * fit, h = s.rows * fit;
    if (x > 0 && x + w > width) close();
    boxes.push({ index, x, y: top, w, h, tile: fit });
    x += w + gap;
    height = Math.max(height, h);
  });
  close();
  return { boxes, shelves, height: shelves.length ? top - gap : 0 };
}

/** The shelves that cross the band from `from` to `to` pixels down, as an inclusive range; empty when none. */
export function shelvesIn(layout: ShelfLayout, from: number, to: number): { first: number; last: number } {
  const { shelves } = layout;
  let lo = 0, hi = shelves.length - 1, first = shelves.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (shelves[mid].top + shelves[mid].height >= from) { first = mid; hi = mid - 1; } else lo = mid + 1;
  }
  let last = first - 1;
  while (last + 1 < shelves.length && shelves[last + 1].top <= to) last++;
  return { first, last };
}
