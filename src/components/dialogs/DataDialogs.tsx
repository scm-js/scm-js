import { useMemo, useState } from "react";
import { FlaskConical, Search, Swords, TrendingUp } from "lucide-react";
import { PLAYER_COLORS } from "../../data/players";
import { TECHS, UNIT_GROUPS, unitName, UPGRADES } from "../../data/units";
import { Check, Field, Group, ListBox, NumberInput, Select, TextInput } from "../ui";
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

const ALL_UNITS = UNIT_GROUPS.flatMap((g) => g.units.map(unitName));

export function UnitSettingsDialog({ entry }: DialogProps) {
  const [sel, setSel] = useState(0);
  const [useDefault, setUseDefault] = useState(true);
  const [hp, setHp] = useState(40);
  const [shields, setShields] = useState(0);
  const [armor, setArmor] = useState(0);
  const [build, setBuild] = useState(24);
  const [min, setMin] = useState(50);
  const [gas, setGas] = useState(0);
  const [dmg, setDmg] = useState(6);
  const [bonus, setBonus] = useState(1);
  const d = useDefault;

  return (
    <DialogFrame dialogKey={entry.key} title="Unit Settings" icon={<Swords size={14} />} size="xl" tall showApply footerLeft={<Check label="Use default settings for all units" />}>
      <div className="split" style={{ ["--split" as string]: "260px" }}>
        <FilterList items={ALL_UNITS} selected={sel} onSelect={setSel} placeholder="Find unit…" />
        <div className="col" style={{ gap: 12, overflow: "auto" }}>
          <div className="row between">
            <strong style={{ fontSize: 14 }}>{ALL_UNITS[sel]}</strong>
            <Check label="Use default unit settings" checked={useDefault} onChange={(e) => setUseDefault(e.target.checked)} />
          </div>
          <div className="split" style={{ ["--split" as string]: "1fr", flex: "none" }}>
            <Group title="Vitals">
              <div className="form">
                <Field label="Hit points"><NumberInput value={hp} onChange={setHp} min={1} max={99999} disabled={d} /></Field>
                <Field label="Shield points"><NumberInput value={shields} onChange={setShields} min={0} max={65535} disabled={d} /></Field>
                <Field label="Armor"><NumberInput value={armor} onChange={setArmor} min={0} max={255} disabled={d} /></Field>
                <Field label="Build time"><NumberInput value={build} onChange={setBuild} min={0} max={65535} unit="frames" disabled={d} /></Field>
              </div>
            </Group>
            <Group title="Cost">
              <div className="form">
                <Field label="Minerals"><NumberInput value={min} onChange={setMin} min={0} max={65535} disabled={d} /></Field>
                <Field label="Vespene gas"><NumberInput value={gas} onChange={setGas} min={0} max={65535} disabled={d} /></Field>
                <Field label="Custom name"><TextInput placeholder={ALL_UNITS[sel]} disabled={d} /></Field>
              </div>
            </Group>
          </div>
          <Group title="Weapons">
            <table className="table dense">
              <thead><tr><th>Weapon</th><th style={{ width: 120 }}>Damage</th><th style={{ width: 120 }}>Upgrade bonus</th></tr></thead>
              <tbody>
                <tr><td>Ground: Gauss Rifle</td><td><NumberInput value={dmg} onChange={setDmg} min={0} max={65535} disabled={d} /></td><td><NumberInput value={bonus} onChange={setBonus} min={0} max={65535} disabled={d} /></td></tr>
                <tr><td className="faint">Air: (same weapon)</td><td className="faint">—</td><td className="faint">—</td></tr>
              </tbody>
            </table>
          </Group>
          <PlayerAvailability label="Availability per player" />
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
