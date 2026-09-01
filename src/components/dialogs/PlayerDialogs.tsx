import { useState } from "react";
import { useAtom, useSetAtom } from "jotai";
import { ChevronLeft, ChevronRight, Palette, Shield, Users } from "lucide-react";
import { forcesAtom, playersAtom } from "../../atoms/editorAtoms";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { CONTROLLERS, PLAYER_COLORS, RACES, type Controller, type Race } from "../../data/players";
import { Button, Check, Group, ListBox, Select, TextInput } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/* ── Player Settings ────────────────────────────────────── */

export function PlayerSettingsDialog({ entry }: DialogProps) {
  const [players, setPlayers] = useAtom(playersAtom);
  const [local, setLocal] = useState(players);
  const open = useSetAtom(openDialogAtom);
  const upd = (i: number, patch: Partial<(typeof local)[number]>) => setLocal(local.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Player Settings"
      icon={<Users size={14} />}
      size="lg"
      onOk={() => setPlayers(local)}
      showApply
      footerLeft={<Button size="sm" onClick={() => open("playerColors")}><Palette size={12} /> Player Colors…</Button>}
    >
      <div className="listbox" style={{ maxHeight: 420 }}>
        <table className="table">
          <thead>
            <tr><th style={{ width: 80 }}>Player</th><th>Controller</th><th>Race</th><th style={{ width: 150 }}>Colour</th><th style={{ width: 90 }}>Force</th></tr>
          </thead>
          <tbody>
            {local.map((p, i) => (
              <tr key={p.id}>
                <td><span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: PLAYER_COLORS[p.colorId].hex }} />P{i + 1}</span></td>
                <td>
                  <Select value={p.controller} onChange={(e) => upd(i, { controller: e.target.value as Controller })} options={CONTROLLERS.map((c) => ({ value: c.id, label: c.label }))} />
                </td>
                <td>
                  <Select value={p.race} onChange={(e) => upd(i, { race: e.target.value as Race })} options={RACES.map((r) => ({ value: r.id, label: r.label }))} />
                </td>
                <td>
                  <Select value={String(p.colorId)} onChange={(e) => upd(i, { colorId: Number(e.target.value) })} options={PLAYER_COLORS.map((c) => ({ value: String(c.id), label: c.name }))} disabled={i >= 8} />
                </td>
                <td>
                  <Select value={String(p.force)} onChange={(e) => upd(i, { force: Number(e.target.value) })} options={[0, 1, 2, 3].map((f) => ({ value: String(f), label: `Force ${f + 1}` }))} disabled={i >= 8} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Players 9–12 are reserved for neutral / trigger-only ownership. Colour and force apply to players 1–8.</p>
    </DialogFrame>
  );
}

/* ── Force Settings ─────────────────────────────────────── */

export function ForceSettingsDialog({ entry }: DialogProps) {
  const [forces, setForces] = useAtom(forcesAtom);
  const [players, setPlayers] = useAtom(playersAtom);
  const [lf, setLf] = useState(forces);
  const [lp, setLp] = useState(players);
  const [sel, setSel] = useState<{ force: number; idx: number } | null>(null);

  const move = (playerId: number, to: number) => setLp(lp.map((p) => (p.id === playerId ? { ...p, force: to } : p)));
  const patch = (fi: number, p: Partial<(typeof lf)[number]>) => setLf(lf.map((x, j) => (j === fi ? { ...x, ...p } : x)));

  return (
    <DialogFrame dialogKey={entry.key} title="Force Settings" icon={<Shield size={14} />} size="lg" onOk={() => { setForces(lf); setPlayers(lp); }} showApply>
      <div className="force-grid">
        {lf.map((f, fi) => {
          const members = lp.filter((p) => p.force === fi && p.id < 8);
          const picked = sel?.force === fi ? members[sel.idx] : undefined;
          return (
            <fieldset key={f.id} className="group force-box">
              <legend>Force {fi + 1}</legend>
              <div className="row" style={{ marginBottom: 6 }}>
                <TextInput value={f.name} onChange={(e) => patch(fi, { name: e.target.value })} />
              </div>
              <div className="row" style={{ alignItems: "stretch" }}>
                <ListBox
                  className="grow"
                  items={members}
                  selected={sel?.force === fi ? sel.idx : null}
                  onSelect={(idx) => setSel({ force: fi, idx })}
                  empty="No players"
                  render={(p) => <><span className="swatch" style={{ background: PLAYER_COLORS[p.colorId].hex }} />Player {p.id + 1}<span className="faint" style={{ marginLeft: "auto" }}>{CONTROLLERS.find((c) => c.id === p.controller)?.label.split(" ")[0]}</span></>}
                />
                <div className="col" style={{ gap: 4 }}>
                  {[0, 1, 2, 3].filter((t) => t !== fi).map((t) => (
                    <Button key={t} size="sm" disabled={!picked} title={`Move to Force ${t + 1}`} onClick={() => { if (picked) { move(picked.id, t); setSel(null); } }}>
                      {t < fi ? <ChevronLeft size={11} /> : <ChevronRight size={11} />} F{t + 1}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="row flags">
                <Check label="Random start location" checked={f.randomStart} onChange={(e) => patch(fi, { randomStart: e.target.checked })} />
                <Check label="Allies" checked={f.allies} onChange={(e) => patch(fi, { allies: e.target.checked })} />
                <Check label="Allied victory" checked={f.alliedVictory} onChange={(e) => patch(fi, { alliedVictory: e.target.checked })} />
                <Check label="Shared vision" checked={f.sharedVision} onChange={(e) => patch(fi, { sharedVision: e.target.checked })} />
              </div>
            </fieldset>
          );
        })}
      </div>
      <p className="hint">Select a player, then use the buttons to move it between forces. Players 9–12 cannot belong to a force.</p>
    </DialogFrame>
  );
}

/* ── Player Colors ──────────────────────────────────────── */

export function PlayerColorsDialog({ entry }: DialogProps) {
  const [players, setPlayers] = useAtom(playersAtom);
  const [local, setLocal] = useState(players);
  const [sel, setSel] = useState(0);
  const [custom, setCustom] = useState(false);
  const [rgb, setRgb] = useState<Record<number, string | undefined>>({});
  const current = rgb[sel] ?? PLAYER_COLORS[local[sel].colorId].hex;

  return (
    <DialogFrame dialogKey={entry.key} title="Player Colors" icon={<Palette size={14} />} size="md" onOk={() => setPlayers(local)} showApply>
      <div className="split" style={{ ["--split" as string]: "200px" }}>
        <Group title="Player" flush>
          <ListBox
            items={local.slice(0, 8)}
            selected={sel}
            onSelect={setSel}
            style={{ height: 232, border: "none", boxShadow: "none" }}
            render={(p, i) => <><span className="swatch" style={{ background: rgb[i] ?? PLAYER_COLORS[p.colorId].hex }} />Player {i + 1}<span className="faint" style={{ marginLeft: "auto" }}>{rgb[i] ? "custom" : PLAYER_COLORS[p.colorId].name}</span></>}
          />
        </Group>
        <div className="stack">
          <Group title={`Player ${sel + 1} colour`}>
            <div className="color-grid">
              {PLAYER_COLORS.map((c) => (
                <button key={c.id} className={`color-chip ${!rgb[sel] && local[sel].colorId === c.id ? "selected" : ""}`} style={{ ["--c" as string]: c.hex }} title={c.name} onClick={() => { setLocal(local.map((p, i) => (i === sel ? { ...p, colorId: c.id } : p))); setRgb({ ...rgb, [sel]: undefined }); }} />
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <span className="dim" style={{ fontSize: 11 }}>Selected:</span>
              <span className="swatch" style={{ background: current, width: 18, height: 18 }} />
              <strong>{rgb[sel] ? rgb[sel] : PLAYER_COLORS[local[sel].colorId].name}</strong>
            </div>
          </Group>
          <Group title="Custom RGB (CRGB)">
            <div className="row">
              <Check label="Use custom colour" checked={custom} onChange={(e) => setCustom(e.target.checked)} />
              <input type="color" className="input" disabled={!custom} value={current} onChange={(e) => setRgb({ ...rgb, [sel]: e.target.value })} />
              <TextInput className="mono" disabled={!custom} style={{ width: 90 }} value={current} onChange={(e) => setRgb({ ...rgb, [sel]: e.target.value })} />
            </div>
            <p className="hint" style={{ marginTop: 6 }}>Custom colours require Remastered 1.21+. Older clients fall back to the palette entry.</p>
          </Group>
        </div>
      </div>
      <Check label="Randomize player colours in-game (ignore this table)" />
    </DialogFrame>
  );
}
