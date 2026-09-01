import { useState } from "react";
import { useAtom, useSetAtom } from "jotai";
import { ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, Circle, FileText, FlipHorizontal2, Grid3x3, Maximize, ScrollText } from "lucide-react";
import { gridSizeAtom, mapDescriptionAtom, mapHeightAtom, mapNameAtom, mapTilesetAtom, mapVersionAtom, mapWidthAtom } from "../../atoms/editorAtoms";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { MAP_SIZES, TILESET_BY_ID } from "../../data/tilesets";
import { SAMPLE_LOCATIONS } from "../../data/samples";
import { SAMPLE_TRIGGERS } from "../../data/triggers";
import { Button, Check, Field, Group, Select, TextArea, TextInput } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/* ── Map Properties ─────────────────────────────────────── */

export function MapPropertiesDialog({ entry }: DialogProps) {
  const [name, setName] = useAtom(mapNameAtom);
  const [desc, setDesc] = useAtom(mapDescriptionAtom);
  const [tileset] = useAtom(mapTilesetAtom);
  const [w] = useAtom(mapWidthAtom);
  const [h] = useAtom(mapHeightAtom);
  const open = useSetAtom(openDialogAtom);
  const [localName, setLocalName] = useState(name);
  const [localDesc, setLocalDesc] = useState(desc);

  return (
    <DialogFrame dialogKey={entry.key} title="Map Properties" icon={<FileText size={14} />} size="md" onOk={() => { setName(localName); setDesc(localDesc); }} showApply>
      <Group title="Scenario">
        <div className="form wide">
          <Field label="Name" hint="Up to 128 characters. In-game colour codes (<04> etc.) are supported."><TextInput value={localName} onChange={(e) => setLocalName(e.target.value)} /></Field>
          <Field label="Description"><TextArea rows={5} value={localDesc} onChange={(e) => setLocalDesc(e.target.value)} /></Field>
        </div>
      </Group>
      <div className="split" style={{ ["--split" as string]: "1fr" }}>
        <Group title="Terrain">
          <div className="form">
            <Field label="Tileset">
              <div className="row"><span className="swatch" style={{ background: TILESET_BY_ID[tileset].color }} /><span>{TILESET_BY_ID[tileset].name}</span></div>
            </Field>
            <Field label="Size">
              <div className="row"><span className="mono">{w} × {h}</span><Button size="sm" onClick={() => open("resizeMap")}>Resize…</Button></div>
            </Field>
          </div>
        </Group>
        <Group title="Statistics">
          <div className="form">
            <Field label="Units"><span className="mono">0</span></Field>
            <Field label="Doodads"><span className="mono">0</span></Field>
            <Field label="Locations"><span className="mono">{SAMPLE_LOCATIONS.length}</span></Field>
            <Field label="Triggers"><span className="mono">{SAMPLE_TRIGGERS.length}</span></Field>
            <Field label="Strings"><span className="mono">10 / 65535</span></Field>
          </div>
        </Group>
      </div>
      <div className="row end">
        <Button size="sm" onClick={() => open("mapRevision")}>Map Revision…</Button>
        <Button size="sm" onClick={() => open("playerSettings")}>Players…</Button>
        <Button size="sm" onClick={() => open("forceSettings")}>Forces…</Button>
      </div>
    </DialogFrame>
  );
}

/* ── Resize / Crop ──────────────────────────────────────── */

const ANCHORS = [ArrowUpLeft, ArrowUp, ArrowUpRight, ArrowLeft, Circle, ArrowRight, ArrowDownLeft, ArrowDown, ArrowDownRight];

export function ResizeMapDialog({ entry }: DialogProps) {
  const [w, setW] = useAtom(mapWidthAtom);
  const [h, setH] = useAtom(mapHeightAtom);
  const [tileset] = useAtom(mapTilesetAtom);
  const [nw, setNw] = useState(w);
  const [nh, setNh] = useState(h);
  const [anchor, setAnchor] = useState(4);
  const ts = TILESET_BY_ID[tileset];
  return (
    <DialogFrame dialogKey={entry.key} title="Resize / Crop Map" icon={<Maximize size={14} />} size="md" okLabel="Resize" onOk={() => { setW(nw); setH(nh); }} footerLeft={<span>{w}×{h} → {nw}×{nh}</span>}>
      <div className="split" style={{ ["--split" as string]: "1fr" }}>
        <div className="stack">
          <Group title="New size">
            <div className="form">
              <Field label="Width"><Select value={String(nw)} onChange={(e) => setNw(Number(e.target.value))} options={MAP_SIZES.map(String)} /></Field>
              <Field label="Height"><Select value={String(nh)} onChange={(e) => setNh(Number(e.target.value))} options={MAP_SIZES.map(String)} /></Field>
              <Field label="Fill new area"><Select options={ts.terrain} defaultValue={ts.defaultTerrain} /></Field>
            </div>
          </Group>
          <Group title="Anchor existing terrain">
            <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
              <div className="anchor">
                {ANCHORS.map((Icon, i) => (
                  <button key={i} className={anchor === i ? "selected" : ""} onClick={() => setAnchor(i)}><Icon size={12} /></button>
                ))}
              </div>
              <p className="hint">Existing tiles, units and locations keep their position relative to the chosen edge or corner. Content outside the new bounds is cropped.</p>
            </div>
          </Group>
        </div>
        <Group title="Options">
          <div className="col" style={{ gap: 2 }}>
            <Check label="Move units and sprites" defaultChecked />
            <Check label="Move locations" defaultChecked />
            <Check label="Clamp locations to new bounds" defaultChecked />
            <Check label="Resize 'Anywhere' location" defaultChecked />
            <Check label="Extend edge terrain (smear)" />
          </div>
        </Group>
      </div>
    </DialogFrame>
  );
}

