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
import { t, translate } from "../../i18n";

const na = (v: number | null) => (v === null ? <span className="faint">{t("n/a")}</span> : v);

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
    return <DialogFrame dialogKey={entry.key} title={t("Statistics")} icon={<BarChart3 size={14} />} size="sm"><p className="hint">{t("Open or create a map first.")}</p></DialogFrame>;
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
      title={t("Statistics")}
      icon={<BarChart3 size={14} />}
      size="lg"
      tall
      footer={<><Button onClick={() => { void copy(); }}><Copy size={12} /> {copied ? t("Copied") : t("Copy as text")}</Button><Button variant="primary" onClick={() => close(entry.key)}>{t("Close")}</Button></>}
      footerLeft={<span className="hint">{t("{width} × {height}  {tileset} · {revision} · {sections, plural, one {# section} other {# sections}}", { width: s.width, height: s.height, tileset: translate(s.tileset), revision: translate(s.revision), sections: s.sections })}</span>}
    >
      <div className="split" style={{ ["--split" as string]: "1fr" }}>
        <div className="stack">
          <Group title={t("Objects")}>
            <div className="form">
              <Field label={t("Units")}><span className="mono">{s.units.total}{s.units.buildings !== null && <span className="faint"> · {t("{b} buildings, {m} mobile", { b: s.units.buildings, m: s.units.total - s.units.buildings })}</span>}{s.unownedUnits > 0 && <span className="faint"> · {t("{n} owned past player 12", { n: s.unownedUnits })}</span>}</span></Field>
              <Field label={t("Resources")}><span className="mono">{t("{minerals} minerals", { minerals: s.resources.minerals.toLocaleString() })}{" "}<span className="faint">{t("({n, plural, one {# field} other {# fields}})", { n: s.resources.fields })}</span> · {t("{gas} gas", { gas: s.resources.gas.toLocaleString() })} <span className="faint">{t("({n, plural, one {# geyser} other {# geysers}})", { n: s.resources.geysers })}</span></span></Field>
              <Field label={t("Doodads")}><span className="mono">{s.doodads}</span></Field>
              <Field label={t("Sprites")}><span className="mono">{s.sprites.pure + s.sprites.unit} <span className="faint">{t("· {pure} pure, {unit} unit", { pure: s.sprites.pure, unit: s.sprites.unit })}</span></span></Field>
              <Field label={t("Locations")}><span className="mono">{s.locations} <span className="faint">{t("+ Anywhere")}</span></span></Field>
              <Field label={t("Triggers")}><span className="mono">{s.triggers.count} <span className="faint">{t("· {conditions, plural, one {# condition} other {# conditions}}, {actions, plural, one {# action} other {# actions}}, {preserved} preserved, {disabled} disabled", { conditions: s.triggers.conditions, actions: s.triggers.actions, preserved: s.triggers.preserved, disabled: s.triggers.disabled })}</span></span></Field>
              <Field label={t("Briefing")}><span className="mono">{s.briefings.count} <span className="faint">{t("· {actions, plural, one {# action} other {# actions}}", { actions: s.briefings.actions })}</span></span></Field>
              <Field label={t("Strings")}><span className="mono">{s.strings.set} <span className="faint">{t("of {slots} slots ({section})", { slots: s.strings.slots, section: s.strings.extended ? "STRx" : "STR" })}</span></span></Field>
              <Field label={t("Switches")}><span className="mono">{s.switchesNamed} <span className="faint">{t("named")}</span></span></Field>
              <Field label={t("Sounds")}><span className="mono">{s.sounds} <span className="faint">{t("in the WAV table")}</span></span></Field>
            </div>
          </Group>
          <Group title={t("Most placed unit types")} flush>
            <table className="table dense">
              <tbody>
                {s.units.top.map((t) => <tr key={t.id}><td className="num" style={{ width: 60 }}>{t.count}</td><td>{translate(t.name)} <span className="faint">#{t.id}</span></td></tr>)}
                {s.units.top.length === 0 && <tr><td className="hint">{t("No units on the map.")}</td></tr>}
              </tbody>
            </table>
          </Group>
        </div>
        <div className="stack">
          <Group title={t("Players")} flush>
            <table className="table dense" style={{ width: "100%", tableLayout: "fixed" }}>
              <thead><tr><th style={{ width: 44 }}>#</th><th>{t("Type")}</th><th>{t("Race")}</th><th style={{ width: 44 }} title={t("Units")}>{t("Units")}</th><th style={{ width: 44 }} title={t("Buildings")}>{t("Bldg")}</th><th style={{ width: 44 }} title={t("Start locations")}>{t("Start")}</th></tr></thead>
              <tbody>
                {s.players.map((p) => (
                  <tr key={p.slot} className={p.type === "Inactive" && p.units === 0 ? "faint" : ""}>
                    <td><span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: displayColorHex(scenario.playerColors, scenario.playerRgb, p.slot), width: 10, height: 10 }} />{p.slot + 1}</span></td>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={translate(p.type)}>{translate(p.type)}</td>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={translate(p.race)}>{translate(p.race)}</td>
                    <td className="num">{p.units}</td><td className="num">{na(p.buildings)}</td><td className="num">{p.startLocations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Group>
          <Group title={t("Terrain")} flush>
            {s.terrain ? (
              <table className="table dense">
                <tbody>
                  {s.terrain.slice(0, 10).map((t) => <tr key={t.name}><td className="num" style={{ width: 70 }}>{t.tiles}</td><td>{translate(t.name)} <span className="faint">{Math.round((t.tiles / (s.width * s.height)) * 100)}%</span></td></tr>)}
                  {s.terrain.length > 10 && <tr><td className="num">{s.terrain.slice(10).reduce((n, t) => n + t.tiles, 0)}</td><td className="faint">{t("{v} other types", { v: s.terrain.length - 10 })}</td></tr>}
                </tbody>
              </table>
            ) : <p className="hint" style={{ padding: 8 }}>{t("Terrain by type needs the tileset graphics (Help ▸ Game Data…).")}</p>}
          </Group>
        </div>
      </div>
    </DialogFrame>
  );
}
