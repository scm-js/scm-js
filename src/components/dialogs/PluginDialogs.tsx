import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { ArrowUp, Blocks, CircleCheck, CircleSlash, Clock, Download, ExternalLink, Globe, HardDrive, LoaderCircle, Plus, RefreshCw, RotateCcw, Search, Settings2, ShieldAlert, Trash2, TriangleAlert, User } from "lucide-react";
import DialogFrame from "../ui/DialogFrame";
import { Button, Check, Tabs, TextInput } from "../ui";
import type { DialogProps } from "./DialogHost";
import { closeDialogAtom, dialogStackAtom, openDialogAtom, pushToastAtom } from "../../atoms/uiAtoms";
import { installedPluginsAtom, pluginCodeAtom, pluginRuntimesAtom, pluginUpdatesAtom, registryCacheAtom, registryStateAtom, userRegistriesAtom, type PluginRuntime, type PluginUpdateAnswer } from "../../atoms/pluginAtoms";
import { activatePlugin, checkForUpdate, deactivatePlugin, describePlugin, effectiveInstalls, inspectPlugin, installPlugin, isPluginActive, reloadPlugin, setInstalled } from "../../plugins/host";
import { defaultPlugins, defaultPluginSpecs, pluginKey, updateAddress } from "../../plugins/defaults";
import {
  addRegistry, entryIcon, groupByInstall, hostOf, isDefaultRegistry, loadRegistries, loadRegistry, mergeRegistries, registryUrls, removeRegistry, searchRegistry, unlistedInstalls,
  type InstalledPlugin, type InstallState, type Registry, type RegistryEntry,
} from "../../plugins/registry";
import { addressesOf, canonicalSpec, isPinned, parseSpec, PluginLoadError, unpin, type PluginPreview } from "../../plugins/loader";

import { transferOf } from "../../plugins/images";
import { hostTerms } from "../../editor/platform";
import { PluginIconView } from "../ui/PluginIconView";
import { PLUGIN_API_VERSION, type DialogHandle, type DialogSpec, type PluginIcon, type PluginInfo } from "../../plugins/api";

/** The box `api.ui.dialog` shares with `DialogHandle.setTitle`, so a title change reaches the frame. */
interface TitleBox { value: string; listeners: Set<() => void> }

/** The same, for `DialogHandle.setBusy`: what the dialog is working on, or null. */
interface BusyBox { value: string | null; listeners: Set<() => void> }

/** Subscribe to one of those boxes and re-render when the plugin writes to it. */
function useBox<T>(box: { value: T; listeners: Set<() => void> } | undefined, fallback: T): T {
  const [value, setValue] = useState<T>(box?.value ?? fallback);
  useEffect(() => {
    if (!box) return;
    const listen = () => setValue(box.value);
    box.listeners.add(listen);
    listen();
    return () => { box.listeners.delete(listen); };
  }, [box]);
  return value;
}

/** Why the *Load from a copy saved here* tick is off for a plugin that is part of the build. */
const BUILTIN_COPY_HINT = "This plugin is part of the build; there is nothing to fetch.";

