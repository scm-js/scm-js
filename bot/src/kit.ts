/**
 * The friendly layer over `BOT_API`: units as objects with their orders on them, the race's
 * own words, counts that include what is on its way, and the game's traps handled once — a building that gets its
 * builder, its money and its site, and starts again when the game turned the builder away.
 *
 * A bot uses it by exporting `onFrame(game)` instead of `create(init)`:
 *
 *   export default {
 *     name: "Starter",
 *     onFrame(game) {
 *       game.mine();                           // idle workers to the minerals, three to each gas
 *       game.keepSupply();                     // a depot, pylon or overlord before supply runs out
 *       game.want(game.race.worker, 18);       // train workers up to 18, counting the ones on their way
 *       game.want("Barracks", 2);              // two barracks: a builder, the money, a site, retries
 *       game.want("Marine", 40);
 *       if (game.army.length >= 12) game.army.attack(game.enemyBase());
 *     },
 *   };
 *
 * Every host takes this shape (the host wraps it with `easyBot`), so a bot written this way runs wherever a bot
 * runs, as one plain file with no imports. Underneath it is `BOT_API` 1: `game.view` and `game.api` are there for
 * anything the layer does not cover. It imports nothing but `api.ts`, so the two files can be copied next to a bot
 * together.
 */
import { TECH_ORDERS, type BotApi, type BotPlacement, type BotData, type BotInit, type BotModule, type BotResult, type BotStartLocation, type BotUnit, type BotView, type TechTypeInfo, type UnitTypeInfo, type UpgradeTypeInfo, type VisibleUnit } from "./api.ts";

/* ── The module ─────────────────────────────────────────────────────────────────────────── */

/** A bot written on the friendly layer: the default export of its module. */
export interface EasyBot {
  name: string;
  version?: string;
  author?: string;
  /** Frames between two calls of `onFrame` (8 unless set; 24 is a second of game time). */
  frameInterval?: number;
  /** Once, before the first frame. */
  onStart?(game: Game): void | Promise<void>;
  /** Every few frames. May be async; while it runs no other frame is delivered. */
  onFrame(game: Game): void | Promise<void>;
  onEnd?(result: BotResult, game: Game): void;
  /** One of the bot's units is finished (a building built, a unit out of its egg or its building). */
  onUnitComplete?(unit: Unit, game: Game): void;
  /** One of the bot's units died (or turned into something else the game counts as a new unit: an Archon's templar). */
  onUnitDestroy?(unit: Unit, game: Game): void;
  /** Another player's unit came into sight for the first time. */
  onEnemySeen?(enemy: Seen, game: Game): void;
}

/** Whether a module's default export is written on the friendly layer (`onFrame` and no `create`). */
export function isEasyBot(m: unknown): m is EasyBot {
  const b = m as Partial<EasyBot & BotModule> | null;
  return !!b && typeof b === "object" && typeof b.create !== "function" && typeof b.onFrame === "function";
}

/** A `BotModule` that runs an `EasyBot`. */
export function easyBot(bot: EasyBot): BotModule {
  return {
    name: bot.name, version: bot.version, author: bot.author, frameInterval: bot.frameInterval,
    async create(init) {
      const game = new Game(init, bot);
      let started = false;
      return {
        async onFrame(view, api) {
          game.update(view, api);
          if (!started) { started = true; await bot.onStart?.(game); }
          await bot.onFrame(game);
        },
        onEnd(result) { bot.onEnd?.(result, game); },
      };
    },
  };
}

/* ── Units ──────────────────────────────────────────────────────────────────────────────── */

export interface Point { x: number; y: number }
/** A unit type by id or by name: "Terran_Marine", "Marine", "marine", "Siege Tank" (the bot's own race first). */
export type TypeRef = number | string;
/** Where to aim: a unit (yours or one you see), a unit id, or a point in map pixels. */
export type Target = number | Point;

const TILE = 32;
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** A unit of anyone's as last seen: another player's, a neutral one, or (as `Unit`) one of the bot's own. */
// The fields of `VisibleUnit` are copied onto the object each view.
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
export interface Seen extends VisibleUnit {}
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
export class Seen {
  /** False once the unit is known to be gone: dead, or (for an enemy) its place seen empty. */
  alive = true;
  /** In sight in the current view. */
  visible = true;
  /** The frame it was last in sight. */
  lastSeen = 0;
  /** Yours to keep anything on. */
  memory: Record<string, unknown> = {};
  readonly game: Game;
  constructor(game: Game, from: VisibleUnit) { this.game = game; Object.assign(this, from); this.lastSeen = game.frame; }
  /** The unit type's table entry. */
  get info(): UnitTypeInfo { return this.game.info(this.type); }
  /** The unit type's name ("Terran_Marine"). */
  get name(): string { return this.info.name; }
  get tileX(): number { return Math.floor(this.x / TILE); }
  get tileY(): number { return Math.floor(this.y / TILE); }
  get isBuilding(): boolean { return this.info.isBuilding; }
  get isWorker(): boolean { return this.info.isWorker; }
  /** Whether it is of one of these types. */
  is(...types: TypeRef[]): boolean { return types.some((t) => this.game.type(t) === this.type); }
  distanceTo(p: Point): number { return distance(this, p); }
}

/** One of the bot's own units, with its orders on it. Orders are collected and sent when `onFrame` is done. */
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
export interface Unit extends BotUnit {}
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
export class Unit extends Seen {
  /** The building this worker was sent to put up by `game.build`, or null. */
  job: BuildJob | null = null;
  /** The mineral field it mines (or was last sent to), or -1. */
  field = -1;
  /** The gas building it works (or was last sent to), or -1. */
  gasAt = -1;
  /** @internal */
  sentAt = 0;
  get api(): BotApi { return this.game.api; }

  /**
   * Attack a unit, or attack-move to a point. `attack`, `move` and `patrol` are not sent again to a unit that is busy
   * with the same one (the same kind, to the same unit or within a tile and a half of the same point): a fresh order
   * makes a unit drop the shot or the heal it is in the middle of, and a bot that repeats its orders every frame would
   * have an army that never fires. `queued` orders always go.
   */
  attack(target: Target, queued?: boolean): this { if (this.fresh("attack", target, queued)) this.api.attack(this.id, this.game.aim(target), queued); return this; }
  move(to: Point, queued?: boolean): this { if (this.fresh("move", to, queued)) this.api.move(this.id, to.x, to.y, queued); return this; }
  patrol(to: Point, queued?: boolean): this { if (this.fresh("patrol", to, queued)) this.api.patrol(this.id, to.x, to.y, queued); return this; }
  /** The last attack, move or patrol the layer sent this unit. */
  private last: { kind: string; target: number; x: number; y: number } | null = null;
  /** @internal Whether an order is new for this unit (and, if so, remembered as its last). */
  fresh(kind: string, target: Target, queued?: boolean): boolean {
    const aim = this.game.aim(target), id = typeof aim === "number" ? aim : -1, x = typeof aim === "number" ? 0 : aim.x, y = typeof aim === "number" ? 0 : aim.y;
    const l = this.last;
    if (!queued && l && !this.isIdle && l.kind === kind && l.target === id && (id >= 0 || Math.hypot(l.x - x, l.y - y) <= 48)) return false;
    this.last = { kind, target: id, x, y };
    return true;
  }
  rightClick(target: Target, queued?: boolean): this { this.api.rightClick(this.id, this.game.aim(target), queued); return this; }
  /** A mineral field or a gas building; without one, the least busy field of the nearest base. */
  gather(resource?: Target): this { this.game.sendToMine(this, resource); return this; }
  returnCargo(queued?: boolean): this { this.api.returnCargo(this.id, queued); return this; }
  stop(): this { this.api.stop(this.id); return this; }
  hold(): this { this.api.holdPosition(this.id); return this; }
  /** Train (or, for a larva, morph into) a unit here: an order as is, the price not checked. `game.train` checks. */
  train(type: TypeRef): this { this.api.train(this.id, this.game.type(type)); return this; }
  /** Build with this worker, top-left at the tile: an order as is. `game.build` finds the site and watches. */
  build(type: TypeRef, tileX: number, tileY: number): this { this.api.build(this.id, this.game.type(type), tileX, tileY); return this; }
  buildAddon(type: TypeRef): this { this.api.buildAddon(this.id, this.game.type(type)); return this; }
  morph(type: TypeRef): this { this.api.morph(this.id, this.game.type(type)); return this; }
  research(tech: TypeRef): this { this.api.research(this.id, this.game.techType(tech)); return this; }
  /** The next level of an upgrade here (`upgrade`, the field, is the one under way). */
  startUpgrade(upgrade: TypeRef): this { this.api.upgrade(this.id, this.game.upgradeType(upgrade)); return this; }
  /** Cast a spell (by tech) at a unit or a point. */
  useTech(tech: TypeRef, target: Target): this { this.api.useTech(this.id, this.game.techType(tech), this.game.aim(target)); return this; }
  repair(target: Target, queued?: boolean): this { this.api.repair(this.id, this.game.idOf(target), queued); return this; }
  heal(target: Target, queued?: boolean): this { this.api.heal(this.id, this.game.aim(target), queued); return this; }
  load(transport: Target): this { this.api.load(this.id, this.game.idOf(transport)); return this; }
  unloadAll(at?: Point): this { if (at) this.api.unloadAllAt(this.id, at.x, at.y); else this.api.unloadAll(this.id); return this; }
  setRally(target: Target): this { this.api.setRallyPoint(this.id, this.game.aim(target)); return this; }
  siege(): this { this.api.siege(this.id); return this; }
  unsiege(): this { this.api.unsiege(this.id); return this; }
  burrow(): this { this.api.burrow(this.id); return this; }
  unburrow(): this { this.api.unburrow(this.id); return this; }
  stim(): this { this.api.stim(this.id); return this; }
  cloak(): this { this.api.cloak(this.id); return this; }
  decloak(): this { this.api.decloak(this.id); return this; }
  lift(): this { this.api.lift(this.id); return this; }
  land(tileX: number, tileY: number): this { this.api.land(this.id, tileX, tileY); return this; }
  /** Calls off whatever is under way here: construction, the last unit queued, research, an upgrade, a morph. */
  cancel(): this {
    if (!this.isCompleted && this.info.isBuilding) this.api.cancelConstruction(this.id);
    else if (this.isMorphing) this.api.cancelMorph(this.id);
    else if (this.tech >= 0) this.api.cancelResearch(this.id);
    else if (this.upgrade >= 0) this.api.cancelUpgrade(this.id);
    else if (this.trainingQueue.length) this.api.cancelTrain(this.id);
    return this;
  }
}

