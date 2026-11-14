/**
 * The bot interface: what a computer player's module looks like, what it is shown and what it may
 * do. Types and constants only, with no imports, so this one file can be copied next to a bot and
 * used on its own (`import type { BotModule } from "./api.ts"`).
 *
 * A bot is a plain ES module whose default export is a `BotModule`:
 *
 *   export default {
 *     name: "My bot",
 *     create(init) {
 *       return {
 *         onFrame(view, api) { ... },   // may be async
 *         onEnd(result) { ... },        // optional
 *       };
 *     },
 *   };
 *
 * It plays one player of a melee game. Every few frames it is handed a `BotView` — its own units in
 * full, and of everything else only what that player can see at that moment — and answers with
 * ordinary commands, the same ones a person's mouse and keyboard produce. The game never waits for
 * it: a view that arrives while the last one is still being answered is skipped, not queued.
 *
 * The vocabulary follows BWAPI where the game concept is the same (a per-frame callback, `self`,
 * `getBuildLocation`, `canBuildHere`, the unit type names, supply counted in halves), so a BWAPI
 * bot's author should find little that surprises. It is not BWAPI: there is no synchronous game
 * object to query, only the view and the few asynchronous questions on `BotApi`.
 *
 * Everything a bot needs at run time arrives through `init` and `view` (the constants below are
 * also in `init.data`), so a bot written in plain JavaScript needs no import at all.
 *
 * This interface only grows. A field or a call that exists keeps its meaning.
 */

/** The version of this interface. A host tells a bot its own in `BotInit.api`. */
export const BOT_API = 1;

/* ── The module ─────────────────────────────────────────────────────────────────────────── */

export interface BotModule {
  /** Shown in the page next to the player. */
  name: string;
  version?: string;
  author?: string;
  /** Frames between two views, when the bot wants something other than the host's default (`BotInit.frameInterval`). */
  frameInterval?: number;
  /** Called once, before the first frame (BWAPI's `onStart`). May return a promise. */
  create(init: BotInit): Bot | Promise<Bot>;
}

export interface Bot {
  /**
   * Called with each view. Give orders through `api`; they are sent when the function returns (or
   * its promise settles). While it runs no further view is delivered. Throwing stops the bot: the
   * page reports the error and the game goes on without it.
   */
  onFrame(view: BotView, api: BotApi): void | Promise<void>;
  /** The game is over for this player, or the bot was removed. */
  onEnd?(result: BotResult): void;
}

export interface BotResult {
  /** "ended": the game stopped without a winner (the page was closed, the frame limit of a test match). */
  result: "victory" | "defeat" | "ended";
  frame: number;
}

/* ── What a bot is told once ────────────────────────────────────────────────────────────── */

export interface BotInit {
  /** The host's `BOT_API`. */
  api: number;
  /** This bot's player number (0–7), the `player` of its units. */
  self: number;
  /** `Races.*`: the race it plays, already settled when it was random. */
  race: number;
  name: string;
  /** Everyone seated in the game, this bot included. */
  players: BotPlayer[];
  /** Frames between two views unless the bot asks otherwise. A second of game time is 24 frames at normal speed. */
  frameInterval: number;
  map: BotMap;
  data: BotData;
  /**
   * The mod the game is played with, when there is one: its name and, where the host knows it, its hash (the one a
   * bot made for the mod is built against: `scmjs mod header`). `data` then holds the mod's tables, its types called by
   * the mod's names. Absent in a game of the game's own data.
   */
  mod?: { name: string; hash?: string };
  /** True in a use-map-settings game: the bot starts with the units the map placed for it, not a hall and four workers. Absent or false: melee. */
  useMapSettings?: boolean;
  /**
   * A use-map-settings game only: what the map keeps from this bot. An order for anything listed is refused like any other the game does not allow.
   * `data` already holds the map's own costs, times and numbers.
   */
  limits?: BotLimits;
}

export interface BotLimits {
  /** `UnitTypes` it may not train, build or morph into. */
  forbiddenUnits: number[];
  /** `TechTypes` it may neither research nor use. */
  unavailableTechs: number[];
  /** The highest level of each upgrade, indexed by `UpgradeTypes` id (0: not at all). */
  upgradeMax: number[];
}

export interface BotPlayer {
  id: number;
  name: string;
  race: number;
  isSelf: boolean;
  /** Everyone else is an enemy: melee games here have no teams yet. */
  isEnemy: boolean;
}

/**
 * The static map. Tiles are 32 pixels (build positions), walk cells 8 pixels; unit positions
 * everywhere are pixels. All grids are row by row from the top-left.
 */
