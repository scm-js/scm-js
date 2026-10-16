/**
 * The pictures of `docs/chk-format.md` (the trigger record is in `docs/triggers.md` too), drawn as SVG from the same tables the page states
 * in words, so a picture cannot say something the text does not. `npm run docs:reference`
 * writes them to `docs/images/`, and `tests/chkReference.test.ts` fails when one on disk
 * differs from what this module draws.
 *
 * The shapes (`ISOM_SHAPES`) are StarEdit's fourteen edge pieces as the isometric brush
 * uses them; the test holds them to Blizzard's maps (the neighbours each shape claims) and
 * the worked example to what the brush paints.
 */

import { LAYOUTS, laidOut, layoutSize } from "./chk-reference.mjs";
import { ACTION_FIELDS, CONDITION_FIELDS } from "./trigger-reference.mjs";
import { GAME_COPIES, GAME_NEVER, GAME_READS, REMASTERED_ONLY, gameUse } from "./chk-game.mjs";

/* ── Colours: one dark card, readable on a light page and on the documentation site ── */

const INK = "#e6e8ee";
const MUTED = "#9aa3b2";
const CARD = "#12151b";
const TILE_LINE = "#262b36";
const RECT_LINE = "#4b5363";
const OUTSIDE = "#3f6aa6";
const INSIDE = "#c9963c";
const EDGE_LINE = "#0a0c10";
const GOLD = "#e7c160";
/** The two diamonds of the rect the lattice picture takes apart. */
const FIRST = "#4f7fbf";
const SECOND = "#8a6bb8";
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/**
 * The fourteen shapes of an edge set, in the order of their values (the set's first value
 * + 0 … + 13). Each lists its four quarters, top-left, top-right, bottom-right,
 * bottom-left: `O` is the outside terrain, `I` the inside one, and a compass point is a
 * quarter the edge line crosses, named for the side of the line the outside terrain is
 * on. `NW` and `SE` lines run from the quarter's corner at the diamond's centre towards
 * north-east / south-west; `NE` and `SW` lines towards north-west / south-east.
 */
export const ISOM_SHAPES = [
  { quarters: ["O", "NW", "I", "NW"], words: "Edge; the outside terrain to the north-west" },
  { quarters: ["NE", "O", "NE", "I"], words: "Edge; the outside terrain to the north-east" },
  { quarters: ["I", "SE", "O", "SE"], words: "Edge; the outside terrain to the south-east" },
  { quarters: ["SW", "I", "SW", "O"], words: "Edge; the outside terrain to the south-west" },
  { quarters: ["O", "O", "NE", "NW"], words: "Corner of the inside terrain, pointing north" },
  { quarters: ["NE", "O", "O", "SE"], words: "Corner of the inside terrain, pointing east" },
  { quarters: ["SW", "SE", "O", "O"], words: "Corner of the inside terrain, pointing south" },
  { quarters: ["O", "NW", "SW", "O"], words: "Corner of the inside terrain, pointing west" },
  { quarters: ["SW", "I", "I", "NW"], words: "Corner of the outside terrain, pointing east" },
  { quarters: ["I", "SE", "NE", "I"], words: "Corner of the outside terrain, pointing west" },
  { quarters: ["NE", "NW", "I", "I"], words: "Corner of the outside terrain, pointing south" },
  { quarters: ["I", "I", "SW", "SE"], words: "Corner of the outside terrain, pointing north" },
  { quarters: ["SW", "SE", "NE", "NW"], words: "Crossing: the inside terrain at the north and south corners, the outside at the east and west" },
  { quarters: ["NE", "NW", "SW", "SE"], words: "Crossing: the outside terrain at the north and south corners, the inside at the east and west" },
];

/**
 * For the test: which neighbours of a diamond of each shape are the outside (`O`) or
 * inside (`I`) terrain when they are flat, in the order north-west, north-east,
 * south-east, south-west. A quarter that is one terrain all over shares its outer side
 * with the neighbour on that side, so a flat neighbour there must be the same terrain;
 * across a quarter the border crosses, the neighbour is always another edge piece.
 */
export const ISOM_SHAPE_NEIGHBOURS = ISOM_SHAPES.map((shape) => shape.quarters.map((q) => (q === "O" || q === "I" ? q : null)));

/* ── Geometry ───────────────────────────────────────────── */

const DIRECTION = { NW: [2, -1], SE: [2, -1], NE: [2, 1], SW: [2, 1] };
const NORMAL = { NW: [-1, -2], SE: [1, 2], NE: [1, -2], SW: [-1, 2] };

/** The four quarter triangles of a diamond centred on (cx, cy), half-sizes hw × hh. */
function quarters(cx, cy, hw, hh) {
  const c = [cx, cy], n = [cx, cy - hh], e = [cx + hw, cy], s = [cx, cy + hh], w = [cx - hw, cy];
  return [[c, w, n], [c, n, e], [c, e, s], [c, s, w]];
}

