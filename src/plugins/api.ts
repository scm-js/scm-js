/**
 * The plugin API: everything a plugin can see and do, as types.
 *
 * This file is the contract. `host.ts` implements it over the editor's store; a plugin
 * repository type-checks against the declarations `npm run build:plugin-types` emits
 * from it. Nothing here is React, and nothing here is a Jotai atom: a plugin gets plain
 * functions and plain data. Changing a signature or a meaning in a way an existing
 * plugin would notice is an API change — bump `PLUGIN_API_VERSION`.
 *
 * `docs/plugins.md` is the prose tour; keep the two in step.
 */
import type { Scenario } from "../formats/chk/scenario";
import type { DoodadRecord, LocationRecord, SpriteRecord, UnitRecord } from "../formats/chk/sections/objects";
import type { LoadedTileset } from "../formats/tileset/load";
import type { TerrainType, TileInfo } from "../formats/tileset/palette";
import type { TilesetId } from "../data/tilesets";
import type { Rect } from "../editor/terrain";
import type { Diamond } from "../editor/isom";
import type { Bounds, LocationPatch } from "../editor/locations";
import type { FogMode } from "../editor/fog";
import type { SpriteKind } from "../editor/sprites";
import type { UnitGroup } from "../data/units";
import type { SpriteGroup } from "../data/sprites";
import type { EditorLayer, TerrainMode } from "../atoms/editorAtoms";
import type { DialogId } from "../atoms/uiAtoms";
import type { MapImageOptions } from "../services/mapImage";
import type { SectionInfo, SectionKnowledge } from "../editor/sections";
import type { CombineMode } from "../formats/chk/reader";
import type { ActionRecord, ConditionRecord, TriggerRecord } from "../formats/chk/sections/triggers";
import type { ActionDef, ArgDef, ArgKind, Choice, ConditionDef } from "../data/triggerDefs";
import type { TextTrigger, TriggerNames } from "../formats/triggers/text";
import type { Issue, IssueLevel, IssueTarget } from "../editor/validate";
import type { MapStatistics } from "../editor/statistics";
import type { FindKind, FindOptions, FindResult } from "../editor/find";
import type { StringUsage } from "../editor/strings";
import type { PlacementProblem, PlacementVerdict } from "../editor/placement";
import type { FlingyDat, ImagesDat, Race, SpritesDat, TechdataDat, UnitsDat, UpgradesDat, WeaponsDat } from "../formats/dat/dat";
import type { ViewFlags } from "../atoms/editorAtoms";

export type {
  TriggerRecord, ConditionRecord, ActionRecord, ConditionDef, ActionDef, ArgDef, ArgKind, Choice, TriggerNames, TextTrigger,
  Issue, IssueLevel, IssueTarget, MapStatistics, FindKind, FindOptions, FindResult, StringUsage, PlacementVerdict, PlacementProblem,
  UnitsDat, WeaponsDat, UpgradesDat, TechdataDat, SpritesDat, FlingyDat, ImagesDat, Race, ViewFlags,
};
export type { Scenario, UnitRecord, SpriteRecord, DoodadRecord, LocationRecord, LoadedTileset, TerrainType, TileInfo, TilesetId, Rect, Diamond, Bounds, LocationPatch, FogMode, SpriteKind, UnitGroup, SpriteGroup, EditorLayer, TerrainMode, DialogId, MapImageOptions, SectionInfo, SectionKnowledge, CombineMode };

/**
 * The version a host provides; a manifest that asks for a newer one is refused. It stays
 * at 1 while the API is only used by the plugins in the scm-js organisation and grows
 * with them — the first incompatible change after outside plugins exist bumps it.
 */
export const PLUGIN_API_VERSION = 1;

export interface Disposable {
  dispose(): void;
}

/* ── Manifest and module ────────────────────────────────── */

/** `plugin.json`, next to the entry file. Only `name` is required. */
export interface PluginManifest {
  name: string;
  /** Stable identifier (storage prefix, log prefix); derived from the name when absent. */
  id?: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  /** Entry file relative to the manifest; `plugin.ts` by default, then `plugin.js`. */
  entry?: string;
  /**
   * The plugin's face in Manage Plugins and on its own dialogs: an emoji (`"🗺️"`), a
   * `data:image/…` URI, an `https://…` image, or an image file beside the manifest
   * (`"icon.svg"`). Anything else is ignored — see `resolveIcon` in `loader.ts`.
   */
  icon?: string;
  /** The `PLUGIN_API_VERSION` the plugin was written against. */
  api?: number;
}

/** What `activate` may hand back: nothing, a cleanup function, or a Disposable. */
export type Deactivate = void | (() => void) | Disposable;

export type PluginActivate = (api: PluginApi) => Deactivate | Promise<Deactivate>;

/**
 * The shape of the entry module: `export default function activate(api) {…}`, or
 * `export default { activate }`, or `export function activate(api) {…}`.
 */
export interface PluginModule {
  activate: PluginActivate;
}

/** A manifest `icon` after resolution: a glyph to print, or an image to show. */
export type PluginIcon = { kind: "text"; text: string } | { kind: "image"; url: string };

export interface PluginInfo {
  /** Manifest id (or slug of the name). */
  id: string;
  name: string;
  /** The spec the plugin was installed from (`builtin:…`, `github:…`, a URL). */
  source: string;
  version?: string;
  /** The manifest's `icon`, resolved; absent when it declared none (or an unusable one). */
  icon?: PluginIcon;
}

/* ── The API ────────────────────────────────────────────── */

export interface PluginApi {
  readonly apiVersion: number;
  readonly plugin: PluginInfo;
  readonly document: DocumentApi;
  readonly triggers: TriggersApi;
  readonly terrain: TerrainApi;
  readonly tileset: TilesetApi;
  readonly selection: SelectionApi;
  readonly palette: PaletteApi;
  readonly names: NamesApi;
  readonly query: QueryApi;
  readonly data: DataApi;
  readonly graphics: GraphicsApi;
  readonly view: ViewApi;
  readonly ui: UiApi;
  readonly menu: MenuApi;
  readonly contextMenu: ContextMenuApi;
  readonly hotkeys: HotkeyApi;
  readonly commands: CommandsApi;
  readonly events: EventsApi;
  readonly storage: StorageApi;
  /** `console.log` with the plugin's name in front. */
  log(...args: unknown[]): void;
}

/* ── Document ───────────────────────────────────────────── */