export interface BotMap {
  /** In tiles. */
  width: number;
  height: number;
  tileset: string;
  /** One byte per walk cell, `width * 4` to a row: 1 where the terrain is walkable (buildings and units not counted). */
  walkable: Uint8Array;
  /** One byte per tile: 1 where the terrain can be built on (creep, power and what stands there not counted). */
  buildable: Uint8Array;
  /** One byte per tile: 0 low ground, 2 high, 4 very high; odd when the tile holds a doodad that blocks the view. */
  groundHeight: Uint8Array;
  startLocations: BotStartLocation[];
  /** Every mineral field and geyser as the map places them, known from the start as they are to a person who knows the map. */
  resources: BotResource[];
}

export interface BotStartLocation {
  /** The top-left tile of a town hall built here. */
  tileX: number;
  tileY: number;
  /** The start location's own point, in pixels. */
  x: number;
  y: number;
  /** The player seated here, or -1 for a start nobody took. */
  player: number;
}

export interface BotResource {
  /** The unit id, usable as a `gather` target even when the field is out of sight. */
  id: number;
  type: number;
  x: number;
  y: number;
  /** The amount at the start of the game. */
  resources: number;
}

/** The game's tables, by id, and the names for those ids. */
export interface BotData {
  UnitTypes: Readonly<Record<string, number>>;
  TechTypes: Readonly<Record<string, number>>;
  UpgradeTypes: Readonly<Record<string, number>>;
  Orders: Readonly<Record<string, number>>;
  Races: Readonly<Record<string, number>>;
  /** Indexed by unit type id (0–227). */
  units: UnitTypeInfo[];
  /** Indexed by tech id (0–43). */
  techs: TechTypeInfo[];
  /** Indexed by upgrade id (0–60). */
  upgrades: UpgradeTypeInfo[];
  /** Indexed by weapon id (0–129). */
  weapons: WeaponTypeInfo[];
}

export interface UnitTypeInfo {
  id: number;
  /**
   * The `UnitTypes` name ("Terran_Marine"), or "Unit_<id>" for a type the table does not name. In a mod's game, the
   * mod's name made an identifier ("Terran_Mason"), as `scmjs mod header` writes it.
   */
  name: string;
  /** `Races.*`, or -1 for neutral types. */
  race: number;
  mineralPrice: number;
  gasPrice: number;
  /** Frames. */
  buildTime: number;
  /** In halves, as the game counts: a marine is 2, a zergling 1. */
  supplyRequired: number;
  supplyProvided: number;
  /** A building's footprint in tiles (0 for units). */
  tileWidth: number;
  tileHeight: number;
  /** The collision box in pixels from the unit's position. */
  dimensionLeft: number;
  dimensionUp: number;
  dimensionRight: number;
  dimensionDown: number;
  maxHitPoints: number;
  maxShields: number;
  armor: number;
  /** In tiles. */
  sightRange: number;
  /** Pixels per frame × 256 at full speed, from the game's table. Units moved by their walking animation (marine, zergling, zealot …) do not follow it exactly. */
  topSpeed: number;
  /** Weapon ids, or -1. */
  groundWeapon: number;
  airWeapon: number;
  /** 0 independent, 1 small, 2 medium, 3 large. */
  size: number;
  spaceRequired: number;
  spaceProvided: number;
  isBuilding: boolean;
  isAddon: boolean;
  isWorker: boolean;
  isFlyer: boolean;
  isResourceDepot: boolean;
  isRefinery: boolean;
  isResourceContainer: boolean;
  isDetector: boolean;
  isSpellcaster: boolean;
  isCloakable: boolean;
  isBurrowable: boolean;
  isMechanical: boolean;
  isOrganic: boolean;
  isRobotic: boolean;
  requiresPsi: boolean;
  requiresCreep: boolean;
  isTwoUnitsInOneEgg: boolean;
  /** The unit type that makes this one (a worker for a building, a production building, the larva), or -1. */
  whatBuilds: number;
  /** What must be owned and finished first: every entry is needed, and any one type of an entry will do. */
  requiredUnits: number[][];
  /** What this type makes. */
  buildsWhat: number[];
}

export interface TechTypeInfo {
  id: number;
  name: string;
  race: number;
  mineralPrice: number;
  gasPrice: number;
  /** Frames. */
  researchTime: number;
  energyCost: number;
  /** The building that researches it, or -1 (known from the start, or not researchable). */
  whatResearches: number;
}

export interface UpgradeTypeInfo {
  id: number;
  name: string;
  race: number;
  /** The first level's price and time; each further level adds the factor. */
  mineralPrice: number;
  mineralPriceFactor: number;
  gasPrice: number;
  gasPriceFactor: number;
  upgradeTime: number;
  upgradeTimeFactor: number;
  maxRepeats: number;
  whatUpgrades: number;
}

