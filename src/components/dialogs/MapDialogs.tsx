import { useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, Circle, FileText, Grid3x3, Maximize, ScrollText } from "lucide-react";
import { doodadPlacementAtom, gridSizeAtom, locationSnapAtom, mapDescriptionAtom, mapHeightAtom, mapModifiedAtom, mapNameAtom, mapTilesetAtom, mapWidthAtom } from "../../atoms/editorAtoms";
import { changeTilesetAtom, commitSettingsAtom, resizeDocumentAtom, scenarioAtom, settingsRevisionAtom, triggersRevisionAtom } from "../../atoms/documentAtoms";
import { ensureTileset, TILESET_FILENAMES } from "../../formats/tileset/load";
import { gridLookAtom, type GridStyle } from "../../atoms/preferencesAtoms";
import { openDialogAtom, statusMessageAtom } from "../../atoms/uiAtoms";
import { resizePreview } from "../../editor/resize";
import { useTileset } from "../../hooks/useTileset";
import { MAP_VERSIONS, mapVersionOf, setMapVersion, setScenarioDescription, setScenarioName, type MapVersion, type Scenario } from "../../formats/chk/scenario";
import { PLAYER_TYPES } from "../../data/players";
import { useScenarioForm } from "../../hooks/useScenarioForm";
import { PlayerType } from "../../formats/chk/sections/players";
import { isLocationUsed } from "../../formats/chk/sections/objects";
import { MAP_SIZES, TILESET_BY_ID, TILESETS, type TilesetId } from "../../data/tilesets";
import { Button, Check, Field, Group, Select, TextArea, TextInput } from "../ui";
import { ColorCodeBar, insertAtCaret, StringPreview } from "../ui/ColorCodes";
import { escapeControls, unescapeControls } from "../../editor/strings";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/** "4 human, 2 computer, 4 neutral" — the OWNR table in a phrase. */
function playerSummary(scenario: Scenario): string {
  const counts = new Map<number, number>();
  for (const t of scenario.playerTypes) if (t !== PlayerType.Inactive) counts.set(t, (counts.get(t) ?? 0) + 1);
  if (counts.size === 0) return "none";
  return [...counts].map(([t, n]) => `${n} ${(PLAYER_TYPES.find((p) => p.value === t)?.label ?? `type ${t}`).toLowerCase()}`).join(", ");
}

/* ── Map Properties ─────────────────────────────────────── */

