import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { FilePlus2, FolderOpen, ImageDown, Loader2, Save, TriangleAlert, Upload } from "lucide-react";
import { fogViewPlayerAtom, gridSizeAtom, mapFilePathAtom, mapModifiedAtom, mapNameAtom, mapOriginAtom, saveOptionsAtom } from "../../atoms/editorAtoms";
import { archiveExtrasAtom, loadDocumentAtom, recentFilesAtom, scenarioAtom } from "../../atoms/documentAtoms";
import { closeDialogAtom, openDialogAtom, pushToastAtom, statusMessageAtom } from "../../atoms/uiAtoms";
import { MAP_SIZES, terrainName, TILESETS, TILESET_BY_ID, type TilesetId } from "../../data/tilesets";
import { DEFAULT_START_PLACEMENT, idealStarts } from "../../editor/startLocations";
import { baseTerrain } from "../../formats/tileset/terrain";
import { renderTerrainPatch, type TerrainPatch } from "../../formats/tileset/preview";
import { PREVIEW_TILES, useTilesetGraphics, useTilesetThumbs } from "../../hooks/useTilesetPreview";
import { MapPreview, PatchThumb, type PreviewStart } from "./TerrainPreview";
import { DEFAULT_NEW_MAP, saveDocument, useMapFileActions, type PendingAction } from "../../hooks/useMapFileActions";
import { preferencesAtom } from "../../atoms/preferencesAtoms";
import { hostTerms } from "../../editor/platform";
import { canPickSaveLocation, droppedHandle, MAP_FILE_ACCEPT, openMapFile, pickMapFile, saveBlob, type PickedMapFile } from "../../services/mapIo";
import {
  buildMapFile, DEFAULT_SAVE_OPTIONS, defaultSaveOptions, formatBytes, planSave, SAVE_PRESETS, type MapFormat, type SaveOptions,
} from "../../editor/save";
import { issueCounts, validateScenario } from "../../editor/validate";
import type { ArchiveCompression, MemberInfo } from "../../formats/mpq/scm";
import {
  DEFAULT_IMAGE_OPTIONS, drawsSprites, exportMapImage, IMAGE_SCALES, imageSize, loadMapImageAssets, renderMapImage,
  type MapImageOptions,
} from "../../services/mapImage";
import { Button, Check, Field, Group, ListBox, NumberInput, Select, TextArea, TextInput } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/** Height of a tileset card's thumbnail; it stretches to the card's width. */
const CARD_H = 44;

/* ── New Map ────────────────────────────────────────────── */

/** Where the dialog marks the starts it is about to place; the fit search moves them a little. */
function previewStarts(width: number, height: number, players: number, place: boolean): PreviewStart[] {
  if (!place || players < 1) return [];
  return idealStarts(width, height, players, DEFAULT_START_PLACEMENT.layout, DEFAULT_START_PLACEMENT.margin);
}