export interface WeaponTypeInfo {
  id: number;
  damageAmount: number;
  damageBonus: number;
  /** Frames between shots, before the game's small random addition. */
  damageCooldown: number;
  damageFactor: number;
  /** Pixels, measured between the edges of the two units. */
  minRange: number;
  maxRange: number;
  targetsAir: boolean;
  targetsGround: boolean;
  /** 0 independent, 1 explosive, 2 concussive, 3 normal, 4 ignore armour. */
  damageType: number;
  innerSplashRadius: number;
  medianSplashRadius: number;
  outerSplashRadius: number;
}

/* ── What a bot is shown every few frames ───────────────────────────────────────────────── */

export interface BotView {
  /** The game's frame counter. */
  frame: number;
  self: BotSelf;
  /** The bot's own units, buildings included; also the ones inside a transport, a bunker or an egg. */
  units: BotUnit[];
  /** Other players' units that this player sees now. A cloaked or burrowed unit is here only while one of the player's detectors reaches it. */
  enemies: VisibleUnit[];
  /** Mineral fields, geysers and critters in sight now (`BotMap.resources` lists all the resources, seen or not). */
  neutral: VisibleUnit[];
  /** What changed since the last view this bot was given (not since the last frame: views can be skipped). */
  events: BotEvent[];
  /**
   * One byte per tile: 0 never seen, 1 seen before, 2 in sight now. Read it during `onFrame` and
   * copy what you want to keep: the array may be reused for the next view.
   */
  visibility: Uint8Array;
}

export interface BotSelf {
  minerals: number;
  gas: number;
  /** In halves, as the game counts and as `UnitTypeInfo.supplyRequired` is given: 8 means four workers' worth. */
  supplyUsed: number;
  supplyTotal: number;
  /** Tech ids researched. */
  techs: number[];
  /** The level of every upgrade, indexed by upgrade id. */
  upgrades: number[];
}

/** A unit as anyone who sees it knows it. */
export interface VisibleUnit {
  /**
   * The unit's id for the whole game: use it in commands. (It is not the number the page's own
   * commands use; the host translates, and an id whose unit has died is quietly left out.)
   */
  id: number;
  /** `UnitTypes.*`. */
  type: number;
  /** The owner's player number; 11 for neutral units. */
  player: number;
  /** Pixels, the unit's centre. */
  x: number;
  y: number;
  hitPoints: number;
  shields: number;
  energy: number;
  /** Minerals or gas left in a field, a geyser or a gas building; 0 otherwise. */
  resources: number;
  /** 0–255 clockwise from up. */
  angle: number;
  /** False while under construction, in training or in an egg. */
  isCompleted: boolean;
  /** In the air: a flyer, or a lifted building. */
  isFlying: boolean;
  /** Cloaked, cloaking, or burrowed. */
  isCloaked: boolean;
  isBurrowed: boolean;
  isMoving: boolean;
  isLockedDown: boolean;
  isStasised: boolean;
  isEnsnared: boolean;
  isPlagued: boolean;
  isIrradiated: boolean;
  isDefenseMatrixed: boolean;
  /** A siege tank in siege mode. */
  isSieged: boolean;
  /** A terran building in the air. */
  isLifted: boolean;
}

/** One of the bot's own units. */
export interface BotUnit extends VisibleUnit {
  /** `Orders.*`: what the unit is doing. */
  order: number;
  /** The unit its order is aimed at, or -1. */
  orderTarget: number;
  /** The point its order is aimed at. */
  targetX: number;
  targetY: number;
  /** Standing with nothing to do (and, for a building, nothing in production). */
  isIdle: boolean;
  isGatheringMinerals: boolean;
  isGatheringGas: boolean;
  isCarryingMinerals: boolean;
  isCarryingGas: boolean;
  /** A worker on its way to build or building; a building under construction. */
  isConstructing: boolean;
  /** The building a worker has been told to build, or the type an egg or a morphing building turns into; -1 otherwise. */
  buildType: number;
  /** Unit types queued in a production building, the first being the one under way. */
  trainingQueue: number[];
  isTraining: boolean;
  /** Frames until this unit is finished (0 once completed). */
  remainingBuildTime: number;
  /** Frames until the unit being trained here is finished (0 when none). */
  remainingTrainTime: number;
  /** The tech or the upgrade being researched here, or -1, and the frames left. */
  tech: number;
  upgrade: number;
  remainingResearchTime: number;
  groundWeaponCooldown: number;
  airWeaponCooldown: number;
  spellCooldown: number;
  /** Inside a transport or a bunker. */
  isLoaded: boolean;
  /** The ids of the units inside this one. */
  loadedUnits: number[];
  /** False for a protoss building outside every pylon's field. */
  isPowered: boolean;
  /** Spider mines left (vultures), 0 otherwise. */
  spiderMineCount: number;
  killCount: number;
  /** The transport or bunker this unit is inside, or -1. */
  transport: number;
  /** Under the effect of stim packs. */
  isStimmed: boolean;
  /** A zerg building turning into its next form, or an egg; `buildType` is what it becomes and `remainingBuildTime` the frames left. */
  isMorphing: boolean;
  /** A terran building's add-on, attached or under construction, or -1. */
  addon: number;
  /** A building's rally point in map pixels, or -1, -1 when it has none; `rallyUnit` is the unit it follows, or -1. */
  rallyX: number;
  rallyY: number;
  rallyUnit: number;
}

