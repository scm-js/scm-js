import { useCallback, useEffect, useState } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { Blocks, Plus, RefreshCw, Trash2 } from "lucide-react";
import DialogFrame from "../ui/DialogFrame";
import { Button, Check, TextInput } from "../ui";
import type { DialogProps } from "./DialogHost";
import { closeDialogAtom, dialogStackAtom } from "../../atoms/uiAtoms";
import { installedPluginsAtom, pluginRuntimesAtom, type PluginRuntime } from "../../atoms/pluginAtoms";
import { activatePlugin, deactivatePlugin, effectiveInstalls, reloadPlugin, setInstalled } from "../../plugins/host";
import { defaultPluginSpecs } from "../../plugins/defaults";
import { parseSpec, PluginLoadError } from "../../plugins/loader";
import { transferOf } from "../../plugins/images";
import type { DialogHandle, DialogSpec, PluginIcon, PluginInfo } from "../../plugins/api";

/** The box `api.ui.dialog` shares with `DialogHandle.setTitle`, so a title change reaches the frame. */
interface TitleBox { value: string; listeners: Set<() => void> }

/* ── A plugin's icon ────────────────────────────────────── */

/**
 * The face a plugin declared in its manifest (`icon`): an image, or a glyph, or —
 * when it declared none, or the image will not load — the editor's own plugin mark.
 * The loader has already decided which of the two it is (`resolveIcon`); nothing here
 * touches the manifest string, so a `javascript:` "icon" never reaches an attribute.
 */
export function PluginIconView({ icon, size = 30 }: { icon: PluginIcon | null | undefined; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.72) };
  if (icon?.kind === "image" && !broken) {
    return <img className="plugin-icon" style={style} src={icon.url} alt="" onError={() => setBroken(true)} />;
  }
  return (
    <span className="plugin-icon" style={style} aria-hidden>
      {icon?.kind === "text" ? icon.text : <Blocks size={Math.round(size * 0.6)} />}
    </span>
  );
}

/* ── A plugin's own dialog ──────────────────────────────── */

/**
 * The frame a plugin's `api.ui.dialog` mounts into: the editor's chrome around an
 * empty `<div>` the plugin fills with plain DOM. The host element is held in state,
 * not a ref — the Radix portal mounts a commit after this component, so a ref read in
 * the first effect pass is still null (see `ExportImageDialog`).
 */
