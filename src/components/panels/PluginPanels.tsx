/**
 * The floating panels plugins open with `api.ui.panel`: a title strip to drag them by,
 * a close button, and an empty `<div>` the plugin fills with plain DOM. They sit over
 * the map inside the viewport and block nothing — the map keeps every gesture and
 * hotkey, which is what a plugin with a drawing mode of its own needs beside the tools
 * a modal dialog would cover.
 *
 * Positions are kept per plugin and title for the session, so a panel closed and
 * reopened lands where it was left. The host element is held in state, not a ref, as
 * the plugin dialog does: the mount effect must see the element on its first pass.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { PanelRightClose, X } from "lucide-react";
import { pluginPanelsAtom, type PluginPanelEntry } from "../../atoms/pluginAtoms";
import { PluginIconView } from "../ui/PluginIconView";
import { Button, Tip } from "../ui";

const DEFAULT_WIDTH = 260;
/** Where a panel first opens: the top-right corner of the map, clear of the palette and the area most work starts in; each further one is stepped in and down. */
const MARGIN = 14;
const STEP = 28;

const positions = new Map<string, { x: number; y: number }>();

export default function PluginPanels() {
  const panels = useAtomValue(pluginPanelsAtom).filter((p) => (p.spec.dock ?? "float") === "float");
  if (panels.length === 0) return null;
  return (
    <>
      {panels.map((p, i) => <PluginPanel key={p.key} entry={p} index={i} />)}
    </>
  );
}

/**
 * The panels opened with `dock: "right"`: each a `.panel` in the right dock with the same
 * head the built-in panels have — the plugin's icon, the title, a hide button that is the
 * panel's close — so a plugin that lives beside the map reads as part of the editor.
 */
export function DockedPluginPanels() {
  const panels = useAtomValue(pluginPanelsAtom).filter((p) => p.spec.dock === "right");
  if (panels.length === 0) return null;
  return (
    <>
      {panels.map((p) => <DockedPanel key={p.key} entry={p} />)}
    </>
  );
}

function usePanelTitle(titleBox: PluginPanelEntry["title"]) {
  const [title, setTitle] = useState(titleBox.value);
  useEffect(() => {
    const listen = () => setTitle(titleBox.value);
    titleBox.listeners.add(listen);
    listen();
    return () => { titleBox.listeners.delete(listen); };
  }, [titleBox]);
  return title;
}

function usePanelMount(host: HTMLDivElement | null, entry: PluginPanelEntry) {
  const { spec, handle, plugin } = entry;
  useEffect(() => {
    if (!host) return;
    let cleanup: void | (() => void);
    try {
      cleanup = spec.mount(host, handle);
    } catch (err) {
      console.error(`[${plugin.name}] panel mount failed`, err);
      host.textContent = `The plugin's panel failed to open: ${err instanceof Error ? err.message : String(err)}`;
    }
    return () => { try { cleanup?.(); } catch (err) { console.error(`[${plugin.name}] panel cleanup failed`, err); } };
  }, [host, spec, handle, plugin]);
}

function DockedPanel({ entry }: { entry: PluginPanelEntry }) {
  const { spec, handle, plugin } = entry;
  const title = usePanelTitle(entry.title);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  usePanelMount(host, entry);
  return (
    <div className={`panel plugin-docked${spec.grow ? " grow" : ""}`} data-plugin={plugin.id} aria-label={title}>
      <div className="panel-head">
        <span className="icon-lead"><PluginIconView icon={plugin.icon} size={12} /></span>
        <span className="title">{title}</span>
        <Tip label={`Hide ${title}`}><Button icon onClick={() => handle.close()}><PanelRightClose size={13} /></Button></Tip>
      </div>
      <div ref={setHost} className="panel-body plugin-panel-body" />
    </div>
  );
}

function PluginPanel({ entry, index }: { entry: PluginPanelEntry; index: number }) {
  const { spec, handle, plugin, title: titleBox } = entry;
  const width = spec.width ?? DEFAULT_WIDTH;
  const memoryKey = `${plugin.id}:${spec.title}`;
  const [pos, setPos] = useState(() => positions.get(memoryKey) ?? { x: 0, y: 0 });
  const title = usePanelTitle(titleBox);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  usePanelMount(host, entry);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);

  // A panel opening for the first time goes to the top-right of the map; it cannot know the map's width until it is in the DOM.
  useLayoutEffect(() => {
    const parent = frame.current?.parentElement;
    if (positions.has(memoryKey) || !parent) return;
    const first = { x: Math.max(0, parent.clientWidth - width - MARGIN - index * STEP), y: 20 + MARGIN + index * STEP };
    positions.set(memoryKey, first);
    setPos(first);
  }, [memoryKey, width, index]);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const parent = frame.current?.parentElement;
    if (!d || !parent) return;
    // Keep the title strip reachable: the panel may hang off the bottom or the right, never off the top or the left.
    const maxX = Math.max(0, parent.clientWidth - 60);
    const maxY = Math.max(0, parent.clientHeight - 32);
    const next = { x: Math.min(maxX, Math.max(0, e.clientX - d.dx)), y: Math.min(maxY, Math.max(0, e.clientY - d.dy)) };
    positions.set(memoryKey, next);
    setPos(next);
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div ref={frame} className="plugin-panel" style={{ left: pos.x, top: pos.y, width }} role="dialog" aria-label={title}>
      <div className="dlg-title plugin-panel-title" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <span className="icon-lead"><PluginIconView icon={plugin.icon} size={14} /></span>
        <h2>{title}</h2>
        <button className="dlg-close" aria-label="Close" onClick={() => handle.close()}><X size={14} /></button>
      </div>
      <div ref={setHost} className="plugin-panel-body" />
    </div>
  );
}
