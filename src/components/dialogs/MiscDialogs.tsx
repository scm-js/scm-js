import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  ChevronDown,
  ChevronRight,
  CircleX,
  Database,
  Globe,
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
import type { LanguagePreference, PluginUpdateMode } from "../../editor/preferences";
import { LOCALES, msg, t, translate } from "../../i18n";
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
import { unitLabel } from "../../data/units";
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
  IconSelect,
  ListBox,
  Select,
  Tabs,
  TextInput,
} from "../ui";
import FlagIcon from "../ui/FlagIcon";
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
      rows.push({
        label: translate(STORED_LABELS[key] ?? key),
        detail: key,
        keys: [key],
        size: storedSize(key),
      });
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
function StoredRow({
  entry,
  onClear,
}: {
  entry: StoredEntry;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="stored-entry">
      <div className="item">
        <button
          className="stored-toggle"
          aria-expanded={open}
          title={open ? t("Hide what is stored") : t("Show what is stored")}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Database size={12} className="dim" />
          <span>{entry.label}</span>
        </button>
        <span
          className="grow dim"
          style={{ overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {entry.detail}
        </span>
        <span className="dim">{bytes(entry.size)}</span>
        <Button
          size="sm"
          icon
          variant="ghost"
          title={t("Clear {label}", { label: entry.label })}
          aria-label={t("Clear {label}", { label: entry.label })}
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
function StorageSection({
  onCleared,
}: {
  onCleared: (keys: string[]) => void;
}) {
  const host = hostTerms();
  const clearAll = useSetAtom(clearStoredDataAtom);
  const clearKeys = useSetAtom(clearStoredKeysAtom);
  const [asking, setAsking] = useState<{
    what: string;
    keys: string[] | null;
  } | null>(null);
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
        : t("Cleared {n, plural, one {# entry} other {# entries}}. The default plugins load again.", { n: gone }),
    );
    setRun((n) => n + 1);
    onCleared(asking.keys ?? ownedStoredKeys());
  };
  return (
    <Group title={t("{Noun} storage", { Noun: host.Noun })}>
      <div className="listbox stored-list">
        {entries.length === 0 && <div className="empty">{t("Nothing stored.")}</div>}
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
              {asking.keys ? t("Clear {what}?", { what: asking.what }) : t("Clear the preferences, grid settings, installed plugins and plugin data?")}
            </span>
            <span className="grow" />
            <Button size="sm" onClick={() => setAsking(null)}>
              {t("Cancel")}
            </Button>
            <Button size="sm" variant="danger" onClick={doClear}>
              <Trash2 size={11} /> {" "}{t("Clear")}
            </Button>
          </>
        ) : (
          <>
            <span className="hint">
              {cleared !== null ? cleared : entries.length === 0 ? t("Nothing is stored in {here}.", { here: host.here }) : t("{bytes} stored in {here}. The open map is never kept here, so it is not affected.", { bytes: bytes(total), here: host.here })}
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
              <Trash2 size={11} /> {" "}{t("Clear all data…")}
            </Button>
          </>
        )}
      </div>
      {!storagePersists() && (
        <p className="hint" style={{ marginTop: 4 }}>
          {t("{Here} is not letting the editor store anything, so settings last only until the", { Here: host.Here })}{" "}{host.desktop ? t("app is closed") : t("tab closes")}.
        </p>
      )}
    </Group>
  );
}

/** Preferences ▸ Game data: where the files come from, which data set, and the way to the dialog. */
function GameDataSection() {
  const open = useSetAtom(openDialogAtom);
  const source = useAtomValue(gameDataSourceAtom);
  const set =
    source && source.profile.id !== DEFAULT_PROFILE.id
      ? `${source.profile.name} · `
      : "";
  return (
    <Group title={t("Game data")}>
      <div className="row" style={{ alignItems: "baseline" }}>
        <span className="grow dim">
          {source ? `${set}${source.label}` : t("Locating…")}
        </span>
        <Button size="sm" onClick={() => open("gameData")}>
          <HardDrive size={11} /> {" "}{t("Game Data…")}
        </Button>
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        {source?.kind === "none" ? t("The editor is drawing flat terrain colours and marker units. Game Data… installs StarCraft's graphics.") : t("Where the terrain and unit graphics are coming from. Game Data… is where to change it.")}
      </p>
    </Group>
  );
}

