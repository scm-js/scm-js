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
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  Globe,
  HardDrive,
  Keyboard,
  PencilRuler,
  Play,
  Puzzle,
  RotateCcw,
  Settings2,
  Trash2,
} from "lucide-react";
import { closeDialogAtom, openDialogAtom } from "../../atoms/uiAtoms";
import { pluginPreferencesPagesAtom, type PluginPreferencesPageEntry } from "../../atoms/pluginAtoms";
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
  gridLookAtom,
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
import type { LanguagePreference, PluginUpdateMode } from "../../editor/preferences";
import { DEFAULT_PROFILE } from "../../gamedata/profiles";
import { LOCALES, msg, t, translate } from "../../i18n";
import { Button, Check, Field, IconSelect, Select } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import FlagIcon from "../ui/FlagIcon";
import type { DialogProps } from "./DialogHost";
import { HOTKEYS } from "./hotkeys";
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
      </div>
    ),
    hotkeys: () => <HotkeysPage />,
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
        </div>
        <Hint>{t("What File ▸ New starts with, and the map the editor opens on.")}</Hint>
      </Section>
    </div>
  );
}

/* ── Editing ────────────────────────────────────────────── */

function EditingPage({ w, setW }: { w: Working; setW: (w: Working) => void }) {
  const look = (l: Partial<GridLook>) => setW({ ...w, look: { ...w.look, ...l } });
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

function ViewPage({ w, patch }: { w: Working; patch: (p: Partial<Preferences>) => void }) {
  const p = w.prefs;
  return (
    <div className="stack">
      <Section title={t("Animation")}>
        <Check label={t("Animate water (palette cycling)")} checked={p.animateWater} onChange={(e) => patch({ animateWater: e.target.checked })} />
        <Check label={t("Animate units (idle animations)")} checked={p.animateUnits} onChange={(e) => patch({ animateUnits: e.target.checked })} />
        <div className="form wide" style={{ marginTop: 4 }}>
          <SpeedField label={t("Water speed")} value={p.animateWaterSpeed} onChange={(v) => patch({ animateWaterSpeed: v })} />
          <SpeedField label={t("Unit speed")} value={p.animateUnitsSpeed} onChange={(v) => patch({ animateUnitsSpeed: v })} />
        </div>
        <Hint>{t("The ticks are what the View menu starts with; 1× is the speed the game itself runs at.")}</Hint>
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
              {cleared !== null ? cleared : entries.length === 0 ? t("Nothing is stored in {here}.", { here: host.here }) : t("{bytes} stored in {here}. The open map is never kept here, so it is not affected.", { bytes: bytes(total), here: host.here })}
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

/* ── Hotkeys ────────────────────────────────────────────── */

function HotkeysPage() {
  return (
    <div className="listbox hotkeys" style={{ height: "100%" }}>
      <table className="table">
        <thead>
          <tr>
            <th>{t("Command")}</th>
            <th style={{ width: 240 }}>{t("Shortcut")}</th>
          </tr>
        </thead>
        <tbody>
          {HOTKEYS.map(([cmd, keys]) => (
            <tr key={cmd}>
              <td>{translate(cmd)}</td>
              <td>
                {keys.split(" · ").map((k) => (
                  <span key={k} className="kbd">{k}</span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
