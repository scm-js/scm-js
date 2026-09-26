/**
 * The editor's rebindable commands: what each one is called, the keys it starts on, and
 * where it may fire. Pure data and pure functions — `hooks/useHotkeys.ts` supplies what
 * each command does, Preferences ▸ Hotkeys edits `Preferences.hotkeys` (only the commands
 * the user changed), and the menus, the toolbar and F1 read their shortcut labels from
 * `resolveHotkeys`, so there is one list of bindings rather than four.
 *
 * A combo is the modifiers in the order `Ctrl+Alt+Shift`, then the key: `Ctrl+Shift+S`,
 * `Alt+Enter`, `F1`, `[`. Cmd on a Mac counts as Ctrl. Letters and digits are read from the
 * character when it is one (so AZERTY's Ctrl+A is Ctrl+A), and from the physical key
 * otherwise (so Ctrl+Shift+0 is not Ctrl+Shift+) and a Hangul layout's Ctrl+S is Ctrl+S).
 * The `+` key is `Plus`, since `+` joins the parts.
 *
 * Delete, Escape and the arrows are not here: what they do depends on the layer and on
 * what is selected or being placed, and they stay in `useHotkeys` as they are.
 */
import { msg } from "../i18n";

export type CommandGroup = "file" | "edit" | "view" | "layers" | "tools" | "window" | "help";

export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  /** The keys it starts on. */
  defaults: string[];
  /** The browser build's defaults where they differ — a browser keeps Ctrl+Tab and Ctrl+W for its own tabs. */
  webDefaults?: string[];
  /**
   * Fires with the focus in a text field. Only ever with Ctrl, Alt or a function key: a
   * plain key typed into a field is text, whatever it is bound to.
   */
  inText?: boolean;
  /** Fires while a dialog is open. */
  inDialogs?: boolean;
}

export const COMMAND_GROUPS: { id: CommandGroup; label: string }[] = [
  { id: "file", label: msg("File") },
  { id: "edit", label: msg("Edit") },
  { id: "view", label: msg("View") },
  { id: "layers", label: msg("Layers") },
  { id: "tools", label: msg("Tools") },
  { id: "window", label: msg("Window") },
  { id: "help", label: msg("Help") },
];

export const COMMANDS: readonly Command[] = [
  { id: "file.new", label: msg("New Map"), group: "file", defaults: ["Ctrl+N"], inText: true },
  { id: "file.open", label: msg("Open Map"), group: "file", defaults: ["Ctrl+O"], inText: true },
  { id: "file.save", label: msg("Save"), group: "file", defaults: ["Ctrl+S"], inText: true },
  { id: "file.saveAs", label: msg("Save As"), group: "file", defaults: ["Ctrl+Shift+S"], inText: true },
  { id: "file.close", label: msg("Close Map"), group: "file", defaults: ["Ctrl+W"], webDefaults: [], inText: true },
  { id: "file.properties", label: msg("Map Properties"), group: "file", defaults: ["Alt+Enter"], inText: true },
  { id: "edit.undo", label: msg("Undo"), group: "edit", defaults: ["Ctrl+Z"] },
  { id: "edit.redo", label: msg("Redo"), group: "edit", defaults: ["Ctrl+Y", "Ctrl+Shift+Z"] },
  { id: "edit.cut", label: msg("Cut"), group: "edit", defaults: ["Ctrl+X"] },
  { id: "edit.copy", label: msg("Copy"), group: "edit", defaults: ["Ctrl+C"] },
  { id: "edit.paste", label: msg("Paste"), group: "edit", defaults: ["Ctrl+V"] },
  { id: "edit.selectAll", label: msg("Select All"), group: "edit", defaults: ["Ctrl+A"] },
  { id: "edit.find", label: msg("Find"), group: "edit", defaults: ["Ctrl+F"] },
  { id: "view.grid", label: msg("Toggle Grid"), group: "view", defaults: ["Ctrl+G"] },
  { id: "view.zoomIn", label: msg("Zoom In"), group: "view", defaults: ["Ctrl+Plus", "Ctrl+=", "Ctrl+Shift+Plus"] },
  { id: "view.zoomOut", label: msg("Zoom Out"), group: "view", defaults: ["Ctrl+-"] },
  { id: "view.zoomActual", label: msg("Zoom to 100%"), group: "view", defaults: ["Ctrl+0"] },
  { id: "view.zoomFit", label: msg("Zoom to Fit"), group: "view", defaults: ["Ctrl+Shift+0"], inText: true },
  { id: "layer.terrain", label: msg("Layer: Terrain"), group: "layers", defaults: ["T"] },
  { id: "layer.doodads", label: msg("Layer: Doodads"), group: "layers", defaults: ["D"] },
  { id: "layer.units", label: msg("Layer: Units"), group: "layers", defaults: ["U"] },
  { id: "layer.sprites", label: msg("Layer: Sprites"), group: "layers", defaults: ["S"] },
  { id: "layer.locations", label: msg("Layer: Locations"), group: "layers", defaults: ["L"] },
  { id: "layer.fog", label: msg("Layer: Fog of War"), group: "layers", defaults: ["F"] },
  { id: "layer.clipboard", label: msg("Layer: Cut / Copy / Paste"), group: "layers", defaults: ["C"] },
  { id: "brush.smaller", label: msg("Brush smaller"), group: "layers", defaults: ["["] },
  { id: "brush.larger", label: msg("Brush larger"), group: "layers", defaults: ["]"] },
  { id: "tools.triggers", label: msg("Trigger Editor"), group: "tools", defaults: ["Ctrl+T"] },
  { id: "tools.testMap", label: msg("Test Map"), group: "tools", defaults: ["Ctrl+F5"], inText: true },
  { id: "tools.preferences", label: msg("Preferences"), group: "tools", defaults: ["Ctrl+,"], inText: true },
  { id: "window.next", label: msg("Next Map"), group: "window", defaults: ["Ctrl+Tab"], webDefaults: [], inText: true },
  { id: "window.previous", label: msg("Previous Map"), group: "window", defaults: ["Ctrl+Shift+Tab"], webDefaults: [], inText: true },
  { id: "help.shortcuts", label: msg("Keyboard shortcuts"), group: "help", defaults: ["F1"], inText: true, inDialogs: true },
];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export function commandById(id: string): Command | undefined {
  return BY_ID.get(id);
}