export function NewMapDialog({ entry }: DialogProps) {
  const { guard } = useMapFileActions();
  const prefs = useAtomValue(preferencesAtom);

  const [tileset, setTs] = useState<TilesetId>(prefs.newMap.tileset);
  const [w, setLocalW] = useState(prefs.newMap.width);
  const [h, setLocalH] = useState(prefs.newMap.height);
  const [terrain, setTerrain] = useState(TILESET_BY_ID[prefs.newMap.tileset].defaultIsom);
  const [name, setLocalName] = useState(DEFAULT_NEW_MAP.name);
  const [desc, setLocalDesc] = useState(DEFAULT_NEW_MAP.description);
  const [players, setPlayers] = useState(4);
  const [autoStarts, setAutoStarts] = useState(true);

  const thumbs = useTilesetThumbs();
  // The chosen tileset's graphics, so the map preview can be drawn at any terrain and size.
  const { tileset: graphics, loading } = useTilesetGraphics(tileset);

  const ts = TILESET_BY_ID[tileset];
  const swatches = thumbs.get(tileset)?.swatches ?? null;
  // Terrain the graphics can actually draw; the reference list when there are none.
  const terrainList = swatches ?? ts.terrain.map((t) => ({ ...t, group: -1, patch: null as TerrainPatch | null }));
  const pick = (id: TilesetId) => { setTs(id); setTerrain(TILESET_BY_ID[id].defaultIsom); };

  const patch = useMemo(() => {
    if (!graphics) return null;
    const base = baseTerrain(graphics, terrain);
    return renderTerrainPatch(graphics, base, PREVIEW_TILES.cols, PREVIEW_TILES.rows);
  }, [graphics, terrain]);
  const starts = useMemo(() => previewStarts(w, h, players, autoStarts), [w, h, players, autoStarts]);

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="New Scenario"
      icon={<FilePlus2 size={14} />}
      size="lg"
      okLabel="Create"
      onOk={() => {
        guard({
          action: "new",
          options: {
            width: w, height: h, tileset, name: name || DEFAULT_NEW_MAP.name, description: desc, terrainId: terrain,
            startLocations: autoStarts ? players : 0,
          },
        });
      }}
      footerLeft={<span>{ts.name} · {w}×{h} · {terrainName(ts, terrain)}{autoStarts && players > 0 ? ` · ${players} start${players === 1 ? "" : "s"}` : ""}</span>}
    >
      <Group title="Tileset">
        <div className="tileset-grid">
          {TILESETS.map((t) => (
            <button key={t.id} className={`tileset-card ${tileset === t.id ? "selected" : ""}`} onClick={() => pick(t.id)}>
              <PatchThumb patch={thumbs.get(t.id)?.card ?? null} color={t.color} height={CARD_H} className="thumb" />
              <span>{t.name}</span>
            </button>
          ))}
        </div>
      </Group>
      <div className="split" style={{ ["--split" as string]: "1fr" }}>
        <div className="stack">
          <Group title="Dimensions">
            <div className="form">
              <Field label="Width × Height">
                <div className="row">
                  <Select style={{ width: 90 }} value={String(w)} onChange={(e) => setLocalW(Number(e.target.value))} options={MAP_SIZES.map((s) => String(s))} />
                  <span className="dim">×</span>
                  <Select style={{ width: 90 }} value={String(h)} onChange={(e) => setLocalH(Number(e.target.value))} options={MAP_SIZES.map((s) => String(s))} />
                  <span className="hint">tiles</span>
                </div>
              </Field>
              <Field label="Start locations" hint={autoStarts ? "Placed on a ring, each nudged to the nearest ground it fits on." : "Add them yourself on the Units layer, or with Tools ▸ Auto-place."}>
                <div className="row">
                  <NumberInput value={players} onChange={setPlayers} min={1} max={8} width={90} disabled={!autoStarts} />
                  <Check label="Place automatically" checked={autoStarts} onChange={(e) => setAutoStarts(e.target.checked)} />
                </div>
              </Field>
            </div>
          </Group>
          <Group title="Scenario">
            <div className="form">
              <Field label="Name"><TextInput value={name} onChange={(e) => setLocalName(e.target.value)} /></Field>
              <Field label="Description"><TextArea rows={3} value={desc} onChange={(e) => setLocalDesc(e.target.value)} placeholder="Shown in the game lobby…" /></Field>
            </div>
          </Group>
          <Group title="Initial terrain" flush className="terrain-group">
            <div className="listbox terrain-picker">
              {terrainList.map((t) => (
                <button
                  key={t.id}
                  className={`row ${terrain === t.id ? "selected" : ""}`}
                  onClick={() => setTerrain(t.id)}
                >
                  <PatchThumb patch={t.patch} color={ts.color} width={22} height={22} className="swatch" />
                  <span>{t.name}</span>
                </button>
              ))}
            </div>
          </Group>
        </div>
        <div className="stack">
          <Group title="Preview">
            <MapPreview patch={patch} color={ts.color} width={w} height={h} starts={starts} />
            <p className="hint" style={{ marginTop: 8 }}>
              {w * h} tiles · {w * 32}×{h * 32} px
              {!graphics && !loading && " · no tileset graphics, showing flat colour"}
            </p>
          </Group>
        </div>
      </div>
    </DialogFrame>
  );
}

/* ── Open Map ───────────────────────────────────────────── */