export function MapPropertiesDialog({ entry }: DialogProps) {
  const [name, setName] = useAtom(mapNameAtom);
  const [desc, setDesc] = useAtom(mapDescriptionAtom);
  const [tileset] = useAtom(mapTilesetAtom);
  const [w] = useAtom(mapWidthAtom);
  const [h] = useAtom(mapHeightAtom);
  const open = useSetAtom(openDialogAtom);
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(settingsRevisionAtom); // the revision and player summary change under the other dialogs
  useAtomValue(triggersRevisionAtom);
  const setModified = useSetAtom(mapModifiedAtom);
  const commitSettings = useSetAtom(commitSettingsAtom);
  const changeTs = useSetAtom(changeTilesetAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const [localName, setLocalName] = useState(name);
  const [localDesc, setLocalDesc] = useState(desc);
  const [localTileset, setLocalTileset] = useState<TilesetId>(tileset);
  const [fill, setFill] = useState(TILESET_BY_ID[tileset].defaultIsom);
  const [keepTiles, setKeepTiles] = useState(false);
  // The name and description are ordinary strings in the table, so they carry the same
  // `<XX>` control bytes every other string does; the fields show them escaped.
  const nameRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [field, setField] = useState<"name" | "desc">("name");
  const tilesetChanged = localTileset !== tileset;
  const insertCode = (code: string) => {
    if (field === "name") setLocalName(unescapeControls(insertAtCaret(nameRef.current, escapeControls(localName), code)));
    else setLocalDesc(unescapeControls(insertAtCaret(descRef.current, escapeControls(localDesc), code)));
  };
  const pickTileset = (id: TilesetId) => { setLocalTileset(id); setFill(TILESET_BY_ID[id].defaultIsom); };

  // Writing back marks SPRP and the string table dirty; every other section is still
  // re-emitted from the bytes we read. A tileset change is the whole-document transaction
  // in editor/tileset.ts, run once the new graphics are in so the fill uses real tiles.
  const apply = () => {
    setName(localName);
    setDesc(localDesc);
    if (!scenario) return;
    if (localName !== name) setScenarioName(scenario, localName);
    if (localDesc !== desc) setScenarioDescription(scenario, localDesc);
    if (localName !== name || localDesc !== desc) { setModified(true); commitSettings(); }
    if (tilesetChanged) {
      const era = Math.max(0, TILESETS.findIndex((t) => t.id === localTileset));
      const run = () => {
        const r = changeTs({ tileset: localTileset, terrainId: fill, keepTiles });
        if (!r) return;
        const dropped = [r.doodadsDropped && `${r.doodadsDropped} doodad${r.doodadsDropped === 1 ? "" : "s"}`, r.spritesDropped && `${r.spritesDropped} overlay sprite${r.spritesDropped === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
        setStatus(`Tileset changed to ${TILESET_BY_ID[localTileset].name}${r.refilled ? ` — terrain refilled with ${TILESET_BY_ID[localTileset].terrain.find((t) => t.id === fill)?.name ?? "the default"}` : " — tile numbers kept"}${dropped ? `, dropped ${dropped}` : ""}`);
      };
      setStatus(`Loading the ${TILESET_BY_ID[localTileset].name} graphics…`);
      ensureTileset(TILESET_FILENAMES[era]).then(run, run);
    }
  };

  return (
    <DialogFrame dialogKey={entry.key} title="Map Properties" icon={<FileText size={14} />} size="md" onOk={apply} showApply>
      <Group title="Scenario">
        <div className="form wide">
          <Field label="Name" hint="Up to 128 characters. Control bytes show as <XX> and may be typed that way.">
            <TextInput ref={nameRef} value={escapeControls(localName)} onFocus={() => setField("name")} onChange={(e) => setLocalName(unescapeControls(e.target.value))} />
          </Field>
          <Field label="Description">
            <TextArea ref={descRef} rows={5} value={escapeControls(localDesc)} onFocus={() => setField("desc")} onChange={(e) => setLocalDesc(unescapeControls(e.target.value))} />
          </Field>
          <Field label="">
            <div className="col" style={{ gap: 6 }}>
              <ColorCodeBar onInsert={insertCode} />
              <StringPreview text={field === "name" ? localName : localDesc} placeholder={field === "name" ? "No name" : "No description"} />
            </div>
          </Field>
        </div>
      </Group>
      <div className="split" style={{ ["--split" as string]: "1fr" }}>
        <Group title="Terrain">
          <div className="form">
            <Field label="Tileset" hint={tilesetChanged ? "Tile numbers mean something else in every tileset, so the terrain is laid again and the doodads go. Units, sprites, locations, fog and triggers stay. This clears the undo history." : undefined}>
              <div className="row">
                <span className="swatch" style={{ background: TILESET_BY_ID[localTileset].color }} />
                <Select value={localTileset} onChange={(e) => pickTileset(e.target.value as TilesetId)} options={TILESETS.map((t) => ({ value: t.id, label: t.name }))} />
              </div>
            </Field>
            {tilesetChanged && !keepTiles && (
              <Field label="Refill with">
                <Select value={String(fill)} onChange={(e) => setFill(Number(e.target.value))} options={TILESET_BY_ID[localTileset].terrain.map((t) => ({ value: String(t.id), label: t.name }))} />
              </Field>
            )}
            {tilesetChanged && (
              <Field label="">
                <Check label="Keep the tile numbers" title="Change only the tileset id and leave every tile number as it is — what SCMDraft's tileset switch does; the picture becomes whatever those numbers draw in the new tileset" checked={keepTiles} onChange={(e) => setKeepTiles(e.target.checked)} />
              </Field>
            )}
            <Field label="Size">
              <div className="row"><span className="mono">{w} × {h}</span><Button size="sm" onClick={() => open("resizeMap")}>Resize…</Button></div>
            </Field>
            <Field label="Revision">
              <div className="row">
                <span>{scenario ? MAP_VERSIONS[mapVersionOf(scenario.fileVersion)].label : "—"}</span>
                {scenario && <span className="faint mono">VER {scenario.fileVersion} · {scenario.type}</span>}
                <Button size="sm" onClick={() => open("mapRevision")}>Change…</Button>
              </div>
            </Field>
            <Field label="Players">
              <span>{scenario ? playerSummary(scenario) : "—"}</span>
            </Field>
          </div>
        </Group>
        <Group title="Statistics">
          <div className="form">
            <Field label="Units"><span className="mono">{scenario ? scenario.units.length : 0}</span></Field>
            <Field label="Sprites"><span className="mono">{scenario ? scenario.sprites.length : 0}</span></Field>
            <Field label="Doodads"><span className="mono">{scenario ? scenario.doodads.length : 0}</span></Field>
            <Field label="Locations"><span className="mono">{scenario ? scenario.locations.filter(isLocationUsed).length : 0}</span></Field>
            <Field label="Triggers"><span className="mono">{scenario ? scenario.triggers.length : 0}</span></Field>
            <Field label="Strings"><span className="mono">{scenario ? scenario.strings.strings.length - 1 : 0} / {scenario?.strings.extended ? 65535 : 1024}</span></Field>
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
const ANCHOR_NAMES = ["top-left", "top", "top-right", "left", "centre", "right", "bottom-left", "bottom", "bottom-right"];

/**
 * Scenario ▸ Resize / Crop Map: the whole document moves (editor/resize.ts), so this is
 * a transaction outside the undo history, like the settings dialogs. The preview line
 * says what the chosen size and anchor would crop before anything happens.
 */
export function ResizeMapDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  const w = useAtomValue(mapWidthAtom);
  const h = useAtomValue(mapHeightAtom);
  const [tileset] = useAtom(mapTilesetAtom);
  const resize = useSetAtom(resizeDocumentAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const { loaded } = useTileset();
  const [nw, setNw] = useState(w);
  const [nh, setNh] = useState(h);
  const [anchor, setAnchor] = useState(4);
  const ts = TILESET_BY_ID[tileset];
  const [terrain, setTerrain] = useState(ts.defaultIsom);
  const [clamp, setClamp] = useState(true);
  const preview = useMemo(() => (scenario ? resizePreview(scenario, nw, nh, anchor) : null), [scenario, nw, nh, anchor]);
  const same = nw === w && nh === h;

  if (!scenario) {
    return <DialogFrame dialogKey={entry.key} title="Resize / Crop Map" icon={<Maximize size={14} />} size="sm"><p className="hint">Open or create a map first.</p></DialogFrame>;
  }

  const apply = () => {
    const r = resize({ width: nw, height: nh, anchor, terrainId: terrain, clampLocations: clamp });
    if (!r) return;
    const dropped = [r.unitsDropped && `${r.unitsDropped} units`, r.spritesDropped && `${r.spritesDropped} sprites`, r.doodadsDropped && `${r.doodadsDropped} doodads`].filter(Boolean).join(", ");
    setStatus(`Resized to ${nw}×${nh} (${ANCHOR_NAMES[anchor]} anchor)${dropped ? ` — dropped ${dropped}` : ""}${r.locationsClamped ? `, clamped ${r.locationsClamped} locations` : ""}${r.isomRebuilt ? "" : " — ISOM is the fill's; Rebuild ISOM once the tileset is loaded"}`);
  };

  const crops = preview ? [
    preview.unitsDropped && `${preview.unitsDropped} unit${preview.unitsDropped === 1 ? "" : "s"}`,
    preview.spritesDropped && `${preview.spritesDropped} sprite${preview.spritesDropped === 1 ? "" : "s"}`,
    preview.doodadsDropped && `${preview.doodadsDropped} doodad${preview.doodadsDropped === 1 ? "" : "s"}`,
  ].filter(Boolean) : [];

  return (
    <DialogFrame dialogKey={entry.key} title="Resize / Crop Map" icon={<Maximize size={14} />} size="md" okLabel="Resize" onOk={apply} footerLeft={<span className="mono hint">{w}×{h} → {nw}×{nh}{preview ? ` · offset ${preview.dx}, ${preview.dy}` : ""}</span>}>
      <div className="split" style={{ ["--split" as string]: "1fr" }}>
        <div className="stack">
          <Group title="New size">
            <div className="form">
              <Field label="Width"><Select value={String(nw)} onChange={(e) => setNw(Number(e.target.value))} options={MAP_SIZES.map(String)} /></Field>
              <Field label="Height"><Select value={String(nh)} onChange={(e) => setNh(Number(e.target.value))} options={MAP_SIZES.map(String)} /></Field>
              <Field label="Fill new area"><Select value={String(terrain)} onChange={(e) => setTerrain(Number(e.target.value))} options={ts.terrain.map((t) => ({ value: String(t.id), label: t.name }))} /></Field>
            </div>
          </Group>
          <Group title="Anchor existing terrain">
            <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
              <div className="anchor">
                {ANCHORS.map((Icon, i) => (
                  <button key={i} className={anchor === i ? "selected" : ""} onClick={() => setAnchor(i)} title={ANCHOR_NAMES[i]}><Icon size={12} /></button>
                ))}
              </div>
              <p className="hint">Existing tiles, units and locations keep their position relative to the chosen edge or corner (whole tile pairs, so the offset is even). Content outside the new bounds is cropped.</p>
            </div>
          </Group>
        </div>
        <div className="stack">
          <Group title="Options">
            <div className="col" style={{ gap: 2 }}>
              <Check label="Clamp locations to new bounds" checked={clamp} onChange={(e) => setClamp(e.target.checked)} />
            </div>
            <p className="hint" style={{ marginTop: 6 }}>Locations are never dropped — triggers name them by slot. Anywhere becomes the new map.</p>
          </Group>
          <Group title="What will happen">
            <ul className="hint" style={{ margin: 0, paddingLeft: 16 }}>
              {same && <li>The size is unchanged; nothing will move.</li>}
              {!same && <li>{crops.length > 0 ? `Cropped: ${crops.join(", ")}.` : "No units, sprites or doodads fall outside."}</li>}
              {!same && preview && preview.locationsClamped > 0 && <li>{preview.locationsClamped} location{preview.locationsClamped === 1 ? "" : "s"} hang{preview.locationsClamped === 1 ? "s" : ""} past the edge{clamp ? " and will be pulled inside" : " and will stay there"}.</li>}
              {!same && (scenario.isom ? <li>{loaded ? "ISOM will be rebuilt from the tiles." : "The tileset is not loaded, so ISOM will be the fill's lattice — run Rebuild ISOM afterwards."}</li> : <li>The map has no ISOM section; none is made.</li>)}
              <li>This cannot be undone: the undo history is cleared.</li>
            </ul>
          </Group>
        </div>
      </div>
    </DialogFrame>
  );
}

/* ── Map Revision ───────────────────────────────────────── */

/** Revision-specific section pairs: which of each the file carries says what other editors wrote. */
const REVISION_PAIRS: [string, string, string][] = [
  ["Strings", "STR ", "STRx"],
  ["Unit settings", "UNIS", "UNIx"],
  ["Upgrade settings", "UPGS", "UPGx"],
  ["Technology settings", "TECS", "TECx"],
  ["Upgrade restrictions", "UPGR", "PUPx"],
  ["Technology restrictions", "PTEC", "PTEx"],
  ["Player colours", "COLR", "CRGB"],
];

/**
 * VER / TYPE, and the string table's width. Changing the revision does not convert the
 * settings sections — a hybrid map legitimately carries both UNIS and UNIx, and the
 * settings dialogs write whichever the new revision reads the next time they apply.
 */
export function MapRevisionDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(settingsRevisionAtom);
  const commit = useSetAtom(commitSettingsAtom);
  const [form, setForm] = useScenarioForm(scenario, (scn) => ({ v: mapVersionOf(scn.fileVersion), strx: scn.strings.extended }));
  const v: MapVersion = form?.v ?? "broodwar";
  const strx = form?.strx ?? false;
  const setStrx = (on: boolean) => { if (form) setForm({ ...form, strx: on }); };
  const opts: { id: MapVersion; hint: string }[] = [
    { id: "original", hint: "original unit set only, no Brood War units" },
    { id: "hybrid", hint: "loads in both StarCraft and Brood War" },
    { id: "broodwar", hint: "full Brood War unit set (recommended)" },
    { id: "remastered", hint: "extended unit / string limits (STRx)" },
  ];
  // A new map's CHK is empty until its first save; what it will write is in the dirty set.
  const has = (name: string) => (scenario?.chk.sections.some((s) => s.name === name) || scenario?.dirty.has(name)) ?? false;
  const pick = (id: MapVersion) => { if (form) setForm({ v: id, strx: id === "remastered" && (strx || scenario?.strings.extended === false) }); };
  const apply = () => { if (scenario) { setMapVersion(scenario, v, strx); commit(); } };

  if (!scenario) {
    return <DialogFrame dialogKey={entry.key} title="Map Revision" icon={<ScrollText size={14} />} size="sm"><p className="hint">Open or create a map first.</p></DialogFrame>;
  }

  return (
    <DialogFrame dialogKey={entry.key} title="Map Revision" icon={<ScrollText size={14} />} size="sm" onOk={apply} showApply footerLeft={<span className="mono hint">VER {scenario.fileVersion} · {scenario.type} · {scenario.strings.extended ? "STRx" : "STR"}</span>}>
      <Group title="Scenario version">
        <div className="col" style={{ gap: 6 }}>
          {opts.map((o) => {
            const m = MAP_VERSIONS[o.id];
            return (
              <label key={o.id} className="check" style={{ height: "auto", alignItems: "flex-start" }}>
                <input type="radio" name="rev" checked={v === o.id} onChange={() => pick(o.id)} style={{ marginTop: 3 }} />
                <span><div>{m.label} (.{m.extension})</div><div className="hint">VER {m.ver} · {m.type} · {o.hint}</div></span>
              </label>
            );
          })}
        </div>
      </Group>
      <Group title="String table">
        <Check label="Write the extended string table (STRx, 32-bit offsets)" disabled={v !== "remastered"} checked={v === "remastered" && strx} onChange={(e) => setStrx(e.target.checked)} />
        <p className="hint" style={{ marginTop: 4 }}>
          {scenario.strings.extended && v !== "remastered"
            ? "This file has STRx; leaving Remastered converts it back to STR. Strings past 65535 or offsets past 64 KB would not fit."
            : "Only Remastered reads STRx. The table's indices are unchanged either way; triggers and locations keep pointing where they did."}
        </p>
      </Group>
      <Group title="In this file">
        <table className="table dense">
          <thead><tr><th></th><th>Original</th><th>Brood War</th></tr></thead>
          <tbody>
            {REVISION_PAIRS.map(([label, a, b]) => (
              <tr key={label}><td>{label}</td><td className={has(a) ? "" : "faint"}>{a.trim()}{has(a) ? "" : " —"}</td><td className={has(b) ? "" : "faint"}>{b}{has(b) ? "" : " —"}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="hint" style={{ marginTop: 6 }}>Sections the editor does not model are written back byte for byte whatever the revision.</p>
      </Group>
    </DialogFrame>
  );
}

/* ── Grid Settings ──────────────────────────────────────── */

/** View ▸ Grid Settings: spacing, the grid's look (persisted) and what snaps to it. */
export function GridSettingsDialog({ entry }: DialogProps) {
  const [size, setSize] = useAtom(gridSizeAtom);
  const [look, setLook] = useAtom(gridLookAtom);
  const [locationSnap, setLocationSnap] = useAtom(locationSnapAtom);
  const [doodadPlacement, setDoodadPlacement] = useAtom(doodadPlacementAtom);
  const [local, setLocal] = useState(size);
  const [localLook, setLocalLook] = useState(look);
  const [snapLocations, setSnapLocations] = useState(locationSnap !== 0);
  const [snapDoodads, setSnapDoodads] = useState(doodadPlacement.snapToGrid);
  const apply = () => {
    setSize(local);
    setLook(localLook);
    setLocationSnap(snapLocations ? local : 0);
    if (doodadPlacement.snapToGrid !== snapDoodads) setDoodadPlacement({ ...doodadPlacement, snapToGrid: snapDoodads });
  };
  return (
    <DialogFrame dialogKey={entry.key} title="Grid Settings" icon={<Grid3x3 size={14} />} size="sm" onOk={apply} showApply>
      <Group title="Grid">
        <div className="form">
          <Field label="Spacing">
            <Select value={String(local)} onChange={(e) => setLocal(Number(e.target.value) as typeof size)} options={[{ value: "8", label: "8 px (mini-tile)" }, { value: "16", label: "16 px" }, { value: "32", label: "32 px (tile)" }, { value: "64", label: "64 px" }, { value: "128", label: "128 px (isometric)" }]} />
          </Field>
          <Field label="Colour">
            <div className="row">
              <input type="color" className="input" value={localLook.color} onChange={(e) => setLocalLook({ ...localLook, color: e.target.value })} aria-label="Grid colour" />
              <input type="range" min={0} max={100} value={localLook.opacity} onChange={(e) => setLocalLook({ ...localLook, opacity: Number(e.target.value) })} aria-label="Grid opacity" />
              <span className="mono hint" style={{ width: 36 }}>{localLook.opacity}%</span>
            </div>
          </Field>
          <Field label="Style"><Select value={localLook.style} onChange={(e) => setLocalLook({ ...localLook, style: e.target.value as GridStyle })} options={[{ value: "lines", label: "Lines" }, { value: "dots", label: "Dots" }, { value: "crosses", label: "Crosses" }]} /></Field>
        </div>
      </Group>
      <Group title="Snapping">
        <div className="col" style={{ gap: 2 }}>
          <Check className="wrap" label={`Snap locations to the grid (${local} px)`} checked={snapLocations} onChange={(e) => setSnapLocations(e.target.checked)} />
          <Check className="wrap" label="Snap doodads to the two-tile isometric grid" checked={snapDoodads} onChange={(e) => setSnapDoodads(e.target.checked)} />
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          Locations snap to the spacing above; the Locations palette can pick a different step. A doodad's snap is
          always the two-tile grid StarEdit places them on, whatever the spacing is — the same tick as the Doodads
          palette's. Units have their own “Snap to grid” in the Units palette; sprites are always placed by the pixel.
        </p>
      </Group>
    </DialogFrame>
  );
}

/* ── Symmetry ───────────────────────────────────────────── */

/** Tools ▸ Symmetry… lives in its own file (editor/symmetry.ts is the model); re-exported here so the registry's import stays put. */
export { SymmetryDialog } from "./SymmetryDialog";
