/**
 * The plugin API: everything a plugin can see and do, as types.
 *
 * This file is the contract. `host.ts` implements it over the editor's store; a plugin
 * repository type-checks against the single declaration file `npm run build:plugin-types`
 * bundles from it, published to `github.com/scm-js/plugin-api` and taken as a
 * devDependency. Nothing here is React, and nothing here is a Jotai atom: a plugin gets plain
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
import type { Diamond, IsomReport } from "../editor/isom";
import type { Bounds, LocationPatch } from "../editor/locations";
import type { FogMode } from "../editor/fog";
import type { SpriteKind } from "../editor/sprites";
import type { UnitGroup } from "../data/units";
import type { SpriteGroup } from "../data/sprites";
import type { EditorLayer, TerrainMode, ViewFlags, Toast } from "../editor/view";
import type { Align, BleedingLine, CodeEffect, RunOptions, TextCode, TextLine, TextRun } from "../editor/textColors";
import type { DialogId } from "../components/dialogs/ids";
import type { MapImageOptions } from "../services/mapImage";
import type { RebuildResult, SectionInfo, SectionKnowledge } from "../editor/sections";
import type { CombineMode } from "../formats/chk/reader";
import type { ActionRecord, ConditionRecord, TriggerRecord } from "../formats/chk/sections/triggers";
import type {
  ActionFlag, ActionType, AllianceStatus, BriefingActionType, Comparison, ConditionFlag, ConditionType,
  Order, PlayerGroup, ResourceType, ScoreType, SetModifier, SwitchAction, SwitchState, TriggerFlag,
  UnitClass, UnitState as TriggerUnitState,
} from "../formats/chk/sections/triggers";
import type { ActionDef, ArgDef, ArgKind, Choice, ConditionDef } from "../data/triggerDefs";
import type { TextTrigger, TriggerNames } from "../formats/triggers/text";
import type { Issue, IssueLevel, IssueTarget } from "../editor/validate";
import type { MapStatistics } from "../editor/statistics";
import type { FindKind, FindOptions, FindResult } from "../editor/find";
import type { StringUsage } from "../editor/strings";
import type { PlacementProblem, PlacementVerdict } from "../editor/placement";
import type { FlingyDat, ImagesDat, Race, SpritesDat, TechdataDat, UnitsDat, UpgradesDat, WeaponsDat } from "../formats/dat/dat";
import type {
  ForcePatch, ForceView, MapVersionView, PlayerPatch, PlayerSlotView, TechPatch, TechView, UnitTypePatch, UnitTypeView, UpgradePatch, UpgradeView, WeaponView,
} from "../editor/settings";
import type { MapVersion } from "../formats/chk/scenario";
import type { ResizeResult } from "../editor/resize";
import type { SoundRow } from "../editor/sounds";
import type { CuwpSlotPatch, CuwpSlotView } from "../editor/cuwp";
import type { SaveOptions } from "../editor/save";
import type { ChangeTilesetResult } from "../editor/tileset";
import type { TerrainPick } from "../editor/terrain";
import type { SymmetryMode } from "../editor/symmetry";
import type { PlacementOptions } from "../editor/placement";
import type { DoodadPlacementOptions } from "../editor/doodads";
import type { StartLayout, StartPlacementResult } from "../editor/startLocations";
import type { BlendCandidate, BlendOptions, Side } from "../editor/blend";
import type { Clip, ClipParts, PasteMode, PasteResult } from "../editor/clipboard";
import type { StringImport } from "../editor/exchange";
import type { Preferences } from "../editor/preferences";

export type {
  TriggerRecord, ConditionRecord, ActionRecord, ConditionDef, ActionDef, ArgDef, ArgKind, Choice, TriggerNames, TextTrigger,
  Issue, IssueLevel, IssueTarget, MapStatistics, FindKind, FindOptions, FindResult, StringUsage, PlacementVerdict, PlacementProblem,
  UnitsDat, WeaponsDat, UpgradesDat, TechdataDat, SpritesDat, FlingyDat, ImagesDat, Race, ViewFlags,
};
export type {
  PlayerSlotView, PlayerPatch, ForceView, ForcePatch, UnitTypeView, UnitTypePatch, WeaponView, UpgradeView, UpgradePatch, TechView, TechPatch, MapVersionView, MapVersion, ResizeResult, SoundRow,
  CuwpSlotView, CuwpSlotPatch, SaveOptions, ChangeTilesetResult, TerrainPick, SymmetryMode, PlacementOptions, DoodadPlacementOptions, StartLayout, StartPlacementResult,
  BlendCandidate, BlendOptions, Side, Clip, ClipParts, PasteMode, PasteResult, Toast, Preferences, StringImport,
};
export type { Scenario, UnitRecord, SpriteRecord, DoodadRecord, LocationRecord, LoadedTileset, TerrainType, TileInfo, TilesetId, Rect, Diamond, Bounds, LocationPatch, FogMode, SpriteKind, UnitGroup, SpriteGroup, EditorLayer, TerrainMode, DialogId, MapImageOptions, SectionInfo, SectionKnowledge, CombineMode, RebuildResult, IsomReport };

/**
 * The version a host provides; a manifest that asks for a newer one is refused. It stays
 * at 1 while the API is only used by the plugins in the scm-js organisation and grows
 * with them — the first incompatible change after outside plugins exist bumps it.
 */
export const PLUGIN_API_VERSION = 1;

export interface Disposable {
  dispose(): void;
}

/**
 * A transaction builder's return type: whatever it likes, so long as it is not a promise.
 *
 * Everything asynchronous in this API is a promise — `await` it. The two transaction
 * builders (`document.edit` and `document.update`) are the exception, and deliberately
 * so: their operations apply as they are called and one commit closes the transaction
 * when the builder returns, so an `async` builder would commit the part of its work that
 * ran before the first `await` and leave the rest to land outside the entry, breaking
 * undo without an error. Do the awaiting *before* the call:
 *
 * ```ts
 * await api.tileset.load();                       // the async part, first
 * api.document.edit("Fill", tx => tx.stampTerrain(rect, id));  // then the write
 * ```
 *
 * TypeScript refuses an `async` builder because of this type; `runTransaction` and
 * `runUpdate` also catch one at runtime, for a plugin written in plain JavaScript.
 */
export type Sync<T> = T extends PromiseLike<unknown>
  ? "a transaction builder must be synchronous: await before document.edit() / update(), not inside it"
  : T;

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
   * A built, self-contained JavaScript bundle of the plugin, relative to the manifest
   * (`"dist/plugin.js"`). When there is one the editor loads **it** and never `entry`:
   * one fetch, no TypeScript compiler, no import graph to walk — and the plugin may use
   * npm dependencies, which the source path cannot (`bundleModule` refuses a bare
   * specifier because it has no resolver).
   *
   * `entry` stays the source of truth and stays in the manifest: it is what a person
   * reads, what `npm run typecheck` checks, and what loads when there is no build. A
   * repository that publishes one builds it in CI at the tag it is loaded from — see
   * `docs/plugins.md`.
   */
  build?: string;
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
  /**
   * The open map: what it says, and the three ways of writing to it — `edit` (terrain and
   * objects, one undo entry), `update` (the tables every dialog's OK writes) and
   * `sections` (raw bytes). Opening, saving, exporting and closing are here too.
   */
  readonly document: DocumentApi;
  /** The settings dialogs' tables, read-only; `document.update` writes them. */
  readonly settings: SettingsApi;
  readonly triggers: TriggersApi;
  /**
   * Reading the terrain: the tileset's paintable types, the ISOM lattice, flood regions,
   * blend candidates and the symmetry mode. Painting goes through `document.edit`.
   */
  readonly terrain: TerrainApi;
  /** The loaded tileset graphics: whether they are there, and the decoded files behind them. */
  readonly tileset: TilesetApi;
  /** What is selected on each object layer, the marked area, the active layer and the locked ones. */
  readonly selection: SelectionApi;
  /** Cut / Copy / Paste: the clip, its parts, and pasting — what the clipboard layer does. */
  readonly clipboard: ClipboardApi;
  /** The file formats behind File ▸ Import / Export: `.trg` and the strings text. */
  readonly exchange: ExchangeApi;
  /**
   * The palettes' current picks — the terrain brush, the unit, sprite and doodad, the fog
   * mode — and the placement options a plugin that places things should honour.
   */
  readonly palette: PaletteApi;
  readonly names: NamesApi;
  /** StarCraft's `<XX>` text control codes: what they mean, and what a string looks like drawn. */
  readonly text: TextApi;
  readonly query: QueryApi;
  readonly data: DataApi;
  /** Which set of game files the editor draws from — the game's own or a mod's — and installing, switching and removing sets. */
  readonly gameData: GameDataApi;
  /** Bit masks, special unit ids and the pixels-per-tile every record is written in. */
  readonly consts: ConstsApi;
  readonly graphics: GraphicsApi;
  readonly view: ViewApi;
  /**
   * Everything a plugin puts on the screen: the status line, toasts, dialogs, floating
   * panels, `confirm` / `alert` / `prompt` / `progress`, a map tool that owns the pointer,
   * a passive overlay drawn over the map, and picking an area or a tile.
   */
  readonly ui: UiApi;
  /** Items in the editor's menu bar. A path whose last segment names no submenu makes one. */
  readonly menu: MenuApi;
  /** Items in the right-click menus of the map and the terrain palette. */
  readonly contextMenu: ContextMenuApi;
  /** Key combinations, tried before the editor's own and never while a text field has focus. */
  readonly hotkeys: HotkeyApi;
  readonly commands: CommandsApi;
  readonly events: EventsApi;
  /**
   * A small key-value store of the plugin's own, kept in the browser's local storage under
   * the plugin's id and listed with everything else in Preferences ▸ Browser storage.
   */
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
  /** The container: the open file's (else `scx`) — `scx` / `scm` archives, `chk` the bare scenario. */
  format?: MapFileFormat;
  /** The file's name; defaults to the open file's, or the scenario name plus the format. */
  fileName?: string;
  /**
   * Compression, encryption and what is left out: over the options Save last used for this
   * map (or its defaults — PKWARE and encryption for a new map, the way it was opened for
   * an opened one), so the bytes are what Save would write unless you say otherwise.
   */
  saveOptions?: Partial<Omit<SaveOptions, "format">>;
}