/** The part of a polygon on the side of the line through `at` that `normal` points to. */
function clip(poly, at, normal, keepPositive) {
  const side = (p) => ((p[0] - at[0]) * normal[0] + (p[1] - at[1]) * normal[1]) * (keepPositive ? 1 : -1);
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const sa = side(a), sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

const r = (v) => Math.round(v * 100) / 100;
const pts = (poly) => poly.map(([x, y]) => `${r(x)},${r(y)}`).join(" ");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One diamond drawn by its shape: filled quarters, split quarters and the edge line. */
function shapeDiamond(cx, cy, hw, hh, quarterKinds) {
  const out = [];
  const lines = [];
  quarters(cx, cy, hw, hh).forEach((tri, q) => {
    const kind = quarterKinds[q];
    if (kind === "O" || kind === "I") {
      out.push(`<polygon points="${pts(tri)}" fill="${kind === "O" ? OUTSIDE : INSIDE}"/>`);
      return;
    }
    const normal = NORMAL[kind];
    out.push(`<polygon points="${pts(clip(tri, [cx, cy], normal, true))}" fill="${OUTSIDE}"/>`);
    out.push(`<polygon points="${pts(clip(tri, [cx, cy], normal, false))}" fill="${INSIDE}"/>`);
    // The line runs from the centre to the middle of the quarter's outer side.
    const [, a, b] = tri;
    const d = DIRECTION[kind];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const along = (mid[0] - cx) * d[0] + (mid[1] - cy) * d[1];
    if (Math.abs(along) > 1e-6) lines.push(`<line x1="${r(cx)}" y1="${r(cy)}" x2="${r(mid[0])}" y2="${r(mid[1])}"/>`);
  });
  return { fills: out.join(""), lines: lines.join("") };
}

function svg(width, height, title, desc, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="t d" font-family="${FONT}">
<title id="t">${esc(title)}</title>
<desc id="d">${esc(desc)}</desc>
<rect width="${width}" height="${height}" rx="10" fill="${CARD}"/>
${body}
</svg>
`;
}

const text = (x, y, s, { size = 13, fill = INK, anchor = "middle", weight = 400 } = {}) =>
  `<text x="${r(x)}" y="${r(y)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}"${weight !== 400 ? ` font-weight="${weight}"` : ""}>${esc(s)}</text>`;

/* ── Picture 1: the lattice ─────────────────────────────── */

/**
 * Tiles, rects and diamonds over the top-left corner of a map, and one rect taken apart
 * into its four words.
 */
function latticeSvg() {
  const S = 1.75; // svg units per map pixel
  const ox = 24, oy = 44;
  const cols = 3, rows = 3; // rects shown
  const W = cols * 64 * S, H = rows * 32 * S;
  const X = (px) => ox + px * S, Y = (py) => oy + py * S;
  const parts = [];

  parts.push(`<defs><clipPath id="map"><rect x="${ox}" y="${oy}" width="${W}" height="${H}"/></clipPath></defs>`);
  // Diamonds, tinted in turn so neighbours are told apart.
  const tints = ["#23324a", "#2a3b55", "#26364f", "#1f2c42"];
  const diamonds = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) if ((x + y) % 2 === 0) diamonds.push([x, y]);
  parts.push(`<g clip-path="url(#map)">`);
  diamonds.forEach(([x, y], i) => {
    const cx = X(64 * x), cy = Y(32 * y);
    const fill = x === 1 && y === 1 ? FIRST : x === 2 && y === 2 ? SECOND : tints[(x + 2 * y + i) % tints.length];
    parts.push(`<polygon points="${pts([[cx, cy - 32 * S], [cx + 64 * S, cy], [cx, cy + 32 * S], [cx - 64 * S, cy]])}" fill="${fill}" stroke="${GOLD}" stroke-width="1.5"/>`);
  });
  // Tile lines, then rect lines on top.
  for (let tx = 0; tx <= cols * 2; tx++) parts.push(`<line x1="${X(32 * tx)}" y1="${oy}" x2="${X(32 * tx)}" y2="${oy + H}" stroke="${TILE_LINE}" stroke-dasharray="3 3"/>`);
  for (let ry = 0; ry <= rows; ry++) parts.push(`<line x1="${ox}" y1="${Y(32 * ry)}" x2="${ox + W}" y2="${Y(32 * ry)}" stroke="${RECT_LINE}"/>`);
  for (let rx = 0; rx <= cols; rx++) parts.push(`<line x1="${X(64 * rx)}" y1="${oy}" x2="${X(64 * rx)}" y2="${oy + H}" stroke="${RECT_LINE}"/>`);
  // The rect taken apart on the right: rect (1, 1).
  const hx = X(64), hy = Y(32);
  parts.push(`<rect x="${hx}" y="${hy}" width="${64 * S}" height="${32 * S}" fill="none" stroke="${INK}" stroke-width="2.5"/>`);
  parts.push(`</g>`);
  // Lattice points: diamond centres filled, the others hollow.
  for (let y = 0; y <= rows; y++) {
    for (let x = 0; x <= cols; x++) {
      const cx = X(64 * x), cy = Y(32 * y);
      if ((x + y) % 2 === 0) {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="4.5" fill="${GOLD}"/>`);
        if (x < cols && y < rows) parts.push(text(cx + 14, cy + 17, `(${x},${y})`, { size: 12, fill: INK, anchor: "start" }));
      } else {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="3.5" fill="${CARD}" stroke="${MUTED}" stroke-width="1.5"/>`);
      }
    }
  }
  parts.push(text(ox, 26, "Diamonds on the map's top-left corner", { size: 14, anchor: "start", weight: 600 }));
  parts.push(text(ox, oy + H + 22, "Dashed: tiles. Solid: rects, two tiles wide.", { size: 12, fill: MUTED, anchor: "start" }));
  parts.push(text(ox, oy + H + 40, "Gold dots: diamond centres, where x + y is even.", { size: 12, fill: MUTED, anchor: "start" }));

  // Right: rect (1, 1) enlarged, its diagonal and its four words.
  const px = ox + W + 48, py = oy + 34;
  const RW = 240, RH = 120;
  const tl = [px, py], tr = [px + RW, py], br = [px + RW, py + RH], bl = [px, py + RH];
  parts.push(text(px, 26, "Rect (1,1): four words", { size: 14, anchor: "start", weight: 600 }));
  parts.push(`<polygon points="${pts([tl, tr, bl])}" fill="${FIRST}"/>`);
  parts.push(`<polygon points="${pts([tr, br, bl])}" fill="${SECOND}"/>`);
  parts.push(`<line x1="${tr[0]}" y1="${tr[1]}" x2="${bl[0]}" y2="${bl[1]}" stroke="${GOLD}" stroke-width="2"/>`);
  parts.push(`<rect x="${px}" y="${py}" width="${RW}" height="${RH}" fill="none" stroke="${INK}" stroke-width="2.5"/>`);
  parts.push(`<circle cx="${tl[0]}" cy="${tl[1]}" r="5" fill="${GOLD}"/><circle cx="${br[0]}" cy="${br[1]}" r="5" fill="${GOLD}"/>`);
  parts.push(text(px + 12, py + 26, "diamond (1,1):", { size: 13, anchor: "start" }));
  parts.push(text(px + 12, py + 43, "its bottom-right quarter", { size: 11, anchor: "start" }));
  parts.push(text(px + RW - 12, py + RH - 30, "diamond (2,2):", { size: 13, anchor: "end" }));
  parts.push(text(px + RW - 12, py + RH - 13, "its top-left quarter", { size: 11, anchor: "end" }));
  parts.push(text(px - 10, py + RH / 2 + 4, "left", { size: 12, anchor: "end", fill: GOLD }));
  parts.push(text(px + RW / 2, py - 10, "top", { size: 12, fill: GOLD }));
  parts.push(text(px + RW + 10, py + RH / 2 + 4, "right", { size: 12, anchor: "start", fill: GOLD }));
  parts.push(text(px + RW / 2, py + RH + 20, "bottom", { size: 12, fill: GOLD }));
  const lines = [
    ["left", "(1,1)'s value, flags 0x8"],
    ["top", "(1,1)'s value, flags 0xA"],
    ["right", "(2,2)'s value, flags 0x0"],
    ["bottom", "(2,2)'s value, flags 0x2"],
  ];
  lines.forEach(([side, what], i) => {
    const y = py + RH + 50 + i * 19;
    parts.push(text(px, y, side, { size: 12, anchor: "start", fill: GOLD }));
    parts.push(text(px + 62, y, what, { size: 12, anchor: "start" }));
  });

  const width = 760, height = Math.max(oy + H + 40, py + RH + 50 + 4 * 19 + 10);
  return svg(width, height, "The ISOM lattice", "Tiles, the rects two tiles wide that ISOM stores, and the diamonds centred on every other lattice point. Each rect is cut by one diagonal into a quarter of two diamonds, and its four words say which.", parts.join("\n"));
}

/* ── Picture 2: the fourteen shapes ─────────────────────── */

function shapesSvg() {
  const hw = 52, hh = 26;
  const cellW = 144, cellH = 118;
  const perRow = 5;
  const ox = 20, oy = 70;
  const parts = [];
  parts.push(text(ox, 30, "The fourteen shapes of an edge set", { size: 15, anchor: "start", weight: 600 }));
  parts.push(`<rect x="${ox}" y="42" width="14" height="14" fill="${OUTSIDE}"/>`);
  parts.push(text(ox + 20, 54, "outside terrain", { size: 12, anchor: "start", fill: MUTED }));
  parts.push(`<rect x="${ox + 140}" y="42" width="14" height="14" fill="${INSIDE}"/>`);
  parts.push(text(ox + 160, 54, "inside terrain", { size: 12, anchor: "start", fill: MUTED }));
  parts.push(`<line x1="${ox + 270}" y1="49" x2="${ox + 300}" y2="49" stroke="${EDGE_LINE}" stroke-width="3"/>`);
  parts.push(text(ox + 308, 54, "the edge", { size: 12, anchor: "start", fill: MUTED }));
  const short = ["edge, outside NW", "edge, outside NE", "edge, outside SE", "edge, outside SW",
    "inside points N", "inside points E", "inside points S", "inside points W",
    "outside points E", "outside points W", "outside points S", "outside points N",
    "crossing", "crossing"];
  ISOM_SHAPES.forEach((shape, i) => {
    const cx = ox + (i % perRow) * cellW + cellW / 2;
    const cy = oy + Math.floor(i / perRow) * cellH + hh + 8;
    const { fills, lines } = shapeDiamond(cx, cy, hw, hh, shape.quarters);
    parts.push(fills);
    parts.push(`<polygon points="${pts([[cx, cy - hh], [cx + hw, cy], [cx, cy + hh], [cx - hw, cy]])}" fill="none" stroke="${INK}" stroke-opacity="0.35"/>`);
    parts.push(`<g stroke="${EDGE_LINE}" stroke-width="3" stroke-linecap="round">${lines}</g>`);
    parts.push(text(cx, cy + hh + 20, `+${i}`, { size: 13, weight: 600 }));
    parts.push(text(cx, cy + hh + 36, short[i], { size: 11, fill: MUTED }));
  });
  const width = ox * 2 + perRow * cellW, height = oy + Math.ceil(ISOM_SHAPES.length / perRow) * cellH + 4;
  return svg(width, height, "The fourteen ISOM edge shapes", "Each diamond of an edge set is one of fourteen shapes: four straight edges, four corners of the inside terrain, four corners of the outside terrain and two crossings.", parts.join("\n"));
}

/* ── Picture 3: a worked example ────────────────────────── */

/**
 * One diamond of High Dirt painted on Dirt, on a Jungle-family map: the values the brush
 * leaves around it. `ISOM_EXAMPLE` is what the test checks the brush against.
 */
export const ISOM_EXAMPLE = {
  era: 4,
  width: 16,
  height: 16,
  centre: { x: 4, y: 4 },
  outside: 1, // Dirt
  inside: 2, // High Dirt
  edgeSet: 17, // the Dirt / High Dirt cliff's first value
  /** Offsets from the centre, and the shape each of those diamonds takes. */
  shapes: [
    [-1, -1, 0], [1, -1, 1], [1, 1, 2], [-1, 1, 3],
    [0, -2, 4], [2, 0, 5], [0, 2, 6], [-2, 0, 7],
  ],
};

/** The value of every diamond of the example, keyed "x,y". */
export function isomExampleValues(ex = ISOM_EXAMPLE) {
  const values = new Map();
  const w = ex.width / 2 + 1, h = ex.height + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x + y) % 2 === 0) values.set(`${x},${y}`, ex.outside);
  values.set(`${ex.centre.x},${ex.centre.y}`, ex.inside);
  for (const [dx, dy, shape] of ex.shapes) values.set(`${ex.centre.x + dx},${ex.centre.y + dy}`, ex.edgeSet + shape);
  return values;
}

function exampleSvg() {
  const ex = ISOM_EXAMPLE;
  const values = isomExampleValues(ex);
  const S = 1.35;
  const x0 = 1.5, y0 = 1.5, x1 = 6.5, y1 = 6.5; // the lattice window shown, in lattice units
  const ox = 24, oy = 50;
  const X = (lx) => ox + (lx - x0) * 64 * S, Y = (ly) => oy + (ly - y0) * 32 * S;
  const W = (x1 - x0) * 64 * S, H = (y1 - y0) * 32 * S;
  const parts = [];
  parts.push(`<defs><clipPath id="win"><rect x="${ox}" y="${oy}" width="${W}" height="${H}"/></clipPath></defs>`);
  parts.push(text(ox, 30, "One diamond of High Dirt painted on Dirt, Jungle World", { size: 15, anchor: "start", weight: 600 }));
  parts.push(`<g clip-path="url(#win)">`);
  const lines = [];
  const labels = [];
  for (let y = Math.floor(y0) - 1; y <= y1 + 1; y++) {
    for (let x = Math.floor(x0) - 1; x <= x1 + 1; x++) {
      if ((x + y) % 2) continue;
      const v = values.get(`${x},${y}`) ?? ex.outside;
      const cx = X(x), cy = Y(y);
      let kinds;
      if (v === ex.outside) kinds = ["O", "O", "O", "O"];
      else if (v === ex.inside) kinds = ["I", "I", "I", "I"];
      else kinds = ISOM_SHAPES[v - ex.edgeSet].quarters;
      const d = shapeDiamond(cx, cy, 64 * S, 32 * S, kinds);
      parts.push(d.fills);
      lines.push(d.lines);
      parts.push(`<polygon points="${pts([[cx, cy - 32 * S], [cx + 64 * S, cy], [cx, cy + 32 * S], [cx - 64 * S, cy]])}" fill="none" stroke="${INK}" stroke-opacity="0.3"/>`);
      if (x > x0 && x < x1 && y > y0 && y < y1) {
        labels.push(`<rect x="${r(cx - 15)}" y="${r(cy - 10)}" width="30" height="20" rx="4" fill="${CARD}" fill-opacity="0.85"/>`);
        labels.push(text(cx, cy + 5, String(v), { size: 13, weight: 600 }));
      }
    }
  }
  parts.push(`<g stroke="${EDGE_LINE}" stroke-width="3.5" stroke-linecap="round">${lines.join("")}</g>`);
  parts.push(labels.join(""));
  parts.push(`</g>`);
  parts.push(`<rect x="${ox}" y="${oy}" width="${W}" height="${H}" fill="none" stroke="${RECT_LINE}"/>`);

  const kx = ox + W + 28;
  const key = [
    [String(ex.outside), "Dirt, flat"],
    [String(ex.inside), "High Dirt, flat"],
    [`${ex.edgeSet}–${ex.edgeSet + 13}`, "the cliff between them:"],
    ["", `its first value, ${ex.edgeSet}, + the shape`],
  ];
  parts.push(text(kx, oy + 12, "Values", { size: 13, anchor: "start", weight: 600 }));
  key.forEach(([v, what], i) => {
    parts.push(text(kx, oy + 38 + i * 20, v, { size: 12, anchor: "start", fill: GOLD }));
    parts.push(text(kx + 56, oy + 38 + i * 20, what, { size: 12, anchor: "start" }));
  });
  const around = [
    [`${ex.edgeSet}–${ex.edgeSet + 3}`, "the four edges around the centre"],
    [`${ex.edgeSet + 4}–${ex.edgeSet + 7}`, "the corners of the High Dirt"],
  ];
  around.forEach(([v, what], i) => {
    parts.push(text(kx, oy + 136 + i * 20, v, { size: 12, anchor: "start", fill: GOLD }));
    parts.push(text(kx + 56, oy + 136 + i * 20, what, { size: 12, anchor: "start" }));
  });
  const width = 760, height = oy + H + 28;
  return svg(width, height, "An ISOM worked example", "A single diamond of High Dirt, value 2, on Dirt, value 1. The diamonds around it take the cliff's values: 17 to 20 for its four edges and 21 to 24 for its four corners.", parts.join("\n"));
}

/* ── Picture 4: how the sections refer to each other ────── */

function box(x, y, w, h, label, { strong = false } = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${strong ? "#2b313e" : "#191d25"}" stroke="${strong ? GOLD : RECT_LINE}" stroke-width="${strong ? 2 : 1.2}"/>` +
    text(x + w / 2, y + h / 2 + 5, label, { size: 13, weight: 600 });
}

