import { useState } from "react";
import { useAtom, useSetAtom } from "jotai";
import { Construction, FilePlus2, FolderOpen, Save, TriangleAlert, Upload } from "lucide-react";
import { mapDescriptionAtom, mapHeightAtom, mapModifiedAtom, mapNameAtom, mapTilesetAtom, mapWidthAtom } from "../../atoms/editorAtoms";
import { closeDialogAtom, statusMessageAtom } from "../../atoms/uiAtoms";
import { MAP_SIZES, TILESETS, TILESET_BY_ID, type TilesetId } from "../../data/tilesets";
import { RECENT_FILES } from "../../data/samples";
import { Button, Check, Field, Group, ListBox, NumberInput, Select, TextArea, TextInput } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/* ── New Map ────────────────────────────────────────────── */

export function NewMapDialog({ entry }: DialogProps) {
  const setName = useSetAtom(mapNameAtom);
  const setDesc = useSetAtom(mapDescriptionAtom);
  const setTileset = useSetAtom(mapTilesetAtom);
  const setW = useSetAtom(mapWidthAtom);
  const setH = useSetAtom(mapHeightAtom);
  const setModified = useSetAtom(mapModifiedAtom);
  const setStatus = useSetAtom(statusMessageAtom);

  const [tileset, setTs] = useState<TilesetId>("jungle");
  const [w, setLocalW] = useState(128);
  const [h, setLocalH] = useState(128);
  const [terrain, setTerrain] = useState(TILESET_BY_ID.jungle.defaultTerrain);
  const [name, setLocalName] = useState("Untitled Scenario");
  const [desc, setLocalDesc] = useState("");
  const [players, setPlayers] = useState(8);

  const ts = TILESET_BY_ID[tileset];
  const pick = (id: TilesetId) => { setTs(id); setTerrain(TILESET_BY_ID[id].defaultTerrain); };
  const maxDim = Math.max(w, h);

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="New Scenario"
      icon={<FilePlus2 size={14} />}
      size="lg"
      okLabel="Create"
      onOk={() => {
        setName(name || "Untitled Scenario");
        setDesc(desc);
        setTileset(tileset);
        setW(w);
        setH(h);
        setModified(true);
        setStatus(`New ${w}×${h} ${ts.name} scenario`);
      }}
      footerLeft={<span>{ts.name} · {w}×{h} · {terrain}</span>}
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
                <Select value={terrain} onChange={(e) => setTerrain(e.target.value)} options={ts.terrain} />
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
  const [sel, setSel] = useState<number | null>(0);
  const close = useSetAtom(closeDialogAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Open Scenario"
      icon={<FolderOpen size={14} />}
      size="md"
      okLabel="Open"
      onOk={() => setStatus("Open is not wired up yet")}
      footerLeft={<span>Supports .scm · .scx · .chk</span>}
    >
      <div className="dropzone">
        <Upload size={22} />
        <div><strong>Drop a map file here</strong></div>
        <div className="hint">or</div>
        <Button onClick={() => { setStatus("File picker not wired up yet"); close(entry.key); }}>Browse…</Button>
      </div>
      <Group title="Recent" flush>
        <ListBox items={RECENT_FILES} selected={sel} onSelect={setSel} style={{ height: 120 }} render={(f) => <><FolderOpen size={12} className="faint" /><span className="mono">{f}</span></>} />
      </Group>
    </DialogFrame>
  );
}

/* ── Save As ────────────────────────────────────────────── */

export function SaveAsDialog({ entry }: DialogProps) {
  const [name] = useAtom(mapNameAtom);
  const [file, setFile] = useState(name.replace(/[^\w\- ]+/g, ""));
  const [fmt, setFmt] = useState("scx");
  const setStatus = useSetAtom(statusMessageAtom);
  return (
    <DialogFrame dialogKey={entry.key} title="Save Scenario As" icon={<Save size={14} />} size="sm" okLabel="Save" onOk={() => setStatus("Save As is not wired up yet")}>
      <div className="form wide">
        <Field label="File name">
          <div className="row">
            <TextInput value={file} onChange={(e) => setFile(e.target.value)} />
            <span className="mono dim">.{fmt}</span>
          </div>
        </Field>
        <Field label="Format">
          <Select value={fmt} onChange={(e) => setFmt(e.target.value)} options={[{ value: "scx", label: "Brood War scenario (.scx)" }, { value: "scm", label: "StarCraft scenario (.scm)" }, { value: "chk", label: "Raw chunk data (.chk)" }]} />
        </Field>
      </div>
      <Group title="Options">
        <div className="col" style={{ gap: 2 }}>
          <Check label="Compress MPQ archive" defaultChecked />
          <Check label="Include editor-only sections (SCMDraft compatible)" defaultChecked />
          <Check label="Protect map (strip editor data)" />
        </div>
      </Group>
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
