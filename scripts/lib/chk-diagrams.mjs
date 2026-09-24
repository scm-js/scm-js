/**
 * The pictures of `docs/chk-format.md`, drawn as SVG from the same tables the page states
 * in words, so a picture cannot say something the text does not. `npm run docs:reference`
 * writes them to `docs/images/`, and `tests/chkReference.test.ts` fails when one on disk
 * differs from what this module draws.
 *
 * The shapes (`ISOM_SHAPES`) are StarEdit's fourteen edge pieces as the isometric brush
 * uses them; the test holds them to Blizzard's maps (the neighbours each shape claims) and
 * the worked example to what the brush paints.
 */

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

/** Every picture this module draws, by its path under the repository. */
export function chkDiagrams() {
  return new Map([
    ["docs/images/isom-lattice.svg", latticeSvg()],
    ["docs/images/isom-shapes.svg", shapesSvg()],
    ["docs/images/isom-example.svg", exampleSvg()],
    ["docs/images/chk-references.svg", referencesSvg()],
  ]);
}
