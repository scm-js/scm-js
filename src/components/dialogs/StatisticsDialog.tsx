import { useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { BarChart3, Copy } from "lucide-react";
import {
  doodadsRevisionAtom, locationsRevisionAtom, scenarioAtom, settingsRevisionAtom, terrainRevisionAtom, triggersRevisionAtom, unitsRevisionAtom,
} from "../../atoms/documentAtoms";
import { mapTilesetAtom } from "../../atoms/editorAtoms";
import { closeDialogAtom } from "../../atoms/uiAtoms";
import { TILESET_BY_ID } from "../../data/tilesets";
import { displayColorHex } from "../../data/players";
import { mapStatistics, statisticsText } from "../../editor/statistics";
import { useTileset } from "../../hooks/useTileset";
import { useUnitAssets } from "../../hooks/useUnitAssets";
import { Button, Field, Group } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

const na = (v: number | null) => (v === null ? <span className="faint">n/a</span> : v);

/** Tools ▸ Statistics: the map's contents counted up, read-only. */
export function StatisticsDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  const close = useSetAtom(closeDialogAtom);
  const revisions = [useAtomValue(terrainRevisionAtom), useAtomValue(unitsRevisionAtom), useAtomValue(doodadsRevisionAtom), useAtomValue(locationsRevisionAtom), useAtomValue(triggersRevisionAtom), useAtomValue(settingsRevisionAtom)];
  const info = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const { loaded: tileset } = useTileset();
  const { loaded: assets } = useUnitAssets();
  const [copied, setCopied] = useState(false);
  const stats = useMemo(() => {
    void revisions;
    return scenario ? mapStatistics(scenario, tileset?.tileset ?? null, info.terrain, assets?.units ?? null) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, tileset, assets, info, ...revisions]);

  if (!scenario || !stats) {
    return <DialogFrame dialogKey={entry.key} title="Statistics" icon={<BarChart3 size={14} />} size="sm"><p className="hint">Open or create a map first.</p></DialogFrame>;
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(statisticsText(stats));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const s = stats;

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Statistics"
      icon={<BarChart3 size={14} />}
      size="lg"
      tall
      footer={<><Button onClick={() => { void copy(); }}><Copy size={12} /> {copied ? "Copied" : "Copy as text"}</Button><Button variant="primary" onClick={() => close(entry.key)}>Close</Button></>}
      footerLeft={<span className="hint">{s.width} × {s.height} {s.tileset} · {s.revision} · {s.sections} sections</span>}
    >
      <div className="split" style={{ ["--split" as string]: "1fr" }}>
        <div className="stack">
          <Group title="Objects">
            <div className="form">
              <Field label="Units"><span className="mono">{s.units.total}{s.units.buildings !== null && <span className="faint"> · {s.units.buildings} buildings, {s.units.total - s.units.buildings} mobile</span>}{s.unownedUnits > 0 && <span className="faint"> · {s.unownedUnits} owned past player 12</span>}</span></Field>
              <Field label="Resources"><span className="mono">{s.resources.minerals.toLocaleString()} minerals <span className="faint">({s.resources.fields} fields)</span> · {s.resources.gas.toLocaleString()} gas <span className="faint">({s.resources.geysers} geysers)</span></span></Field>
              <Field label="Doodads"><span className="mono">{s.doodads}</span></Field>
              <Field label="Sprites"><span className="mono">{s.sprites.pure + s.sprites.unit} <span className="faint">· {s.sprites.pure} pure, {s.sprites.unit} unit</span></span></Field>
              <Field label="Locations"><span className="mono">{s.locations} <span className="faint">+ Anywhere</span></span></Field>
              <Field label="Triggers"><span className="mono">{s.triggers.count} <span className="faint">· {s.triggers.conditions} conditions, {s.triggers.actions} actions, {s.triggers.preserved} preserved, {s.triggers.disabled} disabled</span></span></Field>
              <Field label="Briefings"><span className="mono">{s.briefings}</span></Field>
              <Field label="Strings"><span className="mono">{s.strings.set} <span className="faint">of {s.strings.slots} slots ({s.strings.extended ? "STRx" : "STR"})</span></span></Field>
              <Field label="Switches"><span className="mono">{s.switchesNamed} <span className="faint">named</span></span></Field>
              <Field label="Sounds"><span className="mono">{s.sounds} <span className="faint">in the WAV table</span></span></Field>
            </div>
          </Group>
          <Group title="Most placed unit types" flush>
            <table className="table dense">
              <tbody>
                {s.units.top.map((t) => <tr key={t.id}><td className="num" style={{ width: 60 }}>{t.count}</td><td>{t.name} <span className="faint">#{t.id}</span></td></tr>)}
                {s.units.top.length === 0 && <tr><td className="hint">No units on the map.</td></tr>}
              </tbody>
            </table>
          </Group>
        </div>
        <div className="stack">
          <Group title="Players" flush>
            <table className="table dense" style={{ width: "100%", tableLayout: "fixed" }}>
              <thead><tr><th style={{ width: 44 }}>#</th><th>Type</th><th>Race</th><th style={{ width: 44 }} title="Units">Units</th><th style={{ width: 44 }} title="Buildings">Bldg</th><th style={{ width: 44 }} title="Start locations">Start</th></tr></thead>
              <tbody>
                {s.players.map((p) => (
                  <tr key={p.slot} className={p.type === "Inactive" && p.units === 0 ? "faint" : ""}>
                    <td><span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: displayColorHex(scenario.playerColors, scenario.playerRgb, p.slot), width: 10, height: 10 }} />{p.slot + 1}</span></td>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.type}>{p.type}</td>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.race}>{p.race}</td>
                    <td className="num">{p.units}</td><td className="num">{na(p.buildings)}</td><td className="num">{p.startLocations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Group>
          <Group title="Terrain" flush>
            {s.terrain ? (
              <table className="table dense">
                <tbody>
                  {s.terrain.slice(0, 10).map((t) => <tr key={t.name}><td className="num" style={{ width: 70 }}>{t.tiles}</td><td>{t.name} <span className="faint">{Math.round((t.tiles / (s.width * s.height)) * 100)}%</span></td></tr>)}
                  {s.terrain.length > 10 && <tr><td className="num">{s.terrain.slice(10).reduce((n, t) => n + t.tiles, 0)}</td><td className="faint">{s.terrain.length - 10} other types</td></tr>}
                </tbody>
              </table>
            ) : <p className="hint" style={{ padding: 8 }}>Terrain by type needs the tileset graphics (Help ▸ Game Data…).</p>}
          </Group>
        </div>
      </div>
    </DialogFrame>
  );
}