/**
 * A list of units. It is an array (`filter`, `map`, `length`, `for … of` as usual; `filter` keeps it a `Units`), with
 * the questions a bot asks of a group, and orders that go to every one of the bot's own units in it.
 */
export class Units<T extends Seen = Unit> extends Array<T> {
  filter<S extends T>(test: (u: T, i: number, all: T[]) => u is S, thisArg?: unknown): Units<S>;
  filter(test: (u: T, i: number, all: T[]) => unknown, thisArg?: unknown): Units<T>;
  filter(test: (u: T, i: number, all: T[]) => unknown, thisArg?: unknown): Units<T> { return super.filter(test, thisArg) as Units<T>; }
  slice(start?: number, end?: number): Units<T> { return super.slice(start, end) as Units<T>; }
  get ids(): number[] { return this.map((u) => u.id) as unknown as number[]; }
  get first(): T | undefined { return this[0]; }
  /** Finished ones. */
  get done(): Units<T> { return this.filter((u) => u.isCompleted); }
  /** Own units standing with nothing to do. */
  get idle(): Units<T> { return this.filter((u) => (u as unknown as Unit).isIdle === true); }
  /** The middle of the group, or null when it is empty. */
  get center(): Point | null {
    if (!this.length) return null;
    let x = 0, y = 0;
    for (const u of this) { x += u.x; y += u.y; }
    return { x: x / this.length, y: y / this.length };
  }
  /** Those of these types. */
  of(...types: TypeRef[]): Units<T> {
    if (!this.length) return this.filter(() => false);
    const ids = new Set(types.map((t) => this[0].game.type(t)));
    return this.filter((u) => ids.has(u.type));
  }
  where(test: (u: T) => boolean): Units<T> { return this.filter(test); }
  /** Those within `radius` pixels of the point. */
  near(p: Point, radius: number): Units<T> { return this.filter((u) => distance(u, p) <= radius); }
  nearest(p: Point): T | undefined { let best: T | undefined, d = Infinity; for (const u of this) { const e = distance(u, p); if (e < d) { d = e; best = u; } } return best; }
  farthest(p: Point): T | undefined { let best: T | undefined, d = -1; for (const u of this) { const e = distance(u, p); if (e > d) { d = e; best = u; } } return best; }
  /** Nearest first. */
  byDistance(p: Point): Units<T> { return this.slice().sort((a, b) => distance(a, p) - distance(b, p)) as Units<T>; }
  /** The first `n`. */
  take(n: number): Units<T> { return this.slice(0, n) as Units<T>; }

  private own(): Unit[] { return this.filter((u) => u instanceof Unit) as unknown as Unit[]; }
  private ordered(send: (game: Game, ids: number[]) => void, only?: (u: Unit) => boolean): this {
    const own = only ? this.own().filter(only) : this.own();
    if (own.length) send(own[0].game, own.map((u) => u.id));
    return this;
  }
  /**
   * Attack a unit, or attack-move to a point. Nothing happens when the target is null (no enemy base known yet). As
   * on a unit, a unit already busy with the same attack, move or patrol is left to it.
   */
  attack(target: Target | null | undefined, queued?: boolean): this { return target == null ? this : this.ordered((g, ids) => g.api.attack(ids, g.aim(target), queued), (u) => u.fresh("attack", target, queued)); }
  move(to: Point | null | undefined, queued?: boolean): this { return to == null ? this : this.ordered((g, ids) => g.api.move(ids, to.x, to.y, queued), (u) => u.fresh("move", to, queued)); }
  patrol(to: Point, queued?: boolean): this { return this.ordered((g, ids) => g.api.patrol(ids, to.x, to.y, queued), (u) => u.fresh("patrol", to, queued)); }
  rightClick(target: Target, queued?: boolean): this { return this.ordered((g, ids) => g.api.rightClick(ids, g.aim(target), queued)); }
  /** Every worker here to a resource; without one, each to the least busy field of its nearest base. */
  gather(resource?: Target): this { for (const u of this.own()) u.gather(resource); return this; }
  returnCargo(): this { return this.ordered((g, ids) => g.api.returnCargo(ids)); }
  stop(): this { return this.ordered((g, ids) => g.api.stop(ids)); }
  hold(): this { return this.ordered((g, ids) => g.api.holdPosition(ids)); }
  siege(): this { return this.ordered((g, ids) => g.api.siege(ids)); }
  unsiege(): this { return this.ordered((g, ids) => g.api.unsiege(ids)); }
  burrow(): this { return this.ordered((g, ids) => g.api.burrow(ids)); }
  unburrow(): this { return this.ordered((g, ids) => g.api.unburrow(ids)); }
  stim(): this { return this.ordered((g, ids) => g.api.stim(ids)); }
  load(transport: Target): this { return this.ordered((g, ids) => g.api.load(ids, g.idOf(transport))); }
  setRally(target: Target): this { return this.ordered((g, ids) => g.api.setRallyPoint(ids, g.aim(target))); }
}

/* ── Buildings on their way ─────────────────────────────────────────────────────────────── */

/** Frames a worker gets to reach its site and start, and frames it may stand still on the way. */
const WALK_PATIENCE = 400, STAND_PATIENCE = 96;
/** Frames before an order's effect can be counted on to show in a view (a network game's turns included). */
const ORDER_LAG = 24;
/** Frames an order that has not shown is still counted on (money, supply, the producer); then it was refused. */
const PENDING_LIMIT = 48;
/** Frames a worker that had to be called off is not chosen again. */
const REST = 720;
/** Builders called off before a building is given up. */
const TRIES = 3;
/** Frames a site the game named is trusted. */
const SITE_FRESH = 96;
/** Sites tried (or, for a site named, times the builder was turned away) before a building is given up. */
const MAX_ATTEMPTS = 8;
/** A builder farther than this from its site walks there first, and is given the building on arrival. */
const NEAR = 10 * TILE;
/** Frames after which a building asked for by `want`, still waiting for its money, is dropped when its line has stopped running. */
const FORGOTTEN = 240;
/** Frames a building waits, without counting it a failure, after enemies were found on its site. */
const THREAT_PAUSE = 96;

export type JobState = "waiting" | "asking" | "sited" | "walking" | "started" | "failed";

/**
 * One building asked for with `game.build` (or `game.want`). It waits until the tech tree allows it and the money is
 * there (keeping the price aside from then on, so nothing else spends it), asks the game for a site, sends the nearest
 * free worker, and watches: a builder that is turned away, killed, or takes too long is replaced, and after three it
 * gives up (`failed`). It is done (`started`) when the building stands; the game has taken the price then.
 */