function arrow(x1, y1, x2, y2) {
  return `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${MUTED}" stroke-width="1.4" marker-end="url(#head)"/>`;
}

function referencesSvg() {
  const parts = [];
  parts.push(`<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${MUTED}"/></marker></defs>`);
  const lx = 24, bh = 30;

  // String numbers.
  parts.push(text(lx, 30, "String numbers point into the string table", { size: 14, anchor: "start", weight: 600 }));
  const holders = ["SPRP", "FORC", "MRGN", "UNIx", "SWNM", "WAV", "TRIG", "MBRF"];
  const bw = 78, gap = 10;
  const rowW = holders.length * (bw + gap) - gap;
  holders.forEach((name, i) => {
    const x = lx + i * (bw + gap);
    parts.push(box(x, 50, bw, bh, name));
    parts.push(arrow(x + bw / 2, 50 + bh, lx + rowW / 2 + (i - (holders.length - 1) / 2) * 16, 138));
  });
  const strW = 200;
  parts.push(box(lx + rowW / 2 - strW / 2, 140, strW, 34, "STR  or  STRx", { strong: true }));
  parts.push(text(lx, 200, "UNIS names units the way UNIx does. Only editors read SWNM and WAV.", { size: 12, fill: MUTED, anchor: "start" }));

  // Other numbers.
  const my = 246;
  parts.push(text(lx, my, "Other numbers a record stores", { size: 14, anchor: "start", weight: 600 }));
  parts.push(box(lx, my + 22, 80, bh, "TRIG"));
  parts.push(box(lx + 180, my + 22, 80, bh, "MRGN"));
  parts.push(box(lx + 180, my + 72, 80, bh, "UPRP"));
  parts.push(box(lx + 340, my + 72, 80, bh, "UPUS"));
  parts.push(arrow(lx + 80, my + 22 + bh / 2, lx + 178, my + 22 + bh / 2));
  parts.push(arrow(lx + 80, my + 22 + bh * 0.8, lx + 178, my + 72 + bh / 2));
  parts.push(arrow(lx + 340, my + 72 + bh / 2, lx + 262, my + 72 + bh / 2));
  parts.push(text(lx + 130, my + 22 + bh / 2 - 6, "location", { size: 12, fill: MUTED }));
  parts.push(text(lx + 100, my + 72 + bh + 6, "properties slot", { size: 12, fill: MUTED }));
  parts.push(text(lx + 300, my + 72 + bh + 20, "in use", { size: 12, fill: MUTED }));
  parts.push(box(lx + 500, my + 22, 80, bh, "UNIT"));
  parts.push(`<path d="M${lx + 580},${my + 30} C${lx + 620},${my + 10} ${lx + 620},${my + 60} ${lx + 582},${my + 46}" fill="none" stroke="${MUTED}" stroke-width="1.4" marker-end="url(#head)"/>`);
  parts.push(text(lx + 500, my + 22 + bh + 20, "serial numbers: add-ons,", { size: 12, fill: MUTED, anchor: "start" }));
  parts.push(text(lx + 500, my + 22 + bh + 36, "nydus canals", { size: 12, fill: MUTED, anchor: "start" }));

  // Size and meaning.
  const ry = 408;
  parts.push(text(lx, ry, "What sets the size and meaning of others", { size: 14, anchor: "start", weight: 600 }));
  const top = ry + 22;
  const column = ["MTXM", "TILE", "MASK", "ISOM", "DD2"];
  const at = (name) => top + column.indexOf(name) * 42;
  column.forEach((name) => parts.push(box(lx + 170, at(name), 70, bh, name)));
  parts.push(box(lx, top, 70, bh, "DIM"));
  for (const name of ["MTXM", "TILE", "MASK", "ISOM"]) parts.push(arrow(lx + 70, top + bh / 2, lx + 168, at(name) + bh / 2));
  parts.push(text(lx + 35, top + bh + 18, "sizes", { size: 12, fill: MUTED }));
  parts.push(box(lx + 340, top, 70, bh, "ERA"));
  for (const name of ["MTXM", "TILE", "ISOM", "DD2"]) parts.push(arrow(lx + 340, top + bh / 2, lx + 242, at(name) + bh / 2));
  parts.push(text(lx + 375, top + bh + 18, "tile, terrain and", { size: 12, fill: MUTED }));
  parts.push(text(lx + 375, top + bh + 33, "doodad numbers", { size: 12, fill: MUTED }));
  const vx = lx + 480;
  parts.push(box(vx, top, 70, bh, "VER"));
  parts.push(text(vx + 84, top + 13, "which settings tables", { size: 12, anchor: "start" }));
  parts.push(text(vx + 84, top + 28, "the game reads", { size: 12, anchor: "start" }));
  parts.push(box(vx, top + 84, 70, bh, "OWNR"));
  parts.push(box(vx + 150, top + 84, 70, bh, "IOWN"));
  parts.push(`<line x1="${vx + 72}" y1="${top + 84 + bh / 2}" x2="${vx + 148}" y2="${top + 84 + bh / 2}" stroke="${MUTED}" stroke-width="1.4" stroke-dasharray="4 3"/>`);
  parts.push(text(vx + 110, top + 84 + bh / 2 - 6, "copy", { size: 12, fill: MUTED }));

  return svg(760, at("DD2") + bh + 24, "How the sections refer to each other", "String numbers in eight sections point into the string table. Triggers point at locations and unit properties slots, units at each other by serial number. DIM sets the size of the terrain and fog sections and ERA the meaning of their numbers; VER picks the settings tables.", parts.join("\n"));
}

/* ── Picture 5: what the game does with a second copy ───── */

/** Section names by what the game does with a second copy (`chk-game.mjs`), in StarEdit's order. */
function sectionsByMode(defs) {
  const groups = { last: ["last", "anyLast", "padded", "whole"], overlay: ["overlay", "fog"], append: ["append", "units"], entries: ["entries"] };
  const out = { last: [], overlay: [], append: [], entries: [] };
  for (const name of defs.APPEND_ORDER) {
    const rule = GAME_COPIES[name];
    for (const [mode, rules] of Object.entries(groups)) if (rules.includes(rule)) out[mode].push(name.trimEnd());
  }
  return out;
}

/** A section in the file: its name on a header strip over the body. */
function fileSection(x, y, w, name, body, { faded = false, fill = "#191d25" } = {}) {
  const o = faded ? ` opacity="0.45"` : "";
  return `<g${o}><rect x="${r(x)}" y="${y}" width="${r(w)}" height="46" rx="5" fill="${fill}" stroke="${RECT_LINE}"/>` +
    `<rect x="${r(x)}" y="${y}" width="${r(w)}" height="16" rx="5" fill="#2b313e"/>` +
    text(x + 8, y + 12, name, { size: 11, anchor: "start", weight: 600 }) +
    body + `</g>`;
}

