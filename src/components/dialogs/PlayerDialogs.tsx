import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { ChevronLeft, ChevronRight, Palette, Shield, Users } from "lucide-react";
import { commitSettingsAtom, scenarioAtom, settingsRevisionAtom } from "../../atoms/documentAtoms";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { displayColorHex, hexToRgb, PLAYER_COLORS, PLAYER_RACES, PLAYER_TYPES, playerTypeLabel, rgbToHex } from "../../data/players";
import { ColorMode, defaultPlayerRgb, ForceFlag, FORCE_SLOTS, PLAYER_SLOTS, type PlayerRgb } from "../../formats/chk/sections/players";
import { MAP_VERSIONS, mapVersionOf } from "../../formats/chk/scenario";
import { applyForceSettings, applyPlayerColors, applyPlayerSettings, readForceSettings, readPlayerSettings } from "../../editor/settings";
import { useScenarioForm } from "../../hooks/useScenarioForm";
import { Button, Check, Group, ListBox, Select, TextInput } from "../ui";
import { ColorTextField } from "../ui/ColorCodes";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";
import { msg, t, translate } from "../../i18n";

/** A select over a byte table, keeping a value the table does not list (a map from another editor) selectable as raw. */
function ByteSelect({ value, onChange, options, disabled }: { value: number; onChange: (v: number) => void; options: { value: number; label: string }[]; disabled?: boolean }) {
  const opts = options.map((o) => ({ value: String(o.value), label: o.label }));
  if (!options.some((o) => o.value === value)) opts.push({ value: String(value), label: t("{value} (raw)", { value }) });
  return <Select value={String(value)} onChange={(e) => onChange(Number(e.target.value))} options={opts} disabled={disabled} />;
}

function NoMap({ entry, title, icon }: DialogProps & { title: string; icon: React.ReactNode }) {
  return (
    <DialogFrame dialogKey={entry.key} title={title} icon={icon} size="sm">
      <p className="hint">{t("Open or create a map first.")}</p>
    </DialogFrame>
  );
}

/* ── Player Settings ────────────────────────────────────── */

/**
 * OWNR / SIDE / COLR / FORC on the twelve slots, applied as one transaction. Colour and
 * force only exist for the eight playable slots; 9–12 draw in their fixed table colour.
 */
export function PlayerSettingsDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(settingsRevisionAtom);
  const commit = useSetAtom(commitSettingsAtom);
  const open = useSetAtom(openDialogAtom);
  const [local, setLocal] = useScenarioForm(scenario, readPlayerSettings);
  if (!scenario || !local) return <NoMap entry={entry} title={t("Player Settings")} icon={<Users size={14} />} />;

  const patch = (key: "types" | "races" | "colors" | "force", i: number, v: number) =>
    setLocal({ ...local, [key]: local[key].map((x, j) => (j === i ? v : x)) });
  const apply = () => { applyPlayerSettings(scenario, local); commit(); };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={t("Player Settings")}
      icon={<Users size={14} />}
      size="lg"
      onOk={apply}
      showApply
      slot={{ dialog: "playerSettings" }}
      footerLeft={<div className="row"><Button size="sm" onClick={() => open("playerColors")}><Palette size={12} /> {" "}{t("Player Colors…")}</Button><Button size="sm" onClick={() => open("forceSettings")}><Shield size={12} /> {" "}{t("Forces…")}</Button></div>}
    >
      <div className="listbox" style={{ maxHeight: 420 }}>
        <table className="table">
          <thead>
            <tr><th style={{ width: 90 }}>{t("Player")}</th><th>{t("Controller")}</th><th>{t("Race")}</th><th style={{ width: 150 }}>{t("Colour")}</th><th style={{ width: 90 }}>{t("Force")}</th></tr>
          </thead>
          <tbody>
            {Array.from({ length: PLAYER_SLOTS }, (_, i) => (
              <tr key={i}>
                <td><span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: displayColorHex(local.colors, scenario.playerRgb, i) }} />{t("P{v}", { v: i + 1 })}</span></td>
                <td><ByteSelect value={local.types[i]} onChange={(v) => patch("types", i, v)} options={PLAYER_TYPES} /></td>
                <td><ByteSelect value={local.races[i]} onChange={(v) => patch("races", i, v)} options={PLAYER_RACES} /></td>
                <td>
                  {i < FORCE_SLOTS
                    ? <ByteSelect value={local.colors[i]} onChange={(v) => patch("colors", i, v)} options={PLAYER_COLORS.map((c) => ({ value: c.id, label: c.name }))} />
                    : <span className="faint">{PLAYER_COLORS[i]?.name ?? "—"}</span>}
                </td>
                <td>
                  {i < FORCE_SLOTS
                    ? <Select value={String(local.force[i])} onChange={(e) => patch("force", i, Number(e.target.value))} options={[0, 1, 2, 3].map((f) => ({ value: String(f), label: t("Force {v}", { v: f + 1 }) }))} />
                    : <span className="faint">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {t("Controller is the OWNR byte (IOWN is kept in step), race SIDE, colour COLR and force FORC. Players 9–12 are the game's neutral / trigger-only slots: no colour choice, no force.")}
      </p>
    </DialogFrame>
  );
}