export interface DocumentInfo {
  name: string;
  description: string;
  width: number;
  height: number;
  tileset: TilesetId;
  /** ERA as stored (the tileset is `era & 7`). */
  era: number;
  /** CHK VER: 59 original, 63 hybrid, 205 Brood War, 206 Remastered. */
  version: number;
  fileName: string | null;
  modified: boolean;
}

/** What one `document.edit` changed, per list. */
export interface EditResult {
  changed: boolean;
  tiles: number;
  isom: number;
  units: number;
  sprites: number;
  doodads: number;
  locations: number;
  fog: number;
  notes: string[];
}

export type MapFileFormat = "scx" | "scm" | "chk";

export interface ExportOptions {
  /** The container: `scx` (default) or `scm` archives, `chk` the bare scenario. */
  format?: MapFileFormat;
  /** The file's name; defaults to the open file's, or the scenario name plus the format. */
  fileName?: string;
}

/**
 * The files stored in the map archive next to `staredit\scenario.chk`: custom sounds,
 * graphics, and anything a plugin wants to keep with the map. Names are archive paths
 * with backslashes (`staredit\wav\hello.wav`). They are written on Save.
 */
export interface ExtrasApi {
  list(): string[];
  get(name: string): Uint8Array | null;
  /** Add or replace a member; marks the map modified. */
  set(name: string, bytes: Uint8Array): void;
  /** Remove a member; true when there was one. */
  remove(name: string): boolean;
}

export interface DocumentApi {
  isOpen(): boolean;
  info(): DocumentInfo | null;
  /**
   * The live scenario, for reading. Writing to it directly bypasses undo, dirty
   * tracking and repaints — use `edit`.
   */
  scenario(): Scenario | null;
  /**
   * Run `build` against a transaction and record what it did as one undo entry.
   * Operations apply as they are called, so later ones see earlier ones' results.
   * Returns an all-zero result with `changed: false` when no map is open.
   */
  edit(label: string, build: (tx: EditTransaction) => void): EditResult;
  /**
   * The second kind of write: the tables and settings that live outside the undo model
   * — triggers, the string table, switch names, the scenario's own properties — as one
   * transaction, the way a settings dialog's OK applies its whole form at once.
   * Operations apply as they are called; the commit marks the map modified and bumps
   * what the chrome reads. There is no undo entry: keep your own if you need one.
   */
  update(label: string, build: (tx: UpdateTransaction) => void): UpdateResult;
  undo(): string | null;
  redo(): string | null;
  /**
   * Open a map file (`.scx` / `.scm` / `.chk`) in place of the current one, the way
   * File ▸ Open does: when the open map has unsaved changes and Preferences say to ask,
   * the Close Scenario dialog comes first and the user may cancel. Resolves true once
   * the file is the open document, false when the user kept the current map or the
   * file could not be read (the status bar says why).
   */
  open(file: File | Blob | Uint8Array, fileName?: string): Promise<boolean>;
  /**
   * The open map as a file, exactly as Save would write it — archive extras included.
   * Null when no map is open.
   */
  export(options?: ExportOptions): Promise<File | null>;
  /**
   * A picture of the map as File ▸ Export ▸ Image draws it, as a PNG. `pixelsPerTile`
   * is the one dial (32 is the game's art 1:1, 1 is a minimap); the other options
   * default as the dialog's do. Needs the tileset graphics — without them, or without
   * a map, null.
   */
  renderImage(options?: Partial<MapImageOptions>): Promise<Blob | null>;
  readonly extras: ExtrasApi;
  readonly sections: SectionsApi;
}

/** What a raw section edit reported: the parser's remarks about the file it produced. */
export interface RawEditResult {
  /** Warnings from parsing the edited file (a truncated section, no usable DIM, …); empty when it read cleanly. */
  warnings: string[];
}

/**
 * The scenario file at the byte level: every section occurrence in the order Save would
 * write them, with the bytes it would write — unsaved edits already encoded — and raw
 * edits to any of them.
 *
 * A raw edit is a different kind of transaction from `document.edit`: the edited file is
 * parsed again from scratch and installed as the open document, so the change reaches
 * every part of the editor whether or not it models the section — and, as with Resize,
 * the undo history is dropped and every selection cleared. The map is marked modified
 * and the `"document"` event fires. Keep your own undo if you need one.
 *
 * Indices are positions in `list()` and shift when a section is inserted or removed
 * before them; take a fresh `list()` after every edit.
 */
export interface SectionsApi {
  /** Every occurrence in file order; empty without a map. */
  list(): SectionInfo[];
  /** A copy of one occurrence's payload. */
  bytes(index: number): Uint8Array;
  /**
   * The bytes the game acts on for a name — repeated occurrences combined the way the
   * game combines them (`SectionKnowledge.mode`) — or null when the file has none.
   */
  combined(name: string): Uint8Array | null;
  /** The whole CHK as Save would write it (the archive extras are `document.extras`). */
  file(): Uint8Array;
  /** What the editor knows about a section name, sized for the open map; null for an unknown name. */
  spec(name: string): SectionKnowledge | null;
  /** Every section the editor knows, sized for the open map. */
  known(): SectionKnowledge[];
  /** Replace one occurrence's payload. */
  write(index: number, bytes: Uint8Array): RawEditResult;
  /** Rename one occurrence (four characters; shorter names are padded with spaces). */
  rename(index: number, name: string): RawEditResult;
  /** Insert a section before `index` (`list().length` appends). */
  insert(index: number, name: string, bytes: Uint8Array): RawEditResult;
  remove(index: number): RawEditResult;
  /** Move the occurrence at `from` so that it sits at `to`. */
  move(from: number, to: number): RawEditResult;
  /** Replace the whole CHK, the way File ▸ Open reads one. */
  replaceFile(bytes: Uint8Array): RawEditResult;
}

/** Cells for the bulk terrain operations: a tile rect, or cell indices (`y * width + x`). */
export type Cells = Rect | Iterable<number>;

export interface EditTransaction {
  readonly scenario: Scenario;
  readonly width: number;
  readonly height: number;

