/**
 * Where `scmjs replay export --follow <player>` looks: a camera track for the play page's viewer (`scmjs.view.follow`:
 * the middle of the view every few frames, and where it cuts). Made from the game itself when the engine's replay
 * runner can be had (`actionTrack`): every few frames, where the player's army is and the biggest fight it is in. Else
 * from the player's own clicks (`followTrack`), which say where their screen was — but a click on the minimap is a
 * place far from it, which is why the game is preferred. Either way the camera holds a place while what it follows
 * stays near it, moves to a new one only once that has lasted a moment, pans to a place within reach and cuts to one
 * further off, and is smoothed forward and back in time, so a pan starts gently and never lags: Aftermath's Spectate
 * camera, from moments the runner reports rather than its own timeline. Pure, and tested.
 */
import type { Command } from "@scm-js/replay";

/** The track the viewer plays: point `i` is the middle of the view at frame `i * every`; `cut` 1 where it cuts there. */
export interface Track { every: number; x: Float32Array; y: Float32Array; cut: Uint8Array }

export interface TrackOptions {
  /** How much of the map the view shows, map pixels. */
  view: { width: number; height: number };
  /** The map, map pixels. */
  map: { width: number; height: number };
  /** The game's length in frames. */
  frames: number;
  /** Game frames a second of the clip (24 × the speed, near enough). */
  rate: number;
  /** Where to look for a player who never clicks (their start location); the map's middle without one. */
  start?: { x: number; y: number } | null;
}

/** Frames between the track's points. */
const EVERY = 2;
/** Clicks inside this share of half the view are where the camera is already. */
const NEAR = 0.7;
/** Within the camera's place, it is drawn along once a click is outside this share of half the view. */
const DEAD = 0.35;
/** A new place is this far off at most to be panned to (in screens); further, the camera cuts. */
const CUT = 1.25;
/** The camera holds a place at least this long (seconds of the clip) before it moves on. */
const HOLD_SECONDS = 1.5;
/** Clicks at a new place before the camera goes there. */
const CLICKS = 2;
/** How much the track is smoothed: the spread of its bell in seconds of the clip, within these game frames. */
const EASE = { seconds: 0.25, fewestFrames: 4, mostFrames: 200 };

/** Where a command clicked, in map pixels; null for one with no place. Buildings and landings are given in tiles. */
export function clickOf(c: Command): { x: number; y: number } | null {
  if (c.x === undefined || c.y === undefined) return null;
  if (c.kind === "build" || c.kind === "land") return { x: c.x * 32 + 16, y: c.y * 32 + 16 };
  if (c.kind === "rightClick" || c.kind === "targeted" || c.kind === "ping") return c.x === 0 && c.y === 0 ? null : { x: c.x, y: c.y };
  return null;
}

/** The places the camera holds, in order: from `frame`, its middle at (x, y); `cut` when it got there by cutting. */
export interface Place { frame: number; x: number; y: number; cut: boolean }

/** The camera's places for player `id`'s clicks. */
export function placesOf(commands: readonly Command[], id: number, o: Pick<TrackOptions, "view" | "map" | "rate" | "start">): Place[] {
  const w = o.view.width, h = o.view.height;
  // Before the player's first click, where it is (a melee game's starts are dealt out, so the map's own start location
  // for their slot may be another's); a player who never clicks, their start location, else the map's middle.
  const firstClick = commands.find((c) => c.player === id && clickOf(c) !== null);
  const first = (firstClick && clickOf(firstClick)) ?? o.start ?? { x: o.map.width / 2, y: o.map.height / 2 };
  const places: Place[] = [{ frame: 0, x: first.x, y: first.y, cut: true }];
  let here = { ...first }, since = 0, clicked = false;
  let pending: { x: number; y: number; n: number } | null = null;
  const hold = HOLD_SECONDS * o.rate;
  const off = (a: { x: number; y: number }, b: { x: number; y: number }, share: number) => Math.abs(a.x - b.x) > (share * w) / 2 || Math.abs(a.y - b.y) > (share * h) / 2;
  for (const c of commands) {
    if (c.player !== id) continue;
    const p = clickOf(c);
    if (!p) continue;
    // The first click is where the player is: the camera goes there at once.
    if (!clicked) {
      clicked = true;
      if (off(p, here, NEAR)) { here = { ...p }; since = c.frame; places.push({ frame: c.frame, x: p.x, y: p.y, cut: Math.max(Math.abs(p.x - first.x) / w, Math.abs(p.y - first.y) / h) > CUT }); continue; }
    }
    if (!off(p, here, NEAR)) {
      pending = null;
      // Drawn along, so the click comes inside the dead zone, rather than recentred on every click.
      if (off(p, here, DEAD)) {
        const zx = (DEAD * w) / 2, zy = (DEAD * h) / 2;
        const nx = Math.abs(p.x - here.x) > zx ? p.x - Math.sign(p.x - here.x) * zx : here.x;
        const ny = Math.abs(p.y - here.y) > zy ? p.y - Math.sign(p.y - here.y) * zy : here.y;
        here = { x: nx, y: ny };
        places.push({ frame: c.frame, x: nx, y: ny, cut: false });
      }
      continue;
    }
    if (pending && !off(p, pending, NEAR)) { pending.x += (p.x - pending.x) / (pending.n + 1); pending.y += (p.y - pending.y) / (pending.n + 1); pending.n++; }
    else pending = { x: p.x, y: p.y, n: 1 };
    if (pending.n >= CLICKS && c.frame - since >= hold) {
      const cut = Math.max(Math.abs(pending.x - here.x) / w, Math.abs(pending.y - here.y) / h) > CUT;
      here = { x: pending.x, y: pending.y };
      since = c.frame;
      places.push({ frame: c.frame, x: here.x, y: here.y, cut });
      pending = null;
    }
  }
  return places;
}