/** What that tick does, in the words of whichever shell the editor is running in. */
function localCopyHint(): string {
  return `Saves the plugin's files in ${hostTerms().here} on the first load and runs that copy from then on. Its address is not contacted again until you press Reload.`;
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
  const busyBox = entry.payload?.busy as BusyBox | undefined;
  const stack = useAtomValue(dialogStackAtom);
  const topmost = stack[stack.length - 1]?.key === entry.key;
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [pressed, setPressed] = useState(false);
  const title = useBox(titleBox, spec.title);
  // Two ways to be working: a footer button whose `run` has not settled, and the plugin
  // saying so itself for work no button started. Either disables the footer.
  const working = useBox<string | null>(busyBox, null);
  const busy = pressed || working !== null;

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
    setPressed(true);
    try {
      const r = b.run ? await b.run(handle) : undefined;
      if (r !== false && b.closes !== false) close(entry.key);
    } catch (err) {
      console.error(`[${plugin?.name ?? "plugin"}] dialog button failed`, err);
    } finally {
      setPressed(false);
    }
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={title}
      icon={<PluginIconView icon={plugin?.icon} size={14} />}
      size={spec.size ?? "md"}
      tall={spec.tall}
      onEscapeKeyDown={(e) => { if (spec.keepOpenOnEscape) { let keep = false; try { keep = spec.keepOpenOnEscape(e.target); } catch (err) { console.error(`[${plugin?.name ?? "plugin"}] keepOpenOnEscape failed`, err); } if (keep) e.preventDefault(); } }}
      footer={buttons.map((b, i) => (
        <Button key={i} variant={b.primary ? "primary" : undefined} disabled={busy} onClick={() => { void press(b); }}>{b.label}</Button>
      ))}
      footerLeft={
        working !== null
          ? <span className="status-line" role="status" aria-live="polite"><span className="spinner sm" aria-hidden="true" />{working}</span>
          : plugin ? <span className="hint">{plugin.name}</span> : undefined
      }
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
 * whether to keep a copy of the code here and load that from then on.
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
      store.set(pushToastAtom, { kind: "ok", title: replaces ? "Plugin updated" : "Plugin installed", detail: `${preview.manifest?.name ?? preview.spec}${preview.manifest?.version ? ` ${preview.manifest.version}` : ""}${enable ? "" : " — off until you turn it on in Manage Plugins"}` });
      onAdded?.();
      close(entry.key);
    } finally {
      setBusy(false);
    }
  };

  // Nothing to show and nothing to agree to: the fetch failed, or it came back without a
  // manifest. Either way the screen says so and Add is off.
  const host = hostTerms();
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

            {replaces && (replaces.startsWith("builtin:")
              ? (
                <p className="hint">
                  <strong>{name}</strong> is part of this build: it is compiled in, and the editor asks its
                  repository for nothing — not at startup, not until you press the check. Updating it makes it an
                  ordinary plugin fetched from that address, including each time the editor starts. The
                  <em> Load from a copy saved here</em> tick below fetches it once and runs that copy from then on,
                  which is the nearest thing to how it works now.
                </p>
              )
              : (
                <p className="hint">
                  Replacing the installed <span className="mono">{replacedVersion(replaces)}</span>. This
                  is newer code, so give it the same look over you would give a plugin you are adding for the first time.
                </p>
              ))}

            <div className="plugin-warning">
              <ShieldAlert size={15} />
              <div>
                <strong>Only add plugins you trust.</strong> Plugins are not sandboxed. This one will run with the same
                access as the editor: it can read and change the map you have open and anything you save from it, add menu
                items and hotkeys, keep data in {host.here}, and make network requests.
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
                label="Load from a copy saved here"
                hint={
                  builtin
                    ? BUILTIN_COPY_HINT
                    : localCopyHint()
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
                    ? <>
                        <span className="mono">{where.entryUrl}</span>
                        {where.built && (
                          <div className="dim">
                            A JavaScript bundle the repository builds from <span className="mono">{manifest?.entry ?? "its source"}</span>, which is what to read.
                          </div>
                        )}
                      </>
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

/* ── Browsing a registry ────────────────────────────────── */

/**
 * One plugin as a registry lists it. Install does not install: it reads the plugin's own
 * `plugin.json` (`inspectPlugin`) and opens the same confirmation a pasted address does,
 * so what the registry said is never what gets trusted — it only decided that the row is
 * here at all.
 *
 * Most rows are of plugins the editor already lists, so the row says which it is three
 * times over in three registers: an accent down its left edge, the one action that makes
 * sense for it, and a line naming the state in words. A badge among the other badges —
 * which is all this used to be — is the one place the eye does not look.
 */
function BrowseRow({ entry, icon, state, busy, onInstall, onEnable, onManage }: {
  entry: RegistryEntry;
  /** The plugin's own icon when the editor has it loaded; the entry's own otherwise. */
  icon?: PluginIcon | null;
  state: InstallState;
  busy: boolean;
  onInstall: () => void;
  onEnable: () => void;
  onManage: () => void;
}) {
  const tooNew = entry.api !== undefined && entry.api > PLUGIN_API_VERSION;
  const tags = entry.tags ?? [];
  const hasMeta = entry.author !== undefined || tags.length > 0 || entry.updated !== undefined;
  return (
    <div className={`item plugin-row browse-row is-${state}`} role="listitem">
      <PluginIconView icon={icon ?? entryIcon(entry)} />
      <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <strong>{entry.name}</strong>
          {entry.version && <span className="dim">v{entry.version}</span>}
          {entry.default && <span className="badge dim" title="One of the plugins the editor lists out of the box">default</span>}
          {entry.unlisted && <span className="badge dim" title="You have this plugin, but no registry being searched lists it — it came from its own address">not listed</span>}
          {tooNew && <span className="badge warn" title={`Needs plugin API ${entry.api}; this editor has ${PLUGIN_API_VERSION}`}>needs a newer editor</span>}
        </div>
        {entry.description && <span className="hint">{entry.description}</span>}
        {/* Author, tags and the date sat in the same faint grey as the description above
            them, so the row read as two lines of prose. They are facts about the plugin
            rather than more description: each gets its own mark and its own colour. */}
        {hasMeta && (
          <div className="plugin-meta">
            {entry.author && <span className="plugin-by"><User size={10} />{entry.author}</span>}
            {tags.map((t) => <span key={t} className="plugin-tag">{t}</span>)}
            {entry.updated && (
              <span className="plugin-updated" title={`Last updated ${entry.updated}`}>
                <Clock size={10} />{entry.updated.slice(0, 10)}
              </span>
            )}
          </div>
        )}
        <span className="hint mono" style={{ opacity: 0.7 }}>{entry.spec}</span>
      </div>
      <div className="plugin-row-actions">
        <div className="row" style={{ gap: 4 }}>
          {entry.repo && (
            <Button size="sm" title="Read the source" onClick={() => window.open(entry.repo, "_blank", "noopener,noreferrer")}>
              <ExternalLink size={11} /> Source
            </Button>
          )}
          {state === "new" && (
            <Button size="sm" variant="primary" disabled={busy || tooNew} onClick={onInstall}>
              {busy ? <LoaderCircle size={11} className="spin" /> : <Download size={11} />} Install
            </Button>
          )}
          {state === "disabled" && <Button size="sm" title="Turn it on" onClick={onEnable}>Turn on</Button>}
          {state !== "new" && (
            <Button size="sm" title="Show this plugin under Installed" onClick={onManage}>
              <Settings2 size={11} /> Manage
            </Button>
          )}
        </div>
        {state === "installed" && <span className="plugin-here on"><CircleCheck size={11} /> Installed</span>}
        {state === "disabled" && <span className="plugin-here"><CircleSlash size={11} /> Installed, turned off</span>}
      </div>
    </div>
  );
}

/** The registries in use, what each last said, and the field for adding another. */
function RegistrySources() {
  const store = useStore();
  useAtomValue(userRegistriesAtom);
  const cache = useAtomValue(registryCacheAtom);
  const states = useAtomValue(registryStateAtom);
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const add = () => {
    try {
      const added = addRegistry(store, url);
      setUrl("");
      setProblem(null);
      void loadRegistry(store, added, { force: true });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="pane-label">Registries</span>
      <p className="hint">
        A registry is one file listing plugins. The project's own is fetched from
        its repository; add another to browse someone else's list. Being listed is not a
        promise about the plugin — installing one still shows you where it comes from first.
      </p>
      <div className="listbox" role="list">
        {registryUrls(store).map((u) => {
          const st = states[u];
          const held = cache[u];
          return (
            <div key={u} className="item plugin-row" role="listitem">
              <Globe size={14} className="dim" />
              <div className="col grow" style={{ gap: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <strong>{held?.registry.name ?? hostOf(u)}</strong>
                  {st?.status === "loading" && <span className="badge dim"><LoaderCircle size={9} className="spin" />reading…</span>}
                  {isDefaultRegistry(u) && <span className="badge dim">default</span>}
                </div>
                <span className="hint mono" style={{ opacity: 0.7 }}>{u}</span>
                {held && (
                  <span className="hint">
                    {held.registry.plugins.length} plugin{held.registry.plugins.length === 1 ? "" : "s"}
                    {held.registry.skipped > 0 && `, ${held.registry.skipped} entr${held.registry.skipped === 1 ? "y" : "ies"} skipped`}
                    {` · read ${new Date(held.at).toLocaleString()}`}
                  </span>
                )}
                {st?.status === "error" && st.error && <span className="error-text">{st.error}</span>}
              </div>
              {!isDefaultRegistry(u) && (
                <Button size="sm" title="Remove this registry" onClick={() => removeRegistry(store, u)}><Trash2 size={11} /></Button>
              )}
            </div>
          );
        })}
      </div>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <TextInput
          className="mono grow"
          placeholder="https://example.com/plugins/index.json"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setProblem(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          aria-label="Registry address"
        />
        <Button onClick={add} disabled={url.trim() === ""}><Plus size={12} /> Add</Button>
      </div>
      {problem && <span className="error-text">{problem}</span>}
    </div>
  );
}

/** The three ways of looking at the browse list, and what each is called above it. */
const BROWSE_FILTERS = [
  { value: "all", label: "All" },
  { value: "available", label: "Not installed" },
  { value: "installed", label: "Installed" },
] as const;
type BrowseFilter = (typeof BROWSE_FILTERS)[number]["value"];

/**
 * Browse: search the registries and install from them. The list is whatever was last read
 * (`registryCacheAtom`), so it paints before the network answers and still shows something
 * when the network does not answer at all; the refresh runs behind it.
 *
 * The pane used to be one flat list in registry order, which read as a near-copy of the
 * Installed tab: every plugin the project publishes is a default, so almost every row was
 * one the editor already had, and the only thing saying so was a badge sat among the
 * others. It is split instead — `groupByInstall` over the search results, headed groups
 * with what can be installed first, and a filter on the same split with the counts on it,
 * so "what is there that I do not have" is one click and usually the top of the list.
 *
 * The list is the registries' entries **plus** the plugins the editor has that none of
 * them carries (`unlistedInstalls`). Browse reads as the list of plugins there are, so a
 * plugin installed from its own address — or one a registry has stopped listing — went
 * missing from the only place it was looked for while running perfectly well in the other
 * tab. Nothing installed can fall out of this list now, whatever a registry says.
 */
function BrowsePane({ onManage }: { onManage: (spec: string) => void }) {
  const store = useStore();
  const installed = useAtomValue(installedPluginsAtom);
  const runtimes = useAtomValue(pluginRuntimesAtom);
  const cache = useAtomValue(registryCacheAtom);
  const states = useAtomValue(registryStateAtom);
  useAtomValue(userRegistriesAtom);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BrowseFilter>("all");
  const [busySpec, setBusySpec] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sources, setSources] = useState(false);

  const urls = registryUrls(store);
  const loading = urls.some((u) => states[u]?.status === "loading");
  const failures = urls.map((u) => states[u]).filter((s) => s?.status === "error");
  const registries = urls.map((u) => cache[u]?.registry).filter((r): r is Registry => r !== undefined);
  const listed = mergeRegistries(registries);
  // What the editor has, described from the manifest the loader read for it, so a plugin
  // no registry carries still has a name, a version and an icon here rather than a spec.
  const mine: InstalledPlugin[] = effectiveInstalls(installed, defaultPlugins()).map((p) => {
    const m = runtimes[p.spec]?.manifest;
    return { spec: p.spec, name: m?.name, version: m?.version, description: m?.description, author: m?.author, homepage: m?.homepage, icon: m?.icon, api: m?.api };
  });
  const entries = [...listed, ...unlistedInstalls(mine, listed, pluginKey)];
  const results = searchRegistry(entries, query);

  // One pass on open: recent enough lists are left alone (`REGISTRY_MAX_AGE`), so this is
  // usually free and the pane is painted from storage.
  useEffect(() => { void loadRegistries(store); }, [store]);

  // A registry names a plugin, an install names a version of it — a pinned commit, a
  // tag, the bundled copy — so the two are matched on `pluginKey`. Comparing the specs
  // would make every pinned or bundled plugin look uninstalled and offer Install for
  // something already running.
  const installOf = (spec: string) => effectiveInstalls(installed, defaultPlugins()).find((p) => pluginKey(p.spec) === pluginKey(spec));
  const state = (spec: string): InstallState => {
    const found = installOf(spec);
    return !found ? "new" : found.enabled ? "installed" : "disabled";
  };

  const groups = groupByInstall(results, (e) => state(e.spec));
  const counts: Record<BrowseFilter, number> = {
    all: results.length,
    available: groups.available.length,
    installed: groups.installed.length,
  };
  // Headed groups are only worth their lines when both are on screen at once.
  const sections: { key: BrowseFilter; label: string; rows: RegistryEntry[] }[] = [
    { key: "available", label: "Not installed", rows: filter === "installed" ? [] : groups.available },
    { key: "installed", label: "Already installed", rows: filter === "available" ? [] : groups.installed },
  ];
  const headed = sections.filter((g) => g.rows.length > 0).length > 1;
  const shown = sections.reduce((n, g) => n + g.rows.length, 0);

  const install = async (entry: RegistryEntry) => {
    if (busySpec) return;
    setBusySpec(entry.spec);
    setProblem(null);
    try {
      const preview = await inspectPlugin(entry.spec);
      if (!preview.manifest) { setProblem(`${NOT_FOUND} ${preview.problem ?? ""}`.trim()); return; }
      store.set(openDialogAtom, "confirmPlugin", { spec: preview.spec, preview });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setBusySpec(null);
    }
  };

  const enable = (spec: string) => {
    const found = installOf(spec);
    if (!found) return;
    setInstalled(store, found.spec, { enabled: true });
    void activatePlugin(store, found.spec);
  };

  // The Installed tab holds the pinned spec, which is not the one the registry lists.
  const manage = (spec: string) => onManage(installOf(spec)?.spec ?? spec);

  const nothing = query.trim() !== ""
    ? `Nothing matches “${query.trim()}”${filter === "all" ? "" : " under this filter"}.`
    : filter === "available"
      ? "Everything on the list is already installed."
      : filter === "installed"
        ? "Nothing is installed yet."
        : loading && entries.length === 0
          ? "Reading the registry…"
          : "No plugin list could be read. Check the Sources, or paste a plugin's address under Installed.";

  return (
    <div className="stack plugin-manage">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <TextInput
          className="grow"
          placeholder="Search plugins"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search plugins"
        />
        <Button title="Read every registry again" disabled={loading} onClick={() => { void loadRegistries(store, { force: true }); }}>
          {loading ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />} Refresh
        </Button>
        <Button active={sources} onClick={() => setSources((s) => !s)} title="The lists being searched">
          <Globe size={12} /> Sources
        </Button>
      </div>
      {problem && <span className="error-text">{problem}</span>}
      {sources
        ? <RegistrySources />
        : (
          <>
            <div className="row browse-filters">
              {BROWSE_FILTERS.map((f) => (
                <Button key={f.value} size="sm" active={filter === f.value} onClick={() => setFilter(f.value)}>
                  {f.label} <span className="dim">{counts[f.value]}</span>
                </Button>
              ))}
              <span className="grow" />
              {query.trim() !== "" && <span className="hint">{results.length} of {entries.length} match</span>}
            </div>
            <div className="listbox plugin-list">
              {sections.map((g) => g.rows.length === 0 ? null : (
                <div key={g.key} role="list" aria-label={g.label} className="browse-group">
                  {headed && <div className="header">{g.label}</div>}
                  {g.rows.map((e) => (
                    <BrowseRow
                      key={e.spec}
                      entry={e}
                      icon={runtimes[e.spec]?.icon}
                      state={state(e.spec)}
                      busy={busySpec === e.spec}
                      onInstall={() => { void install(e); }}
                      onEnable={() => enable(e.spec)}
                      onManage={() => manage(e.spec)}
                    />
                  ))}
                </div>
              ))}
              {shown === 0 && (
                <div className="item">
                  <span className="hint">{nothing}</span>
                </div>
              )}
            </div>
            {failures.length > 0 && (
              <span className="hint error-text">
                {failures.length === 1 ? "A registry could not be read" : `${failures.length} registries could not be read`} — see Sources.
              </span>
            )}
          </>
        )}
    </div>
  );
}

/* ── Managing what is installed ─────────────────────────── */

/** The version a spec names, as the confirmation prints it: the tag, or a short commit. */
function replacedVersion(spec: string): string {
  const at = spec.lastIndexOf("@");
  if (at < 0) return spec;
  const ref = spec.slice(at + 1).split("/")[0];
  return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}

/** How a check's address reads in a sentence: the repository, not the whole spec. */
function addressLabel(spec: string): string {
  const bare = unpin(spec);
  return bare.startsWith("github:") ? bare.slice("github:".length) : bare;
}

/** What to call the version an update would move to: its own version, else the commit. */
function offeredVersion(preview: PluginPreview): string {
  return preview.manifest?.version ? `v${preview.manifest.version}` : preview.pin ? preview.pin.short : "the newest commit";
}

/**
 * The list of plugins this editor has, and the field for adding one.
 *
 * `focus` is a spec Browse asked to be shown (its Manage button): the row is scrolled to
 * and flashed once rather than merely being somewhere in the list, since the whole point
 * of the jump is that the user could not find it.
 */
function InstalledPane({ focus }: { focus?: string | null }) {
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
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!focus) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-spec="${CSS.escape(focus)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
    row.classList.add("flash");
    const timer = window.setTimeout(() => row.classList.remove("flash"), 1500);
    return () => window.clearTimeout(timer);
  }, [focus]);

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
    // The button is off while a look-up runs; Enter in the field would otherwise start a second one.
    if (!s || looking) return;
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
  }, [spec, looking, list, store]);

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
  //
  // The button is on every pinned row whether or not anything is newer, so *most* presses
  // can only answer "nothing is". That answer used to be one dim line at the top of the
  // pane, which for a button near the bottom of a scrolling list read as the press doing
  // nothing at all. It lands three ways now: on the row that asked (`checked`), as a toast
  // — the channel the rest of the editor answers in — and, when there *is* a newer commit,
  // by the button itself becoming the offer, so cancelling the confirmation does not lose
  // what the check found.
  //
  // The answers live in `pluginUpdatesAtom` rather than here: the startup check
  // (`plugins/updates.ts`) writes the rows it found newer versions for, so the notice's
  // button opens this pane with *Update to v…* already on them, and closing the dialog
  // does not throw a check away.
  const [checking, setChecking] = useState<string | null>(null);
  const [checked, setCheckedAll] = useAtom(pluginUpdatesAtom);
  const setChecked = (fn: (c: Record<string, PluginUpdateAnswer>) => Record<string, PluginUpdateAnswer>) => setCheckedAll(fn);
  const answer = (s: string, a: PluginUpdateAnswer) => {
    setChecked((c) => ({ ...c, [s]: a }));
    if (a.kind === "current") store.set(pushToastAtom, { kind: "info", title: "No update", detail: a.text });
    else if (a.kind === "problem") store.set(pushToastAtom, { kind: "warn", title: "Could not check for an update", detail: a.text });
  };
  const offer = (s: string, preview: PluginPreview) => {
    store.set(openDialogAtom, "confirmPlugin", { spec: preview.spec, replaces: s, preview });
  };
  // `s` is the row (what gets replaced); `address` is what to ask, which for a bundled
  // plugin is the remote spec it was vendored from. `version` is what the row is running,
  // which the check uses as its last word on whether a release is a new one at all.
  const update = async (s: string, address: string, version?: string) => {
    setChecking(s);
    setChecked((c) => { const next = { ...c }; delete next[s]; return next; });
    try {
      const { preview, newer, tag } = await checkForUpdate(address, undefined, { version });
      if (!preview.manifest) {
        answer(s, { kind: "problem", text: `${NOT_FOUND} ${preview.problem ?? ""}`.trim() });
      } else if (newer && preview.pin) {
        setChecked((c) => ({ ...c, [s]: { kind: "newer", version: preview.manifest?.version ?? tag, preview } }));
        offer(s, preview);
      } else if (preview.pin) {
        // Naming the version is the whole answer: "the newest commit" said nothing about
        // whether the plugin had been released since, which is what was actually asked.
        const at = tag ?? (preview.manifest.version ? `v${preview.manifest.version}` : preview.pin.short);
        answer(s, { kind: "current", text: `${preview.manifest.name} ${at} is the newest version there is.` });
      } else {
        answer(s, { kind: "problem", text: preview.pinProblem ?? "Could not ask for a newer version." });
      }
    } catch (err) {
      answer(s, { kind: "problem", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setChecking(null);
    }
  };

  // The rows a check can be made for, in list order; `checkAll` runs them one after
  // another rather than at once, since every check is a GitHub request or two from the
  // same address.
  const checkable = list.flatMap((p) => { const a = updateAddress(p.spec); return a ? [{ spec: p.spec, address: a, version: runtimes[p.spec]?.manifest?.version }] : []; });
  const checkAll = async () => {
    for (const c of checkable) await update(c.spec, c.address, c.version);
  };

  return (
    <div className="stack plugin-manage">
      <div className="plugin-add">
        <span className="pane-label">Add a plugin</span>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <TextInput
            className="mono grow"
            placeholder="https://github.com/owner/repo"
            value={spec}
            onChange={(e) => { setSpec(e.target.value); setProblem(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
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
                Paste a link to the plugin. Any address {hostTerms().here} can read will do: a git repository, a folder
                inside one, or the <span className="mono">plugin.json</span> itself. The ones the project
                publishes are under <strong>Browse</strong>.
              </p>
              <ul className="hint plugin-examples">
                <li><span className="mono">https://github.com/owner/repo</span></li>
                <li><span className="mono">https://github.com/owner/repo/tree/v1.2/plugins/my-plugin</span></li>
                <li><span className="mono">https://gitlab.com/owner/repo/-/raw/main/plugin.json</span></li>
                <li><span className="mono">https://example.com/my-plugin/plugin.json</span></li>
              </ul>
              <p className="hint">
                Repositories on GitHub can also be written <span className="mono">github:owner/repo@v1.2</span>, and are the
                ones that can be pinned to a version.
              </p>
            </>
          )}
      </div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span className="pane-label">Installed</span>
        {checkable.length > 0 && (
          <Button
            size="sm"
            title="Ask every plugin's repository for its newest release, one after another. Nothing is downloaded by the check."
            disabled={checking !== null}
            onClick={() => { void checkAll(); }}
          >
            {checking !== null ? <LoaderCircle size={11} className="spin" /> : <ArrowUp size={11} />} Check all for updates
          </Button>
        )}
      </div>
      <div className="listbox plugin-list" role="list" ref={listRef}>
        {list.map((p) => {
          const rt = runtimes[p.spec];
          // The spec this editor ships for the plugin, when it is one of the defaults. It
          // differs from the row's own once the user has moved that default forward, which
          // is the only way back to the version the build was tested with.
          const shipped = defaults.find((d) => pluginKey(d) === pluginKey(p.spec));
          const isDefault = shipped !== undefined;
          const pinnedSpec = isPinned(p.spec);
          // What an update check would ask about: this spec, or the address a bundled copy
          // was built from. Null for a plugin that follows a branch — Reload is its update.
          const address = updateAddress(p.spec);
          const copy = snapshots[p.spec];
          const builtinPlugin = p.spec.startsWith("builtin:");
          const name = rt?.manifest?.name ?? (builtinPlugin ? p.spec.slice("builtin:".length) : p.spec);
          // Until the manifest is in, the spec *is* the name — printing it twice reads as a bug.
          const named = rt?.manifest != null || builtinPlugin;
          const status = statusLabel(rt, p.enabled);
          const answered = checked[p.spec];
          return (
            <div key={p.spec} className="item plugin-row" role="listitem" data-spec={p.spec}>
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
                  {address !== null && (answered?.kind === "newer"
                    ? (
                      // A startup answer names a version and carries no preview yet: the press
                      // makes the same check the button below does and then offers it.
                      <Button
                        size="sm"
                        variant="primary"
                        title="Show what is in the newer version before switching to it"
                        disabled={checking === p.spec}
                        onClick={() => { if (answered.preview) offer(p.spec, answered.preview); else void update(p.spec, address, rt?.manifest?.version); }}
                      >
                        {checking === p.spec ? <LoaderCircle size={11} className="spin" /> : <ArrowUp size={11} />} Update to {answered.preview ? offeredVersion(answered.preview) : `v${answered.version ?? "?"}`}
                      </Button>
                    )
                    : (
                      <Button size="sm" title={`Ask ${addressLabel(address)} whether it has moved on, and show what it holds before switching to it. Nothing is downloaded until you press this.`} disabled={checking === p.spec} onClick={() => { void update(p.spec, address, rt?.manifest?.version); }}>
                        {checking === p.spec ? <LoaderCircle size={11} className="spin" /> : <ArrowUp size={11} />} Check for update
                      </Button>
                    ))}
                  <Button size="sm" title="Fetch the plugin again from its address (and replace any copy kept here)" disabled={!p.enabled} onClick={() => { void reloadPlugin(store, p.spec); }}><RefreshCw size={11} /> Reload</Button>
                  {!isDefault && <Button size="sm" title="Remove from the list" onClick={() => remove(p.spec)}><Trash2 size={11} /></Button>}
                  {shipped !== undefined && shipped !== p.spec && (
                    <Button
                      size="sm"
                      title={shipped.startsWith("builtin:")
                        ? "Go back to the copy compiled into this build, which is fetched from nowhere"
                        : `Go back to ${replacedVersion(shipped)}, the version this editor ships`}
                      onClick={() => remove(p.spec)}
                    >
                      <RotateCcw size={11} /> Revert
                    </Button>
                  )}
                </div>
                {answered?.kind === "current" && (
                  <span className="plugin-here on" title={answered.text}><CircleCheck size={11} /> Up to date</span>
                )}
                {answered?.kind === "problem" && (
                  <span className="plugin-here bad" title={answered.text}><TriangleAlert size={11} /> Could not check</span>
                )}
                {/* The copy used to be an icon button next to Reload, which said nothing about what
                    it did or whether it was on. It is a labelled tick under the buttons instead.
                    The label and the tooltip say the same thing whether it is on or off — a
                    description that rewrites itself as you tick it reads as two different options —
                    so the only thing that follows the state is the size of the copy, which is
                    status rather than explanation, and is shown rather than hidden in a tooltip. */}
                <span
                  className="plugin-copy"
                  title={builtinPlugin ? BUILTIN_COPY_HINT : localCopyHint()}
                >
                  <HardDrive size={11} />
                  <Check
                    label="Load from a copy saved here"
                    checked={p.local === true}
                    disabled={builtinPlugin}
                    onChange={(e) => toggleLocal(p.spec, e.target.checked)}
                    aria-label={`Load ${name} from a copy saved in ${hostTerms().here}`}
                  />
                  {p.local === true && !builtinPlugin && (
                    <span className="dim">{copy ? `· ${Math.max(1, Math.round(copy.size / 1024))} KB` : "· not saved yet"}</span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="hint">
        To write one, put a <span className="mono">plugin.json</span> next to
        a <span className="mono">plugin.ts</span> or <span className="mono">plugin.js</span> anywhere {hostTerms().here} can read
        it. The API is in <span className="mono">docs/plugins.md</span>.
      </p>
    </div>
  );
}

/**
 * The two halves of the same subject: the list of plugins there are (Browse, from the
 * registries) and the list of plugins this editor has (Installed). The payload's `tab`
 * picks which opens — Plugins ▸ Browse Plugins… and Plugins ▸ Manage Plugins… are the
 * same dialog.
 */
export function PluginsDialog({ entry }: DialogProps) {
  const store = useStore();
  const [tab, setTab] = useState((entry.payload?.tab as string) ?? "installed");
  // A row Browse asked the Installed tab to show — or the one the update notice's button
  // was pressed for (`payload.focus`); cleared again on leaving the tab, so coming back
  // later does not flash a row nobody asked about.
  const [focus, setFocus] = useState<string | null>((entry.payload?.focus as string | undefined) ?? null);
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
      <Tabs
        className="grow plugin-tabs"
        value={tab}
        onValueChange={(v) => { setTab(v); if (v !== "installed") setFocus(null); }}
        tabs={[
          {
            value: "browse",
            label: "Browse",
            icon: <Search size={12} />,
            content: <BrowsePane onManage={(spec) => { setFocus(spec); setTab("installed"); }} />,
          },
          { value: "installed", label: "Installed", icon: <Blocks size={12} />, content: <InstalledPane focus={focus} /> },
        ]}
      />
    </DialogFrame>
  );
}