export class BuildJob {
  state: JobState = "waiting";
  readonly type: number;
  /** Where to look around; a pylon's for a protoss building, the base's geyser for a gas building. */
  near: Point | null;
  site: { tileX: number; tileY: number } | null = null;
  builder: Unit | null = null;
  /** The building, once it stands. */
  building: Unit | null = null;
  /** Why it failed. */
  reason = "";
  /** Places looked around so far (where to look next). */
  attempt = 0;
  /** Sites the game named that would not do, or turned the builder away from: after `MAX_ATTEMPTS`, it is given up. */
  failures = 0;
  calledOff = 0;
  since = 0;
  notBefore = 0;
  answer: { tileX: number; tileY: number } | null | undefined = undefined;
  stood: { x: number; y: number; since: number } | null = null;
  /** The site it must go on, when the bot (or `expand`) named one. */
  fixed: { tileX: number; tileY: number } | null = null;
  /**
   * The builder is on its way to a site far off or on ground nobody has seen yet (the game takes no building there
   * until it is in sight). The building is ordered once the builder is near and the site in sight; until then its
   * price is not kept, so a long walk does not hold the money up.
   */
  approaching = false;
  /** Frames the builder gets to reach the site, from how far it had to go. */
  patience = 0;
  /**
   * Asked for by `want` (or `make`, `keepSupply`): its money is kept at the point in the bot's turn where that line
   * runs, each frame, until a site is being sought; until then what the bot orders before that line comes first.
   * A building asked for once (`build`, `expand`) keeps its money from the start of every frame.
   */
  wanted = false;
  /** @internal The frame its line last ran. */
  touched = -1;
  /** The game's word on the site when the builder was last turned away. */
  refused: BotPlacement | undefined = undefined;
  constructor(type: number, near: Point | null) { this.type = type; this.near = near; }
  /** Still to be paid for and placed. */
  get open(): boolean { return this.state !== "started" && this.state !== "failed"; }
}

/* ── Bases ──────────────────────────────────────────────────────────────────────────────── */

export interface Base extends Point {
  /** The tile a town hall would go on, as near the resources as the game allows; null until known. */
  hall: { tileX: number; tileY: number } | null;
  minerals: { id: number; type: number; x: number; y: number }[];
  geysers: { id: number; type: number; x: number; y: number }[];
  /** A start location's base. */
  isStart: boolean;
}

/** Groups the map's resources into bases: fields and geysers within reach of one another. */
function findBases(init: BotInit): Base[] {
  const geyserTypes = new Set(init.data.units.filter((u) => u && isGeyserType(init.data, u.id)).map((u) => u.id));
  const groups: { x: number; y: number; members: typeof init.map.resources }[] = [];
  for (const r of init.map.resources) {
    if (r.resources <= 0 && !geyserTypes.has(r.type)) continue;
    const g = groups.find((g) => g.members.some((m) => distance(m, r) <= 8 * TILE));
    if (g) g.members.push(r); else groups.push({ x: r.x, y: r.y, members: [r] });
  }
  const bases: Base[] = [];
  for (const g of groups) {
    const minerals = g.members.filter((m) => !geyserTypes.has(m.type)), geysers = g.members.filter((m) => geyserTypes.has(m.type));
    if (minerals.length < 4) continue;
    const x = g.members.reduce((s, m) => s + m.x, 0) / g.members.length, y = g.members.reduce((s, m) => s + m.y, 0) / g.members.length;
    const start = init.map.startLocations.find((s) => distance(s, { x, y }) < 12 * TILE);
    bases.push({
      x: start?.x ?? x, y: start?.y ?? y, hall: start ? { tileX: start.tileX, tileY: start.tileY } : null, isStart: !!start,
      minerals: minerals.map(({ id, type, x, y }) => ({ id, type, x, y })), geysers: geysers.map(({ id, type, x, y }) => ({ id, type, x, y })),
    });
  }
  return bases;
}

/**
 * Where a town hall goes at a base: on buildable ground, no nearer the resources than the game allows (three tiles
 * between it and any field or geyser), and of those spots the one nearest them all.
 */
function hallSpot(init: BotInit, base: Base, hall: UnitTypeInfo): { tileX: number; tileY: number } | null {
  const { width, height, buildable } = init.map, w = hall.tileWidth || 4, h = hall.tileHeight || 3;
  const resources = [...base.minerals, ...base.geysers];
  const zones = init.map.resources.filter((r) => distance(r, base) < 20 * TILE).map((r) => {
    const i = init.data.units[r.type], rw = i?.tileWidth || 2, rh = i?.tileHeight || 1;
    const left = Math.round(r.x / TILE - rw / 2), top = Math.round(r.y / TILE - rh / 2);
    return { left: left - 3, top: top - 3, right: left + rw + 3, bottom: top + rh + 3 };
  });
  const cx = Math.floor(base.x / TILE), cy = Math.floor(base.y / TILE);
  let best: { tileX: number; tileY: number } | null = null, score = Infinity;
  for (let ty = cy - 12; ty <= cy + 12; ty++) {
    for (let tx = cx - 12; tx <= cx + 12; tx++) {
      if (tx < 0 || ty < 0 || tx + w > width || ty + h > height) continue;
      if (zones.some((z) => tx < z.right && tx + w > z.left && ty < z.bottom && ty + h > z.top)) continue;
      let ground = true;
      for (let y = ty; y < ty + h && ground; y++) for (let x = tx; x < tx + w; x++) if (!buildable[y * width + x]) { ground = false; break; }
      if (!ground) continue;
      const c = { x: (tx + w / 2) * TILE, y: (ty + h / 2) * TILE };
      const sc = resources.reduce((n, r) => n + distance(c, r), 0);
      if (sc < score) { score = sc; best = { tileX: tx, tileY: ty }; }
    }
  }
  return best;
}

/** `{ save: true }`: when only the money is missing, keep the price aside for the rest of the frame. */
export interface SaveOption { save?: boolean }

/* ── The game ───────────────────────────────────────────────────────────────────────────── */

interface Pending { producer: number; kind: "train" | "morph" | "addon" | "research" | "upgrade"; what: number; minerals: number; gas: number; supply: number; count: number; frame: number }

/** The race's own words: what this bot's race calls its worker, its town hall and so on (unit type ids). */
export interface RaceWords {
  /** `Races.*`. */
  id: number;
  name: "Zerg" | "Terran" | "Protoss" | string;
  worker: number;
  hall: number;
  /** Overlord, Supply Depot or Pylon. */
  supply: number;
  /** Extractor, Refinery or Assimilator. */
  gas: number;
}

/**
 * The game's own type ids the layer leans on. They are the game's slots, not names, so they hold in a mod's game too
 * (where the mod calls its units its own way: Cosmonarchy's type 7, the terran worker, is the Mason).
 */
const ID = {
  Larva: 35, Egg: 36, Cocoon: 59, LurkerEgg: 97, Interceptor: 73, Scarab: 85, SpiderMine: 13, NuclearMissile: 14,
  Carrier: 72, Reaver: 83, Pylon: 156, Archon: 68, DarkArchon: 63, Geyser: 188,
} as const;

/** Each race's worker, town hall, supply provider and gas building, by the game's ids. */
const RACE_WORDS: Record<number, { name: string; worker: number; hall: number; supply: number; gas: number }> = {
  0: { name: "Zerg", worker: 41, hall: 131, supply: 42, gas: 149 },
  1: { name: "Terran", worker: 7, hall: 106, supply: 109, gas: 110 },
  2: { name: "Protoss", worker: 64, hall: 154, supply: 156, gas: 157 },
};

/** Whether a type is a geyser: the game's, or a resource with a geyser's footprint (a mod's own). */
const isGeyserType = (data: BotData, t: number): boolean => t === ID.Geyser || (!!data.units[t]?.isResourceContainer && !data.units[t].isRefinery && data.units[t].tileWidth >= 4);

/** What `onFrame` is handed: the bot's view of the game, kept up to date between frames, and what it can do. */
export class Game {
  readonly init: BotInit;
  readonly data: BotData;
  /** This bot's player number. */
  readonly self: number;
  readonly race: RaceWords;
  /** Our start location. */
  readonly home: BotStartLocation;
  /** Every base on the map (clusters of mineral fields), nearest to home first. */
  readonly bases: Base[];
  /** Yours to keep anything on between frames. */
  memory: Record<string, unknown> = {};

  frame = 0;
  view!: BotView;
  api!: BotApi;
  /** All of the bot's own units, buildings included, finished or not. */
  units = new Units<Unit>();
  /** Finished workers that are not building anything. */
  workers = new Units<Unit>();
  /** Finished fighting units: not workers, buildings, larvae, eggs, overlords or interceptors. */
  army = new Units<Unit>();
  buildings = new Units<Unit>();
  /** Larvae no order has been given to yet. */
  larvae = new Units<Unit>();
  /** Other players' units in sight now. */
  enemies = new Units<Seen>();
  /** Every other player's unit seen and not known to be gone, as last seen (`visible` false when out of sight). */
  enemyMemory = new Units<Seen>();
  /** Mineral fields, geysers and critters in sight now. */
  neutral = new Units<Seen>();
  /** Buildings asked for and not yet standing. */
  jobs: BuildJob[] = [];