/** A key held alone is not a combo yet — the capture waits for the key it modifies. */
export function isModifierKey(key: string): boolean {
  return key === "Control" || key === "Shift" || key === "Alt" || key === "Meta" || key === "AltGraph" || key === "CapsLock" || key === "OS";
}

/** The fields of a `KeyboardEvent` a combo is made from, so tests need no DOM. */
export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** The combo a key press makes, in the form `COMMANDS` and `Preferences.hotkeys` use. */
export function comboOf(e: KeyLike): string {
  let key = e.key;
  if (key.length === 1 && /[a-z0-9]/i.test(key)) key = key.toUpperCase();
  else {
    const physical = /^(?:Key([A-Z])|Digit(\d))$/.exec(e.code);
    if (physical) key = physical[1] ?? physical[2];
    else if (key === "+") key = "Plus";
    else if (key === " ") key = "Space";
    else if (key.length === 1) key = key.toUpperCase();
  }
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** The combo split into its modifiers and its key. */
export function splitCombo(combo: string): { ctrl: boolean; alt: boolean; shift: boolean; key: string } {
  const parts = combo.split("+");
  const key = parts.pop() ?? "";
  return { ctrl: parts.includes("Ctrl"), alt: parts.includes("Alt"), shift: parts.includes("Shift"), key };
}

/**
 * Keys a command cannot take, and why: they already do something that depends on where
 * the editor is, or the browser keeps them. Shift with these is the same key.
 */
export function reservedReason(combo: string): string | null {
  const { ctrl, alt, key } = splitCombo(combo);
  if (ctrl || alt) return null;
  if (key === "Escape") return msg("Esc stops placing and clears the selection");
  if (key === "Delete" || key === "Backspace") return msg("Delete removes the selection");
  if (key.startsWith("Arrow")) return msg("The arrows scroll the view and nudge locations");
  if (key === "Tab" || key === "Enter" || key === "Space") return msg("Tab, Enter and Space work the controls of the dialogs");
  if (key === "F11") return msg("F11 is full screen");
  return null;
}

/** Whether a command bound to `combo` fires with the focus in a text field. */
export function firesWhileTyping(command: Command, combo: string): boolean {
  if (!command.inText) return false;
  const { ctrl, alt, key } = splitCombo(combo);
  return ctrl || alt || /^F\d+$/.test(key);
}

/** How a combo is shown: the minus sign, arrows and short names the menus use. */
export function formatCombo(combo: string): string {
  const { ctrl, alt, shift, key } = splitCombo(combo);
  const names: Record<string, string> = {
    Plus: "+", "-": "−", Delete: "Del", Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    PageUp: "PgUp", PageDown: "PgDn", Insert: "Ins",
  };
  return [...(ctrl ? ["Ctrl"] : []), ...(alt ? ["Alt"] : []), ...(shift ? ["Shift"] : []), names[key] ?? key].join("+");
}

/** What `Preferences.hotkeys` holds: the commands the user changed, each with its whole list (`[]` = no keys). */
export type HotkeyOverrides = Record<string, string[]>;

export interface ResolvedHotkeys {
  /** Each command's keys, defaults and overrides merged. */
  byCommand: Record<string, string[]>;
  /** Each combo's command — the first in `COMMANDS` order when two share one. */
  byCombo: Map<string, string>;
}

/** The keys each command answers to, for this build (`desktop` picks between `defaults` and `webDefaults`). */
export function resolveHotkeys(overrides: HotkeyOverrides | undefined, desktop: boolean): ResolvedHotkeys {
  const byCommand: Record<string, string[]> = {};
  const byCombo = new Map<string, string>();
  for (const c of COMMANDS) {
    const own = overrides?.[c.id];
    const combos = Array.isArray(own) ? own.filter((k) => typeof k === "string" && k !== "") : defaultCombos(c, desktop);
    byCommand[c.id] = combos;
    for (const k of combos) if (!byCombo.has(k)) byCombo.set(k, c.id);
  }
  return { byCommand, byCombo };
}

export function defaultCombos(c: Command, desktop: boolean): string[] {
  return desktop ? c.defaults : (c.webDefaults ?? c.defaults);
}

/** The label a menu or tooltip shows for a command: its first combo, or nothing. */
export function shortcutOf(resolved: ResolvedHotkeys, id: string): string | undefined {
  const first = resolved.byCommand[id]?.[0];
  return first ? formatCombo(first) : undefined;
}

/**
 * A plugin's combo (`Ctrl+Alt+Shift+Meta+K`, with the character `e.key` gave) in the
 * commands' form, so the two can be compared: Meta counts as Ctrl, `+` is `Plus`.
 */
export function pluginComboAsCommand(combo: string): string {
  const parts = combo.endsWith("++") ? [...combo.slice(0, -2).split("+"), "Plus"] : combo.split("+");
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((p) => (p === "Meta" ? "Ctrl" : p)));
  return [...["Ctrl", "Alt", "Shift"].filter((m) => mods.has(m)), key === "+" ? "Plus" : key].join("+");
}