  /** MTXM (what the game draws) at a cell. */
  tileAt(x: number, y: number): number;
  /** TILE (the ground without doodads) at a cell. */
  groundAt(x: number, y: number): number;
  /** One tile into both sections. */
  setTile(x: number, y: number, id: number): void;
  /** Many tiles into both sections; returns how many changed. */
  setTiles(cells: Cells, id: number): number;
  /**
   * The Rect brush: flat left/right pairs by column parity, one random variation per
   * pair (`variation` pins it). Needs the tileset graphics; returns tiles changed.
   */
  stampTerrain(cells: Cells, terrainId: number, variation?: number): number;
  /** Lay terrain the way a new map is laid over `rect`, ISOM lattice included when the map has one. */
  fillFlat(rect: Rect, terrainId: number): number;
  /**
   * The isometric brush on one diamond: sets its ISOM value and regenerates the tiles
   * around it, cliffs and shores included. Needs ISOM and the tileset; returns whether
   * the terrain could be painted there.
   */
  paintIsom(d: Diamond, terrainId: number, extent?: number): boolean;

  /** A StarEdit-style unit record (fresh serial, valid/used masks) centred on map pixels. */
  makeUnit(unitId: number, owner: number, x: number, y: number): UnitRecord;
  addUnits(records: UnitRecord[]): number[];
  removeUnits(indices: number[]): number;
  updateUnits(indices: number[], patch: (u: UnitRecord) => Partial<UnitRecord>): number;
  /**
   * A unit the way the Units palette places one: a building snaps its placement box to
   * the tile grid (when the palette's *Snap to grid* is on), anything else lands where
   * you say, and nothing leaves the map. No placement checks — ask `canPlaceUnit` first
   * if you want them. Returns the record's index.
   */
  placeUnit(unitId: number, owner: number, x: number, y: number): number;
  /** Whether the Units palette's placement checks, with its current options, allow a unit of this type centred there. */
  canPlaceUnit(unitId: number, x: number, y: number): boolean;

  makeSprite(kind: SpriteKind, id: number, owner: number, x: number, y: number, opts?: { flipped?: boolean; disabled?: boolean }): SpriteRecord;
  addSprites(records: SpriteRecord[]): number[];
  removeSprites(indices: number[]): number;
  /** `makeSprite` + `addSprites` in one, kept on the map; returns the record's index. */
  placeSprite(kind: SpriteKind, id: number, owner: number, x: number, y: number, opts?: { flipped?: boolean; disabled?: boolean }): number;

  /** Stamp a doodad (a `dddata.bin` id) at a tile; returns its record index, or -1 when unknown or off the map. */
  placeDoodad(doodadId: number, tx: number, ty: number, owner?: number): number;
  removeDoodads(indices: number[]): number;

  /** A location in the lowest free slot (pixel bounds); returns the slot, or -1 when the table is full. */
  addLocation(bounds: Bounds, name?: string, elevationFlags?: number): number;
  editLocation(index: number, patch: LocationPatch): boolean;
  removeLocations(indices: number[]): number;

  /** Set (`"fog"`) or clear the `players` bits (bit n = player n + 1) over cells; creates MASK on first use. */
  setFog(cells: Cells, players: number, mode: FogMode): number;

  /** A line for the status bar, appended to the label. */
  note(text: string): void;
}

/* ── Update transactions: tables and settings ───────────── */

/**
 * What one `document.update` changed: every section it marked dirty, in the order the
 * operations touched them, and `changed` false when they were all no-ops.
 */
export interface UpdateResult {
  changed: boolean;
  sections: string[];
  notes: string[];
}

/** TRIG or MBRF as a list. Operations apply as they are called, like `document.edit`'s. */
export interface TriggerListUpdate {
  /** The list as it stands, cloned. */
  list(): TriggerRecord[];
  count(): number;
  /** Replace the whole list. */
  set(list: TriggerRecord[]): void;
  /** Insert one (at the end without `at`); returns its index. */
  add(trigger: TriggerRecord, at?: number): number;
  /** Replace one record; false when there is none at `index`. */
  replace(index: number, trigger: TriggerRecord): boolean;
  remove(indices: number[]): number;
  move(from: number, to: number): boolean;
  /**
   * Parse the text format (`triggers.text.print`'s inverse) and append the result, or
   * replace the list with `replace: true`. Strings the text names are interned as it
   * parses. Throws with the line number when the text does not parse.
   */
  fromText(source: string, options?: { replace?: boolean }): number;
}

/**
 * The string table. Nothing is ever renumbered: `set` overwrites a slot (every record
 * pointing at it sees the new text) and `intern` appends rather than reusing a slot
 * something else may share.
 */
export interface StringsUpdate {
  list(): (string | null)[];
  /** The index of `text`: an identical entry when there is one, else a new one. 0 for `""`. */
  intern(text: string): number;
  /** Overwrite one slot. */
  set(index: number, text: string): void;
  /** Install a whole table; unreferenced trailing blanks are dropped, other indices keep their place. */
  apply(list: (string | null)[]): void;
}

export interface SwitchesUpdate {
  names(): string[];
  /** Name a switch (0-based); `""` clears the name. Creates SWNM on the first one. */
  setName(index: number, name: string): void;
}

/**
 * The second kind of write (see `document.update`): the tables and settings the editor's
 * own dialogs edit. Operations apply to the scenario as they are called — a string
 * interned on one line is there for the trigger added on the next — and the commit at
 * the end marks the map modified and tells the chrome to re-read.
 */
export interface UpdateTransaction {
  readonly scenario: Scenario;
  /** TRIG. */
  readonly triggers: TriggerListUpdate;
  /** MBRF, the mission briefing's own list of the same records. */
  readonly briefing: TriggerListUpdate;
  readonly strings: StringsUpdate;
  /** SWNM. */
  readonly switches: SwitchesUpdate;
  /** SPRP: the scenario's name and description (`""` restores the file-name default). */
  properties(patch: { name?: string; description?: string }): void;
  /** A line for the status bar, appended to the label. */
  note(text: string): void;
}

/* ── Triggers ───────────────────────────────────────────── */

/**
 * What each condition and action type takes: the argument list in the order StarEdit's
 * TrigEdit shows it, each naming the record field it lives in and the kind of value it
 * is (a player group, a unit id, a location, a comparison, …). Everything that displays
 * or edits a trigger reads this table, the editor's own dialogs included.
 */
export interface TriggerDefsApi {
  conditions(): ConditionDef[];
  condition(type: number): ConditionDef | undefined;
  actions(briefing?: boolean): ActionDef[];
  action(type: number, briefing?: boolean): ActionDef | undefined;
  /** The values an enumerated argument kind can take, with their labels. */
  choices(kind: ArgKind): Choice[];
  choiceLabel(kind: ArgKind, value: number): string | undefined;
  /** The value behind a label or one of its aliases, for parsing. */
  choiceValue(kind: ArgKind, text: string): number | undefined;
}