  private readonly bot: EasyBot;
  private readonly byId = new Map<number, Unit>();
  private readonly seen = new Map<number, Seen>();
  private readonly pending: Pending[] = [];
  private readonly resting = new Map<number, number>();
  private readonly mineralIds: Set<number>;
  private readonly names: { units: (r: string) => number; techs: (r: string) => number; upgrades: (r: string) => number };
  private purse = { minerals: 0, gas: 0 };
  /** Supply free, in halves, less what this frame's orders use. */
  private room = 0;
  private usedLarvae = new Set<number>();
  private busy = new Set<number>();

  constructor(init: BotInit, bot: EasyBot) {
    this.init = init;
    this.data = init.data;
    this.self = init.self;
    this.bot = bot;
    const w = RACE_WORDS[init.race] ?? RACE_WORDS[1];
    this.race = { id: init.race, ...w };
    this.home = init.map.startLocations.find((s) => s.player === init.self) ?? init.map.startLocations[0];
    this.mineralIds = new Set(init.map.resources.filter((r) => r.resources > 0 && !isGeyserType(init.data, r.type)).map((r) => r.id));
    this.bases = findBases(init).sort((a, b) => distance(a, this.home) - distance(b, this.home));
    for (const b of this.bases) b.hall ??= hallSpot(init, b, init.data.units[this.race.hall]);
    const prefix = w.name.toLowerCase();
    this.names = { units: resolver(init.data.UnitTypes, prefix, "unit type"), techs: resolver(init.data.TechTypes, prefix, "tech"), upgrades: resolver(init.data.UpgradeTypes, prefix, "upgrade") };
  }

  /* ── Names and tables ── */

  /** A unit type's id from its id or its name; throws on a name the game does not know. */
  type(ref: TypeRef): number { return typeof ref === "number" ? ref : this.names.units(ref); }
  techType(ref: TypeRef): number { return typeof ref === "number" ? ref : this.names.techs(ref); }
  upgradeType(ref: TypeRef): number { return typeof ref === "number" ? ref : this.names.upgrades(ref); }
  info(ref: TypeRef): UnitTypeInfo { return this.data.units[this.type(ref)]; }
  techInfo(ref: TypeRef): TechTypeInfo { return this.data.techs[this.techType(ref)]; }
  upgradeInfo(ref: TypeRef): UpgradeTypeInfo { return this.data.upgrades[this.upgradeType(ref)]; }

  /* ── Money and supply ── */

  /** Minerals not yet spent this frame and not kept for a building asked for. */
  get minerals(): number { return Math.max(0, this.purse.minerals); }
  get gas(): number { return Math.max(0, this.purse.gas); }
  /** In the game's own numbers (a zergling is ½), less what this frame's orders use. */
  get supply(): { used: number; total: number; free: number } {
    const total = this.view.self.supplyTotal / 2, free = this.room / 2;
    return { used: total - free, total, free };
  }
  /** Whether the price (and the supply) is there now. */
  canAfford(type: TypeRef): boolean {
    const i = this.info(type);
    return this.affords(i.mineralPrice, i.gasPrice) && (i.supplyRequired === 0 || this.room >= this.supplyCost(i));
  }
  /** Whether everything the tech tree asks for `type` is owned and finished (a protoss building's pylon included). */
  canMake(type: TypeRef): boolean {
    const i = this.info(type);
    if (i.requiresPsi && !this.units.some((u) => u.type === ID.Pylon && u.isCompleted)) return false;
    return i.requiredUnits.every((any) => any.some((t) => this.units.some((u) => u.type === t && u.isCompleted)));
  }

  /* ── Counting ── */

  /** Finished units of these types. */
  done(...types: TypeRef[]): Units<Unit> { return this.units.of(...types).done; }
  /** Units of a type that are on their way: in training, queued, in an egg or a cocoon, under construction, or asked for with `build`. */
  coming(type: TypeRef): number { return this.count(type) - this.done(type).length; }
  /** Units of a type finished and on their way. */
  count(type: TypeRef): number {
    const t = this.type(type), two = this.data.units[t]?.isTwoUnitsInOneEgg ? 2 : 1;
    let n = 0;
    for (const u of this.units) {
      if (u.type === t) n++;
      else if (u.buildType === t && u.isMorphing) n += this.info(u.type).isBuilding ? 1 : two;
      for (let i = 1; i < u.trainingQueue.length; i++) if (u.trainingQueue[i] === t) n++;
    }
    for (const p of this.pending) if (p.what === t && p.kind !== "research" && p.kind !== "upgrade") n += p.count;
    for (const j of this.jobs) if (j.type === t && j.open) n++;
    return n;
  }
  /** Buildings of a type asked for with `build` and not yet standing. */
  planned(type: TypeRef): number { const t = this.type(type); return this.jobs.filter((j) => j.type === t && j.open).length; }
  /** The level reached of an upgrade, or whether a tech is researched: `has("Stim_Packs")`. */
  has(tech: TypeRef): boolean { return this.view.self.techs.includes(this.techType(tech)); }
  level(upgrade: TypeRef): number { return this.view.self.upgrades[this.upgradeType(upgrade)] ?? 0; }

  /* ── Making things ── */

  /**
   * Have `n` of a type, counting the ones on their way: trains, morphs or builds what is missing, as far as the money,
   * the supply, the producers and the tech tree allow this frame. Call it every frame; it orders nothing once there
   * are enough. Returns how many it started.
   */
  want(type: TypeRef, n: number): number {
    const t = this.type(type);
    // The buildings of this type already asked for take their money here, in the order of the bot's lines.
    for (const j of this.jobs) if (j.type === t) this.touch(j);
    let made = 0;
    while (this.count(t) < n && this.make(t)) made++;
    return made;
  }

  /** One more of a type, whatever it takes: a building for a worker to `build`, anything else trained or morphed. */
  make(type: TypeRef): boolean {
    const t = this.type(type), i = this.data.units[t];
    if (!this.ours(t)) return false;
    // A gas building only where there is a geyser free at a base of ours: nothing is asked for until there is.
    if (i.isRefinery && !this.freeGeyser()) return false;
    if (i.isBuilding && this.data.units[i.whatBuilds]?.isWorker) { this.startJob(t, undefined, undefined, true); return true; }
    return this.train(t);
  }

  /**
   * Train one unit of a type now, if a producer is free and the money, the supply and the tech tree allow it: a larva
   * for a zerg unit, the building for an add-on or a zerg building's next form. Returns whether it was ordered.
   */
  train(type: TypeRef, options: SaveOption = {}): boolean {
    const t = this.type(type), i = this.data.units[t];
    if (!this.ours(t)) return false;
    if (!i || i.whatBuilds < 0 || !this.canMake(t)) return false;
    if (i.supplyRequired > 0 && this.room < this.supplyCost(i)) return false;
    const by = this.data.units[i.whatBuilds];
    const larva = ID.Larva;
    // Templar merge into archons (`api.mergeArchon`): nothing trains them.
    if (t === ID.Archon || t === ID.DarkArchon) return false;
    let producer: Unit | undefined, kind: Pending["kind"] = "train", count = 1;
    if (i.whatBuilds === larva) {
      producer = this.larvae.find((u) => !this.usedLarvae.has(u.id));
      count = i.isTwoUnitsInOneEgg ? 2 : 1;
    } else if (i.isAddon) {
      producer = this.producers(i.whatBuilds).find((u) => this.free(u) && u.addon < 0 && !u.isLifted);
      kind = "addon";
    } else if (by && by.race === this.data.Races.Zerg && (i.isBuilding || !by.isBuilding)) {
      producer = this.done(i.whatBuilds).find((u) => this.free(u) && !u.isMorphing);
      kind = "morph";
    } else {
      producer = this.producers(i.whatBuilds).find((u) => this.free(u) && u.isPowered !== false && !u.isLifted);
    }
    if (!producer) return false;
    // A producer is free: what is missing now is the money, which `save` keeps aside from here on in this frame.
    if (!this.affords(i.mineralPrice, i.gasPrice)) { if (options.save) this.save(t); return false; }
    if (kind === "train" && i.whatBuilds === larva) { this.usedLarvae.add(producer.id); this.api.train(producer.id, t); }
    else if (kind === "train") this.api.train(producer.id, t);
    else if (kind === "addon") this.api.buildAddon(producer.id, t);
    else this.api.morph(producer.id, t);
    this.busy.add(producer.id);
    this.spend(producer.id, kind, t, i.mineralPrice, i.gasPrice, this.supplyCost(i), count);
    return true;
  }

  /**
   * Ask for one building of a type: a free worker puts it up near `near` (home by default; a pylon for a protoss
   * building; the nearest free geyser for a gas building). The price is kept aside from the moment it can be paid.
   * Returns the job, to watch if you like (`job.state`).
   */
  build(type: TypeRef, near?: Point | { tileX: number; tileY: number }): BuildJob { return this.startJob(type, near); }