function repeatsSvg(defs) {
  const modes = sectionsByMode(defs);
  const parts = [];
  parts.push(`<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${MUTED}"/></marker></defs>`);
  const lx = 24, fileW = 330, rx = 400;
  parts.push(text(lx, 28, "In the file", { size: 12, anchor: "start", fill: MUTED }));
  parts.push(text(rx, 28, "What the game has", { size: 12, anchor: "start", fill: MUTED }));
  const COPY1 = FIRST, COPY2 = INSIDE;

  // Row 1: the last copy replaces the others.
  let y = 44;
  parts.push(text(lx, y + 14, "The last copy replaces the others", { size: 14, anchor: "start", weight: 600 }));
  parts.push(fileSection(lx, y + 26, 150, "DIM  (first copy)", text(lx + 75, y + 60, "64 × 64", { size: 13 }), { faded: true }));
  parts.push(fileSection(lx + 170, y + 26, 150, "DIM  (second copy)", text(lx + 245, y + 60, "128 × 96", { size: 13, fill: GOLD })));
  parts.push(arrow(lx + fileW, y + 49, rx - 12, y + 49));
  parts.push(`<rect x="${rx}" y="${y + 26}" width="150" height="46" rx="5" fill="#191d25" stroke="${GOLD}" stroke-width="1.5"/>`);
  parts.push(text(rx + 75, y + 54, "128 × 96", { size: 13, fill: GOLD, weight: 600 }));
  parts.push(text(rx + 166, y + 46, "The first copy", { size: 12, anchor: "start" }));
  parts.push(text(rx + 166, y + 62, "is ignored.", { size: 12, anchor: "start" }));
  parts.push(text(lx, y + 96, `${modes.last.join(", ")}.`, { size: 11, anchor: "start", fill: MUTED }));

  // Row 2: each copy is written over the start of the same space.
  y += 124;
  parts.push(text(lx, y + 14, "Each copy is written over the start of the same space", { size: 14, anchor: "start", weight: 600 }));
  const cols = 8, rows = 4, cell = 18;
  const mini = (x0, y0, n, fill) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(`<rect x="${x0 + (i % cols) * 12}" y="${y0 + Math.floor(i / cols) * 7}" width="11" height="6" fill="${fill}"/>`);
    return out.join("");
  };
  parts.push(fileSection(lx, y + 26, 150, "MTXM  (whole map)", mini(lx + 27, y + 46, cols * rows, COPY1)));
  parts.push(fileSection(lx + 170, y + 26, 150, "MTXM  (half as long)", mini(lx + 197, y + 46, cols * rows / 2, COPY2)));
  parts.push(arrow(lx + fileW, y + 70, rx - 12, y + 70));
  for (let i = 0; i < cols * rows; i++) {
    const cx = rx + (i % cols) * cell, cy = y + 30 + Math.floor(i / cols) * cell;
    parts.push(`<rect x="${cx}" y="${cy}" width="${cell - 2}" height="${cell - 2}" fill="${i < cols * rows / 2 ? COPY2 : COPY1}"/>`);
  }
  const gx = rx + cols * cell + 16;
  parts.push(text(gx, y + 46, "The second copy rewrites", { size: 12, anchor: "start" }));
  parts.push(text(gx, y + 62, "only the tiles it has bytes", { size: 12, anchor: "start" }));
  parts.push(text(gx, y + 78, "for: the top half. The rest", { size: 12, anchor: "start" }));
  parts.push(text(gx, y + 94, "is what the first copy left.", { size: 12, anchor: "start" }));
  parts.push(text(lx, y + 128, `Sections: ${modes.overlay.join(", ")}.`, { size: 11, anchor: "start", fill: MUTED }));

  // Row 3: the copies are joined into one list.
  y += 152;
  parts.push(text(lx, y + 14, "The copies are joined into one list", { size: 14, anchor: "start", weight: 600 }));
  const chip = (x0, y0, label, fill) => `<rect x="${x0}" y="${y0}" width="30" height="20" rx="3" fill="${fill}"/>` + text(x0 + 15, y0 + 14, label, { size: 11, weight: 600 });
  parts.push(fileSection(lx, y + 26, 150, "TRIG", [1, 2, 3].map((n, i) => chip(lx + 12 + i * 36, y + 46, `#${n}`, COPY1)).join("")));
  parts.push(fileSection(lx + 170, y + 26, 150, "TRIG", [4, 5].map((n, i) => chip(lx + 182 + i * 36, y + 46, `#${n}`, COPY2)).join("")));
  parts.push(arrow(lx + fileW, y + 56, rx - 12, y + 56));
  [1, 2, 3, 4, 5].forEach((n, i) => parts.push(chip(rx + i * 36, y + 46, `#${n}`, n <= 3 ? COPY1 : COPY2)));
  parts.push(text(rx + 190, y + 54, "One list of five triggers,", { size: 12, anchor: "start" }));
  parts.push(text(rx + 190, y + 70, "in file order.", { size: 12, anchor: "start" }));
  parts.push(text(lx, y + 96, `Sections: ${modes.append.join(", ")}. Start locations come from the last UNIT copy alone.`, { size: 11, anchor: "start", fill: MUTED }));

  // Row 4: the settings tables, entry by entry.
  y += 124;
  parts.push(text(lx, y + 14, "The settings tables are combined entry by entry", { size: 14, anchor: "start", weight: 600 }));
  const entry = (x0, y0, label, fill, dim = false) =>
    `<g${dim ? ` opacity="0.5"` : ""}><rect x="${x0}" y="${y0}" width="68" height="20" rx="3" fill="${fill}"${dim ? ` stroke="${RECT_LINE}"` : ""}/>` + text(x0 + 34, y0 + 14, label, { size: 10.5, weight: 600 }) + `</g>`;
  parts.push(fileSection(lx, y + 26, 150, "UNIx", entry(lx + 5, y + 46, "Marine 200", COPY1) + entry(lx + 77, y + 46, "Firebat –", "#191d25", true)));
  parts.push(fileSection(lx + 170, y + 26, 150, "UNIx", entry(lx + 175, y + 46, "Marine –", "#191d25", true) + entry(lx + 247, y + 46, "Firebat 80", COPY2)));
  parts.push(arrow(lx + fileW, y + 56, rx - 12, y + 56));
  parts.push(entry(rx, y + 46, "Marine 200", COPY1) + entry(rx + 74, y + 46, "Firebat 80", COPY2));
  parts.push(text(rx + 156, y + 54, "A copy changes only the entries", { size: 12, anchor: "start" }));
  parts.push(text(rx + 156, y + 70, "it sets; a dash keeps the default.", { size: 12, anchor: "start" }));
  parts.push(text(lx, y + 96, `Sections: ${modes.entries.join(", ")}.`, { size: 11, anchor: "start", fill: MUTED }));

  return svg(760, y + 112, "What the game does with a second copy of a section", "Four ways StarCraft combines repeated sections. For most, the last copy replaces the others. For the terrain and the fog, each copy is written over the start of the same space, so a half-length second MTXM rewrites the top half of the map. For units, sprites, triggers and briefings, the copies are joined into one list. The unit, upgrade and ability settings tables are combined entry by entry.", parts.join("\n"));
}

/* ── Picture 6: one doodad in four sections ─────────────── */

function doodadLayersSvg() {
  const parts = [];
  const cols = 6, rows = 4, t = 26;
  const panelW = 172, gap = 12, ox = 24, oy = 64;
  const GROUND = "#3d4a36", GROUND_ALT = "#435140";
  const DOODAD = "#7a5a3a";
  const dx = 2, dy = 1, dw = 3, dh = 2; // the doodad's tiles
  parts.push(text(ox, 30, "One doodad, as four sections hold it", { size: 15, anchor: "start", weight: 600 }));
  const panels = [
    { name: "TILE", who: "editors", line1: "The ground under the", line2: "doodad, to put back" },
    { name: "MTXM", who: "the game", line1: "Its tiles drawn in, one", line2: "tile group per row" },
    { name: "DD2", who: "editors", line1: "The object an editor", line2: "selects: number, middle" },
    { name: "THG2", who: "the game", line1: "Its sprite or unit, if it", line2: "has one: a tree top, a door" },
  ];
  panels.forEach((p, i) => {
    const px = ox + i * (panelW + gap);
    const gx = px + (panelW - cols * t) / 2, gy = oy + 10;
    parts.push(`<rect x="${px}" y="${oy - 22}" width="${panelW}" height="${rows * t + 104}" rx="8" fill="#171a21" stroke="${RECT_LINE}"/>`);
    parts.push(text(px + 10, oy - 6, p.name, { size: 13, anchor: "start", weight: 600 }));
    parts.push(text(px + panelW - 10, oy - 6, `read by ${p.who}`, { size: 11, anchor: "end", fill: p.who === "the game" ? GOLD : MUTED }));
    const inDoodad = (x, y) => x >= dx && x < dx + dw && y >= dy && y < dy + dh;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const drawn = p.name === "MTXM" && inDoodad(x, y);
        const faint = (p.name === "DD2" || p.name === "THG2");
        parts.push(`<rect x="${gx + x * t}" y="${gy + y * t}" width="${t - 1}" height="${t - 1}" fill="${drawn ? DOODAD : (x + y) % 2 ? GROUND : GROUND_ALT}"${faint ? ` opacity="0.35"` : ""}/>`);
        if (drawn) parts.push(text(gx + x * t + t / 2, gy + y * t + t / 2 + 4, String(x - dx), { size: 10 }));
      }
    }
    if (p.name === "MTXM") {
      parts.push(text(gx + dx * t - 4, gy + dy * t + t / 2 + 4, "g", { size: 11, anchor: "end", fill: GOLD, weight: 600 }));
      parts.push(text(gx + dx * t - 4, gy + (dy + 1) * t + t / 2 + 4, "g+1", { size: 11, anchor: "end", fill: GOLD, weight: 600 }));
    }
    const mx = gx + (dx + dw / 2) * t, my = gy + (dy + dh / 2) * t;
    if (p.name === "TILE") {
      parts.push(`<rect x="${gx + dx * t}" y="${gy + dy * t}" width="${dw * t - 1}" height="${dh * t - 1}" fill="none" stroke="${INK}" stroke-dasharray="3 3"/>`);
    }
    if (p.name === "DD2") {
      parts.push(`<rect x="${gx + dx * t}" y="${gy + dy * t}" width="${dw * t - 1}" height="${dh * t - 1}" fill="none" stroke="${GOLD}" stroke-width="2"/>`);
      parts.push(`<circle cx="${mx}" cy="${my}" r="4" fill="${GOLD}"/>`);
      parts.push(text(mx, my - 8, "x, y", { size: 11, fill: GOLD, weight: 600 }));
    }
    if (p.name === "THG2") {
      parts.push(`<circle cx="${mx}" cy="${my - 8}" r="22" fill="#3f7a4a" stroke="#9fd4a8" stroke-width="1.5"/>`);
      parts.push(text(mx, my - 4, "sprite", { size: 11, weight: 600 }));
    }
    parts.push(text(px + 10, gy + rows * t + 26, p.line1, { size: 11.5, anchor: "start" }));
    parts.push(text(px + 10, gy + rows * t + 43, p.line2, { size: 11.5, anchor: "start" }));
  });
  const bottom = oy + rows * t + 82 + 20;
  parts.push(text(ox, bottom, "Remove the DD2 record alone and the game still shows the doodad; an editor just cannot select it.", { size: 12, anchor: "start", fill: MUTED }));
  return svg(760, bottom + 16, "One doodad in four sections", "A doodad three tiles wide and two high. TILE keeps the ground under it, MTXM has its tiles drawn in, DD2 records its number and middle for an editor to select, and THG2 holds its sprite if it has one. The game reads MTXM and THG2; only editors read TILE and DD2.", parts.join("\n"));
}

/* ── Picture 7: from a tile number to pixels ────────────── */