/** Printing and parsing the text trigger format (File ▸ Import / Export ▸ Triggers). */
export interface TriggerTextApi {
  print(triggers: TriggerRecord[], options?: { briefing?: boolean }): string;
  /**
   * Parse text into records, resolving names against the open map (and interning the
   * strings it mentions). Throws a `TriggerTextError` carrying the line on bad input.
   */
  parse(source: string, options?: { briefing?: boolean }): TextTrigger[];
  /** One trigger as its `Trigger(…)` block. */
  one(trigger: TriggerRecord, options?: { briefing?: boolean }): string;
}

/**
 * Reading triggers, and the pure helpers that make them presentable. Writing goes
 * through `document.update`.
 */
export interface TriggersApi {
  /** TRIG, cloned. */
  list(): TriggerRecord[];
  /** MBRF, cloned. */
  briefing(): TriggerRecord[];
  /** SWNM as names, StarEdit's `Switch N` where there is none. */
  switchNames(): string[];
  /** How many conditions and actions mention each switch. */
  switchUsage(): number[];
  /** The name context the text format resolves against: the map's locations, units, switches and strings. */
  names(): TriggerNames;
  readonly defs: TriggerDefsApi;
  readonly text: TriggerTextApi;
  /** An empty trigger owned by the given player groups (All Players by default). */
  newTrigger(players?: number[]): TriggerRecord;
  /** A condition of a type, with StarEdit's defaults for its arguments. */
  newCondition(type: number): ConditionRecord;
  newAction(type: number, briefing?: boolean): ActionRecord;
  isPreserved(trigger: TriggerRecord): boolean;
  setPreserved(trigger: TriggerRecord, on: boolean): TriggerRecord;
  /** The indices of the triggers any of these player groups own. */
  triggersFor(list: TriggerRecord[], groups: number[]): number[];
  /** The three lines the trigger list shows: players, conditions, actions. */
  summarize(trigger: TriggerRecord, briefing?: boolean): { players: string; conditions: string; actions: string };
  /** A trigger's `Comment` action text, when it has one. */
  comment(trigger: TriggerRecord): string | null;
}

/* ── Query ──────────────────────────────────────────────── */

/** A start location on the map: the record's index, its owner and where it sits. */
export interface StartLocation {
  index: number;
  owner: number;
  /** Map pixels. */
  x: number;
  y: number;
  /** The tile it is centred on. */
  tx: number;
  ty: number;
}

/**
 * Reading the open map: what is under a point, what lies in a rectangle, and the
 * editor's own analyses — Check Map's issues, Tools ▸ Statistics, the Ctrl+F search and
 * the string usage map the String Editor is built on.
 *
 * Everything here is a read: nothing changes the map, and nothing throws without one
 * (an empty list, or null).
 */
export interface QueryApi {
  /** The topmost unit whose sprite box covers a map pixel, or -1. */
  unitAt(px: number, py: number): number;
  /** Every unit whose centre lies in a tile rect. */
  unitsIn(rect: Rect): number[];
  /** Units owned by a player (0-based). */
  unitsOf(owner: number): number[];
  spriteAt(px: number, py: number): number;
  spritesIn(rect: Rect): number[];
  /** The doodad covering a tile, or -1. */
  doodadAt(tx: number, ty: number): number;
  /** The smallest location covering a map pixel (never Anywhere), or -1. */
  locationAt(px: number, py: number): number;
  /** Locations wholly inside a tile rect (never Anywhere). */
  locationsIn(rect: Rect): number[];
  /** The map's start locations, by player. */
  startLocations(): StartLocation[];
  /** Whether a unit type may be placed centred there, and what stops it. */
  placement(unitId: number, x: number, y: number): PlacementVerdict;
  /** Check Map: every issue the editor knows how to spot, with a `target` to go to. */
  validate(): Issue[];
  /** Tools ▸ Statistics: tile, unit, resource and player counts. Null without a map. */
  statistics(): MapStatistics | null;
  /** The Ctrl+F search over units, locations, sprites, strings and triggers. */
  find(options: FindOptions): FindResult[];
  /** Every record that refers to each string index. */
  stringUsage(): Map<number, StringUsage[]>;
  /** String slots nothing refers to. */
  unusedStrings(): number[];
}

/* ── The view ───────────────────────────────────────────── */

/** Where `view.goTo` should take the user. Issues from `query.validate` carry one. */
export type GoTo =
  | { kind: "tile"; x: number; y: number }
  | { kind: "unit"; index: number }
  | { kind: "sprite"; index: number }
  | { kind: "location"; index: number };

/**
 * The map view: where the viewport is looking, how far in, and what it draws over the
 * terrain. A plugin that finds something needs this to show the user where it is.
 */
export interface ViewApi {
  zoom(): number;
  /** 0.25 … 8, as the zoom control's steps. */
  setZoom(zoom: number): void;
  /** The tiles on screen. */
  visible(): Rect;
  /** Scroll so a tile is in the middle of the viewport. */
  center(x: number, y: number): void;
  /** Scroll to an object (and select it, for a unit, sprite or location). */
  goTo(target: GoTo): void;
  /** The tile under the pointer, as the status bar shows it. */
  cursorTile(): { x: number; y: number };
  /** The View menu's ticks: grid, locations, units, sprites, doodads, fog, … */
  flags(): ViewFlags;
  setFlags(patch: Partial<ViewFlags>): void;
  /** Grid spacing in map pixels (32 = one tile). */
  gridSize(): number;
  setGridSize(size: 8 | 16 | 32 | 64 | 128): void;
}

/* ── Commands ───────────────────────────────────────────── */

export interface CommandSpec {
  /**
   * The command's id. One without a dot is namespaced under the plugin
   * (`"paint" → "paint-plugin.paint"`); one with a dot is taken as it is, so a plugin
   * can offer a stable name others call.
   */
  id: string;
  /** What a menu or a command list should call it. */
  title: string;
  enabled?: () => boolean;
  run: (...args: unknown[]) => unknown;
}

export interface CommandInfo {
  id: string;
  title: string;
  pluginId: string;
  enabled: boolean;
}

/**
 * Named things a plugin can do, so a menu item, a hotkey, a context entry and another
 * plugin all reach the same one. `menu.add`, `contextMenu.add` and `hotkeys.add` take a
 * `command` id in place of a `run`.
 */
