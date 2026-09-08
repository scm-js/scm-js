import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { FilePlus2, FolderOpen, ImageDown, Loader2, Save, TriangleAlert, Upload } from "lucide-react";
import { fogViewPlayerAtom, gridSizeAtom, mapFilePathAtom, mapModifiedAtom, mapNameAtom, mapOriginAtom, saveOptionsAtom } from "../../atoms/editorAtoms";
import { archiveExtrasAtom, archiveStoredAtom, loadDocumentAtom, recentFilesAtom, scenarioAtom } from "../../atoms/documentAtoms";
import { closeDialogAtom, openDialogAtom, pushToastAtom, statusMessageAtom } from "../../atoms/uiAtoms";
import { MAP_SIZES, terrainName, TILESETS, TILESET_BY_ID, type TilesetId } from "../../data/tilesets";
import { DEFAULT_START_PLACEMENT, idealStarts } from "../../editor/startLocations";
import { baseTerrain } from "../../formats/tileset/terrain";
import { renderTerrainPatch, type TerrainPatch } from "../../formats/tileset/preview";
import { PREVIEW_TILES, useTilesetGraphics, useTilesetThumbs } from "../../hooks/useTilesetPreview";
import { MapPreview, PatchThumb, type PreviewStart } from "./TerrainPreview";
import { DEFAULT_NEW_MAP, needsCloseConfirm, openTarget, saveDocument, useMapFileActions, type PendingAction } from "../../hooks/useMapFileActions";
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
import { msg, t, translate } from "../../i18n";

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
      title={t("New Scenario")}
      icon={<FilePlus2 size={14} />}
      size="lg"
      okLabel={t("Create")}
      onOk={() => {
        guard({
          action: "new",
          options: {
            width: w, height: h, tileset, name: name || DEFAULT_NEW_MAP.name, description: desc, terrainId: terrain,
            startLocations: autoStarts ? players : 0,
          },
        });
      }}
      footerLeft={<span>{ts.name} · {w}×{h} · {terrainName(ts, terrain)}{autoStarts && players > 0 ? t(" · {players, plural, one {# start} other {# starts}}", { players }) : ""}</span>}
    >
      <Group title={t("Tileset")}>
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
          <Group title={t("Dimensions")}>
            <div className="form">
              <Field label={t("Width × Height")}>
                <div className="row">
                  <Select style={{ width: 90 }} value={String(w)} onChange={(e) => setLocalW(Number(e.target.value))} options={MAP_SIZES.map((s) => String(s))} />
                  <span className="dim">×</span>
                  <Select style={{ width: 90 }} value={String(h)} onChange={(e) => setLocalH(Number(e.target.value))} options={MAP_SIZES.map((s) => String(s))} />
                  <span className="hint">{t("tiles")}</span>
                </div>
              </Field>
              <Field label={t("Start locations")} hint={autoStarts ? t("Placed on a ring, each nudged to the nearest ground it fits on.") : t("Add them yourself on the Units layer, or with Tools ▸ Auto-place.")}>
                <div className="row">
                  <NumberInput value={players} onChange={setPlayers} min={1} max={8} width={90} disabled={!autoStarts} />
                  <Check label={t("Place automatically")} checked={autoStarts} onChange={(e) => setAutoStarts(e.target.checked)} />
                </div>
              </Field>
            </div>
          </Group>
          <Group title={t("Scenario")}>
            <div className="form">
              <Field label={t("Name")}><TextInput value={name} onChange={(e) => setLocalName(e.target.value)} /></Field>
              <Field label={t("Description")}><TextArea rows={3} value={desc} onChange={(e) => setLocalDesc(e.target.value)} placeholder={t("Shown in the game lobby…")} /></Field>
            </div>
          </Group>
          <Group title={t("Initial terrain")} flush className="terrain-group">
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
          <Group title={t("Preview")}>
            <MapPreview patch={patch} color={ts.color} width={w} height={h} starts={starts} />
            <p className="hint" style={{ marginTop: 8 }}>
              {t("{v} tiles · {v2}×{v3} px", { v: w * h, v2: w * 32, v3: h * 32 })}
              {!graphics && !loading && t(" · no tileset graphics, showing flat colour")}
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
  const store = useStore();
  const { guard, openRecent } = useMapFileActions();
  const reopen = async (i: number) => {
    const r = recents[i];
    if (!r?.handleKey) { setError(t("{name} cannot be reopened from here — browse for it.", { name: r?.name ?? t("This file") })); return; }
    setBusy(true);
    setError(null);
    const ok = await openRecent(r);
    setBusy(false);
    if (ok) close(entry.key);
  };

  const accept = useCallback(async (picked: PickedMapFile | null) => {
    if (!picked) return;
    const { file, handle } = picked;
    // Unsaved changes the open would lose: hand the file to the Close Scenario dialog and let it decide.
    if (needsCloseConfirm(store, { action: "open", file, handle })) {
      close(entry.key);
      guard({ action: "open", file, handle });
      return;
    }
    const into = openTarget(store);
    setBusy(true);
    setError(null);
    try {
      const doc = await openMapFile(file, handle);
      load({ ...doc, into });
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
  }, [close, entry.key, load, setStatus, guard, store]);

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={t("Open Scenario")}
      icon={<FolderOpen size={14} />}
      size="md"
      okLabel={t("Browse…")}
      onOk={() => { void accept(null); }}
      footer={
        <>
          {sel !== null && recents[sel]?.handleKey && <Button variant="primary" disabled={busy} onClick={() => { void reopen(sel); }}>{t("Open {name}", { name: recents[sel].name })}</Button>}
          <Button variant={sel !== null && recents[sel]?.handleKey ? undefined : "primary"} disabled={busy} onClick={() => { void pickMapFile().then(accept); }}>
            {busy ? <><Loader2 size={13} className="spin" /> {t("Opening…")}</> : t("Browse…")}
          </Button>
          <Button onClick={() => close(entry.key)}>{t("Cancel")}</Button>
        </>
      }
      footerLeft={<span>{t("Supports {join}", { join: MAP_FILE_ACCEPT.split(",").join(" · ") })}</span>}
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
        <div><strong>{t("Drop a map file here")}</strong></div>
        <div className="hint">or</div>
        <Button disabled={busy} onClick={() => { void pickMapFile().then(accept); }}>{t("Browse…")}</Button>
      </div>
      {error && <p className="error-text">{error}</p>}
      <Group title={t("Recent")} flush>
        {recents.length === 0
          ? <p className="hint" style={{ padding: "10px 12px" }}>{t("Nothing opened yet.")}</p>
          : (
            <div onDoubleClick={() => { if (sel !== null) void reopen(sel); }} onKeyDown={(e) => { if (e.key === "Enter" && sel !== null) { e.preventDefault(); void reopen(sel); } }}>
              <ListBox items={recents} selected={sel} onSelect={setSel} style={{ height: 120 }} render={(r) => <><FolderOpen size={12} className={r.handleKey ? "" : "faint"} /><span className="mono">{r.name}</span><span className="faint" style={{ marginLeft: "auto", fontSize: 10 }}>{r.handleKey ? t("double-click to reopen") : t("browse for it")}</span></>} />
            </div>
          )}
      </Group>
    </DialogFrame>
  );
}