function tileLookupSvg() {
  const parts = [];
  parts.push(`<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${MUTED}"/></marker></defs>`);
  const ox = 24;
  parts.push(text(ox, 30, "From a tile number to pixels", { size: 15, anchor: "start", weight: 600 }));

  // The tile number and its split.
  const ty = 52;
  parts.push(text(ox, ty + 4, "MTXM, one tile", { size: 12, anchor: "start", fill: MUTED }));
  parts.push(`<rect x="${ox}" y="${ty + 12}" width="120" height="40" rx="6" fill="#2b313e" stroke="${GOLD}" stroke-width="1.5"/>`);
  parts.push(text(ox + 60, ty + 38, "0x0132", { size: 16, weight: 600 }));
  parts.push(text(ox, ty + 76, "÷ 16 → group 19", { size: 12, anchor: "start" }));
  parts.push(text(ox, ty + 94, "remainder → variation 2", { size: 12, anchor: "start" }));

  // The CV5 record, 52 bytes.
  const cx0 = 214, cy0 = ty + 12, bw = 10; // svg units per byte
  parts.push(text(cx0, ty + 4, "CV5, record 19 (52 bytes)", { size: 12, anchor: "start", fill: MUTED }));
  const cv5 = [[0, 2, "type"], [2, 2, "flags"], [4, 8, "side links"], [12, 8, "stack links"], [20, 32, "16 megatile numbers, one per variation"]];
  for (const [at, n, label] of cv5) {
    parts.push(`<rect x="${cx0 + at * bw}" y="${cy0}" width="${n * bw - 1}" height="40" fill="${at === 20 ? "#23324a" : "#191d25"}" stroke="${RECT_LINE}"/>`);
    if (at === 20) parts.push(text(cx0 + 28 * bw + 4, cy0 + 25, label, { size: 11, anchor: "start" }));
    else if (n >= 8) parts.push(text(cx0 + (at + n / 2) * bw, cy0 + 25, label, { size: 11 }));
  }
  parts.push(text(cx0 + 1 * bw, cy0 + 56, "type", { size: 10, fill: MUTED }));
  parts.push(text(cx0 + 3 * bw, cy0 + 68, "flags", { size: 10, fill: MUTED }));
  const hit = cx0 + (20 + 2 * 2) * bw;
  parts.push(`<rect x="${hit}" y="${cy0 - 3}" width="${2 * bw - 1}" height="46" fill="none" stroke="${GOLD}" stroke-width="2"/>`);
  parts.push(text(hit + bw, cy0 + 60, "variation 2: megatile m", { size: 12, fill: GOLD }));
  parts.push(arrow(ox + 124, cy0 + 20, cx0 - 6, cy0 + 20));

  // The megatile: 16 minitile references.
  const my0 = 200, cell = 26;
  parts.push(text(ox, my0 - 12, "VX4, megatile m", { size: 12, anchor: "start", fill: MUTED }));
  for (let i = 0; i < 16; i++) {
    const x = ox + (i % 4) * cell, y = my0 + Math.floor(i / 4) * cell;
    const on = i === 6;
    parts.push(`<rect x="${x}" y="${y}" width="${cell - 2}" height="${cell - 2}" fill="${on ? "#23324a" : "#191d25"}" stroke="${on ? GOLD : RECT_LINE}"${on ? ` stroke-width="2"` : ""}/>`);
  }
  parts.push(text(ox, my0 + 4 * cell + 18, "16 references, 4 × 4:", { size: 11.5, anchor: "start" }));
  parts.push(text(ox, my0 + 4 * cell + 34, "minitile = ref >> 1,", { size: 11.5, anchor: "start" }));
  parts.push(text(ox, my0 + 4 * cell + 50, "mirrored if ref & 1", { size: 11.5, anchor: "start" }));
  parts.push(`<path d="M${hit + bw},${cy0 + 72} C${hit + bw},${my0 - 40} ${ox + 200},${my0 - 60} ${ox + 2 * cell + 13},${my0 + cell - 6}" fill="none" stroke="${MUTED}" stroke-width="1.4" marker-end="url(#head)"/>`);

  // The minitile: 8 × 8 palette indices, schematic.
  const vx = 250, px = 13;
  parts.push(text(vx, my0 - 12, "VR4, one minitile", { size: 12, anchor: "start", fill: MUTED }));
  const shades = ["#5b4a33", "#6b5a3e", "#4f4230", "#77654a"];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const on = x === 5 && y === 2;
      parts.push(`<rect x="${vx + x * px}" y="${my0 + y * px}" width="${px - 1}" height="${px - 1}" fill="${shades[(x * 3 + y * 5 + ((x * y) % 3)) % 4]}"${on ? ` stroke="${GOLD}" stroke-width="2"` : ""}/>`);
    }
  }
  parts.push(text(vx, my0 + 8 * px + 18, "64 bytes: one palette", { size: 11.5, anchor: "start" }));
  parts.push(text(vx, my0 + 8 * px + 34, "index per pixel, 8 × 8", { size: 11.5, anchor: "start" }));
  parts.push(arrow(ox + 4 * cell + 6, my0 + 2 * cell - 6, vx - 8, my0 + 2 * cell - 6));

  // The palette.
  const wx = 470;
  parts.push(text(wx, my0 - 12, "WPE, the palette", { size: 12, anchor: "start", fill: MUTED }));
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 4; j++) {
      const on = i === 9 && j === 1;
      const g = 40 + ((i * 13 + j * 29) % 150);
      parts.push(`<rect x="${wx + i * 16}" y="${my0 + j * 16}" width="15" height="15" fill="rgb(${g + 20},${g},${Math.max(20, g - 30)})"${on ? ` stroke="${GOLD}" stroke-width="2"` : ""}/>`);
    }
  }
  parts.push(text(wx, my0 + 4 * 16 + 18, "256 colours, 4 bytes each:", { size: 11.5, anchor: "start" }));
  parts.push(text(wx, my0 + 4 * 16 + 34, "red, green, blue, unused", { size: 11.5, anchor: "start" }));
  parts.push(arrow(vx + 5 * px + 6, my0 + 2 * px + 6, wx + 9 * 16 + 2, my0 + 16 + 8));

  const bottom = my0 + 4 * cell + 80;
  parts.push(text(ox, bottom, "StarCraft: Remastered also has a VX4EX file, with 32-bit references in place of 16-bit ones. Walkability", { size: 11.5, anchor: "start", fill: MUTED }));
  parts.push(text(ox, bottom + 17, "and height are kept per minitile in the VF4 file. The minitile and colours here are placeholders.", { size: 11.5, anchor: "start", fill: MUTED }));
  return svg(760, bottom + 32, "From a tile number to pixels", "Tile number 0x0132 is tile group 19, variation 2. CV5 record 19 gives the megatile for variation 2; the VX4 megatile lists sixteen minitile references; each VR4 minitile is 64 palette indices; the WPE palette gives each index its colour.", parts.join("\n"));
}

/* ── Pictures 8+: byte rulers for the record sections ───── */

const FIELD_TINTS = ["#23324a", "#35294a", "#26402f", "#44331f"];

/**
 * A record drawn as a strip of bytes, `perLine` bytes to a line, each field a box at its
 * true width. A label that does not fit its box goes underneath with a leader line.
 */
function rulerLines(fields, { x0, y0, perLine, byteW, labels, base = 0 }) {
  const parts = [];
  const barH = 34, lineGap = 22;
  let y = y0;
  const lines = Math.ceil((fields.reduce((n, f) => Math.max(n, f.offset + f.bytes), 0) - base) / perLine);
  for (let line = 0; line < lines; line++) {
    const start = base + line * perLine, end = start + perLine;
    const below = [];
    fields.forEach((f, i) => {
      const a = Math.max(f.offset, start), b = Math.min(f.offset + f.bytes, end);
      if (a >= b) return;
      const x = x0 + (a - start) * byteW, w = (b - a) * byteW;
      const unused = /unused/i.test(labels[i]);
      parts.push(`<rect x="${r(x)}" y="${y}" width="${r(w - 1.5)}" height="${barH}" fill="${unused ? "#1b1e25" : FIELD_TINTS[i % FIELD_TINTS.length]}" stroke="${RECT_LINE}"/>`);
      if (a === f.offset) parts.push(text(x + 2, y - 5, String(f.offset), { size: 10, anchor: "start", fill: MUTED }));
      const label = a === f.offset ? labels[i] : `${labels[i]} (cont.)`;
      if (label.length * 6.1 + 8 <= w) parts.push(text(x + w / 2, y + barH / 2 + 4, label, { size: 11, fill: unused ? MUTED : INK }));
      else below.push({ cx: x + w / 2, label, w: label.length * 6.1 + 6 });
    });
    // Labels that did not fit, staggered so they do not overlap.
    const levels = [];
    for (const l of below) {
      let level = 0;
      while ((levels[level] ?? -Infinity) > l.cx - l.w / 2) level++;
      levels[level] = l.cx + l.w / 2;
      const ly = y + barH + 16 + level * 15;
      parts.push(`<line x1="${r(l.cx)}" y1="${y + barH}" x2="${r(l.cx)}" y2="${ly - 10}" stroke="${MUTED}" stroke-width="0.8"/>`);
      parts.push(text(l.cx, ly, l.label, { size: 10.5 }));
    }
    y += barH + lineGap + (levels.length ? levels.length * 15 + 4 : 0);
  }
  return { body: parts.join("\n"), bottom: y };
}

/** Short labels for the ruler of each record, by the layout row's field name. */
const RULER_LABELS = {
  UNIT: {
    serial: "serial", x: "x", y: "y", unitId: "unit type", relationType: "relations",
    validProperties: "states set", validStates: "fields set", owner: "owner", hitPointsPercent: "hit points %",
    shieldPercent: "shields %", energyPercent: "energy %", resourceAmount: "resources", hangarUnits: "hangar",
    stateFlags: "states", unused: "unused", relatedSerial: "linked serial",
  },
  THG2: { spriteId: "sprite or unit type", x: "x", y: "y", owner: "owner", unused: "unused", flags: "flags" },
  MRGN: { left: "left", top: "top", right: "right", bottom: "bottom", nameIndex: "name", elevationFlags: "elevations" },
};

function recordRulerSvg(name, layouts, { perLine, title, desc }) {
  const rows = laidOut(layouts[name].rows);
  const size = layoutSize(layouts[name].rows);
  const labels = rows.map((row) => {
    const label = RULER_LABELS[name]?.[row.field];
    if (!label) throw new Error(`No ruler label for ${name}.${row.field}`);
    return label;
  });
  const byteW = 712 / perLine;
  const parts = [text(24, 30, `${title}, ${size} bytes`, { size: 15, anchor: "start", weight: 600 })];
  const { body, bottom } = rulerLines(rows, { x0: 24, y0: 62, perLine, byteW, labels });
  parts.push(body);
  return svg(760, bottom + 4, `${title}, byte by byte`, desc, parts.join("\n"));
}

