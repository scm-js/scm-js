import { Fragment, useMemo, useState } from "react";
import { useStore } from "jotai";
import { Sparkles, SquareDashed, User } from "lucide-react";
import { scenarioAtom } from "../../atoms/documentAtoms";
import { PLAYER_COLORS, playerColorIndex } from "../../data/players";
import { SAMPLE_LOCATIONS, type SampleLocation } from "../../data/samples";
import { SPRITES, UNIT_GROUPS, unitName } from "../../data/units";
import { UnitRelation, UnitState, UnitUsed, UnitValid, type UnitRecord } from "../../formats/chk/sections/objects";
import { useUnitTools } from "../../hooks/useUnitTools";
import { Check, Field, Group, NumberInput, Select, TextInput } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

const PLAYER_OPTS = PLAYER_COLORS.slice(0, 12).map((c, i) => ({ value: String(i), label: `Player ${i + 1} (${c.name})` }));

/* ── Unit Properties ────────────────────────────────────── */

const PERCENT_HINT = "The game reads a percentage; the file stores a byte, so up to 255 is representable.";

/** The UNIT record's flag fields, each with its bits and labels. */
const STATE_ROWS: { bit: number; valid: number; label: string }[] = [
  { bit: UnitState.Cloaked, valid: UnitValid.Cloak, label: "Cloaked" },
  { bit: UnitState.Burrowed, valid: UnitValid.Burrow, label: "Burrowed" },
  { bit: UnitState.InTransit, valid: UnitValid.InTransit, label: "In transit (lifted off)" },
  { bit: UnitState.Hallucinated, valid: UnitValid.Hallucinated, label: "Hallucinated" },
  { bit: UnitState.Invincible, valid: UnitValid.Invincible, label: "Invincible" },
];

