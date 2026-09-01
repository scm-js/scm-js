import { useState } from "react";
import { useSetAtom } from "jotai";
import { BookOpen, CircleX, Info, Keyboard, Search, Settings2, ShieldCheck, TriangleAlert } from "lucide-react";
import { closeDialogAtom } from "../../atoms/uiAtoms";
import { TILESETS } from "../../data/tilesets";
import { SAMPLE_LOCATIONS } from "../../data/samples";
import { UNIT_GROUPS, unitName } from "../../data/units";
import { Button, Check, Field, Group, ListBox, NumberInput, Select, Tabs, TextInput } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/* ── Preferences ────────────────────────────────────────── */

const HOTKEYS: [string, string][] = [
  ["New / Open / Save", "Ctrl+N · Ctrl+O · Ctrl+S"],
  ["Save As", "Ctrl+Shift+S"],
  ["Map Properties", "Alt+Enter"],
  ["Undo / Redo", "Ctrl+Z · Ctrl+Y"],
  ["Cut / Copy / Paste", "Ctrl+X · Ctrl+C · Ctrl+V"],
  ["Find", "Ctrl+F"],
  ["Toggle grid", "Ctrl+G"],
  ["Zoom in / out / 100%", "Ctrl++ · Ctrl+− · Ctrl+0"],
  ["Zoom to fit", "Ctrl+Shift+0"],
  ["Layer: Terrain / Doodads / Units", "T · D · U"],
  ["Layer: Sprites / Locations / Fog", "S · L · F"],
  ["Layer: Cut/Copy/Paste", "C"],
  ["Trigger Editor", "Ctrl+T"],
  ["Text Trigger Editor", "Ctrl+Shift+T"],
  ["Preferences", "Ctrl+,"],
  ["Keyboard shortcuts", "F1"],
  ["Full screen", "F11"],
];