/** `document.save` / `saveAs`. */
export interface SaveDocumentOptions {
  /** Write a copy: the document keeps its own name, handle and clean state. */
  copy?: boolean;
}

export interface ChangeTilesetOptions {
  tileset: TilesetId;
  /** ISOM id of the terrain the map is refilled with; the tileset's default when omitted. */
  terrainId?: number;
  /** Keep the tile numbers and change only ERA (what SCMDraft's switch does). */
  keepTiles?: boolean;
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

/** What `document.history()` answers. */
export interface DocumentHistory {
  /** Label of the entry Undo would take back; null with nothing to undo. */
  undo: string | null;
  redo: string | null;
  undoDepth: number;
  redoDepth: number;
}

/** Scenario ▸ Resize / Crop Map's form. Width and height are clamped to 1…256, the anchor to 0…8. */
export interface ResizeDocumentOptions {
  width: number;
  height: number;
  /** 3 × 3 grid, row-major: 0 top-left … 4 centre … 8 bottom-right. Default 4. */
  anchor?: number;
  /** ISOM id of the terrain for the new area (a `TerrainType.id`); the tileset's default when omitted. */
  terrainId?: number;
  /** Pull locations that hang past the new edge back inside; default true. */
  clampLocations?: boolean;
}

/** File ▸ New's form: size, tileset, and the two strings the dialog asks for. */
export interface NewDocumentOptions {
  width: number;
  height: number;
  tileset: TilesetId;
  /** `Untitled Scenario` when omitted. */
  name?: string;
  description?: string;
  /** ISOM id of the terrain to fill with; the tileset's default ground when omitted. */
  terrainId?: number;
  /**
   * Start locations to lay down for players 1..N, as `tx.placeStartLocations` would.
   * Part of making the map, so a fresh scenario has no history to undo them from.
   */
  startLocations?: number;
  startLayout?: StartLayout;
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
   *
   * `build` is synchronous — see `Sync`. Await what you need (graphics, a pick, a
   * fetch) before the call, then write in one go.
   *
   * @example
   * // One undo entry called "Fill", however many operations it takes.
   * const result = api.document.edit("Fill", (tx) => {
   *   tx.stampTerrain({ x0: 0, y0: 0, x1: 8, y1: 8 }, terrainId);
   *   tx.placeUnit(api.consts.unit.startLocation, 0, 4 * api.consts.tile, 4 * api.consts.tile);
   * });
   * api.ui.status(`${result.tiles} tiles, ${result.units} units`);
   */
  edit<R>(label: string, build: (tx: EditTransaction) => Sync<R>): EditResult;
  /**
   * The second kind of write: the tables and settings that live outside the undo model
   * — triggers, the string table, switch names, the scenario's own properties — as one
   * transaction, the way a settings dialog's OK applies its whole form at once.
   * Operations apply as they are called; the commit marks the map modified and bumps
   * what the chrome reads. There is no undo entry: keep your own if you need one.
   * `build` is synchronous, as `edit`'s is.
   *
   * @example
   * api.document.update("Rename", (tx) => {
   *   tx.properties({ name: "Lost Temple", description: "Four players." });
   * });
   */
  update<R>(label: string, build: (tx: UpdateTransaction) => Sync<R>): UpdateResult;
  undo(): string | null;
  redo(): string | null;
  /** The undo and redo stacks' tops — the labels the Edit menu shows — and their depths, without moving anything. */
  history(): DocumentHistory;
  /**
   * Open a map file (`.scx` / `.scm` / `.chk`) in place of the current one, the way
   * File ▸ Open does: when the open map has unsaved changes and Preferences say to ask,
   * the Close Scenario dialog comes first and the user may cancel. Resolves true once
   * the file is the open document, false when the user kept the current map or the
   * file could not be read (the status bar says why).
   */
  open(file: File | Blob | Uint8Array, fileName?: string): Promise<boolean>;
  /**
   * A blank map in place of the current one, the way File ▸ New makes one: flat ground
   * of the tileset's default terrain (or `terrainId`), an ISOM lattice to match, every
   * section a fresh map needs. Goes through the same unsaved-changes gate as `open`.
   * Resolves true once the new map is the open document, false when the user kept the
   * current one.
   */
  create(options: NewDocumentOptions): Promise<boolean>;
  /**
   * The open map as a file, as Save would write it — the remembered save options, the
   * archive extras included — unless `saveOptions` says otherwise. Null when no map is open.
   */
  export(options?: ExportOptions): Promise<File | null>;
  /**
   * File ▸ Save: write the map back where it came from with the options last confirmed
   * for it — into the file when the browser gave a handle, else through the browser's
   * save dialog or as a download; a map with no file yet goes through the Save dialog.
   * Resolves true once written, false when the user dismissed a dialog or the write failed
   * (the status bar and a toast say so).
   */
  save(options?: SaveDocumentOptions): Promise<boolean>;
  /** File ▸ Save As (or Save Copy As with `copy`): the Save dialog, resolving as `save` does. */
  saveAs(options?: SaveDocumentOptions): Promise<boolean>;
  /**
   * File ▸ Close: through the same unsaved-changes gate as `open`. Resolves true once the
   * map is closed (`isOpen()` is then false), false when the user kept it.
   */
  close(): Promise<boolean>;
  /**
   * A picture of the map as File ▸ Export ▸ Image draws it, as a PNG. `pixelsPerTile`
   * is the one dial (32 is the game's art 1:1, 1 is a minimap); the other options
   * default as the dialog's do. Needs the tileset graphics — without them, or without
   * a map, null.
   */
  renderImage(options?: Partial<MapImageOptions>): Promise<Blob | null>;
  /**
   * Scenario ▸ Resize / Crop Map: a transaction outside the undo model that drops both
   * history stacks (as the dialog does). Content keeps its place relative to `anchor`
   * (a 3 × 3 grid, row-major, 4 = centre, the default); the new ground is `terrainId`
   * (the tileset's default when omitted); objects outside the new bounds are dropped,
   * locations clamped unless `clampLocations` is false. Null with no map.
   */
  resize(options: ResizeDocumentOptions): ResizeResult | null;
  /**
   * Scenario ▸ Map Properties ▸ Tileset: change ERA and lay the terrain again with the
   * new tileset's terrain (tile numbers do not carry across tilesets; the doodads go with
   * them, everything else stays). Waits for the new graphics so the fill uses real tiles.
   * Like `resize`, a transaction outside the undo model. Null with no map.
   */
  changeTileset(options: ChangeTilesetOptions): Promise<ChangeTilesetResult | null>;
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
  /**
   * Bytes after the last chunk the reader could parse — what follows a chunk header with
   * a negative length, say. Save writes them back as they are; a `replaceFile` without
   * them drops them. Null when the file ends cleanly.
   */
  trailing(): Uint8Array | null;
  /** The sections a file of the open map's revision must carry to load, as Check Map tests them (`STRx` in place of `STR ` on a Remastered file). */
  required(): string[];
  /**
   * The bytes File ▸ New would write for a section on a map of this size, tileset and
   * revision — StarEdit's defaults for a settings table, the fixed VCOD, an empty list,
   * null terrain. Null for a section the editor cannot produce: one it does not model,
   * or an optional one a new map has no value for (CRGB, SWNM).
   */
  defaults(name: string): Uint8Array | null;
  /**
   * Re-encode sections from the editor's model, the way Save writes a dirty one, and
   * install the result like any other raw edit. This is what turns a protected file back
   * into a plain one: repeated occurrences collapse into one, a truncated or oversized
   * section comes back at the size the model encodes to, a string table whose offsets
   * point nowhere is rewritten with every string the editor could read. Names the editor
   * does not model, and modelled ones whose model is absent (no ISOM, no settings table),
   * are left as they are and missing from `rebuilt`; omit `names` for every modelled
   * section the map has a model for.
   */
  rebuild(names?: string[]): RebuildResult;
}

/** What `tx.rebuildIsom` did. */
export interface IsomRebuildResult {
  /** The map had no usable ISOM, so one was created. */
  created: boolean;
  /** Lattice values that changed (every one of a created section). */
  changed: number;
  /** Diamonds the rebuild resolved from the tiles. */
  diamonds: number;
  /** Diamonds it had to guess — under doodads or off the edge. */
  unresolved: number;
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
  /**
   * Reconstruct the ISOM section from the tiles — for a map that arrived without one, or
   * whose lattice no longer matches after Rect / Tile edits: exact for terrain that was
   * laid down isometrically, a best guess under doodads and for hand-placed tiles. A
   * missing or wrongly sized ISOM is created (undo removes it again); an existing one gets
   * only the diamonds that differ. Needs the tileset graphics; null without them.
   */
  rebuildIsom(): IsomRebuildResult | null;

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

