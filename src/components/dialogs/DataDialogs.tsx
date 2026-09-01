import { useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { FlaskConical, RotateCcw, Search, Swords, TrendingUp } from "lucide-react";
import { commitSettingsAtom, scenarioAtom, settingsRevisionAtom } from "../../atoms/documentAtoms";
import { displayColorHex, PLAYER_COLORS } from "../../data/players";
import { RACE_LABEL, TECHS, UNIT_GROUPS, unitName, UPGRADES } from "../../data/units";
import { weaponName } from "../../data/weapons";
import { NO_UNIT, NO_WEAPON } from "../../formats/dat/dat";
import { unitSettingsSections } from "../../formats/chk/scenario";
import { cloneUnitAvailability, cloneUnitSettings, defaultUnitAvailability, defaultUnitSettings, PLAYER_SLOTS, puniIndex } from "../../formats/chk/sections/settings";
import { applyUnitSettings, readUnitSettings, unitCustomName } from "../../editor/settings";
import { useScenarioForm } from "../../hooks/useScenarioForm";
import { useUnitAssets } from "../../hooks/useUnitAssets";
import { SpritePreview } from "../panels/UnitPreview";
import { Button, Check, Field, Group, ListBox, NumberInput, Select, TextInput } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

function FilterList({ items, selected, onSelect, placeholder }: { items: string[]; selected: number; onSelect: (i: number) => void; placeholder: string }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => items.map((name, i) => ({ name, i })).filter((x) => x.name.toLowerCase().includes(q.toLowerCase())), [items, q]);
  return (
    <div className="col" style={{ minHeight: 0, height: "100%" }}>
      <div className="row">
        <Search size={12} className="faint" />
        <TextInput placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ListBox className="grow" items={filtered} selected={filtered.findIndex((x) => x.i === selected)} onSelect={(_, it) => onSelect(it.i)} render={(it) => <><span className="idx">{it.i}</span>{it.name}</>} style={{ flex: 1 }} />
    </div>
  );
}

const PLAYER_OPTS = ["Default", "Enabled", "Disabled"];

function PlayerAvailability({ label, opts = PLAYER_OPTS }: { label: string; opts?: string[] }) {
  return (
    <Group title={label} flush>
      <div className="listbox" style={{ border: "none", boxShadow: "none", maxHeight: 190 }}>
        <table className="table dense">
          <tbody>
            {PLAYER_COLORS.slice(0, 12).map((c, i) => (
              <tr key={i}>
                <td style={{ width: 90 }}><span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: c.hex, width: 10, height: 10 }} />Player {i + 1}</span></td>
                <td><Select options={opts} defaultValue={opts[0]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Group>
  );
}

/* ── Unit Settings ──────────────────────────────────────── */

interface UnitItem { id: number; name: string; group: string }

/** Every unit type in palette order, with its group for the list's section labels. */
const UNIT_ITEMS: UnitItem[] = UNIT_GROUPS.flatMap((g) => g.units.map((id) => ({ id, name: unitName(id), group: g.label })));

function UnitList({ selected, onSelect }: { selected: number; onSelect: (id: number) => void }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return UNIT_ITEMS.filter((u) => !needle || u.name.toLowerCase().includes(needle) || String(u.id) === needle);
  }, [q]);
  return (
    <div className="col" style={{ minHeight: 0, height: "100%" }}>
      <div className="row">
        <Search size={12} className="faint" />
        <TextInput placeholder="Find unit… (name or id)" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ListBox className="grow" items={filtered} selected={filtered.findIndex((u) => u.id === selected)} onSelect={(_, u) => onSelect(u.id)} render={(u) => <><span className="idx">{u.id}</span>{u.name}</>} style={{ flex: 1 }} />
    </div>
  );
}

type Availability = "default" | "enabled" | "disabled";
const AVAILABILITY_OPTS: { value: Availability; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
];

