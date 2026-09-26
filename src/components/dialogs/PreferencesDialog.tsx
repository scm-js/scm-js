/**
 * Edit ▸ Preferences (Ctrl+,): one dialog with a page list down the left. Every page edits a
 * working copy — the preferences object plus the grid's spacing, look and snaps, which have
 * atoms of their own — written on OK/Apply, so Cancel leaves everything as it was. Reset to
 * defaults puts the whole copy back. `payload.page` opens a page directly (View ▸ Grid
 * Settings… is Editing; a plugin's page is `plugin:<id>`).
 *
 * The Storage page's clears are the one thing that acts at once, since they reset the live
 * atoms; the working copy re-reads whatever a clear touched so OK afterwards does not write
 * the old values straight back.
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Eye,
  Globe,
  HardDrive,
  History,
  Keyboard,
  Plus,
  X,
  Upload,
  PencilRuler,
  Play,
  Puzzle,
  RotateCcw,
  Settings2,
  Trash2,
} from "lucide-react";
import { closeDialogAtom, openDialogAtom } from "../../atoms/uiAtoms";
import { pluginHotkeysAtom, pluginPreferencesPagesAtom, pluginRuntimesAtom, type PluginPreferencesPageEntry } from "../../atoms/pluginAtoms";
import { COMMAND_GROUPS, COMMANDS, FIXED_KEYS, comboOf, commandById, conflictsOf, formatCombo, isModifierKey, reservedReason, resolveHotkeys, withBinding } from "../../editor/commands";
import { logError } from "../../editor/log";
import { doodadPlacementAtom, gridSizeAtom, locationSnapAtom } from "../../atoms/editorAtoms";
import { gameDataSourceAtom } from "../../atoms/gameDataAtoms";
import {
  ANIMATION_SPEEDS,
  animationSpeedIndex,
  clearStoredDataAtom,
  clearStoredKeysAtom,
  DEFAULT_GRID_LOOK,
  DEFAULT_PREFERENCES,
  exportStoredPreferences,
  gridLookAtom,
  importStoredPreferencesAtom,
  ownedStoredKeys,
  preferencesAtom,
  type GridLook,
  type GridStyle,
  type Preferences,
} from "../../atoms/preferencesAtoms";
import { STORAGE_PREFIX, storagePersists, storedKeys, storedSize, storedValue } from "../../atoms/storage";
import { MAP_SIZES, TILESETS, type TilesetId } from "../../data/tilesets";
import { DEFAULT_DOODAD_PLACEMENT } from "../../editor/doodads";
import { hostTerms, isDesktop } from "../../editor/platform";
import { PREFERENCE_LIMITS, type LanguagePreference, type NewMapVersion, type PluginUpdateMode, type StatusBarCells } from "../../editor/preferences";
import { MAP_VERSIONS } from "../../formats/chk/scenario";
import { saveBytes } from "../../services/mapIo";
import { listCopies, recoveryPersists, SESSION, type RecoveryEntry } from "../../services/recovery";
import { KEEP_PER_FILE, listPrevious, removePrevious, type PreviousEntry } from "../../services/previousVersions";
import { discardCopy, leftoverEntries } from "../../hooks/useRecovery";
import { formatBytes } from "../../editor/save";
import { DEFAULT_PROFILE } from "../../gamedata/profiles";
import { LOCALES, msg, t, translate } from "../../i18n";
import { Button, Check, Field, IconSelect, NumberInput, Select } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import FlagIcon from "../ui/FlagIcon";
import type { DialogProps } from "./DialogHost";
import { GameFolderRow, TestFolderRow, useGameInfo, useTestFolder } from "./TestFolder";

/* ── Pages ──────────────────────────────────────────────── */

export type PreferencesPage = "general" | "editing" | "view" | "testing" | "plugins" | "storage" | "hotkeys";

/** A page id as the payload carries it: a built-in page, or `plugin:<id>` for a plugin's page. */
type PageId = PreferencesPage | `plugin:${string}`;

const PAGES: { id: PreferencesPage; label: string; icon: ReactNode }[] = [
  { id: "general", label: msg("General"), icon: <Settings2 size={13} /> },
  { id: "editing", label: msg("Editing"), icon: <PencilRuler size={13} /> },
  { id: "view", label: msg("View"), icon: <Eye size={13} /> },
  { id: "testing", label: msg("Testing"), icon: <Play size={13} /> },
  { id: "plugins", label: msg("Plugins"), icon: <Puzzle size={13} /> },
  { id: "storage", label: msg("Storage"), icon: <Database size={13} /> },
  { id: "hotkeys", label: msg("Hotkeys"), icon: <Keyboard size={13} /> },
];

function pageOf(payload: Record<string, unknown> | undefined): PageId {
  const page = payload?.page;
  if (typeof page === "string" && (PAGES.some((p) => p.id === page) || page.startsWith("plugin:"))) return page as PageId;
  return "general";
}

/** A heading and its rows — the group box's legend without the box. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="prefs-section">
      <h3>{title}</h3>
      <div className="col" style={{ gap: 6 }}>{children}</div>
    </section>
  );
}

/** One sentence under a control. */
function Hint({ children }: { children: ReactNode }) {
  return <p className="hint prefs-hint">{children}</p>;
}

/* ── The working copy ───────────────────────────────────── */

type GridSize = 8 | 16 | 32 | 64 | 128;

interface Working {
  prefs: Preferences;
  gridSize: GridSize;
  look: GridLook;
  snapLocations: boolean;
  snapDoodads: boolean;
}

const DEFAULT_WORKING: Working = {
  prefs: DEFAULT_PREFERENCES,
  gridSize: 32,
  look: DEFAULT_GRID_LOOK,
  snapLocations: true,
  snapDoodads: DEFAULT_DOODAD_PLACEMENT.snapToGrid,
};

/** Which part of the working copy a stored key feeds, for re-reading after a clear. */
const KEY_PARTS: Record<string, keyof Working> = {
  "scmjs.prefs": "prefs",
  "scmjs.gridSize": "gridSize",
  "scmjs.grid": "look",
  "scmjs.locationSnap": "snapLocations",
  "scmjs.doodadPlacement": "snapDoodads",
};

/* ── The dialog ─────────────────────────────────────────── */