  private startJob(type: TypeRef, near?: Point | { tileX: number; tileY: number }, base?: Base, wanted = false): BuildJob {
    const t = this.type(type);
    if (!this.ours(t)) { const job = new BuildJob(t, null); job.state = "failed"; job.reason = "another race's building"; return job; }
    const fixed = near && "tileX" in near ? near : null;
    const job = new BuildJob(t, fixed ? null : (near as Point | undefined) ?? null);
    job.fixed = fixed;
    if (base) job.near = base;
    job.wanted = wanted;
    this.jobs.push(job);
    if (wanted) this.touch(job); else this.runJob(job);
    return job;
  }

  /** A town hall at the nearest base nobody has taken. Returns the job, or null when no base is free. */
  expand(): BuildJob | null {
    const base = this.freeBases()[0];
    if (!base) return null;
    return this.startJob(this.race.hall, base.hall ?? base, base);
  }
  /** Bases with a finished town hall of ours. */
  get ownBases(): Base[] {
    const halls = this.units.filter((u) => u.info.isResourceDepot && u.isCompleted);
    return this.bases.filter((b) => halls.some((h) => distance(h, b) < 10 * TILE));
  }
  /** Minerals left at a base: what its fields hold as last seen (as the map placed them, for a field not seen yet); a field seen gone counts nothing. */
  mineralsLeft(base: Base): number {
    const width = this.init.map.width;
    let n = 0;
    for (const f of base.minerals) {
      const seen = this.neutral.find((u) => u.id === f.id);
      if (seen) { this.fieldLeft.set(f.id, seen.resources); n += seen.resources; continue; }
      if (this.view.visibility[Math.floor(f.y / TILE) * width + Math.floor(f.x / TILE)] === 2) { this.fieldLeft.set(f.id, 0); continue; }
      n += this.fieldLeft.get(f.id) ?? this.init.map.resources.find((r) => r.id === f.id)?.resources ?? 0;
    }
    return n;
  }
  private readonly fieldLeft = new Map<number, number>();
  /** Bases an expansion to failed at, and until which frame `freeBases` leaves them out. */
  private readonly avoid = new Map<Base, number>();
  /** Bases with no town hall of anyone's known there, nearest home first. */
  freeBases(): Base[] {
    const halls = [...this.units.filter((u) => u.info.isResourceDepot), ...this.enemyMemory.filter((u) => u.info.isBuilding)];
    const asked = this.jobs.filter((j) => j.open && this.data.units[j.type].isResourceDepot).map((j) => j.near ?? (j.fixed && centre(this.data.units[j.type], j.fixed))).filter((p): p is Point => !!p);
    return this.bases.filter((b) => !halls.some((h) => distance(h, b) < 10 * TILE) && !asked.some((p) => distance(p, b) < 10 * TILE) && (this.avoid.get(b) ?? 0) <= this.frame);
  }

  /**
   * Keep a unit type's price aside for the rest of this frame, so nothing ordered after it spends the money:
   * `if (!game.train("Lair")) game.save("Lair")`. (Buildings asked for with `build` keep theirs on their own.)
   */
  save(type: TypeRef): void { const i = this.info(type); this.keep(i.mineralPrice, i.gasPrice); }
  private keep(minerals: number, gas: number): void { this.purse.minerals -= minerals; this.purse.gas -= gas; }

  /**
   * Research a tech at a free building of the right kind. Returns whether it was ordered. With `save`, when the
   * building is free and only the money is missing, the price is kept aside for the rest of the frame, so that what is
   * ordered after it does not spend the money it is being saved from (`upgrade` and `train` take it too).
   */
  research(tech: TypeRef, options: SaveOption = {}): boolean {
    const t = this.techType(tech), i = this.data.techs[t];
    if (!i || this.has(t) || this.researching(t)) return false;
    const at = this.producers(i.whatResearches).find((u) => this.free(u) && u.tech < 0 && u.upgrade < 0);
    if (!at) return false;
    if (!this.affords(i.mineralPrice, i.gasPrice)) { if (options.save) this.keep(i.mineralPrice, i.gasPrice); return false; }
    this.api.research(at.id, t);
    this.busy.add(at.id);
    this.spend(at.id, "research", t, i.mineralPrice, i.gasPrice, 0, 1);
    return true;
  }
  /** The next level of an upgrade at a free building of the right kind. Returns whether it was ordered. */
  upgrade(upgrade: TypeRef, options: SaveOption = {}): boolean {
    const t = this.upgradeType(upgrade), i = this.data.upgrades[t];
    if (!i) return false;
    const level = this.level(t);
    const minerals = i.mineralPrice + i.mineralPriceFactor * level, gas = i.gasPrice + i.gasPriceFactor * level;
    if (level >= i.maxRepeats || this.upgrading(t)) return false;
    const at = this.producers(i.whatUpgrades).find((u) => this.free(u) && u.tech < 0 && u.upgrade < 0);
    if (!at) return false;
    if (!this.affords(minerals, gas)) { if (options.save) this.keep(minerals, gas); return false; }
    this.api.upgrade(at.id, t);
    this.busy.add(at.id);
    this.spend(at.id, "upgrade", t, minerals, gas, 0, 1);
    return true;
  }
  researching(tech: TypeRef): boolean { const t = this.techType(tech); return this.units.some((u) => u.tech === t) || this.pending.some((p) => p.kind === "research" && p.what === t); }
  upgrading(upgrade: TypeRef): boolean { const t = this.upgradeType(upgrade); return this.units.some((u) => u.upgrade === t) || this.pending.some((p) => p.kind === "upgrade" && p.what === t); }

  /* ── The economy ── */

  /**
   * Keep the workers busy: idle ones to the least busy mineral field of their nearest base, and `gas` workers (3 by
   * default) on each finished gas building of ours; any more than that go back to the minerals.
   */
  mine(options: { gas?: number } = {}): void {
    const perGas = options.gas ?? 3;
    const refineries = this.units.filter((u) => u.isCompleted && u.info.isRefinery && this.units.some((h) => h.info.isResourceDepot && h.isCompleted && distance(h, u) < 12 * TILE));
    for (const r of refineries) {
      const workers = this.units.filter((w) => w.gasAt === r.id), on = workers.length;
      // More than asked for: the extra go back to the minerals (those not carrying gas first).
      for (const w of workers.sort((a, b) => Number(a.isCarryingGas) - Number(b.isCarryingGas)).slice(perGas)) {
        if (this.busy.has(w.id) || w.job) continue;
        w.gasAt = -1;
        w.sentAt = this.frame;
        this.sendToMine(w);
      }
      for (let k = on; k < perGas; k++) {
        const w = this.workers.filter((u) => !u.isCarryingMinerals && !u.isGatheringGas && !this.busy.has(u.id)).nearest(r) ?? this.workers.filter((u) => !u.isGatheringGas && !this.busy.has(u.id)).nearest(r);
        if (!w) break;
        this.api.gather(w.id, r.id);
        this.busy.add(w.id);
        w.field = -1;
        w.gasAt = r.id;
        w.sentAt = this.frame;
      }
    }
    for (const w of this.workers) if (w.isIdle && !this.busy.has(w.id)) this.sendToMine(w);
  }

  /**
   * One supply provider more whenever the supply left (counting the providers on their way) falls below `margin`
   * (by default 2 and 2 more for every building that trains, in the game's numbers). Nothing past 200.
   */
  keepSupply(options: { margin?: number } = {}): void {
    for (const j of this.jobs) if (j.type === this.race.supply) this.touch(j);
    if (this.view.self.supplyTotal >= 400) return;
    const zerg = this.race.id === this.data.Races.Zerg;
    const producers = this.units.filter((u) => u.isCompleted && u.info.isBuilding && ((zerg && u.info.isResourceDepot) || u.info.buildsWhat.some((t) => !this.data.units[t]?.isBuilding && this.data.units[t]?.supplyRequired > 0))).length;
    const margin = (options.margin ?? 2 + 2 * Math.max(1, producers)) * 2;
    const provided = this.data.units[this.race.supply].supplyProvided;
    const comingSupply = this.coming(this.race.supply) * provided;
    if (this.view.self.supplyTotal + comingSupply >= 400) return;
    if (this.room + comingSupply >= margin) return;
    // A hall on its way provides too.
    const halls = this.units.filter((u) => u.type === this.race.hall && !u.isCompleted).length * this.data.units[this.race.hall].supplyProvided;
    if (this.room + comingSupply + halls >= margin) return;
    // Saved for when it cannot be had this frame (no money yet, no larva), so nothing after this spends it.
    if (!this.make(this.race.supply)) this.save(this.race.supply);
  }