function triggerRulerSvg() {
  const parts = [];
  const ox = 24, W = 712;
  parts.push(text(ox, 30, "A trigger, 2400 bytes", { size: 15, anchor: "start", weight: 600 }));
  const whole = [
    { offset: 0, bytes: 320, label: "16 conditions" },
    { offset: 320, bytes: 2048, label: "64 actions × 32 bytes" },
    { offset: 2368, bytes: 32, label: "" },
  ];
  const y0 = 58, k = W / 2400;
  whole.forEach((f, i) => {
    const x = ox + f.offset * k, w = f.bytes * k;
    parts.push(`<rect x="${r(x)}" y="${y0}" width="${r(w - 1.5)}" height="34" fill="${i === 2 ? GOLD : FIELD_TINTS[i]}" stroke="${RECT_LINE}"/>`);
    parts.push(text(x + 2, y0 - 5, String(f.offset), { size: 10, anchor: "start", fill: MUTED }));
    if (f.label) parts.push(text(x + w / 2, y0 + 21, f.label, { size: 11.5 }));
  });
  // The last 32 bytes, enlarged.
  const tailY = y0 + 76;
  parts.push(`<path d="M${r(ox + 2368 * k)},${y0 + 34} L${ox},${tailY - 16} M${r(ox + W)},${y0 + 34} L${ox + W},${tailY - 16}" stroke="${MUTED}" stroke-width="0.8" fill="none" stroke-dasharray="3 3"/>`);
  const tail = rulerLines(
    [{ offset: 2368, bytes: 4 }, { offset: 2372, bytes: 27 }, { offset: 2399, bytes: 1 }],
    { x0: ox, y0: tailY, perLine: 32, byteW: W / 32, base: 2368, labels: ["flags", "players and groups, one byte each", "running"] },
  );
  parts.push(tail.body);

  const field = (fields) => Object.entries(fields).map(([key, [offset, bytes]]) => ({ key, offset, bytes }));
  const condLabels = { location: "location", player: "player", amount: "amount", unitId: "unit type", comparison: "comparison", type: "condition", resource: "resource / switch", flags: "flags", mask: "mask" };
  const actLabels = { location: "location", text: "text", wav: "sound", time: "time", player: "player", target: "second player, amount, …", unitId: "unit type", type: "action", modifier: "count / modifier", flags: "flags", padding: "unused", mask: "mask" };
  let y = tail.bottom + 22;
  parts.push(text(ox, y, "One condition, 20 bytes", { size: 13, anchor: "start", weight: 600 }));
  const cond = field(CONDITION_FIELDS);
  const c = rulerLines(cond, { x0: ox, y0: y + 26, perLine: 20, byteW: W / 20, labels: cond.map((f) => condLabels[f.key]) });
  parts.push(c.body);
  y = c.bottom + 10;
  parts.push(text(ox, y, "One action, 32 bytes", { size: 13, anchor: "start", weight: 600 }));
  const act = field(ACTION_FIELDS);
  const a = rulerLines(act, { x0: ox, y0: y + 26, perLine: 16, byteW: W / 16, labels: act.map((f) => actLabels[f.key]) });
  parts.push(a.body);
  return svg(760, a.bottom + 4, "The trigger record, byte by byte", "A trigger is 2400 bytes: 16 conditions of 20 bytes, 64 actions of 32 bytes, 4 bytes of flags, 27 bytes saying which players and groups it runs for, and one byte the game uses while it runs. Below, where each field of a condition and an action is.", parts.join("\n"));
}

/* ── Pictures from the game: how StarCraft 1.16.1 reads a map (`chk-game.mjs`) ── */

const NEED_FILL = "#23324a";
const FAIL = "#d0605a";
const FAIL_FILL = "#3a2024";
const OK = "#6fbf73";

const HEAD = `<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${MUTED}"/></marker></defs>`;

/** A rounded label: a section name, or a short statement in a box. */
function pill(x, y, w, h, label, { fill = "#191d25", stroke = RECT_LINE, dash = false, size = 11.5, color = INK, weight = 600 } = {}) {
  return `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${h}" rx="5" fill="${fill}" stroke="${stroke}" stroke-width="1.2"${dash ? ` stroke-dasharray="4 3"` : ""}/>` +
    text(x + w / 2, y + h / 2 + size * 0.36, label, { size, fill: color, weight });
}

/** Lines of text from (x, y) down, 16 px apart. */
const lines = (x, y, list, opts = {}) => list.map((s, i) => text(x, y + i * (opts.gap ?? 16), s, { size: 12, anchor: "start", ...opts })).join("");

const sectionLabel = (name) => name.trimEnd();

/** A row of section chips; a required one filled, an optional one dashed. Returns the right edge. */
function chips(x, y, list, { w = 44, gap = 4 } = {}) {
  const out = [];
  let at = x;
  for (const s of list) {
    const width = s.w ?? w;
    out.push(pill(at, y, width, 24, s.label ?? sectionLabel(s.name), { fill: s.required === false ? "#191d25" : NEED_FILL, stroke: s.required === false ? MUTED : "#3c5a86", dash: s.required === false }));
    at += width + gap;
  }
  return { svg: out.join(""), right: at - gap };
}

/** Picture: the three reads, what each takes, and what the player sees when one fails. */
function loadSvg() {
  const parts = [HEAD];
  const ox = 24, failX = 592, failW = 144;
  parts.push(text(ox, 30, "How StarCraft opens a map", { size: 15, anchor: "start", weight: 600 }));

  // The file to the list of sections.
  const top = 50;
  parts.push(pill(ox, top, 150, 34, "the map's .scm / .scx", { weight: 400, size: 12 }));
  parts.push(arrow(ox + 152, top + 17, ox + 190, top + 17));
  parts.push(pill(ox + 192, top, 168, 34, "staredit\\scenario.chk", { weight: 400, size: 12 }));
  parts.push(arrow(ox + 362, top + 17, ox + 400, top + 17));
  parts.push(pill(ox + 402, top, 310, 34, "a list of every section, in file order", { weight: 400, size: 12 }));
  parts.push(text(ox, top + 56, "Before each read the game checks VER: it must be 59, 63 or 205, and 205 needs Brood War.", { size: 12, anchor: "start", fill: MUTED }));

  const lane = (y, number, title, note) => {
    parts.push(`<rect x="${ox - 8}" y="${y}" width="${failX - ox - 4}" height="${note.h}" rx="8" fill="#161a21" stroke="#232834"/>`);
    parts.push(text(ox + 4, y + 22, `${number}  ${title}`, { size: 13.5, anchor: "start", weight: 600 }));
    parts.push(text(ox + 4, y + 40, note.when, { size: 11.5, anchor: "start", fill: MUTED }));
  };
  const failBox = (y, h, titles, sub, { soft = false } = {}) => {
    parts.push(`<rect x="${failX}" y="${y}" width="${failW}" height="${h}" rx="6" fill="${soft ? "#191d25" : FAIL_FILL}" stroke="${soft ? RECT_LINE : FAIL}" stroke-width="1.3"/>`);
    titles.forEach((t, i) => parts.push(text(failX + failW / 2, y + 20 + i * 15, t, { size: 12, fill: soft ? INK : "#f2b8b4", weight: 600 })));
    sub.forEach((s, i) => parts.push(text(failX + failW / 2, y + 22 + titles.length * 15 + i * 14, s, { size: 10.5, fill: MUTED })));
    parts.push(arrow(failX - 12, y + h / 2, failX - 2, y + h / 2));
  };

  const reads = Object.fromEntries(GAME_READS.map((rd) => [rd.id, rd]));

  // 1 · the map list.
  let y = top + 76;
  lane(y, "1", "The map list", { h: 88, when: "Whenever the list shows the map, when a game is made with it, and again at the start." });
  parts.push(chips(ox + 4, y + 52, reads.list.sections[205]).svg);
  failBox(y + 10, 68, ["Invalid Scenario"], ["the map is listed but", "cannot be chosen"]);

  // 2 · the start of a game.
  y += 104;
  lane(y, "2", "The start of a game", { h: 160, when: "The game type decides the list: Use Map Settings reads far more than melee does." });
  parts.push(text(ox + 4, y + 64, "Melee, and every other type but Use Map Settings", { size: 11.5, anchor: "start" }));
  const melee = reads.melee.sections[205].map((s) => (s.name === "COLR" ? { ...s, label: "COLR*", w: 52 } : s));
  parts.push(chips(ox + 4, y + 72, melee, { w: 38 }).svg);
  parts.push(text(ox + 4, y + 118, "Use Map Settings", { size: 11.5, anchor: "start" }));
  const settings = ["UNIx", "UPGx", "TECx", "PUPx", "PTEx"];
  const ums = [];
  for (const s of reads.ums.sections[205]) {
    if (settings.includes(s.name)) { if (s.name === "UNIx") ums.push({ label: "5 settings tables", w: 116 }); continue; }
    ums.push(s.name === "COLR" ? { ...s, label: "COLR*", w: 52 } : s);
  }
  parts.push(chips(ox + 4, y + 126, ums, { w: 38 }).svg);
  failBox(y + 36, 88, ["Error loading", "scenario file."], ["the game stops", "before it begins"]);

  // 3 · the briefing.
  y += 176;
  lane(y, "3", "The briefing", { h: 88, when: "Use Map Settings only, when the briefing room opens." });
  parts.push(chips(ox + 4, y + 52, reads.briefing.sections[205]).svg);
  failBox(y + 10, 68, ["No briefing"], ["the game goes on", "as if it had none"], { soft: true });

  // Arrows down the lanes.
  parts.push(arrow(ox + 300, top + 166, ox + 300, top + 178));
  parts.push(arrow(ox + 300, top + 342, ox + 300, top + 354));

  const foot = y + 112;
  parts.push(lines(ox, foot, [
    "Each read needs every section it shows. * COLR only in a Brood War file (VER 205). The settings tables are UNIx, UPGx,",
    "TECx, PUPx and PTEx in a Brood War file; an older file has UNIS, UPGS, TECS, UPGR and PTEC, with the Brood War ones",
    "read on top when present. A read fails at the first missing section or the first copy of a section it does not accept.",
  ], { size: 11.5, fill: MUTED }));
  return svg(760, foot + 56, "How StarCraft opens a map", "StarCraft lists the sections of scenario.chk, then reads the map up to three times. The map list read needs VER, DIM, ERA, OWNR, SIDE, STR, SPRP, FORC and VCOD, and shows Invalid Scenario if one fails. The start of a game needs STR, MTXM, THG2 and UNIT (and COLR in a Brood War file), and Use Map Settings also needs MASK, the settings tables, PUNI, UPRP, MRGN and TRIG; a failure stops the game with Error loading scenario file. The briefing reads STR and MBRF, and a failure only means no briefing.", parts.join("\n"));
}

