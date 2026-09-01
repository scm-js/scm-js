import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { CircleX, Info, Keyboard, RotateCcw, Search, Settings2, ShieldCheck, TriangleAlert } from "lucide-react";
import { closeDialogAtom, openDialogAtom } from "../../atoms/uiAtoms";
import { activeLayerAtom, centerViewOnAtom, selectedSpritesAtom, selectedUnitsAtom } from "../../atoms/editorAtoms";
import { MAP_SIZES, TILESETS, type TilesetId } from "../../data/tilesets";
import {
  archiveExtrasAtom, doodadsRevisionAtom, locationsRevisionAtom, scenarioAtom, settingsRevisionAtom, triggersRevisionAtom, unitsRevisionAtom,
} from "../../atoms/documentAtoms";
import { DEFAULT_PREFERENCES, preferencesAtom, type Preferences } from "../../atoms/preferencesAtoms";
import { unitName } from "../../data/units";
import { spriteCatalogue } from "../../data/sprites";
import { findInScenario, FIND_KINDS, type FindKind, type FindResult } from "../../editor/find";
import { spriteKind } from "../../editor/sprites";
import { TILE_PX } from "../../editor/units";
import { issueCounts, triggerIssues, validateScenario, type IssueLevel, type IssueTarget } from "../../editor/validate";
import type { SpriteRecord } from "../../formats/chk/sections/objects";
import { useIsomStatus } from "../../hooks/useIsom";
import { useLocationTools } from "../../hooks/useLocationTools";
import { useUnitAssets } from "../../hooks/useUnitAssets";
import { Button, Check, Field, Group, ListBox, Select, Tabs, TextInput } from "../ui";
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
  ["Brush smaller / larger", "[ · ]"],
  ["Nudge selected locations (snap step / 1 px)", "Arrows · Shift+Arrows"],
  ["Delete selection / stop placing, clear selection", "Del · Esc"],
  ["Trigger Editor", "Ctrl+T"],
  ["Text Trigger Editor", "Ctrl+Shift+T"],
  ["Preferences", "Ctrl+,"],
  ["Keyboard shortcuts", "F1"],
  ["Full screen", "F11"],
];

/**
 * Edit ▸ Preferences: persisted in localStorage (atoms/preferencesAtoms.ts). Only
 * settings something reads are listed; the Hotkeys tab is a reference.
 */
