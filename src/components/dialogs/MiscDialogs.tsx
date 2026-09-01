import { useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { CircleX, Info, Keyboard, Search, Settings2, ShieldCheck, TriangleAlert } from "lucide-react";
import { closeDialogAtom } from "../../atoms/uiAtoms";
import { TILESETS } from "../../data/tilesets";
import { locationsAtom } from "../../atoms/documentAtoms";
import { UNIT_GROUPS, unitName } from "../../data/units";
import { Button, Check, Field, Group, ListBox, NumberInput, Select, Tabs, TextInput } from "../ui";
import WireSphere from "../ui/WireSphere";
import { drawNebula, drawStars, generateStars } from "../splash/starfield";
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
  ["Nudge selected locations (snap step / 1 px)", "Arrows · Shift+Arrows"],
  ["Delete selection / clear selection", "Del · Esc"],
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
  const locations = useAtomValue(locationsAtom);
  const pool = kind === "Units" ? UNIT_GROUPS.flatMap((g) => g.units.map(unitName)) : kind === "Locations" ? locations.map((l) => `${l.name} (slot ${l.index})`) : [];
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

/**
 * The credits roll. This editor is a homage, and the people below are the reason there is anything
 * to pay homage to: they reverse-engineered the file formats, wrote the editors, and documented the
 * results on staredit.net over twenty-odd years. Descriptions are deliberately plain-English —
 * what someone is remembered for, not a changelog.
 */
interface CreditGroup {
  title: string;
  note?: string;
  people: { who: string; real?: string; what: string }[];
}

const CREDITS: CreditGroup[] = [
  {
    title: "The editors",
    people: [
      {
        who: "Heimdal",
        real: "Jonathan Cable",
        what: "StarForge (2003) — the first editor that simply ignored StarEdit's rules. Freehand terrain brushes, map protection, half-built buildings, and a generation of mappers who found out the format was theirs to bend.",
      },
      {
        who: "Suicidal Insanity",
        real: "Henrik Arlinghaus",
        what: "SCMDraft 2, begun weeks after StarForge shipped and first released in March 2004. Still the editor everything else is measured against — and still being updated, twenty years on, for Remastered.",
      },
      {
        who: "jjf28",
        real: "TheNitesWhoSay",
        what: "Chkdraft — an open-source editor, and a standalone write-up of StarCraft's isometric terrain that finally made ISOM something other people could implement. This editor's ISOM brush is descended from it.",
      },
      {
        who: "Heinermann",
        what: "BWAPI and ChkForge. The person the rest of the scene asked when a question came down to what StarCraft actually does with its own memory.",
      },
      {
        who: "poiuy_qwert",
        what: "PyMS — sixteen cross-platform tools covering very nearly every file the game ships: PyGRP for graphics, PyICE for animation scripts, PyDAT, PyBIN, PyAI. Modding on a Mac exists because of this.",
      },
    ],
  },
  {
    title: "The archive",
    note: "Everything above had to get inside an MPQ first.",
    people: [
      {
        who: "Quantam",
        what: "MPQDraft, and the Inside MoPaQ write-up that documented the archive format everyone else then implemented — including this editor.",
      },
      {
        who: "ShadowFlare",
        what: "WinMPQ and SFmpqapi. For most of a decade, if a StarCraft tool could open an MPQ, this is what it was calling.",
      },
      {
        who: "Ladislav Zezula",
        real: "Ladik",
        what: "StormLib and MPQ Editor — still the reference implementation, still maintained.",
      },
    ],
  },
  {
    title: "The EUD scene",
    note:
      "No single person gets credit for finding them. In July 2005 the community worked out that a Set Deaths trigger " +
      "with an out-of-range unit id reads and writes StarCraft's own memory, and the map format quietly became a " +
      "programming environment. Blizzard patched it out in 1.13b and 1.13f — then, in Remastered 1.21, emulated the " +
      "overflow so the maps would run again.",
    people: [
      {
        who: "FaRTy1billion",
        what: "EUDDB, EUDTrig, the EUD Action Enabler, the String Chunk Calculator, and the first EUD drop-ban. Catalogued the addresses so everyone else did not have to.",
      },
      {
        who: "rockz",
        what: "The UMS Assistance answers that explained EUDs in language a mapmaker could actually act on. Half the scene learned it from these posts.",
      },
      {
        who: "yoonkwun",
        what: "The EUD Reference; detecting player chat text and unit facing from inside a map, which nobody thought triggers could do.",
      },
      {
        who: "trgk",
        real: "phu54321",
        what: "eudplib and euddraft — EUD map-making as an actual programming language, with epScript on top. The break between hand-placed triggers and compiled ones.",
      },
      {
        who: "Armoha",
        what: "Keeps eudplib and euddraft alive and current on Remastered, which is why EUD maps are still being made rather than just remembered.",
      },
    ],
  },
  {
    title: "The Network",
    note: "staredit.net itself — six versions of a forum that outlived most of the games it was about.",
    people: [
      {
        who: "Clokr_",
        what: "Reverse-engineered the map parsing behind SEN's download database, so the site could read the maps it was hosting.",
      },
      {
        who: "Kenoli",
        what: "Ran (U)nknown Productions alongside Esponeo and MindArchon — a clan operated as a workshop for mapmakers rather than a team, and hard enough to get into that people remember being intimidated by it.",
      },
      {
        who: "Hamma · DevliN · Excalibur · Forsaken Archer · NudeRaider · Roy · Jamal · Beer_KeG · DavidJcobb",
        what: "Built it, skinned it, moderated it, and paid the hosting bill.",
      },
    ],
  },
];

const THANKS = [
  { who: "Quetz", what: "who puts up with all of this." },
  { who: "Clan (U) Unknown", what: "(U)nknown Productions — for keeping the scene worth being part of." },
];

const STACK = [
  ["React 19 + TypeScript", "UI, strict build via tsc"],
  ["Vite 8", "dev server and bundler"],
  ["Jotai", "all editor state; no context layering"],
  ["Radix UI · lucide-react", "dialog primitives and icons"],
  ["mopaq", "MPQ archive read/write for .scm / .scx"],
  ["Canvas 2D", "terrain atlas, sprites, minimap, this dialog's background"],
  ["Vitest · oxlint", "tests and linting"],
];

export function AboutDialog({ entry }: DialogProps) {
  const close = useSetAtom(closeDialogAtom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projectPage = (path: string) => window.open(`https://github.com/jeany55/scm-js${path}`, "_blank", "noopener,noreferrer");

  // Same drifting nebula and starfield the splash screen paints, at dialog scale.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const stars = generateStars(70);
    let raf = 0;
    let start = 0;
    const frame = (t: number) => {
      if (!start) start = t;
      const el = t - start;
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (cw && ch) {
        const w = Math.round(cw * devicePixelRatio), h = Math.round(ch * devicePixelRatio);
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        drawNebula(ctx, cw, ch, el);
        drawStars(ctx, cw, ch, el, stars);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <DialogFrame dialogKey={entry.key} title="About scmJS" icon={<Info size={14} />} size="md" tall footer={<Button variant="primary" onClick={() => close(entry.key)}>OK</Button>}>
      <div className="about-space">
        <canvas ref={canvasRef} className="about-canvas" />
        <div className="about-content">
          <WireSphere size={104} className="about-logo" />
          <h2 className="about-app-name">scm<span>JS</span></h2>
          <div className="about-tagline">StarCraft · Brood War</div>
          <div className="about-rule" />
          <div className="about-meta">v0.1 alpha · by Jeany</div>
          <div className="about-desc">A browser-based scenario editor</div>
          <p className="about-homage">
            In homage to <strong>StarEdit</strong>, <strong>StarForge</strong> and <strong>SCMDraft 2</strong> — and to the
            people of <strong>staredit.net</strong>, who spent twenty years taking this game apart to see how it worked.
          </p>
        </div>
      </div>

      <div className="about-credits">
        {CREDITS.map((group) => (
          <section key={group.title} className="about-group">
            <h3>{group.title}</h3>
            {group.note && <p className="about-note">{group.note}</p>}
            <ul>
              {group.people.map((p) => (
                <li key={p.who}>
                  <span className="who">
                    {p.who}
                    {p.real && <em> · {p.real}</em>}
                  </span>
                  <span className="what">{p.what}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="about-group about-thanks">
          <h3>Special thanks</h3>
          <ul>
            {THANKS.map((t) => (
              <li key={t.who}>
                <span className="who">{t.who}</span>
                <span className="what">{t.what}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <details className="about-details">
        <summary>Under the hood</summary>
        <div className="about-details-body">
          <dl className="about-stack">
            {STACK.map(([name, note]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{note}</dd>
              </div>
            ))}
          </dl>
          <p>
            Reads and writes real <code>.scm</code> / <code>.scx</code> archives. CHK sections the editor does not model are
            copied back byte for byte, so a map survives a round trip through it. Terrain is rendered from the game's own
            tileset files, which are not redistributed — a fresh clone extracts them from an installed copy of Brood War.
          </p>
          <p>
            The isometric terrain brush is a port of Chkdraft's reverse-engineering of StarEdit (MIT). Palette-cycling
            tables and tileset names come from Chkdraft as well.
          </p>
          <div className="about-links">
            <button className="about-link" onClick={() => projectPage("/#readme")}>Docs</button>
            <button className="about-link" onClick={() => projectPage("/blob/main/ATTRIBUTION.md")}>Attribution</button>
            <button className="about-link" onClick={() => projectPage("")}>Source</button>
          </div>
        </div>
      </details>

      <p className="about-disclaimer">
        StarCraft is a trademark of Blizzard Entertainment. Not affiliated with or endorsed by Blizzard.
      </p>
    </DialogFrame>
  );
}