export function PluginDialog({ entry }: DialogProps) {
  const close = useSetAtom(closeDialogAtom);
  const spec = entry.payload?.spec as DialogSpec;
  const handle = entry.payload?.handle as DialogHandle;
  const plugin = entry.payload?.plugin as PluginInfo | undefined;
  const titleBox = entry.payload?.title as TitleBox | undefined;
  const stack = useAtomValue(dialogStackAtom);
  const topmost = stack[stack.length - 1]?.key === entry.key;
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(titleBox?.value ?? spec.title);

  useEffect(() => {
    if (!titleBox) return;
    const listen = () => setTitle(titleBox.value);
    titleBox.listeners.add(listen);
    listen();
    return () => { titleBox.listeners.delete(listen); };
  }, [titleBox]);

  // Ctrl+V while this is the topmost dialog. A paste into one of the plugin's own text fields is left
  // alone unless it carries files — a screenshot pasted "into" the URL box is still a picture.
  useEffect(() => {
    const onPaste = spec.onPaste;
    if (!onPaste || !topmost) return;
    const listener = (e: ClipboardEvent) => {
      const transfer = transferOf(e.clipboardData);
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (inField && transfer.files.length === 0) return;
      if (transfer.files.length === 0 && !transfer.text) return;
      e.preventDefault();
      try { onPaste(transfer, handle); } catch (err) { console.error(`[${plugin?.name ?? "plugin"}] onPaste failed`, err); }
    };
    document.addEventListener("paste", listener);
    return () => document.removeEventListener("paste", listener);
  }, [spec, handle, plugin, topmost]);

  useEffect(() => {
    if (!host) return;
    let cleanup: void | (() => void);
    try {
      cleanup = spec.mount(host, handle);
    } catch (err) {
      console.error(`[${plugin?.name ?? "plugin"}] dialog mount failed`, err);
      host.textContent = `The plugin's dialog failed to open: ${err instanceof Error ? err.message : String(err)}`;
    }
    return () => { try { cleanup?.(); } catch (err) { console.error(`[${plugin?.name ?? "plugin"}] dialog cleanup failed`, err); } };
  }, [host, spec, handle, plugin]);

  const buttons = spec.buttons ?? [{ label: "Close" }];
  const press = async (b: (typeof buttons)[number]) => {
    setBusy(true);
    try {
      const r = b.run ? await b.run(handle) : undefined;
      if (r !== false && b.closes !== false) close(entry.key);
    } catch (err) {
      console.error(`[${plugin?.name ?? "plugin"}] dialog button failed`, err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={title}
      icon={<PluginIconView icon={plugin?.icon} size={14} />}
      size={spec.size ?? "md"}
      tall={spec.tall}
      footer={buttons.map((b, i) => (
        <Button key={i} variant={b.primary ? "primary" : undefined} disabled={busy} onClick={() => { void press(b); }}>{b.label}</Button>
      ))}
      footerLeft={plugin ? <span className="hint">{plugin.name}</span> : undefined}
    >
      <div
        ref={setHost}
        className="plugin-dialog-body"
        onDragOver={(e) => { if (spec.onDrop) { e.preventDefault(); e.stopPropagation(); } }}
        onDrop={(e) => {
          if (!spec.onDrop) return;
          e.preventDefault();
          e.stopPropagation();
          try { spec.onDrop(transferOf(e.dataTransfer), handle); } catch (err) { console.error(`[${plugin?.name ?? "plugin"}] onDrop failed`, err); }
        }}
      />
    </DialogFrame>
  );
}

/* ── Manage Plugins ─────────────────────────────────────── */

function statusLabel(rt: PluginRuntime | undefined, enabled: boolean): { text: string; className: string } {
  if (!enabled) return { text: "off", className: "dim" };
  switch (rt?.status) {
    case "active": return { text: "active", className: "teal" };
    case "loading": return { text: "loading…", className: "dim" };
    case "error": return { text: "failed", className: "error-text" };
    default: return { text: "off", className: "dim" };
  }
}

function contributionSummary(rt: PluginRuntime | undefined): string {
  if (!rt || rt.status !== "active") return "";
  const c = rt.contributions;
  const parts: string[] = [];
  if (c.menu) parts.push(`${c.menu} menu item${c.menu === 1 ? "" : "s"}`);
  if (c.contextMenu) parts.push(`${c.contextMenu} context-menu item${c.contextMenu === 1 ? "" : "s"}`);
  if (c.hotkeys) parts.push(`${c.hotkeys} hotkey${c.hotkeys === 1 ? "" : "s"}`);
  if (c.events) parts.push(`${c.events} listener${c.events === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(", ") : "no contributions";
}

export function PluginsDialog({ entry }: DialogProps) {
  const store = useStore();
  const installed = useAtomValue(installedPluginsAtom);
  const runtimes = useAtomValue(pluginRuntimesAtom);
  const [spec, setSpec] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const defaults = defaultPluginSpecs();
  const list = effectiveInstalls(installed, defaults);

  const add = useCallback(() => {
    const s = spec.trim();
    if (!s) return;
    try {
      const parsed = parseSpec(s);
      // The short form for a repository, so pasting the default plugin's own URL is recognised as it.
      const canonical = parsed.kind === "builtin" ? `builtin:${parsed.name}` : parsed.display;
      if (list.some((p) => p.spec === canonical)) { setProblem("That plugin is already in the list."); return; }
      setInstalled(store, canonical, { enabled: true });
      setSpec("");
      setProblem(null);
    } catch (err) {
      setProblem(err instanceof PluginLoadError ? err.message : String(err));
    }
  }, [spec, list, store]);

  const toggle = (s: string, enabled: boolean) => {
    setInstalled(store, s, { enabled });
    if (enabled) void activatePlugin(store, s); else deactivatePlugin(store, s);
  };
  const remove = (s: string) => {
    deactivatePlugin(store, s);
    setInstalled(store, s, { remove: true });
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Plugins"
      icon={<Blocks size={14} />}
      size="lg"
      tall
      footer={<Button variant="primary" onClick={() => store.set(closeDialogAtom, entry.key)}>Close</Button>}
      description="Plugins add tools to the editor. They run with the editor's own privileges — only add ones you trust."
    >
      <div className="stack plugin-manage">
        <div className="plugin-add">
          <span className="pane-label">Add a plugin</span>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <TextInput
              className="mono grow"
              placeholder="https://github.com/owner/repo"
              value={spec}
              onChange={(e) => { setSpec(e.target.value); setProblem(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
              aria-label="Plugin location"
            />
            <Button variant="primary" onClick={add} disabled={spec.trim() === ""}><Plus size={12} /> Add</Button>
          </div>
          {problem
            ? <span className="error-text">{problem}</span>
            : (
              <p className="hint">
                Paste the link to the plugin's GitHub repository — <span className="mono">https://github.com/owner/repo</span> — or to
                a folder inside it, <span className="mono">https://github.com/owner/repo/tree/v1.2/plugins/my-plugin</span>. A link straight to
                a <span className="mono">plugin.json</span> or <span className="mono">plugin.ts</span> works too, as does the short
                form <span className="mono">github:owner/repo@v1.2</span> and a local dev server such
                as <span className="mono">http://localhost:3000/</span>.
              </p>
            )}
        </div>
        <span className="pane-label">Installed</span>
        <div className="listbox plugin-list" role="list">
          {list.map((p) => {
            const rt = runtimes[p.spec];
            const isDefault = defaults.includes(p.spec);
            const name = rt?.manifest?.name ?? (p.spec.startsWith("builtin:") ? p.spec.slice("builtin:".length) : p.spec);
            const status = statusLabel(rt, p.enabled);
            return (
              <div key={p.spec} className="item plugin-row" role="listitem">
                <Check label="" checked={p.enabled} onChange={(e) => toggle(p.spec, e.target.checked)} aria-label={`Enable ${name}`} />
                <PluginIconView icon={rt?.icon} />
                <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <strong>{name}</strong>
                    {rt?.manifest?.version && <span className="dim">v{rt.manifest.version}</span>}
                    <span className={`badge ${status.className}`}>{status.text}</span>
                    {isDefault && <span className="badge dim">default</span>}
                  </div>
                  {rt?.manifest?.description && <span className="hint">{rt.manifest.description}</span>}
                  <span className="hint mono" style={{ opacity: 0.7 }}>{p.spec}</span>
                  {rt?.status === "error" && rt.error && <span className="error-text">{rt.error}</span>}
                  {rt?.status === "active" && <span className="hint">{contributionSummary(rt)}</span>}
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <Button size="sm" title="Reload the plugin from its source" disabled={!p.enabled} onClick={() => { void reloadPlugin(store, p.spec); }}><RefreshCw size={11} /> Reload</Button>
                  {!isDefault && <Button size="sm" title="Remove from the list" onClick={() => remove(p.spec)}><Trash2 size={11} /></Button>}
                </div>
              </div>
            );
          })}
        </div>
        <p className="hint">
          Remote plugins are pinned to the ref you gave and only re-fetched on Reload. To write one, put
          a <span className="mono">plugin.json</span> next to a <span className="mono">plugin.ts</span> (or <span className="mono">.js</span>) in a
          public repository — see <span className="mono">docs/plugins.md</span> for the API.
        </p>
      </div>
    </DialogFrame>
  );
}