export function PreferencesDialog({ entry }: DialogProps) {
  const [prefs, setPrefs] = useAtom(preferencesAtom);
  const [local, setLocal] = useState<Preferences>(prefs);
  const patch = (p: Partial<Preferences>) => setLocal({ ...local, ...p });
  const newMap = (p: Partial<Preferences["newMap"]>) => patch({ newMap: { ...local.newMap, ...p } });
  const apply = () => setPrefs(local);
  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Preferences"
      icon={<Settings2 size={14} />}
      size="lg"
      tall
      showApply
      onOk={apply}
      footerLeft={<Button size="sm" onClick={() => setLocal(DEFAULT_PREFERENCES)}><RotateCcw size={11} /> Reset to defaults</Button>}
    >
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
                    <Check label="Show the splash screen while the game data loads" checked={local.splash} onChange={(e) => patch({ splash: e.target.checked })} />
                  </div>
                  <p className="hint" style={{ marginTop: 4 }}>Off starts straight on the editor; terrain and units fill in as they arrive.</p>
                </Group>
                <Group title="Unsaved changes">
                  <div className="col" style={{ gap: 2 }}>
                    <Check label="Ask before closing or replacing a map with unsaved changes" checked={local.confirmClose} onChange={(e) => patch({ confirmClose: e.target.checked })} />
                  </div>
                  <p className="hint" style={{ marginTop: 4 }}>Applies to File ▸ New, Open, Close and a file dropped on the window.</p>
                </Group>
                <Group title="New scenario defaults">
                  <div className="form wide">
                    <Field label="Tileset"><Select value={local.newMap.tileset} onChange={(e) => newMap({ tileset: e.target.value as TilesetId })} options={TILESETS.map((t) => ({ value: t.id, label: t.name }))} /></Field>
                    <Field label="Size">
                      <div className="row">
                        <Select style={{ width: 90 }} value={String(local.newMap.width)} onChange={(e) => newMap({ width: Number(e.target.value) })} options={MAP_SIZES.map(String)} />
                        <span className="dim">×</span>
                        <Select style={{ width: 90 }} value={String(local.newMap.height)} onChange={(e) => newMap({ height: Number(e.target.value) })} options={MAP_SIZES.map(String)} />
                      </div>
                    </Field>
                  </div>
                  <p className="hint" style={{ marginTop: 4 }}>Also the map the editor opens on.</p>
                </Group>
              </div>
            ),
          },
          {
            value: "display",
            label: "Display",
            content: (
              <div className="stack">
                <Group title="Animation on startup">
                  <div className="col" style={{ gap: 2 }}>
                    <Check label="Animate water (palette cycling)" checked={local.animateWater} onChange={(e) => patch({ animateWater: e.target.checked })} />
                    <Check label="Animate units (idle animations)" checked={local.animateUnits} onChange={(e) => patch({ animateUnits: e.target.checked })} />
                  </div>
                  <p className="hint" style={{ marginTop: 4 }}>The View menu toggles both for the session; this is where they start.</p>
                </Group>
                <Group title="Grid">
                  <p className="hint">The grid's spacing, colour, opacity and style are in View ▸ Grid Settings and are remembered too.</p>
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

const LEVEL_ICON: Record<IssueLevel, ReactNode> = { error: <CircleX size={13} />, warn: <TriangleAlert size={13} />, info: <Info size={13} /> };

/** Where a target lives, so the go-to switches to the right layer. */
type Jump = (target: IssueTarget) => void;

/** Selecting and centring on units / locations / sprites / triggers, shared by Check Map and Find. */
function useJump(closeKey: number): Jump {
  const close = useSetAtom(closeDialogAtom);
  const open = useSetAtom(openDialogAtom);
  const setLayer = useSetAtom(activeLayerAtom);
  const setSelectedUnits = useSetAtom(selectedUnitsAtom);
  const setCenter = useSetAtom(centerViewOnAtom);
  const scenario = useAtomValue(scenarioAtom);
  const locationTools = useLocationTools();
  return (target) => {
    switch (target.kind) {
      case "location":
        locationTools.select([target.index]);
        locationTools.centerOn(target.index);
        setLayer("locations");
        close(closeKey);
        break;
      case "unit": {
        const u = scenario?.units[target.index];
        if (!u) return;
        setSelectedUnits([target.index]);
        setCenter({ x: u.x / TILE_PX, y: u.y / TILE_PX });
        setLayer("units");
        close(closeKey);
        break;
      }
      case "trigger":
        open("triggerEditor", { index: target.index });
        break;
      case "dialog":
        open(target.id);
        break;
    }
  };
}

/**
 * Tools ▸ Check Map (editor/validate.ts). `payload.only === "triggers"` is Triggers ▸
 * Validate Triggers: the same run, filtered to what concerns the trigger list.
 */
export function ValidateMapDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  const extras = useAtomValue(archiveExtrasAtom);
  useAtomValue(settingsRevisionAtom);
  useAtomValue(triggersRevisionAtom);
  useAtomValue(unitsRevisionAtom);
  useAtomValue(locationsRevisionAtom);
  const isom = useIsomStatus();
  const close = useSetAtom(closeDialogAtom);
  const jump = useJump(entry.key);
  const only = entry.payload?.only === "triggers";
  const [show, setShow] = useState<Record<IssueLevel, boolean>>({ error: true, warn: true, info: true });
  const [run, setRun] = useState(0);
  const issues = useMemo(() => {
    void run;
    if (!scenario) return [];
    const all = validateScenario(scenario, { extras, isom });
    return only ? triggerIssues(all) : all;
  }, [scenario, extras, isom, only, run]);
  const counts = issueCounts(issues);
  const listed = issues.filter((i) => show[i.level]);
  const title = only ? "Validate Triggers" : "Check Map";

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={title}
      icon={<ShieldCheck size={14} />}
      size="md"
      tall
      footer={<><Button onClick={() => setRun((n) => n + 1)}>Re-check</Button><Button variant="primary" onClick={() => close(entry.key)}>Close</Button></>}
      footerLeft={<span>{counts.error} error{counts.error === 1 ? "" : "s"} · {counts.warn} warning{counts.warn === 1 ? "" : "s"} · {counts.info} note{counts.info === 1 ? "" : "s"}</span>}
    >
      <div className="row">
        <Check label="Errors" checked={show.error} onChange={(e) => setShow({ ...show, error: e.target.checked })} />
        <Check label="Warnings" checked={show.warn} onChange={(e) => setShow({ ...show, warn: e.target.checked })} />
        <Check label="Notes" checked={show.info} onChange={(e) => setShow({ ...show, info: e.target.checked })} />
        <span className="grow" />
        {only && <span className="hint">triggers, briefings and switches only</span>}
      </div>
      <div className="listbox grow" style={{ minHeight: 200 }}>
        {!scenario && <div className="empty">Open or create a map first.</div>}
        {scenario && listed.length === 0 && <div className="empty">{issues.length === 0 ? "Nothing to report." : "Nothing at the selected levels."}</div>}
        {listed.map((i, n) => (
          <div key={n} className={`issue ${i.level}${i.target ? " jump" : ""}`} onDoubleClick={() => i.target && jump(i.target)} title={i.target ? "Double-click to go there" : undefined}>
            {LEVEL_ICON[i.level]}
            <span>{i.text}</span>
            <span className="where">{i.where}</span>
          </div>
        ))}
      </div>
      <p className="hint">Double-click an issue to go to the unit, location or dialog it is about.</p>
    </DialogFrame>
  );
}

