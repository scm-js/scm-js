import { useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { FlaskConical, RotateCcw, Search, Swords, TrendingUp } from "lucide-react";
import { commitSettingsAtom, scenarioAtom, settingsRevisionAtom } from "../../atoms/documentAtoms";
import { displayColorHex } from "../../data/players";
import {
  RACE_LABEL, TECH_NAMES, TECH_RACE, UNIT_GROUPS, unitName, UPGRADE_NAMES, UPGRADE_RACE, type RaceKey,
} from "../../data/units";
import { weaponName } from "../../data/weapons";
import { NO_UNIT, NO_WEAPON } from "../../formats/dat/dat";
import {
  isExpansion, techRestrictionSections, techSettingsSections, unitSettingsSections, upgradeRestrictionSections, upgradeSettingsSections, type Scenario,
} from "../../formats/chk/scenario";
import {
  cloneTechRestrictions, cloneTechSettings, cloneUnitAvailability, cloneUnitSettings, cloneUpgradeRestrictions, cloneUpgradeSettings,
  defaultTechRestrictions, defaultTechSettings, defaultUnitAvailability, defaultUnitSettings, defaultUpgradeRestrictions, defaultUpgradeSettings,
  PLAYER_SLOTS, puniIndex, techIndex, techState, TECHS_ORIGINAL, upgradeIndex, upgradeLevels, UPGRADES_ORIGINAL,
} from "../../formats/chk/sections/settings";
import {
  applyTechSettings, applyUnitSettings, applyUpgradeSettings, readTechSettings, readUnitSettings, readUpgradeSettings, unitCustomName,
} from "../../editor/settings";
import { useScenarioForm } from "../../hooks/useScenarioForm";
import { useUnitAssets } from "../../hooks/useUnitAssets";
import { SpritePreview } from "../panels/UnitPreview";
import { Button, Check, Field, Group, ListBox, NumberInput, Select, TextInput } from "../ui";
import { ColorTextField, InlineString } from "../ui/ColorCodes";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/* ── Shared pieces for the data dialogs ─────────────────── */

interface CatalogueItem { id: number; name: string; race: RaceKey | null }
type CatalogueRow = { kind: "head"; label: string } | { kind: "item"; item: CatalogueItem };

/** Terran, Zerg, Protoss, then the ids nothing in the game refers to. */
const RACE_ORDER: readonly (RaceKey | null)[] = ["terran", "zerg", "protoss", null];

function catalogueRows(items: readonly CatalogueItem[], needle: string): CatalogueRow[] {
  const q = needle.trim().toLowerCase();
  const rows: CatalogueRow[] = [];
  for (const race of RACE_ORDER) {
    const group = items.filter((it) => it.race === race && (!q || it.name.toLowerCase().includes(q) || String(it.id) === q));
    if (group.length === 0) continue;
    rows.push({ kind: "head", label: race ? RACE_LABEL[race] : "Unused" });
    for (const item of group) rows.push({ kind: "item", item });
  }
  return rows;
}

/** An id list grouped by race with a search box — the upgrade and technology catalogues. */
function CatalogueList({ items, selected, onSelect, placeholder }: { items: readonly CatalogueItem[]; selected: number; onSelect: (id: number) => void; placeholder: string }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => catalogueRows(items, q), [items, q]);
  return (
    <div className="col" style={{ minHeight: 0, height: "100%" }}>
      <div className="row">
        <Search size={12} className="faint" />
        <TextInput placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ListBox
        className="grow"
        items={rows}
        selected={rows.findIndex((r) => r.kind === "item" && r.item.id === selected)}
        onSelect={(_, r) => { if (r.kind === "item") onSelect(r.item.id); }}
        render={(r) => r.kind === "head"
          ? <span className="faint" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em" }}>{r.label}</span>
          : <><span className="idx">{r.item.id}</span>{r.item.name}{r.item.race === null && <span className="badge" style={{ marginLeft: "auto" }}>unused</span>}</>}
        style={{ flex: 1 }}
        empty="No match."
      />
    </div>
  );
}