export interface HotkeyConflict {
  combo: string;
  /** The other commands with the same combo. */
  commands: string[];
  /** The plugins with the same combo (theirs are tried first, so they win). */
  plugins: string[];
}

/** For one command, each of its combos that something else also answers to. */
export function conflictsOf(id: string, resolved: ResolvedHotkeys, pluginCombos: { combo: string; plugin: string }[]): HotkeyConflict[] {
  const out: HotkeyConflict[] = [];
  for (const combo of resolved.byCommand[id] ?? []) {
    const commands = COMMANDS.filter((c) => c.id !== id && resolved.byCommand[c.id]?.includes(combo)).map((c) => c.id);
    const plugins = [...new Set(pluginCombos.filter((p) => pluginComboAsCommand(p.combo) === combo).map((p) => p.plugin))];
    if (commands.length || plugins.length) out.push({ combo, commands, plugins });
  }
  return out;
}

/**
 * The overrides after one command's list changes: a list equal to the defaults drops
 * the entry, so a command the user put back follows the editor's defaults again.
 */
export function withBinding(overrides: HotkeyOverrides, id: string, combos: string[] | null, desktop: boolean): HotkeyOverrides {
  const next = { ...overrides };
  const c = commandById(id);
  if (!c || combos === null || sameList(combos, defaultCombos(c, desktop))) delete next[id];
  else next[id] = combos;
  return next;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** The keys that are not commands, for the F1 table and the Hotkeys page. */
export const FIXED_KEYS: [string, string[]][] = [
  [msg("Delete the selection"), ["Del"]],
  [msg("Stop placing, then clear the selection"), ["Esc"]],
  [msg("Cancel a plugin's map pick or tool"), ["Esc", msg("right-click")]],
  [msg("Scroll the view (two tiles / half a screen)"), ["←↑→↓", "Shift+←↑→↓"]],
  [msg("Nudge selected locations (snap step / 1 px)"), ["←↑→↓", "Shift+←↑→↓"]],
  [msg("Pan the view"), [msg("middle-drag")]],
  [msg("Full screen"), ["F11"]],
];