export interface CommandsApi {
  register(spec: CommandSpec): Disposable;
  /** Run one, whoever registered it; the command's own return value, or undefined when there is no such command. */
  run(id: string, ...args: unknown[]): unknown;
  has(id: string): boolean;
  /** Every command registered by every plugin. */
  list(): CommandInfo[];
}

/* ── Graphics ───────────────────────────────────────────── */

/** A picture the editor already has: the canvas it draws from, and its size in pixels. */
export interface PluginImage {
  image: HTMLCanvasElement;
  width: number;
  height: number;
}

/**
 * The pictures the viewport draws, for a plugin's own lists and previews: the same
 * cached canvases, so asking for one costs nothing after the first time. Everything is
 * null when the graphics it needs were never extracted — a plugin shows a name instead.
 */
export interface GraphicsApi {
  /** Whether the tileset graphics and the unit tables are in memory. */
  ready(): { tileset: boolean; units: boolean };
  /** Fetch both; resolves with what is available afterwards. */
  load(): Promise<{ tileset: boolean; units: boolean }>;
  /** A unit type in its editor pose, in a player's colours (`owner` 0 by default). */
  unitImage(unitId: number, options?: { owner?: number }): PluginImage | null;
  /** A THG2 sprite: a sprites.dat image for `"pure"`, a unit for `"unit"`. */
  spriteImage(kind: SpriteKind, id: number, options?: { owner?: number; flipped?: boolean }): PluginImage | null;
  /** One 32 × 32 megatile of the open map's tileset. */
  tileImage(tileId: number): PluginImage | null;
  /** A doodad drawn from its own tiles. */
  doodadImage(doodadId: number): PluginImage | null;
  /**
   * Part of the map as File ▸ Export ▸ Image draws it — the same render, cropped to a
   * tile rect. Everything it needs is loaded first; null without a map or a canvas.
   */
  renderRect(rect: Rect, options?: Partial<MapImageOptions>): Promise<Blob | null>;
  /** The colour a player's units are drawn in, `#rrggbb`. */
  playerColor(owner: number): string;
  /**
   * Start fetching the GRPs a unit type needs, and say whether they are already in
   * memory. Graphics load lazily, so the first `unitImage` for a type is often null —
   * ask for it here, redraw on `onImageLoaded`, and the list fills in.
   */
  requestUnit(unitId: number): boolean;
  requestSprite(kind: SpriteKind, id: number): boolean;
  /** A GRP finished loading: anything drawn from one may look different now. */
  onImageLoaded(listener: () => void): Disposable;
}

/* ── Game data ──────────────────────────────────────────── */

/**
 * The game's own tables, as the editor decoded them: `units.dat` and its neighbours.
 * `names` gives the labels, this gives the numbers — hit points, costs, build times,
 * weapons, flags, the sprite and image each unit draws through.
 *
 * Everything is null until the tables are loaded (`load`), and stays null when the game
 * data was never extracted.
 */
export interface DataApi {
  ready(): boolean;
  load(): Promise<boolean>;
  units(): UnitsDat | null;
  weapons(): WeaponsDat | null;
  upgrades(): UpgradesDat | null;
  techs(): TechdataDat | null;
  sprites(): SpritesDat | null;
  flingy(): FlingyDat | null;
  images(): ImagesDat | null;
  /** Which race a unit type belongs to, from its flags. */
  race(unitId: number): Race;
  /** The GRP path an image id draws from, relative to `unit\`. */
  imagePath(imageId: number): string | null;
}

/* ── Terrain and tileset ────────────────────────────────── */

export interface ActiveBrush {
  mode: TerrainMode;
  /** The Rect / isometric brush's terrain id. */
  terrain: number;
  /** The Tile brush's MTXM id. */
  tile: number;
  brushSize: number;
}

export interface TerrainApi {
  /** Paintable flat terrains of the open map's tileset (empty without the graphics). */
  types(): TerrainType[];
  /** Terrain ids the isometric brush can paint on this tileset. */
  isomTypes(): number[];
  /** Whether the open map carries an ISOM section the isometric brush can work on. */
  hasIsom(): boolean;
  tileInfo(id: number): TileInfo | null;
  /** The atlas average of a tile, packed `0xRRGGBB`, or null without graphics. */
  color(tileId: number): number | null;
  /** The mean colour of a terrain's common flat variations, packed `0xRRGGBB`. */
  terrainColor(terrainId: number): number | null;
  /** A flat terrain's height level (0 low, 1 high, 2 higher), or null when it is not one. */
  heightOf(terrainId: number): 0 | 1 | 2 | null;
  /** The lattice diamond under a map pixel. */
  diamondAt(px: number, py: number): Diamond;
  isDiamond(d: Diamond): boolean;
  /** Every in-bounds diamond whose centre tile lies in `rect`, row by row. */
  diamondsIn(rect: Rect): Diamond[];
  active(): ActiveBrush;
  setActive(brush: Partial<ActiveBrush>): void;
}

export interface TilesetApi {
  id(): TilesetId | null;
  name(): string;
  isLoaded(): boolean;
  /** Fetch and decode the graphics; resolves false when they were never extracted. */
  load(): Promise<boolean>;
  raw(): LoadedTileset | null;
}

/* ── Selection ──────────────────────────────────────────── */

export interface SelectionApi {
  /** The Cut / Copy / Paste layer's marked rectangle, in tiles. */
  markedArea(): Rect | null;
  markArea(rect: Rect | null): void;
  units(): number[];
  setUnits(indices: number[]): void;
  sprites(): number[];
  setSprites(indices: number[]): void;
  doodads(): number[];
  setDoodads(indices: number[]): void;
  locations(): number[];
  setLocations(indices: number[]): void;
  layer(): EditorLayer;
  setLayer(layer: EditorLayer): void;
}

/* ── Palettes ───────────────────────────────────────────── */

/**
 * What the Units, Sprites, Doodads and Fog of War palettes have picked — the thing a
 * click on the map would place or paint. (The Terrain palette's pick is
 * `terrain.active()`.) Players are 0-based: `owner` 0 is Player 1.
 */