/**
 * UNIS / UNIx and PUNI, edited on working copies and installed as one transaction.
 * A type on "use default" shows its units.dat / weapons.dat numbers greyed; unticking it
 * seeds the row from those so the file gets real values rather than zeros (StarEdit's
 * behaviour). Weapon damage is per weapon, not per unit, so two types sharing a weapon
 * share the row.
 */
export function UnitSettingsDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(settingsRevisionAtom);
  const commit = useSetAtom(commitSettingsAtom);
  const { loaded: assets } = useUnitAssets();
  const [sel, setSel] = useState(0);
  const [state, setState] = useScenarioForm(scenario, (scn) => ({ ...readUnitSettings(scn), names: new Map<number, string>() }));
  const [, bump] = useState(0); // the copies are typed arrays edited in place

  if (!scenario || !state) {
    return <DialogFrame dialogKey={entry.key} title="Unit Settings" icon={<Swords size={14} />} size="sm"><p className="hint">Open or create a map first.</p></DialogFrame>;
  }

  const { settings, availability, names } = state;
  const setNames = (next: Map<number, string>) => setState({ ...state, names: next });
  const dat = assets?.units ?? null;
  const weapons = assets?.weapons ?? null;
  const useDefault = settings.useDefault[sel] !== 0;
  const edit = (fn: () => void) => { fn(); bump((n) => n + 1); };

  const defaults = {
    hp: dat ? Math.floor(dat.hitPoints[sel] / 256) : 0,
    shields: dat && dat.shieldEnable[sel] ? dat.shieldAmount[sel] : 0,
    armor: dat ? dat.armor[sel] : 0,
    build: dat ? dat.buildTime[sel] : 0,
    minerals: dat ? dat.mineralCost[sel] : 0,
    gas: dat ? dat.vespeneCost[sel] : 0,
  };
  // A turreted vehicle's weapons are on the turret subunit (Siege Tank → Siege Tank Turret); show them here as StarEdit does.
  const turret = dat && dat.groundWeapon[sel] === NO_WEAPON && dat.airWeapon[sel] === NO_WEAPON && dat.subunit[sel] < NO_UNIT ? dat.subunit[sel] : -1;
  const armed = turret >= 0 ? turret : sel;
  const ground = dat ? dat.groundWeapon[armed] : NO_WEAPON;
  const air = dat ? dat.airWeapon[armed] : NO_WEAPON;
  const weaponRows = [{ label: "Ground", id: ground }, { label: "Air", id: air }].filter((w, i, all) => w.id < NO_WEAPON && all.findIndex((o) => o.id === w.id) === i);

  const setDefault = (on: boolean) => edit(() => {
    settings.useDefault[sel] = on ? 1 : 0;
    if (on || !dat) return;
    // A row that was never edited is all zeros: seed it from the dat so the file says what the game would have used.
    if (settings.hitPoints[sel] === 0 && settings.buildTime[sel] === 0 && settings.mineralCost[sel] === 0) {
      settings.hitPoints[sel] = dat.hitPoints[sel];
      settings.shields[sel] = dat.shieldEnable[sel] ? dat.shieldAmount[sel] : 0;
      settings.armor[sel] = dat.armor[sel];
      settings.buildTime[sel] = dat.buildTime[sel];
      settings.mineralCost[sel] = dat.mineralCost[sel];
      settings.gasCost[sel] = dat.vespeneCost[sel];
    }
    if (weapons) {
      for (const w of weaponRows) {
        if (settings.weaponDamage[w.id] === 0 && settings.weaponBonus[w.id] === 0) {
          settings.weaponDamage[w.id] = weapons.damage[w.id];
          settings.weaponBonus[w.id] = weapons.bonus[w.id];
        }
      }
    }
  });

  const shown = (key: "hitPoints" | "shields" | "armor" | "buildTime" | "mineralCost" | "gasCost", def: number) => {
    if (useDefault) return def;
    return key === "hitPoints" ? Math.floor(settings.hitPoints[sel] / 256) : settings[key][sel];
  };
  const number = (label: string, key: "hitPoints" | "shields" | "armor" | "buildTime" | "mineralCost" | "gasCost", def: number, max: number, unit?: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <NumberInput value={shown(key, def)} onChange={(v) => edit(() => { if (key === "hitPoints") settings.hitPoints[sel] = v * 256; else settings[key][sel] = v; })} min={0} max={max} unit={unit} disabled={useDefault} />
    </Field>
  );

  const availabilityOf = (player: number): Availability => {
    const i = puniIndex(player, sel);
    return availability.playerUsesDefault[i] ? "default" : availability.playerAvailable[i] ? "enabled" : "disabled";
  };
  const setAvailability = (player: number, v: Availability) => edit(() => {
    const i = puniIndex(player, sel);
    availability.playerUsesDefault[i] = v === "default" ? 1 : 0;
    if (v !== "default") availability.playerAvailable[i] = v === "enabled" ? 1 : 0;
  });

  const customName = names.get(sel) ?? unitCustomName(scenario, sel);
  const resetAll = () => setState({ settings: defaultUnitSettings(), availability: defaultUnitAvailability(), names: new Map(Array.from({ length: settings.nameIndex.length }, (_, id) => [id, ""])) });
  const apply = () => {
    applyUnitSettings(scenario, cloneUnitSettings(settings), cloneUnitAvailability(availability), names);
    setState({ ...state, names: new Map() });
    commit();
  };

  const item = UNIT_ITEMS.find((u) => u.id === sel);
  const race = UNIT_GROUPS.find((g) => g.label === item?.group)?.race;
  const sections = [...unitSettingsSections(scenario), "PUNI"].map((n) => n.trim()).join(" + ");

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Unit Settings"
      icon={<Swords size={14} />}
      size="xl"
      tall
      showApply
      onOk={apply}
      footerLeft={<div className="row"><Button size="sm" onClick={resetAll} title="Every type back to its dat defaults, every player back to the global availability"><RotateCcw size={11} /> Reset all to defaults</Button><span className="mono hint">writes {sections}</span></div>}
    >
      <div className="split" style={{ ["--split" as string]: "260px" }}>
        <UnitList selected={sel} onSelect={setSel} />
        <div className="col" style={{ gap: 12, overflow: "auto" }}>
          <div className="unit-header">
            <div className="unit-frame" title="Drawn in Player 1's colour">
              <SpritePreview kind="unit" id={sel} owner={0} colors={scenario.playerColors} size={64} />
            </div>
            <div className="col" style={{ gap: 2, flex: 1 }}>
              <span className="title">{customName || unitName(sel)}</span>
              <span className="hint">{unitName(sel)} · id {sel}{race ? ` · ${RACE_LABEL[race]}` : ""}{customName ? " · custom name" : ""}</span>
            </div>
            <Check label="Use default unit settings" checked={useDefault} onChange={(e) => setDefault(e.target.checked)} />
          </div>
          <div className="split" style={{ ["--split" as string]: "1fr", flex: "none" }}>
            <Group title="Vitals">
              <div className="form">
                {number("Hit points", "hitPoints", defaults.hp, 0xffffff, undefined, "Stored ×256; whole points are shown.")}
                {number("Shield points", "shields", defaults.shields, 0xffff)}
                {number("Armor", "armor", defaults.armor, 255)}
                {number("Build time", "buildTime", defaults.build, 0xffff, "frames", "15 frames per second on Fastest.")}
              </div>
            </Group>
            <Group title="Cost">
              <div className="form">
                {number("Minerals", "mineralCost", defaults.minerals, 0xffff)}
                {number("Vespene gas", "gasCost", defaults.gas, 0xffff)}
                <Field label="Custom name" hint="Empty for the game's own name. Applies whether or not the type uses default settings.">
                  <TextInput placeholder={unitName(sel)} value={customName} onChange={(e) => setNames(new Map(names).set(sel, e.target.value))} />
                </Field>
              </div>
            </Group>
          </div>
          <Group title="Weapons">
            {weaponRows.length === 0 ? (
              <p className="hint">{dat ? "This type has no weapon." : "Unit data is not installed, so the type's weapons are unknown."}</p>
            ) : (
              <table className="table dense">
                <thead><tr><th>Weapon</th><th style={{ width: 130 }}>Damage</th><th style={{ width: 130 }}>Upgrade bonus</th></tr></thead>
                <tbody>
                  {weaponRows.map((w) => (
                    <tr key={w.id}>
                      <td>{w.label}: {weaponName(w.id)} <span className="faint">#{w.id}{turret >= 0 ? ` · on ${unitName(turret)}` : ""}</span></td>
                      <td><NumberInput value={useDefault ? (weapons?.damage[w.id] ?? 0) : settings.weaponDamage[w.id]} onChange={(v) => edit(() => { settings.weaponDamage[w.id] = v; })} min={0} max={0xffff} disabled={useDefault} /></td>
                      <td><NumberInput value={useDefault ? (weapons?.bonus[w.id] ?? 0) : settings.weaponBonus[w.id]} onChange={(v) => edit(() => { settings.weaponBonus[w.id] = v; })} min={0} max={0xffff} disabled={useDefault} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {weaponRows.length > 0 && <p className="hint" style={{ marginTop: 6 }}>Damage is stored per weapon: every type that fires this weapon shares the row.{weapons ? "" : " weapons.dat is not installed, so defaults show as 0 — re-run npm run extract."}</p>}
          </Group>
          <Group title="Availability" flush>
            <div className="row" style={{ padding: "6px 8px 2px" }}>
              <Check label="Available by default" title="PUNI global default for this type — what every player on 'Default' gets" checked={availability.defaultAvailable[sel] !== 0} onChange={(e) => edit(() => { availability.defaultAvailable[sel] = e.target.checked ? 1 : 0; })} />
            </div>
            <div className="listbox" style={{ border: "none", boxShadow: "none", maxHeight: 190 }}>
              <table className="table dense">
                <tbody>
                  {Array.from({ length: PLAYER_SLOTS }, (_, i) => (
                    <tr key={i}>
                      <td style={{ width: 90 }}><span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: displayColorHex(scenario.playerColors, scenario.playerRgb, i), width: 10, height: 10 }} />Player {i + 1}</span></td>
                      <td><Select value={availabilityOf(i)} onChange={(e) => setAvailability(i, e.target.value as Availability)} options={AVAILABILITY_OPTS} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Group>
        </div>
      </div>
    </DialogFrame>
  );
}

/* ── Upgrade Settings ───────────────────────────────────── */

export function UpgradeSettingsDialog({ entry }: DialogProps) {
  const [sel, setSel] = useState(0);
  const [useDefault, setUseDefault] = useState(true);
  const [bm, setBm] = useState(100);
  const [fm, setFm] = useState(75);
  const [bg, setBg] = useState(100);
  const [fg, setFg] = useState(75);
  const [bt, setBt] = useState(266);
  const [ft, setFt] = useState(32);
  const d = useDefault;
  return (
    <DialogFrame dialogKey={entry.key} title="Upgrade Settings" icon={<TrendingUp size={14} />} size="xl" tall showApply footerLeft={<Check label="Use default settings for all upgrades" />}>
      <div className="split" style={{ ["--split" as string]: "260px" }}>
        <FilterList items={UPGRADES} selected={sel} onSelect={setSel} placeholder="Find upgrade…" />
        <div className="col" style={{ gap: 12, overflow: "auto" }}>
          <div className="row between">
            <strong style={{ fontSize: 14 }}>{UPGRADES[sel]}</strong>
            <Check label="Use default upgrade settings" checked={useDefault} onChange={(e) => setUseDefault(e.target.checked)} />
          </div>
          <Group title="Cost">
            <table className="table dense">
              <thead><tr><th></th><th style={{ width: 140 }}>Base</th><th style={{ width: 140 }}>Factor (per level)</th></tr></thead>
              <tbody>
                <tr><td>Minerals</td><td><NumberInput value={bm} onChange={setBm} min={0} max={65535} disabled={d} /></td><td><NumberInput value={fm} onChange={setFm} min={0} max={65535} disabled={d} /></td></tr>
                <tr><td>Vespene gas</td><td><NumberInput value={bg} onChange={setBg} min={0} max={65535} disabled={d} /></td><td><NumberInput value={fg} onChange={setFg} min={0} max={65535} disabled={d} /></td></tr>
                <tr><td>Research time</td><td><NumberInput value={bt} onChange={setBt} min={0} max={65535} disabled={d} /></td><td><NumberInput value={ft} onChange={setFt} min={0} max={65535} disabled={d} /></td></tr>
              </tbody>
            </table>
          </Group>
          <Group title="Levels per player" flush>
            <div className="listbox" style={{ border: "none", boxShadow: "none", maxHeight: 220 }}>
              <table className="table dense">
                <thead><tr><th>Player</th><th style={{ width: 90 }}>Default</th><th style={{ width: 120 }}>Start level</th><th style={{ width: 120 }}>Max level</th></tr></thead>
                <tbody>
                  {PLAYER_COLORS.slice(0, 12).map((c, i) => (
                    <tr key={i}>
                      <td><span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: c.hex, width: 10, height: 10 }} />Player {i + 1}</span></td>
                      <td><Check label="" defaultChecked /></td>
                      <td><NumberInput value={0} onChange={() => {}} min={0} max={3} disabled /></td>
                      <td><NumberInput value={3} onChange={() => {}} min={0} max={3} disabled /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Group>
        </div>
      </div>
    </DialogFrame>
  );
}

/* ── Technology Settings ────────────────────────────────── */

export function TechSettingsDialog({ entry }: DialogProps) {
  const [sel, setSel] = useState(0);
  const [useDefault, setUseDefault] = useState(true);
  const [m, setM] = useState(100);
  const [g, setG] = useState(100);
  const [t, setT] = useState(80);
  const [e, setE] = useState(10);
  const d = useDefault;
  return (
    <DialogFrame dialogKey={entry.key} title="Technology Settings" icon={<FlaskConical size={14} />} size="xl" tall showApply footerLeft={<Check label="Use default settings for all technologies" />}>
      <div className="split" style={{ ["--split" as string]: "260px" }}>
        <FilterList items={TECHS} selected={sel} onSelect={setSel} placeholder="Find technology…" />
        <div className="col" style={{ gap: 12, overflow: "auto" }}>
          <div className="row between">
            <strong style={{ fontSize: 14 }}>{TECHS[sel]}</strong>
            <Check label="Use default technology settings" checked={useDefault} onChange={(ev) => setUseDefault(ev.target.checked)} />
          </div>
          <Group title="Cost">
            <div className="form" style={{ gridTemplateColumns: "max-content 160px max-content 160px" }}>
              <Field label="Minerals"><NumberInput value={m} onChange={setM} min={0} max={65535} disabled={d} /></Field>
              <Field label="Vespene gas"><NumberInput value={g} onChange={setG} min={0} max={65535} disabled={d} /></Field>
              <Field label="Research time"><NumberInput value={t} onChange={setT} min={0} max={65535} disabled={d} /></Field>
              <Field label="Energy cost"><NumberInput value={e} onChange={setE} min={0} max={65535} disabled={d} /></Field>
            </div>
          </Group>
          <PlayerAvailability label="Availability per player" opts={["Default", "Available", "Researched", "Disabled"]} />
        </div>
      </div>
    </DialogFrame>
  );
}