const hex = (v: number, digits: number) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(digits, "0")}`;

/**
 * Every field the UNIT section stores, on the selected units. Only fields the user
 * touches are written, so a multi-selection can share an owner without sharing a
 * position; position and serial are single-unit only.
 */
export function UnitPropertiesDialog({ entry }: DialogProps) {
  const store = useStore();
  const tools = useUnitTools();
  const scenario = store.get(scenarioAtom);
  const indices = useMemo(() => {
    const raw = entry.payload?.indices;
    return Array.isArray(raw) ? raw.filter((i): i is number => typeof i === "number" && !!scenario?.units[i]) : [];
  }, [entry.payload, scenario]);
  const original = scenario?.units[indices[0] ?? -1] ?? null;
  const [form, setForm] = useState<UnitRecord | null>(original);
  const [touched, setTouched] = useState<Set<keyof UnitRecord>>(() => new Set());
  const single = indices.length === 1;

  if (!form || !original) {
    return (
      <DialogFrame dialogKey={entry.key} title="Unit Properties" icon={<User size={14} />} size="sm">
        <p className="hint">Select a unit on the map first.</p>
      </DialogFrame>
    );
  }

  const set = <K extends keyof UnitRecord>(key: K, value: UnitRecord[K]) => {
    setForm({ ...form, [key]: value });
    setTouched(new Set(touched).add(key));
  };
  const setBit = (key: "validProperties" | "validStates" | "stateFlags" | "relationType", bit: number, on: boolean) =>
    set(key, on ? form[key] | bit : form[key] & ~bit);
  const has = (key: "validProperties" | "validStates" | "stateFlags" | "relationType", bit: number) => (form[key] & bit) !== 0;

  const apply = () => {
    const patch: Partial<UnitRecord> = {};
    for (const key of touched) {
      if (!single && (key === "x" || key === "y")) continue;
      (patch as Record<string, unknown>)[key] = form[key];
    }
    if (Object.keys(patch).length === 0) return;
    tools.updateSelected(`Edit ${single ? unitName(original.unitId) : `${indices.length} units`}`, () => patch, indices);
  };

  /** A vital with its "used" bit: the game only reads the number when the bit is set. */
  const vital = (label: string, key: "hitPointsPercent" | "shieldPercent" | "energyPercent" | "resourceAmount" | "hangarUnits", used: number, max: number, unit?: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <div className="row">
        <NumberInput value={form[key]} onChange={(v) => set(key, v)} min={0} max={max} unit={unit} width={130} />
        <Check label="used" title="Set the matching bit in the 'properties used' mask; unset, the game ignores the value" checked={has("validStates", used)} onChange={(e) => setBit("validStates", used, e.target.checked)} />
      </div>
    </Field>
  );

  const owners = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: `Player ${i + 1} (${PLAYER_COLORS[playerColorIndex(scenario?.playerColors, i)].name})` }));
  if (form.owner > 11) owners.push({ value: String(form.owner), label: `Owner ${form.owner} (raw)` });

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={single ? "Unit Properties" : `Unit Properties — ${indices.length} units`}
      icon={<User size={14} />}
      size="md"
      showApply
      onOk={apply}
      footerLeft={<span className="mono">ID {hex(form.unitId, 4)} · serial #{single ? form.serial : "—"}{touched.size > 0 ? ` · ${touched.size} changed` : ""}</span>}
    >
      <div className="form wide">
        <Field label="Unit">
          <select className="select" value={form.unitId} onChange={(e) => set("unitId", Number(e.target.value))}>
            {UNIT_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.units.map((id) => <option key={id} value={id}>{unitName(id)}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Owner">
          <div className="row">
            <Select value={String(form.owner)} onChange={(e) => set("owner", Number(e.target.value))} options={owners} />
            <Check label="owner used" title="Legacy 'owner is valid' bit; StarEdit leaves it clear" checked={has("validStates", UnitUsed.Owner)} onChange={(e) => setBit("validStates", UnitUsed.Owner, e.target.checked)} />
          </div>
        </Field>
        <Field label="Position" hint={single ? "Map pixels; buildings are normally tile-aligned by their placement box." : "Position is edited one unit at a time."}>
          <div className="row">
            <NumberInput value={form.x} onChange={(v) => set("x", v)} min={0} max={0xffff} width={110} unit="x" disabled={!single} />
            <NumberInput value={form.y} onChange={(v) => set("y", v)} min={0} max={0xffff} width={110} unit="y" disabled={!single} />
          </div>
        </Field>
      </div>
      <div className="split" style={{ ["--split" as string]: "1fr" }}>
        <Group title="Vitals">
          <div className="form">
            {vital("Hit points", "hitPointsPercent", UnitUsed.HitPoints, 255, "%", PERCENT_HINT)}
            {vital("Shields", "shieldPercent", UnitUsed.Shields, 255, "%")}
            {vital("Energy", "energyPercent", UnitUsed.Energy, 255, "%")}
            {vital("Resources", "resourceAmount", UnitUsed.Resources, 0xffffffff, undefined, "Minerals or gas in a resource field.")}
            {vital("Hangar", "hangarUnits", UnitUsed.Hangar, 0xffff, undefined, "Interceptors or scarabs on board.")}
          </div>
        </Group>
        <Group title="Special properties">
          <div className="form" style={{ gridTemplateColumns: "1fr max-content max-content", gap: "2px 12px", alignItems: "center" }}>
            <span className="hint">Property</span>
            <span className="hint" title="The unit starts in this state">State</span>
            <span className="hint" title="The 'valid' mask: whether the game reads this property at all">Valid</span>
            {STATE_ROWS.map((r) => (
              <Fragment key={r.label}>
                <span>{r.label}</span>
                <input type="checkbox" checked={has("stateFlags", r.bit)} onChange={(e) => setBit("stateFlags", r.bit, e.target.checked)} aria-label={`${r.label} state`} />
                <input type="checkbox" checked={has("validProperties", r.valid)} onChange={(e) => setBit("validProperties", r.valid, e.target.checked)} aria-label={`${r.label} valid`} />
              </Fragment>
            ))}
          </div>
          <div style={{ marginTop: 6 }}>
            <Check label="State flags used" title="Bit 6 of the 'properties used' mask: the state column above applies" checked={has("validStates", UnitUsed.State)} onChange={(e) => setBit("validStates", UnitUsed.State, e.target.checked)} />
          </div>
          <div className="sep-h" style={{ margin: "8px 0" }} />
          <div className="form">
            <Field label="Related unit" hint="Serial of the add-on's parent or the other end of a Nydus Canal; 0 for none.">
              <NumberInput value={form.relatedSerial} onChange={(v) => set("relatedSerial", v)} min={0} max={0xffffffff} width={130} />
            </Field>
            <Field label="Relation">
              <div className="col" style={{ gap: 2 }}>
                <Check label="Nydus link" checked={has("relationType", UnitRelation.NydusLink)} onChange={(e) => setBit("relationType", UnitRelation.NydusLink, e.target.checked)} />
                <Check label="Add-on" checked={has("relationType", UnitRelation.Addon)} onChange={(e) => setBit("relationType", UnitRelation.Addon, e.target.checked)} />
              </div>
            </Field>
          </div>
        </Group>
      </div>
      <Group title="Raw record">
        <div className="form" style={{ gridTemplateColumns: "max-content 1fr max-content 1fr" }}>
          <Field label="Unused (0x1C)" hint="Four bytes the game ignores; some editors stash data here.">
            <TextInput className="mono" value={hex(form.unused, 8)} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) set("unused", Math.min(0xffffffff, Math.max(0, Math.trunc(v)))); }} />
          </Field>
          <Field label="Masks">
            <span className="mono hint">valid {hex(form.validProperties, 4)} · used {hex(form.validStates, 4)} · state {hex(form.stateFlags, 4)} · relation {hex(form.relationType, 4)}</span>
          </Field>
        </div>
      </Group>
    </DialogFrame>
  );
}

/* ── Location Properties ────────────────────────────────── */

export function LocationPropertiesDialog({ entry }: DialogProps) {
  const loc = (entry.payload?.location as SampleLocation | undefined) ?? SAMPLE_LOCATIONS[1];
  const [name, setName] = useState(loc.name);
  const [l, setL] = useState(loc.x * 32);
  const [t, setT] = useState(loc.y * 32);
  const [r, setR] = useState((loc.x + loc.w) * 32);
  const [b, setB] = useState((loc.y + loc.h) * 32);
  return (
    <DialogFrame dialogKey={entry.key} title="Location Properties" icon={<SquareDashed size={14} />} size="sm" showApply footerLeft={<span className="mono">Location #{loc.id}</span>}>
      <div className="form wide">
        <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </div>
      <Group title="Bounds (pixels)">
        <div className="form" style={{ gridTemplateColumns: "max-content 1fr max-content 1fr" }}>
          <Field label="Left"><NumberInput value={l} onChange={setL} min={0} step={32} /></Field>
          <Field label="Top"><NumberInput value={t} onChange={setT} min={0} step={32} /></Field>
          <Field label="Right"><NumberInput value={r} onChange={setR} min={0} step={32} /></Field>
          <Field label="Bottom"><NumberInput value={b} onChange={setB} min={0} step={32} /></Field>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>{Math.abs(r - l) / 32} × {Math.abs(b - t) / 32} tiles · {Math.abs(r - l)} × {Math.abs(b - t)} px</p>
      </Group>
      <Group title="Elevation flags">
        <div className="form" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Check label="Low ground" defaultChecked />
          <Check label="Low air" defaultChecked />
          <Check label="Medium ground" defaultChecked />
          <Check label="Medium air" defaultChecked />
          <Check label="High ground" defaultChecked />
          <Check label="High air" defaultChecked />
        </div>
      </Group>
    </DialogFrame>
  );
}

/* ── Sprite Properties ──────────────────────────────────── */

export function SpritePropertiesDialog({ entry }: DialogProps) {
  const [pure, setPure] = useState(true);
  return (
    <DialogFrame dialogKey={entry.key} title="Sprite Properties" icon={<Sparkles size={14} />} size="sm" showApply>
      <div className="form wide">
        <Field label="Sprite"><Select options={SPRITES} defaultValue="Cursor Marker" /></Field>
        <Field label="Owner"><Select options={PLAYER_OPTS} defaultValue="11" /></Field>
        <Field label="Position">
          <div className="row">
            <NumberInput value={1024} onChange={() => {}} min={0} width={110} unit="x" />
            <NumberInput value={1024} onChange={() => {}} min={0} width={110} unit="y" />
          </div>
        </Field>
      </div>
      <Group title="Flags">
        <div className="col" style={{ gap: 2 }}>
          <Check label="Pure sprite (THG2, not a unit sprite)" checked={pure} onChange={(e) => setPure(e.target.checked)} />
          <Check label="Disabled (unit sprite starts inactive)" disabled={pure} />
          <Check label="Draw as sprite (ignore unit logic)" disabled={pure} />
        </div>
      </Group>
    </DialogFrame>
  );
}
