import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { ArrowUp, Blocks, ExternalLink, HardDrive, LoaderCircle, Plus, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import DialogFrame from "../ui/DialogFrame";
import { Button, Check, TextInput } from "../ui";
import type { DialogProps } from "./DialogHost";
import { closeDialogAtom, dialogStackAtom, openDialogAtom } from "../../atoms/uiAtoms";
import { installedPluginsAtom, pluginCodeAtom, pluginRuntimesAtom, type PluginRuntime } from "../../atoms/pluginAtoms";
import { activatePlugin, deactivatePlugin, describePlugin, effectiveInstalls, inspectPlugin, installPlugin, isPluginActive, reloadPlugin, setInstalled } from "../../plugins/host";
import { defaultPlugins, defaultPluginSpecs } from "../../plugins/defaults";
import { addressesOf, canonicalSpec, isPinned, parseSpec, PluginLoadError, unpin, type PluginPreview } from "../../plugins/loader";
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

/* ── Adding one: the confirmation ───────────────────────── */

/** One `label: value` line of the preview. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="plugin-fact">
      <span className="k">{label}</span>
      <span className="v">{children}</span>
    </div>
  );
}

function Link({ href }: { href: string }) {
  return <a href={href} target="_blank" rel="noreferrer noopener">{href} <ExternalLink size={10} /></a>;
}

/** A tick with its own explanation, for the three choices being made on this screen. */
function Option({ label, hint, checked, disabled, onChange }: { label: string; hint: ReactNode; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="plugin-option">
      <Check label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="hint">{hint}</span>
    </div>
  );
}

/**
 * What stands between pasting a plugin's address and running its code.
 *
 * `inspectPlugin` reads the one `plugin.json`, plus one commit lookup for a GitHub
 * plugin, and nothing else: no entry file is fetched, no code is transpiled or imported.
 * So everything shown here (who wrote it, what it claims to do, the addresses it will be
 * fetched from, the commit those addresses point at) costs two requests and the plugin is
 * still inert while the user reads it. Only Add reaches `installPlugin`.
 *
 * The three ticks are the whole point of the screen and are read straight into that call:
 * whether to run it now, whether to store the pinned spec instead of the moving one, and
 * whether to keep a copy of the code in the browser and load that from then on.
 *
 * Both ways in — Add in Manage Plugins and Update on a pinned row — read the manifest
 * before they open this screen, so the preview arrives with the payload and a plugin the
 * editor cannot describe never gets this far. The fetch below covers an open without one;
 * either way a manifest that cannot be read ends here, since there is nothing to agree to.
 */
export function ConfirmPluginDialog({ entry }: DialogProps) {
  const store = useStore();
  const close = useSetAtom(closeDialogAtom);
  const spec = entry.payload?.spec as string;
  const onAdded = entry.payload?.onAdded as (() => void) | undefined;
  // Set when this is an update: the pinned spec being replaced, and the preview the row
  // already fetched to find out there was a newer commit (no need to ask twice).
  const replaces = entry.payload?.replaces as string | undefined;
  const given = entry.payload?.preview as PluginPreview | undefined;
  const [preview, setPreview] = useState<PluginPreview | null>(given ?? null);
  const [failed, setFailed] = useState<string | null>(null);
  const installed = useAtomValue(installedPluginsAtom);
  const previous = replaces ? effectiveInstalls(installed).find((p) => p.spec === replaces) : undefined;
  const [enable, setEnable] = useState(previous?.enabled ?? true);
  const [pin, setPin] = useState(true);
  const [local, setLocal] = useState(previous?.local === true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (given) return;
    let live = true;
    setPreview(null);
    setFailed(null);
    inspectPlugin(spec).then(
      (p) => { if (live) setPreview(p); },
      (err: unknown) => { if (live) setFailed(err instanceof Error ? err.message : String(err)); },
    );
    return () => { live = false; };
  }, [spec, given]);

  const install = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await installPlugin(store, preview, { enabled: enable, pin, local, replaces });
      onAdded?.();
      close(entry.key);
    } finally {
      setBusy(false);
    }
  };

  // Nothing to show and nothing to agree to: the fetch failed, or it came back without a
  // manifest. Either way the screen says so and Add is off.
  const unreadable = failed ?? preview?.problem ?? null;
  const manifest = preview?.manifest;
  const name = manifest?.name ?? (spec.startsWith("builtin:") ? spec.slice("builtin:".length) : spec);
  const builtin = preview?.source.kind === "builtin";
  const pinnable = preview?.pin != null;
  const pinning = pinnable && pin;
  // The addresses follow the choice: pinning changes which commit every one of them names.
  const chosen = pinning ? preview.pin!.source : preview?.source;
  const where = chosen ? addressesOf(chosen, manifest ?? null) : null;

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={replaces ? "Update Plugin" : "Add Plugin"}
      icon={<ShieldAlert size={14} />}
      size="md"
      tall
      footer={
        <>
          <Button variant="primary" disabled={busy || unreadable !== null} onClick={() => { void install(); }}>
            {busy && <LoaderCircle size={11} className="spin" />}{replaces ? "Update" : enable ? "Add and Enable" : "Add"}
          </Button>
          <Button onClick={() => close(entry.key)}>Cancel</Button>
        </>
      }
    >
      <div className="stack plugin-confirm">
        {unreadable !== null ? (
          <>
            <p className="error-text">Could not find plugin data at that address.</p>
            <p className="hint">Check that the link points at a <span className="mono">plugin.json</span>, or at a repository or folder that has one.</p>
            <p className="hint mono">{unreadable}</p>
          </>
        ) : (
          <>
            <div className="plugin-confirm-head">
              <PluginIconView icon={preview?.icon} size={44} />
              <div className="col grow" style={{ gap: 3, minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <strong className="plugin-confirm-name">{name}</strong>
                  {manifest?.version && <span className="dim">v{manifest.version}</span>}
                  {!preview && <span className="badge dim"><LoaderCircle size={9} className="spin" />reading plugin.json…</span>}
                  {preview?.needsApi != null && <span className="badge warn">needs plugin API {preview.needsApi}</span>}
                </div>
                {manifest?.author && <span className="hint">by {manifest.author}</span>}
                {manifest?.description && <span className="hint">{manifest.description}</span>}
              </div>
            </div>

            {replaces && (
              <p className="hint">
                Replacing the installed <span className="mono">{replaces.slice(replaces.indexOf("@") + 1, replaces.indexOf("@") + 8)}</span>. This
                is newer code, so give it the same look over you would give a plugin you are adding for the first time.
              </p>
            )}

            <div className="plugin-warning">
              <ShieldAlert size={15} />
              <div>
                <strong>Only add plugins you trust.</strong> Plugins are not sandboxed. This one will run with the same
                access as the editor: it can read and change the map you have open and anything you save from it, add menu
                items and hotkeys, keep data in this browser, and make network requests.
              </div>
            </div>

            <div className="plugin-options">
              <Option
                label="Enable it now"
                hint="Run the plugin as soon as it is added. Leave it off to add it to the list and start it later."
                checked={enable}
                onChange={setEnable}
              />
              <Option
                label={pinnable ? `Pin to this version (${preview!.pin!.short})` : "Pin to this version"}
                hint={
                  pinnable
                    ? pin
                      ? <>Stores <span className="mono">@{preview!.pin!.short}</span>, so the editor loads this exact commit every time. The Update button on the row is how you move to a newer one.</>
                      : <>Follows <span className="mono">{preview!.ref ?? "the default branch"}</span>: the editor downloads whatever is there each time it starts.</>
                    : preview?.pinProblem ?? "—"
                }
                checked={pinning}
                disabled={!pinnable}
                onChange={setPin}
              />
              <Option
                label="Keep a copy in this browser"
                hint={
                  builtin
                    ? "This plugin is part of the build; there is nothing to fetch."
                    : local
                      ? "Saves the plugin's files after the first load and runs that copy from then on. Its address is not contacted again until you press Reload."
                      : "Fetches the plugin from its address every time the editor starts."
                }
                checked={local && !builtin}
                disabled={builtin}
                onChange={setLocal}
              />
            </div>

            <div className="plugin-facts">
              <Fact label="Source">
                <span className="mono">{pinning ? preview.pin!.spec : preview?.spec ?? spec}</span>
              </Fact>
              {where?.webUrl && <Fact label="Repository"><Link href={where.webUrl} /></Fact>}
              {manifest?.homepage && /^https?:\/\//i.test(manifest.homepage) && <Fact label="Homepage"><Link href={manifest.homepage} /></Fact>}
              {where?.manifestUrl && <Fact label="Manifest"><span className="mono">{where.manifestUrl}</span></Fact>}
              <Fact label="Code">
                {builtin
                  ? <span>Part of this build of the editor.</span>
                  : where?.entryUrl
                    ? <span className="mono">{where.entryUrl}</span>
                    : <span className="dim">{where?.base ? <><span className="mono">plugin.ts</span> or <span className="mono">plugin.js</span> in <span className="mono">{where.base}</span></> : "—"}</span>}
              </Fact>
            </div>

            {preview?.needsApi != null && (
              <p className="hint">This plugin asks for a newer plugin API than the editor has, so it will probably fail to load.</p>
            )}
            <p className="hint">
              Only the <span className="mono">plugin.json</span> has been read so far. None of the plugin's code has been
              downloaded or run yet; {replaces ? "Update" : "Add"} does that.
            </p>
          </>
        )}
      </div>
    </DialogFrame>
  );
}

/* ── Manage Plugins ─────────────────────────────────────── */

/** Said whenever an address answered, but with nothing that names a plugin. */
const NOT_FOUND = "Could not find plugin data at that address. Check that the link points at a plugin.json, or at a repository or folder that has one.";

/**
 * The row's badge. `busy` spins it: a plugin does not appear out of nowhere — fetching,
 * transpiling and importing it takes a moment, and so does reading the manifest of one
 * that is only listed, so both say so rather than letting the row silently rewrite itself
 * when the network answers.
 */
function statusLabel(rt: PluginRuntime | undefined, enabled: boolean): { text: string; className: string; busy?: boolean } {
  if (enabled && rt?.status === "loading") return { text: "loading…", className: "dim", busy: true };
  const describing = rt?.describing === true;
  if (!enabled) return describing ? { text: "reading…", className: "dim", busy: true } : { text: "off", className: "dim" };
  switch (rt?.status) {
    case "active": return { text: "active", className: "teal" };
    case "error": return { text: "failed", className: "error-text" };
    default: return describing ? { text: "reading…", className: "dim", busy: true } : { text: "off", className: "dim" };
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
  const snapshots = useAtomValue(pluginCodeAtom);
  const [spec, setSpec] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // The reason behind `problem`, kept apart from it: the friendly line says what went
  // wrong, this says which address said so, which is what you need to fix a typo.
  const [detail, setDetail] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const defaults = defaultPluginSpecs();
  const list = effectiveInstalls(installed, defaultPlugins());

  // A listed plugin the editor is not running still has a manifest to show; reading it is
  // one `plugin.json` fetch and no code (`describePlugin`). One attempt per spec — the host
  // remembers, so this effect re-running as rows fill in costs nothing.
  useEffect(() => {
    for (const p of list) {
      const rt = runtimes[p.spec];
      if (!rt?.manifest && rt?.status !== "loading") void describePlugin(store, p.spec);
    }
  }, [list, runtimes, store]);

  // Adding never installs straight away: the details, and the warning about what a plugin
  // may do, go through `ConfirmPluginDialog` first. The manifest is read here rather than
  // there (`inspectPlugin`: one plugin.json, no code) so that a link with no plugin behind
  // it is answered under this field instead of by a details screen with no details on it.
  // The preview travels with the dialog, so it is fetched once.
  const add = useCallback(async () => {
    const s = spec.trim();
    if (!s) return;
    let canonical: string;
    try {
      // The short form for a repository, so pasting the default plugin's own URL is recognised as it.
      canonical = canonicalSpec(parseSpec(s));
    } catch (err) {
      setProblem(err instanceof PluginLoadError ? err.message : String(err));
      setDetail(null);
      return;
    }
    if (list.some((p) => p.spec === canonical)) { setProblem("That plugin is already in the list."); setDetail(null); return; }
    setProblem(null);
    setDetail(null);
    setLooking(true);
    try {
      const preview = await inspectPlugin(canonical);
      if (!preview.manifest) { setProblem(NOT_FOUND); setDetail(preview.problem); return; }
      store.set(openDialogAtom, "confirmPlugin", { spec: preview.spec, preview, onAdded: () => setSpec("") });
    } catch (err) {
      setProblem(NOT_FOUND);
      setDetail(err instanceof Error ? err.message : String(err));
    } finally {
      setLooking(false);
    }
  }, [spec, list, store]);

  const toggle = (s: string, enabled: boolean) => {
    setInstalled(store, s, { enabled });
    if (enabled) void activatePlugin(store, s); else deactivatePlugin(store, s);
  };
  // Turning the copy on has to fetch the plugin once to make it, which is what Reload does;
  // turning it off drops the copy (`setInstalled`) and the running plugin is left alone.
  const toggleLocal = (s: string, local: boolean) => {
    setInstalled(store, s, { local });
    if (local && isPluginActive(store, s)) void reloadPlugin(store, s);
  };
  const remove = (s: string) => {
    deactivatePlugin(store, s);
    setInstalled(store, s, { remove: true });
  };

  // Reload re-fetches the commit a pinned plugin names, which is the whole point of a pin —
  // so moving to a newer one is its own action: look up the branch again, and when it holds
  // a different commit, show it on the same confirmation screen as a first install.
  const [checking, setChecking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const update = async (s: string) => {
    setChecking(s);
    setNotice(null);
    try {
      const preview = await inspectPlugin(unpin(s));
      if (!preview.manifest) {
        setNotice(`${NOT_FOUND} ${preview.problem ?? ""}`.trim());
      } else if (preview.pin && preview.pin.spec !== s) {
        store.set(openDialogAtom, "confirmPlugin", { spec: preview.spec, replaces: s, preview });
      } else {
        setNotice(preview.pin ? `${preview.manifest?.name ?? s} is already on the newest commit.` : preview.pinProblem ?? "Could not ask for a newer version.");
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(null);
    }
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Plugins"
      icon={<Blocks size={14} />}
      size="lg"
      tall
      footer={<Button variant="primary" onClick={() => store.set(closeDialogAtom, entry.key)}>Close</Button>}
      description="Plugins add extra tools and features to the editor. A plugin can read and change the map you have open, so only add ones you trust."
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
            <Button variant="primary" onClick={() => { void add(); }} disabled={spec.trim() === "" || looking}>
              {looking ? <LoaderCircle size={12} className="spin" /> : <Plus size={12} />} Add
            </Button>
          </div>
          {problem
            ? (
              <>
                <span className="error-text">{problem}</span>
                {detail && <span className="hint mono">{detail}</span>}
              </>
            )
            : (
              <>
                <p className="hint">
                  Paste a link to the plugin. Any address the browser can read will do: a git repository, a folder
                  inside one, or the <span className="mono">plugin.json</span> itself.
                </p>
                <ul className="hint plugin-examples">
                  <li><span className="mono">https://github.com/owner/repo</span></li>
                  <li><span className="mono">https://github.com/owner/repo/tree/v1.2/plugins/my-plugin</span></li>
                  <li><span className="mono">https://gitlab.com/owner/repo/-/raw/main/plugin.json</span></li>
                  <li><span className="mono">http://localhost:3000/</span> (a dev server, while you write one)</li>
                </ul>
                <p className="hint">
                  Repositories on GitHub can also be written <span className="mono">github:owner/repo@v1.2</span>, and are the
                  ones that can be pinned to a version.
                </p>
              </>
            )}
        </div>
        <span className="pane-label">Installed</span>
        {notice && <span className="hint">{notice}</span>}
        <div className="listbox plugin-list" role="list">
          {list.map((p) => {
            const rt = runtimes[p.spec];
            const isDefault = defaults.includes(p.spec);
            const pinnedSpec = isPinned(p.spec);
            const copy = snapshots[p.spec];
            const name = rt?.manifest?.name ?? (p.spec.startsWith("builtin:") ? p.spec.slice("builtin:".length) : p.spec);
            // Until the manifest is in, the spec *is* the name — printing it twice reads as a bug.
            const named = rt?.manifest != null || p.spec.startsWith("builtin:");
            const status = statusLabel(rt, p.enabled);
            return (
              <div key={p.spec} className="item plugin-row" role="listitem">
                <Check label="" checked={p.enabled} onChange={(e) => toggle(p.spec, e.target.checked)} aria-label={`Enable ${name}`} />
                <PluginIconView icon={rt?.icon} />
                <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <strong>{name}</strong>
                    {rt?.manifest?.version && <span className="dim">v{rt.manifest.version}</span>}
                    <span className={`badge ${status.className}`}>{status.busy && <LoaderCircle size={9} className="spin" />}{status.text}</span>
                    {isDefault && <span className="badge dim">default</span>}
                    {pinnedSpec && <span className="badge dim" title="Loads one fixed commit">pinned</span>}
                  </div>
                  {rt?.manifest?.description && <span className="hint">{rt.manifest.description}</span>}
                  {named && <span className="hint mono" style={{ opacity: 0.7 }}>{p.spec}</span>}
                  {rt?.status === "error" && rt.error && <span className="error-text">{rt.error}</span>}
                  {rt?.status === "active" && <span className="hint">{contributionSummary(rt)}</span>}
                </div>
                <div className="plugin-row-actions">
                  <div className="row" style={{ gap: 4 }}>
                    {pinnedSpec && (
                      <Button size="sm" title="Look for a newer commit and show it before switching to it" disabled={checking === p.spec} onClick={() => { void update(p.spec); }}>
                        {checking === p.spec ? <LoaderCircle size={11} className="spin" /> : <ArrowUp size={11} />} Update
                      </Button>
                    )}
                    <Button size="sm" title="Fetch the plugin again from its address (and replace any copy kept here)" disabled={!p.enabled} onClick={() => { void reloadPlugin(store, p.spec); }}><RefreshCw size={11} /> Reload</Button>
                    {!isDefault && <Button size="sm" title="Remove from the list" onClick={() => remove(p.spec)}><Trash2 size={11} /></Button>}
                  </div>
                  {/* The copy used to be an icon button next to Reload, which said nothing about what
                      it did or whether it was on. It is a labelled tick under the buttons instead. */}
                  <span
                    className="plugin-copy"
                    title={p.spec.startsWith("builtin:")
                      ? "This plugin is part of the build; there is nothing to fetch."
                      : p.local
                        ? copy
                          ? `${Math.round(copy.size / 1024)} KB kept in this browser. Reload fetches the plugin again and replaces it.`
                          : "No copy yet; the next load makes one."
                        : "Save the plugin's files here after the next load and run that copy from then on, instead of fetching it each time the editor starts."}
                  >
                    <HardDrive size={11} />
                    <Check
                      label="Keep a copy"
                      checked={p.local === true}
                      disabled={p.spec.startsWith("builtin:")}
                      onChange={(e) => toggleLocal(p.spec, e.target.checked)}
                      aria-label={`Keep a copy of ${name} in this browser`}
                    />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="hint">
          To write one, put a <span className="mono">plugin.json</span> next to
          a <span className="mono">plugin.ts</span> or <span className="mono">plugin.js</span> anywhere the browser can read
          it. The API is in <span className="mono">docs/plugins.md</span>.
        </p>
      </div>
    </DialogFrame>
  );
}
