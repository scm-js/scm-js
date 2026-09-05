import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  ChevronDown,
  ChevronRight,
  CircleX,
  Database,
  HardDrive,
  Info,
  Keyboard,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { closeDialogAtom, openDialogAtom } from "../../atoms/uiAtoms";
import {
  activeLayerAtom,
  centerViewOnAtom,
  selectedDoodadsAtom,
  selectedSpritesAtom,
  selectedUnitsAtom,
} from "../../atoms/editorAtoms";
import { peekTileset } from "../../formats/tileset/load";
import { desktopBridge } from "../../gamedata/desktop";
import { hostTerms, isDesktop } from "../../editor/platform";
import { APP_VERSION } from "../../version";
import { tilesetFileNameAtom } from "../../atoms/documentAtoms";
import { doodadLabel } from "../../hooks/useDoodadTools";
import { MAP_SIZES, TILESETS, type TilesetId } from "../../data/tilesets";
import type { PluginUpdateMode } from "../../editor/preferences";
import {
  archiveExtrasAtom,
  doodadsRevisionAtom,
  locationsRevisionAtom,
  scenarioAtom,
  settingsRevisionAtom,
  triggersRevisionAtom,
  unitsRevisionAtom,
} from "../../atoms/documentAtoms";
import { gameDataSourceAtom } from "../../atoms/gameDataAtoms";
import { DEFAULT_PROFILE } from "../../gamedata/profiles";
import {
  ANIMATION_SPEEDS,
  animationSpeedIndex,
  clearStoredDataAtom,
  clearStoredKeysAtom,
  DEFAULT_PREFERENCES,
  ownedStoredKeys,
  preferencesAtom,
  type Preferences,
} from "../../atoms/preferencesAtoms";
import {
  STORAGE_PREFIX,
  storagePersists,
  storedKeys,
  storedSize,
  storedValue,
} from "../../atoms/storage";
import { unitName } from "../../data/units";
import { spriteCatalogue } from "../../data/sprites";
import {
  findInScenario,
  FIND_KINDS,
  type FindKind,
  type FindResult,
} from "../../editor/find";
import { spriteKind } from "../../editor/sprites";
import { TILE_PX } from "../../editor/units";
import {
  issueCounts,
  triggerIssues,
  validateScenario,
  type IssueLevel,
  type IssueTarget,
} from "../../editor/validate";
import type {
  DoodadRecord,
  SpriteRecord,
} from "../../formats/chk/sections/objects";
import { useIsomStatus } from "../../hooks/useIsom";
import { useLocationTools } from "../../hooks/useLocationTools";
import { useUnitAssets } from "../../hooks/useUnitAssets";
import {
  Button,
  Check,
  Field,
  Group,
  ListBox,
  Select,
  Tabs,
  TextInput,
} from "../ui";
import WireSphere from "../ui/WireSphere";
import { drawNebula, drawStars, generateStars } from "../splash/starfield";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

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
  "scmjs.prefs": "Preferences",
  "scmjs.grid": "Grid look",
  "scmjs.gridSize": "Grid spacing",
  "scmjs.locationSnap": "Location snap",
  "scmjs.placement": "Unit placement options",
  "scmjs.doodadPlacement": "Doodad placement options",
  "scmjs.panels": "Panels shown",
  "scmjs.docks": "Panel widths",
  "scmjs.recents": "Recent files",
  "scmjs.plugins": "Installed plugins",
  "scmjs.plugin-code": "Plugin code copies",
  "scmjs.plugin-manifests": "Plugin manifests",
  "scmjs.plugin-registries": "Plugin sources",
  "scmjs.plugin-registry": "Browse Plugins cache",
  "scmjs.plugin-updates": "Last plugin update check",
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
      rows.push({
        label: STORED_LABELS[key] ?? key,
        detail: key,
        keys: [key],
        size: storedSize(key),
      });
    }
  }
  for (const [id, keys] of [...byPlugin].sort(([a], [b]) => a.localeCompare(b)))
    rows.push({
      label: `Plugin data · ${id}`,
      detail: `${keys.length} entr${keys.length === 1 ? "y" : "ies"} kept by the plugin`,
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
        <button
          className="stored-toggle"
          aria-expanded={open}
          title={open ? "Hide what is stored" : "Show what is stored"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Database size={12} className="dim" />
          <span>{entry.label}</span>
        </button>
        <span className="grow dim" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {entry.detail}
        </span>
        <span className="dim">{bytes(entry.size)}</span>
        <Button
          size="sm"
          icon
          variant="ghost"
          title={`Clear ${entry.label}`}
          aria-label={`Clear ${entry.label}`}
          onClick={onClear}
        >
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
 * Preferences ▸ General ▸ storage: what the editor is keeping here, and the buttons that
 * throw it away — one row at a time (`clearStoredKeysAtom`) or the lot
 * (`clearStoredDataAtom`). Both reset the atom behind a key as well as removing it, so a
 * cleared setting goes back to its default live rather than at the next reload. Confirming
 * happens in place rather than through a second dialog, since nothing about the open map is
 * at stake; `onCleared` is told which keys went, so the dialog can put its working copy back
 * on the defaults when the preferences were among them — otherwise pressing OK afterwards
 * would write the old ones straight back.
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
    setCleared(
      asking.keys
        ? `Cleared ${asking.what}.`
        : `Cleared ${gone} entr${gone === 1 ? "y" : "ies"}. The default plugins load again.`,
    );
    setRun((n) => n + 1);
    onCleared(asking.keys ?? ownedStoredKeys());
  };
  return (
    <Group title={`${host.Noun} storage`}>
      <div className="listbox stored-list">
        {entries.length === 0 && <div className="empty">Nothing stored.</div>}
        {entries.map((e) => (
          <StoredRow
            key={e.detail}
            entry={e}
            onClear={() => {
              setCleared(null);
              setAsking({ what: e.label, keys: e.keys });
            }}
          />
        ))}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        {asking ? (
          <>
            <span className="hint">
              {asking.keys
                ? `Clear ${asking.what}?`
                : "Clear the preferences, grid settings, installed plugins and plugin data?"}
            </span>
            <span className="grow" />
            <Button size="sm" onClick={() => setAsking(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={doClear}>
              <Trash2 size={11} /> Clear
            </Button>
          </>
        ) : (
          <>
            <span className="hint">
              {cleared !== null
                ? cleared
                : entries.length === 0
                  ? `Nothing is stored in ${host.here}.`
                  : `${bytes(total)} stored in ${host.here}. The open map is never kept here, so it is not affected.`}
            </span>
            <span className="grow" />
            <Button
              size="sm"
              variant="danger"
              disabled={entries.length === 0}
              onClick={() => {
                setCleared(null);
                setAsking({ what: "everything", keys: null });
              }}
            >
              <Trash2 size={11} /> Clear all data…
            </Button>
          </>
        )}
      </div>
      {!storagePersists() && (
        <p className="hint" style={{ marginTop: 4 }}>
          {host.Here} is not letting the editor store anything, so settings last
          only until the {host.desktop ? "app is closed" : "tab closes"}.
        </p>
      )}
    </Group>
  );
}

/** Preferences ▸ Game data: where the files come from, which data set, and the way to the dialog. */
function GameDataSection() {
  const open = useSetAtom(openDialogAtom);
  const source = useAtomValue(gameDataSourceAtom);
  const set = source && source.profile.id !== DEFAULT_PROFILE.id ? `${source.profile.name} · ` : "";
  return (
    <Group title="Game data">
      <div className="row" style={{ alignItems: "baseline" }}>
        <span className="grow dim">{source ? `${set}${source.label}` : "Locating…"}</span>
        <Button size="sm" onClick={() => open("gameData")}>
          <HardDrive size={11} /> Game Data…
        </Button>
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        {source?.kind === "none"
          ? "The editor is drawing flat terrain colours and marker units. Game Data… installs StarCraft's graphics."
          : "Where the terrain and unit graphics are coming from. Game Data… is where to change it."}
      </p>
    </Group>
  );
}

/* ── Preferences ────────────────────────────────────────── */

const HOTKEYS: [string, string][] = [
  ["New / Open / Save", "Ctrl+N · Ctrl+O · Ctrl+S"],
  ["Save As", "Ctrl+Shift+S"],
  ["Map Properties", "Alt+Enter"],
  ["Undo / Redo", "Ctrl+Z · Ctrl+Y or Ctrl+Shift+Z"],
  ["Cut / Copy / Paste", "Ctrl+X · Ctrl+C · Ctrl+V"],
  ["Find", "Ctrl+F"],
  ["Toggle grid", "Ctrl+G"],
  ["Zoom in / out / 100%", "Ctrl++ · Ctrl+− · Ctrl+0"],
  ["Zoom to fit", "Ctrl+Shift+0"],
  ["Layer: Terrain / Doodads / Units", "T · D · U"],
  ["Layer: Sprites / Locations / Fog", "S · L · F"],
  ["Layer: Cut/Copy/Paste", "C"],
  ["Brush smaller / larger", "[ · ]"],
  ["Nudge selected locations (snap step / 1 px)", "Arrows · Shift+Arrows"],
  ["Delete selection / stop placing, clear selection", "Del · Esc"],
  ["Cancel a plugin's map pick or tool", "Esc · right-click"],
  ["Trigger Editor", "Ctrl+T"],
  ["Text Trigger Editor", "Ctrl+Shift+T"],
  ["Test Map", "Ctrl+F5"],
  ["Preferences", "Ctrl+,"],
  ["Keyboard shortcuts", "F1"],
  ["Full screen", "F11"],
];

/** One animation-speed slider: the range picks a step of `ANIMATION_SPEEDS`. */
function SpeedField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const index = animationSpeedIndex(value);
  return (
    <Field label={label}>
      <div className="row">
        <input
          type="range"
          min={0}
          max={ANIMATION_SPEEDS.length - 1}
          value={index}
          onChange={(e) => onChange(ANIMATION_SPEEDS[Number(e.target.value)])}
          aria-label={`${label} animation speed`}
        />
        <span className="mono hint" style={{ width: 44 }}>
          {ANIMATION_SPEEDS[index]}×
        </span>
      </div>
    </Field>
  );
}

/**
 * Edit ▸ Preferences: persisted in localStorage (atoms/preferencesAtoms.ts). Only
 * settings something reads are listed; the Hotkeys tab is a reference.
 */
export function PreferencesDialog({ entry }: DialogProps) {
  const [prefs, setPrefs] = useAtom(preferencesAtom);
  const [local, setLocal] = useState<Preferences>(prefs);
  const patch = (p: Partial<Preferences>) => setLocal({ ...local, ...p });
  const newMap = (p: Partial<Preferences["newMap"]>) =>
    patch({ newMap: { ...local.newMap, ...p } });
  const apply = () => setPrefs(local);
  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Preferences"
      icon={<Settings2 size={14} />}
      size="lg"
      tall
      showApply
      onOk={apply}
      footerLeft={
        <Button size="sm" onClick={() => setLocal(DEFAULT_PREFERENCES)}>
          <RotateCcw size={11} /> Reset to defaults
        </Button>
      }
    >
      <Tabs
        className="grow"
        tabs={[
          {
            value: "general",
            label: "General",
            content: (
              <div className="stack">
                <Group title="Startup">
                  <div className="col" style={{ gap: 2 }}>
                    <Check
                      label="Show the splash screen while the game data loads"
                      checked={local.splash}
                      onChange={(e) => patch({ splash: e.target.checked })}
                    />
                  </div>
                  <p className="hint" style={{ marginTop: 4 }}>
                    Off starts straight on the editor; terrain and units fill in
                    as they arrive.
                  </p>
                </Group>
                <Group title="Unsaved changes">
                  <div className="col" style={{ gap: 2 }}>
                    <Check
                      label="Ask before closing or replacing a map with unsaved changes"
                      checked={local.confirmClose}
                      onChange={(e) =>
                        patch({ confirmClose: e.target.checked })
                      }
                    />
                  </div>
                  <p className="hint" style={{ marginTop: 4 }}>
                    Applies to File ▸ New, Open, Close and a file dropped on the
                    window.
                  </p>
                </Group>
                {isDesktop() && (
                  <Group title="Updates">
                    <div className="col" style={{ gap: 2 }}>
                      <Check
                        label="Check for updates when scmJS starts"
                        checked={local.updates.checkOnStart}
                        onChange={(e) => patch({ updates: { ...local.updates, checkOnStart: e.target.checked } })}
                      />
                      <Check
                        label="Include nightly builds"
                        checked={local.updates.nightly}
                        onChange={(e) => patch({ updates: { ...local.updates, nightly: e.target.checked } })}
                      />
                    </div>
                    <p className="hint" style={{ marginTop: 4 }}>
                      A new version is offered in a notice, never installed on its own.
                      Nightly builds come from the latest commit and are untested; going back
                      to a numbered release means downloading it by hand, since the updater
                      will not offer an older version.
                    </p>
                  </Group>
                )}
                <Group title="Plugins">
                  <div className="form wide">
                    <Field label="Plugin updates">
                      <Select
                        value={local.plugins.updates}
                        onChange={(e) => patch({ plugins: { ...local.plugins, updates: e.target.value as PluginUpdateMode } })}
                        options={[
                          { value: "notify", label: "Tell me" },
                          { value: "manual", label: "Do nothing" },
                          { value: "auto", label: "Install them" },
                        ]}
                      />
                    </Field>
                  </div>
                  <p className="hint" style={{ marginTop: 4 }}>
                    What to do when an installed plugin has a newer version.{" "}
                    <em>Tell me</em> looks a few seconds after the plugins start and raises a
                    notice with a button to the rows offering the update.{" "}
                    <em>Do nothing</em> asks only when you press <em>Check for update</em> on a row.{" "}
                    <em>Install them</em> installs what it finds, for the plugins you added;
                    a default moves with scmJS's own releases and is only named in the
                    notice. Whatever the choice, an update pressed on a row shows what it
                    is before anything changes.
                  </p>
                </Group>
                <Group title="New scenario defaults">
                  <div className="form wide">
                    <Field label="Tileset">
                      <Select
                        value={local.newMap.tileset}
                        onChange={(e) =>
                          newMap({ tileset: e.target.value as TilesetId })
                        }
                        options={TILESETS.map((t) => ({
                          value: t.id,
                          label: t.name,
                        }))}
                      />
                    </Field>
                    <Field label="Size">
                      <div className="row">
                        <Select
                          style={{ width: 90 }}
                          value={String(local.newMap.width)}
                          onChange={(e) =>
                            newMap({ width: Number(e.target.value) })
                          }
                          options={MAP_SIZES.map(String)}
                        />
                        <span className="dim">×</span>
                        <Select
                          style={{ width: 90 }}
                          value={String(local.newMap.height)}
                          onChange={(e) =>
                            newMap({ height: Number(e.target.value) })
                          }
                          options={MAP_SIZES.map(String)}
                        />
                      </div>
                    </Field>
                  </div>
                  <p className="hint" style={{ marginTop: 4 }}>
                    Also the map the editor opens on.
                  </p>
                </Group>
                <GameDataSection />
                <StorageSection
                  onCleared={(keys) => {
                    if (keys.includes("scmjs.prefs")) setLocal(DEFAULT_PREFERENCES);
                  }}
                />
              </div>
            ),
          },
          {
            value: "display",
            label: "Display",
            content: (
              <div className="stack">
                <Group title="Animation on startup">
                  <div className="col" style={{ gap: 2 }}>
                    <Check
                      label="Animate water (palette cycling)"
                      checked={local.animateWater}
                      onChange={(e) =>
                        patch({ animateWater: e.target.checked })
                      }
                    />
                    <Check
                      label="Animate units (idle animations)"
                      checked={local.animateUnits}
                      onChange={(e) =>
                        patch({ animateUnits: e.target.checked })
                      }
                    />
                  </div>
                </Group>
                <Group title="Animation speed">
                  <div className="form wide">
                    <SpeedField
                      label="Water"
                      value={local.animateWaterSpeed}
                      onChange={(v) => patch({ animateWaterSpeed: v })}
                    />
                    <SpeedField
                      label="Units"
                      value={local.animateUnitsSpeed}
                      onChange={(v) => patch({ animateUnitsSpeed: v })}
                    />
                  </div>
                  <p className="hint" style={{ marginTop: 4 }}>
                    1× is the speed the game itself runs at.
                  </p>
                </Group>
                <Group title="Text colours">
                  <Check
                    label="Preview strings the way 1.16.1 drew them"
                    title="1.16.1 reset the text colour at every line break; Remastered carries it onto the next line. This changes only what the editor draws — never the map."
                    checked={local.classicText}
                    onChange={(e) => patch({ classicText: e.target.checked })}
                  />
                  <p className="hint" style={{ marginTop: 4 }}>
                    Every preview of a string follows this — Map Properties, the String
                    Editor, force and unit names, trigger text.
                  </p>
                </Group>
              </div>
            ),
          },
          {
            value: "hotkeys",
            label: "Hotkeys",
            content: (
              <div className="listbox hotkeys" style={{ height: "100%" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Command</th>
                      <th style={{ width: 240 }}>Shortcut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {HOTKEYS.map(([cmd, keys]) => (
                      <tr key={cmd}>
                        <td>{cmd}</td>
                        <td>
                          {keys.split(" · ").map((k) => (
                            <span key={k} className="kbd">
                              {k}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
          },
        ]}
      />
    </DialogFrame>
  );
}

/* ── Shortcuts ──────────────────────────────────────────── */

export function ShortcutsDialog({ entry }: DialogProps) {
  const close = useSetAtom(closeDialogAtom);
  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Keyboard Shortcuts"
      icon={<Keyboard size={14} />}
      size="md"
      footer={
        <Button variant="primary" onClick={() => close(entry.key)}>
          Close
        </Button>
      }
    >
      <div className="listbox hotkeys" style={{ maxHeight: 420 }}>
        <table className="table">
          <tbody>
            {HOTKEYS.map(([cmd, keys]) => (
              <tr key={cmd}>
                <td>{cmd}</td>
                <td style={{ textAlign: "right" }}>
                  {keys.split(" · ").map((k) => (
                    <span key={k} className="kbd">
                      {k}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DialogFrame>
  );
}

/* ── Validate Map ───────────────────────────────────────── */

const LEVEL_ICON: Record<IssueLevel, ReactNode> = {
  error: <CircleX size={13} />,
  warn: <TriangleAlert size={13} />,
  info: <Info size={13} />,
};

/** Where a target lives, so the go-to switches to the right layer. */
type Jump = (target: IssueTarget) => void;

/** Selecting and centring on units / locations / sprites / triggers, shared by Check Map and Find. */
function useJump(closeKey: number): Jump {
  const close = useSetAtom(closeDialogAtom);
  const open = useSetAtom(openDialogAtom);
  const setLayer = useSetAtom(activeLayerAtom);
  const setSelectedUnits = useSetAtom(selectedUnitsAtom);
  const setCenter = useSetAtom(centerViewOnAtom);
  const scenario = useAtomValue(scenarioAtom);
  const locationTools = useLocationTools();
  return (target) => {
    switch (target.kind) {
      case "location":
        locationTools.select([target.index]);
        locationTools.centerOn(target.index);
        setLayer("locations");
        close(closeKey);
        break;
      case "unit": {
        const u = scenario?.units[target.index];
        if (!u) return;
        setSelectedUnits([target.index]);
        setCenter({ x: u.x / TILE_PX, y: u.y / TILE_PX });
        setLayer("units");
        close(closeKey);
        break;
      }
      case "trigger":
        open("triggerEditor", { index: target.index });
        close(closeKey);
        break;
      case "dialog":
        open(target.id);
        close(closeKey);
        break;
    }
  };
}

/**
 * Tools ▸ Check Map (editor/validate.ts). `payload.only === "triggers"` is Triggers ▸
 * Validate Triggers: the same run, filtered to what concerns the trigger list.
 */
export function ValidateMapDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  const extras = useAtomValue(archiveExtrasAtom);
  useAtomValue(settingsRevisionAtom);
  useAtomValue(triggersRevisionAtom);
  useAtomValue(unitsRevisionAtom);
  useAtomValue(locationsRevisionAtom);
  const isom = useIsomStatus();
  const close = useSetAtom(closeDialogAtom);
  const jump = useJump(entry.key);
  const only = entry.payload?.only === "triggers";
  const [show, setShow] = useState<Record<IssueLevel, boolean>>({
    error: true,
    warn: true,
    info: true,
  });
  const [run, setRun] = useState(0);
  const issues = useMemo(() => {
    void run;
    if (!scenario) return [];
    const all = validateScenario(scenario, { extras, isom });
    return only ? triggerIssues(all) : all;
  }, [scenario, extras, isom, only, run]);
  const counts = issueCounts(issues);
  const listed = issues.filter((i) => show[i.level]);
  const title = only ? "Validate Triggers" : "Check Map";

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={title}
      icon={<ShieldCheck size={14} />}
      size="md"
      tall
      footer={
        <>
          <Button onClick={() => setRun((n) => n + 1)}>Re-check</Button>
          <Button variant="primary" onClick={() => close(entry.key)}>
            Close
          </Button>
        </>
      }
      footerLeft={
        <span>
          {counts.error} error{counts.error === 1 ? "" : "s"} · {counts.warn}{" "}
          warning{counts.warn === 1 ? "" : "s"} · {counts.info} note
          {counts.info === 1 ? "" : "s"}
        </span>
      }
    >
      <div className="row">
        <Check
          label="Errors"
          checked={show.error}
          onChange={(e) => setShow({ ...show, error: e.target.checked })}
        />
        <Check
          label="Warnings"
          checked={show.warn}
          onChange={(e) => setShow({ ...show, warn: e.target.checked })}
        />
        <Check
          label="Notes"
          checked={show.info}
          onChange={(e) => setShow({ ...show, info: e.target.checked })}
        />
        <span className="grow" />
        {only && (
          <span className="hint">triggers, briefings and switches only</span>
        )}
      </div>
      <div className="listbox grow" style={{ minHeight: 200 }}>
        {!scenario && <div className="empty">Open or create a map first.</div>}
        {scenario && listed.length === 0 && (
          <div className="empty">
            {issues.length === 0
              ? "Nothing to report."
              : "Nothing at the selected levels."}
          </div>
        )}
        {listed.map((i, n) => (
          <div
            key={n}
            className={`issue ${i.level}${i.target ? " jump" : ""}`}
            onDoubleClick={() => i.target && jump(i.target)}
            title={i.target ? "Double-click to go there" : undefined}
          >
            {LEVEL_ICON[i.level]}
            <span>{i.text}</span>
            <span className="where">{i.where}</span>
          </div>
        ))}
      </div>
      <p className="hint">
        Double-click an issue to go to the unit, location or dialog it is about.
      </p>
    </DialogFrame>
  );
}

/* ── Find ───────────────────────────────────────────────── */

/** Edit ▸ Find (editor/find.ts): search units, locations, sprites, strings or triggers; Go To selects and centres. */
export function FindDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(unitsRevisionAtom);
  useAtomValue(doodadsRevisionAtom);
  useAtomValue(locationsRevisionAtom);
  useAtomValue(settingsRevisionAtom);
  useAtomValue(triggersRevisionAtom);
  const { loaded: assets } = useUnitAssets();
  const open = useSetAtom(openDialogAtom);
  const close = useSetAtom(closeDialogAtom);
  const setLayer = useSetAtom(activeLayerAtom);
  const setSelectedSprites = useSetAtom(selectedSpritesAtom);
  const setSelectedDoodads = useSetAtom(selectedDoodadsAtom);
  const setCenter = useSetAtom(centerViewOnAtom);
  const tilesetName = useAtomValue(tilesetFileNameAtom);
  const jump = useJump(entry.key);
  const [kind, setKind] = useState<FindKind>("units");
  const [q, setQ] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const catalogue = useMemo(
    () => (assets ? spriteCatalogue(assets) : null),
    [assets],
  );
  const results = useMemo(() => {
    if (!scenario) return [];
    const spriteName = (r: SpriteRecord) => {
      if (spriteKind(r) === "unit") return unitName(r.spriteId);
      return catalogue?.entries[r.spriteId]?.label ?? `Sprite #${r.spriteId}`;
    };
    const doodads = peekTileset(tilesetName)?.doodads;
    const doodadName = (d: DoodadRecord) => {
      const def = doodads?.byId.get(d.doodadId);
      return def ? doodadLabel(def) : `Doodad #${d.doodadId}`;
    };
    return findInScenario(scenario, {
      kind,
      query: q,
      matchCase,
      spriteName,
      doodadName,
    });
  }, [scenario, kind, q, matchCase, catalogue, tilesetName]);

  const goTo = (r: FindResult) => {
    switch (r.kind) {
      case "units":
        jump({ kind: "unit", index: r.index });
        break;
      case "locations":
        jump({ kind: "location", index: r.index });
        break;
      case "triggers":
        jump({ kind: "trigger", index: r.index });
        break;
      case "briefing":
        open("missionBriefing", { index: r.index });
        close(entry.key);
        break;
      case "strings":
        open("stringEditor", { index: r.index });
        close(entry.key);
        break;
      case "sprites":
        setSelectedSprites([r.index]);
        if (r.x !== undefined && r.y !== undefined)
          setCenter({ x: r.x, y: r.y });
        setLayer("sprites");
        close(entry.key);
        break;
      case "doodads":
        setSelectedDoodads([r.index]);
        if (r.x !== undefined && r.y !== undefined)
          setCenter({ x: r.x, y: r.y });
        setLayer("doodads");
        close(entry.key);
        break;
    }
  };
  const current = sel !== null ? results[sel] : undefined;

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Find"
      icon={<Search size={14} />}
      size="sm"
      footer={
        <>
          <Button
            variant="primary"
            disabled={!current}
            onClick={() => current && goTo(current)}
          >
            Go To
          </Button>
          <Button onClick={() => close(entry.key)}>Close</Button>
        </>
      }
      footerLeft={
        <span>
          {q
            ? `${results.length} result${results.length === 1 ? "" : "s"}`
            : "Type to search"}
        </span>
      }
    >
      <div className="form wide">
        <Field label="Find in">
          <Select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as FindKind);
              setSel(null);
            }}
            options={FIND_KINDS}
          />
        </Field>
        <Field label="Search">
          <TextInput
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(null);
            }}
            placeholder={
              kind === "units"
                ? "Unit name, id or 'player 3'…"
                : kind === "triggers"
                  ? "Text in a trigger, or its number…"
                  : "Name, number or text…"
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) goTo(results[sel ?? 0]);
            }}
          />
        </Field>
        <Field label="Options">
          <div className="row wrap">
            <Check
              label="Match case"
              checked={matchCase}
              onChange={(e) => setMatchCase(e.target.checked)}
            />
          </div>
        </Field>
      </div>
      <ListBox
        items={results}
        selected={sel}
        onSelect={(i) => setSel(i)}
        style={{ height: 200 }}
        empty={
          !scenario
            ? "Open or create a map first."
            : q
              ? "No matches."
              : "Type to search."
        }
        render={(r) => (
          <>
            <span className="idx">
              {r.kind === "triggers" || r.kind === "briefing"
                ? r.index + 1
                : r.index}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {r.label}
            </span>
            <span
              className="faint"
              style={{
                marginLeft: "auto",
                paddingLeft: 8,
                whiteSpace: "nowrap",
              }}
            >
              {r.detail}
            </span>
          </>
        )}
      />
      <p className="hint">
        Double-click or Go To selects the result on the map and switches to its
        layer.
      </p>
    </DialogFrame>
  );
}

/* ── About ──────────────────────────────────────────────── */

const STACK = [
  ["React 19 · TypeScript", "the UI; tsc is the type check, oxlint the linter"],
  ["Jotai", "every piece of editor state; no context layering"],
  ["Vite 8 · Vitest", "dev server, bundler and the test runner"],
  ["Radix UI · lucide-react", "dialog and menu primitives, icons"],
  ["Canvas 2D", "terrain atlas, sprites, minimap, splash, this background"],
  ["mopaq", "MPQ read and write, PKWARE included, for .scm / .scx"],
  ["Web Workers", "the MPQ extraction, and TypeScript for plugin files"],
  ["OPFS · IndexedDB · localStorage", "extracted graphics, file handles, preferences"],
  ["File System Access", "open and save in place; picker and download fallbacks"],
  ["Web Audio", "imported sounds converted to formats the game reads"],
  ["DecompressionStream", "the zip reader, over HTTP range requests"],
  ["Electron · electron-builder", "the desktop build"],
];

export function AboutDialog({ entry }: DialogProps) {
  const close = useSetAtom(closeDialogAtom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projectPage = (path: string) =>
    window.open(
      `https://github.com/scm-js/scm-js${path}`,
      "_blank",
      "noopener,noreferrer",
    );

  // Same drifting nebula and starfield the splash screen paints, at dialog scale.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const stars = generateStars(70);
    let raf = 0;
    let start = 0;
    const frame = (t: number) => {
      if (!start) start = t;
      const el = t - start;
      const cw = canvas.clientWidth,
        ch = canvas.clientHeight;
      if (cw && ch) {
        const w = Math.round(cw * devicePixelRatio),
          h = Math.round(ch * devicePixelRatio);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        drawNebula(ctx, cw, ch, el);
        drawStars(ctx, cw, ch, el, stars);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="About scmJS"
      icon={<Info size={14} />}
      size="md"
      tall
      footer={
        <Button variant="primary" onClick={() => close(entry.key)}>
          OK
        </Button>
      }
    >
      <div className="about-space">
        <canvas ref={canvasRef} className="about-canvas" />
        <div className="about-content">
          <WireSphere size={104} className="about-logo" />
          <h2 className="about-app-name">
            scm<span>JS</span>
          </h2>
          <div>
            {desktopBridge()
              ? `${desktopBridge()!.platform} · ${APP_VERSION}`
              : APP_VERSION}
          </div>
          {/* <div className="about-tagline">
            StarCraft · Brood War · Remastered
          </div> */}
          <div className="about-desc">Starcraft 1 Map Editor</div>
          <div className="about-rule" />
          <div className="about-meta">
            By Jeany <i>(aka MindArchon)</i>
          </div>
        </div>
      </div>

      <div className="about-group">
        <h3>Acknowledgements</h3>
        <div className="what" style={{ color: "#ffffff" }}>
          Over the course of thirty years, we've gone from hacking custom
          versions of StarEdit to understanding the inner workings of the game,
          the map file format, and creating sophisticated tools through a
          dedicated community effort.
        </div>

        {/* {CREDITS.map((group) => (
            <section key={group.title} className="about-group">
              <h3>{group.title}</h3>
              {group.note && <p className="about-note">{group.note}</p>}
              <ul>
                {group.people.map((p) => (
                  <li key={p.who}>
                    <span className="who">
                      {p.who}
                      {p.real && <em> · {p.real}</em>}
                    </span>
                    <span className="what">{p.what}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))} */}
        {/* <section className="about-group about-thanks">
          <h3>Special thanks</h3>
          <ul>
            {THANKS.map((t) => (
              <li key={t.who}>
                <span className="who">{t.who}</span>
                <span className="what">{t.what}</span>
              </li>
            ))}
          </ul>
        </section> */}
      </div>

      <div
        className="about-group"
        style={{ fontWeight: 600, color: "#ff5fa2" }}
      >
        Special thanks (in no particular order)
      </div>
      <div className="about-group">
        <div
          className="what"
          style={{ color: "#ffffff", paddingBottom: "10px" }}
        >
          <h4>Clan Unknown</h4>
          <div className="about-what">
            Unknown pushed map making to its absolute limit, inspiring map
            makers to really see what was possible. Thanks to <b>Bolt_Head</b>,{" "}
            <b>Kenoli</b>, <b>SwaP</b>, <b>Shmidley</b>, <b>PickleWeezle</b> and
            everyone else for keeping the clan alive and active.
          </div>
        </div>

        <div className="what" style={{ color: "#ffffff" }}>
          <h4>Staredit.net</h4>
          <div className="about-what">
            Our map making hub. Thanks to <b>YoshiDaSnipa</b>,{" "}
            <b>Shadowflare</b>, <b>Heimdal</b> for showing us we can make our
            own editor, <b>Suicidal Insanity</b> for creating SCMDraft and
            blowing us all away, <b>Clokr_</b> for their tools, <b>jjf28</b> for
            finally reverse engineering the sections we didn't understand,{" "}
            <b>Heinermann</b> for their technical knowledge, <b>poiuy_qwert</b>{" "}
            for their modding tools, <b>Ladislav Zezula</b> for StormLib and
            showing us we can edit MPQs, and <b>FaRTy1billion</b>, <b>rockz</b>,{" "}
            <b>yoonkwun</b>, <b>trgk</b>, and <b>Armoha</b> for their work on
            EUDs and modern tooling.
          </div>
        </div>
      </div>

      <details className="about-details">
        <summary>Under the hood</summary>
        <div className="about-details-body">
          <dl className="about-stack">
            {STACK.map(([name, note]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{note}</dd>
              </div>
            ))}
          </dl>
          <p>
            Reads and writes real <code>.scm</code> / <code>.scx</code>{" "}
            archives. CHK sections the editor does not model are copied back
            byte for byte, and so are archive members it has no use for, so a
            map only loses what you deliberately change.
          </p>
          <p>
            Terrain and units are drawn from the game's own files. None of
            Blizzard's data is redistributed here: the editor extracts it from
            an installed copy of Brood War, or from the free StarEdit download
            Blizzard still serves, and keeps the result in {hostTerms().here} for
            next time.
          </p>
          <p>
            There is no server behind any of this — the web build is static
            files on GitHub Pages, and the one service it talks to is a
            Cloudflare Worker that adds a CORS header to Blizzard's download.
            Plugins are fetched from their repositories, compiled in a worker if
            they are TypeScript, and run with the page's own privileges; there
            is no sandbox around them.
          </p>
          <p>
            The isometric terrain brush is a port of Chkdraft's
            reverse-engineering of StarEdit (MIT). Palette-cycling tables and
            tileset names come from Chkdraft as well.
          </p>
          <div className="about-links">
            <button
              className="about-link"
              onClick={() => projectPage("/#readme")}
            >
              Docs
            </button>
            <button
              className="about-link"
              onClick={() => projectPage("/blob/main/ATTRIBUTION.md")}
            >
              Attribution
            </button>
            <button className="about-link" onClick={() => projectPage("")}>
              Source
            </button>
          </div>
        </div>
      </details>

      <p className="about-disclaimer">
        StarCraft is a trademark of Blizzard Entertainment. Not affiliated with
        or endorsed by Blizzard.
      </p>
    </DialogFrame>
  );
}