export type BotEvent =
  /** One of the bot's own units appeared (trained, built, morphed from a larva): `unitCreate`; finished: `unitComplete`; changed type: `unitMorph`; died: `unitDestroy`. */
  | { type: "unitCreate" | "unitComplete" | "unitMorph" | "unitDestroy"; id: number; unitType: number; player: number; x: number; y: number }
  /** Another player's unit came into sight or went out of it. A unit seen dying is a `unitDestroy`, not a `unitHide`. */
  | { type: "unitShow" | "unitHide"; id: number; unitType: number; player: number; x: number; y: number };

/* ── What a bot may do ──────────────────────────────────────────────────────────────────── */

/**
 * An order, exactly as a person's page sends it. `units` are ids of the bot's own units (anyone
 * else's are left out, and a command left with none does nothing); a selection holds twelve, and a
 * longer list is given as several orders of twelve. Positions are map pixels. A `target` must be a
 * unit the bot sees now, one of its own, or a resource; an order aimed at anything else is dropped
 * (with a target, `x` and `y` are not needed: the host fills in the target's position).
 * `queued` is shift-click: after the unit's current orders.
 */
export type BotCommand =
  | { kind: "move"; units: number[]; x: number; y: number; queued?: boolean }
  /** With a target: attack that unit. Without: attack-move to the point. */
  | { kind: "attack"; units: number[]; x: number; y: number; target?: number; queued?: boolean }
  | { kind: "patrol"; units: number[]; x: number; y: number; queued?: boolean }
  /** What a right-click does: move, attack an enemy, gather a resource, follow a friend. */
  | { kind: "rightClick"; units: number[]; x: number; y: number; target?: number; queued?: boolean }
  /** Send workers to a mineral field or a finished gas building. */
  | { kind: "gather"; units: number[]; target: number; queued?: boolean }
  | { kind: "returnCargo"; units: number[]; queued?: boolean }
  | { kind: "stop"; units: number[] }
  | { kind: "hold"; units: number[] }
  /** Train at a production building; with larvae (or a hatchery) as `units`, morph a larva. */
  | { kind: "train"; units: number[]; unitType: number }
  /** Build with a worker; the tile is the building's top-left. With `addon`, `units` is the terran building that builds the add-on. */
  | { kind: "build"; units: number[]; unitType: number; tileX: number; tileY: number; addon?: boolean }
  /** Research a tech (a `TechTypes` id) at a building. */
  | { kind: "research"; units: number[]; tech: number }
  /** A spell or a spider mine by its order id (`Orders.CastIrradiate` …); `BotApi.useTech` picks the order from the tech. */
  | { kind: "cast"; units: number[]; order: number; x: number; y: number; target?: number; queued?: boolean }
  | { kind: "cloak"; units: number[] }
  | { kind: "decloak"; units: number[] }
  /** The next level of an upgrade (an `UpgradeTypes` id) at a building. */
  | { kind: "upgrade"; units: number[]; upgrade: number }
  /** A zerg building into its next form (Lair, Hive, Sunken or Spore Colony, Greater Spire); a hydralisk or a mutalisk into `unitType`. */
  | { kind: "morph"; units: number[]; unitType: number }
  /** Cancel a building under `construction`, a unit in `train`ing (`slot` of the queue; the last when left out), `research` (a tech or an upgrade), a `morph`, an `addon` under way, a `nuke`. */
  | { kind: "cancel"; units: number[]; what: "construction" | "train" | "research" | "morph" | "addon" | "nuke"; slot?: number }
  | { kind: "siege" | "unsiege" | "burrow" | "unburrow" | "stim"; units: number[] }
  /** `units` board `target`, one of the bot's own transports. */
  | { kind: "load"; units: number[]; target: number }
  /** The transport in `units` puts out `target`, a unit inside it. */
  | { kind: "unload"; units: number[]; target: number }
  | { kind: "unloadAll"; units: number[] }
  | { kind: "lift"; units: number[] }
  /** A lifted building lands with its top-left at the tile. */
  | { kind: "land"; units: number[]; tileX: number; tileY: number }
  /** A finished Nydus Canal that has no exit places one with its top-left at the tile (on creep the player has seen). */
  | { kind: "nydusExit"; units: number[]; tileX: number; tileY: number }
  /** The rally point of production buildings: a point, or a `target` unit. */
  | { kind: "rally"; units: number[]; x: number; y: number; target?: number }
  /** Two high templar (with `dark`, two dark templar) merge. */
  | { kind: "merge"; units: number[]; dark?: boolean }
  /** SCVs repair the unit `target`. */
  | { kind: "repair"; units: number[]; target: number; queued?: boolean }
  /** Medics heal the unit `target`, or without one walk to (x, y) healing on the way. */
  | { kind: "heal"; units: number[]; x?: number; y?: number; target?: number; queued?: boolean }
  /** A shield battery (`units`) recharges the unit `target`. */
  | { kind: "recharge"; units: number[]; target: number }
  /** Transports fly to (x, y) and unload there. */
  | { kind: "unloadAt"; units: number[]; x: number; y: number; queued?: boolean };