export function OpenMapDialog({ entry }: DialogProps) {
  const recents = useAtomValue(recentFilesAtom);
  const [sel, setSel] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const close = useSetAtom(closeDialogAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const load = useSetAtom(loadDocumentAtom);
  const { guard, openRecent } = useMapFileActions();
  const modified = useAtomValue(mapModifiedAtom);
  const prefs = useAtomValue(preferencesAtom);
  const reopen = async (i: number) => {
    const r = recents[i];
    if (!r?.handleKey) { setError(`${r?.name ?? "This file"} cannot be reopened from here — browse for it.`); return; }
    setBusy(true);
    setError(null);
    const ok = await openRecent(r);
    setBusy(false);
    if (ok) close(entry.key);
  };

  const accept = useCallback(async (picked: PickedMapFile | null) => {
    if (!picked) return;
    const { file, handle } = picked;
    // Unsaved changes: hand the file to the Close Scenario dialog and let it decide.
    if (prefs.confirmClose && modified) {
      close(entry.key);
      guard({ action: "open", file, handle });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const doc = await openMapFile(file, handle);
      load(doc);
      const warnings = doc.scenario.warnings.length;
      setStatus(
        `Opened ${file.name} — ${doc.scenario.width}×${doc.scenario.height}` +
        (warnings > 0 ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""),
      );
      close(entry.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [close, entry.key, load, setStatus, guard, modified, prefs.confirmClose]);

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Open Scenario"
      icon={<FolderOpen size={14} />}
      size="md"
      okLabel="Browse…"
      onOk={() => { void accept(null); }}
      footer={
        <>
          {sel !== null && recents[sel]?.handleKey && <Button variant="primary" disabled={busy} onClick={() => { void reopen(sel); }}>Open {recents[sel].name}</Button>}
          <Button variant={sel !== null && recents[sel]?.handleKey ? undefined : "primary"} disabled={busy} onClick={() => { void pickMapFile().then(accept); }}>
            {busy ? <><Loader2 size={13} className="spin" /> Opening…</> : "Browse…"}
          </Button>
          <Button onClick={() => close(entry.key)}>Cancel</Button>
        </>
      }
      footerLeft={<span>Supports {MAP_FILE_ACCEPT.split(",").join(" · ")}</span>}
    >
      <div
        className={`dropzone${dragging ? " dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (!file) return;
          void droppedHandle(e.dataTransfer).then((handle) => accept({ file, handle }));
        }}
      >
        <Upload size={22} />
        <div><strong>Drop a map file here</strong></div>
        <div className="hint">or</div>
        <Button disabled={busy} onClick={() => { void pickMapFile().then(accept); }}>Browse…</Button>
      </div>
      {error && <p className="error-text">{error}</p>}
      <Group title="Recent" flush>
        {recents.length === 0
          ? <p className="hint" style={{ padding: "10px 12px" }}>Nothing opened yet.</p>
          : (
            <div onDoubleClick={() => { if (sel !== null) void reopen(sel); }} onKeyDown={(e) => { if (e.key === "Enter" && sel !== null) { e.preventDefault(); void reopen(sel); } }}>
              <ListBox items={recents} selected={sel} onSelect={setSel} style={{ height: 120 }} render={(r) => <><FolderOpen size={12} className={r.handleKey ? "" : "faint"} /><span className="mono">{r.name}</span><span className="faint" style={{ marginLeft: "auto", fontSize: 10 }}>{r.handleKey ? "double-click to reopen" : "browse for it"}</span></>} />
            </div>
          )}
      </Group>
    </DialogFrame>
  );
}

/* ── Save ───────────────────────────────────────────────── */

const FORMAT_OPTIONS: { value: MapFormat; label: string }[] = [
  { value: "scx", label: "Brood War scenario (.scx)" },
  { value: "scm", label: "StarCraft scenario (.scm)" },
  { value: "chk", label: "Raw chunk data (.chk)" },
];

const COMPRESSION_OPTIONS: { value: ArchiveCompression; label: string; hint: string }[] = [
  { value: "pkware", label: "PKWARE — what StarEdit writes", hint: "Every StarCraft build reads it. Blizzard's own maps are stored this way." },
  { value: "zlib", label: "zlib — smallest", hint: "StarCraft 1.16.1 and Remastered read it; older builds do not." },
  { value: "none", label: "None", hint: "The largest file; anything that opens an MPQ reads it." },
];

/** "PKWARE-compressed, encrypted, 4 KB sectors, 39.0 KB of 119.7 KB" */
function describeOrigin(o: MemberInfo): string {
  const method = o.compression === "pkware" ? "PKWARE-compressed"
    : o.compression === "zlib" ? "zlib-compressed"
    : o.compression === "none" ? "uncompressed"
    : "compressed with a method the editor cannot write";
  return `${method}, ${o.encrypted ? "encrypted" : "not encrypted"}, ${o.sectorSize / 1024} KB sectors, ${formatBytes(o.storedSize)} of ${formatBytes(o.size)}`;
}

const baseName = (name: string) => name.replace(/\.(scm|scx|chk)$/i, "").replace(/[\\/:*?"<>|]+/g, "").trim();

/**
 * File ▸ Save As and Save Copy As (`payload.copy`), and Save's first time for a map with no
 * file name. Every option is data (`editor/save.ts#planSave`), so the right-hand side shows
 * the sections and files that will be written, with their fates, before anything is; the
 * real bytes are built in the background for the size. The Save button hands the built
 * bytes to `saveDocument`, which asks the browser where (or downloads) and reports how it
 * went. `payload.done` hears the answer, for a caller awaiting it (Close Scenario's Save).
 */
export function SaveMapDialog({ entry }: DialogProps) {
  const copy = entry.payload?.copy === true;
  const done = entry.payload?.done as ((ok: boolean) => void) | undefined;
  const store = useStore();
  const scenario = useAtomValue(scenarioAtom);
  const extras = useAtomValue(archiveExtrasAtom);
  const path = useAtomValue(mapFilePathAtom);
  const origin = useAtomValue(mapOriginAtom);
  const stored = useAtomValue(saveOptionsAtom);
  const name = useAtomValue(mapNameAtom);
  const close = useSetAtom(closeDialogAtom);
  const openDialog = useSetAtom(openDialogAtom);

  const [file, setFile] = useState(() => (baseName(path ?? name) || "scenario") + (copy ? " copy" : ""));
  const [opts, setOpts] = useState<SaveOptions>(() => (scenario ? stored ?? defaultSaveOptions(scenario, origin, path) : DEFAULT_SAVE_OPTIONS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [built, setBuilt] = useState<{ options: SaveOptions; bytes: Uint8Array } | null>(null);

  const plan = useMemo(() => (scenario ? planSave(scenario, extras, opts) : null), [scenario, extras, opts]);
  const issues = useMemo(() => (scenario ? issueCounts(validateScenario(scenario, { extras })) : null), [scenario, extras]);

  // The real bytes, for the size: built a moment after the last change, off the click path.
  useEffect(() => {
    if (!scenario || !plan) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      buildMapFile(scenario, extras, opts, plan).then(
        (bytes) => { if (!cancelled) setBuilt({ options: opts, bytes }); },
        () => { if (!cancelled) setBuilt(null); },
      );
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [scenario, extras, opts, plan]);

  const set = <K extends keyof SaveOptions>(key: K, value: SaveOptions[K]) => setOpts((o) => ({ ...o, [key]: value }));
  const keepExtra = (n: string, keep: boolean) => set("omitExtras", keep ? opts.omitExtras.filter((x) => x !== n) : [...opts.omitExtras, n]);
  const ready = built && built.options === opts ? built.bytes : null;
  const archive = opts.format !== "chk";
  const compression = COMPRESSION_OPTIONS.find((c) => c.value === opts.compression) ?? COMPRESSION_OPTIONS[0];
  const counts = plan?.counts;
  const kept = plan ? plan.sections.filter((x) => x.fate !== "dropped").length : 0;
  const dropped = plan ? plan.sections.length - kept : 0;
  const keptExtras = plan ? plan.extras.filter((e) => e.kept).length : 0;

  const save = async () => {
    if (!scenario) return;
    setBusy(true);
    setError(null);
    try {
      const fileName = `${baseName(file) || "scenario"}.${opts.format}`;
      // Always through the browser's own dialog: Save As is the one that asks where.
      const ok = await saveDocument(store, { fileName, handle: null, options: opts, copy, bytes: ready ?? undefined });
      if (ok) {
        if (entry.payload) entry.payload.taken = true;
        done?.(true);
        close(entry.key);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={copy ? "Save a Copy" : "Save Scenario As"}
      icon={<Save size={14} />}
      size="lg"
      description={copy ? "Writes a copy; the open map keeps its own file and name." : undefined}
      footer={
        <>
          <Button variant="primary" disabled={busy || !scenario} onClick={() => { void save(); }}>
            {busy ? <><Loader2 size={13} className="spin" /> Saving…</> : copy ? "Save Copy" : "Save"}
          </Button>
          <Button onClick={() => close(entry.key)}>Cancel</Button>
        </>
      }
      footerLeft={plan && (
        <span className="mono">
          {ready ? formatBytes(ready.length) : "…"}
          {archive ? ` · scenario.chk ${formatBytes(plan.chkSize)}` : ""}
        </span>
      )}
    >
      {!scenario && <p className="error-text">Open a map first — there is nothing to save.</p>}
      {scenario && plan && counts && (
        <div className="split" style={{ ["--split" as string]: "minmax(300px, 1fr)" }}>
          <div className="stack">
            <Group title="File">
              <div className="form wide">
                <Field label="File name">
                  <div className="row">
                    <TextInput value={file} onChange={(e) => setFile(e.target.value)} />
                    <span className="mono dim">.{opts.format}</span>
                  </div>
                </Field>
                <Field label="Format" hint={opts.format === "chk" ? "The scenario alone, no archive around it." : "The extension does not change the map's revision; Scenario ▸ Map Revision does."}>
                  <Select value={opts.format} onChange={(e) => set("format", e.target.value as MapFormat)} options={FORMAT_OPTIONS} />
                </Field>
              </div>
              {!canPickSaveLocation() && (
                <p className="hint" style={{ marginTop: 6 }}>{hostTerms().Here} cannot ask where to put the file: it goes to the downloads folder.</p>
              )}
            </Group>

            <Group title="Archive">
              <div className="form wide">
                <Field label="Compression" hint={archive ? compression.hint : "Not used for a bare .chk."}>
                  <Select value={opts.compression} disabled={!archive} onChange={(e) => set("compression", e.target.value as ArchiveCompression)} options={COMPRESSION_OPTIONS.map((c) => ({ value: c.value, label: c.label }))} />
                </Field>
              </div>
              <div className="col" style={{ gap: 2, marginTop: 6 }}>
                <Check label="Encrypt the files inside, as StarEdit does" checked={opts.encrypt} disabled={!archive} onChange={(e) => set("encrypt", e.target.checked)} />
              </div>
              {origin && <p className="hint" style={{ marginTop: 6 }}>Opened as {describeOrigin(origin)}.</p>}
              {plan.extras.length > 0 && (
                <>
                  <div className="pane-label" style={{ marginTop: 8 }}>Other files in the archive</div>
                  <div className="save-extras">
                    {plan.extras.map((e) => (
                      <Check
                        key={e.name}
                        checked={e.kept}
                        disabled={!archive}
                        onChange={(ev) => keepExtra(e.name, ev.target.checked)}
                        label={<><span className="path" title={e.name}>{e.name}</span><span className="dim">{e.kind === "script" ? "trigger script" : e.kind === "sound" ? "sound" : ""}</span><span className="size">{formatBytes(e.size)}</span></>}
                      />
                    ))}
                  </div>
                </>
              )}
            </Group>

            <Group title="Sections">
              <div className="save-presets">
                <span className="hint">Preset</span>
                <Button size="sm" onClick={() => setOpts(SAVE_PRESETS.everything)}>Everything</Button>
                <Button size="sm" onClick={() => setOpts(SAVE_PRESETS.smallest)}>Smallest that plays</Button>
              </div>
              <div className="col save-options" style={{ gap: 0, marginTop: 6 }}>
                <Check label={`Leave out terrain editing data — ISOM, TILE, DD2 (${counts.terrainEditing})`} checked={opts.stripTerrainEditing} disabled={counts.terrainEditing === 0} onChange={(e) => set("stripTerrainEditing", e.target.checked)} />
                <Check label={`Leave out editor bookkeeping — IVER, IVE2, IOWN, UPUS, SWNM, WAV (${counts.bookkeeping})`} checked={opts.stripBookkeeping} disabled={counts.bookkeeping === 0} onChange={(e) => set("stripBookkeeping", e.target.checked)} />
                <Check label={`Leave out sections the format reference does not know (${counts.unknown})`} checked={opts.stripUnknown} disabled={counts.unknown === 0} onChange={(e) => set("stripUnknown", e.target.checked)} />
                <Check label={`Merge repeated sections into one (${counts.repeated})`} checked={opts.mergeRepeats} disabled={counts.repeated === 0} onChange={(e) => set("mergeRepeats", e.target.checked)} />
                <Check label={`Drop bytes after the last section (${formatBytes(counts.trailing)})`} checked={opts.dropTrailing} disabled={counts.trailing === 0} onChange={(e) => set("dropTrailing", e.target.checked)} />
              </div>
              <p className="hint" style={{ marginTop: 6 }}>The game reads none of these; leaving them out changes what an editor can do with the file, not how it plays. The open map is not changed.</p>
            </Group>
          </div>

          <div className="stack">
            <Group title="What will be written" flush>
              <div className="save-sections">
                <table className="table">
                  <thead>
                    <tr><th>Section</th><th>What</th><th style={{ textAlign: "right" }}>Size</th><th></th></tr>
                  </thead>
                  <tbody>
                    {plan.sections.map((x) => (
                      <tr key={x.index} className={x.fate} title={x.reason}>
                        <td className="name">{x.name}</td>
                        <td>{x.what ?? <span className="faint">unknown</span>}{x.editorOnly && <span className="faint"> · editor only</span>}</td>
                        <td className="num">{formatBytes(x.size)}</td>
                        <td className="fate">
                          {x.fate === "dropped" && <span className="badge warn">left out</span>}
                          {x.fate === "merged" && <span className="badge teal">merged</span>}
                          {x.fate === "kept" && x.dirty && <span className="badge gold">changed</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Group>
            <div className="save-summary">
              <span className="k">scenario.chk</span>
              <span className="v">{formatBytes(plan.chkSize)}{plan.chkSize !== plan.chkSizeBefore ? ` (was ${formatBytes(plan.chkSizeBefore)})` : ""}</span>
              <span className="k">Sections</span>
              <span className="v">{kept} of {plan.sections.length}{dropped > 0 ? `, ${dropped} left out` : ""}</span>
              {archive && (
                <>
                  <span className="k">Archive</span>
                  <span className="v">{ready ? `${formatBytes(ready.length)} · ${compression.value === "none" ? "uncompressed" : compression.value}${opts.encrypt ? ", encrypted" : ""}` : "…"}</span>
                  {plan.extras.length > 0 && (
                    <>
                      <span className="k">Other files</span>
                      <span className="v">{keptExtras} of {plan.extras.length}</span>
                    </>
                  )}
                </>
              )}
              {issues && (
                <>
                  <span className="k">Check Map</span>
                  <span className="v row" style={{ gap: 8, alignItems: "center" }}>
                    <span className={`badge ${issues.error > 0 ? "danger" : issues.warn > 0 ? "warn" : "ok"}`}>
                      {issues.error > 0 ? `${issues.error} error${issues.error === 1 ? "" : "s"}` : issues.warn > 0 ? `${issues.warn} warning${issues.warn === 1 ? "" : "s"}` : "no problems"}
                    </span>
                    <Button size="sm" onClick={() => openDialog("validateMap")}>Open Check Map…</Button>
                  </span>
                </>
              )}
            </div>
            {plan.warnings.map((w) => (
              <div key={w} className="save-warning"><TriangleAlert size={13} /><span>{w}</span></div>
            ))}
          </div>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </DialogFrame>
  );
}

/* ── Confirm close ──────────────────────────────────────── */

/**
 * File ▸ Close / Exit, and the gate in front of New / Open / a dropped file when the map
 * has unsaved changes (`useMapFileActions().guard`). `payload.pending` is what to do
 * once the question is answered; without one the answer closes the map.
 */
export function ConfirmCloseDialog({ entry }: DialogProps) {
  const close = useSetAtom(closeDialogAtom);
  const [name] = useAtom(mapNameAtom);
  const modified = useAtomValue(mapModifiedAtom);
  const scenario = useAtomValue(scenarioAtom);
  const { save, runPending } = useMapFileActions();
  const [busy, setBusy] = useState(false);
  const pending = (entry.payload?.pending as PendingAction | undefined) ?? { action: "close" };
  const what = pending.action === "new" ? "creating a new scenario"
    : pending.action === "open" ? `opening ${pending.file.name}`
    : pending.action === "quit" ? "leaving" : "closing";
  const title = pending.action === "quit" ? "Quit scmJS" : "Close Scenario";

  // `taken` before the close: an open waiting on this answer (a plugin's `document.open`) watches
  // the dialog stack, and this is how it tells "going on" from a dismissal.
  const proceed = async () => { pending.taken = true; close(entry.key); await runPending(pending); };
  const saveFirst = async () => {
    setBusy(true);
    try {
      // A map without a file name goes through Save As instead; the pending action is dropped so nothing is lost.
      if (await save()) await proceed();
    } finally {
      setBusy(false);
    }
  };

  if (!scenario) {
    return <DialogFrame dialogKey={entry.key} title="Close Scenario" icon={<TriangleAlert size={14} />} size="sm" footer={<Button variant="primary" onClick={() => close(entry.key)}>OK</Button>}><p className="hint">No scenario is open.</p></DialogFrame>;
  }

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={title}
      icon={<TriangleAlert size={14} />}
      size="sm"
      footer={
        modified ? (
          <>
            <Button variant="primary" disabled={busy} onClick={() => { void saveFirst(); }}>Save</Button>
            <Button variant="danger" disabled={busy} onClick={() => { void proceed(); }}>Don't Save</Button>
            <Button onClick={() => close(entry.key)}>Cancel</Button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={() => { void proceed(); }}>{pending.action === "close" ? "Close" : pending.action === "quit" ? "Quit" : "Continue"}</Button>
            <Button onClick={() => close(entry.key)}>Cancel</Button>
          </>
        )
      }
    >
      <p>
        {modified ? <>Save changes to <strong>{name}</strong> before {what}?</> : <><strong>{name}</strong> has no unsaved changes. Continue {what}?</>}
      </p>
      {modified && pending.action !== "close" && (
        <p className="hint">Don't Save discards the changes{pending.action === "quit" ? " and closes the editor." : ` and goes on with ${what}.`}</p>
      )}
    </DialogFrame>
  );
}

/* ── Export Image ───────────────────────────────────────── */

/** What each scale is; the pixel size it produces is on the footer, live. */
const SCALE_NAMES: Record<number, string> = {
  32: "Full",
  16: "Half",
  8: "Quarter",
  4: "Overview",
  2: "Large minimap",
  1: "Minimap",
};

/** Past this many megapixels some browsers refuse to encode the canvas (Safari first). */
const HUGE_MEGAPIXELS = 64;
const PREVIEW_PX = 256;

/**
 * File ▸ Export ▸ Image. One dialog and one dial — the scale, from the game's own 32 px
 * per tile down to a 1 px minimap. `services/mapImage.ts` has the thresholds where the
 * picture changes character; this only has to say so. The preview is the same render at
 * thumbnail size, so the layer ticks can be judged before a multi-megapixel PNG is
 * encoded.
 */
export function ExportImageDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  const name = useAtomValue(mapNameAtom);
  const path = useAtomValue(mapFilePathAtom);
  const gridSize = useAtomValue(gridSizeAtom);
  const fogPlayer = useAtomValue(fogViewPlayerAtom);
  const close = useSetAtom(closeDialogAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const toast = useSetAtom(pushToastAtom);

  const [opts, setOpts] = useState<MapImageOptions>(() => ({ ...DEFAULT_IMAGE_OPTIONS, fogPlayer }));
  const base = (path ?? name).replace(/\.(scm|scx|chk)$/i, "").replace(/[^\w\- ]+/g, "") || "scenario";
  // The name follows the scale until the user types one of their own.
  const [file, setFile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A callback ref, not `useRef`: the dialog lives in a Radix portal that mounts a commit
  // later than this component, so a ref read in the first effect pass is still null.
  const [previewHost, setPreviewHost] = useState<HTMLDivElement | null>(null);

  const set = <K extends keyof MapImageOptions>(key: K, value: MapImageOptions[K]) => setOpts((o) => ({ ...o, [key]: value }));

  const sprites = drawsSprites(opts.pixelsPerTile);
  // A grid line every under-3 px is noise the renderer skips, so do not offer it.
  const gridVisible = (gridSize / 32) * opts.pixelsPerTile >= 3;
  const size = scenario ? imageSize(scenario, opts) : { width: 0, height: 0 };
  const megapixels = (size.width * size.height) / 1e6;
  // Only the bottom of the range is really a minimap; the middle is just a small map.
  const fileName = file ?? (opts.pixelsPerTile <= 2 ? `${base}-minimap` : base);

  /* The same render at thumbnail scale. Cheap enough to redo on every tick. */
  useEffect(() => {
    if (!previewHost || !scenario) return;
    let cancelled = false;
    const preview: MapImageOptions = {
      ...opts,
      pixelsPerTile: Math.max(1, Math.floor(PREVIEW_PX / Math.max(scenario.width, scenario.height))),
    };
    void loadMapImageAssets(scenario, preview).then((assets) => {
      if (cancelled) return;
      const canvas = renderMapImage(scenario, assets, preview);
      canvas.style.imageRendering = "pixelated";
      canvas.style.maxWidth = "100%";
      previewHost.replaceChildren(canvas);
    });
    return () => { cancelled = true; };
  }, [previewHost, scenario, opts]);

  const run = async () => {
    if (!scenario) { setError("No scenario is open."); return; }
    setBusy(true);
    setError(null);
    try {
      const blob = await exportMapImage(scenario, opts);
      const out = `${fileName || "scenario"}.png`;
      const outcome = await saveBlob(blob, out);
      if (outcome) {
        const text = `Exported ${outcome.fileName} — ${size.width}×${size.height}, ${(blob.size / 1024).toFixed(0)} KB`;
        setStatus(text);
        toast({ kind: "ok", title: outcome.route === "download" ? "Image downloaded" : "Image exported", detail: outcome.route === "download" ? `${text}. It is in ${hostTerms().downloads}.` : text });
        close(entry.key);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Export Image"
      icon={<ImageDown size={14} />}
      size="lg"
      footer={
        <>
          <Button variant="primary" disabled={busy || !scenario} onClick={() => { void run(); }}>
            {busy ? <><Loader2 size={13} className="spin" /> Rendering…</> : "Export"}
          </Button>
          <Button onClick={() => close(entry.key)}>Cancel</Button>
        </>
      }
      footerLeft={<span className="mono">{size.width}×{size.height} px{megapixels >= 1 ? ` · ${megapixels.toFixed(1)} MP` : ""}</span>}
      description="The whole map as a PNG. The scale decides what it is: the game's own art at the top of the range, its minimap at the bottom."
    >
      <div className="split" style={{ ["--split" as string]: "1fr" }}>
        <div className="stack">
          <Group title="Image">
            <div className="form">
              <Field label="Scale" hint={sprites
                ? "Units and sprites use their game graphics."
                : "Units become minimap dots; sprites are not drawn."}>
                <Select
                  value={String(opts.pixelsPerTile)}
                  onChange={(e) => set("pixelsPerTile", Number(e.target.value))}
                  options={IMAGE_SCALES.map((px) => ({ value: String(px), label: `${SCALE_NAMES[px]} — ${px} px/tile` }))}
                />
              </Field>
              <Field label="File name">
                <div className="row">
                  <TextInput value={fileName} onChange={(e) => setFile(e.target.value)} />
                  <span className="mono dim">.png</span>
                </div>
              </Field>
            </div>
          </Group>
          <Group title="Include">
            <div className="col" style={{ gap: 2 }}>
              <Check label="Units" checked={opts.units} onChange={(e) => set("units", e.target.checked)} />
              <Check
                label="Sprites (doodad overlays, THG2)"
                disabled={!sprites}
                title={sprites ? undefined : "Sprites are not drawn at this scale."}
                checked={opts.sprites && sprites}
                onChange={(e) => set("sprites", e.target.checked)}
              />
              <Check label="Start locations" checked={opts.startLocations} onChange={(e) => set("startLocations", e.target.checked)} />
              <Check label="Locations" checked={opts.locations} onChange={(e) => set("locations", e.target.checked)} />
              <Check
                label="Location names"
                disabled={!opts.locations || !sprites}
                title={sprites ? undefined : "Names are too small to read at this scale."}
                checked={opts.locationNames && sprites}
                onChange={(e) => set("locationNames", e.target.checked)}
                style={{ marginLeft: 20 }}
              />
              <Check
                label={`Grid (${gridSize} px)`}
                disabled={!gridVisible}
                title={gridVisible ? undefined : "The grid would be finer than a pixel at this scale."}
                checked={opts.grid > 0 && gridVisible}
                onChange={(e) => set("grid", e.target.checked ? gridSize : 0)}
              />
              <div className="row">
                <Check label="Fog of war" checked={opts.fog} onChange={(e) => set("fog", e.target.checked)} />
                <Select
                  style={{ width: 110 }}
                  disabled={!opts.fog}
                  aria-label="Player whose fog is exported"
                  value={String(opts.fogPlayer)}
                  onChange={(e) => set("fogPlayer", Number(e.target.value))}
                  options={Array.from({ length: 8 }, (_, i) => ({ value: String(i), label: `Player ${i + 1}` }))}
                />
              </div>
            </div>
          </Group>
        </div>
        <Group title="Preview">
          <div className="export-preview" ref={setPreviewHost} />
          <p className="hint" style={{ marginTop: 8 }}>The whole map, reduced to fit — what the layers look like, not the final resolution.</p>
        </Group>
      </div>
      {megapixels > HUGE_MEGAPIXELS && (
        <p className="error-text">
          {megapixels.toFixed(0)} megapixels — encoding a canvas this large is refused by {hostTerms().desktop ? "some builds" : "some browsers"}. Pick a smaller scale if the export fails.
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
    </DialogFrame>
  );
}
