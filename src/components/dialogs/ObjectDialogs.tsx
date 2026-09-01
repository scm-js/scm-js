import { useState } from "react";
import { Sparkles, SquareDashed, User } from "lucide-react";
import { PLAYER_COLORS } from "../../data/players";
import { SAMPLE_LOCATIONS, type SampleLocation } from "../../data/samples";
import { SPRITES, UNIT_GROUPS } from "../../data/units";
import { Check, Field, Group, NumberInput, Select, TextInput } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

const PLAYER_OPTS = PLAYER_COLORS.slice(0, 12).map((c, i) => ({ value: String(i), label: `Player ${i + 1} (${c.name})` }));

/* ── Unit Properties ────────────────────────────────────── */

export function UnitPropertiesDialog({ entry }: DialogProps) {
  const unit = String(entry.payload?.unit ?? "Marine");
  const owner = Number(entry.payload?.owner ?? 0);
  const [hp, setHp] = useState(100);
  const [sh, setSh] = useState(100);
  const [en, setEn] = useState(100);
  const [res, setRes] = useState(0);
  const [hangar, setHangar] = useState(0);
  return (
    <DialogFrame dialogKey={entry.key} title="Unit Properties" icon={<User size={14} />} size="md" showApply footerLeft={<span className="mono">ID 0x0000 · serial #—</span>}>
      <div className="form wide">
        <Field label="Unit">
          <Select defaultValue={unit} options={UNIT_GROUPS.flatMap((g) => g.units)} />
        </Field>
        <Field label="Owner">
          <Select defaultValue={String(owner)} options={PLAYER_OPTS} />
        </Field>
        <Field label="Position">
          <div className="row">
            <NumberInput value={384} onChange={() => {}} min={0} width={110} unit="x" />
            <NumberInput value={448} onChange={() => {}} min={0} width={110} unit="y" />
            <span className="hint">pixels</span>
          </div>
        </Field>
      </div>
      <div className="split" style={{ ["--split" as string]: "1fr" }}>
        <Group title="Vitals">
          <div className="form">
            <Field label="Hit points"><NumberInput value={hp} onChange={setHp} min={0} max={100} unit="%" /></Field>
            <Field label="Shields"><NumberInput value={sh} onChange={setSh} min={0} max={100} unit="%" /></Field>
            <Field label="Energy"><NumberInput value={en} onChange={setEn} min={0} max={100} unit="%" /></Field>
            <Field label="Resources"><NumberInput value={res} onChange={setRes} min={0} max={50000} /></Field>
            <Field label="Hangar"><NumberInput value={hangar} onChange={setHangar} min={0} max={255} /></Field>
          </div>
        </Group>
        <Group title="State flags">
          <div className="col" style={{ gap: 2 }}>
            <Check label="Cloaked" />
            <Check label="Burrowed" />
            <Check label="In transit (lifted)" />
            <Check label="Hallucinated" />
            <Check label="Invincible" />
          </div>
          <div className="sep-h" style={{ margin: "8px 0" }} />
          <div className="col" style={{ gap: 2 }}>
            <Check label="Related unit (add-on / nydus)" />
            <TextInput className="mono" placeholder="Related serial #" disabled />
          </div>
        </Group>
      </div>
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