/* ── Preferences ────────────────────────────────────────── */

const HOTKEYS: [string, string][] = [
  ["New / Open / Save", "Ctrl+N · Ctrl+O · Ctrl+S"],
  [msg("Save As"), "Ctrl+Shift+S"],
  [msg("Map Properties"), "Alt+Enter"],
  [msg("Undo / Redo"), "Ctrl+Z · Ctrl+Y or Ctrl+Shift+Z"],
  ["Cut / Copy / Paste", "Ctrl+X · Ctrl+C · Ctrl+V"],
  [msg("Find"), "Ctrl+F"],
  [msg("Toggle grid"), "Ctrl+G"],
  [msg("Zoom in / out / 100%"), "Ctrl++ · Ctrl+− · Ctrl+0"],
  [msg("Zoom to fit"), "Ctrl+Shift+0"],
  ["Layer: Terrain / Doodads / Units", "T · D · U"],
  ["Layer: Sprites / Locations / Fog", "S · L · F"],
  ["Layer: Cut/Copy/Paste", "C"],
  [msg("Brush smaller / larger"), "[ · ]"],
  [msg("Nudge selected locations (snap step / 1 px)"), "Arrows · Shift+Arrows"],
  [msg("Delete selection / stop placing, clear selection"), "Del · Esc"],
  [msg("Cancel a plugin's map pick or tool"), "Esc · right-click"],
  [msg("Trigger Editor"), "Ctrl+T"],
  [msg("Test Map"), "Ctrl+F5"],
  [msg("Next / previous open map (desktop app)"), "Ctrl+Tab · Ctrl+Shift+Tab"],
  [msg("Close map (desktop app)"), "Ctrl+W"],
  [msg("Preferences"), "Ctrl+,"],
  [msg("Keyboard shortcuts"), "F1"],
  [msg("Full screen"), "F11"],
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
          aria-label={t("{label} animation speed", { label })}
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
      title={t("Preferences")}
      icon={<Settings2 size={14} />}
      size="lg"
      tall
      showApply
      onOk={apply}
      footerLeft={
        <Button size="sm" onClick={() => setLocal(DEFAULT_PREFERENCES)}>
          <RotateCcw size={11} /> {" "}{t("Reset to defaults")}
        </Button>
      }
    >
      <Tabs
        className="grow"
        tabs={[
          {
            value: "general",
            label: t("General"),
            content: (
              <div className="stack">
                <Group title={t("Startup")}>
                  <div className="col" style={{ gap: 2 }}>
                    <Check
                      label={t("Show the splash screen while the game data loads")}
                      checked={local.splash}
                      onChange={(e) => patch({ splash: e.target.checked })}
                    />
                  </div>
                  <p className="hint" style={{ marginTop: 4 }}>
                    {t("Off starts straight on the editor; terrain and units fill in as they arrive.")}
                  </p>
                </Group>
                <Group title={t("Open maps")}>
                  <div className="col" style={{ gap: 2 }}>
                    <Check
                      label={t("Open each map in its own tab, keeping the others open")}
                      checked={local.multipleMaps}
                      onChange={(e) => patch({ multipleMaps: e.target.checked })}
                    />
                  </div>
                  <p className="hint" style={{ marginTop: 4 }}>
                    {t("Off opens a map in place of the one that is open, as StarEdit does. Either way the first map opened takes the place of the blank map the editor starts on.")}
                  </p>
                </Group>
                <Group title={t("Unsaved changes")}>
                  <div className="col" style={{ gap: 2 }}>
                    <Check
                      label={t("Ask before closing or replacing a map with unsaved changes")}
                      checked={local.confirmClose}
                      onChange={(e) =>
                        patch({ confirmClose: e.target.checked })
                      }
                    />
                  </div>
                  <p className="hint" style={{ marginTop: 4 }}>
                    {t("Applies to File ▸ Close, to closing a tab, to leaving the editor, and to File ▸ New, Open and a dropped file when they replace the open map.")}
                  </p>
                </Group>
                {isDesktop() && (
                  <Group title={t("Updates")}>
                    <div className="col" style={{ gap: 2 }}>
                      <Check
                        label={t("Check for updates when scmJS starts")}
                        checked={local.updates.checkOnStart}
                        onChange={(e) =>
                          patch({
                            updates: {
                              ...local.updates,
                              checkOnStart: e.target.checked,
                            },
                          })
                        }
                      />
                      <Check
                        label={t("Include nightly builds")}
                        checked={local.updates.nightly}
                        onChange={(e) =>
                          patch({
                            updates: {
                              ...local.updates,
                              nightly: e.target.checked,
                            },
                          })
                        }
                      />
                    </div>
                    <p className="hint" style={{ marginTop: 4 }}>
                      {t("A new version is offered in a notice, never installed on its own. Nightly builds come from the latest commit and are untested; going back to a numbered release means downloading it by hand, since the updater will not offer an older version.")}
                    </p>
                  </Group>
                )}
                <Group title={t("Plugins")}>
                  <div className="form wide">
                    <Field label={t("Plugin updates")}>
                      <Select
                        value={local.plugins.updates}
                        onChange={(e) =>
                          patch({
                            plugins: {
                              ...local.plugins,
                              updates: e.target.value as PluginUpdateMode,
                            },
                          })
                        }
                        options={[
                          { value: "notify", label: t("Tell me") },
                          { value: "manual", label: t("Do nothing") },
                          { value: "auto", label: t("Install them") },
                        ]}
                      />
                    </Field>
                  </div>
                  <p className="hint" style={{ marginTop: 4 }}>
                    {t("What to do when an installed plugin has a newer version.")}{" "}
                    <em>{t("Tell me")}</em> {" "}{t("looks a few seconds after the plugins start and raises a notice with a button to the rows offering the update.")}{" "}<em>{t("Do nothing")}</em> {" "}{t("asks only when you press")}{" "}
                    <em>{t("Check for update")}</em> {" "}{t("on a row.")}{" "}<em>{t("Install them")}</em>{" "}
                    {t("installs what it finds, for the plugins you added; a default moves with scmJS's own releases and is only named in the notice. Whatever the choice, an update pressed on a row shows what it is before anything changes.")}
                  </p>
                </Group>
                <Group title={t("New scenario defaults")}>
                  <div className="form wide">
                    <Field label={t("Tileset")}>
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
                    <Field label={t("Size")}>
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
                    {t("Also the map the editor opens on.")}
                  </p>
                </Group>
                <GameDataSection />
                <StorageSection
                  onCleared={(keys) => {
                    if (keys.includes("scmjs.prefs"))
                      setLocal(DEFAULT_PREFERENCES);
                  }}
                />
              </div>
            ),
          },
          {
            value: "display",
            label: t("Display"),
            content: (
              <div className="stack">
                <Group title={t("Animation on startup")}>
                  <div className="col" style={{ gap: 2 }}>
                    <Check
                      label={t("Animate water (palette cycling)")}
                      checked={local.animateWater}
                      onChange={(e) =>
                        patch({ animateWater: e.target.checked })
                      }
                    />
                    <Check
                      label={t("Animate units (idle animations)")}
                      checked={local.animateUnits}
                      onChange={(e) =>
                        patch({ animateUnits: e.target.checked })
                      }
                    />
                  </div>
                </Group>
                <Group title={t("Animation speed")}>
                  <div className="form wide">
                    <SpeedField
                      label={t("Water")}
                      value={local.animateWaterSpeed}
                      onChange={(v) => patch({ animateWaterSpeed: v })}
                    />
                    <SpeedField
                      label={t("Units")}
                      value={local.animateUnitsSpeed}
                      onChange={(v) => patch({ animateUnitsSpeed: v })}
                    />
                  </div>
                  <p className="hint" style={{ marginTop: 4 }}>
                    {t("1× is the speed the game itself runs at.")}
                  </p>
                </Group>
                <Group title={t("Language")}>
                  <div className="row">
                    <IconSelect
                      value={local.language}
                      aria-label={t("Language")}
                      width={200}
                      options={[
                        { value: "auto", label: hostTerms().desktop ? t("Same as the system") : t("Same as the browser"), icon: <Globe size={13} className="opt-globe" /> },
                        ...LOCALES.map((l) => ({ value: l.id, label: l.label, icon: <FlagIcon locale={l.id} /> })),
                      ]}
                      onChange={(v) => patch({ language: v as LanguagePreference })}
                    />
                  </div>
                  <p className="hint" style={{ marginTop: 4 }}>
                    {t("The editor's own words. A map's text is the map's, whatever language this is.")}
                  </p>
                </Group>
                <Group title={t("Text colours")}>
                  <Check
                    label={t("Preview strings the way 1.16.1 drew them")}
                    title={t("1.16.1 reset the text colour at every line break; Remastered carries it onto the next line. This changes only what the editor draws — never the map.")}
                    checked={local.classicText}
                    onChange={(e) => patch({ classicText: e.target.checked })}
                  />
                  <p className="hint" style={{ marginTop: 4 }}>
                    {t("Every preview of a string follows this — Map Properties, the String Editor, force and unit names, trigger text.")}
                  </p>
                </Group>
              </div>
            ),
          },
          {
            value: "hotkeys",
            label: t("Hotkeys"),
            content: (
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
      title={t("Keyboard Shortcuts")}
      icon={<Keyboard size={14} />}
      size="md"
      footer={
        <Button variant="primary" onClick={() => close(entry.key)}>
          {t("Close")}
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
  const title = only ? t("Validate Triggers") : t("Check Map");

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={title}
      icon={<ShieldCheck size={14} />}
      size="md"
      tall
      footer={
        <>
          <Button onClick={() => setRun((n) => n + 1)}>{t("Re-check")}</Button>
          <Button variant="primary" onClick={() => close(entry.key)}>
            {t("Close")}
          </Button>
        </>
      }
      footerLeft={
        <span>
          {t("{error} error", { error: counts.error })}{counts.error === 1 ? "" : "s"} · {counts.warn}{" "}
          {t("warning")}{counts.warn === 1 ? "" : "s"} {" "}{t("· {info} note", { info: counts.info })}
          {counts.info === 1 ? "" : "s"}
        </span>
      }
    >
      <div className="row">
        <Check
          label={t("Errors")}
          checked={show.error}
          onChange={(e) => setShow({ ...show, error: e.target.checked })}
        />
        <Check
          label={t("Warnings")}
          checked={show.warn}
          onChange={(e) => setShow({ ...show, warn: e.target.checked })}
        />
        <Check
          label={t("Notes")}
          checked={show.info}
          onChange={(e) => setShow({ ...show, info: e.target.checked })}
        />
        <span className="grow" />
        {only && (
          <span className="hint">{t("triggers, briefings and switches only")}</span>
        )}
      </div>
      <div className="listbox grow" style={{ minHeight: 200 }}>
        {!scenario && <div className="empty">{t("Open or create a map first.")}</div>}
        {scenario && listed.length === 0 && (
          <div className="empty">
            {issues.length === 0 ? t("Nothing to report.") : t("Nothing at the selected levels.")}
          </div>
        )}
        {listed.map((i, n) => (
          <div
            key={n}
            className={`issue ${i.level}${i.target ? " jump" : ""}`}
            onDoubleClick={() => i.target && jump(i.target)}
            title={i.target ? t("Double-click to go there") : undefined}
          >
            {LEVEL_ICON[i.level]}
            <span>{i.text}</span>
            <span className="where">{translate(i.where)}</span>
          </div>
        ))}
      </div>
      <p className="hint">
        {t("Double-click an issue to go to the unit, location or dialog it is about.")}
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
      if (spriteKind(r) === "unit") return unitLabel(r.spriteId);
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
      title={t("Find")}
      icon={<Search size={14} />}
      size="sm"
      footer={
        <>
          <Button
            variant="primary"
            disabled={!current}
            onClick={() => current && goTo(current)}
          >
            {t("Go To")}
          </Button>
          <Button onClick={() => close(entry.key)}>{t("Close")}</Button>
        </>
      }
      footerLeft={
        <span>
          {q ? t("{length, plural, one {# result} other {# results}}", { length: results.length }) : t("Type to search")}
        </span>
      }
    >
      <div className="form wide">
        <Field label={t("Find in")}>
          <Select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as FindKind);
              setSel(null);
            }}
            options={FIND_KINDS}
          />
        </Field>
        <Field label={t("Search")}>
          <TextInput
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(null);
            }}
            placeholder={
              kind === "units" ? t("Unit name, id or 'player 3'…") : kind === "triggers" ? t("Text in a trigger, or its number…") : t("Name, number or text…")
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) goTo(results[sel ?? 0]);
            }}
          />
        </Field>
        <Field label={t("Options")}>
          <div className="row wrap">
            <Check
              label={t("Match case")}
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
          !scenario ? t("Open or create a map first.") : q ? t("No matches.") : t("Type to search.")
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
        {t("Double-click or Go To selects the result on the map and switches to its layer.")}
      </p>
    </DialogFrame>
  );
}