export function PreferencesDialog({ entry }: DialogProps) {
  const store = useStore();
  const [prefs, setPrefs] = useAtom(preferencesAtom);
  const [gridSize, setGridSize] = useAtom(gridSizeAtom);
  const [look, setLook] = useAtom(gridLookAtom);
  const [locationSnap, setLocationSnap] = useAtom(locationSnapAtom);
  const [doodadPlacement, setDoodadPlacement] = useAtom(doodadPlacementAtom);
  const open = useSetAtom(openDialogAtom);
  const close = useSetAtom(closeDialogAtom);
  const pluginPages = useAtomValue(pluginPreferencesPagesAtom);
  const live = (): Working => ({
    prefs: store.get(preferencesAtom),
    gridSize: store.get(gridSizeAtom),
    look: store.get(gridLookAtom),
    snapLocations: store.get(locationSnapAtom) !== 0,
    snapDoodads: store.get(doodadPlacementAtom).snapToGrid,
  });
  const [w, setW] = useState<Working>(() => ({ prefs, gridSize, look, snapLocations: locationSnap !== 0, snapDoodads: doodadPlacement.snapToGrid }));
  const [page, setPage] = useState<PageId>(() => pageOf(entry.payload));
  // A plugin's page, once shown, stays mounted (hidden) until the dialog closes, so what
  // the user changed on it is still there for `apply` after they moved to another page.
  const [visited, setVisited] = useState<Set<string>>(() => new Set());
  const shownPlugin = page.startsWith("plugin:") ? pluginPages.find((e) => `plugin:${e.plugin.id}` === page) : undefined;
  useEffect(() => {
    if (shownPlugin && !visited.has(shownPlugin.plugin.id)) setVisited(new Set(visited).add(shownPlugin.plugin.id));
  }, [shownPlugin, visited]);
  const patch = (p: Partial<Preferences>) => setW({ ...w, prefs: { ...w.prefs, ...p } });
  const apply = () => {
    setPrefs(w.prefs);
    setGridSize(w.gridSize);
    setLook(w.look);
    setLocationSnap(w.snapLocations ? w.gridSize : 0);
    if (doodadPlacement.snapToGrid !== w.snapDoodads) setDoodadPlacement({ ...doodadPlacement, snapToGrid: w.snapDoodads });
    for (const e of pluginPages) {
      if (!visited.has(e.plugin.id)) continue;
      try { e.spec.apply?.(); } catch (err) { logError(e.plugin.name, "The Preferences page's apply failed", err); }
    }
  };
  const reset = () => {
    setW(DEFAULT_WORKING);
    if (shownPlugin) {
      try { shownPlugin.spec.reset?.(); } catch (err) { logError(shownPlugin.plugin.name, "The Preferences page's reset failed", err); }
    }
  };
  // After a clear the atoms behind these keys are back on their defaults; follow them.
  const reseed = (keys: string[]) => {
    const now = live();
    const next = { ...w };
    for (const key of keys) {
      const part = KEY_PARTS[key];
      if (part) (next as Record<keyof Working, unknown>)[part] = now[part];
    }
    setW(next);
  };

  const content: Record<PreferencesPage, () => ReactNode> = {
    general: () => <GeneralPage w={w} patch={patch} />,
    editing: () => <EditingPage w={w} setW={setW} />,
    view: () => <ViewPage w={w} patch={patch} />,
    testing: () => <TestingPage w={w} patch={patch} />,
    plugins: () => <PluginsPage w={w} patch={patch} onManage={() => open("plugins")} />,
    storage: () => (
      <div className="stack">
        <GameDataSection />
        <StorageSection onCleared={reseed} />
        <RecoverySection onShow={() => open("recovery")} />
        <PreviousSection onShow={() => open("previousVersions")} />
        <TransferSection onImported={() => setW(live())} />
      </div>
    ),
    hotkeys: () => <HotkeysPage w={w} patch={patch} />,
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={t("Preferences")}
      icon={<Settings2 size={14} />}
      size="lg"
      tall
      showApply
      onOk={apply}
      footerLeft={
        <Button size="sm" onClick={reset} title={t("Every page back to how the editor ships; nothing is written until OK or Apply.")}>
          <RotateCcw size={11} /> {" "}{t("Reset to defaults")}
        </Button>
      }
    >
      <div className="split prefs" style={{ ["--split" as string]: "168px" }}>
        <nav className="prefs-nav" aria-label={t("Preferences pages")}>
          {PAGES.map((p) => (
            <div key={p.id} className="col" style={{ gap: 2 }}>
              <button
                type="button"
                className={`prefs-nav-btn ${page === p.id ? "is-active" : ""}`}
                aria-current={page === p.id ? "page" : undefined}
                onClick={() => setPage(p.id)}
              >
                {p.icon}
                <span>{translate(p.label)}</span>
              </button>
              {p.id === "plugins" && pluginPages.map((e) => {
                const id: PageId = `plugin:${e.plugin.id}`;
                return (
                  <button
                    key={e.key}
                    type="button"
                    className={`prefs-nav-btn nested ${page === id ? "is-active" : ""}`}
                    aria-current={page === id ? "page" : undefined}
                    title={e.plugin.name}
                    onClick={() => setPage(id)}
                  >
                    <span>{e.plugin.name}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        {/* One container for every page, so a visited plugin page stays mounted while a built-in one shows. */}
        <div className="prefs-page">
          {!page.startsWith("plugin:") && <div className="prefs-builtin" key={page}>{content[page as PreferencesPage]()}</div>}
          {page.startsWith("plugin:") && !shownPlugin && <p className="hint">{t("This plugin has no Preferences page, or is not running.")}</p>}
          {pluginPages.filter((e) => visited.has(e.plugin.id) || e === shownPlugin).map((e) => (
            <PluginPreferencesPage key={e.key} entry={e} shown={e === shownPlugin} onClose={() => close(entry.key)} />
          ))}
        </div>
      </div>
    </DialogFrame>
  );
}

/**
 * One plugin's page: an empty `div` the plugin fills through `spec.mount`. The host element
 * is held in state, not a ref — the dialog's portal mounts a commit after this component,
 * so a ref read in the first effect pass is still null. Hidden, not unmounted, while
 * another page shows (see `visited` above).
 */
function PluginPreferencesPage({ entry, shown, onClose }: { entry: PluginPreferencesPageEntry; shown: boolean; onClose: () => void }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!host) return;
    let cleanup: void | (() => void);
    try {
      cleanup = entry.spec.mount(host, { plugin: entry.plugin, close: onClose });
    } catch (err) {
      logError(entry.plugin.name, "The Preferences page's mount failed", err);
      host.textContent = err instanceof Error ? err.message : String(err);
    }
    return () => { try { cleanup?.(); } catch (err) { logError(entry.plugin.name, "The Preferences page's cleanup failed", err); } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, entry]);
  return (
    <div className="stack" hidden={!shown}>
      <section className="prefs-section">
        <h3>{entry.plugin.name}</h3>
        <div ref={setHost} className="col plugin-prefs-page" style={{ gap: 6 }} />
      </section>
    </div>
  );
}

/** View ▸ Grid Settings… is the Editing page; the dialog id stays for plugins that open it. */
export function GridSettingsDialog({ entry }: DialogProps) {
  return <PreferencesDialog entry={{ ...entry, payload: { ...entry.payload, page: "editing" } }} />;
}

/* ── General ────────────────────────────────────────────── */

function GeneralPage({ w, patch }: { w: Working; patch: (p: Partial<Preferences>) => void }) {
  const p = w.prefs;
  const newMap = (n: Partial<Preferences["newMap"]>) => patch({ newMap: { ...p.newMap, ...n } });
  const updates = (u: Partial<Preferences["updates"]>) => patch({ updates: { ...p.updates, ...u } });
  const startup = (s: Partial<Preferences["startup"]>) => patch({ startup: { ...p.startup, ...s } });
  const save = (s: Partial<Preferences["save"]>) => patch({ save: { ...p.save, ...s } });
  const recovery = (r: Partial<Preferences["recovery"]>) => patch({ recovery: { ...p.recovery, ...r } });
  return (
    <div className="stack">
      <Section title={t("Language")}>
        <div className="row">
          <IconSelect
            value={p.language}
            aria-label={t("Language")}
            width={220}
            options={[
              { value: "auto", label: hostTerms().desktop ? t("Same as the system") : t("Same as the browser"), icon: <Globe size={13} className="opt-globe" /> },
              ...LOCALES.map((l) => ({ value: l.id, label: l.label, icon: <FlagIcon locale={l.id} /> })),
            ]}
            onChange={(v) => patch({ language: v as LanguagePreference })}
          />
        </div>
        <Hint>{t("The editor's own words. A map's text is the map's, whatever language this is.")}</Hint>
      </Section>
      <Section title={t("Startup")}>
        <Check label={t("Show the splash screen while the game data loads")} checked={p.splash} onChange={(e) => patch({ splash: e.target.checked })} />
        <Check label={t("Reopen the last map")} checked={p.startup.reopenLast} onChange={(e) => startup({ reopenLast: e.target.checked })} />
        <Hint>{hostTerms().desktop ? t("The most recent file comes back in place of the blank map.") : t("The most recent file comes back in place of the blank map; a browser that has to ask first offers it in a notice.")}</Hint>
        <div className="form wide">
          <Field label={t("Recent files")}>
            <NumberInput value={p.startup.recents} min={PREFERENCE_LIMITS.recents.min} max={PREFERENCE_LIMITS.recents.max} width={90} onChange={(v) => startup({ recents: v })} />
          </Field>
        </div>
        {isDesktop() && (
          <>
            <Check label={t("Check for updates when scmJS starts")} checked={p.updates.checkOnStart} onChange={(e) => updates({ checkOnStart: e.target.checked })} />
            <Check label={t("Include nightly builds")} checked={p.updates.nightly} onChange={(e) => updates({ nightly: e.target.checked })} />
            <Hint>{t("A new version is offered in a notice, never installed on its own. Nightly builds are untested, and the updater will not offer an older version afterwards.")}</Hint>
          </>
        )}
      </Section>
      <Section title={t("Maps")}>
        <Check label={t("Open each map in its own tab, keeping the others open")} checked={p.multipleMaps} onChange={(e) => patch({ multipleMaps: e.target.checked })} />
        <Hint>{t("Off opens a map in place of the one that is open, as StarEdit does.")}</Hint>
        <Check label={t("Ask before closing or replacing a map with unsaved changes")} checked={p.confirmClose} onChange={(e) => patch({ confirmClose: e.target.checked })} />
        <Hint>{t("Covers closing a tab or the editor, and New, Open or a dropped file replacing the open map.")}</Hint>
      </Section>
      <Section title={t("New scenario")}>
        <div className="form wide">
          <Field label={t("Tileset")}>
            <Select value={p.newMap.tileset} onChange={(e) => newMap({ tileset: e.target.value as TilesetId })} options={TILESETS.map((ts) => ({ value: ts.id, label: ts.name }))} />
          </Field>
          <Field label={t("Size")}>
            <div className="row">
              <Select style={{ width: 90 }} value={String(p.newMap.width)} onChange={(e) => newMap({ width: Number(e.target.value) })} options={MAP_SIZES.map(String)} />
              <span className="dim">×</span>
              <Select style={{ width: 90 }} value={String(p.newMap.height)} onChange={(e) => newMap({ height: Number(e.target.value) })} options={MAP_SIZES.map(String)} />
            </div>
          </Field>
          <Field label={t("Revision")}>
            <Select
              value={p.newMap.version}
              onChange={(e) => newMap({ version: e.target.value as NewMapVersion })}
              options={(["broodwar", "remastered"] as const).map((v) => ({ value: v, label: MAP_VERSIONS[v].label }))}
            />
          </Field>
        </div>
        <Hint>{t("What File ▸ New starts with, and the map the editor opens on. Brood War files play on every build; Remastered's 32-bit strings need 1.21 or later.")}</Hint>
      </Section>
      <Section title={t("Saving")}>
        <div className="form wide">
          <Field label={t("Save dialog")}>
            <Select
              value={p.save.start}
              onChange={(e) => save({ start: e.target.value as Preferences["save"]["start"] })}
              options={[{ value: "asOpened", label: t("Starts from how the file was opened") }, { value: "everything", label: t("Starts from Everything") }, { value: "smallest", label: t("Starts from Smallest") }]}
            />
          </Field>
          <Field label={t("New maps")}>
            <Select
              value={p.save.compression}
              onChange={(e) => save({ compression: e.target.value as Preferences["save"]["compression"] })}
              options={[{ value: "asOpened", label: t("StarEdit's layout (PKWARE, encrypted)") }, { value: "none", label: t("Uncompressed") }, { value: "pkware", label: t("PKWARE") }, { value: "zlib", label: t("zlib (1.16.1 or Remastered)") }]}
            />
          </Field>
        </div>
        <Hint>{t("A map already saved in this session starts from its last options either way. New maps means a map with no file yet, or one opened from a bare .chk.")}</Hint>
        <Check
          label={hostTerms().desktop ? t("Keep the file a save replaces as a .bak beside it") : t("Keep the version a save replaces")}
          checked={p.save.backup}
          onChange={(e) => save({ backup: e.target.checked })}
        />
        <Hint>
          {hostTerms().desktop
            ? t("Saving over map.scx first copies it to map.scx.bak, replacing an older .bak.")
            : t("{Here} cannot put a file beside another, so the last {n} versions of each file are kept in {here} instead, under File ▸ Previous Versions…. A download replaces nothing, so there is nothing to keep.", { Here: hostTerms().Here, here: hostTerms().here, n: KEEP_PER_FILE })}
        </Hint>
      </Section>
      <Section title={t("Recovery")}>
        <Check label={t("Keep a recovery copy of maps with unsaved changes")} checked={p.recovery.enabled} onChange={(e) => recovery({ enabled: e.target.checked })} />
        <div className="form wide">
          <Field label={t("Copy every")}>
            <NumberInput
              value={p.recovery.minutes}
              min={PREFERENCE_LIMITS.recoveryMinutes.min}
              max={PREFERENCE_LIMITS.recoveryMinutes.max}
              width={90}
              unit={t("min")}
              disabled={!p.recovery.enabled}
              onChange={(v) => recovery({ minutes: v })}
            />
          </Field>
        </div>
        <Hint>{t("A copy is also made when the editor goes to the background, and is removed when the map is saved or closed. If the editor closes before a map is saved, the copy is offered back at the next start. Copies are kept in {here}, not beside your files.", { here: hostTerms().here })}</Hint>
      </Section>
    </div>
  );
}

/* ── Editing ────────────────────────────────────────────── */

function EditingPage({ w, setW }: { w: Working; setW: (w: Working) => void }) {
  const look = (l: Partial<GridLook>) => setW({ ...w, look: { ...w.look, ...l } });
  const placement = (pl: Partial<Preferences["placement"]>) => setW({ ...w, prefs: { ...w.prefs, placement: { ...w.prefs.placement, ...pl } } });
  return (
    <div className="stack">
      <Section title={t("Grid")}>
        <div className="form wide">
          <Field label={t("Spacing")}>
            <Select
              value={String(w.gridSize)}
              onChange={(e) => setW({ ...w, gridSize: Number(e.target.value) as GridSize })}
              options={[{ value: "8", label: t("8 px (mini-tile)") }, { value: "16", label: t("16 px") }, { value: "32", label: t("32 px (tile)") }, { value: "64", label: t("64 px") }, { value: "128", label: t("128 px (isometric)") }]}
            />
          </Field>
          <Field label={t("Colour")}>
            <div className="row">
              <input type="color" className="input" value={w.look.color} onChange={(e) => look({ color: e.target.value })} aria-label={t("Grid colour")} />
              <input type="range" min={0} max={100} value={w.look.opacity} onChange={(e) => look({ opacity: Number(e.target.value) })} aria-label={t("Grid opacity")} />
              <span className="mono hint" style={{ width: 36 }}>{w.look.opacity}%</span>
            </div>
          </Field>
          <Field label={t("Style")}>
            <Select value={w.look.style} onChange={(e) => look({ style: e.target.value as GridStyle })} options={[{ value: "lines", label: t("Lines") }, { value: "dots", label: t("Dots") }, { value: "crosses", label: t("Crosses") }]} />
          </Field>
        </div>
        <Hint>{t("Ctrl+G shows and hides it.")}</Hint>
      </Section>
      <Section title={t("Snapping")}>
        <Check className="wrap" label={t("Snap locations to the grid ({local} px)", { local: w.gridSize })} checked={w.snapLocations} onChange={(e) => setW({ ...w, snapLocations: e.target.checked })} />
        <Check className="wrap" label={t("Snap doodads to the two-tile isometric grid")} checked={w.snapDoodads} onChange={(e) => setW({ ...w, snapDoodads: e.target.checked })} />
        <Hint>{t("The Locations palette can pick a different step. Units have their own snap tick in the Units palette; sprites are placed by the pixel.")}</Hint>
      </Section>
      <Section title={t("Placement")}>
        <div className="form wide">
          <Field label={t("Owner")}>
            <Select
              value={String(w.prefs.placement.owner)}
              onChange={(e) => placement({ owner: Number(e.target.value) })}
              options={Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: t("Player {n}", { n: i + 1 }) }))}
            />
          </Field>
          <Field label={t("Brush size")}>
            <NumberInput value={w.prefs.placement.brushSize} min={PREFERENCE_LIMITS.brushSize.min} max={PREFERENCE_LIMITS.brushSize.max} width={90} onChange={(v) => placement({ brushSize: v })} />
          </Field>
          <Field label={t("New location")}>
            <NumberInput value={w.prefs.placement.locationTiles} min={PREFERENCE_LIMITS.locationTiles.min} max={PREFERENCE_LIMITS.locationTiles.max} width={90} unit={t("tiles")} onChange={(v) => placement({ locationTiles: v })} />
          </Field>
        </div>
        <Hint>{t("What the palettes start on: the owner of placed units and sprites, the terrain brush, and the square the Locations palette's New button makes.")}</Hint>
      </Section>
      <Section title={t("Undo")}>
        <div className="form wide">
          <Field label={t("Levels")}>
            <NumberInput value={w.prefs.undoLevels} min={PREFERENCE_LIMITS.undoLevels.min} max={PREFERENCE_LIMITS.undoLevels.max} step={10} width={90} onChange={(v) => setW({ ...w, prefs: { ...w.prefs, undoLevels: v } })} />
          </Field>
        </div>
        <Hint>{t("Edits kept per map; a whole-map stroke is a few hundred kB each.")}</Hint>
      </Section>
    </div>
  );
}

/* ── View ───────────────────────────────────────────────── */

/** One animation-speed slider: the range picks a step of `ANIMATION_SPEEDS`. */
function SpeedField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const index = animationSpeedIndex(value);
  return (
    <Field label={label}>
      <div className="row">
        <input type="range" min={0} max={ANIMATION_SPEEDS.length - 1} value={index} onChange={(e) => onChange(ANIMATION_SPEEDS[Number(e.target.value)])} aria-label={t("{label} animation speed", { label })} />
        <span className="mono hint" style={{ width: 44 }}>{ANIMATION_SPEEDS[index]}×</span>
      </div>
    </Field>
  );
}

const STATUS_CELLS: [keyof StatusBarCells, string][] = [
  ["tile", msg("Tile under the cursor")],
  ["pixel", msg("Pixel under the cursor")],
  ["tileId", msg("Tile id under the cursor")],
  ["size", msg("Map size")],
  ["tileset", msg("Tileset")],
  ["layer", msg("Active layer")],
  ["zoom", msg("Zoom")],
  ["revision", msg("Map revision")],
];

function ViewPage({ w, patch }: { w: Working; patch: (p: Partial<Preferences>) => void }) {
  const p = w.prefs;
  const view = (v: Partial<Preferences["view"]>) => patch({ view: { ...p.view, ...v } });
  return (
    <div className="stack">
      <Section title={t("Mouse wheel")}>
        <Check radio name="wheel" label={t("Scrolls the map; Ctrl+wheel zooms")} checked={p.view.wheel === "scroll"} onChange={() => view({ wheel: "scroll" })} />
        <Check radio name="wheel" label={t("Zooms; Shift+wheel scrolls sideways")} checked={p.view.wheel === "zoom"} onChange={() => view({ wheel: "zoom" })} />
        <Check label={t("Zoom toward the pointer")} checked={p.view.zoomToCursor} onChange={(e) => view({ zoomToCursor: e.target.checked })} />
        <Hint>{t("Keeps the tile under the pointer in place when the wheel zooms; the menu and keyboard zoom on the centre.")}</Hint>
      </Section>
      <Section title={t("Animation")}>
        <Check label={t("Animate water (palette cycling)")} checked={p.animateWater} onChange={(e) => patch({ animateWater: e.target.checked })} />
        <Check label={t("Animate units (idle animations)")} checked={p.animateUnits} onChange={(e) => patch({ animateUnits: e.target.checked })} />
        <div className="form wide" style={{ marginTop: 4 }}>
          <SpeedField label={t("Water speed")} value={p.animateWaterSpeed} onChange={(v) => patch({ animateWaterSpeed: v })} />
          <SpeedField label={t("Unit speed")} value={p.animateUnitsSpeed} onChange={(v) => patch({ animateUnitsSpeed: v })} />
        </div>
        <Hint>{t("The ticks are what the View menu starts with; 1× is the speed the game itself runs at.")}</Hint>
      </Section>
      <Section title={t("Status bar")}>
        <div className="prefs-checks">
          {STATUS_CELLS.map(([k, label]) => (
            <Check key={k} label={translate(label)} checked={p.statusBar[k]} onChange={(e) => patch({ statusBar: { ...p.statusBar, [k]: e.target.checked } })} />
          ))}
        </div>
        <Hint>{t("The message, the symmetry mode while one is on, and what plugins add always show.")}</Hint>
      </Section>
      <Section title={t("Text colours")}>
        <Check radio name="classicText" label={t("Preview strings as Remastered draws them: a colour carries onto the next line")} checked={!p.classicText} onChange={() => patch({ classicText: false })} />
        <Check radio name="classicText" label={t("Preview strings as 1.16.1 drew them: the colour resets at every line break")} checked={p.classicText} onChange={() => patch({ classicText: true })} />
        <Hint>{t("Changes only what the editor draws, never the map: Map Properties, the String Editor, force and unit names, trigger text.")}</Hint>
      </Section>
    </div>
  );
}

/* ── Testing ────────────────────────────────────────────── */

function TestingPage({ w, patch }: { w: Working; patch: (p: Partial<Preferences>) => void }) {
  const p = w.prefs;
  const testMap = (tm: Partial<Preferences["testMap"]>) => patch({ testMap: { ...p.testMap, ...tm } });
  const { info, refresh } = useGameInfo(p.testMap.dir);
  const [folder, setFolder] = useTestFolder();
  if (isDesktop()) {
    return (
      <div className="stack">
        <Section title={t("After writing")}>
          <Check label={t("Start StarCraft")} checked={p.testMap.launch} onChange={(e) => testMap({ launch: e.target.checked })} />
          <Hint>{t("The game starts on its menu; the map is under Single Player ▸ Custom Game ▸ scmJS. A running game is not restarted.")}</Hint>
        </Section>
        <Section title={t("Game folder")}>
          <GameFolderRow dir={p.testMap.dir} info={info} onDir={(dir) => testMap({ dir })} onRefresh={refresh} />
          <Hint>{t("Test Map writes into this installation's Maps folder. Forget goes back to searching the usual places.")}</Hint>
        </Section>
      </div>
    );
  }
  return (
    <div className="stack">
      <Section title={t("Maps folder")}>
        <TestFolderRow folder={folder} onFolder={setFolder} />
        <Hint>{t("Where Test Map writes; the choice is kept at once. A browser tab cannot start the game, so open the map under Single Player ▸ Custom Game.")}</Hint>
      </Section>
    </div>
  );
}

/* ── Plugins ────────────────────────────────────────────── */

const UPDATE_HINTS: Record<PluginUpdateMode, string> = {
  notify: msg("Looks a few seconds after the plugins start and raises a notice with a button to the rows offering the update."),
  manual: msg("Asks only when Check for update is pressed on a plugin's row."),
  auto: msg("Installs what it finds for the plugins you added; a default moves with scmJS's own releases and is only named in the notice."),
};

function PluginsPage({ w, patch, onManage }: { w: Working; patch: (p: Partial<Preferences>) => void; onManage: () => void }) {
  const p = w.prefs;
  return (
    <div className="stack">
      <Section title={t("Updates")}>
        <div className="form wide">
          <Field label={t("Plugin updates")}>
            <Select
              value={p.plugins.updates}
              onChange={(e) => patch({ plugins: { ...p.plugins, updates: e.target.value as PluginUpdateMode } })}
              options={[{ value: "notify", label: t("Tell me") }, { value: "manual", label: t("Do nothing") }, { value: "auto", label: t("Install them") }]}
            />
          </Field>
        </div>
        <Hint>{translate(UPDATE_HINTS[p.plugins.updates])}</Hint>
      </Section>
      <Section title={t("Installed")}>
        <div className="row">
          <span className="grow hint">{t("Installing, enabling and updating plugins happens in the Plugins dialog.")}</span>
          <Button size="sm" onClick={onManage}><Puzzle size={11} /> {" "}{t("Manage plugins…")}</Button>
        </div>
      </Section>
    </div>
  );
}

/* ── Storage ────────────────────────────────────────────── */

/** Where the files come from, which data set, and the way to the dialog. */
function GameDataSection() {
  const open = useSetAtom(openDialogAtom);
  const source = useAtomValue(gameDataSourceAtom);
  const set = source && source.profile.id !== DEFAULT_PROFILE.id ? `${source.profile.name} · ` : "";
  return (
    <Section title={t("Game data")}>
      <div className="row" style={{ alignItems: "baseline" }}>
        <span className="grow dim">{source ? `${set}${source.label}` : t("Locating…")}</span>
        <Button size="sm" onClick={() => open("gameData")}>
          <HardDrive size={11} /> {" "}{t("Game Data…")}
        </Button>
      </div>
      <Hint>
        {source?.kind === "none" ? t("The editor is drawing flat terrain colours and marker units. Game Data… installs StarCraft's graphics.") : t("Where the terrain and unit graphics are coming from. Game Data… is where to change it.")}
      </Hint>
    </Section>
  );
}

/**
 * One line of the storage list: a setting, a cache, or one plugin's own keys. `keys` is
 * what the row's Clear button throws away — always the editor's own, never the origin's
 * other storage — and `size` a rough byte count of them.
 */
interface StoredEntry {
  label: string;
  detail: string;
  keys: string[];
  size: number;
}

const STORED_LABELS: Record<string, string> = {
  "scmjs.prefs": msg("Preferences"),
  "scmjs.grid": msg("Grid look"),
  "scmjs.gridSize": msg("Grid spacing"),
  "scmjs.locationSnap": msg("Location snap"),
  "scmjs.placement": msg("Unit placement options"),
  "scmjs.doodadPlacement": msg("Doodad placement options"),
  "scmjs.panels": msg("Panels shown"),
  "scmjs.docks": msg("Panel widths"),
  "scmjs.console": msg("Debug console shown"),
  "scmjs.consoleHeight": msg("Debug console height"),
  "scmjs.recents": msg("Recent files"),
  "scmjs.plugins": msg("Installed plugins"),
  "scmjs.plugin-code": msg("Plugin code copies"),
  "scmjs.plugin-manifests": msg("Plugin manifests"),
  "scmjs.plugin-registries": msg("Plugin sources"),
  "scmjs.plugin-registry": msg("Browse Plugins cache"),
  "scmjs.plugin-updates": msg("Last plugin update check"),
};

/**
 * Group the editor's keys into the rows the dialog lists. A plugin's keys
 * (`scmjs.plugin.<id>.…`) collapse into one row per plugin, so *its* data can be thrown
 * away without touching the others'; everything else is one key to a row.
 */
function storedEntries(): StoredEntry[] {
  const rows: StoredEntry[] = [];
  const pluginPrefix = `${STORAGE_PREFIX}plugin.`;
  const byPlugin = new Map<string, string[]>();
  for (const key of storedKeys()) {
    if (key.startsWith(pluginPrefix)) {
      const id = key.slice(pluginPrefix.length).split(".")[0] || "?";
      const keys = byPlugin.get(id);
      if (keys) keys.push(key);
      else byPlugin.set(id, [key]);
    } else {
      rows.push({ label: translate(STORED_LABELS[key] ?? key), detail: key, keys: [key], size: storedSize(key) });
    }
  }
  for (const [id, keys] of [...byPlugin].sort(([a], [b]) => a.localeCompare(b)))
    rows.push({
      label: t("Plugin data · {id}", { id }),
      detail: t("{length, plural, one {# entry} other {# entries}} kept by the plugin", { length: keys.length }),
      keys,
      size: keys.reduce((n, key) => n + storedSize(key), 0),
    });
  return rows;
}

function bytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`;
}

/** How much of a stored value the expanded row shows before it is cut off. */
const VALUE_LIMIT = 4000;

/** The stored value, pretty-printed when it is JSON (everything the editor writes is). */
function storedText(key: string): string {
  const raw = storedValue(key);
  if (raw === null) return "";
  let text = raw;
  try {
    text = JSON.stringify(JSON.parse(raw), null, 1);
  } catch {
    // Not JSON (or too deep to parse): show it as it is.
  }
  return text.length > VALUE_LIMIT ? `${text.slice(0, VALUE_LIMIT)}…` : text;
}

/** One row: the summary line, its Clear button, and what it is keeping when opened. */
function StoredRow({ entry, onClear }: { entry: StoredEntry; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="stored-entry">
      <div className="item">
        <button className="stored-toggle" aria-expanded={open} title={open ? t("Hide what is stored") : t("Show what is stored")} onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Database size={12} className="dim" />
          <span>{entry.label}</span>
        </button>
        <span className="grow dim" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{entry.detail}</span>
        <span className="dim">{bytes(entry.size)}</span>
        <Button size="sm" icon variant="ghost" title={t("Clear {label}", { label: entry.label })} aria-label={t("Clear {label}", { label: entry.label })} onClick={onClear}>
          <Trash2 size={11} />
        </Button>
      </div>
      {open && (
        <div className="stored-detail">
          {entry.keys.map((key) => (
            <div key={key}>
              {/* The summary line already names a row's key when it has only one. */}
              {entry.keys.length > 1 && <div className="mono dim">{key}</div>}
              <pre className="stored-value">{storedText(key) || "(empty)"}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What the editor is keeping here, and the buttons that throw it away — one row at a time
 * (`clearStoredKeysAtom`) or the lot (`clearStoredDataAtom`). Both reset the atom behind a
 * key as well as removing it, so a cleared setting goes back to its default live rather
 * than at the next reload. Confirming happens in place rather than through a second
 * dialog, since nothing about the open map is at stake; `onCleared` is told which keys
 * went, so the dialog can re-read its working copy.
 */
function StorageSection({ onCleared }: { onCleared: (keys: string[]) => void }) {
  const host = hostTerms();
  const clearAll = useSetAtom(clearStoredDataAtom);
  const clearKeys = useSetAtom(clearStoredKeysAtom);
  const [asking, setAsking] = useState<{ what: string; keys: string[] | null } | null>(null);
  const [cleared, setCleared] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const entries = useMemo(() => {
    void run;
    return storedEntries();
  }, [run]);
  const total = entries.reduce((n, e) => n + e.size, 0);
  const doClear = () => {
    if (!asking) return;
    const gone = asking.keys ? clearKeys(asking.keys) : clearAll();
    setAsking(null);
    setCleared(asking.keys ? t("Cleared {what}.", { what: asking.what }) : t("Cleared {n, plural, one {# entry} other {# entries}}. The default plugins load again.", { n: gone }));
    setRun((n) => n + 1);
    onCleared(asking.keys ?? ownedStoredKeys());
  };
  return (
    <Section title={t("{Noun} storage", { Noun: host.Noun })}>
      <div className="listbox stored-list">
        {entries.length === 0 && <div className="empty">{t("Nothing stored.")}</div>}
        {entries.map((e) => (
          <StoredRow key={e.detail} entry={e} onClear={() => { setCleared(null); setAsking({ what: e.label, keys: e.keys }); }} />
        ))}
      </div>
      <div className="row">
        {asking ? (
          <>
            <span className="hint">{asking.keys ? t("Clear {what}?", { what: asking.what }) : t("Clear the preferences, grid settings, installed plugins and plugin data?")}</span>
            <span className="grow" />
            <Button size="sm" onClick={() => setAsking(null)}>{t("Cancel")}</Button>
            <Button size="sm" variant="danger" onClick={doClear}><Trash2 size={11} /> {" "}{t("Clear")}</Button>
          </>
        ) : (
          <>
            <span className="hint">
              {cleared !== null ? cleared : entries.length === 0 ? t("Nothing is stored in {here}.", { here: host.here }) : t("{bytes} stored in {here}. Maps are not part of this list; their recovery copies are below.", { bytes: bytes(total), here: host.here })}
            </span>
            <span className="grow" />
            <Button size="sm" variant="danger" disabled={entries.length === 0} onClick={() => { setCleared(null); setAsking({ what: t("everything"), keys: null }); }}>
              <Trash2 size={11} /> {" "}{t("Clear all data…")}
            </Button>
          </>
        )}
      </div>
      {!storagePersists() && (
        <Hint>
          {t("{Here} is not letting the editor store anything, so settings last only until the", { Here: host.Here })}{" "}{host.desktop ? t("app is closed") : t("tab closes")}.
        </Hint>
      )}
    </Section>
  );
}

/**
 * The recovery copies, which live in IndexedDB rather than beside the settings: how many an
 * earlier session left, the way to the dialog that restores them, and a Discard for the lot.
 * The copies of maps open now are counted but never discarded here — they go when their map
 * is saved or closed.
 */
function RecoverySection({ onShow }: { onShow: () => void }) {
  const [state, setState] = useState<{ left: RecoveryEntry[]; ours: number } | null>(null);
  const [asking, setAsking] = useState(false);
  const [run, setRun] = useState(0);
  useEffect(() => {
    let live = true;
    void Promise.all([leftoverEntries(), listCopies()]).then(([left, all]) => {
      if (live) setState({ left, ours: all.filter((r) => r.session === SESSION).length });
    });
    return () => { live = false; };
  }, [run]);
  const size = state?.left.reduce((n, e) => n + e.size, 0) ?? 0;
  const discard = async () => {
    for (const e of state?.left ?? []) await discardCopy(e.key);
    setAsking(false);
    setRun((n) => n + 1);
  };
  return (
    <Section title={t("Recovery copies")}>
      <div className="row">
        {asking ? (
          <>
            <span className="hint grow">{t("Discard {n, plural, one {the copy} other {all # copies}} left by earlier sessions? The maps in them cannot be got back afterwards.", { n: state?.left.length ?? 0 })}</span>
            <Button size="sm" onClick={() => setAsking(false)}>{t("Cancel")}</Button>
            <Button size="sm" variant="danger" onClick={() => { void discard(); }}><Trash2 size={11} /> {" "}{t("Discard")}</Button>
          </>
        ) : (
          <>
            <span className="grow dim">
              {state === null ? t("Looking…")
                : state.left.length === 0 ? t("None left by earlier sessions.")
                : t("{n, plural, one {# map} other {# maps}} left by earlier sessions, {size}.", { n: state.left.length, size: formatBytes(size) })}
            </span>
            <Button size="sm" disabled={!state || state.left.length === 0} onClick={onShow}><History size={11} /> {" "}{t("Recover Maps…")}</Button>
            <Button size="sm" variant="danger" disabled={!state || state.left.length === 0} onClick={() => setAsking(true)}><Trash2 size={11} /> {" "}{t("Discard…")}</Button>
          </>
        )}
      </div>
      {state !== null && state.ours > 0 && <Hint>{t("{n, plural, one {# map open now has a copy} other {# maps open now have copies}}; each goes when its map is saved or closed.", { n: state.ours })}</Hint>}
      {!recoveryPersists() && <Hint>{t("{Here} is not letting the editor store anything, so the copies would not outlive this page.", { Here: hostTerms().Here })}</Hint>}
    </Section>
  );
}

/** The versions saves wrote over, kept in IndexedDB: how many, the dialog, and a Discard for the lot. */
function PreviousSection({ onShow }: { onShow: () => void }) {
  const [entries, setEntries] = useState<PreviousEntry[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [run, setRun] = useState(0);
  useEffect(() => {
    let live = true;
    void listPrevious().then((e) => { if (live) setEntries(e); });
    return () => { live = false; };
  }, [run]);
  const size = entries?.reduce((n, e) => n + e.size, 0) ?? 0;
  const discard = async () => {
    for (const e of entries ?? []) await removePrevious(e.key);
    setAsking(false);
    setRun((n) => n + 1);
  };
  return (
    <Section title={t("Previous versions")}>
      <div className="row">
        {asking ? (
          <>
            <span className="hint grow">{t("Discard {n, plural, one {the kept version} other {all # kept versions}}? The files on disk are not touched.", { n: entries?.length ?? 0 })}</span>
            <Button size="sm" onClick={() => setAsking(false)}>{t("Cancel")}</Button>
            <Button size="sm" variant="danger" onClick={() => { void discard(); }}><Trash2 size={11} /> {" "}{t("Discard")}</Button>
          </>
        ) : (
          <>
            <span className="grow dim">
              {entries === null ? t("Looking…")
                : entries.length === 0 ? t("None kept.")
                : t("{n, plural, one {# version} other {# versions}} of files saves wrote over, {size}.", { n: entries.length, size: formatBytes(size) })}
            </span>
            <Button size="sm" disabled={!entries || entries.length === 0} onClick={onShow}><History size={11} /> {" "}{t("Previous Versions…")}</Button>
            <Button size="sm" variant="danger" disabled={!entries || entries.length === 0} onClick={() => setAsking(true)}><Trash2 size={11} /> {" "}{t("Discard…")}</Button>
          </>
        )}
      </div>
    </Section>
  );
}

/** Preferences as a file, to carry to another browser or machine. */
function TransferSection({ onImported }: { onImported: () => void }) {
  const importFile = useSetAtom(importStoredPreferencesAtom);
  const [note, setNote] = useState<string | null>(null);
  const doExport = async () => {
    const text = JSON.stringify(exportStoredPreferences(), null, 2);
    const out = await saveBytes(new TextEncoder().encode(text), "scmjs-preferences.json");
    setNote(out ? t("Wrote {name}.", { name: out.fileName }) : null);
  };
  const doImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      let parsed: unknown;
      try { parsed = JSON.parse(await file.text()); } catch { setNote(t("{name} is not a preferences file.", { name: file.name })); return; }
      const r = importFile(parsed);
      setNote(r.ok ? t("Took {n, plural, one {# setting} other {# settings}} from {name}.", { n: r.keys, name: file.name }) : t("{name} is not a preferences file.", { name: file.name }));
      if (r.ok) onImported();
    };
    input.click();
  };
  return (
    <Section title={t("Preferences file")}>
      <div className="row">
        <span className="grow hint">{note ?? t("Every setting above and the plugins' own, as one file; caches and the recent files stay behind.")}</span>
        <Button size="sm" onClick={() => { void doExport(); }}><Download size={11} /> {" "}{t("Export…")}</Button>
        <Button size="sm" onClick={doImport}><Upload size={11} /> {" "}{t("Import…")}</Button>
      </div>
    </Section>
  );
}

/* ── Hotkeys ────────────────────────────────────────────── */

function HotkeysPage({ w, patch }: { w: Working; patch: (p: Partial<Preferences>) => void }) {
  const desktop = isDesktop();
  const overrides = w.prefs.hotkeys;
  const resolved = useMemo(() => resolveHotkeys(overrides, desktop), [overrides, desktop]);
  const pluginHotkeys = useAtomValue(pluginHotkeysAtom);
  const runtimes = useAtomValue(pluginRuntimesAtom);
  const pluginName = (id: string) => runtimes[id]?.manifest?.name ?? id;
  const pluginCombos = pluginHotkeys.map((h) => ({ combo: h.combo, plugin: pluginName(h.pluginId) }));
  const [capturing, setCapturing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const setKeys = (id: string, keys: string[] | null) => patch({ hotkeys: withBinding(overrides, id, keys, desktop) });

  // While a row waits for keys, every key press is the new combo: taken on the capture
  // phase so neither the dialog's Escape nor the editor's own hotkeys see it.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.isComposing || isModifierKey(e.key)) return;
      const combo = comboOf(e);
      if (combo === "Escape") { setCapturing(null); setNote(null); return; }
      const reserved = reservedReason(combo);
      if (reserved) { setNote(t("{keys} cannot be used: {why}.", { keys: formatCombo(combo), why: translate(reserved) })); return; }
      const now = resolved.byCommand[capturing] ?? [];
      if (!now.includes(combo)) setKeys(capturing, [...now, combo]);
      setCapturing(null);
      setNote(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div className="stack" style={{ height: "100%" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Hint>{t("Add a key to a command with +, then press the keys. A plugin's keys are tried before the editor's.")}</Hint>
        <Button size="sm" disabled={Object.keys(overrides).length === 0} onClick={() => { setCapturing(null); patch({ hotkeys: {} }); }}>
          <RotateCcw size={11} /> {" "}{t("Reset all hotkeys")}
        </Button>
      </div>
      {note && <p className="hint prefs-hint warn" role="status">{note}</p>}
      <div className="listbox hotkeys" style={{ flex: 1, minHeight: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: "36%" }}>{t("Command")}</th>
              <th>{t("Shortcut")}</th>
              <th style={{ width: 1 }} />
            </tr>
          </thead>
          <tbody>
            {COMMAND_GROUPS.map((g) => (
              <Fragment key={g.id}>
                <tr className="hotkeys-group"><td colSpan={3}>{translate(g.label)}</td></tr>
                {COMMANDS.filter((c) => c.group === g.id).map((c) => {
                  const keys = resolved.byCommand[c.id] ?? [];
                  const conflicts = conflictsOf(c.id, resolved, pluginCombos);
                  return (
                    <tr key={c.id}>
                      <td>{translate(c.label)}</td>
                      <td className="hotkey-keys">
                        {keys.map((k) => {
                          const clash = conflicts.find((x) => x.combo === k);
                          const also = clash ? [...clash.commands.map((id) => translate(commandById(id)?.label ?? id)), ...clash.plugins.map((n) => t("{plugin} (plugin, tried first)", { plugin: n }))].join(", ") : "";
                          return (
                            <span key={k} className={`kbd hotkey-chip${clash ? " is-conflict" : ""}`} title={clash ? t("Also: {also}", { also }) : undefined}>
                              {formatCombo(k)}
                              <button type="button" className="hotkey-remove" aria-label={t("Remove {keys}", { keys: formatCombo(k) })} onClick={() => setKeys(c.id, keys.filter((x) => x !== k))}>
                                <X size={9} />
                              </button>
                            </span>
                          );
                        })}
                        {capturing === c.id && <span className="kbd is-capturing">{t("Press keys… (Esc to stop)")}</span>}
                        {keys.length === 0 && capturing !== c.id && <span className="faint">{t("none")}</span>}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <Button size="sm" aria-label={t("Add a key to {command}", { command: translate(c.label) })} title={t("Add a key")} onClick={() => { setNote(null); setCapturing(capturing === c.id ? null : c.id); }}>
                          <Plus size={11} />
                        </Button>
                        {" "}
                        <Button size="sm" disabled={!(c.id in overrides)} aria-label={t("Put back the keys {command} ships with", { command: translate(c.label) })} title={t("Back to the default")} onClick={() => setKeys(c.id, null)}>
                          <RotateCcw size={11} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            {pluginHotkeys.length > 0 && <tr className="hotkeys-group"><td colSpan={3}>{t("Plugins")}</td></tr>}
            {pluginHotkeys.map((h) => (
              <tr key={h.key}>
                <td>{pluginName(h.pluginId)}</td>
                <td colSpan={2}><span className="kbd">{h.combo}</span></td>
              </tr>
            ))}
            <tr className="hotkeys-group"><td colSpan={3}>{t("Fixed")}</td></tr>
            {FIXED_KEYS.map(([label, keys]) => (
              <tr key={label}>
                <td>{translate(label)}</td>
                <td colSpan={2}>{keys.map((k) => <span key={k} className="kbd">{translate(k)}</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