/* ── Find ───────────────────────────────────────────────── */

/** Edit ▸ Find (editor/find.ts): search units, locations, sprites, strings or triggers; Go To selects and centres. */
export function FindDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(unitsRevisionAtom);
  useAtomValue(doodadsRevisionAtom);
  useAtomValue(locationsRevisionAtom);
  useAtomValue(settingsRevisionAtom);
  useAtomValue(triggersRevisionAtom);
  const { loaded: assets } = useUnitAssets();
  const open = useSetAtom(openDialogAtom);
  const close = useSetAtom(closeDialogAtom);
  const setLayer = useSetAtom(activeLayerAtom);
  const setSelectedSprites = useSetAtom(selectedSpritesAtom);
  const setCenter = useSetAtom(centerViewOnAtom);
  const jump = useJump(entry.key);
  const [kind, setKind] = useState<FindKind>("units");
  const [q, setQ] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const catalogue = useMemo(() => (assets ? spriteCatalogue(assets) : null), [assets]);
  const results = useMemo(() => {
    if (!scenario) return [];
    const spriteName = (r: SpriteRecord) => {
      if (spriteKind(r) === "unit") return unitName(r.spriteId);
      return catalogue?.entries[r.spriteId]?.label ?? `Sprite #${r.spriteId}`;
    };
    return findInScenario(scenario, { kind, query: q, matchCase, spriteName });
  }, [scenario, kind, q, matchCase, catalogue]);

  const goTo = (r: FindResult) => {
    switch (r.kind) {
      case "units": jump({ kind: "unit", index: r.index }); break;
      case "locations": jump({ kind: "location", index: r.index }); break;
      case "triggers": jump({ kind: "trigger", index: r.index }); break;
      case "strings": open("stringEditor", { index: r.index }); break;
      case "sprites":
        setSelectedSprites([r.index]);
        if (r.x !== undefined && r.y !== undefined) setCenter({ x: r.x, y: r.y });
        setLayer("sprites");
        close(entry.key);
        break;
    }
  };
  const current = sel !== null ? results[sel] : undefined;

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Find"
      icon={<Search size={14} />}
      size="sm"
      footer={<><Button variant="primary" disabled={!current} onClick={() => current && goTo(current)}>Go To</Button><Button onClick={() => close(entry.key)}>Close</Button></>}
      footerLeft={<span>{q ? `${results.length} result${results.length === 1 ? "" : "s"}` : "Type to search"}</span>}
    >
      <div className="form wide">
        <Field label="Find in"><Select value={kind} onChange={(e) => { setKind(e.target.value as FindKind); setSel(null); }} options={FIND_KINDS} /></Field>
        <Field label="Search"><TextInput autoFocus value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder={kind === "units" ? "Unit name, id or 'player 3'…" : kind === "triggers" ? "Text in a trigger, or its number…" : "Name, number or text…"} onKeyDown={(e) => { if (e.key === "Enter" && results[0]) goTo(results[sel ?? 0]); }} /></Field>
        <Field label="Options"><div className="row wrap"><Check label="Match case" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /></div></Field>
      </div>
      <ListBox
        items={results}
        selected={sel}
        onSelect={(i) => setSel(i)}
        style={{ height: 200 }}
        empty={!scenario ? "Open or create a map first." : q ? "No matches." : "Type to search."}
        render={(r) => <><span className="idx">{r.kind === "triggers" || r.kind === "locations" || r.kind === "strings" ? r.index + (r.kind === "triggers" ? 1 : 0) : r.index}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span><span className="faint" style={{ marginLeft: "auto", paddingLeft: 8, whiteSpace: "nowrap" }}>{r.detail}</span></>}
      />
      <p className="hint">Double-click or Go To selects the result on the map and switches to its layer.</p>
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