/* ── About ──────────────────────────────────────────────── */

const STACK = [
  ["React 19 · TypeScript", msg("the UI; tsc is the type check, oxlint the linter")],
  ["Jotai", msg("every piece of editor state; no context layering")],
  ["Vite 8 · Vitest", msg("dev server, bundler and the test runner")],
  ["Radix UI · lucide-react", msg("dialog and menu primitives, icons")],
  ["Canvas 2D", msg("terrain atlas, sprites, minimap, splash, this background")],
  ["mopaq", "MPQ read and write, PKWARE included, for .scm / .scx"],
  ["Web Workers", msg("the MPQ extraction, and TypeScript for plugin files")],
  [
    "OPFS · IndexedDB · localStorage",
    msg("extracted graphics, file handles, preferences"),
  ],
  [
    "File System Access",
    msg("open and save in place; picker and download fallbacks"),
  ],
  ["Web Audio", msg("imported sounds converted to formats the game reads")],
  ["DecompressionStream", msg("the zip reader, over HTTP range requests")],
  ["Electron · electron-builder", msg("the desktop build")],
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
      title={t("About scmJS")}
      icon={<Info size={14} />}
      size="md"
      tall
      footer={
        <Button variant="primary" onClick={() => close(entry.key)}>
          {t("OK")}
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
          <div className="about-desc">{t("Starcraft 1 Map Editor")}</div>
          <div className="about-rule" />
          <div className="about-meta">
            {t("By Jeany")}{" "}<i>{t("(aka MindArchon)")}</i>
          </div>
        </div>
      </div>

      <div className="about-group">
        <h3>{t("Acknowledgements")}</h3>
        <div className="what" style={{ color: "#ffffff" }}>
          {t("Over the course of thirty years, we've gone from hacking custom versions of StarEdit to understanding the inner workings of the game, the map file format, and creating sophisticated tools through a dedicated community effort.")}
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
        {t("Special thanks (in no particular order)")}
      </div>
      <div className="about-group">
        <div
          className="what"
          style={{ color: "#ffffff", paddingBottom: "10px" }}
        >
          <h4>{t("Clan Unknown")}</h4>
          <div className="about-what">
            {t("Unknown pushed map making to its absolute limit, inspiring map makers to really see what was possible. Thanks to")}{" "}<b>{t("Bolt_Head")}</b>,{" "}
            <b>{t("Kenoli")}</b>, <b>{t("SwaP")}</b>, <b>{t("Shmidley")}</b>, <b>{t("PickleWeezle")}</b> {" "}{t("and everyone else for keeping the clan alive and active.")}
          </div>
        </div>

        <div className="what" style={{ color: "#ffffff" }}>
          <h4>{t("Staredit.net")}</h4>
          <div className="about-what">
            {t("Our map making hub. Thanks to")}{" "}<b>{t("YoshiDaSnipa")}</b>,{" "}
            <b>{t("Shadowflare")}</b>, <b>{t("Heimdal")}</b> {" "}{t("for showing us we can make our own editor,")}{" "}<b>{t("Suicidal Insanity")}</b> {" "}{t("for creating SCMDraft and blowing us all away,")}{" "}<b>{t("Clokr_")}</b> {" "}{t("for their tools,")}{" "}<b>{t("jjf28")}</b> {" "}{t("for finally reverse engineering the sections we didn't understand,")}{" "}
            <b>{t("Heinermann")}</b> {" "}{t("for their technical knowledge,")}{" "}<b>{t("poiuy_qwert")}</b>{" "}
            {t("for their modding tools,")}{" "}<b>{t("Ladislav Zezula")}</b> {" "}{t("for StormLib and showing us we can edit MPQs, and")}{" "}<b>{t("FaRTy1billion")}</b>, <b>{t("rockz")}</b>,{" "}
            <b>{t("yoonkwun")}</b>, <b>{t("trgk")}</b>{t(", and")}{" "}<b>{t("Armoha")}</b> {" "}{t("for their work on EUDs and modern tooling.")}
          </div>
        </div>
      </div>

      <div>
        {t("And of course,")}{" "}<b>{t("Quetz")}</b>{t(", for putting up with me ❤️.")}
      </div>

      <details className="about-details">
        <summary>{t("Under the hood")}</summary>
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
            {t("Reads and writes real")}{" "}<code>.scm</code> / <code>.scx</code>{" "}
            {t("archives. CHK sections the editor does not model are copied back byte for byte, and so are archive members it has no use for, so a map only loses what you deliberately change.")}
          </p>
          <p>
            {t("Terrain and units are drawn from the game's own files. None of Blizzard's data is redistributed here: the editor extracts it from an installed copy of Brood War, or from the free StarEdit download Blizzard still serves, and keeps the result in {here}", { here: hostTerms().here })}{" "}
            {t("for next time.")}
          </p>
          <p>
            {t("There is no server behind any of this — the web build is static files on GitHub Pages, and the one service it talks to is a Cloudflare Worker that adds a CORS header to Blizzard's download. Plugins are fetched from their repositories, compiled in a worker if they are TypeScript, and run with the page's own privileges; there is no sandbox around them.")}
          </p>
          <p>
            {t("The isometric terrain brush is a port of Chkdraft's reverse-engineering of StarEdit (MIT). Palette-cycling tables and tileset names come from Chkdraft as well.")}
          </p>
          <div className="about-links">
            <button
              className="about-link"
              onClick={() => projectPage("/#readme")}
            >
              {t("Docs")}
            </button>
            <button
              className="about-link"
              onClick={() => projectPage("/blob/main/ATTRIBUTION.md")}
            >
              {t("Attribution")}
            </button>
            <button className="about-link" onClick={() => projectPage("")}>
              {t("Source")}
            </button>
          </div>
        </div>
      </details>

      <p className="about-disclaimer">
        {t("StarCraft is a trademark of Blizzard Entertainment. Not affiliated with or endorsed by Blizzard.")}
      </p>
    </DialogFrame>
  );
}