/* ── Save ───────────────────────────────────────────────── */

const FORMAT_OPTIONS: { value: MapFormat; label: string }[] = [
  { value: "scx", label: msg("Brood War scenario (.scx)") },
  { value: "scm", label: msg("StarCraft scenario (.scm)") },
  { value: "chk", label: msg("Raw chunk data (.chk)") },
];

const COMPRESSION_OPTIONS: { value: ArchiveCompression; label: string; hint: string }[] = [
  { value: "pkware", label: msg("PKWARE — what StarEdit writes"), hint: msg("Every StarCraft build reads it. Blizzard's own maps are stored this way.") },
  { value: "zlib", label: msg("zlib — smallest"), hint: msg("StarCraft 1.16.1 and Remastered read it; older builds do not.") },
  { value: "none", label: msg("None"), hint: msg("The largest file; anything that opens an MPQ reads it.") },
];

/** "PKWARE-compressed, encrypted, 4 KB sectors, 39.0 KB of 119.7 KB" */
function describeOrigin(o: MemberInfo): string {
  const method = o.compression === "pkware" ? "PKWARE-compressed"
    : o.compression === "zlib" ? "zlib-compressed"
    : o.compression === "none" ? "uncompressed"
    : t("compressed with a method the editor cannot write");
  return t("{method}, {encrypted}, {kb} KB sectors, {stored} of {size}", { method, encrypted: o.encrypted ? t("encrypted") : t("not encrypted"), kb: o.sectorSize / 1024, stored: formatBytes(o.storedSize), size: formatBytes(o.size) });
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
  const storedMembers = useAtomValue(archiveStoredAtom);
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

  const plan = useMemo(() => (scenario ? planSave(scenario, extras, opts, storedMembers) : null), [scenario, extras, opts, storedMembers]);
  const issues = useMemo(() => (scenario ? issueCounts(validateScenario(scenario, { extras })) : null), [scenario, extras]);

  // The real bytes, for the size: built a moment after the last change, off the click path.
  useEffect(() => {
    if (!scenario || !plan) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      buildMapFile(scenario, extras, opts, plan, storedMembers).then(
        (bytes) => { if (!cancelled) setBuilt({ options: opts, bytes }); },
        () => { if (!cancelled) setBuilt(null); },
      );
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [scenario, extras, opts, plan, storedMembers]);

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
      title={copy ? t("Save a Copy") : t("Save Scenario As")}
      icon={<Save size={14} />}
      size="lg"
      description={copy ? t("Writes a copy; the open map keeps its own file and name.") : undefined}
      footer={
        <>
          <Button variant="primary" disabled={busy || !scenario} onClick={() => { void save(); }}>
            {busy ? <><Loader2 size={13} className="spin" /> {t("Saving…")}</> : copy ? t("Save Copy") : t("Save")}
          </Button>
          <Button onClick={() => close(entry.key)}>{t("Cancel")}</Button>
        </>
      }
      footerLeft={plan && (
        <span className="mono">
          {ready ? formatBytes(ready.length) : "…"}
          {archive ? ` · scenario.chk ${formatBytes(plan.chkSize)}` : ""}
        </span>
      )}
    >
      {!scenario && <p className="error-text">{t("Open a map first — there is nothing to save.")}</p>}
      {scenario && plan && counts && (
        <div className="split" style={{ ["--split" as string]: "minmax(300px, 1fr)" }}>
          <div className="stack">
            <Group title={t("File")}>
              <div className="form wide">
                <Field label={t("File name")}>
                  <div className="row">
                    <TextInput value={file} onChange={(e) => setFile(e.target.value)} />
                    <span className="mono dim">.{opts.format}</span>
                  </div>
                </Field>
                <Field label={t("Format")} hint={opts.format === "chk" ? t("The scenario alone, no archive around it.") : t("The extension does not change the map's revision; Scenario ▸ Map Revision does.")}>
                  <Select value={opts.format} onChange={(e) => set("format", e.target.value as MapFormat)} options={FORMAT_OPTIONS} />
                </Field>
              </div>
              {!canPickSaveLocation() && (
                <p className="hint" style={{ marginTop: 6 }}>{t("{Here} cannot ask where to put the file: it goes to the downloads folder.", { Here: hostTerms().Here })}</p>
              )}
            </Group>

            <Group title={t("Archive")}>
              <div className="form wide">
                <Field label={t("Compression")} hint={archive ? translate(compression.hint) : t("Not used for a bare .chk.")}>
                  <Select value={opts.compression} disabled={!archive} onChange={(e) => set("compression", e.target.value as ArchiveCompression)} options={COMPRESSION_OPTIONS.map((c) => ({ value: c.value, label: c.label }))} />
                </Field>
              </div>
              <div className="col" style={{ gap: 2, marginTop: 6 }}>
                <Check label={t("Encrypt the files inside, as StarEdit does")} checked={opts.encrypt} disabled={!archive} onChange={(e) => set("encrypt", e.target.checked)} />
              </div>
              {origin && <p className="hint" style={{ marginTop: 6 }}>{t("Opened as {describeOrigin}.", { describeOrigin: describeOrigin(origin) })}</p>}
              {plan.extras.length > 0 && (
                <>
                  <div className="pane-label" style={{ marginTop: 8 }}>{t("Other files in the archive")}</div>
                  <div className="save-extras">
                    {plan.extras.map((e) => (
                      <Check
                        key={e.name}
                        checked={e.kept}
                        disabled={!archive}
                        onChange={(ev) => keepExtra(e.name, ev.target.checked)}
                        label={<><span className="path" title={e.name}>{e.name}</span><span className="dim">{e.kind === "script" ? t("TrigScript") : e.kind === "sound" ? t("sound") : ""}</span><span className="size">{formatBytes(e.size)}</span></>}
                      />
                    ))}
                  </div>
                </>
              )}
              {plan.stored && (
                <p className="hint" style={{ marginTop: 6 }}>
                  {t("{count} more member", { count: plan.stored.count })}{plan.stored.count === 1 ? "" : "s"} ({formatBytes(plan.stored.size)}) {plan.stored.count === 1 ? "has" : t("have")} {" "}{t("no name the editor knows")}{plan.stored.members.unreadable.length > 0 ? t(", or could not be decoded") : ""}; {archive ? t("kept exactly as stored") : t("not written to a bare .chk")}.
                </p>
              )}
            </Group>

            <Group title={t("Sections")}>
              <div className="save-presets">
                <span className="hint">{t("Preset")}</span>
                <Button size="sm" onClick={() => setOpts(SAVE_PRESETS.everything)}>{t("Everything")}</Button>
                <Button size="sm" onClick={() => setOpts(SAVE_PRESETS.smallest)}>{t("Smallest that plays")}</Button>
              </div>
              <div className="col save-options" style={{ gap: 0, marginTop: 6 }}>
                <Check label={t("Leave out terrain editing data — ISOM, TILE, DD2 ({terrainEditing})", { terrainEditing: counts.terrainEditing })} checked={opts.stripTerrainEditing} disabled={counts.terrainEditing === 0} onChange={(e) => set("stripTerrainEditing", e.target.checked)} />
                <Check label={t("Leave out editor bookkeeping — IVER, IVE2, IOWN, UPUS, SWNM, WAV ({bookkeeping})", { bookkeeping: counts.bookkeeping })} checked={opts.stripBookkeeping} disabled={counts.bookkeeping === 0} onChange={(e) => set("stripBookkeeping", e.target.checked)} />
                <Check label={t("Leave out sections the format reference does not know ({unknown})", { unknown: counts.unknown })} checked={opts.stripUnknown} disabled={counts.unknown === 0} onChange={(e) => set("stripUnknown", e.target.checked)} />
                <Check label={t("Merge repeated sections into one ({repeated})", { repeated: counts.repeated })} checked={opts.mergeRepeats} disabled={counts.repeated === 0} onChange={(e) => set("mergeRepeats", e.target.checked)} />
                <Check label={t("Drop bytes after the last section ({formatBytes})", { formatBytes: formatBytes(counts.trailing) })} checked={opts.dropTrailing} disabled={counts.trailing === 0} onChange={(e) => set("dropTrailing", e.target.checked)} />
              </div>
              <p className="hint" style={{ marginTop: 6 }}>{t("The game reads none of these; leaving them out changes what an editor can do with the file, not how it plays. The open map is not changed.")}</p>
            </Group>
          </div>

          <div className="stack">
            <Group title={t("What will be written")} flush>
              <div className="save-sections">
                <table className="table">
                  <thead>
                    <tr><th>{t("Section")}</th><th>{t("What")}</th><th style={{ textAlign: "right" }}>{t("Size")}</th><th></th></tr>
                  </thead>
                  <tbody>
                    {plan.sections.map((x) => (
                      <tr key={x.index} className={x.fate} title={x.reason}>
                        <td className="name">{x.name}</td>
                        <td>{x.what ? translate(x.what) : <span className="faint">{t("unknown")}</span>}{x.editorOnly && <span className="faint"> {t("· editor only")}</span>}</td>
                        <td className="num">{formatBytes(x.size)}</td>
                        <td className="fate">
                          {x.fate === "dropped" && <span className="badge warn">{t("left out")}</span>}
                          {x.fate === "merged" && <span className="badge teal">{t("merged")}</span>}
                          {x.fate === "kept" && x.dirty && <span className="badge gold">{t("changed")}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Group>
            <div className="save-summary">
              <span className="k">scenario.chk</span>
              <span className="v">{formatBytes(plan.chkSize)}{plan.chkSize !== plan.chkSizeBefore ? t(" (was {formatBytes})", { formatBytes: formatBytes(plan.chkSizeBefore) }) : ""}</span>
              <span className="k">{t("Sections")}</span>
              <span className="v">{kept} of {plan.sections.length}{dropped > 0 ? t(", {dropped} left out", { dropped }) : ""}</span>
              {archive && (
                <>
                  <span className="k">{t("Archive")}</span>
                  <span className="v">{ready ? `${formatBytes(ready.length)} · ${compression.value === "none" ? "uncompressed" : compression.value}${opts.encrypt ? ", encrypted" : ""}` : "…"}</span>
                  {(plan.extras.length > 0 || plan.stored) && (
                    <>
                      <span className="k">{t("Other files")}</span>
                      <span className="v">{keptExtras} of {plan.extras.length}{plan.stored ? t(", {count} kept as stored", { count: plan.stored.count }) : ""}</span>
                    </>
                  )}
                </>
              )}
              {issues && (
                <>
                  <span className="k">{t("Check Map")}</span>
                  <span className="v row" style={{ gap: 8, alignItems: "center" }}>
                    <span className={`badge ${issues.error > 0 ? "danger" : issues.warn > 0 ? "warn" : "ok"}`}>
                      {issues.error > 0 ? t("{error, plural, one {# error} other {# errors}}", { error: issues.error }) : issues.warn > 0 ? t("{warn, plural, one {# warning} other {# warnings}}", { warn: issues.warn }) : t("no problems")}
                    </span>
                    <Button size="sm" onClick={() => openDialog("validateMap")}>{t("Open Check Map…")}</Button>
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
  const what = pending.action === "new" ? t("creating a new scenario")
    : pending.action === "open" ? `opening ${pending.file.name}`
    : pending.action === "quit" ? "leaving" : "closing";
  const title = pending.action === "quit" ? t("Quit scmJS") : t("Close Scenario");

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
    return <DialogFrame dialogKey={entry.key} title={t("Close Scenario")} icon={<TriangleAlert size={14} />} size="sm" footer={<Button variant="primary" onClick={() => close(entry.key)}>{t("OK")}</Button>}><p className="hint">{t("No scenario is open.")}</p></DialogFrame>;
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
            <Button variant="primary" disabled={busy} onClick={() => { void saveFirst(); }}>{t("Save")}</Button>
            <Button variant="danger" disabled={busy} onClick={() => { void proceed(); }}>{t("Don't Save")}</Button>
            <Button onClick={() => close(entry.key)}>{t("Cancel")}</Button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={() => { void proceed(); }}>{pending.action === "close" ? t("Close") : pending.action === "quit" ? t("Quit") : t("Continue")}</Button>
            <Button onClick={() => close(entry.key)}>{t("Cancel")}</Button>
          </>
        )
      }
    >
      <p>
        {modified ? <>{t("Save changes to")}{" "}<strong>{name}</strong> {" "}{t("before {what}?", { what })}</> : <><strong>{name}</strong> {" "}{t("has no unsaved changes. Continue {what}?", { what })}</>}
      </p>
      {modified && pending.action !== "close" && (
        <p className="hint">{t("Don't Save discards the changes")}{pending.action === "quit" ? t(" and closes the editor.") : t(" and goes on with {what}.", { what })}</p>
      )}
    </DialogFrame>
  );
}

/* ── Export Image ───────────────────────────────────────── */

/** What each scale is; the pixel size it produces is on the footer, live. */
const SCALE_NAMES: Record<number, string> = {
  32: msg("Full"),
  16: msg("Half"),
  8: msg("Quarter"),
  4: msg("Overview"),
  2: msg("Large minimap"),
  1: msg("Minimap"),
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
    if (!scenario) { setError(t("No scenario is open.")); return; }
    setBusy(true);
    setError(null);
    try {
      const blob = await exportMapImage(scenario, opts);
      const out = `${fileName || "scenario"}.png`;
      const outcome = await saveBlob(blob, out);
      if (outcome) {
        const text = `Exported ${outcome.fileName} — ${size.width}×${size.height}, ${(blob.size / 1024).toFixed(0)} KB`;
        setStatus(text);
        toast({ kind: "ok", title: outcome.route === "download" ? t("Image downloaded") : t("Image exported"), detail: outcome.route === "download" ? t("{text}. It is in {downloads}.", { text, downloads: hostTerms().downloads }) : text });
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
      title={t("Export Image")}
      icon={<ImageDown size={14} />}
      size="lg"
      footer={
        <>
          <Button variant="primary" disabled={busy || !scenario} onClick={() => { void run(); }}>
            {busy ? <><Loader2 size={13} className="spin" /> {t("Rendering…")}</> : t("Export")}
          </Button>
          <Button onClick={() => close(entry.key)}>{t("Cancel")}</Button>
        </>
      }
      footerLeft={<span className="mono">{size.width}×{size.height} px{megapixels >= 1 ? ` · ${megapixels.toFixed(1)} MP` : ""}</span>}
      description={t("The whole map as a PNG. The scale decides what it is: the game's own art at the top of the range, its minimap at the bottom.")}
    >
      <div className="split" style={{ ["--split" as string]: "1fr" }}>
        <div className="stack">
          <Group title={t("Image")}>
            <div className="form">
              <Field label={t("Scale")} hint={sprites ? t("Units and sprites use their game graphics.") : t("Units become minimap dots; sprites are not drawn.")}>
                <Select
                  value={String(opts.pixelsPerTile)}
                  onChange={(e) => set("pixelsPerTile", Number(e.target.value))}
                  options={IMAGE_SCALES.map((px) => ({ value: String(px), label: t("{v} — {px} px/tile", { v: translate(SCALE_NAMES[px]), px }) }))}
                />
              </Field>
              <Field label={t("File name")}>
                <div className="row">
                  <TextInput value={fileName} onChange={(e) => setFile(e.target.value)} />
                  <span className="mono dim">{t(".png")}</span>
                </div>
              </Field>
            </div>
          </Group>
          <Group title={t("Include")}>
            <div className="col" style={{ gap: 2 }}>
              <Check label={t("Units")} checked={opts.units} onChange={(e) => set("units", e.target.checked)} />
              <Check
                label={t("Sprites (doodad overlays, THG2)")}
                disabled={!sprites}
                title={sprites ? undefined : t("Sprites are not drawn at this scale.")}
                checked={opts.sprites && sprites}
                onChange={(e) => set("sprites", e.target.checked)}
              />
              <Check label={t("Start locations")} checked={opts.startLocations} onChange={(e) => set("startLocations", e.target.checked)} />
              <Check label={t("Locations")} checked={opts.locations} onChange={(e) => set("locations", e.target.checked)} />
              <Check
                label={t("Location names")}
                disabled={!opts.locations || !sprites}
                title={sprites ? undefined : t("Names are too small to read at this scale.")}
                checked={opts.locationNames && sprites}
                onChange={(e) => set("locationNames", e.target.checked)}
                style={{ marginLeft: 20 }}
              />
              <Check
                label={t("Grid ({gridSize} px)", { gridSize })}
                disabled={!gridVisible}
                title={gridVisible ? undefined : t("The grid would be finer than a pixel at this scale.")}
                checked={opts.grid > 0 && gridVisible}
                onChange={(e) => set("grid", e.target.checked ? gridSize : 0)}
              />
              <div className="row">
                <Check label={t("Fog of war")} checked={opts.fog} onChange={(e) => set("fog", e.target.checked)} />
                <Select
                  style={{ width: 110 }}
                  disabled={!opts.fog}
                  aria-label={t("Player whose fog is exported")}
                  value={String(opts.fogPlayer)}
                  onChange={(e) => set("fogPlayer", Number(e.target.value))}
                  options={Array.from({ length: 8 }, (_, i) => ({ value: String(i), label: t("Player {v}", { v: i + 1 }) }))}
                />
              </div>
            </div>
          </Group>
        </div>
        <Group title={t("Preview")}>
          <div className="export-preview" ref={setPreviewHost} />
          <p className="hint" style={{ marginTop: 8 }}>{t("The whole map, reduced to fit — what the layers look like, not the final resolution.")}</p>
        </Group>
      </div>
      {megapixels > HUGE_MEGAPIXELS && (
        <p className="error-text">
          {t("{toFixed} megapixels — encoding a canvas this large is refused by", { toFixed: megapixels.toFixed(0) })}{" "}{hostTerms().desktop ? t("some builds") : t("some browsers")}{t(". Pick a smaller scale if the export fails.")}
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
    </DialogFrame>
  );
}