export interface PaletteChoice {
  /** units.dat id the Units palette places. */
  unit: number;
  /** The player it places for, 0–11. */
  owner: number;
  spriteKind: SpriteKind;
  /** sprites.dat id, placed when `spriteKind` is `"pure"`. */
  sprite: number;
  /** units.dat id, placed when `spriteKind` is `"unit"` (doors and traps). */
  unitSprite: number;
  spriteFlipped: boolean;
  spriteDisabled: boolean;
  /** The Doodads palette's doodad id, or -1 before one was picked. */
  doodad: number;
  /** Bit mask of the players the fog brush paints for (bit n = player n + 1). */
  fogPlayers: number;
  fogMode: FogMode;
}

/** A unit type's footprint, from units.dat; a one-tile box without the tables. */
export interface UnitSize {
  /** The placement box, in pixels. */
  width: number;
  height: number;
  building: boolean;
  flyer: boolean;
}

export interface DoodadInfo {
  id: number;
  /** "Trees #12" — the palette category and the id, which is the only name a doodad has. */
  name: string;
  category: string;
  /** Footprint in tiles. */
  width: number;
  height: number;
}

export interface PaletteApi {
  active(): PaletteChoice;
  setActive(choice: Partial<PaletteChoice>): void;
  /** The colour a player's units are shown in, `#rrggbb`. */
  playerColor(owner: number): string;

  /** Every unit type, grouped the way the Units palette lists them. */
  unitGroups(): UnitGroup[];
  unitName(unitId: number): string;
  unitSize(unitId: number): UnitSize;

  /** What the Sprites palette lists, by group; empty until the unit tables are loaded. */
  spriteGroups(): SpriteGroup[];
  /** "Terran Marine" for a unit sprite, the unit or GRP the pure sprite draws otherwise. */
  spriteName(kind: SpriteKind, id: number): string;

  /** The open map's doodads by palette category; empty without the tileset graphics. */
  doodadCategories(): { name: string; doodads: DoodadInfo[] }[];
  doodadInfo(doodadId: number): DoodadInfo | null;
}

/* ── Names ──────────────────────────────────────────────── */

export interface NamedValue {
  value: number;
  label: string;
}

/**
 * The names behind the numbers a map stores, so a plugin that shows raw values need not
 * carry the game's tables itself. The per-map ones (`string`, `location`, `switch`,
 * `player`) read the open scenario and answer a placeholder without one; the rest are
 * the editor's own tables — the same names StarEdit shows.
 */
export interface NamesApi {
  /** StarEdit's name for a units.dat id; `Any unit` / `Men` / `Buildings` / `Factories` for the trigger classes 228–231. */
  unit(id: number): string;
  units(): NamedValue[];
  upgrade(id: number): string;
  upgrades(): NamedValue[];
  tech(id: number): string;
  techs(): NamedValue[];
  weapon(id: number): string;
  weapons(): NamedValue[];
  /** An OWNR / IOWN controller byte: `Human`, `Computer`, `Neutral`, … */
  playerType(value: number): string;
  playerTypes(): NamedValue[];
  /** A SIDE race byte. */
  race(value: number): string;
  races(): NamedValue[];
  /** One of the 27 trigger player groups (`Player 1` … `Non Allied Victory Players`). */
  playerGroup(value: number): string;
  playerGroups(): NamedValue[];
  /** A TRIG condition type. */
  condition(type: number): string;
  conditions(): NamedValue[];
  /** A TRIG action type, or an MBRF one with `briefing`. */
  action(type: number, briefing?: boolean): string;
  actions(briefing?: boolean): NamedValue[];
  /** The script behind a Run AI Script code (the four characters as a little-endian u32); the code itself when unknown. */
  aiScript(code: number): string;
  /** The open map's string at an index; null for 0, out of range, or no map. */
  string(index: number): string | null;
  /** A location slot's name (0-based; 63 is Anywhere), or StarEdit's default for it. */
  location(index: number): string;
  /** A switch's name (0-based), or `Switch N`. */
  switch(index: number): string;
  /** `Player N` for a slot (0-based). */
  player(slot: number): string;
  /** The terrain a MTXM / TILE id belongs to (`Dirt`, `High Dirt`, a cliff, …), or null without the tileset graphics. */
  tile(id: number): string | null;
}

/* ── UI ─────────────────────────────────────────────────── */

export type DialogSize = "sm" | "md" | "lg" | "xl" | "full";

export interface DialogButton {
  label: string;
  primary?: boolean;
  /** Return `false` (or a promise of it) to keep the dialog open. */
  run?: (dialog: DialogHandle) => void | boolean | Promise<void | boolean>;
  /** Close after `run`; default true. */
  closes?: boolean;
}

/** What a paste or a drop brought into a dialog. */
export interface DialogTransfer {
  files: File[];
  text: string;
}

export interface DialogSpec {
  title: string;
  size?: DialogSize;
  tall?: boolean;
  /** Fill `body` (an empty `<div>` inside the dialog); return a cleanup if you need one. */
  mount(body: HTMLElement, dialog: DialogHandle): void | (() => void);
  /** Footer buttons, left to right; a single Close when omitted. */
  buttons?: DialogButton[];
  /**
   * Ctrl+V anywhere in the dialog (while it is the topmost one). Files come from the
   * clipboard's items — a screenshot pastes as one `image/png` file — and `text` is the
   * plain-text part, so a copied image URL arrives here too.
   */
  onPaste?: (transfer: DialogTransfer, dialog: DialogHandle) => void;
  /** Something dropped onto the dialog body. */
  onDrop?: (transfer: DialogTransfer, dialog: DialogHandle) => void;
}

export interface DialogHandle {
  close(): void;
  /** Whether the dialog is still on screen. */
  isOpen(): boolean;
  /** Change the title strip's text. */
  setTitle(title: string): void;
}

/**
 * A panel floats over the map and does not block it: the user keeps drawing, scrolling
 * and using hotkeys while it is open (except while typing in one of its fields). It
 * is dragged by its title bar and closed with the × or `close()`.
 */
export interface PanelSpec {
  title: string;
  /** In CSS pixels; 260 by default. The panel is as tall as its content, up to the map's height. */
  width?: number;
  /** Fill `body` (an empty `<div>` inside the panel); return a cleanup if you need one. */
  mount(body: HTMLElement, panel: PanelHandle): void | (() => void);
  /** The panel closed, whichever way. */
  onClose?: () => void;
}

export interface PanelHandle {
  close(): void;
  isOpen(): boolean;
  setTitle(title: string): void;
}

