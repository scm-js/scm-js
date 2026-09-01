import { useCallback, useEffect, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Construction, FilePlus2, FolderOpen, ImageDown, Loader2, Save, TriangleAlert, Upload } from "lucide-react";
import { fogViewPlayerAtom, gridSizeAtom, mapFilePathAtom, mapModifiedAtom, mapNameAtom } from "../../atoms/editorAtoms";
import { archiveExtrasAtom, loadDocumentAtom, recentFilesAtom, scenarioAtom } from "../../atoms/documentAtoms";
import { closeDialogAtom, statusMessageAtom } from "../../atoms/uiAtoms";
import { MAP_SIZES, terrainName, TILESETS, TILESET_BY_ID, type TilesetId } from "../../data/tilesets";
import { DEFAULT_NEW_MAP, useMapFileActions } from "../../hooks/useMapFileActions";
import { MAP_FILE_ACCEPT, openMapFile, pickMapFile, saveBlob, saveBytes, writeMapBytes, type MapFormat } from "../../services/mapIo";
import {
  DEFAULT_IMAGE_OPTIONS, drawsSprites, exportMapImage, IMAGE_SCALES, imageSize, loadMapImageAssets, renderMapImage,
  type MapImageOptions,
} from "../../services/mapImage";
import { Button, Check, Field, Group, ListBox, NumberInput, Select, TextArea, TextInput } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/* ── New Map ────────────────────────────────────────────── */