/** Where to aim: a unit id, or a point in map pixels. */
export type BotTarget = number | { x: number; y: number };

/** Why a building cannot go somewhere: the first rule that fails, or "ok". */
export type BotPlacement =
  | "ok" | "requirements" | "cost" | "bounds" | "terrain" | "occupied" | "unit" | "creep" | "nocreep" | "psi" | "resources" | "geyser";

export interface BuildLocationOptions {
  /** How far to look, in tiles from the starting tile (24 by default). */
  radius?: number;
  /** Free tiles to leave around other buildings so units can pass (1 by default). */
  spacing?: number;
  /** Tiles to keep away from mineral fields and geysers, so the mining path stays open (6 by default; relaxed when nothing is found). */
  clearOfResources?: number;
}

/**
 * The second argument of `onFrame`. The order methods take one unit id or a list and only collect
 * orders; nothing is sent until `onFrame` is done. The questions are answered by the game on the
 * bot's behalf and return promises; they know no more than the bot's player can see.
 */
export interface BotApi {
  /** Any `BotCommand`, as is. */
  command(command: BotCommand): void;
  move(units: number | number[], x: number, y: number, queued?: boolean): void;
  /** A unit id attacks that unit; a point is attack-move. */
  attack(units: number | number[], target: BotTarget, queued?: boolean): void;
  rightClick(units: number | number[], target: BotTarget, queued?: boolean): void;
  patrol(units: number | number[], x: number, y: number, queued?: boolean): void;
  stop(units: number | number[]): void;
  holdPosition(units: number | number[]): void;
  gather(units: number | number[], resource: number, queued?: boolean): void;
  returnCargo(units: number | number[], queued?: boolean): void;
  /** `producer`: a production building, a larva, or a hatchery (one of its larvae morphs). */
  train(producer: number | number[], unitType: number): void;
  build(worker: number, unitType: number, tileX: number, tileY: number): void;
  buildAddon(building: number, unitType: number): void;
  research(building: number, tech: number): void;
  /** Casts `tech` (a `TechTypes` id the game can cast: see docs/bots.md) with one unit at a unit or a point. */
  useTech(unit: number, tech: number, target: BotTarget): void;
  cloak(units: number | number[]): void;
  decloak(units: number | number[]): void;
  /** The next level of `upgrade` (an `UpgradeTypes` id) at `building`. */
  upgrade(building: number, upgrade: number): void;
  /** A zerg building into `unitType` (Lair, Hive, Sunken Colony …), or hydralisks and mutalisks into theirs. */
  morph(units: number | number[], unitType: number): void;
  /** A building under construction: three quarters of its price come back. */
  cancelConstruction(building: number | number[]): void;
  /** One unit of a training queue: `slot` 0 is the one under way; without a slot, the last one queued. */
  cancelTrain(building: number, slot?: number): void;
  cancelResearch(building: number | number[]): void;
  cancelUpgrade(building: number | number[]): void;
  /** An egg, or a zerg building that is morphing. */
  cancelMorph(units: number | number[]): void;
  /** The add-on a terran building is putting up. */
  cancelAddon(building: number | number[]): void;
  /** Calls off the nuclear strike these ghosts are painting (round thirteen): the missile is lost unless it is already coming down. */
  cancelNuke(ghosts: number | number[]): void;
  siege(units: number | number[]): void;
  unsiege(units: number | number[]): void;
  burrow(units: number | number[]): void;
  unburrow(units: number | number[]): void;
  /** Stim packs for marines and firebats. */
  stim(units: number | number[]): void;
  /** `units` go aboard `transport`. */
  load(units: number | number[], transport: number): void;
  /** `transport` puts out `unit`. */
  unload(transport: number, unit: number): void;
  /** Everything aboard gets out where the transport is. */
  unloadAll(transports: number | number[]): void;
  lift(buildings: number | number[]): void;
  land(building: number, tileX: number, tileY: number): void;
  /**
   * A finished Nydus Canal places its exit (free; 40 seconds to grow) with its top-left at the tile: creep under all
   * four tiles, all of them explored, nothing the player sees standing there. A canal has one exit for good. Zerg
   * ground units then go through with `rightClick(units, canalId)` on either end.
   */
  placeNydusExit(canal: number, tileX: number, tileY: number): void;
  /** Where the units a building trains go: a point, or a unit id. */
  setRallyPoint(buildings: number | number[], target: BotTarget): void;
  mergeArchon(units: number[]): void;
  mergeDarkArchon(units: number[]): void;
  /** SCVs repair a damaged terran machine or building (a right-click on one does the same). */
  repair(units: number | number[], target: number, queued?: boolean): void;
  /** Medics heal a unit id, or walk to a point healing whoever they pass. */
  heal(units: number | number[], target: BotTarget, queued?: boolean): void;
  /** A shield battery recharges one of its player's units (a right-click of the unit on the battery does the same). */
  rechargeShields(battery: number, unit: number): void;
  /** Transports fly to the point and put everything out there. */
  unloadAllAt(transports: number | number[], x: number, y: number, queued?: boolean): void;