  /** Where the enemy is most likely to be: the nearest building of theirs known, else the nearest start of a seated enemy, else the nearest start not yet seen. */
  enemyBase(): Point | null {
    const buildings = this.enemyMemory.filter((u) => u.info.isBuilding && !u.isFlying);
    const halls = buildings.filter((u) => u.info.isResourceDepot);
    const known = halls.nearest(this.home) ?? buildings.nearest(this.home);
    if (known) return { x: known.x, y: known.y };
    // A start seen empty is not where they are: the seated enemies' starts first, then those of nobody known, then
    // the search — the base out of sight longest (and of those, the nearest).
    const enemies = new Set(this.init.players.filter((p) => p.isEnemy).map((p) => p.id));
    const starts = this.init.map.startLocations.filter((s) => s !== this.home && !this.cleared.has(s));
    const seated = starts.filter((s) => enemies.has(s.player));
    const pick = (seated.length ? seated : starts).sort((a, b) => distance(a, this.home) - distance(b, this.home))[0];
    if (pick) return { x: pick.x, y: pick.y };
    const own = this.ownBases;
    const search = this.bases.filter((b) => !own.includes(b)).sort((a, b) => (this.baseSeen.get(a) ?? -1) - (this.baseSeen.get(b) ?? -1) || distance(a, this.home) - distance(b, this.home))[0];
    return search ? { x: search.x, y: search.y } : null;
  }
  /** Starts seen with no enemy building near: not where the enemy is. */
  private readonly cleared = new Set<BotStartLocation>();
  /** The frame each base was last in sight. */
  private readonly baseSeen = new Map<Base, number>();

  /** A unit of the bot's own, by id. */
  unit(id: number): Unit | undefined { return this.byId.get(id); }
  /** A line for the page's readout and the runner's output. */
  log(text: string): void { this.api.log(text); }

  /* ── The layer's own work (not for bots) ── */

  /** @internal A target as `BOT_API` takes it: a unit seen now by id, anything else by its point. */
  aim(target: Target): number | Point {
    if (typeof target === "number") return target;
    if (target instanceof Seen) return target.alive && target.visible ? target.id : { x: target.x, y: target.y };
    return { x: target.x, y: target.y };
  }
  /** @internal */
  idOf(target: Target): number {
    if (typeof target === "number") return target;
    if (target instanceof Seen) return target.id;
    throw new Error("a unit is needed here, not a point");
  }

  /** @internal Brings everything up to date with a new view; runs the build jobs. */
  update(view: BotView, api: BotApi): void {
    this.view = view;
    this.api = api;
    this.frame = view.frame;
    this.busy = new Set();
    this.usedLarvae = new Set();
    for (const [id, until] of this.resting) if (until <= this.frame) this.resting.delete(id);

    // Own units: the same object for the same unit all game long.
    const here = new Set<number>();
    const units = new Units<Unit>();
    for (const raw of view.units) {
      here.add(raw.id);
      let u = this.byId.get(raw.id);
      if (u) Object.assign(u, raw); else { u = new Unit(this, raw); this.byId.set(raw.id, u); }
      u.lastSeen = this.frame;
      if (u.isGatheringMinerals && u.orderTarget >= 0 && this.isMineral(u.orderTarget)) u.field = u.orderTarget;
      else if (!u.isGatheringMinerals) u.field = -1;
      if (u.isGatheringGas || u.isCarryingGas) {
        if (u.orderTarget >= 0 && this.byId.get(u.orderTarget)?.info.isRefinery) u.gasAt = u.orderTarget;
        else if (u.gasAt < 0) u.gasAt = this.units.filter((r) => r.info.isRefinery).nearest(u)?.id ?? -1;
      } else if (this.frame - u.sentAt > ORDER_LAG) u.gasAt = -1;
      units.push(u);
    }
    const departed = new Map<number, Unit>();
    for (const [id, u] of this.byId) if (!here.has(id)) { u.alive = false; this.byId.delete(id); departed.set(id, u); }
    this.units = units;

    // Others: in sight now, and remembered.
    const enemies = new Units<Seen>(), neutral = new Units<Seen>();
    const firstSeen: Seen[] = [];
    for (const raw of view.enemies) {
      let s = this.seen.get(raw.id);
      if (s) Object.assign(s, raw); else { s = new Seen(this, raw); this.seen.set(raw.id, s); firstSeen.push(s); }
      s.visible = true;
      s.lastSeen = this.frame;
      enemies.push(s);
    }
    for (const raw of view.neutral) neutral.push(new Seen(this, raw));
    this.enemies = enemies;
    this.neutral = neutral;
    const ownDestroyed: Unit[] = [], completed: Unit[] = [];
    for (const e of view.events) {
      if (e.type === "unitDestroy") {
        if (e.player === this.self) { const u = departed.get(e.id) ?? this.byId.get(e.id); if (u) { u.alive = false; this.byId.delete(e.id); ownDestroyed.push(u); } }
        else { const s = this.seen.get(e.id); if (s) { s.alive = false; this.seen.delete(e.id); } }
      } else if (e.type === "unitComplete" && e.player === this.self) { const u = units.find((x) => x.id === e.id); if (u) completed.push(u); }
    }
    const width = this.init.map.width;
    for (const [id, s] of this.seen) {
      if (enemies.includes(s)) continue;
      s.visible = false;
      // A building whose place is in sight and that is not there is gone (destroyed out of sight, or lifted off).
      if (s.info.isBuilding && view.visibility[s.tileY * width + s.tileX] === 2) { s.alive = false; this.seen.delete(id); }
    }
    this.enemyMemory = new Units<Seen>(); for (const s of this.seen.values()) this.enemyMemory.push(s);
    const inSight = (p: Point) => view.visibility[Math.floor(p.y / TILE) * width + Math.floor(p.x / TILE)] === 2;
    for (const b of this.bases) if (inSight(b)) this.baseSeen.set(b, this.frame);
    for (const st of this.init.map.startLocations) {
      if (st === this.home || this.cleared.has(st) || !inSight(st)) continue;
      if (!this.enemyMemory.some((u) => u.info.isBuilding && distance(u, st) < 12 * TILE)) this.cleared.add(st);
    }

    // Orders given and not yet shown keep their money, their supply and their producer.
    this.purse = { minerals: view.self.minerals, gas: view.self.gas };
    this.room = view.self.supplyTotal - view.self.supplyUsed;
    for (let k = this.pending.length - 1; k >= 0; k--) {
      const p = this.pending[k];
      if (this.shown(p) || this.frame - p.frame > PENDING_LIMIT) { this.pending.splice(k, 1); continue; }
      this.purse.minerals -= p.minerals; this.purse.gas -= p.gas; this.room -= p.supply;
      this.busy.add(p.producer);
      if (p.kind === "train") this.usedLarvae.add(p.producer);
    }

    // The jobs, in the order they were asked for, each keeping its price once it can be met.
    for (const job of this.jobs) this.runJob(job);
    this.jobs = this.jobs.filter((j) => j.open);

    this.groups();
    for (const u of completed) this.bot.onUnitComplete?.(u, this);
    for (const u of ownDestroyed) this.bot.onUnitDestroy?.(u, this);
    for (const s of firstSeen) this.bot.onEnemySeen?.(s, this);
  }

  private groups(): void {
    const notArmy = new Set<number>([ID.Larva, ID.Egg, ID.Cocoon, ID.LurkerEgg, ID.Interceptor, ID.Scarab, ID.SpiderMine, ID.NuclearMissile]);
    this.workers = this.units.filter((u) => u.isCompleted && u.info.isWorker && !u.isConstructing && !u.job && u.order !== this.data.Orders.Repair);
    this.buildings = this.units.filter((u) => u.info.isBuilding);
    this.larvae = this.units.filter((u) => u.type === ID.Larva && !this.usedLarvae.has(u.id));
    this.army = this.units.filter((u) => {
      const i = u.info;
      if (!u.isCompleted || i.isWorker || i.isBuilding || notArmy.has(u.type)) return false;
      // Overlords, and transports, stay out of the fighting; detectors and spellcasters go with it.
      return i.groundWeapon >= 0 || i.airWeapon >= 0 || i.isSpellcaster || u.type === ID.Carrier || u.type === ID.Reaver || (i.isDetector && i.supplyProvided === 0);
    });
  }

  /** Finished units of a type, and of the forms a zerg building of that type turns into (a Lair and a Hive do what a Hatchery does). */
  private producers(type: number): Units<Unit> {
    let forms = this.forms.get(type);
    if (!forms) {
      forms = new Set([type]);
      const units = this.data.units;
      for (let grew = true; grew;) {
        grew = false;
        for (const u of units) if (u && u.isBuilding && u.race === this.data.Races.Zerg && forms.has(u.whatBuilds) && units[u.whatBuilds]?.isBuilding && !forms.has(u.id)) { forms.add(u.id); grew = true; }
      }
      this.forms.set(type, forms);
    }
    const f = forms;
    return this.units.filter((u) => u.isCompleted && f.has(u.type));
  }
  private readonly forms = new Map<number, Set<number>>();