/* ── Map Revision ───────────────────────────────────────── */

export function MapRevisionDialog({ entry }: DialogProps) {
  const [version, setVersion] = useAtom(mapVersionAtom);
  const [v, setV] = useState(version);
  const opts: { id: typeof version; label: string; hint: string }[] = [
    { id: "original", label: "StarCraft 1.00 (.scm)", hint: "VER 59 · original unit set only, no Brood War units" },
    { id: "hybrid", label: "Hybrid 1.04 (.scm)", hint: "VER 63 · loads in both StarCraft and Brood War" },
    { id: "broodwar", label: "Brood War 1.04 (.scx)", hint: "VER 205 · full Brood War unit set (recommended)" },
    { id: "remastered", label: "Remastered 1.21+ (.scx)", hint: "VER 206 · extended unit / string limits (STRx)" },
  ];
  return (
    <DialogFrame dialogKey={entry.key} title="Map Revision" icon={<ScrollText size={14} />} size="sm" onOk={() => setVersion(v)}>
      <Group title="Scenario version">
        <div className="col" style={{ gap: 6 }}>
          {opts.map((o) => (
            <label key={o.id} className="check" style={{ height: "auto", alignItems: "flex-start" }}>
              <input type="radio" name="rev" checked={v === o.id} onChange={() => setV(o.id)} style={{ marginTop: 3 }} />
              <span><div>{o.label}</div><div className="hint">{o.hint}</div></span>
            </label>
          ))}
        </div>
      </Group>
      <Group title="Sections">
        <div className="col" style={{ gap: 2 }}>
          <Check label="Write extended string table (STRx)" disabled={v !== "remastered"} defaultChecked />
          <Check label="Write custom colours (COLR / CRGB)" defaultChecked />
          <Check label="Keep unknown sections on save" defaultChecked />
        </div>
      </Group>
    </DialogFrame>
  );
}

/* ── Grid Settings ──────────────────────────────────────── */

export function GridSettingsDialog({ entry }: DialogProps) {
  const [size, setSize] = useAtom(gridSizeAtom);
  const [local, setLocal] = useState(size);
  return (
    <DialogFrame dialogKey={entry.key} title="Grid Settings" icon={<Grid3x3 size={14} />} size="sm" onOk={() => setSize(local)}>
      <Group title="Grid">
        <div className="form">
          <Field label="Spacing">
            <Select value={String(local)} onChange={(e) => setLocal(Number(e.target.value) as typeof size)} options={[{ value: "8", label: "8 px (mini-tile)" }, { value: "16", label: "16 px" }, { value: "32", label: "32 px (tile)" }, { value: "64", label: "64 px" }, { value: "128", label: "128 px (isometric)" }]} />
          </Field>
          <Field label="Colour"><div className="row"><input type="color" className="input" defaultValue="#000000" /><input type="range" min={0} max={100} defaultValue={30} /></div></Field>
          <Field label="Style"><Select options={["Lines", "Dots", "Crosses"]} /></Field>
        </div>
      </Group>
      <Group title="Snapping">
        <div className="col" style={{ gap: 2 }}>
          <Check label="Snap units to grid" />
          <Check label="Snap locations to grid" defaultChecked />
          <Check label="Snap sprites to grid" />
        </div>
      </Group>
    </DialogFrame>
  );
}

/* ── Symmetry ───────────────────────────────────────────── */

export function SymmetryDialog({ entry }: DialogProps) {
  const [mode, setMode] = useState("none");
  const modes = [
    ["none", "None"], ["h", "Mirror horizontally"], ["v", "Mirror vertically"], ["hv", "Mirror both axes (4-way)"],
    ["rot2", "Rotational 180°"], ["rot4", "Rotational 90° (4-way)"], ["diag", "Diagonal (top-left ↔ bottom-right)"], ["adiag", "Anti-diagonal"],
  ];
  return (
    <DialogFrame dialogKey={entry.key} title="Symmetry Tool" icon={<FlipHorizontal2 size={14} />} size="sm">
      <Group title="Mode">
        <div className="col" style={{ gap: 2 }}>
          {modes.map(([id, label]) => <Check key={id} radio name="sym" label={label} checked={mode === id} onChange={() => setMode(id)} />)}
        </div>
      </Group>
      <Group title="Apply to">
        <div className="col" style={{ gap: 2 }}>
          <Check label="Terrain" defaultChecked />
          <Check label="Doodads" defaultChecked />
          <Check label="Units (mirror owner by force)" />
          <Check label="Locations" />
        </div>
      </Group>
      <p className="hint">Placement is mirrored live while a symmetry mode is active.</p>
    </DialogFrame>
  );
}