  /** Whether `unitType` may be placed with its top-left at the tile now, by the game's own placement rules as far as this player can see. */
  canBuildHere(tileX: number, tileY: number, unitType: number, builder?: number): Promise<boolean>;
  /** The same question with the reason. `checkCost` false leaves out the price and the tech tree. */
  placement(tileX: number, tileY: number, unitType: number, builder?: number, checkCost?: boolean): Promise<BotPlacement>;
  /** A free site for `unitType` near a tile (for a gas building, the nearest free geyser), or null. Price and tech tree are not checked. */
  getBuildLocation(unitType: number, nearTileX: number, nearTileY: number, options?: BuildLocationOptions): Promise<{ tileX: number; tileY: number } | null>;

  /** Views every `frames` frames from now on (1 to 240). */
  setFrameInterval(frames: number): void;
  /** A line for the page's bot readout and the test runner's output. */
  log(text: string): void;
}

/* ── Names ──────────────────────────────────────────────────────────────────────────────── */

export const Races = { Zerg: 0, Terran: 1, Protoss: 2, Random: 6 } as const;

/** units.dat ids under BWAPI's names. */
export const UnitTypes = {
  Terran_Marine: 0, Terran_Ghost: 1, Terran_Vulture: 2, Terran_Goliath: 3, Terran_Siege_Tank_Tank_Mode: 5, Terran_SCV: 7, Terran_Wraith: 8,
  Terran_Science_Vessel: 9, Terran_Dropship: 11, Terran_Battlecruiser: 12, Terran_Vulture_Spider_Mine: 13, Terran_Nuclear_Missile: 14,
  Terran_Civilian: 15, Terran_Siege_Tank_Siege_Mode: 30, Terran_Firebat: 32, Spell_Scanner_Sweep: 33, Terran_Medic: 34,
  Zerg_Larva: 35, Zerg_Egg: 36, Zerg_Zergling: 37, Zerg_Hydralisk: 38, Zerg_Ultralisk: 39, Zerg_Broodling: 40, Zerg_Drone: 41, Zerg_Overlord: 42,
  Zerg_Mutalisk: 43, Zerg_Guardian: 44, Zerg_Queen: 45, Zerg_Defiler: 46, Zerg_Scourge: 47, Zerg_Infested_Terran: 50, Terran_Valkyrie: 58,
  Zerg_Cocoon: 59, Protoss_Corsair: 60, Protoss_Dark_Templar: 61, Zerg_Devourer: 62, Protoss_Dark_Archon: 63, Protoss_Probe: 64,
  Protoss_Zealot: 65, Protoss_Dragoon: 66, Protoss_High_Templar: 67, Protoss_Archon: 68, Protoss_Shuttle: 69, Protoss_Scout: 70,
  Protoss_Arbiter: 71, Protoss_Carrier: 72, Protoss_Interceptor: 73, Protoss_Reaver: 83, Protoss_Observer: 84, Protoss_Scarab: 85,
  Critter_Rhynadon: 89, Critter_Bengalaas: 90, Critter_Scantid: 93, Critter_Kakaru: 94, Critter_Ragnasaur: 95, Critter_Ursadon: 96,
  Zerg_Lurker_Egg: 97, Zerg_Lurker: 103, Spell_Disruption_Web: 105,
  Terran_Command_Center: 106, Terran_Comsat_Station: 107, Terran_Nuclear_Silo: 108, Terran_Supply_Depot: 109, Terran_Refinery: 110,
  Terran_Barracks: 111, Terran_Academy: 112, Terran_Factory: 113, Terran_Starport: 114, Terran_Control_Tower: 115,
  Terran_Science_Facility: 116, Terran_Covert_Ops: 117, Terran_Physics_Lab: 118, Terran_Machine_Shop: 120, Terran_Engineering_Bay: 122,
  Terran_Armory: 123, Terran_Missile_Turret: 124, Terran_Bunker: 125,
  Zerg_Infested_Command_Center: 130, Zerg_Hatchery: 131, Zerg_Lair: 132, Zerg_Hive: 133, Zerg_Nydus_Canal: 134, Zerg_Hydralisk_Den: 135,
  Zerg_Defiler_Mound: 136, Zerg_Greater_Spire: 137, Zerg_Queens_Nest: 138, Zerg_Evolution_Chamber: 139, Zerg_Ultralisk_Cavern: 140,
  Zerg_Spire: 141, Zerg_Spawning_Pool: 142, Zerg_Creep_Colony: 143, Zerg_Spore_Colony: 144, Zerg_Sunken_Colony: 146, Zerg_Extractor: 149,
  Protoss_Nexus: 154, Protoss_Robotics_Facility: 155, Protoss_Pylon: 156, Protoss_Assimilator: 157, Protoss_Observatory: 159,
  Protoss_Gateway: 160, Protoss_Photon_Cannon: 162, Protoss_Citadel_of_Adun: 163, Protoss_Cybernetics_Core: 164,
  Protoss_Templar_Archives: 165, Protoss_Forge: 166, Protoss_Stargate: 167, Protoss_Fleet_Beacon: 169, Protoss_Arbiter_Tribunal: 170,
  Protoss_Robotics_Support_Bay: 171, Protoss_Shield_Battery: 172,
  Resource_Mineral_Field: 176, Resource_Mineral_Field_Type_2: 177, Resource_Mineral_Field_Type_3: 178, Resource_Vespene_Geyser: 188,
  Spell_Dark_Swarm: 202, Special_Start_Location: 214, None: 228,
} as const;