/** Picture: which read takes which section, as a grid. */
function readsSvg(defs) {
  const parts = [];
  const ox = 24, nameW = 70, colW = 104, rowH = 19, top = 92;
  const columns = [
    { label: ["Map list", ""], id: "list", v: 205 },
    { label: ["Melee", "VER 59, 63"], id: "melee", v: 59 },
    { label: ["Melee", "VER 205"], id: "melee", v: 205 },
    { label: ["Use Map", "Settings 59, 63"], id: "ums", v: 59 },
    { label: ["Use Map", "Settings 205"], id: "ums", v: 205 },
    { label: ["Briefing", ""], id: "briefing", v: 205 },
  ];
  const names = defs.APPEND_ORDER.filter((n) => !GAME_NEVER.includes(n) && !REMASTERED_ONLY.includes(n) && n !== "TYPE");
  parts.push(text(ox, 30, "Which sections each read needs", { size: 15, anchor: "start", weight: 600 }));
  parts.push(`<circle cx="${ox + 6}" cy="${50}" r="6" fill="${GOLD}"/>`);
  parts.push(text(ox + 18, 54, "needed: the read fails without it", { size: 12, anchor: "start" }));
  parts.push(`<circle cx="${ox + 276}" cy="${50}" r="5.5" fill="none" stroke="${GOLD}" stroke-width="1.6"/>`);
  parts.push(text(ox + 288, 54, "read when present", { size: 12, anchor: "start" }));
  columns.forEach((c, i) => {
    const cx = ox + nameW + i * colW + colW / 2;
    parts.push(text(cx, top - 18, c.label[0], { size: 12, weight: 600 }));
    if (c.label[1]) parts.push(text(cx, top - 4, c.label[1], { size: 10.5, fill: MUTED }));
  });
  names.forEach((name, row) => {
    const y = top + 6 + row * rowH;
    if (row % 2 === 0) parts.push(`<rect x="${ox - 6}" y="${y}" width="${nameW + columns.length * colW + 6}" height="${rowH}" fill="#161a21"/>`);
    parts.push(text(ox, y + 14, sectionLabel(name), { size: 12, anchor: "start", weight: 600 }));
    const use = gameUse(name);
    columns.forEach((c, i) => {
      const kind = name === "VER " ? "need" : use[c.id][c.v]; // VER is checked before every read
      const cx = ox + nameW + i * colW + colW / 2, cy = y + rowH / 2;
      if (kind === "need") parts.push(`<circle cx="${cx}" cy="${cy}" r="5.5" fill="${GOLD}"/>`);
      else if (kind === "read") parts.push(`<circle cx="${cx}" cy="${cy}" r="5" fill="none" stroke="${GOLD}" stroke-width="1.6"/>`);
    });
  });
  const foot = top + 6 + names.length * rowH + 26;
  parts.push(lines(ox, foot, [
    `Never read by the game: ${GAME_NEVER.map(sectionLabel).join(", ")}.`,
    `TYPE is looked for but not read. VER is checked before every read.`,
    `Read only by StarCraft: Remastered: ${REMASTERED_ONLY.join(" and ")}.`,
  ], { size: 11.5, fill: MUTED }));
  return svg(760, foot + 46, "Which sections each read needs", "A grid of the sections StarCraft 1.16.1 reads against its reads: the map list, the start of a melee game, the start of a Use Map Settings game, each by file revision, and the briefing. A filled dot means the read fails without the section; a ring means the section is read when present.", parts.join("\n"));
}

/** Picture: how the game walks from one section to the next, and three odd lengths. */
function walkSvg() {
  const parts = [HEAD];
  const ox = 24, byte = 7.2, barH = 30;
  parts.push(text(ox, 30, "How the game finds the sections", { size: 15, anchor: "start", weight: 600 }));

  /** One section drawn as an 8-byte header and its data; returns the right edge. */
  const section = (x, y, name, length, dataBytes, { tint = "#191d25", nameFill = INK, faded = false } = {}) => {
    const hw = 8 * byte, dw = dataBytes * byte;
    const o = faded ? ` opacity="0.5"` : "";
    parts.push(`<g${o}><rect x="${r(x)}" y="${y}" width="${r(hw)}" height="${barH}" fill="#2b313e" stroke="${RECT_LINE}"/>` +
      text(x + hw / 2, y + 13, name, { size: 11, weight: 600, fill: nameFill }) + text(x + hw / 2, y + 25, String(length), { size: 10, fill: MUTED }) +
      (dw > 0 ? `<rect x="${r(x + hw)}" y="${y}" width="${r(dw)}" height="${barH}" fill="${tint}" stroke="${RECT_LINE}"/>` : "") + `</g>`);
    return x + hw + dw;
  };
  const hop = (x1, x2, y, label) => {
    const mid = (x1 + x2) / 2;
    parts.push(`<path d="M${r(x1)},${y} C${r(x1)},${y - 26} ${r(x2)},${y - 26} ${r(x2)},${y - 2}" fill="none" stroke="${MUTED}" stroke-width="1.3" marker-end="url(#head)"/>`);
    if (label) parts.push(text(mid, y - 24, label, { size: 10.5, fill: MUTED }));
  };

  // Row 1: the walk.
  let y = 110;
  parts.push(text(ox, y - 52, "Each header gives the length of what follows, and the next header comes straight after it", { size: 12.5, anchor: "start" }));
  let x = ox;
  const a = x, b = section(x, y, "VER", 2, 2, { tint: NEED_FILL });
  const c = section(b, y, "DIM", 4, 4, { tint: NEED_FILL });
  const d = section(c, y, "§%!x", 6, 6, { nameFill: MUTED });
  const e = section(d, y, "ERA", 2, 2, { tint: NEED_FILL });
  const f = section(e, y, "OWNR", 12, 12, { tint: NEED_FILL });
  section(f, y, "SIDE", 12, 12, { tint: NEED_FILL });
  hop(a + 4, b, y, "8 + 2"); hop(b + 4, c, y, "8 + 4"); hop(c + 4, d, y, "8 + 6"); hop(d + 4, e, y, "8 + 2"); hop(e + 4, f, y, "8 + 12");
  parts.push(text(c + 4 * byte + 3 * byte, y + barH + 16, "a name it does not know: passed over", { size: 11, fill: MUTED }));

  // Row 2: a negative length.
  y += 108;
  parts.push(text(ox, y - 34, "A negative length jumps back, and the game reads old bytes as new headers", { size: 12.5, anchor: "start" }));
  x = ox;
  const g1 = section(x, y, "SPRP", 4, 4, { tint: NEED_FILL });
  const g2 = section(g1, y, "STR", 40, 40, { tint: NEED_FILL });
  const g3 = section(g2, y, "XXXX", -38, 0);
  const hidden = g1 + 18 * byte; // 10 bytes into STR's text: offset 30 of the file
  parts.push(`<rect x="${r(hidden)}" y="${y + 3}" width="${r(8 * byte)}" height="${barH - 6}" fill="none" stroke="${GOLD}" stroke-width="1.5"/>`);
  parts.push(text(hidden + 4 * byte, y + 19, "SPRP", { size: 10, fill: GOLD, weight: 600 }));
  parts.push(`<path d="M${r(g3 - 30)},${y + barH} C${r(g3 - 30)},${y + barH + 34} ${r(hidden + 4 * byte)},${y + barH + 34} ${r(hidden + 4 * byte)},${y + barH + 2}" fill="none" stroke="${GOLD}" stroke-width="1.4" marker-end="url(#head)"/>`);
  parts.push(text(g3 + 10, y + 14, "length −38: the next header is", { size: 11, anchor: "start", fill: MUTED }));
  parts.push(text(g3 + 10, y + 28, "30 bytes back, hidden in STR's text", { size: 11, anchor: "start", fill: MUTED }));

  // Row 3: a length past the end.
  y += 110;
  parts.push(text(ox, y - 34, "A length past the end of the file stops the walk", { size: 12.5, anchor: "start" }));
  x = ox;
  const h1 = section(x, y, "UNIT", 36, 36, { tint: NEED_FILL });
  const h2 = section(h1, y, "THG2", 40, 10, { tint: "#3a2a20" });
  parts.push(`<rect x="${r(h2)}" y="${y}" width="${r(30 * byte)}" height="${barH}" fill="none" stroke="${FAIL}" stroke-width="1.2" stroke-dasharray="4 3"/>`);
  parts.push(text(h2 + 15 * byte, y + 19, "the 30 bytes THG2 claims", { size: 10.5, fill: "#f2b8b4" }));
  parts.push(`<line x1="${r(h2)}" y1="${y - 8}" x2="${r(h2)}" y2="${y + barH + 8}" stroke="${INK}" stroke-width="1.5"/>`);
  parts.push(text(h2, y + barH + 22, "end of file", { size: 10.5, fill: MUTED }));

  const foot = y + barH + 56;
  parts.push(lines(ox, foot, [
    "A section that runs past the end is still kept, and the walk stops after it. It refuses the map only if a read takes that",
    "section, as every read checks a section's bytes are really there. Fewer than 8 bytes after the last section are ignored.",
    "A protector hides a second SPRP this way, and the map list shows the name it points at. A length of −8 lands on the",
    "same header again, for ever: the game hangs.",
  ], { size: 11.5, fill: MUTED }));
  return svg(760, foot + 56, "How the game finds the sections", "Each section is an 8-byte header, a name and a length, followed by its data, and the next header comes straight after. A name the game does not know is passed over. A negative length jumps backwards, so the game reads bytes again as new headers. A length past the end of the file stops the walk; the section is kept and refuses the map only if a read needs it.", parts.join("\n"));
}