  /**
   * Tools ▸ Replace Terrain: every tile matching `from` (a flat terrain by ISOM id, or
   * one exact tile) becomes `to`, over `rect` or the whole map; pairs are laid as the
   * Rect brush lays them. Returns tiles changed. Terrain picks need the graphics.
   */
  replaceTerrain(from: TerrainPick, to: TerrainPick, rect?: Rect): number;
  /**
   * The bucket fill: the 4-connected area around (x, y) of the same terrain type (`match:
   * "terrain"`, the Rect fill) or the same exact tile (`"tile"`), laid with `terrainId`
   * as the Rect brush would, or set to `tileId`. Returns tiles changed.
   */
  fillArea(x: number, y: number, fill: { terrainId: number } | { tileId: number }, match?: "terrain" | "tile"): number;
  /**
   * The Blend brush: `id` goes on the cell beside the anchor tile on `side`
   * (`terrain.blendCandidates` ranks what fits). Returns whether the cell was on the map.
   */
  placeBlend(x: number, y: number, side: Side, id: number): boolean;
  /**
   * What StarEdit does after an isometric edit: regenerate every tile from the ISOM
   * lattice (the reverse of `rebuildIsom`). Needs ISOM and the graphics; returns tiles
   * changed, or null without them.
   */
  tilesFromIsom(): number | null;
  /**
   * The cells and their images under the symmetry mode (Tools ▸ Symmetry…), each once —
   * what the built-in brushes paint over. With the mode off, the cells as given.
   */
  mirror(cells: Cells): number[];
  /** A map pixel and its images under the symmetry mode, the original first. */
  mirrorPoint(px: number, py: number): { x: number; y: number }[];

  /** Shift units by a pixel delta; buildings re-snap to the grid when `snap` (the palette's option when omitted). Returns records changed. */
  moveUnits(indices: number[], dx: number, dy: number, snap?: boolean): number;
  /**
   * Tools ▸ Auto-place Start Locations: one per player on a ring or in the corners, each
   * moved to the nearest spot the placement checks accept; `replace` removes the existing
   * ones first. Players count from 1.
   */
  placeStartLocations(options: { players: number; layout?: StartLayout; margin?: number; replace?: boolean }): StartPlacementResult;

  updateSprites(indices: number[], patch: (r: SpriteRecord) => Partial<SpriteRecord>): number;
  /** Shift sprites by a pixel delta, clamped to the map. Returns records changed. */
  moveSprites(indices: number[], dx: number, dy: number): number;
  /** Change a doodad's owner or disabled flag (its tiles stay). Returns records changed. */
  updateDoodads(indices: number[], patch: { owner?: number; disabled?: number }): number;

  /** Put Anywhere (slot 63) back to the whole map; returns whether it had to move. */
  restoreAnywhere(): boolean;