function PlayerCell({ scenario, player }: { scenario: Scenario; player: number }) {
  return (
    <td style={{ width: 90 }}>
      <span className="row" style={{ gap: 6 }}>
        <span className="swatch" style={{ background: displayColorHex(scenario.playerColors, scenario.playerRgb, player), width: 10, height: 10 }} />
        Player {player + 1}
      </span>
    </td>
  );
}

function raceOf(race: RaceKey | null): string {
  return race ? RACE_LABEL[race] : "unused id";
}

const FRAMES_HINT = "Game frames: 15 per second on Fastest.";

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
              <SpritePreview kind="unit" id={sel} owner={0} colors={scenario.playerColors} rgb={scenario.playerRgb} size={64} />
            </div>
            <div className="col" style={{ gap: 2, flex: 1 }}>
              {/* A custom name is an ordinary string, so it may carry colour codes. */}
              <span className="title"><InlineString text={customName || unitName(sel)} /></span>
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
                  <ColorTextField placeholder={unitName(sel)} value={customName} onChange={(v) => setNames(new Map(names).set(sel, v))} />
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
            {weaponRows.length > 0 && <p className="hint" style={{ marginTop: 6 }}>Damage is stored per weapon: every type that fires this weapon shares the row.{weapons ? "" : " weapons.dat is not installed, so defaults show as 0 — install the game data again (Help ▸ Game Data…)."}</p>}
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

const UPGRADE_ITEMS: CatalogueItem[] = UPGRADE_NAMES.map((name, id) => ({ id, name, race: UPGRADE_RACE[id] }));
const UPGRADE_COST_ROWS = [
  { label: "Minerals", base: "mineralCost", factor: "mineralFactor", datBase: "mineralCost", datFactor: "mineralFactor" },
  { label: "Vespene gas", base: "gasCost", factor: "gasFactor", datBase: "vespeneCost", datFactor: "vespeneFactor" },
  { label: "Research time", base: "timeCost", factor: "timeFactor", datBase: "timeCost", datFactor: "timeFactor" },
] as const;

/** A start / max pair kept ordered: raising start lifts max, lowering max drops start. */
function clampLevels(start: number, max: number, key: "start" | "max", v: number): { start: number; max: number } {
  return key === "start" ? { start: v, max: Math.max(max, v) } : { start: Math.min(start, v), max: v };
}

/**
 * UPGS / UPGx and UPGR / PUPx, edited on working copies and installed as one transaction.
 * An upgrade on "use default" shows its upgrades.dat costs greyed; unticking it seeds the row
 * from them. Levels are per player over a default pair, like Unit Settings' availability.
 */
