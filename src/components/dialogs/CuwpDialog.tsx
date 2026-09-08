import { Fragment, useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Eraser, PackagePlus } from "lucide-react";
import { commitSettingsAtom, scenarioAtom, settingsRevisionAtom, triggersRevisionAtom } from "../../atoms/documentAtoms";
import {
  applyCuwp, CUWP_SLOTS, CuwpField, CuwpState, CuwpValid, cuwpSlotActive, cuwpUsage, describeCuwpSlot, emptyCuwpSlot, readCuwp, type CuwpSlot, type CuwpTable,
} from "../../editor/cuwp";
import { useScenarioForm } from "../../hooks/useScenarioForm";
import { Button, Check, Group, ListBox, NumberInput, Tick } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";
import { t } from "../../i18n";

/**
 * Triggers ▸ Unit Properties Slots…: the 64 Create Unit with Properties slots (UPRP), each
 * a set of vitals and special states a trigger applies to the units it creates, with
 * StarEdit's "in use" tick (UPUS). A settings-style transaction like Switches: a working
 * copy until OK / Apply, then `applyCuwp` marks only what changed. `payload.slot` (1-based)
 * opens on a slot — the Classic editor's Edit… button next to the action's pick.
 */
export function CuwpDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(settingsRevisionAtom);
  useAtomValue(triggersRevisionAtom);
  const commit = useSetAtom(commitSettingsAtom);
  const [table, setTable] = useScenarioForm<CuwpTable>(scenario, readCuwp);
  const initial = typeof entry.payload?.slot === "number" ? Math.max(0, Math.min(CUWP_SLOTS - 1, (entry.payload.slot as number) - 1)) : 0;
  const [sel, setSel] = useState(initial);
  const usage = useMemo(() => (scenario ? cuwpUsage(scenario) : []), [scenario]);

  if (!scenario || !table) {
    return (
      <DialogFrame dialogKey={entry.key} title={t("Unit Properties Slots")} icon={<PackagePlus size={14} />} size="sm">
        <p className="hint">{t("Open or create a map first.")}</p>
      </DialogFrame>
    );
  }

  const slot = table.slots[sel];
  const update = (next: CuwpSlot, used = true) => {
    const slots = table.slots.slice();
    slots[sel] = next;
    const usedList = table.used.slice();
    if (used) usedList[sel] = true;
    setTable({ slots, used: usedList });
  };
  const setField = (bit: number, on: boolean) => update({ ...slot, validFields: on ? slot.validFields | bit : slot.validFields & ~bit });
  const setNumber = (key: "hitPointsPercent" | "shieldsPercent" | "energyPercent" | "resources" | "hangar", bit: number, v: number) =>
    update({ ...slot, [key]: v, validFields: slot.validFields | bit });
  const setState = (valid: number, bit: number, mode: "default" | "on" | "off") =>
    update({
      ...slot,
      validProperties: mode === "default" ? slot.validProperties & ~valid : slot.validProperties | valid,
      stateFlags: mode === "on" ? slot.stateFlags | bit : slot.stateFlags & ~bit,
    });
  const clear = () => {
    const slots = table.slots.slice();
    slots[sel] = emptyCuwpSlot();
    const usedList = table.used.slice();
    usedList[sel] = false;
    setTable({ slots, used: usedList });
  };
  const apply = () => {
    if (applyCuwp(scenario, table).length > 0) commit();
    setTable(readCuwp(scenario));
  };

  const active = table.slots.filter(cuwpSlotActive).length;
  const referenced = usage.filter((n) => n > 0).length;

  /** A vital row: number, its unit, and whether the slot applies it at all. */
  const vital = (label: string, key: "hitPointsPercent" | "shieldsPercent" | "energyPercent" | "resources" | "hangar", bit: number, max: number, unit: string) => {
    const on = (slot.validFields & bit) !== 0;
    return (
      <Fragment key={key}>
        <span className={on ? "" : "unused"}>{label}</span>
        <NumberInput value={slot[key]} onChange={(v) => setNumber(key, bit, v)} min={0} max={max} />
        <span className="dim">{unit}</span>
        <Tick checked={on} onChange={(e) => setField(bit, e.target.checked)} aria-label={t("{label} applied", { label })} title={t("Applied to the created units; unticked, they keep the unit type's default")} />
      </Fragment>
    );
  };
  const state = (label: string, valid: number, bit: number, hint: string) => {
    const mode = (slot.validProperties & valid) === 0 ? "default" : (slot.stateFlags & bit) !== 0 ? "on" : "off";
    return (
      <div className="row" key={label} style={{ gap: 10 }} title={hint}>
        <span style={{ width: 110 }}>{label}</span>
        <Check radio label={t("Default")} checked={mode === "default"} onChange={() => setState(valid, bit, "default")} />
        <Check radio label={t("On")} checked={mode === "on"} onChange={() => setState(valid, bit, "on")} />
        <Check radio label={t("Off")} checked={mode === "off"} onChange={() => setState(valid, bit, "off")} />
      </div>
    );
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={t("Unit Properties Slots")}
      icon={<PackagePlus size={14} />}
      size="lg"
      tall
      showApply
      onOk={apply}
      footerLeft={<span>{t("{CUWP_SLOTS} slots · {active} set · {referenced} named by triggers", { CUWP_SLOTS, active, referenced })}</span>}
    >
      <div className="split" style={{ ["--split" as string]: "300px" }}>
        <ListBox
          items={table.slots}
          selected={sel}
          onSelect={setSel}
          render={(s, i) => (
            <>
              <span className="idx">{i + 1}</span>
              {cuwpSlotActive(s) ? <span>{describeCuwpSlot(s)}</span> : <span className="faint">{table.used[i] ? t("in use, nothing set") : t("empty")}</span>}
              <span className="row" style={{ marginLeft: "auto", gap: 4 }}>
                {usage[i] > 0 && <span className="dim" style={{ fontSize: 10 }} title={t("Create Unit with Properties actions naming this slot")}>{usage[i]} use{usage[i] === 1 ? "" : "s"}</span>}
                {table.used[i] && <span className="badge teal">{t("in use")}</span>}
              </span>
            </>
          )}
        />
        <div className="col" style={{ gap: 10, flex: "none", minWidth: 340 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{t("Slot {v}", { v: sel + 1 })}</strong>
            <span className="row" style={{ gap: 6 }}>
              <Check label={t("In use")} checked={table.used[sel]} onChange={(e) => { const used = table.used.slice(); used[sel] = e.target.checked; setTable({ ...table, used }); }} title={t("StarEdit's tick (UPUS); the game reads the slot either way")} />
              <Button size="sm" onClick={clear} disabled={!cuwpSlotActive(slot) && !table.used[sel]} title={t("Empty the slot and clear its tick")}><Eraser size={12} /> {" "}{t("Clear")}</Button>
            </span>
          </div>
          <Group title={t("Vitals")}>
            <div className="form" style={{ gridTemplateColumns: "max-content 1fr max-content max-content" }}>
              {vital(t("Hit points"), "hitPointsPercent", CuwpField.HitPoints, 100, "%")}
              {vital(t("Shields"), "shieldsPercent", CuwpField.Shields, 100, "%")}
              {vital(t("Energy"), "energyPercent", CuwpField.Energy, 100, "%")}
              {vital(t("Resources"), "resources", CuwpField.Resources, 4294967295, "")}
              {vital(t("Hangar"), "hangar", CuwpField.Hangar, 65535, "units")}
            </div>
            <p className="hint">{t("Percentages of the unit type's maximum. Resources apply to mineral fields and geysers, hangar to carriers and reavers.")}</p>
          </Group>
          <Group title={t("Special states")}>
            <div className="col" style={{ gap: 4 }}>
              {state(t("Cloaked"), CuwpValid.Cloak, CuwpState.Cloaked, t("Units that can cloak"))}
              {state(t("Burrowed"), CuwpValid.Burrow, CuwpState.Burrowed, t("Units that can burrow"))}
              {state(t("In transit"), CuwpValid.InTransit, CuwpState.InTransit, t("Landed buildings lift off"))}
              {state(t("Hallucinated"), CuwpValid.Hallucinated, CuwpState.Hallucinated, t("Takes double damage and does none"))}
              {state(t("Invincible"), CuwpValid.Invincible, CuwpState.Invincible, t("Cannot be damaged"))}
            </div>
          </Group>
          <p className="hint">
            {t("A trigger's")}{" "}<em>{t("Create Unit with Properties")}</em> {" "}{t("names a slot by number; this is what the slot applies to every unit it creates. Used by")}{" "}{usage[sel] > 0 ? t("{v, plural, one {# action} other {# actions}}", { v: usage[sel] }) : t("no trigger")}.
          </p>
        </div>
      </div>
    </DialogFrame>
  );
}