/** The pointer over the map, in the map's own units. A tile is 32 × 32 pixels. */
export interface MapPointer {
  /** Map pixels. Kept inside the map while a button is held, as the built-in brushes do. */
  px: number;
  py: number;
  /** The tile under the pointer. */
  tx: number;
  ty: number;
  /** False once the pointer has left the map with no button held. */
  inMap: boolean;
  /** Whether the primary button is held. */
  down: boolean;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** Map pixels to canvas pixels, for a tool's `draw`. */
export interface MapView {
  zoom: number;
  /** Canvas pixels per tile. */
  tilePx: number;
  /** A map pixel's x on the canvas. */
  x(px: number): number;
  y(py: number): number;
  /** The tiles on screen. */
  visible: Rect;
}

export type MapToolStopReason =
  /** `handle.stop()`. */
  | "stopped"
  /** Esc or a right-click, and `onCancel` did not keep the tool. */
  | "cancelled"
  /** The map was closed or replaced. */
  | "document"
  /** Another tool started. */
  | "replaced"
  /** The plugin was disabled. */
  | "disabled";

/**
 * A tool owns the pointer over the map: the viewport hands it every press, move and
 * release ahead of the active layer's own tools, hides the layer's brush ghost, and
 * lets it draw an overlay. The map stays visible and scrollable, and a panel can stay
 * open beside it — which is how a plugin gets a drawing mode of its own.
 */
export interface MapToolSpec {
  /** Shown in the viewport's HUD and the status bar while the tool runs. */
  name: string;
  /** After the name: `"drag to draw a line"`. */
  hint?: string;
  /** CSS cursor over the map; `"crosshair"` by default. */
  cursor?: string;
  onDown?(p: MapPointer): void;
  /** Every pointer move over the map, button held or not, and once with `inMap: false` when it leaves. */
  onMove?(p: MapPointer): void;
  onUp?(p: MapPointer): void;
  /** Esc or a right-click. Return `true` to keep the tool running (you cancelled a gesture of your own); otherwise it stops. */
  onCancel?(): boolean | void;
  /** Draw over the map, after everything else, each time the viewport repaints. */
  draw?(ctx: CanvasRenderingContext2D, view: MapView): void;
  /** The tool is no longer running, for whatever reason (once). */
  onStop?(reason: MapToolStopReason): void;
}

export interface MapToolHandle {
  stop(): void;
  isActive(): boolean;
  /** Repaint the viewport — and so call `draw` — now. Cheap; call it from `onMove`. */
  redraw(): void;
}

export interface PickOptions {
  /** Shown in the viewport's HUD while the user picks; also the status line. */
  prompt?: string;
}

export interface PickFilesOptions {
  /** `accept` for the file input, e.g. `"image/*"` or `".png,.jpg"`. */
  accept?: string;
  multiple?: boolean;
}

export interface UiApi {
  status(text: string): void;
  dialog(spec: DialogSpec): DialogHandle;
  /** Open a floating panel over the map. As many as you like; each closes with the plugin. */
  panel(spec: PanelSpec): PanelHandle;
  /**
   * Take over the pointer on the map until `stop()`, Esc, a right-click, a map change
   * or another tool. One tool runs at a time — starting one stops the previous — and a
   * `pickArea` / `pickTile` in progress is served first.
   */
  mapTool(spec: MapToolSpec): MapToolHandle;
  /** The browser's file picker; resolves with an empty list on cancel. */
  pickFiles(options?: PickFilesOptions): Promise<File[]>;
  /**
   * Let the user drag a rectangle on the map. The viewport switches to a crosshair, draws
   * the marquee and takes the gesture ahead of the active layer's tools; resolves with
   * the tile rect (exclusive `x1` / `y1`), or null when the user pressed Esc or
   * right-clicked, no map is open, the map was replaced, or the plugin was disabled.
   * Only one pick runs at a time — a new one cancels the previous. A modal dialog
   * covers the map, so close yours first and reopen it with the result.
   */
  pickArea(options?: PickOptions): Promise<Rect | null>;
  /** As `pickArea`, for a single click: the tile under it. */
  pickTile(options?: PickOptions): Promise<{ x: number; y: number } | null>;
  /**
   * Decode a picture: a `File` / `Blob`, a `data:` URL, or an `http(s)` URL (fetched, and
   * when the site refuses cross-origin reads, loaded through an `<img>` with
   * `crossOrigin` — a site that allows neither rejects with a message saying so).
   */
  loadImage(source: Blob | string): Promise<ImageBitmap>;
  /** The image on the system clipboard, if the browser lets the page read it (a permission prompt may appear); null otherwise. */
  readClipboardImage(): Promise<Blob | null>;
  /** Ask a yes/no question; resolves false on Cancel, Escape or the ×. */
  confirm(message: string, options?: ConfirmOptions): Promise<boolean>;
  /** Say something with a single OK. */
  alert(message: string, options?: ConfirmOptions): Promise<void>;
  /** Ask for a line of text; null when the user cancelled. */
  prompt(message: string, options?: PromptOptions): Promise<string | null>;
  /** A progress bar over the map for long work, with an optional Cancel. */
  progress(label: string, options?: ProgressOptions): ProgressHandle;
  /** `el("div", { className: "row" }, …)`: the DOM helper the widgets are built from. */
  el<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Record<string, unknown>, ...children: WidgetChild[]): HTMLElementTagNameMap[K];
  /** Buttons, fields, forms and lists in the editor's own styles. */
  readonly widgets: WidgetsApi;
  /** Open a built-in dialog. */
  open(dialog: DialogId, payload?: Record<string, unknown>): void;
  /** Ask the viewport to repaint (a transaction does this by itself). */
  repaint(): void;
}

/* ── Prompts, progress and widgets ──────────────────────── */

export interface ConfirmOptions {
  title?: string;
  /** The primary button; `OK` by default. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Paint the primary button as a destructive action. */
  danger?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  value?: string;
  placeholder?: string;
  /** A multi-line field. */
  multiline?: boolean;
}

export interface ProgressOptions {
  title?: string;
  /** Show a Cancel button; `cancelled()` answers true once it is pressed. */
  cancellable?: boolean;
}

/**
 * A progress panel over the map. It does not block the editor — the user can still
 * scroll and look — so a plugin doing long work should report often and check
 * `cancelled()` in its loop.
 */
export interface ProgressHandle {
  /** How far along (0…1), and optionally a line under the bar. */
  report(fraction: number, text?: string): void;
  cancelled(): boolean;
  done(): void;
  isOpen(): boolean;
}