  private isMineral(id: number): boolean { return this.mineralIds.has(id); }
  private free(u: Unit): boolean { return u.isCompleted && !this.busy.has(u.id) && !u.isTraining && !u.isMorphing && !u.isConstructing && u.remainingResearchTime === 0; }
  private readonly told = new Set<number>();
  /** Whether a type is one this bot's race can have; a type of another race is said once in the log, and nothing is ordered. */
  private ours(t: number): boolean {
    const race = this.data.units[t]?.race;
    const playable = race === this.data.Races.Zerg || race === this.data.Races.Terran || race === this.data.Races.Protoss;
    if (!playable || race === this.race.id) return true;
    if (!this.told.has(t)) { this.told.add(t); this.api.log(`${this.data.units[t].name} is not a ${this.race.name} unit: nothing ordered`); }
    return false;
  }

  /** Whether the purse holds a price. A price of nothing is always there, whatever else is being saved for. */
  private affords(minerals: number, gas: number): boolean { return (minerals <= 0 || this.purse.minerals >= minerals) && (gas <= 0 || this.purse.gas >= gas); }
  private supplyCost(i: UnitTypeInfo): number { return i.supplyRequired * (i.isTwoUnitsInOneEgg ? 2 : 1); }
  private spend(producer: number, kind: Pending["kind"], what: number, minerals: number, gas: number, supply: number, count: number): void {
    this.purse.minerals -= minerals; this.purse.gas -= gas; this.room -= supply;
    this.pending.push({ producer, kind, what, minerals, gas, supply, count, frame: this.frame });
  }
  /** Whether an order given earlier shows in the view: the money and the supply are then the game's to count. */
  private shown(p: Pending): boolean {
    const u = this.byId.get(p.producer);
    if (!u) return true;
    switch (p.kind) {
      case "train": return u.type !== ID.Larva ? u.trainingQueue.includes(p.what) || u.buildType === p.what || u.type === p.what || u.isMorphing : false;
      case "morph": return u.isMorphing || u.buildType === p.what || u.type === p.what;
      case "addon": return u.addon >= 0 || u.buildType === p.what;
      case "research": return u.tech === p.what;
      case "upgrade": return u.upgrade === p.what;
    }
  }

  /** @internal Mining: a resource given, or the least busy field of the base nearest the worker. */
  sendToMine(w: Unit, resource?: Target): void {
    if (resource !== undefined) { const id = this.idOf(resource); this.api.gather(w.id, id); this.busy.add(w.id); if (this.isMineral(id)) w.field = id; return; }
    const halls = this.units.filter((u) => u.info.isResourceDepot && u.isCompleted);
    const width = this.init.map.width;
    let best: { id: number; load: number; d: number } | null = null;
    for (const h of halls.byDistance(w)) {
      const base = this.bases.find((b) => distance(b, h) < 10 * TILE);
      if (!base) continue;
      for (const f of base.minerals) {
        // A field whose place is in sight and that is not there was mined out.
        if (this.view.visibility[Math.floor(f.y / TILE) * width + Math.floor(f.x / TILE)] === 2 && !this.neutral.some((n) => n.id === f.id)) continue;
        const load = this.units.reduce((n, u) => n + (u !== w && u.field === f.id ? 1 : 0), 0);
        const d = distance(f, h);
        if (!best || load < best.load || (load === best.load && d < best.d)) best = { id: f.id, load, d };
      }
      if (best && best.load < 2) break;
    }
    if (!best) return;
    this.api.gather(w.id, best.id);
    this.busy.add(w.id);
    w.field = best.id;
    w.gasAt = -1;
  }

  /* ── Build jobs ── */

  private runJob(job: BuildJob): void {
    const info = this.data.units[job.type];
    if (info.isResourceDepot && job.near && job.state !== "started" && this.enemyMemory.some((u) => u.info.isBuilding && distance(u, job.near!) < 10 * TILE)) {
      if (job.builder) this.api.stop(job.builder.id);
      this.fail(job, "another player has that base");
      return;
    }
    if (job.state === "walking") this.watch(job);
    if (job.state === "asking" && job.answer !== undefined) this.consider(job);
    if (job.state === "sited" && !job.fixed && this.frame - job.since > SITE_FRESH) this.retry(job, false);
    if (!job.open) return;
    const ready = this.canMake(job.type);
    if (!ready && job.state === "waiting") return;
    // A building `want`ed and still waiting for its money takes it where the bot's line runs (`touch`), not here; one
    // whose line has stopped running is no longer wanted.
    if (job.wanted && job.state === "waiting") {
      if (job.touched >= 0 && this.frame - job.touched > FORGOTTEN) { job.state = "failed"; job.reason = "no longer asked for"; }
      return;
    }
    this.advance(job);
    if (!job.open) return;
    // On its way from afar: nothing kept yet (it is when the builder is near).
    if (job.state === "walking" && job.approaching && !this.near(job)) return;
    // From the moment the tech tree allows it until it stands, the price is this job's: what is asked for first is
    // paid for first, and nothing ordered later spends its money.
    this.purse.minerals -= info.mineralPrice; this.purse.gas -= info.gasPrice;
  }

  /** Whether a job's builder is near its site. */
  private near(job: BuildJob): boolean {
    const w = job.builder && this.byId.get(job.builder.id);
    return !!w && !!job.site && distance(w, centre(this.data.units[job.type], job.site)) <= NEAR;
  }

  /** A waiting job whose money is there seeks its site; a sited one gets its builder, unless enemies are on the site. */
  private advance(job: BuildJob): void {
    const info = this.data.units[job.type];
    if (job.state === "waiting" && this.frame >= job.notBefore && this.affords(info.mineralPrice, info.gasPrice)) {
      if (job.fixed) { job.site = job.fixed; job.state = "sited"; job.since = this.frame; }
      else this.ask(job);
    }
    if (job.state === "sited" && this.threatened(info, job.site!)) {
      // Enemy fighters on the site: no worker is sent to die there. A site of the bot's choosing is given up, another is looked for.
      if (job.fixed) { this.fail(job, "enemies at the site"); return; }
      this.retry(job, true, false);
      job.notBefore = this.frame + THREAT_PAUSE;
    }
    if (job.state === "sited") this.send(job);
  }

  /** A `want`ed job's line has run: if it is still waiting for its money, it starts if it can and keeps its price from here on in this frame. */
  private touch(job: BuildJob): void {
    if (job.touched === this.frame || !job.open || !job.wanted || job.state !== "waiting") return;
    job.touched = this.frame;
    if (!this.canMake(job.type)) return;
    this.advance(job);
    if (!job.open) return;
    const info = this.data.units[job.type];
    this.purse.minerals -= info.mineralPrice; this.purse.gas -= info.gasPrice;
  }

  private around(job: BuildJob): Point {
    const info = this.data.units[job.type];
    if (info.isRefinery) { const g = this.freeGeyser(job); if (g) return g; }
    if (job.near) return job.near;
    if (info.requiresPsi) {
      // Around each pylon in turn, a little to one side or another each time round.
      const pylons = this.done(ID.Pylon);
      if (pylons.length) {
        const p = pylons[job.attempt % pylons.length], round = Math.floor(job.attempt / pylons.length), a = round * 2.4;
        return round ? { x: p.x + Math.cos(a) * 3 * TILE, y: p.y + Math.sin(a) * 3 * TILE } : p;
      }
    }
    // Around the hall at home, or the nearest one still standing when that one is gone (a zerg building needs its
    // creep); further out on each try.
    const halls = this.units.filter((u) => u.info.isResourceDepot && u.isCompleted);
    const at: Point = halls.near(this.home, 6 * TILE).length || !halls.length ? this.home : halls.nearest(this.home)!;
    const angle = job.attempt * 2.1 + this.jobs.indexOf(job);
    const r = job.attempt === 0 && !this.data.units[job.type].isResourceDepot ? 0 : 3 * TILE;
    return { x: at.x + Math.cos(angle) * r, y: at.y + Math.sin(angle) * r };
  }

  private ask(job: BuildJob): void {
    const near = this.around(job);
    job.state = "asking";
    job.since = this.frame;
    job.answer = undefined;
    const round = Math.floor(job.attempt / 2);
    void this.api.getBuildLocation(job.type, Math.floor(near.x / TILE), Math.floor(near.y / TILE), { radius: Math.min(16 + 8 * round, 48), spacing: round ? 0 : 1 }).then((site) => { job.answer = site; });
  }

  private consider(job: BuildJob): void {
    const site = job.answer ?? null;
    const info = this.data.units[job.type], { width, height } = this.init.map;
    const inside = site !== null && site.tileX >= 1 && site.tileY >= 1 && site.tileX + info.tileWidth <= width - 1 && site.tileY + info.tileHeight <= height - 1;
    // Another building asked for is going there: look around somewhere else, which is no failure of this one.
    const taken = inside && this.jobs.some((o) => o !== job && o.open && o.site && touches(info, site!, this.data.units[o.type], o.site));
    if (inside && !taken) { job.site = site; job.state = "sited"; job.since = this.frame; }
    else if (taken) this.retry(job, true, false);
    else if (site === null && job.attempt >= 6) this.fail(job, "the game named no site for it");
    else this.retry(job);
  }