/** techdata.dat ids under BWAPI's names. */
export const TechTypes = {
  Stim_Packs: 0, Lockdown: 1, EMP_Shockwave: 2, Spider_Mines: 3, Scanner_Sweep: 4, Tank_Siege_Mode: 5, Defensive_Matrix: 6, Irradiate: 7,
  Yamato_Gun: 8, Cloaking_Field: 9, Personnel_Cloaking: 10, Burrowing: 11, Infestation: 12, Spawn_Broodlings: 13, Dark_Swarm: 14, Plague: 15,
  Consume: 16, Ensnare: 17, Parasite: 18, Psionic_Storm: 19, Hallucination: 20, Recall: 21, Stasis_Field: 22, Archon_Warp: 23,
  Restoration: 24, Disruption_Web: 25, Mind_Control: 27, Dark_Archon_Meld: 28, Feedback: 29, Optical_Flare: 30, Maelstrom: 31,
  Lurker_Aspect: 32, Healing: 34,
} as const;

/** upgrades.dat ids under BWAPI's names. */
export const UpgradeTypes = {
  Terran_Infantry_Armor: 0, Terran_Vehicle_Plating: 1, Terran_Ship_Plating: 2, Zerg_Carapace: 3, Zerg_Flyer_Carapace: 4,
  Protoss_Ground_Armor: 5, Protoss_Air_Armor: 6, Terran_Infantry_Weapons: 7, Terran_Vehicle_Weapons: 8, Terran_Ship_Weapons: 9,
  Zerg_Melee_Attacks: 10, Zerg_Missile_Attacks: 11, Zerg_Flyer_Attacks: 12, Protoss_Ground_Weapons: 13, Protoss_Air_Weapons: 14,
  Protoss_Plasma_Shields: 15, U_238_Shells: 16, Ion_Thrusters: 17, Titan_Reactor: 19, Ocular_Implants: 20, Moebius_Reactor: 21,
  Apollo_Reactor: 22, Colossus_Reactor: 23, Ventral_Sacs: 24, Antennae: 25, Pneumatized_Carapace: 26, Metabolic_Boost: 27,
  Adrenal_Glands: 28, Muscular_Augments: 29, Grooved_Spines: 30, Gamete_Meiosis: 31, Metasynaptic_Node: 32, Singularity_Charge: 33,
  Leg_Enhancements: 34, Scarab_Damage: 35, Reaver_Capacity: 36, Gravitic_Drive: 37, Sensor_Array: 38, Gravitic_Boosters: 39,
  Khaydarin_Amulet: 40, Apial_Sensors: 41, Gravitic_Thrusters: 42, Carrier_Capacity: 43, Khaydarin_Core: 44, Argus_Jewel: 47,
  Argus_Talisman: 49, Caduceus_Reactor: 51, Chitinous_Plating: 52, Anabolic_Synthesis: 53, Charon_Boosters: 54,
} as const;