/** Anything the widget builders accept as a child: a node, text, or nothing. */
export type WidgetChild = Node | string | number | null | undefined | false;

export interface WidgetOptions {
  className?: string;
  title?: string;
  disabled?: boolean;
}

export interface ButtonOptions extends WidgetOptions {
  primary?: boolean;
  danger?: boolean;
  ghost?: boolean;
  onClick?: (event: MouseEvent) => void;
}

export interface CheckboxOptions extends WidgetOptions {
  value?: boolean;
  /** A radio button instead; give the group a `name`. */
  radio?: boolean;
  name?: string;
  onChange?: (value: boolean) => void;
}

/** The `<label>` a checkbox is, with its `<input>` on it so you can read or set the value. */
export type CheckboxElement = HTMLLabelElement & { input: HTMLInputElement };

export interface TextFieldOptions extends WidgetOptions {
  value?: string;
  placeholder?: string;
  password?: boolean;
  onChange?: (value: string) => void;
}

export interface NumberFieldOptions extends WidgetOptions {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
}

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface SelectOptions extends WidgetOptions {
  value?: string | number;
  onChange?: (value: string) => void;
}

export interface FormRow {
  label: string;
  field: HTMLElement;
}

export interface ListItem<T> {
  label: string;
  value: T;
  /** Dimmed text at the end of the row. */
  hint?: string;
  /** A number in the row's gutter, as the editor's own lists show indices. */
  index?: number;
  title?: string;
}

export interface ListOptions<T> {
  /** Which row starts selected. */
  selected?: number;
  /** Maximum height in pixels; the list scrolls past it. */
  height?: number;
  className?: string;
  onPick?: (value: T, index: number) => void;
}

/**
 * Buttons, fields, forms and lists in the editor's own styles, as plain DOM. A plugin
 * dialog built from these looks like a built-in one; `el` is the escape hatch for
 * anything they do not cover.
 */
export interface WidgetsApi {
  button(label: string, options?: ButtonOptions): HTMLButtonElement;
  checkbox(label: string, options?: CheckboxOptions): CheckboxElement;
  text(options?: TextFieldOptions): HTMLInputElement;
  number(options?: NumberFieldOptions): HTMLInputElement;
  select(items: SelectOption[], options?: SelectOptions): HTMLSelectElement;
  /** A two-column grid of labelled fields. */
  form(rows: (FormRow | null | undefined | false)[]): HTMLElement;
  /** A titled box (a `fieldset` with a legend, as the dialogs use). */
  group(title: string, ...children: WidgetChild[]): HTMLElement;
  row(...children: WidgetChild[]): HTMLDivElement;
  column(...children: WidgetChild[]): HTMLDivElement;
  /** Small dimmed explanatory text. */
  hint(text: string): HTMLElement;
  separator(): HTMLElement;
  list<T>(items: ListItem<T>[], options?: ListOptions<T>): HTMLElement;
}

/* ── Menus, context menus, hotkeys ──────────────────────── */

export type TopMenu = "File" | "Edit" | "View" | "Layer" | "Scenario" | "Triggers" | "Tools" | "Plugins" | "Help";

/** A top-level menu, or a submenu by label: `"File/Import"`. */
export type MenuPath = TopMenu | `${TopMenu}/${string}`;

export interface MenuItemSpec {
  label: string;
  /** Display only — bind the key with `hotkeys.add`. */
  shortcut?: string;
  /**
   * A mark in front of the label: `"plugin"` for the plugin's own icon (the manifest's),
   * or any `PluginIcon`. Use it when the item does something a built-in never would —
   * reach a network, say — so the user can tell at a glance.
   */
  icon?: "plugin" | PluginIcon;
  /**
   * Where in the menu: the label of the built-in item or submenu to sit directly under
   * (`"Open Recent"`). Without it, or when nothing has that label, the item goes to the
   * end of the menu after a separator.
   */
  after?: string;
  enabled?: () => boolean;
  /** What the item does. Give this or `command`. */
  run?: () => void;
  /** A registered command's id, instead of a `run` of its own. */
  command?: string;
}

export interface MenuApi {
  add(path: MenuPath, item: MenuItemSpec): Disposable;
}

export type ContextSurface = "viewport" | "terrainPalette";

export interface ContextMenuContext {
  surface: ContextSurface;
  /** The tile under the pointer (viewport only). */
  tile: { x: number; y: number } | null;
  /** The map pixel under the pointer (viewport only). */
  point: { px: number; py: number } | null;
  layer: EditorLayer;
  terrainMode: TerrainMode;
  /** The palette's active terrain id. */
  terrain: number;
  markedArea: Rect | null;
}

export interface ContextItemSpec {
  label: string | ((ctx: ContextMenuContext) => string);
  enabled?: (ctx: ContextMenuContext) => boolean;
  visible?: (ctx: ContextMenuContext) => boolean;
  /** Give this or `command` (which is run with the context as its argument). */
  run?: (ctx: ContextMenuContext) => void;
  command?: string;
}

export interface ContextMenuApi {
  add(surface: ContextSurface, item: ContextItemSpec): Disposable;
}

export interface HotkeyApi {
  /** `"Ctrl+Shift+I"`, `"Alt+F9"`, `"F8"` — modifiers in any order, then a key name. */
  add(combo: string, run: (() => void) | { command: string }): Disposable;
}

/* ── Events and storage ─────────────────────────────────── */

export type PluginEvent =
  /** A map was opened, closed or replaced. */
  | "document"
  | "terrain"
  | "units"
  | "doodads"
  | "locations"
  | "settings"
  | "triggers"
  | "layer"
  /** THG2 sprites — the same bump doodad edits make. */
  | "sprites"
  | "selection"
  /** The marked area or the clip on the clipboard changed. */
  | "clipboard"
  /** The viewport scrolled, zoomed, or a View menu tick moved. */
  | "view"
  /** A map tool or a map pick started or stopped. */
  | "tool"
  /** The map's unsaved-changes flag changed. */
  | "modified"
  /** A palette's pick changed: terrain brush, unit and owner, sprite, doodad, fog players. */
  | "palette";

export interface EventsApi {
  on(event: PluginEvent, listener: () => void): Disposable;
}

export interface StorageApi {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

/** A slug for storage keys and log prefixes. */
export function pluginIdOf(manifest: { id?: string; name: string }): string {
  const raw = manifest.id?.trim() || manifest.name;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plugin";
}