export function PreferencesDialog({ entry }: DialogProps) {
  const [autosave, setAutosave] = useState(5);
  return (
    <DialogFrame dialogKey={entry.key} title="Preferences" icon={<Settings2 size={14} />} size="lg" tall showApply>
      <Tabs
        className="grow"
        tabs={[
          {
            value: "general",
            label: "General",
            content: (
              <div className="stack">
                <Group title="Startup">
                  <div className="col" style={{ gap: 2 }}>
                    <Check label="Show splash screen" defaultChecked />
                    <Check label="Reopen last scenario" />
                    <Check label="Check for updates" defaultChecked />
                  </div>
                </Group>
                <Group title="Saving">
                  <div className="form wide">
                    <Field label="Autosave every"><div className="row"><NumberInput value={autosave} onChange={setAutosave} min={0} max={60} width={110} unit="minutes (0 = off)" /></div></Field>
                    <Field label="Backups"><Check label="Keep a .bak copy on save" defaultChecked /></Field>
                    <Field label="On close"><Check label="Confirm when there are unsaved changes" defaultChecked /></Field>
                  </div>
                </Group>
                <Group title="New scenario defaults">
                  <div className="form wide">
                    <Field label="Tileset"><Select options={TILESETS.map((t) => t.name)} defaultValue="Jungle World" /></Field>
                    <Field label="Size"><Select options={["64 × 64", "96 × 96", "128 × 128", "192 × 192", "256 × 256"]} defaultValue="128 × 128" /></Field>
                  </div>
                </Group>
              </div>
            ),
          },
          {
            value: "display",
            label: "Display",
            content: (
              <div className="stack">
                <Group title="Map view">
                  <div className="col" style={{ gap: 2 }}>
                    <Check label="Smooth zoom animation" defaultChecked />
                    <Check label="Show rulers" defaultChecked />
                    <Check label="Show cursor tile HUD" defaultChecked />
                    <Check label="Colour-code units by player" defaultChecked />
                    <Check label="Draw unit health bars" />
                    <Check label="Draw location names" defaultChecked />
                  </div>
                </Group>
                <Group title="Overlays">
                  <div className="form wide">
                    <Field label="Location opacity"><input type="range" min={0} max={100} defaultValue={35} /></Field>
                    <Field label="Fog opacity"><input type="range" min={0} max={100} defaultValue={45} /></Field>
                    <Field label="Grid opacity"><input type="range" min={0} max={100} defaultValue={30} /></Field>
                  </div>
                </Group>
                <Group title="Theme">
                  <div className="form wide">
                    <Field label="Accent"><Select options={["Gold (StarEdit)", "Teal (Protoss)", "Amber (Terran)", "Violet (Zerg)"]} /></Field>
                    <Field label="Density"><Select options={["Compact", "Comfortable"]} /></Field>
                  </div>
                </Group>
              </div>
            ),
          },
          {
            value: "editing",
            label: "Editing",
            content: (
              <div className="stack">
                <Group title="Placement">
                  <div className="col" style={{ gap: 2 }}>
                    <Check label="Allow stacking units" />
                    <Check label="Allow placing units on unbuildable terrain" />
                    <Check label="Snap buildings to build grid" defaultChecked />
                    <Check label="Auto-generate ISOM cliffs" defaultChecked />
                    <Check label="Warn when exceeding unit limit (1700)" defaultChecked />
                  </div>
                </Group>
                <Group title="Defaults">
                  <div className="form wide">
                    <Field label="Unit owner"><Select options={Array.from({ length: 12 }, (_, i) => `Player ${i + 1}`)} /></Field>
                    <Field label="Brush size"><Select options={["1 × 1", "2 × 2", "3 × 3", "4 × 4", "5 × 5"]} /></Field>
                    <Field label="Undo levels"><NumberInput value={200} onChange={() => {}} min={10} max={2000} width={110} /></Field>
                  </div>
                </Group>
              </div>
            ),
          },
          {
            value: "hotkeys",
            label: "Hotkeys",
            content: (
              <div className="listbox hotkeys" style={{ height: "100%" }}>
                <table className="table">
                  <thead><tr><th>Command</th><th style={{ width: 240 }}>Shortcut</th></tr></thead>
                  <tbody>
                    {HOTKEYS.map(([cmd, keys]) => (
                      <tr key={cmd}><td>{cmd}</td><td>{keys.split(" · ").map((k) => <span key={k} className="kbd">{k}</span>)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
          },
        ]}
      />
    </DialogFrame>
  );
}

/* ── Shortcuts ──────────────────────────────────────────── */

export function ShortcutsDialog({ entry }: DialogProps) {
  const close = useSetAtom(closeDialogAtom);
  return (
    <DialogFrame dialogKey={entry.key} title="Keyboard Shortcuts" icon={<Keyboard size={14} />} size="md" footer={<Button variant="primary" onClick={() => close(entry.key)}>Close</Button>}>
      <div className="listbox hotkeys" style={{ maxHeight: 420 }}>
        <table className="table">
          <tbody>
            {HOTKEYS.map(([cmd, keys]) => (
              <tr key={cmd}><td>{cmd}</td><td style={{ textAlign: "right" }}>{keys.split(" · ").map((k) => <span key={k} className="kbd">{k}</span>)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </DialogFrame>
  );
}

/* ── Validate Map ───────────────────────────────────────── */

const ISSUES: { level: "error" | "warn" | "info"; text: string; where: string }[] = [
  { level: "error", text: "No start location for Player 5 (slot is Human)", where: "Players" },
  { level: "warn", text: "Location 'Anywhere' has been resized", where: "Location 63" },
  { level: "warn", text: "Trigger 5 references switch 12 which is never set", where: "Triggers" },
  { level: "warn", text: "Unit count 0 — map has no units", where: "Units" },
  { level: "info", text: "3 unused strings can be removed", where: "Strings" },
  { level: "info", text: "Map version: Brood War 1.04 (.scx)", where: "Header" },
];

export function ValidateMapDialog({ entry }: DialogProps) {
  const close = useSetAtom(closeDialogAtom);
  const icon = { error: <CircleX size={13} />, warn: <TriangleAlert size={13} />, info: <Info size={13} /> };
  return (
    <DialogFrame dialogKey={entry.key} title="Check Map" icon={<ShieldCheck size={14} />} size="md" footer={<><Button>Re-check</Button><Button variant="primary" onClick={() => close(entry.key)}>Close</Button></>} footerLeft={<span>1 error · 3 warnings · 2 notes</span>}>
      <div className="row">
        <Check label="Errors" defaultChecked /><Check label="Warnings" defaultChecked /><Check label="Notes" defaultChecked />
        <span className="grow" />
        <Check label="Check on save" />
      </div>
      <div className="listbox" style={{ maxHeight: 320 }}>
        {ISSUES.map((i, n) => (
          <div key={n} className={`issue ${i.level}`}>
            {icon[i.level]}
            <span>{i.text}</span>
            <span className="where">{i.where}</span>
          </div>
        ))}
      </div>
      <p className="hint">Double-click an issue to jump to it once map data is loaded.</p>
    </DialogFrame>
  );
}

/* ── Find ───────────────────────────────────────────────── */

export function FindDialog({ entry }: DialogProps) {
  const [kind, setKind] = useState("Units");
  const [q, setQ] = useState("");
  const pool = kind === "Units" ? UNIT_GROUPS.flatMap((g) => g.units.map(unitName)) : kind === "Locations" ? SAMPLE_LOCATIONS.map((l) => l.name) : [];
  const results = q ? pool.filter((p) => p.toLowerCase().includes(q.toLowerCase())).slice(0, 50) : [];
  return (
    <DialogFrame dialogKey={entry.key} title="Find" icon={<Search size={14} />} size="sm" okLabel="Go To" footerLeft={<span>{results.length} result(s)</span>}>
      <div className="form wide">
        <Field label="Find in"><Select value={kind} onChange={(e) => setKind(e.target.value)} options={["Units", "Locations", "Sprites", "Strings", "Triggers"]} /></Field>
        <Field label="Search"><TextInput autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, ID or text…" /></Field>
        <Field label="Options"><div className="row wrap"><Check label="Match case" /><Check label="Whole word" /><Check label="Selected only" /></div></Field>
      </div>
      <ListBox items={results} style={{ height: 160 }} empty={q ? "No matches." : "Type to search."} />
    </DialogFrame>
  );
}

/* ── About ──────────────────────────────────────────────── */

export function AboutDialog({ entry }: DialogProps) {
  const close = useSetAtom(closeDialogAtom);
  return (
    <DialogFrame dialogKey={entry.key} title="About SCM JS" icon={<Info size={14} />} size="sm" footer={<Button variant="primary" onClick={() => close(entry.key)}>OK</Button>}>
      <div className="about-hero">
        <div className="about-logo"><span className="brand-mark" style={{ width: 30, height: 30 }} /></div>
        <div>
          <div className="about-title">SCM JS</div>
          <div className="dim">StarCraft / Brood War scenario editor for the browser</div>
          <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Version 0.1.0-alpha · React 19 · TypeScript · Jotai · Canvas</div>
        </div>
      </div>
      <p className="hint">
        Built in homage to <strong>StarEdit</strong> (Blizzard, 1998), <strong>SCMDraft 2</strong> (Suicidal Insanity) and <strong>StarForge</strong> (Heimdal). StarCraft is a trademark of Blizzard Entertainment; this project is not affiliated with or endorsed by Blizzard.
      </p>
      <div className="row" style={{ gap: 6 }}>
        <Button size="sm"><BookOpen size={12} /> Documentation</Button>
        <Button size="sm">Licenses</Button>
        <Button size="sm">Source</Button>
      </div>
    </DialogFrame>
  );
}
