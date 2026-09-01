import { Fragment, useMemo, useState } from "react";
import { useStore } from "jotai";
import { Sparkles, SquareDashed, User } from "lucide-react";
import { scenarioAtom } from "../../atoms/documentAtoms";
import { PLAYER_COLORS, playerColorIndex } from "../../data/players";
import { UNIT_GROUPS, unitName } from "../../data/units";
import { SPRITE_COUNT, spriteCatalogue } from "../../data/sprites";
import { ANYWHERE_INDEX, ELEVATION_MASK, ELEVATIONS, isLocationUsed, SpriteFlag, UnitRelation, UnitState, UnitUsed, UnitValid, type SpriteRecord, type UnitRecord } from "../../formats/chk/sections/objects";
import { NO_UNIT } from "../../formats/dat/dat";
import { spriteKind } from "../../editor/sprites";
import { isAnywhereIntact, locationName } from "../../editor/locations";
import { useLocationTools } from "../../hooks/useLocationTools";
import { useUnitTools } from "../../hooks/useUnitTools";
import { spriteName, useSpriteTools } from "../../hooks/useSpriteTools";
import { SpritePreview } from "../panels/UnitPreview";
import { Button, Check, Field, Group, NumberInput, Select, TextInput } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

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
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div className="unit-frame" title="The unit as it will be drawn, in the owner's colour">
              <SpritePreview kind="unit" id={form.unitId} owner={form.owner} colors={scenario?.playerColors} size={56} />
            </div>
            <select className="select grow" value={form.unitId} onChange={(e) => set("unitId", Number(e.target.value))}>
              {UNIT_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.units.map((id) => <option key={id} value={id}>{unitName(id)}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
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

interface LocationForm {
  name: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  elevationFlags: number;
}

/**
 * Every field the MRGN record stores, on one location (payload `{ index }`): name, the
 * four edges in pixels (an inverted box is accepted as typed), and the six elevation
 * ticks. Anywhere (slot 63) is shown read-only, with a way to put it back on the map.
 */
export function LocationPropertiesDialog({ entry }: DialogProps) {
  const store = useStore();
  const tools = useLocationTools();
  const scenario = store.get(scenarioAtom);
  const index = typeof entry.payload?.index === "number" ? entry.payload.index : -1;
  const original = scenario?.locations[index] ?? null;
  const [form, setForm] = useState<LocationForm | null>(() =>
    scenario && original && isLocationUsed(original)
      ? { name: locationName(scenario, index), left: original.left, top: original.top, right: original.right, bottom: original.bottom, elevationFlags: original.elevationFlags }
      : null,
  );

  if (!scenario || !form || !original) {
    return (
      <DialogFrame dialogKey={entry.key} title="Location Properties" icon={<SquareDashed size={14} />} size="sm">
        <p className="hint">Select a location on the map first.</p>
      </DialogFrame>
    );
  }

  const anywhere = index === ANYWHERE_INDEX;
  const intact = isAnywhereIntact(scenario);
  const set = (patch: Partial<LocationForm>) => setForm({ ...form, ...patch });
  const has = (bit: number) => (form.elevationFlags & bit) === 0;
  const setBit = (bit: number, on: boolean) => set({ elevationFlags: on ? form.elevationFlags & ~bit : form.elevationFlags | bit });
  const apply = () => { if (!anywhere) tools.edit(index, form, `Edit location ${locationName(scenario, index)}`); };
  const w = Math.abs(form.right - form.left), h = Math.abs(form.bottom - form.top);
  const inverted = form.right < form.left || form.bottom < form.top;
  const maxX = scenario.width * 32, maxY = scenario.height * 32;

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Location Properties"
      icon={<SquareDashed size={14} />}
      size="sm"
      showApply={!anywhere}
      onOk={apply}
      footerLeft={<span className="mono">MRGN slot {index} · string #{original.nameIndex}</span>}
    >
      <div className="form wide">
        <Field label="Name" hint={anywhere ? undefined : "A name already in the string table is reused; a new one is appended to it."}>
          <TextInput value={form.name} disabled={anywhere} onChange={(e) => set({ name: e.target.value })} />
        </Field>
      </div>
      <Group title="Bounds (pixels)">
        <div className="form" style={{ gridTemplateColumns: "max-content 1fr max-content 1fr" }}>
          <Field label="Left"><NumberInput value={form.left} onChange={(v) => set({ left: v })} min={0} max={maxX} step={32} disabled={anywhere} /></Field>
          <Field label="Top"><NumberInput value={form.top} onChange={(v) => set({ top: v })} min={0} max={maxY} step={32} disabled={anywhere} /></Field>
          <Field label="Right"><NumberInput value={form.right} onChange={(v) => set({ right: v })} min={0} max={maxX} step={32} disabled={anywhere} /></Field>
          <Field label="Bottom"><NumberInput value={form.bottom} onChange={(v) => set({ bottom: v })} min={0} max={maxY} step={32} disabled={anywhere} /></Field>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {Number.isInteger(w / 32) ? w / 32 : (w / 32).toFixed(2)} × {Number.isInteger(h / 32) ? h / 32 : (h / 32).toFixed(2)} tiles · {w} × {h} px
          {inverted ? " · inverted (right < left or bottom < top) — the game reads the normalised box" : ""}
        </p>
      </Group>
      <Group title="Elevations">
        <p className="hint" style={{ marginBottom: 6 }}>The location applies only on the ticked elevations; the file stores a set bit for each excluded one.</p>
        <div className="form" style={{ gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
          {ELEVATIONS.map((e) => <Check key={e.bit} label={e.label} checked={has(e.bit)} disabled={anywhere} onChange={(ev) => setBit(e.bit, ev.target.checked)} />)}
        </div>
        <div className="row" style={{ marginTop: 8, gap: 6 }}>
          <Button size="sm" disabled={anywhere || form.elevationFlags === 0} onClick={() => set({ elevationFlags: 0 })}>All</Button>
          <Button size="sm" disabled={anywhere || form.elevationFlags === ELEVATION_MASK} onClick={() => set({ elevationFlags: ELEVATION_MASK })}>None</Button>
          <span className="faint mono">flags {hex(form.elevationFlags, 2)}</span>
        </div>
      </Group>
      {anywhere && (
        <p className="hint">
          This is the 64th location — the “Anywhere” every trigger can pick. StarEdit keeps it exactly the map and refuses to edit it, and so does this editor.{" "}
          {intact ? "It is intact." : <>It does not cover the map right now: <Button size="sm" onClick={() => tools.fixAnywhere()}>Reset to map bounds</Button></>}
        </p>
      )}
    </DialogFrame>
  );
}

/* ── Sprite Properties ──────────────────────────────────── */

/**
 * Every field the THG2 record stores, on the selected sprites. Only fields the user
 * touches are written; position is single-sprite only. Switching the kind flips the
 * `PureSprite` bit and re-reads the id against the other table, so the picker always
 * lists what the id will mean to the game.
 */
export function SpritePropertiesDialog({ entry }: DialogProps) {
  const store = useStore();
  const tools = useSpriteTools();
  const scenario = store.get(scenarioAtom);
  const indices = useMemo(() => {
    const raw = entry.payload?.indices;
    return Array.isArray(raw) ? raw.filter((i): i is number => typeof i === "number" && !!scenario?.sprites[i]) : [];
  }, [entry.payload, scenario]);
  const original = scenario?.sprites[indices[0] ?? -1] ?? null;
  const [form, setForm] = useState<SpriteRecord | null>(original);
  const [touched, setTouched] = useState<Set<keyof SpriteRecord>>(() => new Set());
  const single = indices.length === 1;
  const catalogue = tools.assets ? spriteCatalogue(tools.assets) : null;

  if (!form || !original) {
    return (
      <DialogFrame dialogKey={entry.key} title="Sprite Properties" icon={<Sparkles size={14} />} size="sm">
        <p className="hint">Select a sprite on the map first.</p>
      </DialogFrame>
    );
  }

  const kind = spriteKind(form);
  const set = <K extends keyof SpriteRecord>(key: K, value: SpriteRecord[K]) => {
    setForm({ ...form, [key]: value });
    setTouched(new Set(touched).add(key));
  };
  const has = (bit: number) => (form.flags & bit) !== 0;
  const setBit = (bit: number, on: boolean) => set("flags", on ? form.flags | bit : form.flags & ~bit);

  const apply = () => {
    const patch: Partial<SpriteRecord> = {};
    for (const key of touched) {
      if (!single && (key === "x" || key === "y")) continue;
      (patch as Record<string, unknown>)[key] = form[key];
    }
    if (Object.keys(patch).length === 0) return;
    tools.updateSelected(`Edit ${single ? spriteName(tools.assets, kind, form.spriteId) : `${indices.length} sprites`}`, () => patch, indices);
  };

  const owners = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: `Player ${i + 1} (${PLAYER_COLORS[playerColorIndex(scenario?.playerColors, i)].name})` }));
  if (form.owner > 11) owners.push({ value: String(form.owner), label: `Owner ${form.owner} (raw)` });

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={single ? "Sprite Properties" : `Sprite Properties — ${indices.length} sprites`}
      icon={<Sparkles size={14} />}
      size="sm"
      showApply
      onOk={apply}
      footerLeft={<span className="mono">THG2 #{single ? indices[0] : "—"} · flags {hex(form.flags, 4)}{touched.size > 0 ? ` · ${touched.size} changed` : ""}</span>}
    >
      <div className="form wide">
        <Field label="Kind" hint="A pure sprite is drawn as it is; a unit sprite becomes a unit of that type when the map loads (Installation doors and traps).">
          <div className="row">
            <Check radio name="sprite-kind" label="Pure sprite" checked={kind === "pure"} onChange={() => setBit(SpriteFlag.PureSprite, true)} />
            <Check radio name="sprite-kind" label="Unit sprite" checked={kind === "unit"} onChange={() => setBit(SpriteFlag.PureSprite, false)} />
          </div>
        </Field>
        <Field label={kind === "pure" ? "Sprite" : "Unit"}>
          <div className="row">
            <SpritePreview kind={kind} id={form.spriteId} owner={form.owner} colors={scenario?.playerColors} size={32} flipped={has(SpriteFlag.Flipped)} />
            {kind === "unit" ? (
              <select className="select grow" value={form.spriteId} onChange={(e) => set("spriteId", Number(e.target.value))}>
                {UNIT_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.units.map((id) => <option key={id} value={id}>{unitName(id)}</option>)}
                  </optgroup>
                ))}
                {form.spriteId >= NO_UNIT && <option value={form.spriteId}>Unit #{form.spriteId} (raw)</option>}
              </select>
            ) : catalogue ? (
              <select className="select grow" value={form.spriteId} onChange={(e) => set("spriteId", Number(e.target.value))}>
                {catalogue.groups.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.ids.map((id) => <option key={id} value={id}>{id} · {catalogue.entries[id].label}</option>)}
                  </optgroup>
                ))}
                {form.spriteId >= SPRITE_COUNT && <option value={form.spriteId}>Sprite #{form.spriteId} (raw)</option>}
              </select>
            ) : (
              <NumberInput value={form.spriteId} onChange={(v) => set("spriteId", v)} min={0} max={0xffff} width={130} />
            )}
          </div>
        </Field>
        <Field label="Owner">
          <Select value={String(form.owner)} onChange={(e) => set("owner", Number(e.target.value))} options={owners} />
        </Field>
        <Field label="Position" hint={single ? "Map pixels; a sprite may sit at any pixel." : "Position is edited one sprite at a time."}>
          <div className="row">
            <NumberInput value={form.x} onChange={(v) => set("x", v)} min={0} max={0xffff} width={110} unit="x" disabled={!single} />
            <NumberInput value={form.y} onChange={(v) => set("y", v)} min={0} max={0xffff} width={110} unit="y" disabled={!single} />
          </div>
        </Field>
      </div>
      <Group title="Flags">
        <div className="col" style={{ gap: 2 }}>
          <Check label="Flipped (0x2000)" title="Mirror the graphic left-to-right" checked={has(SpriteFlag.Flipped)} onChange={(e) => setBit(SpriteFlag.Flipped, e.target.checked)} />
          <Check label="Disabled (0x8000)" title="Unit sprites only: the unit starts inactive — a closed door, an unarmed trap" checked={has(SpriteFlag.Disabled)} disabled={kind === "pure"} onChange={(e) => setBit(SpriteFlag.Disabled, e.target.checked)} />
        </div>
        <div className="form" style={{ marginTop: 8 }}>
          <Field label="Raw flags" hint="Doodad overlays carry their doodad's whole CV5 flag word here; bits other than the three above are kept as they are.">
            <TextInput className="mono" value={hex(form.flags, 4)} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) set("flags", Math.min(0xffff, Math.max(0, Math.trunc(v)))); }} />
          </Field>
          <Field label="Unused byte" hint="Offset 7; the game ignores it.">
            <NumberInput value={form.unused} onChange={(v) => set("unused", v)} min={0} max={255} width={110} />
          </Field>
        </div>
      </Group>
    </DialogFrame>
  );
}