export function UpgradeSettingsDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(settingsRevisionAtom);
  const commit = useSetAtom(commitSettingsAtom);
  const { loaded: assets } = useUnitAssets();
  const [sel, setSel] = useState(0);
  const [state, setState] = useScenarioForm(scenario, readUpgradeSettings);
  const [, bump] = useState(0); // the copies are typed arrays edited in place

  if (!scenario || !state) {
    return <DialogFrame dialogKey={entry.key} title="Upgrade Settings" icon={<TrendingUp size={14} />} size="sm"><p className="hint">Open or create a map first.</p></DialogFrame>;
  }

  const { settings, restrictions } = state;
  const dat = assets?.upgrades ?? null;
  const useDefault = settings.useDefault[sel] !== 0;
  const edit = (fn: () => void) => { fn(); bump((n) => n + 1); };
  const beyondOriginal = !isExpansion(scenario) && sel >= UPGRADES_ORIGINAL;

  const setDefault = (on: boolean) => edit(() => {
    settings.useDefault[sel] = on ? 1 : 0;
    if (on || !dat) return;
    // A row nobody edited is all zeros: seed it from the dat so the file says what the game would have used.
    if (UPGRADE_COST_ROWS.every((r) => settings[r.base][sel] === 0 && settings[r.factor][sel] === 0)) {
      for (const r of UPGRADE_COST_ROWS) {
        settings[r.base][sel] = dat[r.datBase][sel];
        settings[r.factor][sel] = dat[r.datFactor][sel];
      }
    }
  });

  const setLevel = (player: number | "default", key: "start" | "max", v: number) => edit(() => {
    if (player === "default") {
      const next = clampLevels(restrictions.defaultStart[sel], restrictions.defaultMax[sel], key, v);
      restrictions.defaultStart[sel] = next.start;
      restrictions.defaultMax[sel] = next.max;
    } else {
      const i = upgradeIndex(player, sel);
      const next = clampLevels(restrictions.playerStart[i], restrictions.playerMax[i], key, v);
      restrictions.playerStart[i] = next.start;
      restrictions.playerMax[i] = next.max;
    }
  });
  const setUsesDefault = (player: number, on: boolean) => edit(() => {
    const i = upgradeIndex(player, sel);
    restrictions.playerUsesDefault[i] = on ? 1 : 0;
    // Coming off the default, start from what the default said rather than a stale row.
    if (!on) { restrictions.playerStart[i] = restrictions.defaultStart[sel]; restrictions.playerMax[i] = restrictions.defaultMax[sel]; }
  });

  const resetAll = () => setState({ settings: defaultUpgradeSettings(), restrictions: defaultUpgradeRestrictions() });
  const apply = () => {
    applyUpgradeSettings(scenario, cloneUpgradeSettings(settings), cloneUpgradeRestrictions(restrictions));
    commit();
  };

  const sections = [...upgradeSettingsSections(scenario), ...upgradeRestrictionSections(scenario)].map((n) => n.trim()).join(" + ");
  const levelInput = (value: number, onChange: (v: number) => void, disabled: boolean) => (
    <NumberInput value={value} onChange={onChange} min={0} max={255} disabled={disabled} />
  );

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Upgrade Settings"
      icon={<TrendingUp size={14} />}
      size="xl"
      tall
      showApply
      onOk={apply}
      footerLeft={<div className="row"><Button size="sm" onClick={resetAll} title="Every upgrade back to its dat costs, every player back to the default levels"><RotateCcw size={11} /> Reset all to defaults</Button><span className="mono hint">writes {sections}</span></div>}
    >
      <div className="split" style={{ ["--split" as string]: "260px" }}>
        <CatalogueList items={UPGRADE_ITEMS} selected={sel} onSelect={setSel} placeholder="Find upgrade… (name or id)" />
        <div className="col" style={{ gap: 12, overflow: "auto" }}>
          <div className="unit-header">
            <div className="col" style={{ gap: 2, flex: 1 }}>
              <span className="title">{UPGRADE_NAMES[sel]}</span>
              <span className="hint">id {sel} · {raceOf(UPGRADE_RACE[sel])}{dat && dat.broodWar[sel] ? " · Brood War" : ""}{dat ? ` · ${dat.maxRepeats[sel]} level${dat.maxRepeats[sel] === 1 ? "" : "s"} in the game` : ""}</span>
            </div>
            <Check label="Use default upgrade settings" checked={useDefault} onChange={(e) => setDefault(e.target.checked)} />
          </div>
          {beyondOriginal && <p className="hint">Only Brood War maps (UPGx / PUPx) store upgrades past #{UPGRADES_ORIGINAL - 1}; on this map's revision the game reads the original layout and ignores this one.</p>}
          <Group title="Cost">
            <table className="table dense">
              <thead><tr><th></th><th style={{ width: 150 }}>Base</th><th style={{ width: 150 }}>Factor (per level)</th></tr></thead>
              <tbody>
                {UPGRADE_COST_ROWS.map((r) => (
                  <tr key={r.base}>
                    <td>{r.label}{r.base === "timeCost" && <span className="faint"> (frames)</span>}</td>
                    <td><NumberInput value={useDefault ? (dat?.[r.datBase][sel] ?? 0) : settings[r.base][sel]} onChange={(v) => edit(() => { settings[r.base][sel] = v; })} min={0} max={0xffff} disabled={useDefault} /></td>
                    <td><NumberInput value={useDefault ? (dat?.[r.datFactor][sel] ?? 0) : settings[r.factor][sel]} onChange={(v) => edit(() => { settings[r.factor][sel] = v; })} min={0} max={0xffff} disabled={useDefault} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint" style={{ marginTop: 6 }}>Each level costs the base plus the factor for every level already researched. {FRAMES_HINT}{dat ? "" : " upgrades.dat is not installed, so defaults show as 0 — install the game data again (Help ▸ Game Data…)."}</p>
          </Group>
          <Group title="Levels per player" flush>
            <div className="listbox" style={{ border: "none", boxShadow: "none", maxHeight: 300 }}>
              <table className="table dense">
                <thead><tr><th>Player</th><th style={{ width: 80 }}>Default</th><th style={{ width: 120 }}>Start level</th><th style={{ width: 120 }}>Max level</th></tr></thead>
                <tbody>
                  <tr>
                    <td><strong>Default</strong> <span className="faint">for every player on Default</span></td>
                    <td className="faint">—</td>
                    <td>{levelInput(restrictions.defaultStart[sel], (v) => setLevel("default", "start", v), false)}</td>
                    <td>{levelInput(restrictions.defaultMax[sel], (v) => setLevel("default", "max", v), false)}</td>
                  </tr>
                  {Array.from({ length: PLAYER_SLOTS }, (_, p) => {
                    const i = upgradeIndex(p, sel);
                    const onDefault = restrictions.playerUsesDefault[i] !== 0;
                    const shown = upgradeLevels(restrictions, p, sel);
                    return (
                      <tr key={p}>
                        <PlayerCell scenario={scenario} player={p} />
                        <td><Check label="" checked={onDefault} onChange={(e) => setUsesDefault(p, e.target.checked)} /></td>
                        <td>{levelInput(shown.start, (v) => setLevel(p, "start", v), onDefault)}</td>
                        <td>{levelInput(shown.max, (v) => setLevel(p, "max", v), onDefault)}</td>
                      </tr>
                    );
                  })}
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

const TECH_ITEMS: CatalogueItem[] = TECH_NAMES.map((name, id) => ({ id, name, race: TECH_RACE[id] }));
const TECH_COST_ROWS = [
  { label: "Minerals", key: "mineralCost", dat: "mineralCost" },
  { label: "Vespene gas", key: "gasCost", dat: "vespeneCost" },
  { label: "Research time", key: "researchTime", dat: "researchTime", unit: "frames" },
  { label: "Energy cost", key: "energyCost", dat: "energyCost" },
] as const;

type TechAvailability = "default" | "available" | "researched" | "disabled";
const TECH_AVAILABILITY_OPTS: { value: TechAvailability; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "available", label: "Available" },
  { value: "researched", label: "Researched" },
  { value: "disabled", label: "Disabled" },
];

/** TECS / TECx and PTEC / PTEx, the same transaction shape as Upgrade Settings. */
export function TechSettingsDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(settingsRevisionAtom);
  const commit = useSetAtom(commitSettingsAtom);
  const { loaded: assets } = useUnitAssets();
  const [sel, setSel] = useState(0);
  const [state, setState] = useScenarioForm(scenario, readTechSettings);
  const [, bump] = useState(0);

  if (!scenario || !state) {
    return <DialogFrame dialogKey={entry.key} title="Technology Settings" icon={<FlaskConical size={14} />} size="sm"><p className="hint">Open or create a map first.</p></DialogFrame>;
  }

  const { settings, restrictions } = state;
  const dat = assets?.techs ?? null;
  const useDefault = settings.useDefault[sel] !== 0;
  const edit = (fn: () => void) => { fn(); bump((n) => n + 1); };
  const beyondOriginal = !isExpansion(scenario) && sel >= TECHS_ORIGINAL;

  const setDefault = (on: boolean) => edit(() => {
    settings.useDefault[sel] = on ? 1 : 0;
    if (on || !dat) return;
    if (TECH_COST_ROWS.every((r) => settings[r.key][sel] === 0)) {
      for (const r of TECH_COST_ROWS) settings[r.key][sel] = dat[r.dat][sel];
    }
  });

  const availabilityOf = (player: number): TechAvailability => {
    const i = techIndex(player, sel);
    if (restrictions.playerUsesDefault[i]) return "default";
    const { available, researched } = techState(restrictions, player, sel);
    return researched ? "researched" : available ? "available" : "disabled";
  };
  const setAvailability = (player: number, v: TechAvailability) => edit(() => {
    const i = techIndex(player, sel);
    restrictions.playerUsesDefault[i] = v === "default" ? 1 : 0;
    if (v === "default") return;
    restrictions.playerAvailable[i] = v === "disabled" ? 0 : 1;
    restrictions.playerResearched[i] = v === "researched" ? 1 : 0;
  });

  const resetAll = () => setState({ settings: defaultTechSettings(), restrictions: defaultTechRestrictions() });
  const apply = () => {
    applyTechSettings(scenario, cloneTechSettings(settings), cloneTechRestrictions(restrictions));
    commit();
  };

  const sections = [...techSettingsSections(scenario), ...techRestrictionSections(scenario)].map((n) => n.trim()).join(" + ");

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Technology Settings"
      icon={<FlaskConical size={14} />}
      size="xl"
      tall
      showApply
      onOk={apply}
      footerLeft={<div className="row"><Button size="sm" onClick={resetAll} title="Every ability back to its dat costs, every player back to the default availability"><RotateCcw size={11} /> Reset all to defaults</Button><span className="mono hint">writes {sections}</span></div>}
    >
      <div className="split" style={{ ["--split" as string]: "260px" }}>
        <CatalogueList items={TECH_ITEMS} selected={sel} onSelect={setSel} placeholder="Find technology… (name or id)" />
        <div className="col" style={{ gap: 12, overflow: "auto" }}>
          <div className="unit-header">
            <div className="col" style={{ gap: 2, flex: 1 }}>
              <span className="title">{TECH_NAMES[sel]}</span>
              <span className="hint">id {sel} · {raceOf(TECH_RACE[sel])}{dat && dat.broodWar[sel] ? " · Brood War" : ""}</span>
            </div>
            <Check label="Use default technology settings" checked={useDefault} onChange={(e) => setDefault(e.target.checked)} />
          </div>
          {beyondOriginal && <p className="hint">Only Brood War maps (TECx / PTEx) store abilities past #{TECHS_ORIGINAL - 1}; on this map's revision the game reads the original layout and ignores this one.</p>}
          <Group title="Cost">
            <div className="form" style={{ gridTemplateColumns: "max-content 160px max-content 160px" }}>
              {TECH_COST_ROWS.map((r) => (
                <Field key={r.key} label={r.label}>
                  <NumberInput value={useDefault ? (dat?.[r.dat][sel] ?? 0) : settings[r.key][sel]} onChange={(v) => edit(() => { settings[r.key][sel] = v; })} min={0} max={0xffff} disabled={useDefault} unit={"unit" in r ? r.unit : undefined} />
                </Field>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 6 }}>Energy is what a cast costs once researched. {FRAMES_HINT}{dat ? "" : " techdata.dat is not installed, so defaults show as 0 — install the game data again (Help ▸ Game Data…)."}</p>
          </Group>
          <Group title="Availability" flush>
            <div className="row" style={{ padding: "6px 8px 2px", gap: 14 }}>
              <Check label="Available by default" title="PTEC / PTEx global default — what every player on 'Default' may research" checked={restrictions.defaultAvailable[sel] !== 0} onChange={(e) => edit(() => { restrictions.defaultAvailable[sel] = e.target.checked ? 1 : 0; })} />
              <Check label="Researched by default" title="Every player on 'Default' starts the game with it" checked={restrictions.defaultResearched[sel] !== 0} onChange={(e) => edit(() => { restrictions.defaultResearched[sel] = e.target.checked ? 1 : 0; })} />
            </div>
            <div className="listbox" style={{ border: "none", boxShadow: "none", maxHeight: 300 }}>
              <table className="table dense">
                <tbody>
                  {Array.from({ length: PLAYER_SLOTS }, (_, p) => (
                    <tr key={p}>
                      <PlayerCell scenario={scenario} player={p} />
                      <td><Select value={availabilityOf(p)} onChange={(e) => setAvailability(p, e.target.value as TechAvailability)} options={TECH_AVAILABILITY_OPTS} /></td>
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
