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
  readonly terrain: TerrainApi;
  readonly tileset: TilesetApi;
  readonly selection: SelectionApi;
  readonly palette: PaletteApi;
  readonly names: NamesApi;
  readonly ui: UiApi;
  readonly menu: MenuApi;
  readonly contextMenu: ContextMenuApi;
  readonly hotkeys: HotkeyApi;
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
  /** Open a built-in dialog. */
  open(dialog: DialogId, payload?: Record<string, unknown>): void;
  /** Ask the viewport to repaint (a transaction does this by itself). */
  repaint(): void;
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
  run: () => void;
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
  run: (ctx: ContextMenuContext) => void;
}

export interface ContextMenuApi {
  add(surface: ContextSurface, item: ContextItemSpec): Disposable;
}

export interface HotkeyApi {
  /** `"Ctrl+Shift+I"`, `"Alt+F9"`, `"F8"` — modifiers in any order, then a key name. */
  add(combo: string, run: () => void): Disposable;
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
  | "selection"
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