/* ── Force Settings ─────────────────────────────────────── */

const FORCE_FLAGS: { bit: number; label: string }[] = [
  { bit: ForceFlag.RandomStart, label: msg("Random start location") },
  { bit: ForceFlag.Allied, label: msg("Allies") },
  { bit: ForceFlag.AlliedVictory, label: msg("Allied victory") },
  { bit: ForceFlag.SharedVision, label: msg("Shared vision") },
];

/** FORC: the four names, flags and which force each playable slot is in. */
export function ForceSettingsDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(settingsRevisionAtom);
  const commit = useSetAtom(commitSettingsAtom);
  const [local, setLocal] = useScenarioForm(scenario, readForceSettings);
  const [sel, setSel] = useState<{ force: number; player: number } | null>(null);
  if (!scenario || !local) return <NoMap entry={entry} title={t("Force Settings")} icon={<Shield size={14} />} />;

  const move = (player: number, to: number) => setLocal({ ...local, playerForce: local.playerForce.map((f, i) => (i === player ? to : f)) });
  const setName = (fi: number, name: string) => setLocal({ ...local, names: local.names.map((n, i) => (i === fi ? name : n)) });
  const setFlag = (fi: number, bit: number, on: boolean) => setLocal({ ...local, flags: local.flags.map((f, i) => (i === fi ? (on ? f | bit : f & ~bit) : f)) });
  const apply = () => { applyForceSettings(scenario, local); commit(); };

  return (
    <DialogFrame dialogKey={entry.key} title={t("Force Settings")} icon={<Shield size={14} />} size="lg" onOk={apply} showApply>
      <div className="force-grid">
        {[0, 1, 2, 3].map((fi) => {
          const members = Array.from({ length: FORCE_SLOTS }, (_, p) => p).filter((p) => local.playerForce[p] === fi);
          const picked = sel?.force === fi && members.includes(sel.player) ? sel.player : null;
          return (
            <fieldset key={fi} className="group force-box">
              <legend>{t("Force {v}", { v: fi + 1 })}</legend>
              <div className="row" style={{ marginBottom: 6 }}>
                <ColorTextField wrapClassName="grow" value={local.names[fi]} placeholder={t("Force {v}", { v: fi + 1 })} onChange={(v) => setName(fi, v)} />
              </div>
              <div className="row" style={{ alignItems: "stretch" }}>
                <ListBox
                  className="grow"
                  items={members}
                  selected={picked === null ? null : members.indexOf(picked)}
                  onSelect={(_, p) => setSel({ force: fi, player: p })}
                  empty={t("No players")}
                  render={(p) => <><span className="swatch" style={{ background: displayColorHex(scenario.playerColors, scenario.playerRgb, p) }} />{t("Player {v}", { v: p + 1 })}<span className="faint" style={{ marginLeft: "auto" }}>{playerTypeLabel(scenario.playerTypes[p])}</span></>}
                />
                <div className="col" style={{ gap: 4 }}>
                  {[0, 1, 2, 3].filter((f) => f !== fi).map((f) => (
                    <Button key={f} size="sm" disabled={picked === null} title={t("Move to Force {v}", { v: f + 1 })} onClick={() => { if (picked !== null) { move(picked, f); setSel({ force: f, player: picked }); } }}>
                      {f < fi ? <ChevronLeft size={11} /> : <ChevronRight size={11} />} {" "}{t("F{v}", { v: f + 1 })}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="row flags">
                {FORCE_FLAGS.map((f) => <Check key={f.bit} label={translate(f.label)} checked={(local.flags[fi] & f.bit) !== 0} onChange={(e) => setFlag(fi, f.bit, e.target.checked)} />)}
              </div>
            </fieldset>
          );
        })}
      </div>
      <p className="hint">{t("Select a player, then use the buttons to move it between forces. A renamed force reuses an identical string if the table has one, else appends a new one. Players 9–12 cannot belong to a force.")}</p>
    </DialogFrame>
  );
}

/* ── Player Colors ──────────────────────────────────────── */

const COLOR_MODES: { mode: number; label: string; hint: string }[] = [
  { mode: ColorMode.Palette, label: msg("Palette colour (COLR)"), hint: msg("The entry picked above — what every client reads") },
  { mode: ColorMode.Random, label: msg("Random predefined"), hint: msg("Any entry from the table, chosen when the game starts") },
  { mode: ColorMode.PlayerChoice, label: msg("Player's choice"), hint: msg("Whatever the player set in the lobby") },
  { mode: ColorMode.Custom, label: msg("Custom RGB"), hint: msg("The exact colour below") },
];

/** What the list says beside a slot: its palette name, or the CRGB mode that overrides it. */
function slotLabel(colr: number, mode: number | undefined): string {
  if (mode === undefined || mode === ColorMode.Palette) return PLAYER_COLORS[colr]?.name ?? `Colour ${colr}`;
  return translate(COLOR_MODES.find((m) => m.mode === mode)?.label ?? `Mode ${mode}`);
}

/**
 * COLR for every client, plus Remastered's CRGB when the map wants a colour the table
 * does not have. The CRGB section exists only while some slot needs it; setting every
 * slot back to its palette colour removes it again.
 */
export function PlayerColorsDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(settingsRevisionAtom);
  const commit = useSetAtom(commitSettingsAtom);
  const [form, setForm] = useScenarioForm(scenario, (scn) => ({
    colors: scn.playerColors.slice(0, FORCE_SLOTS),
    rgb: scn.playerRgb ? { rgb: scn.playerRgb.rgb.map((c) => [...c] as [number, number, number]), mode: scn.playerRgb.mode.slice() } as PlayerRgb : null,
  }));
  const [sel, setSel] = useState(0);
  const [hexText, setHexText] = useState<string | null>(null);
  if (!scenario || !form) return <NoMap entry={entry} title={t("Player Colors")} icon={<Palette size={14} />} />;
  const { colors, rgb } = form;
  const setColors = (c: number[]) => setForm({ ...form, colors: c });
  const setRgb = (r: PlayerRgb | null) => setForm({ ...form, rgb: r });

  const mode = rgb?.mode[sel] ?? ColorMode.Palette;
  const current = displayColorHex(colors, rgb, sel);
  const customHex = rgb ? rgbToHex(rgb.rgb[sel]) : PLAYER_COLORS[colors[sel]]?.hex ?? "#000000";
  const version = mapVersionOf(scenario.fileVersion);

  const setMode = (m: number) => {
    const next = rgb ?? defaultPlayerRgb();
    // Seed a fresh custom colour from the palette entry so the picker opens on something sensible.
    if (m === ColorMode.Custom && next.rgb[sel].every((v) => v === 0)) next.rgb[sel] = hexToRgb(PLAYER_COLORS[colors[sel]]?.hex ?? "#000000") ?? [0, 0, 0];
    setRgb({ rgb: next.rgb.map((c) => [...c] as [number, number, number]), mode: next.mode.map((v, i) => (i === sel ? m : v)) });
    setHexText(null);
  };
  const setCustom = (hex: string) => {
    const c = hexToRgb(hex);
    if (!c || !rgb) return;
    setRgb({ ...rgb, rgb: rgb.rgb.map((v, i) => (i === sel ? c : v)) });
  };
  const pickPalette = (id: number) => setColors(colors.map((c, i) => (i === sel ? id : c)));
  const apply = () => {
    // A CRGB that says "palette" for every slot adds nothing the file does not already say.
    const wanted = rgb && rgb.mode.some((m) => m !== ColorMode.Palette) ? rgb : null;
    applyPlayerColors(scenario, colors, wanted);
    commit();
  };

  return (
    <DialogFrame dialogKey={entry.key} title={t("Player Colors")} icon={<Palette size={14} />} size="md" onOk={apply} showApply footerLeft={<span className="mono hint">COLR{rgb && rgb.mode.some((m) => m !== ColorMode.Palette) ? " + CRGB" : ""}</span>}>
      <div className="split" style={{ ["--split" as string]: "200px" }}>
        <Group title={t("Player")} flush>
          <ListBox
            items={colors}
            selected={sel}
            onSelect={setSel}
            style={{ height: 262, border: "none", boxShadow: "none" }}
            render={(c, i) => <><span className="swatch" style={{ background: displayColorHex(colors, rgb, i) }} />{t("Player {v}", { v: i + 1 })}<span className="faint" style={{ marginLeft: "auto" }}>{slotLabel(c, rgb?.mode[i])}</span></>}
          />
        </Group>
        <div className="stack">
          <Group title={t("Player {v} palette colour", { v: sel + 1 })}>
            <div className="color-grid">
              {PLAYER_COLORS.map((c) => (
                <button key={c.id} className={`color-chip ${colors[sel] === c.id ? "selected" : ""}`} style={{ ["--c" as string]: c.hex }} title={`${c.id}: ${translate(c.name)}`} onClick={() => pickPalette(c.id)} />
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <span className="dim" style={{ fontSize: 11 }}>{t("Shown as:")}</span>
              <span className="swatch" style={{ background: current, width: 18, height: 18 }} />
              <strong>{mode === ColorMode.Custom ? current : PLAYER_COLORS[colors[sel]]?.name ?? t("Colour {v}", { v: colors[sel] })}</strong>
            </div>
          </Group>
          <Group title={t("Remastered (CRGB)")}>
            <div className="col" style={{ gap: 2 }}>
              {COLOR_MODES.map((m) => <Check key={m.mode} radio name="crgb-mode" label={translate(m.label)} title={translate(m.hint)} checked={mode === m.mode} onChange={() => setMode(m.mode)} />)}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <input type="color" className="input" disabled={mode !== ColorMode.Custom} value={customHex} onChange={(e) => { setCustom(e.target.value); setHexText(null); }} />
              <TextInput className="mono" disabled={mode !== ColorMode.Custom} style={{ width: 90 }} value={hexText ?? customHex} onChange={(e) => { setHexText(e.target.value); setCustom(e.target.value); }} onBlur={() => setHexText(null)} />
            </div>
            <p className="hint" style={{ marginTop: 6 }}>
              {version === "remastered" ? t("The map draws a custom colour with a ramp built from the RGB — an approximation of Remastered's shading.") : t("This map is {label}: older clients ignore CRGB and read COLR. Set the revision to Remastered in Map Revision for it to take effect.", { label: MAP_VERSIONS[version].label })}
            </p>
          </Group>
        </div>
      </div>
    </DialogFrame>
  );
}