/** The track through `places`: held between them, cut or panned to each, eased forward and back, kept on the map. */
export function trackOf(places: readonly Place[], o: TrackOptions): Track {
  const w = Math.max(1, o.view.width), h = Math.max(1, o.view.height);
  const clampX = (x: number) => (o.map.width <= w ? o.map.width / 2 : Math.max(w / 2, Math.min(o.map.width - w / 2, x)));
  const clampY = (y: number) => (o.map.height <= h ? o.map.height / 2 : Math.max(h / 2, Math.min(o.map.height - h / 2, y)));
  const n = Math.floor(Math.max(0, o.frames) / EVERY) + 2;
  const rawX = new Float32Array(n), rawY = new Float32Array(n), cut = new Uint8Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const frame = i * EVERY;
    let cutHere = i === 0;
    while (k + 1 < places.length && places[k + 1].frame <= frame) { k++; if (places[k].cut) cutHere = true; }
    rawX[i] = clampX(places[k].x); rawY[i] = clampY(places[k].y);
    if (cutHere) cut[i] = 1;
  }
  const sigma = Math.max(EASE.fewestFrames, Math.min(EASE.mostFrames, EASE.seconds * Math.max(1, o.rate))) / EVERY;
  const reach = Math.ceil(sigma * 3), bell = new Float64Array(reach + 1);
  for (let j = 0; j <= reach; j++) bell[j] = Math.exp(-(j * j) / (2 * sigma * sigma));
  const x = new Float32Array(n), y = new Float32Array(n);
  for (let from = 0; from < n;) {
    let to = from + 1;
    while (to < n && !cut[to]) to++;
    for (let i = from; i < to; i++) {
      let sx = 0, sy = 0, sw = 0;
      for (let j = Math.max(from, i - reach), last = Math.min(to - 1, i + reach); j <= last; j++) {
        const b = bell[Math.abs(j - i)];
        sx += rawX[j] * b; sy += rawY[j] * b; sw += b;
      }
      x[i] = sx / sw; y[i] = sy / sw;
    }
    from = to;
  }
  return { every: EVERY, x, y, cut };
}

/** The camera track that follows player `id` through the game. */
export function followTrack(commands: readonly Command[], id: number, o: TrackOptions): Track {
  return trackOf(placesOf(commands, id, o), o);
}

/* ── From the game itself: where the player's army is, and where it fights ── */

/**
 * A moment of the game as the replay runner reports it (scm-sim `runReplay.ts`, what `replay watch` draws): every unit
 * as four numbers, x and y in map pixels, owner (the game's player number) and class (0 other, 1 worker, 2 army,
 * 3 building, 4 resource).
 */
export interface Sample { frame: number; units: readonly number[] }
/** Where the camera means to look at a moment, and whether a fight is there. */
export interface Aim { frame: number; x: number; y: number; fight: boolean }

const WORKER = 1, ARMY = 2, BUILDING = 3;
/** A unit of the player's army this near something of an enemy's is in a fight (map pixels: seven tiles). */
const ENGAGED = 224;
/** Units of the player's that make a fight. */
const FIGHT_UNITS = 3;

/** The middle of the units (indices into `u`, a unit every four numbers) that most of them share a view with. */
function densest(u: readonly number[], list: number[], w: number, h: number): { x: number; y: number; n: number } {
  let best = -1, bestN = 0;
  for (const i of list) {
    let n = 0;
    for (const j of list) if (Math.abs(u[j] - u[i]) <= w / 2 && Math.abs(u[j + 1] - u[i + 1]) <= h / 2) n++;
    if (n > bestN) { bestN = n; best = i; }
  }
  let x = 0, y = 0, n = 0;
  for (const j of list) if (Math.abs(u[j] - u[best]) <= w / 2 && Math.abs(u[j + 1] - u[best + 1]) <= h / 2) { x += u[j]; y += u[j + 1]; n++; }
  return { x: x / n, y: y / n, n };
}