  /** Flip every tile's fog bit for `players`; returns tiles changed. */
  invertFog(players: number): number;
  /** Copy one player's fog (0-based) onto the players in the `to` bit mask (bit n = player n + 1); returns tiles changed. */
  copyFog(from: number, to: number): number;
  /** Fog or clear the connected area around (x, y) that shares `player`'s fog state, for `players`; returns tiles changed. */
  floodFog(x: number, y: number, player: number, players: number, mode: FogMode): number;

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
  /**
   * File ▸ Import ▸ Strings: `index<TAB>text` lines (`exchange.formatStrings` writes
   * them) set in place, indices past the end appended. Returns how many were replaced and added.
   */
  import(text: string): { replaced: number; added: number };
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
  /** OWNR / SIDE / COLR / CRGB / FORC: the Player Settings and Player Colors dialogs. */
  readonly players: PlayersUpdate;
  /** FORC: the Force Settings dialog. */
  readonly forces: ForcesUpdate;
  /** UNIS / UNIx and PUNI: the Unit Settings dialog. */
  readonly unitTypes: UnitTypesUpdate;
  /** UPGS / UPGx and UPGR / PUPx: the Upgrade Settings dialog. */
  readonly upgrades: UpgradesUpdate;
  /** TECS / TECx and PTEC / PTEx: the Technology Settings dialog. */
  readonly techs: TechsUpdate;
  /** WAV and the archive's sound files: the Sound Editor. */
  readonly sounds: SoundsUpdate;
  /** UPRP / UPUS: the Create Unit with Properties slots (Triggers ▸ Unit Properties Slots…). */
  readonly cuwp: CuwpUpdate;
  /** Scenario ▸ Map Revision: VER / TYPE and, moving to or from Remastered, the string table's width. */
  setVersion(version: MapVersion, extendedStrings?: boolean): void;
  /** A line for the status bar, appended to the label. */
  note(text: string): void;
}

export interface PlayersUpdate {
  /** All 12 slots, 0-based, with the effective colour and force. */
  list(): PlayerSlotView[];
  /** Patch one slot; colours and forces apply to the eight playable slots only. */
  set(slot: number, patch: PlayerPatch): boolean;
}

export interface ForcesUpdate {
  list(): ForceView[];
  set(force: number, patch: ForcePatch): boolean;
}

export interface UnitTypesUpdate {
  /** The effective row for a units.dat id — the dat's numbers where the type is on "use default". */
  get(unitId: number): UnitTypeView;
  /**
   * Patch one type. Setting any number turns "use default" off for it (seeding the untouched
   * columns from the dat, as the dialog does); `useDefault: true` puts it back. Hit points are
   * whole points. `name` is the custom name (`""` restores the default); `available` edits PUNI.
   */
  set(unitId: number, patch: UnitTypePatch): boolean;
}

export interface UpgradesUpdate {
  get(upgradeId: number): UpgradeView;
  set(upgradeId: number, patch: UpgradePatch): boolean;
}

export interface TechsUpdate {
  get(techId: number): TechView;
  set(techId: number, patch: TechPatch): boolean;
}

export interface SoundsUpdate {
  /** The 512 WAV slots in use, joined with the archive (`present` says whether the file is there). */
  list(): SoundRow[];
  /**
   * Put `path` (`staredit\wav\name.wav`, or just `name.wav`) in the first free slot — the
   * existing slot when it is already listed — and, with `bytes`, store the file in the archive.
   * Returns the slot, or -1 when all 512 are taken.
   */
  add(path: string, bytes?: Uint8Array): number;
  /** Clear a slot; with `deleteFile`, remove the archive member too. */
  remove(slot: number, deleteFile?: boolean): boolean;
}

/**
 * The 64 Create Unit with Properties slots. A slot is addressed 0-based here; the action
 * that uses one stores the number 1-based (`target` = slot + 1), as `CuwpSlotView.index`
 * + 1. A view's field is `null` where the created units keep the type's default.
 */
export interface CuwpUpdate {
  list(): CuwpSlotView[];
  get(index: number): CuwpSlotView | null;
  /**
   * Patch one slot: a number sets the field and its "applied" bit, `null` clears the bit;
   * a boolean forces a special state, `null` leaves it to the unit. `used` is StarEdit's
   * "in use" tick, on by itself once the slot sets anything.
   */
  set(index: number, patch: CuwpSlotPatch, used?: boolean): boolean;
  /** Back to an empty, unticked slot. */
  clear(index: number): boolean;
}

/* ── Settings (read) ────────────────────────────────────── */

/**
 * What the settings dialogs show, read without a transaction: the same views
 * `document.update`'s `tx.players` … `tx.techs` hand out. Every list is empty and every
 * single read null when no map is open.
 */
export interface SettingsApi {
  players(): PlayerSlotView[];
  player(slot: number): PlayerSlotView | null;
  forces(): ForceView[];
  unitType(unitId: number): UnitTypeView | null;
  /** Every type with a name, in id order. */
  unitTypes(): UnitTypeView[];
  upgrade(upgradeId: number): UpgradeView | null;
  upgrades(): UpgradeView[];
  tech(techId: number): TechView | null;
  techs(): TechView[];
  sounds(): SoundRow[];
  /** Whether a player (0-based) may build a unit type — PUNI's per-player byte resolved against its global default. */
  unitAvailable(player: number, unitId: number): boolean;
  /** The Create Unit with Properties slots, 0-based, with how many actions name each. */
  cuwpSlots(): CuwpSlotView[];
  cuwpSlot(index: number): CuwpSlotView | null;
  version(): MapVersionView | null;
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
  /**
   * Tell the editor that a run of the trigger list is generated by this plugin. The
   * Trigger Editor badges those rows, locks them and offers the plugin's own editor in
   * place of the form; the Text Trigger Editor fences them in comments; Import Triggers
   * says what a replace would remove. The claim lives until `remove()` or the plugin's
   * deactivation; call `refresh()` after a rebuild so the editors ask `locate` again.
   */
  claim(spec: TriggerClaimSpec): TriggerClaimHandle;
}

/**
 * A run of triggers a plugin generates and owns. It is found by *content*: the
 * editors work on copies of the list with their own unsaved inserts and removals, so
 * `locate` is asked with whatever list an editor holds and answers where the run is
 * in it — by a hash of the records, say — or null when the records are not there.
 */
export interface TriggerClaimSpec {
  /** What generated the run, in words, as a sentence would use it: `"the trigger script"`. */
  label: string;
  /** The word on the badge the trigger list shows on each row; the plugin's id by default. */
  badge?: string;
  /** Where the run sits in `list`, or null when it is not there (edited by hand, or gone). */
  locate(list: TriggerRecord[]): { start: number; count: number } | null;
  /** A sentence about one trigger of the run (its index in `list`), shown in place of the editor's form. */
  describe?(index: number, list: TriggerRecord[]): string;
  /** Open the plugin's own editor on that trigger — the button under the sentence. */
  open?(index: number, list: TriggerRecord[]): void;
  /** That button's label; `Open <plugin name>` by default. */
  openLabel?: string;
}

export interface TriggerClaimHandle extends Disposable {
  /** The editors ask `locate` again (after a rebuild, or when the run moved). */
  refresh(): void;
  remove(): void;
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
  /** Whether a unit type may be placed centred there, and what stops it; null with no map. */
  placement(unitId: number, x: number, y: number): PlacementVerdict | null;
  /** The MASK bits at a tile: bit n set = player n + 1 starts fogged there (every bit when the map has no MASK). */
  fogAt(tx: number, ty: number): number;
  /** The string table as it stands (index 0 is nothing); empty with no map. */
  strings(): (string | null)[];
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
  /**
   * Highlight something on the map for a moment: the rect an edit filled, the units it
   * placed, the location it moved. Fades by itself; several may run at once. Nothing to
   * clean up.
   *
   * @example
   * const r = api.document.edit("Fill", (tx) => tx.fillFlat(rect, terrain));
   * if (r.changed) api.view.flash({ rect });
   */
  flash(target: FlashTarget): void;
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

/* ── Data sets ──────────────────────────────────────────── */

/**
 * A data set: one set of game files the editor draws from. The default is the game's
 * own; any other is a mod's, installed under an id of its own, the same formats and
 * table sizes with some of the files replaced.
 */
export interface GameDataProfile {
  /** Lower-case letters, digits and hyphens, up to 40 characters. */
  id: string;
  /** What the dialog and the status line call it. */
  name: string;
}

/** Where the session's game data comes from. */
export interface GameDataSource {
  /** `bundled` (this build's own files, or the desktop app's extraction), `stored` (a copy kept in the browser), or `none`. */
  kind: "bundled" | "stored" | "none";
  /** One line, as Help ▸ Game Data… shows it. */
  label: string;
  /** The data set the files belong to. */
  profile: GameDataProfile;
  /** Set when the desktop app extracted the files from a StarCraft installation. */
  desktop: boolean;
}

/** Bytes for an install: a `File` / `Blob`, or already an array. */
export type GameDataBytes = Blob | Uint8Array;

/** What a data set is installed from. */
export interface GameDataFiles {
  /**
   * The archives, `StarDat.mpq` and `BrooDat.mpq` among them — a mod replaces files, it
   * does not bring the rest. The game's own are read first, then the others in the order
   * given, later ones winning as in the game.
   */
  archives: readonly { name: string; data: GameDataBytes }[];
  /** Loose files by member path (`arr/units.dat`, `unit/terran/marine.grp`), read before any archive. */
  files?: readonly { path: string; data: GameDataBytes }[];
}

/**
 * The game data as a whole: which set of files the editor draws from, and installing,
 * switching and removing sets — the plugin side of Help ▸ Game Data…. What is *in* the
 * files is `data` (the tables), `tileset` (the graphics), `graphics` (the pictures) and
 * `names` (the labels, which follow the loaded set: a unit, weapon, upgrade or
 * technology a mod renamed shows its new name, and the rest keep StarEdit's).
 *
 * A data set is a name over files in the game's own formats; a mod that extends the
 * tables past the game's sizes is not covered. Installing needs the game's two archives
 * every time, since a mod's files are laid over them the way its loader lays them.
 *
 * @example
 * // A mod plugin: install its files once, then draw with them.
 * const sets = await api.gameData.profiles();
 * if (!sets.some((p) => p.id === "my-mod")) {
 *   const files = await api.ui.pickFiles({ multiple: true });
 *   if (files) await api.gameData.install({ id: "my-mod", name: "My Mod" }, { archives: files.map((f) => ({ name: f.name, data: f })) });
 * }
 * await api.gameData.select("my-mod");
 */
export interface GameDataApi {
  /** The session's source, or null while it is still being resolved at startup. */
  source(): GameDataSource | null;
  /** The data set in use — the game's own until another is selected. */
  profile(): GameDataProfile;
  /** Every data set with a copy here, the game's own first. */
  profiles(): Promise<GameDataProfile[]>;
  /**
   * Extract a data set from its files, store it under `profile.id` and switch to it. The
   * archives must include the game's own two; the promise rejects with the reason when
   * they do not or the extraction fails. `progress` is 0–1 with a label, as the dialog's bar.
   */
  install(profile: GameDataProfile, files: GameDataFiles, progress?: (fraction: number, label: string) => void): Promise<GameDataSource>;
  /**
   * Switch to a data set. Everything decoded from the previous one is dropped and the
   * viewport redraws from the new files; a set with no copy here falls back to the game's
   * own. Resolves with the source in use afterwards.
   */
  select(id: string): Promise<GameDataSource>;
  /** Remove a data set's copy (never the game's bundled files). True when there was one. */
  remove(id: string): Promise<boolean>;
}

/* ── The numbers a record is written in ─────────────────── */

/**
 * The constants a plugin needs to *write* a record rather than read one: the bit masks in
 * a UNIT / THG2 / MRGN record, the condition, action and argument numbers of a TRIG /
 * MBRF one, the few unit ids the game itself treats specially, and the one conversion —
 * 32 pixels to a tile — every object position goes through.
 *
 * They are the editor's own (`sections/objects.ts`, `editor/units.ts`) and they arrive
 * here at run time rather than in the typings on purpose: `@scm-js/plugin-api` is erased
 * before the loader ever sees the specifier, so a *value* imported from that package
 * type-checks and is then undefined. Anything a plugin needs while it runs has to come
 * off `api`. Without this a plugin writes the hex itself, which is how a sprite's kind
 * came to be read as `flags & 0x1000` in three places.
 */
export interface ConstsApi {
  /** Map pixels to a tile. UNIT and THG2 store pixels; MTXM, MRGN and the brushes count tiles. */
  readonly tile: 32;
  /** UNIT: the special unit ids, the default resource amounts, and the record's four bit masks. */
  readonly unit: UnitConsts;
  /** THG2: the sprite record's flag word. */
  readonly sprite: SpriteConsts;
  /** MRGN: the Anywhere slot, and the elevation bits. */
  readonly location: LocationConsts;
  /** TRIG / MBRF: the condition and action types, and the enumerated arguments. */
  readonly triggers: TriggerConsts;
  /** Whether a unit type is a mineral field or a vespene geyser. */
  isResource(unitId: number): boolean;
}

export interface UnitConsts {
  /** The units.dat id of the Start Location marker. */
  readonly startLocation: 214;
  /** The three mineral field types — a mineral line uses all three so it is not one sprite repeated. */
  readonly mineralFields: readonly [176, 177, 178];
  readonly vespeneGeyser: 188;
  /** What a fresh resource is worth, as StarEdit writes it. */
  readonly defaultMinerals: 1500;
  readonly defaultGas: 5000;
  /** `validProperties` (offset 0x0C): which special-property fields the game reads. */
  readonly valid: { readonly Cloak: 1; readonly Burrow: 2; readonly InTransit: 4; readonly Hallucinated: 8; readonly Invincible: 16 };
  /** `validStates` (offset 0x0E): which of the record's fields are set at all. */
  readonly used: { readonly Owner: 1; readonly HitPoints: 2; readonly Shields: 4; readonly Energy: 8; readonly Resources: 16; readonly Hangar: 32; readonly State: 64 };
  /** `stateFlags` (offset 0x18): the special properties themselves. */
  readonly state: { readonly Cloaked: 1; readonly Burrowed: 2; readonly InTransit: 4; readonly Hallucinated: 8; readonly Invincible: 16 };
  /** `relationType` (offset 0x0A): how `relatedSerial` is linked. */
  readonly relation: { readonly NydusLink: 0x200; readonly Addon: 0x400 };
}

export interface SpriteConsts {
  /**
   * THG2 `flags`. `PureSprite` is what `spriteKind` reads: with it the id is a sprites.dat
   * one and the game only draws it, without it the id is a units.dat one and the game
   * creates the unit (Installation doors and traps).
   */
  readonly flags: { readonly PureSprite: 0x1000; readonly Flipped: 0x4000; readonly Disabled: 0x8000 };
}

export interface LocationConsts {
  /** The MRGN slot that is Anywhere. The editor protects it; nothing else may write it. */
  readonly anywhere: 63;
  /**
   * `elevationFlags`. A *set* bit **excludes** that elevation — the game tests a unit
   * against the location only on the elevations whose bit is clear — so 0 means
   * everywhere, and StarEdit's ticked "Low ground" box is bit 0 clear.
   */
  readonly elevation: { readonly LowGround: 1; readonly MediumGround: 2; readonly HighGround: 4; readonly LowAir: 8; readonly MediumAir: 16; readonly HighAir: 32 };
}

/**
 * The numbers a TRIG / MBRF record is written in: the condition and action types, and the
 * enumerated arguments the game stores as bare bytes.
 *
 * A trigger record is sixteen conditions and sixty-four actions of plain numbers — the
 * codec knows no types — so writing one field by field means knowing that a Countdown
 * Timer condition is type 1 and `AtLeast` is 0. `triggers.defs` says which *field* an
 * argument lives in; this says what to put in it.
 *
 * The keys of the argument groups are `ArgDef.kind`, so a generic argument editor can
 * look one up by the kind the def gave it (`api.consts.triggers[arg.kind]`).
 *
 * Generating a whole run of triggers is usually better done through
 * `tx.triggers.fromText`, which resolves names against the open map; these are for
 * editing a field of an existing record, and for reading one back.
 */
export interface TriggerConsts {
  /** Condition `type`. */
  readonly condition: typeof ConditionType;
  /** Action `type` in TRIG. */
  readonly action: typeof ActionType;
  /** Action `type` in MBRF, where the same byte means something else. */
  readonly briefingAction: typeof BriefingActionType;
  /** The 27 player-group values, which are also the indices of a trigger's `players`. */
  readonly player: typeof PlayerGroup;
  readonly comparison: typeof Comparison;
  readonly switchState: typeof SwitchState;
  readonly switchAction: typeof SwitchAction;
  /** Set Resources / Set Score / Modify …: `SetTo`, `Add`, `Subtract`. */
  readonly modifier: typeof SetModifier;
  /** Set Doodad State / Set Invincibility: `Enable`, `Disable`, `Toggle`. */
  readonly unitState: typeof TriggerUnitState;
  readonly order: typeof Order;
  readonly alliance: typeof AllianceStatus;
  readonly resource: typeof ResourceType;
  readonly score: typeof ScoreType;
  /** The unit ids past units.dat that a condition or action accepts: *Any unit*, *Men*, *Buildings*, *Factories*. */
  readonly unitClass: typeof UnitClass;
  /** A condition's `flags`. `UnitTypeUsed` is the hint bit the text format cannot carry. */
  readonly conditionFlags: typeof ConditionFlag;
  /** An action's `flags`. */
  readonly actionFlags: typeof ActionFlag;
  /** A trigger's `flags`; `Preserve` is what `triggers.isPreserved` reads. */
  readonly triggerFlags: typeof TriggerFlag;
  /**
   * The address of the game's death table, which is the base an EUD player value is
   * counted from: `epd = (address - deathsTable) / 4 + 0x2000`.
   */
  readonly deathsTable: number;
}

/* ── Terrain and tileset ────────────────────────────────── */

export interface ActiveBrush {
  mode: TerrainMode;
  /** The Rect / isometric brush's terrain id. */
  terrain: number;
  /** The Tile brush's MTXM id. */
  tile: number;
  brushSize: number;
  /** The Rect brush's variation slot, or -1 for a random one per pair. */
  variation: number;
}

export interface TerrainApi {
  /** Paintable flat terrains of the open map's tileset (empty without the graphics). */
  types(): TerrainType[];
  /** Terrain ids the isometric brush can paint on this tileset. */
  isomTypes(): number[];
  /** Whether the open map carries an ISOM section the isometric brush can work on. */
  hasIsom(): boolean;
  /**
   * How well the ISOM describes the tiles — `rects` measured, `mismatched` among them,
   * and `stale` when the share is past what the palette warns at — or null when the map
   * has no ISOM (`hasIsom`) or no map is open. Waits for the tileset graphics to load
   * and rejects when they are missing.
   */
  checkIsom(): Promise<IsomReport | null>;
  tileInfo(id: number): TileInfo | null;
  /**
   * The terrain a tile belongs to, as the id `types()` lists (a flat pair's CV5 index):
   * the tile's own group when it is flat ground, else — under a cliff, a shore or a
   * doodad — what the ISOM lattice says the diamond there is. Null off the map, without
   * the tileset graphics, or when neither tells.
   */
  terrainAt(tx: number, ty: number): number | null;
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
  /** The 4-connected area around a tile of the same terrain type (`"terrain"`, the Rect fill's reading) or the same exact tile (`"tile"`), as flat indices. */
  floodRegion(x: number, y: number, match?: "terrain" | "tile"): number[];
  /**
   * The Blend brush's list: drawable tiles whose opposite edge meets the anchor tile's
   * `side`, nearest first, with the pixel distance (`0..255`, designed pairs 0.2–8).
   * Empty without the graphics.
   */
  blendCandidates(anchorTileId: number, side: Side, options?: Partial<BlendOptions>): BlendCandidate[];
  /** The Rect brush's terrain, in the tileset's own terms: the even CV5 group of a flat pair, or -1. */
  flatGroupOf(terrainId: number): number;
  /** Tools ▸ Symmetry…: the mode the brushes paint and the palettes place under. */
  symmetry(): SymmetryMode;
  setSymmetry(mode: SymmetryMode): void;
  /** Whether a mode can run on the open map (the rotations and diagonals need a square one). */
  symmetryAvailable(mode: SymmetryMode): boolean;
  /** Flat indices of `cells` and their images under the symmetry mode, each once. */
  mirror(cells: Rect | Iterable<number>): number[];
  /** A map pixel and its images under the symmetry mode, the original first. */
  mirrorPoint(px: number, py: number): { x: number; y: number }[];
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
  /** Layers the Layers panel has locked: their tools refuse to change the map. */
  lockedLayers(): EditorLayer[];
  setLayerLocked(layer: EditorLayer, locked: boolean): void;
}

/* ── Clipboard ──────────────────────────────────────────── */

/** What `clipboard.copy` / `cut` take: the marked area (or any tile rect), or objects by index. */
export type ClipSource =
  | { rect: Rect }
  | { units?: number[]; sprites?: number[]; doodads?: number[]; locations?: number[] };

export interface PasteOptionsSpec {
  /** Over what `clipboard.parts()` says. */
  parts?: Partial<ClipParts>;
  /** Over `clipboard.mode()`. */
  mode?: PasteMode;
}

/**
 * The Cut / Copy / Paste layer. The clip is self-contained (it outlives the map it came
 * from and pastes into another) and shared with the user's own clipboard, so a plugin
 * that copies here is copying for the user too.
 */
export interface ClipboardApi {
  /** What is on the clipboard, or null. */
  clip(): Clip | null;
  /** Put a clip on the clipboard (one from `copy`, or built elsewhere); null clears it. */
  setClip(clip: Clip | null): void;
  /**
   * Copy a source — the marked area when omitted (or, on an object layer, that layer's
   * selection, as Ctrl+C does) — with the parts ticked in `parts()`. Null when there is
   * nothing to copy.
   */
  copy(source?: ClipSource): Clip | null;
  /** Copy, then remove the source's objects as one undo step (terrain and fog stay). Null when there was nothing. */
  cut(source?: ClipSource): Clip | null;
  /**
   * Stamp the clip with its top-left tile at (tx, ty), one undo step; the pasted area
   * becomes the marked one. Null when there is no clip or no map.
   */
  paste(tx: number, ty: number, options?: PasteOptionsSpec): PasteResult | null;
  parts(): ClipParts;
  setParts(patch: Partial<ClipParts>): void;
  mode(): PasteMode;
  setMode(mode: PasteMode): void;
  /** Whether the clipboard layer is armed: the next click on the map pastes. */
  pasting(): boolean;
  /** Arm pasting (switches to the clipboard layer) or stop. */
  setPasting(on: boolean): void;
  /** One line for a clip: `12 × 8 tiles · 3 units · 2 doodads`. */
  summary(clip: Clip): string;
}

/* ── Import / export formats ────────────────────────────── */

/**
 * The file formats File ▸ Import / Export read and write, so a plugin can keep triggers
 * or strings outside the map in a form the editor (and SCMDraft) take back.
 */
export interface ExchangeApi {
  /** Raw 2400-byte TRIG records, SCMDraft's `.trg`; string indices are the map's own. */
  encodeTrg(triggers: TriggerRecord[]): Uint8Array;
  decodeTrg(bytes: Uint8Array): TriggerRecord[];
  /** The whole string table as `index<TAB>text` lines, control bytes as `<XX>`. */
  formatStrings(): string;
  /** Parse that form (`errors` names the lines that were not `N<TAB>text`); `tx.strings.import` applies it. */
  parseStrings(text: string): StringImport;
}

/* ── Palettes ───────────────────────────────────────────── */

/**
 * What the Units, Sprites, Doodads and Fog of War palettes have picked — the thing a
 * click on the map would place or paint. (The Terrain palette's pick is
 * `terrain.active()`.) Players are 0-based: `owner` 0 is Player 1.
 */
export interface PaletteChoice {
  /** The player whose fog the Fog of War layer draws, 0-based. */
  fogViewPlayer: number;
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
  /** The colour a player's units are shown in, `#rrggbb` (the same as `graphics.playerColor`). */
  playerColor(owner: number): string;
  /** The Units palette's placement checks and snapping — what `placeUnit`, `canPlaceUnit` and `query.placement` apply, and whether an edit removes stranded units. */
  placementOptions(): PlacementOptions;
  setPlacementOptions(patch: Partial<PlacementOptions>): void;
  /** The Doodads palette's rules: place anywhere, snap to grid. */
  doodadPlacement(): DoodadPlacementOptions;
  setDoodadPlacement(patch: Partial<DoodadPlacementOptions>): void;
  /** The Locations layer's snap step in pixels, 0 for off. */
  locationSnap(): number;
  setLocationSnap(step: 0 | 8 | 16 | 32 | 64): void;

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

export type { Align, BleedingLine, CodeEffect, RunOptions, TextCode, TextLine, TextRun };

/**
 * Bytes 0x01–0x1F in a string are colour and layout codes. This is the editor's own table
 * of what each one does — the same one the String Editor's buttons and preview are drawn
 * from — plus the reading of a string that turns those bytes into what the game shows.
 *
 * A plugin that displays or rewrites map text should use this rather than carrying a copy:
 * the numbering is easy to get wrong (the editor's own table was, from 0x12 up, until it
 * was checked against the classic player palette).
 *
 * ## Remastered
 *
 * `runs` models Remastered's rule, where a colour set on one line carries onto the next.
 * StarCraft 1.16.1 reset the colour at every line break, so a string written before the
 * remaster can draw in colours its author never chose — `bleedingLines` finds exactly
 * those lines and `fixBleeding` writes the reset the old game supplied. Pass
 * `resetPerLine` to `runs` to see the old rendering.
 */
export interface TextApi {
  /** Every byte the game gives a meaning, in order; `rgb` is set for the colours only. */
  codes(): TextCode[];
  /** One byte's meaning, or null for a byte the game ignores. */
  code(byte: number): TextCode | null;
  /** The codes worth offering as buttons: no tab, newlines or the do-nothing byte. */
  insertable(): TextCode[];
  /** `#rrggbb` — what the game starts a string in, and what 1.16.1 reset to at a line break. */
  defaultColor(): string;
  /** The string split into lines of coloured runs, the way the game draws it. */
  runs(text: string, options?: RunOptions): TextLine[];
  /** The text with every control byte removed — what the string actually says. */
  plain(text: string): string;
  /** `<0E>`, the way every StarCraft editor writes a control byte. */
  escape(byte: number): string;
  /**
   * The lines of `text` that Remastered draws in a colour 1.16.1 did not: a line that sets
   * no colour of its own, after one that left a colour set. Empty for a single-line string.
   */
  bleedingLines(text: string): BleedingLine[];
  /**
   * `text` with the default colour written at the head of every bleeding line, so both
   * games draw it alike. Idempotent, and never changes what the string says.
   */
  fixBleeding(text: string): string;
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
  /**
   * Escape normally closes the dialog. Answer true to keep it open for this press —
   * when the key was meant for something inside the dialog that handles Escape itself
   * (a code editor dismissing its own popups), judged by the element it landed on.
   */
  keepOpenOnEscape?: (target: EventTarget | null) => boolean;
}

export interface DialogHandle {
  close(): void;
  /** Whether the dialog is still on screen. */
  isOpen(): boolean;
  /** Change the title strip's text. */
  setTitle(title: string): void;
  /**
   * Say the dialog is working: a ring and `label` at the left of the footer, and every
   * footer button disabled until `setBusy(false)`. A button's own `run` already does this
   * for as long as its promise is pending — this is for work the buttons did not start,
   * such as the first load, or a search that runs as the user types.
   */
  setBusy(label: string | false): void;
}

/**
 * A panel floats over the map and does not block it: the user keeps drawing, scrolling
 * and using hotkeys while it is open (except while typing in one of its fields). It
 * is dragged by its title bar and closed with the × or `close()`.
 */
export interface PanelSpec {
  title: string;
  /** In CSS pixels; 260 by default. The panel is as tall as its content, up to the map's height. Ignored when docked. */
  width?: number;
  /**
   * Where the panel lives. `"float"` (the default) is a frame over the map the user drags
   * about. `"right"` puts it in the right dock as a panel of its own, under Minimap, Layers
   * and Properties, with the same head and hide button the built-in panels have — the
   * choice for anything the user keeps open while working, such as an assistant or a
   * readout. A docked panel shows the dock even when the user has hidden every built-in
   * panel in it.
   */
  dock?: "float" | "right";
  /** A docked panel that takes the dock's spare height (a transcript, a long list); off by default. */
  grow?: boolean;
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

/**
 * One cell in the status bar (`ui.statusItem`): a line of text with the plugin's icon,
 * a spinner while `busy`, and a click. It is how a plugin that works in the background
 * stays visible without a panel — "AI · working 12 s", "3 problems", "Synced".
 */
export interface StatusItemSpec {
  text: string;
  /** The tooltip. */
  title?: string;
  /** Show a spinner in the cell. */
  busy?: boolean;
  /** Paint the cell as a warning. */
  warn?: boolean;
  onClick?: () => void;
}

export interface StatusItemHandle {
  /** Change any of the fields; the cell redraws. */
  set(patch: Partial<StatusItemSpec>): void;
  remove(): void;
  isShown(): boolean;
}

/**
 * The dialogs a plugin may add to (`ui.dialogSlot`), and the fields each one exposes to
 * the slot. A field is the dialog's *working copy* — what the person sees in the form,
 * not yet applied to the map — so a slot's button can fill it in and leave OK to them.
 *
 * - `mapProperties`: `name`, `description`.
 * - `textTriggerEditor`: `text` (the whole editor); `payload.briefing` says which list.
 * - `triggerEditor`, `stringEditor`, `playerSettings`, `missionBriefing`: no fields, a slot only.
 */
export type SlottedDialogId = "mapProperties" | "textTriggerEditor" | "triggerEditor" | "stringEditor" | "playerSettings" | "missionBriefing";

/** A form field a dialog lends to a slot: read it, set it, hear it change. */
export interface DialogField {
  get(): string;
  set(value: string): void;
}

/** What a slot's `mount` is handed: which dialog, its payload, its fields, and a way to close it. */
export interface DialogSlotHost {
  readonly dialog: SlottedDialogId;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly fields: Readonly<Record<string, DialogField>>;
  close(): void;
}

/**
 * Something a plugin mounts *inside* a built-in dialog — a button in Map Properties
 * that suggests a name, one in the Text Trigger Editor that explains the text. The slot
 * is a row at the left of the dialog's footer; fill it with the widgets, and it looks like
 * part of the dialog. `mount` runs every time the dialog opens, with a cleanup on close.
 */
export interface DialogSlotSpec {
  mount(body: HTMLElement, host: DialogSlotHost): void | (() => void);
}

/**
 * What `view.flash` highlights: a tile rect, or units / locations by index. The
 * highlight fades over `ms` (600 by default) and never blocks or takes the pointer; it is
 * the shared way to say "this just changed" or "look here", so every plugin's flash looks
 * the same. `kind` picks the colour: `"change"` (gold, the default) or `"attention"` (teal).
 */
export type FlashTarget =
  | { rect: Rect; kind?: FlashKind; ms?: number }
  | { units: number[]; kind?: FlashKind; ms?: number }
  | { locations: number[]; kind?: FlashKind; ms?: number }
  | { tiles: { x: number; y: number }[]; kind?: FlashKind; ms?: number };

export type FlashKind = "change" | "attention";

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

/** Where in the viewport's paint pass an overlay draws. */
export type OverlayAbove =
  /** Over the terrain and grid, under doodad footprints, units, sprites and locations (the default). */
  | "terrain"
  /** Over units, sprites and locations, under fog of war. */
  | "objects"
  /** Over everything but a running map tool's own drawing. */
  | "everything";

/**
 * An overlay is a picture drawn over the map that the user can turn on and off: it
 * is listed under View ▸ Overlays and in the Layers panel, stays while the user works
 * on any layer, and never takes the pointer — clicks go to the active layer's tools
 * as usual. It hears the pointer through `onHover`, which is how a readout follows the
 * mouse while the user places units. Register one at activation and keep the handle;
 * it goes away with the plugin.
 */
export interface OverlaySpec {
  /** Shown in View ▸ Overlays and the Layers panel. Unique per plugin. */
  name: string;
  /** Start visible; true by default. What the user last set for this name wins for the session. */
  visible?: boolean;
  /** Where the picture goes in the paint pass; `"terrain"` by default. */
  above?: OverlayAbove;
  /** Draw in canvas pixels through `view`, each time the viewport repaints while visible. */
  draw(ctx: CanvasRenderingContext2D, view: MapView): void;
  /**
   * The pointer over the map while the overlay is visible, on every layer and while a
   * map tool runs; `null` once when it leaves. Call `handle.redraw()` here to move a
   * hover mark. A press sets `down` but is never captured for you.
   */
  onHover?(p: MapPointer | null): void;
  /** The overlay was shown or hidden, by the user in the chrome or by your handle. */
  onToggle?(visible: boolean): void;
}

export interface OverlayHandle {
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  /** Repaint the viewport — and so call `draw` — now. */
  redraw(): void;
  /** Take the overlay out of the chrome for good; `isVisible` is false from then on. */
  remove(): void;
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
  /** Set the status bar line. */
  status(text: string): void;
  /** The status bar line as it stands. */
  statusText(): string;
  /** A short notice over the map that leaves by itself — how Save reports; `ttl` 0 keeps it until dismissed. */
  toast(toast: { kind?: Toast["kind"]; title: string; detail?: string; ttl?: number }): void;
  /**
   * Write a file to disk the way the editor's own exports do: into the file the browser's
   * save dialog picks, or as a download where there is no dialog. Resolves with where it
   * went, or null when the user dismissed the dialog.
   */
  saveFile(data: Blob | Uint8Array, fileName: string): Promise<{ route: "picker" | "download"; fileName: string } | null>;
  dialog(spec: DialogSpec): DialogHandle;
  /**
   * Open a panel: floating over the map, or docked at the right with the built-in panels
   * (`spec.dock`). As many as you like; each closes with the plugin.
   */
  panel(spec: PanelSpec): PanelHandle;
  /**
   * A cell of your own in the status bar. One line of text beside the plugin's icon, a
   * spinner while `busy`, a click. Keep the handle and `set` it as things move; it
   * leaves with `remove()` or the plugin.
   */
  statusItem(spec: StatusItemSpec): StatusItemHandle;
  /**
   * Add to a built-in dialog. `mount` runs in a row at the left of the dialog's footer each
   * time that dialog opens, with the dialog's working-copy fields to read and fill
   * (`SlottedDialogId` lists which dialogs and fields). Returns the registration; it
   * leaves with `dispose()` or the plugin.
   *
   * @example
   * api.ui.dialogSlot("mapProperties", {
   *   mount(body, dlg) {
   *     body.append(api.ui.widgets.button("Suggest a name", { onClick: async () => {
   *       dlg.fields.name.set(await suggestName(dlg.fields.description.get()));
   *     } }));
   *   },
   * });
   */
  dialogSlot(dialog: SlottedDialogId, spec: DialogSlotSpec): Disposable;
  /**
   * Take over the pointer on the map until `stop()`, Esc, a right-click, a map change
   * or another tool. One tool runs at a time — starting one stops the previous — and a
   * `pickArea` / `pickTile` in progress is served first.
   */
  mapTool(spec: MapToolSpec): MapToolHandle;
  /**
   * A picture over the map the user can switch on and off (View ▸ Overlays, the Layers
   * panel) and that stays while they work on any layer. It draws at every repaint and
   * hears the pointer, but never takes it. As many as you like; they go with the plugin.
   */
  overlay(spec: OverlaySpec): OverlayHandle;
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
  /** Open a built-in dialog (fire and forget; `ask` waits for one that answers). */
  open(dialog: DialogId, payload?: Record<string, unknown>): void;
  /**
   * Open a built-in dialog that answers — `"saveAs"`, `"confirmClose"`, `"newMap"` — and
   * resolve true when it went through, false when it was dismissed.
   */
  ask(dialog: DialogId, payload?: Record<string, unknown>): Promise<boolean>;
  /** Ask the viewport to repaint (a transaction does this by itself). Raises no event. */
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
  /** True once the user pressed Cancel or closed the panel. Poll it inside a loop. */
  cancelled(): boolean;
  /**
   * The same answer as a signal, for work that takes one: aborted when the user
   * cancels, so `fetch(url, { signal })` and anything built on `AbortSignal` stop
   * with the panel. Never aborted by `done()`.
   */
  readonly signal: AbortSignal;
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
  /** Start off waiting: a ring in front of the label, and the button disabled. */
  busy?: boolean;
  onClick?: (event: MouseEvent) => void;
}

/** The `<button>`, with the one call that puts it in and out of its waiting state. */
export type ButtonElement = HTMLButtonElement & {
  /**
   * A ring in front of the label while `busy`, and the button disabled — so the press
   * that started the work cannot be repeated, and says why it cannot.
   */
  setBusy(busy: boolean): void;
};

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

/* ── Waiting ──
   Anything a plugin fetches, decodes or computes leaves the user looking at a dialog
   that has not changed. These are the four ways to say so — a ring, a bar, the line
   along the bottom, and grey stand-ins for content still on its way — plus `busy`,
   which puts a ring over a box whose contents are being replaced. They are one
   vocabulary on purpose: a plugin that uses them waits the way the editor waits. */

export interface SpinnerOptions extends WidgetOptions {
  /** `"sm"` 10px, `"md"` 14px (the default), `"lg"` 20px. */
  size?: "sm" | "md" | "lg";
  /** Text beside the ring. Without it you get the bare ring, to put beside your own. */
  label?: string;
}

export interface ProgressBarOptions extends WidgetOptions {
  /** How far along to start: 0…1, or null (the default) for the sliding bar that means "no idea how long". */
  value?: number | null;
  /** A line under the bar — what is being waited for, or how much of it is done. */
  label?: string;
  /** The percentage at the end of the bar; on for a bar that knows how far along it is. */
  percent?: boolean;
  /** Width in CSS pixels; it fills the width it is given by default. */
  width?: number;
}

export type ProgressBarElement = HTMLElement & {
  /**
   * How far along: 0…1, or null for the sliding bar. `label` replaces the line under it.
   * Cheap to call often — it repaints only when the bar actually moves.
   */
  set(value: number | null, label?: string): void;
};

export interface StatusLineOptions extends WidgetOptions {
  /** What it says before anything has happened. */
  text?: string;
}

/**
 * The line along the bottom of a dialog: what happened, what is happening, how far
 * along it is, and the Cancel that stops it — in one place, so a dialog has one voice.
 * It is a live region, so a screen reader hears the outcome (but not every byte of a
 * download: the bar's own movement is not announced).
 */
export type StatusLineElement = HTMLElement & {
  /**
   * A finished line. `kind` colours it; nothing means plain. A `Node` in place of the
   * text is for a line that carries more than words — a failure with a link to the
   * settings that would fix it.
   */
  set(text: string | Node, kind?: "ok" | "warn" | "error"): void;
  /** Waiting, with no idea how long: a ring and the text. */
  busy(text: string): void;
  /** Waiting with a share done (0…1), or null for the sliding bar. */
  progress(text: string, value: number | null): void;
  /**
   * A Cancel beside the line that calls `stop`; null takes it away. `label` is the
   * button's word — "Stop" for a request that is running, since Cancel in a dialog
   * means leaving it.
   */
  cancel(stop: (() => void) | null, label?: string): void;
  /** Back to an empty line. */
  clear(): void;
};

export interface SkeletonOptions extends WidgetOptions {
  /** CSS width, `"100%"` by default. */
  width?: string;
  /** Height in CSS pixels: 10 for a line, 44 for a block. */
  height?: number;
  /** How many lines, stacked; 1 by default. The last is drawn short, as text ends short. */
  lines?: number;
  /** A block — the place a thumbnail or a picture will take — rather than a line of text. */
  block?: boolean;
}

export interface BusyOptions {
  /** What is being waited for, over the covered box. */
  label?: string;
  /** Dim what is already there rather than leaving it at full strength; true by default. */
  dim?: boolean;
}

export interface BusyHandle {
  /** Change the label without lifting the cover. */
  set(label: string): void;
  /** Uncover the box. Safe to call twice. */
  done(): void;
}

/**
 * Buttons, fields, forms and lists in the editor's own styles, as plain DOM. A plugin
 * dialog built from these looks like a built-in one; `el` is the escape hatch for
 * anything they do not cover.
 */
export interface WidgetsApi {
  button(label: string, options?: ButtonOptions): ButtonElement;
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