/** Picture: the VCOD check, from the player slots to the verdict. */
function vcodSvg() {
  const parts = [HEAD];
  const ox = 24;
  parts.push(text(ox, 30, "What VCOD checks", { size: 15, anchor: "start", weight: 600 }));

  // OWNR and SIDE into 12 records.
  const y0 = 56;
  parts.push(pill(ox, y0, 64, 26, "OWNR", { fill: NEED_FILL }));
  parts.push(pill(ox, y0 + 34, 64, 26, "SIDE", { fill: NEED_FILL }));
  parts.push(text(ox + 32, y0 + 78, "12 bytes each", { size: 10.5, fill: MUTED }));
  const gx = ox + 110, cw = 3.4, rh = 10;
  parts.push(text(gx, y0 - 6, "12 player records of 36 bytes, 432 in all, all zero but each player's type and race", { size: 11.5, anchor: "start", fill: MUTED }));
  for (let p = 0; p < 12; p++) {
    const yy = y0 + p * (rh + 1);
    for (let i = 0; i < 36; i++) {
      const fill = i === 8 ? OUTSIDE : i === 9 ? INSIDE : "#1f242e";
      parts.push(`<rect x="${r(gx + i * (cw + 0.6))}" y="${yy}" width="${cw}" height="${rh}" fill="${fill}"/>`);
    }
  }
  const gRight = gx + 36 * (cw + 0.6);
  parts.push(arrow(ox + 66, y0 + 13, gx + 8 * (cw + 0.6) - 2, y0 + 3));
  parts.push(arrow(ox + 66, y0 + 47, gx + 9 * (cw + 0.6) + 2, y0 + 3));
  parts.push(text(gRight + 12, y0 + 30, "byte 8: the player's type, from OWNR", { size: 11, anchor: "start", fill: "#9cbbe6" }));
  parts.push(text(gRight + 12, y0 + 46, "byte 9: the race, from SIDE", { size: 11, anchor: "start", fill: "#e8c486" }));
  parts.push(text(gRight + 12, y0 + 72, "Nothing else in the map is hashed:", { size: 11, anchor: "start", fill: MUTED }));
  parts.push(text(gRight + 12, y0 + 88, "not the terrain, units or triggers.", { size: 11, anchor: "start", fill: MUTED }));

  // Two hashes and the comparison.
  const hy = y0 + 150;
  const hashW = 230;
  parts.push(pill(ox + 40, hy, hashW, 40, "hash with the map's VCOD", { weight: 400, size: 12.5 }));
  parts.push(pill(ox + 360, hy, hashW, 40, "hash with the game's own VCOD", { weight: 400, size: 12.5 }));
  parts.push(arrow(gx + 60, y0 + 138, ox + 40 + hashW / 2, hy - 2));
  parts.push(arrow(gx + 90, y0 + 138, ox + 360 + hashW / 2, hy - 2));
  const cy = hy + 76;
  parts.push(pill(ox + 255, cy, 120, 32, "the same?", { fill: "#2b313e", stroke: GOLD }));
  parts.push(arrow(ox + 40 + hashW / 2, hy + 42, ox + 262, cy + 10));
  parts.push(arrow(ox + 360 + hashW / 2, hy + 42, ox + 368, cy + 10));
  parts.push(pill(ox + 70, cy + 56, 170, 30, "yes: the map is listed", { stroke: OK, weight: 400, size: 12 }));
  parts.push(pill(ox + 390, cy + 56, 190, 30, "no: Invalid Scenario", { fill: FAIL_FILL, stroke: FAIL, weight: 400, size: 12, color: "#f2b8b4" }));
  parts.push(arrow(ox + 270, cy + 30, ox + 200, cy + 54));
  parts.push(arrow(ox + 362, cy + 30, ox + 440, cy + 54));

  // The operations.
  const oy = cy + 120;
  parts.push(text(ox, oy, "The hash", { size: 13.5, anchor: "start", weight: 600 }));
  parts.push(lines(ox, oy + 22, [
    "A VCOD is 256 numbers of 32 bits, the seeds, then 16 operation bytes. The hash starts at 0. For each 4 bytes",
    "of the 432, read as one number w, it runs the 16 operations in order:",
  ]));
  const ops = [
    ["0", "hash = hash XOR w"],
    ["1", "hash = hash + w"],
    ["2", "hash = hash − w"],
    ["3, 4, 5", "hash = hash XOR the seeds picked by each of w's four bytes"],
    ["6", "rotate hash left by each of w's four bytes in turn (each taken mod 32)"],
    ["7", "rotate hash right the same way"],
    ["8 and up", "nothing"],
  ];
  ops.forEach(([k, v], i) => {
    const yy = oy + 62 + i * 18;
    parts.push(text(ox + 70, yy, k, { size: 12, anchor: "end", fill: GOLD, weight: 600 }));
    parts.push(text(ox + 84, yy, v, { size: 12, anchor: "start" }));
  });
  const foot = oy + 62 + ops.length * 18 + 14;
  parts.push(lines(ox, foot, [
    "Any table passes that gives the same answer as the game's own for these 432 bytes. Every copy of VCOD is checked.",
  ], { size: 11.5, fill: MUTED }));
  return svg(760, foot + 22, "What VCOD checks", "The game builds 432 bytes from the map's player slots: twelve 36-byte records, all zero except each player's type from OWNR and race from SIDE. It hashes them once with the map's VCOD table and once with the table built into the game, and refuses the map as Invalid Scenario when the two differ. The hash runs sixteen operations over every four bytes: XOR, add, subtract, XOR with seeds picked by the bytes, and rotations.", parts.join("\n"));
}

/** Picture: what happens to one record of UNIT when a game starts. */
function unitPathSvg() {
  const parts = [HEAD];
  const ox = 24, qx = ox, qw = 300, ax = 380, aw = 356, bh = 40, step = 58;
  parts.push(text(ox, 30, "What the game does with a placed unit", { size: 15, anchor: "start", weight: 600 }));
  const steps = [
    ["Is it a start location?", "No unit is made: its place becomes the owner's start location.", "keep"],
    ["Is the owner Player 1 to 8, and is", "that slot empty in this game?", "Dropped.", "drop"],
    ["Is this melee, or any type but", "Use Map Settings?", "Kept only if it is a Player 12 mineral field, geyser or critter.", "drop"],
    ["Use Map Settings, with the owner's race", "set to User Selectable?", "Kept only if it is a neutral kind: minerals, geysers, critters, power-ups.", "drop"],
    ["A Brood War unit, in a game of", "the original StarCraft?", "Not made.", "drop"],
    ["Is there room to place it?", "Removed, with WARNING: Unit unplaceable! on screen.", "drop"],
  ];
  let y = 52;
  for (const st of steps) {
    const kind = st.at(-1);
    const question = st.length === 4 ? [st[0], st[1]] : [st[0]];
    const answer = st.length === 4 ? st[2] : st[1];
    parts.push(`<rect x="${qx}" y="${y}" width="${qw}" height="${bh}" rx="6" fill="#2b313e" stroke="${RECT_LINE}"/>`);
    question.forEach((q, i) => parts.push(text(qx + 12, y + (question.length === 1 ? 25 : 17 + i * 15), q, { size: 12, anchor: "start" })));
    parts.push(arrow(qx + qw + 2, y + bh / 2, ax - 4, y + bh / 2));
    parts.push(text(qx + qw + 28, y + bh / 2 - 5, st === steps[5] ? "no" : "yes", { size: 10.5, fill: MUTED }));
    const words = answer.split(" ");
    const linesOut = [];
    let cur = "";
    for (const w of words) { if ((cur + " " + w).trim().length > 52) { linesOut.push(cur.trim()); cur = w; } else cur += " " + w; }
    linesOut.push(cur.trim());
    const color = kind === "keep" ? NEED_FILL : FAIL_FILL;
    parts.push(`<rect x="${ax}" y="${y}" width="${aw}" height="${bh}" rx="6" fill="${color}" stroke="${kind === "keep" ? "#3c5a86" : "#6a3a3a"}"/>`);
    linesOut.slice(0, 2).forEach((l, i) => parts.push(text(ax + 10, y + (linesOut.length === 1 ? 25 : 17 + i * 15), l, { size: 11.5, anchor: "start" })));
    if (st !== steps.at(-1)) {
      parts.push(arrow(qx + 40, y + bh + 2, qx + 40, y + step - 2));
      parts.push(text(qx + 50, y + bh + 13, "no", { size: 10.5, fill: MUTED, anchor: "start" }));
    }
    y += step;
  }
  // Created.
  parts.push(arrow(qx + 40, y - step + bh + 2, qx + 40, y - 2));
  parts.push(text(qx + 50, y - step + bh + 13, "yes", { size: 10.5, fill: MUTED, anchor: "start" }));
  parts.push(`<rect x="${qx}" y="${y}" width="${ax + aw - qx}" height="58" rx="6" fill="#1d2a20" stroke="${OK}"/>`);
  parts.push(text(qx + 12, y + 22, "The unit is made, then the record's fields are applied, each only when its bit is set:", { size: 12, anchor: "start" }));
  parts.push(text(qx + 12, y + 42, "hit points, shields, energy, resources, hangar, and the states: cloaked, burrowed, in transit, hallucinated, invincible.", { size: 11.5, anchor: "start", fill: MUTED }));
  const foot = y + 86;
  parts.push(lines(ox, foot, [
    "Only the last UNIT section's start locations count. Hit points of 0% leave the unit at 1/256 of a hit point. Resources",
    "are kept to 16 bits, so 70,000 becomes 4,464. Only Carriers, Reavers and their heroes take a hangar count. A Ghost placed",
    "cloaked starts cloaked only if its owner has Personal Cloaking. Add-ons and nydus canals link within one UNIT section.",
  ], { size: 11.5, fill: MUTED }));
  return svg(760, foot + 56, "What the game does with a placed unit", "The checks a UNIT record passes when a game starts: start locations are noted, not made; units of empty player slots are dropped; melee keeps only Player 12 minerals, geysers and critters; in Use Map Settings a User Selectable player keeps only neutral kinds of unit; Brood War units are not made in the original game; a unit with no room is removed with a warning. Then the unit is made and its fields applied.", parts.join("\n"));
}

/** Every picture this module draws, by its path under the repository. `defs` are the editor's tables. */
export function chkDiagrams(defs) {
  return new Map([
    ["docs/images/isom-lattice.svg", latticeSvg()],
    ["docs/images/isom-shapes.svg", shapesSvg()],
    ["docs/images/isom-example.svg", exampleSvg()],
    ["docs/images/chk-references.svg", referencesSvg()],
    ["docs/images/chk-repeats.svg", repeatsSvg(defs)],
    ["docs/images/chk-load.svg", loadSvg()],
    ["docs/images/chk-reads.svg", readsSvg(defs)],
    ["docs/images/chk-walk.svg", walkSvg()],
    ["docs/images/chk-vcod.svg", vcodSvg()],
    ["docs/images/chk-unit-path.svg", unitPathSvg()],
    ["docs/images/chk-doodad-layers.svg", doodadLayersSvg()],
    ["docs/images/chk-tile-lookup.svg", tileLookupSvg()],
    ["docs/images/chk-unit-record.svg", recordRulerSvg("UNIT", LAYOUTS, {
      perLine: 12, title: "A unit",
      desc: "The 36-byte UNIT record drawn to scale, twelve bytes to a line, each field at its offset.",
    })],
    ["docs/images/chk-sprite-record.svg", recordRulerSvg("THG2", LAYOUTS, {
      perLine: 10, title: "A sprite",
      desc: "The 10-byte THG2 record drawn to scale, each field at its offset.",
    })],
    ["docs/images/chk-location-record.svg", recordRulerSvg("MRGN", LAYOUTS, {
      perLine: 20, title: "A location",
      desc: "The 20-byte MRGN record drawn to scale: four 32-bit edges, then the name and the elevations.",
    })],
    ["docs/images/chk-trigger-record.svg", triggerRulerSvg()],
  ]);
}