  private send(job: BuildJob): void {
    const info = this.data.units[job.type];
    if (!this.affords(info.mineralPrice, info.gasPrice)) return;
    const c = centre(info, job.site!);
    const free = this.workers.filter((w) => !this.busy.has(w.id) && !this.resting.has(w.id) && !w.isGatheringGas && !w.isCarryingGas);
    const builder = free.filter((w) => !w.isCarryingMinerals).nearest(c) ?? free.nearest(c);
    if (!builder) return;
    job.approaching = !this.explored(info, job.site!) || distance(builder, c) > NEAR;
    if (job.approaching) this.api.move(builder.id, c.x, c.y);
    else this.api.build(builder.id, job.type, job.site!.tileX, job.site!.tileY);
    job.patience = WALK_PATIENCE + Math.round(distance(builder, c) / 2);
    this.busy.add(builder.id);
    builder.job = job;
    builder.field = -1;
    job.builder = builder;
    job.state = "walking";
    job.since = this.frame;
    job.stood = null;
    this.workers = this.workers.filter((w) => w !== builder);
  }

  private watch(job: BuildJob): void {
    const info = this.data.units[job.type], c = centre(info, job.site!);
    const building = this.units.find((u) => u.type === job.type && Math.abs(u.x - c.x) <= 16 && Math.abs(u.y - c.y) <= 16);
    if (building) {
      job.state = "started";
      job.building = building;
      if (job.builder) job.builder.job = null;
      return;
    }
    const w = job.builder && this.byId.get(job.builder.id);
    const age = this.frame - job.since;
    if (!w) { this.retry(job); return; }
    this.busy.add(w.id);
    if (!w.isConstructing && this.threatened(info, job.site!)) {
      this.api.stop(w.id);
      w.job = null;
      if (job.fixed) this.fail(job, "enemies at the site");
      else { this.retry(job, true, false); job.notBefore = this.frame + THREAT_PAUSE; }
      return;
    }
    if (job.approaching && this.explored(info, job.site!) && distance(w, centre(info, job.site!)) <= NEAR) {
      // Near, and in sight: the game will take the building once the money is there (kept from here on).
      if (!this.affords(info.mineralPrice, info.gasPrice)) { job.stood = { x: w.x, y: w.y, since: this.frame }; job.since = this.frame; return; }
      job.approaching = false;
      job.since = this.frame;
      this.api.build(w.id, job.type, job.site!.tileX, job.site!.tileY);
      return;
    }
    // The order shows a few frames after it was given; a worker that then is not building was turned away. Ask the game
    // why: a site that will not do (taken, too near the resources) is given up, a unit in the way is tried again.
    if (!job.approaching && age > ORDER_LAG && !w.isConstructing) {
      w.job = null;
      const site = job.site!;
      void this.api.placement(site.tileX, site.tileY, job.type, undefined, false).then((r) => { job.refused = r; });
      this.retry(job);
      return;
    }
    if (!job.stood || job.stood.x !== w.x || job.stood.y !== w.y) job.stood = { x: w.x, y: w.y, since: this.frame };
    if (age <= job.patience && this.frame - job.stood.since <= STAND_PATIENCE) return;
    // It did not get there, or got there and did not start: call it off and send another.
    this.api.stop(w.id);
    w.job = null;
    this.resting.set(w.id, this.frame + REST);
    if (++job.calledOff >= TRIES) this.fail(job, "the workers sent did not get it started");
    else this.retry(job);
  }

  private retry(job: BuildJob, elsewhere = true, failed = elsewhere): void {
    const lasting = job.fixed && job.refused && !["ok", "unit", "cost", "requirements"].includes(job.refused);
    if (lasting) { this.fail(job, `the game will not take it on that site (${job.refused})`); return; }
    if (elsewhere) job.attempt++;
    if (failed && ++job.failures > MAX_ATTEMPTS) {
      const why = job.refused && job.refused !== "ok" ? ` (last: ${job.refused})` : "";
      this.fail(job, (job.fixed ? "the game would not take it on that site" : "the game would not take it on any site tried") + why);
      return;
    }
    job.approaching = false;
    if (job.builder) job.builder.job = null;
    job.state = "waiting";
    job.site = null;
    job.builder = null;
    job.answer = undefined;
    job.notBefore = this.frame + (elsewhere ? 24 : 0);
  }

  /** A geyser at a base with a finished hall of ours that has no gas building on it and none asked for (other than `job`'s). */
  freeGeyser(job?: BuildJob): { x: number; y: number } | null {
    const halls = this.units.filter((u) => u.info.isResourceDepot && u.isCompleted);
    const onIt = (g: Point) => [...this.units, ...this.enemyMemory].some((u) => u.info.isRefinery && distance(u, g) < TILE)
      || this.jobs.some((j) => j !== job && j.open && this.data.units[j.type].isRefinery && j.site && distance(centre(this.data.units[j.type], j.site), g) < TILE);
    for (const h of halls.byDistance(this.home)) {
      const base = this.bases.find((b) => distance(b, h) < 10 * TILE);
      const g = base?.geysers.find((g) => !onIt(g));
      if (g) return g;
    }
    return null;
  }

  /** Whether enemy units that can fight stand within a few tiles of a site. */
  private threatened(info: UnitTypeInfo, site: { tileX: number; tileY: number }): boolean {
    const c = centre(info, site);
    return this.enemies.some((e) => !e.info.isWorker && (e.info.groundWeapon >= 0 || e.info.airWeapon >= 0) && distance(e, c) < 8 * TILE);
  }

  /** Whether the footprint has all been seen at some time: the game places nothing on ground still black. */
  private explored(info: UnitTypeInfo, site: { tileX: number; tileY: number }): boolean {
    const width = this.init.map.width, vis = this.view.visibility;
    for (let y = site.tileY; y < site.tileY + info.tileHeight; y++) for (let x = site.tileX; x < site.tileX + info.tileWidth; x++) if (!vis[y * width + x]) return false;
    return true;
  }

  private fail(job: BuildJob, reason: string): void {
    job.state = "failed";
    const base = this.data.units[job.type].isResourceDepot && job.near ? this.bases.find((b) => distance(b, job.near!) < TILE) : undefined;
    if (base) this.avoid.set(base, this.frame + 1440);
    job.reason = reason;
    if (job.builder) job.builder.job = null;
    this.api.log(`gave up on a ${this.data.units[job.type].name}: ${reason}`);
  }
}

function centre(info: UnitTypeInfo, site: { tileX: number; tileY: number }): Point {
  return { x: (site.tileX + info.tileWidth / 2) * TILE, y: (site.tileY + info.tileHeight / 2) * TILE };
}
/** Whether two footprints overlap or touch. */
function touches(a: UnitTypeInfo, at: { tileX: number; tileY: number }, b: UnitTypeInfo, bt: { tileX: number; tileY: number }): boolean {
  return at.tileX < bt.tileX + b.tileWidth + 1 && bt.tileX < at.tileX + a.tileWidth + 1 && at.tileY < bt.tileY + b.tileHeight + 1 && bt.tileY < at.tileY + a.tileHeight + 1;
}

/** Names to ids, forgiving: case, spaces and the race's prefix do not matter ("marine", "Siege Tank", "Terran_Marine"). */
function resolver(table: Readonly<Record<string, number>>, race: string, what: string): (ref: string) => number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const keys = Object.keys(table).map((k) => ({ key: k, n: norm(k) }));
  const cache = new Map<string, number>();
  const races = ["zerg", "terran", "protoss"];
  return (ref) => {
    const hit = cache.get(ref);
    if (hit !== undefined) return hit;
    const n = norm(ref);
    const ours = (k: { n: string }) => k.n.startsWith(race);
    const tries: ((k: { n: string }) => boolean)[] = [
      (k) => k.n === n, (k) => k.n === race + n,
      (k) => ours(k) && k.n.endsWith(n), (k) => races.some((r) => k.n === r + n), (k) => k.n.endsWith(n),
      (k) => ours(k) && k.n.includes(n), (k) => k.n.includes(n),
    ];
    for (const test of tries) {
      const k = n ? keys.find(test) : undefined;
      if (k) { const id = table[k.key]; cache.set(ref, id); return id; }
    }
    throw new Error(`no ${what} called "${ref}"`);
  };
}

/* The orders `useTech` can send, for a bot that wants to know before it asks: `castable(game.techType("Psionic_Storm"))`. */
export const castable = (tech: number): boolean => TECH_ORDERS[tech] !== undefined;