/**
 * Where to look for player `owner` at one moment: the biggest fight their army is in (their units and the enemy's
 * there), else where most of their army stands, else where most of their workers and buildings are; null when they
 * have nothing left.
 */
export function aimOf(units: readonly number[], owner: number, view: { width: number; height: number }): { x: number; y: number; fight: boolean } | null {
  const army: number[] = [], home: number[] = [], enemy: number[] = [];
  for (let i = 0; i + 3 < units.length; i += 4) {
    const o = units[i + 2], c = units[i + 3];
    if (o === owner) { if (c === ARMY) army.push(i); else if (c === WORKER || c === BUILDING) home.push(i); }
    else if (o < 8 && (c === ARMY || c === WORKER || c === BUILDING)) enemy.push(i);
  }
  const r2 = ENGAGED * ENGAGED;
  const engaged: number[] = [];
  for (const i of army) {
    for (const j of enemy) {
      const dx = units[i] - units[j], dy = units[i + 1] - units[j + 1];
      if (dx * dx + dy * dy <= r2) { engaged.push(i); break; }
    }
  }
  // (A lone unit by an enemy is a scout or an overlord watching, not a fight: the class does not tell them apart.)
  if (engaged.length >= FIGHT_UNITS) {
    // The fight's middle: the player's units in it and the enemy's within reach of them, in the busiest view.
    const near = enemy.filter((j) => engaged.some((i) => { const dx = units[i] - units[j], dy = units[i + 1] - units[j + 1]; return dx * dx + dy * dy <= r2; }));
    const at = densest(units, [...engaged, ...near], view.width * 0.8, view.height * 0.8);
    return { x: at.x, y: at.y, fight: true };
  }
  if (army.length) { const at = densest(units, army, view.width * 0.8, view.height * 0.8); return { x: at.x, y: at.y, fight: false }; }
  if (home.length) { const at = densest(units, home, view.width * 0.8, view.height * 0.8); return { x: at.x, y: at.y, fight: false }; }
  return null;
}

/** How long an aim elsewhere must last before the camera goes there (seconds of the clip): a fight sooner. */
const SETTLE = { fight: 0.4, other: 1.0 };
/** The dead zone for a fight: smaller, so the camera keeps it nearer the middle. */
const DEAD_FIGHT = 0.2;

/** The camera's places from the aims: drawn along within a view, moving on once an aim elsewhere has lasted. */
export function placesFromAims(aims: readonly Aim[], o: Pick<TrackOptions, "view" | "rate">): Place[] {
  if (!aims.length) return [];
  const w = o.view.width, h = o.view.height;
  const off = (a: { x: number; y: number }, b: { x: number; y: number }, share: number) => Math.abs(a.x - b.x) > (share * w) / 2 || Math.abs(a.y - b.y) > (share * h) / 2;
  let here = { x: aims[0].x, y: aims[0].y };
  const places: Place[] = [{ frame: 0, x: here.x, y: here.y, cut: true }];
  let since = -1;
  for (const a of aims) {
    if (!off(a, here, NEAR)) {
      since = -1;
      const dead = a.fight ? DEAD_FIGHT : DEAD;
      if (off(a, here, dead)) {
        const zx = (dead * w) / 2, zy = (dead * h) / 2;
        here = { x: Math.abs(a.x - here.x) > zx ? a.x - Math.sign(a.x - here.x) * zx : here.x, y: Math.abs(a.y - here.y) > zy ? a.y - Math.sign(a.y - here.y) * zy : here.y };
        places.push({ frame: a.frame, x: here.x, y: here.y, cut: false });
      }
      continue;
    }
    if (since < 0) since = a.frame;
    if (a.frame - since >= (a.fight ? SETTLE.fight : SETTLE.other) * o.rate) {
      const cut = Math.max(Math.abs(a.x - here.x) / w, Math.abs(a.y - here.y) / h) > CUT;
      here = { x: a.x, y: a.y };
      places.push({ frame: a.frame, x: a.x, y: a.y, cut });
      since = -1;
    }
  }
  return places;
}

/** The camera track on player `owner`'s play, from moments of the game; null when they had nothing in any of them. */
export function actionTrack(samples: readonly Sample[], owner: number, o: TrackOptions): Track | null {
  const aims: Aim[] = [];
  for (const s of samples) { const a = aimOf(s.units, owner, o.view); if (a) aims.push({ frame: s.frame, ...a }); }
  const places = placesFromAims(aims, o);
  return places.length ? trackOf(places, o) : null;
}