export function NewMapDialog({ entry }: DialogProps) {
  const { newMap } = useMapFileActions();

  const [tileset, setTs] = useState<TilesetId>(DEFAULT_NEW_MAP.tileset);
  const [w, setLocalW] = useState(DEFAULT_NEW_MAP.width);
  const [h, setLocalH] = useState(DEFAULT_NEW_MAP.height);
  const [terrain, setTerrain] = useState(TILESET_BY_ID[DEFAULT_NEW_MAP.tileset].defaultIsom);
  const [name, setLocalName] = useState(DEFAULT_NEW_MAP.name);
  const [desc, setLocalDesc] = useState(DEFAULT_NEW_MAP.description);
  const [players, setPlayers] = useState(8);

  const ts = TILESET_BY_ID[tileset];
  const pick = (id: TilesetId) => { setTs(id); setTerrain(TILESET_BY_ID[id].defaultIsom); };
  const maxDim = Math.max(w, h);

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="New Scenario"
      icon={<FilePlus2 size={14} />}
      size="lg"
      okLabel="Create"
      onOk={() => {
        void newMap({ width: w, height: h, tileset, name: name || DEFAULT_NEW_MAP.name, description: desc, terrainId: terrain });
      }}
      footerLeft={<span>{ts.name} · {w}×{h} · {terrainName(ts, terrain)}</span>}
    >
      <Group title="Tileset">
        <div className="tileset-grid">
          {TILESETS.map((t) => (
            <button key={t.id} className={`tileset-card ${tileset === t.id ? "selected" : ""}`} onClick={() => pick(t.id)}>
              <span className="thumb" style={{ ["--c" as string]: t.color }} />
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
              <Field label="Initial terrain">
                <Select value={String(terrain)} onChange={(e) => setTerrain(Number(e.target.value))} options={ts.terrain.map((t) => ({ value: String(t.id), label: t.name }))} />
              </Field>
              <Field label="Start locations">
                <div className="row">
                  <NumberInput value={players} onChange={setPlayers} min={0} max={8} width={90} />
                  <Check label="Place automatically" />
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
        </div>
        <Group title="Preview">
          <div className="map-preview">
            <div className="sheet" style={{ ["--c" as string]: ts.color, width: `${(w / maxDim) * 82}%`, height: `${(h / maxDim) * 82}%` }} />
          </div>
          <p className="hint" style={{ marginTop: 8 }}>{w * h} tiles · {w * 32}×{h * 32} px</p>
        </Group>
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

  const accept = useCallback(async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const doc = await openMapFile(file);
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
  }, [close, entry.key, load, setStatus]);

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
          <Button variant="primary" disabled={busy} onClick={() => { void pickMapFile().then(accept); }}>
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
        onDrop={(e) => { e.preventDefault(); setDragging(false); void accept(e.dataTransfer.files[0] ?? null); }}
      >
        <Upload size={22} />
        <div><strong>Drop a map file here</strong></div>
        <div className="hint">or</div>
        <Button disabled={busy} onClick={() => { void pickMapFile().then(accept); }}>Browse…</Button>
      </div>
      {error && <p className="error-text">{error}</p>}
      <Group title="Recent" flush>
        {recents.length === 0
          ? <p className="hint" style={{ padding: "10px 12px" }}>Nothing opened yet this session.</p>
          : <ListBox items={recents} selected={sel} onSelect={setSel} style={{ height: 120 }} render={(f) => <><FolderOpen size={12} className="faint" /><span className="mono">{f}</span></>} />}
      </Group>
    </DialogFrame>
  );
}

/* ── Save As ────────────────────────────────────────────── */

export function SaveAsDialog({ entry }: DialogProps) {
  const [name] = useAtom(mapNameAtom);
  const scenario = useAtomValue(scenarioAtom);
  const extras = useAtomValue(archiveExtrasAtom);
  const [path, setPath] = useAtom(mapFilePathAtom);
  const [file, setFile] = useState(() => (path ?? name).replace(/\.(scm|scx|chk)$/i, "").replace(/[^\w\- ]+/g, ""));
  const [fmt, setFmt] = useState<MapFormat>(scenario && scenario.fileVersion < 205 ? "scm" : "scx");
  const [keepExtras, setKeepExtras] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = useSetAtom(closeDialogAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const setModified = useSetAtom(mapModifiedAtom);

  const save = async () => {
    if (!scenario) { setError("No scenario is open."); return; }
    setBusy(true);
    setError(null);
    try {
      const bytes = await writeMapBytes(scenario, { format: fmt, extras: keepExtras ? extras : undefined });
      const fileName = `${file || "scenario"}.${fmt}`;
      if (await saveBytes(bytes, fileName)) {
        setPath(fileName);
        setModified(false);
        setStatus(`Saved ${fileName} — ${(bytes.length / 1024).toFixed(1)} KB`);
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
      title="Save Scenario As"
      icon={<Save size={14} />}
      size="sm"
      footer={
        <>
          <Button variant="primary" disabled={busy || !scenario} onClick={() => { void save(); }}>
            {busy ? <><Loader2 size={13} className="spin" /> Saving…</> : "Save"}
          </Button>
          <Button onClick={() => close(entry.key)}>Cancel</Button>
        </>
      }
    >
      <div className="form wide">
        <Field label="File name">
          <div className="row">
            <TextInput value={file} onChange={(e) => setFile(e.target.value)} />
            <span className="mono dim">.{fmt}</span>
          </div>
        </Field>
        <Field label="Format">
          <Select value={fmt} onChange={(e) => setFmt(e.target.value as MapFormat)} options={[{ value: "scx", label: "Brood War scenario (.scx)" }, { value: "scm", label: "StarCraft scenario (.scm)" }, { value: "chk", label: "Raw chunk data (.chk)" }]} />
        </Field>
      </div>
      <Group title="Options">
        <div className="col" style={{ gap: 2 }}>
          <Check
            label={`Keep other archive files (${extras.size})`}
            checked={keepExtras}
            disabled={fmt === "chk" || extras.size === 0}
            onChange={(e) => setKeepExtras(e.target.checked)}
          />
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          scenario.chk is written uncompressed so older StarCraft builds can read it.
          Sections the editor does not model are copied through byte for byte.
        </p>
      </Group>
      {!scenario && <p className="error-text">Open a map first — there is nothing to save.</p>}
      {error && <p className="error-text">{error}</p>}
    </DialogFrame>
  );
}

/* ── Confirm close ──────────────────────────────────────── */

export function ConfirmCloseDialog({ entry }: DialogProps) {
  const close = useSetAtom(closeDialogAtom);
  const [name] = useAtom(mapNameAtom);
  const [modified, setModified] = useAtom(mapModifiedAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Close Scenario"
      icon={<TriangleAlert size={14} />}
      size="sm"
      footer={
        <>
          <Button variant="primary" onClick={() => { setModified(false); setStatus("Saved (stub)"); close(entry.key); }}>Save</Button>
          <Button variant="danger" onClick={() => { setModified(false); setStatus("Closed (stub)"); close(entry.key); }}>Don't Save</Button>
          <Button onClick={() => close(entry.key)}>Cancel</Button>
        </>
      }
    >
      <p>
        {modified ? <>Save changes to <strong>{name}</strong> before closing?</> : <><strong>{name}</strong> has no unsaved changes. Close it?</>}
      </p>
    </DialogFrame>
  );
}

/* ── Not implemented ────────────────────────────────────── */

export function NotImplementedDialog({ entry }: DialogProps) {
  const close = useSetAtom(closeDialogAtom);
  const feature = String(entry.payload?.feature ?? "This feature");
  return (
    <DialogFrame dialogKey={entry.key} title="Not Yet Implemented" icon={<Construction size={14} />} size="sm" footer={<Button variant="primary" autoFocus onClick={() => close(entry.key)}>OK</Button>}>
      <p><strong>{feature}</strong> is part of the planned feature set but isn't wired up yet.</p>
      <p className="hint">The UI is being laid out first; real map I/O, rendering and editing land next.</p>
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
      if (await saveBlob(blob, out)) {
        setStatus(`Exported ${out} — ${size.width}×${size.height}, ${(blob.size / 1024).toFixed(0)} KB`);
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
          {megapixels.toFixed(0)} megapixels — some browsers refuse to encode a canvas this large. Pick a smaller scale if the export fails.
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
    </DialogFrame>
  );
}