  /* ── Waiting ── */

  /** A turning ring: on its own to put beside your own text, or with a `label` beside it. */
  spinner(options?: SpinnerOptions): HTMLElement;
  /**
   * A bar, with the percentage and a line under it. `set(0…1)` moves it; `set(null)`
   * gives the sliding bar for work whose length is not known. Use it where the wait has
   * a size — a download, a pass over every trigger — and a spinner where it does not.
   */
  progressBar(options?: ProgressBarOptions): ProgressBarElement;
  /** The dialog's bottom line: `set`, `busy`, `progress` and a `cancel` button. */
  statusLine(options?: StatusLineOptions): StatusLineElement;
  /**
   * A grey stand-in for content that has not arrived, in the shape it will take. Rows of
   * these in the list you are about to fill say more than an empty box does, and the list
   * does not jump when the answer lands.
   */
  skeleton(options?: SkeletonOptions): HTMLElement;
  /**
   * Cover a box while what is in it is being replaced: dimmed, deaf to clicks, with a
   * ring and a label over it. `done()` uncovers it. Give it the box, not the page — the
   * search field that starts the work should stay live so the user can change their mind.
   * Calling it again on a covered box only changes the label.
   */
  busy(target: HTMLElement, options?: BusyOptions | string): BusyHandle;
}

/* ── Menus, context menus, hotkeys ──────────────────────── */

export type TopMenu = "File" | "Edit" | "View" | "Layer" | "Scenario" | "Triggers" | "Tools" | "Plugins" | "Help";

/**
 * A top-level menu, or a submenu by label: `"File/Import"`. A last segment that names no
 * submenu gets one of the plugin's own, at the end of the menu (`"Tools/AI"`).
 */
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
  /** A separator line above this item — for grouping the items of a submenu of your own. */
  separator?: boolean;
  enabled?: () => boolean;
  /** What the item does. Give this or `command`. */
  run?: () => void;
  /** A registered command's id, instead of a `run` of its own. */
  command?: string;
}

export interface MenuApi {
/**
 * Items in the editor's menu bar.
 *
 * @example
 * api.menu.add("Tools", {
 *   label: "Count units\u2026",
 *   icon: "plugin",
 *   run: () => api.ui.alert(`Player 1 has ${api.query.unitsOf(0).length} units.`),
 * });
 *
 * @example
 * // A path whose last segment names no submenu makes one, at the end of that menu.
 * api.menu.add("Tools/My plugin", { label: "Settings\u2026", command: "settings" });
 */
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
  /** `"Ctrl+Shift+I"`, `"Alt+F9"`, `"F8"` — modifiers in any order, then a key name.    *
   * @example
   * api.hotkeys.add("Ctrl+Shift+W", () => handle.setVisible(!handle.visible()));
   */
  add(combo: string, run: (() => void) | { command: string }): Disposable;
}

/* ── Events and storage ─────────────────────────────────── */

export type PluginEvent =
  /** A map was opened, closed or replaced. */
  | "document"
  /** Any committed edit (every `document.edit`, stroke, undo and redo bumps it, terrain or not), and a fog edit. */
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
  | "palette"
  /** An editing option moved: symmetry, placement rules, doodad rules, location snap, the fog view player, clip parts and paste mode, locked layers, the grid look, Preferences. */
  | "options"
  /** The document's file changed: its name or handle after a Save, the save options, the archive extras, the recent list. */
  | "file"
  /** A plugin registered or removed a command — how a plugin learns that one it calls by id has arrived. */
  | "commands"
  /** The game data source changed: installed, switched to another data set, or a copy removed. `gameData.source()` says what it is now. */
  | "gameData";

/** Why the document changed. */
export type DocumentChangeReason =
  /** File ▸ Open, drag-and-drop, `document.open`: a file the user chose. */
  | "open"
  /** File ▸ New (the startup map included). */
  | "new"
  /** File ▸ Close: `document.isOpen()` is now false. */
  | "close"
  /** The open map parsed again from edited bytes — a `document.sections` write, by any plugin. */
  | "replace";

export interface DocumentEvent {
  reason: DocumentChangeReason;
  fileName: string | null;
}

/**
 * Listeners are notifications: they run after the change, in the order the plugins were
 * activated, and cannot veto or reorder one another. A listener that rewrites the map in
 * response (through `document.sections`) simply raises a fresh `"document"` event with
 * reason `"replace"`, which every other listener sees in turn.
 */
export interface EventsApi {
/**
 * @example
 * // Notifications, in activation order; a listener never intercepts what it hears.
 * api.events.on("document", (e) => {
 *   if (e.reason === "open") check(e.fileName);
 * });
 * api.events.on("terrain", () => redraw());
 */
  on(event: "document", listener: (event: DocumentEvent) => void): Disposable;
  on(event: PluginEvent, listener: () => void): Disposable;
}

export interface StorageApi {
/**
 * A small key-value store of the plugin's own, under its id in the browser's local
 * storage and listed in Preferences \u25b8 Browser storage.
 *
 * @example
 * const opts = api.storage.get("options", { showGrid: true });
 * api.storage.set("options", { ...opts, showGrid: false });
 */
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

/** A slug for storage keys and log prefixes. */
export function pluginIdOf(manifest: { id?: string; name: string }): string {
  const raw = manifest.id?.trim() || manifest.name;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plugin";
}