/** orders.dat ids a bot is likely to meet in `BotUnit.order` or give in a `cast`. `init.data.Orders` has all 189. */
export const Orders = {
  Die: 0, Stop: 1, Guard: 2, PlayerGuard: 3, Move: 6, AttackUnit: 10, AttackMove: 14, Nothing: 23,
  DroneStartBuild: 25, DroneBuild: 26, PlaceBuilding: 30, PlaceProtossBuilding: 31, CreateProtossBuilding: 32, ConstructingBuilding: 33,
  Repair: 34, PlaceAddon: 36, BuildAddon: 37, Train: 38, ZergBirth: 41, ZergUnitMorph: 42, ZergBuildingMorph: 43, IncompleteBuilding: 44,
  Follow: 49, DroneLand: 70, ResearchTech: 75, Upgrade: 76, Larva: 77,
  MoveToGas: 81, WaitForGas: 82, HarvestGas: 83, ReturnGas: 84, MoveToMinerals: 85, WaitForMinerals: 86, MiningMinerals: 87, ReturnMinerals: 90,
  HoldPosition: 107, CastLockdown: 115, CastEMPShockwave: 122, PlaceMine: 132, CastScannerSweep: 139, CastDefensiveMatrix: 141,
  CastIrradiate: 143, CastPlague: 144, CastEnsnare: 146, CastStasisField: 147, ResetCollision: 150, ResetHarvestCollision: 151, Patrol: 152,
  CastRestoration: 180,
  CastInfestation: 27, BuildingLand: 71, BuildingLiftOff: 72, LiftingOff: 74, EnterTransport: 92, PickupIdle: 93, PickupTransport: 94, Sieging: 98, Unsieging: 99,
  Unload: 111, FireYamatoGun: 113, Burrowing: 116, Burrowed: 117, Unburrowing: 118, CastDarkSwarm: 119, CastParasite: 120, CastSpawnBroodlings: 121,
  CastRecall: 137, CastPsionicStorm: 142, CastConsume: 145, CastHallucination: 148, CastDisruptionWeb: 181, CastMindControl: 182, CastFeedback: 184,
  CastOpticalFlare: 185, CastMaelstrom: 186, IncompleteMorphing: 45,
} as const;

/**
 * The spells `BotApi.useTech` can cast, by tech id, and the order each is sent as. These are the
 * ones the game's command card offers here; a `cast` with any other order is dropped.
 */
export const TECH_ORDERS: Readonly<Record<number, number>> = {
  1: 115, 2: 122, 3: 132, 4: 139, 6: 141, 7: 143, 15: 144, 17: 146, 22: 147, 24: 180,
  8: 113, 12: 27, 13: 121, 14: 119, 16: 145, 18: 120, 19: 142, 20: 148, 21: 137, 25: 181, 27: 182, 29: 184, 30: 185, 31: 186,
  45: 126, // round thirteen: Nuclear Strike (a ghost, with a missile ready in a Nuclear Silo — `train(silo, 14)`); no energy, no research
};

/** The command kinds a bot may give; anything else it sends is dropped. */
export const BOT_COMMAND_KINDS = [
  "move", "attack", "patrol", "rightClick", "gather", "returnCargo", "stop", "hold", "train", "build", "research", "cast", "cloak", "decloak",
  "upgrade", "morph", "cancel", "siege", "unsiege", "burrow", "unburrow", "stim", "load", "unload", "unloadAll", "lift", "land", "rally", "merge",
  "repair", "heal", "recharge", "unloadAt", "nydusExit",
] as const;
