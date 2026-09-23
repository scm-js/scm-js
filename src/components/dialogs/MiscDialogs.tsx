import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  CircleX,
  Info,
  Keyboard,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { closeDialogAtom, openDialogAtom } from "../../atoms/uiAtoms";
import {
  activeLayerAtom,
  centerViewOnAtom,
  selectedDoodadsAtom,
  selectedSpritesAtom,
  selectedUnitsAtom,
} from "../../atoms/editorAtoms";
import { peekTileset } from "../../formats/tileset/load";
import { desktopBridge } from "../../gamedata/desktop";
import { hostTerms } from "../../editor/platform";
import { APP_VERSION } from "../../version";
import { tilesetFileNameAtom } from "../../atoms/documentAtoms";
import { doodadLabel } from "../../hooks/useDoodadTools";
import { msg, t, translate } from "../../i18n";
import {
  archiveExtrasAtom,
  doodadsRevisionAtom,
  locationsRevisionAtom,
  scenarioAtom,
  settingsRevisionAtom,
  triggersRevisionAtom,
  unitsRevisionAtom,
} from "../../atoms/documentAtoms";
import { unitLabel } from "../../data/units";
import { spriteCatalogue } from "../../data/sprites";
import {
  findInScenario,
  FIND_KINDS,
  type FindKind,
  type FindResult,
} from "../../editor/find";
import { spriteKind } from "../../editor/sprites";
import { TILE_PX } from "../../editor/units";
import {
  issueCounts,
  triggerIssues,
  validateScenario,
  type IssueLevel,
  type IssueTarget,
} from "../../editor/validate";
import type {
  DoodadRecord,
  SpriteRecord,
} from "../../formats/chk/sections/objects";
import { useIsomStatus } from "../../hooks/useIsom";
import { useLocationTools } from "../../hooks/useLocationTools";
import { useUnitAssets } from "../../hooks/useUnitAssets";
import {
  Button,
  Check,
  Field,
  ListBox,
  Select,
  TextInput,
} from "../ui";
import WireSphere from "../ui/WireSphere";
import { drawNebula, drawStars, generateStars } from "../splash/starfield";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";
import { HOTKEYS } from "./hotkeys";

/* ── Shortcuts ──────────────────────────────────────────── */

export function ShortcutsDialog({ entry }: DialogProps) {
  const close = useSetAtom(closeDialogAtom);
  return (
    <DialogFrame
      dialogKey={entry.key}
      title={t("Keyboard Shortcuts")}
      icon={<Keyboard size={14} />}
      size="md"
      footer={
        <Button variant="primary" onClick={() => close(entry.key)}>
          {t("Close")}
        </Button>
      }
    >
      <div className="listbox hotkeys" style={{ maxHeight: 420 }}>
        <table className="table">
          <tbody>
            {HOTKEYS.map(([cmd, keys]) => (
              <tr key={cmd}>
                <td>{translate(cmd)}</td>
                <td style={{ textAlign: "right" }}>
                  {keys.split(" · ").map((k) => (
                    <span key={k} className="kbd">
                      {k}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DialogFrame>
  );
}

/* ── Validate Map ───────────────────────────────────────── */

const LEVEL_ICON: Record<IssueLevel, ReactNode> = {
  error: <CircleX size={13} />,
  warn: <TriangleAlert size={13} />,
  info: <Info size={13} />,
};

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
        close(closeKey);
        break;
      case "dialog":
        open(target.id);
        close(closeKey);
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
  const [show, setShow] = useState<Record<IssueLevel, boolean>>({
    error: true,
    warn: true,
    info: true,
  });
  const [run, setRun] = useState(0);
  const issues = useMemo(() => {
    void run;
    if (!scenario) return [];
    const all = validateScenario(scenario, { extras, isom });
    return only ? triggerIssues(all) : all;
  }, [scenario, extras, isom, only, run]);
  const counts = issueCounts(issues);
  const listed = issues.filter((i) => show[i.level]);
  const title = only ? t("Validate Triggers") : t("Check Map");

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={title}
      icon={<ShieldCheck size={14} />}
      size="md"
      tall
      footer={
        <>
          <Button onClick={() => setRun((n) => n + 1)}>{t("Re-check")}</Button>
          <Button variant="primary" onClick={() => close(entry.key)}>
            {t("Close")}
          </Button>
        </>
      }
      footerLeft={
        <span>
          {t("{error} error", { error: counts.error })}{counts.error === 1 ? "" : "s"} · {counts.warn}{" "}
          {t("warning")}{counts.warn === 1 ? "" : "s"} {" "}{t("· {info} note", { info: counts.info })}
          {counts.info === 1 ? "" : "s"}
        </span>
      }
    >
      <div className="row">
        <Check
          label={t("Errors")}
          checked={show.error}
          onChange={(e) => setShow({ ...show, error: e.target.checked })}
        />
        <Check
          label={t("Warnings")}
          checked={show.warn}
          onChange={(e) => setShow({ ...show, warn: e.target.checked })}
        />
        <Check
          label={t("Notes")}
          checked={show.info}
          onChange={(e) => setShow({ ...show, info: e.target.checked })}
        />
        <span className="grow" />
        {only && (
          <span className="hint">{t("triggers, briefings and switches only")}</span>
        )}
      </div>
      <div className="listbox grow" style={{ minHeight: 200 }}>
        {!scenario && <div className="empty">{t("Open or create a map first.")}</div>}
        {scenario && listed.length === 0 && (
          <div className="empty">
            {issues.length === 0 ? t("Nothing to report.") : t("Nothing at the selected levels.")}
          </div>
        )}
        {listed.map((i, n) => (
          <div
            key={n}
            className={`issue ${i.level}${i.target ? " jump" : ""}`}
            onDoubleClick={() => i.target && jump(i.target)}
            title={i.target ? t("Double-click to go there") : undefined}
          >
            {LEVEL_ICON[i.level]}
            <span>{i.text}</span>
            <span className="where">{translate(i.where)}</span>
          </div>
        ))}
      </div>
      <p className="hint">
        {t("Double-click an issue to go to the unit, location or dialog it is about.")}
      </p>
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
  const setSelectedDoodads = useSetAtom(selectedDoodadsAtom);
  const setCenter = useSetAtom(centerViewOnAtom);
  const tilesetName = useAtomValue(tilesetFileNameAtom);
  const jump = useJump(entry.key);
  const [kind, setKind] = useState<FindKind>("units");
  const [q, setQ] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const catalogue = useMemo(
    () => (assets ? spriteCatalogue(assets) : null),
    [assets],
  );
  const results = useMemo(() => {
    if (!scenario) return [];
    const spriteName = (r: SpriteRecord) => {
      if (spriteKind(r) === "unit") return unitLabel(r.spriteId);
      return catalogue?.entries[r.spriteId]?.label ?? `Sprite #${r.spriteId}`;
    };
    const doodads = peekTileset(tilesetName)?.doodads;
    const doodadName = (d: DoodadRecord) => {
      const def = doodads?.byId.get(d.doodadId);
      return def ? doodadLabel(def) : `Doodad #${d.doodadId}`;
    };
    return findInScenario(scenario, {
      kind,
      query: q,
      matchCase,
      spriteName,
      doodadName,
    });
  }, [scenario, kind, q, matchCase, catalogue, tilesetName]);

  const goTo = (r: FindResult) => {
    switch (r.kind) {
      case "units":
        jump({ kind: "unit", index: r.index });
        break;
      case "locations":
        jump({ kind: "location", index: r.index });
        break;
      case "triggers":
        jump({ kind: "trigger", index: r.index });
        break;
      case "briefing":
        open("missionBriefing", { index: r.index });
        close(entry.key);
        break;
      case "strings":
        open("stringEditor", { index: r.index });
        close(entry.key);
        break;
      case "sprites":
        setSelectedSprites([r.index]);
        if (r.x !== undefined && r.y !== undefined)
          setCenter({ x: r.x, y: r.y });
        setLayer("sprites");
        close(entry.key);
        break;
      case "doodads":
        setSelectedDoodads([r.index]);
        if (r.x !== undefined && r.y !== undefined)
          setCenter({ x: r.x, y: r.y });
        setLayer("doodads");
        close(entry.key);
        break;
    }
  };
  const current = sel !== null ? results[sel] : undefined;

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={t("Find")}
      icon={<Search size={14} />}
      size="sm"
      footer={
        <>
          <Button
            variant="primary"
            disabled={!current}
            onClick={() => current && goTo(current)}
          >
            {t("Go To")}
          </Button>
          <Button onClick={() => close(entry.key)}>{t("Close")}</Button>
        </>
      }
      footerLeft={
        <span>
          {q ? t("{length, plural, one {# result} other {# results}}", { length: results.length }) : t("Type to search")}
        </span>
      }
    >
      <div className="form wide">
        <Field label={t("Find in")}>
          <Select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as FindKind);
              setSel(null);
            }}
            options={FIND_KINDS}
          />
        </Field>
        <Field label={t("Search")}>
          <TextInput
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(null);
            }}
            placeholder={
              kind === "units" ? t("Unit name, id or 'player 3'…") : kind === "triggers" ? t("Text in a trigger, or its number…") : t("Name, number or text…")
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) goTo(results[sel ?? 0]);
            }}
          />
        </Field>
        <Field label={t("Options")}>
          <div className="row wrap">
            <Check
              label={t("Match case")}
              checked={matchCase}
              onChange={(e) => setMatchCase(e.target.checked)}
            />
          </div>
        </Field>
      </div>
      <ListBox
        items={results}
        selected={sel}
        onSelect={(i) => setSel(i)}
        style={{ height: 200 }}
        empty={
          !scenario ? t("Open or create a map first.") : q ? t("No matches.") : t("Type to search.")
        }
        render={(r) => (
          <>
            <span className="idx">
              {r.kind === "triggers" || r.kind === "briefing"
                ? r.index + 1
                : r.index}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {r.label}
            </span>
            <span
              className="faint"
              style={{
                marginLeft: "auto",
                paddingLeft: 8,
                whiteSpace: "nowrap",
              }}
            >
              {r.detail}
            </span>
          </>
        )}
      />
      <p className="hint">
        {t("Double-click or Go To selects the result on the map and switches to its layer.")}
      </p>
    </DialogFrame>
  );
}

/* ── About ──────────────────────────────────────────────── */

const STACK = [
  ["React 19 · TypeScript", msg("the UI; tsc is the type check, oxlint the linter")],
  ["Jotai", msg("every piece of editor state; no context layering")],
  ["Vite 8 · Vitest", msg("dev server, bundler and the test runner")],
  ["Radix UI · lucide-react", msg("dialog and menu primitives, icons")],
  ["Canvas 2D", msg("terrain atlas, sprites, minimap, splash, this background")],
  ["mopaq", "MPQ read and write, PKWARE included, for .scm / .scx"],
  ["Web Workers", msg("the MPQ extraction, and TypeScript for plugin files")],
  [
    "OPFS · IndexedDB · localStorage",
    msg("extracted graphics, file handles, preferences"),
  ],
  [
    "File System Access",
    msg("open and save in place; picker and download fallbacks"),
  ],
  ["Web Audio", msg("imported sounds converted to formats the game reads")],
  ["DecompressionStream", msg("the zip reader, over HTTP range requests")],
  ["Electron · electron-builder", msg("the desktop build")],
];

export function AboutDialog({ entry }: DialogProps) {
  const close = useSetAtom(closeDialogAtom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projectPage = (path: string) =>
    window.open(
      `https://github.com/scm-js/scm-js${path}`,
      "_blank",
      "noopener,noreferrer",
    );

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
      const cw = canvas.clientWidth,
        ch = canvas.clientHeight;
      if (cw && ch) {
        const w = Math.round(cw * devicePixelRatio),
          h = Math.round(ch * devicePixelRatio);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
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
    <DialogFrame
      dialogKey={entry.key}
      title={t("About scmJS")}
      icon={<Info size={14} />}
      size="md"
      tall
      footer={
        <Button variant="primary" onClick={() => close(entry.key)}>
          {t("OK")}
        </Button>
      }
    >
      <div className="about-space">
        <canvas ref={canvasRef} className="about-canvas" />
        <div className="about-content">
          <WireSphere size={104} className="about-logo" />
          <h2 className="about-app-name">
            scm<span>JS</span>
          </h2>
          <div>
            {desktopBridge()
              ? `${desktopBridge()!.platform} · ${APP_VERSION}`
              : APP_VERSION}
          </div>
          {/* <div className="about-tagline">
            StarCraft · Brood War · Remastered
          </div> */}
          <div className="about-desc">{t("Starcraft 1 Map Editor")}</div>
          <div className="about-rule" />
          <div className="about-meta">
            {t("By Jeany")}{" "}<i>{t("(aka MindArchon)")}</i>
          </div>
        </div>
      </div>

      <div className="about-group">
        <h3>{t("Acknowledgements")}</h3>
        <div className="what" style={{ color: "#ffffff" }}>
          {t("Over the course of thirty years, we've gone from hacking custom versions of StarEdit to understanding the inner workings of the game, the map file format, and creating sophisticated tools through a dedicated community effort.")}
        </div>

        {/* {CREDITS.map((group) => (
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
          ))} */}
        {/* <section className="about-group about-thanks">
          <h3>Special thanks</h3>
          <ul>
            {THANKS.map((t) => (
              <li key={t.who}>
                <span className="who">{t.who}</span>
                <span className="what">{t.what}</span>
              </li>
            ))}
          </ul>
        </section> */}
      </div>

      <div
        className="about-group"
        style={{ fontWeight: 600, color: "#ff5fa2" }}
      >
        {t("Special thanks (in no particular order)")}
      </div>
      <div className="about-group">
        <div
          className="what"
          style={{ color: "#ffffff", paddingBottom: "10px" }}
        >
          <h4>{t("Clan Unknown")}</h4>
          <div className="about-what">
            {t("Unknown pushed map making to its absolute limit, inspiring map makers to really see what was possible. Thanks to")}{" "}<b>{t("Bolt_Head")}</b>,{" "}
            <b>{t("Kenoli")}</b>, <b>{t("SwaP")}</b>, <b>{t("Shmidley")}</b>, <b>{t("PickleWeezle")}</b> {" "}{t("and everyone else for keeping the clan alive and active.")}
          </div>
        </div>

        <div className="what" style={{ color: "#ffffff" }}>
          <h4>{t("Staredit.net")}</h4>
          <div className="about-what">
            {t("Our map making hub. Thanks to")}{" "}<b>{t("LegacyWeapon")}</b>, <b>{t("YoshiDaSnipa")}</b>,{" "}
            <b>{t("Shadowflare")}</b>, <b>{t("Heimdal")}</b> {" "}{t("for showing us we can make our own editor,")}{" "}<b>{t("Suicidal Insanity")}</b> {" "}{t("for creating SCMDraft and blowing us all away,")}{" "}<b>{t("Clokr_")}</b> {" "}{t("for their tools,")}{" "}<b>{t("jjf28")}</b> {" "}{t("for finally reverse engineering the sections we didn't understand,")}{" "}
            <b>{t("Heinermann")}</b> {" "}{t("for their technical knowledge,")}{" "}<b>{t("poiuy_qwert")}</b>{" "}
            {t("for their modding tools,")}{" "}<b>{t("Ladislav Zezula")}</b> {" "}{t("for StormLib and showing us we can edit MPQs, and")}{" "}<b>{t("FaRTy1billion")}</b>, <b>{t("rockz")}</b>,{" "}
            <b>{t("yoonkwun")}</b>, <b>{t("trgk")}</b>{t(", and")}{" "}<b>{t("Armoha")}</b> {" "}{t("for their work on EUDs and modern tooling.")}
          </div>
        </div>
      </div>

      <div>
        {t("And of course,")}{" "}<b>{t("Quetz")}</b>{t(", for putting up with me ❤️.")}
      </div>

      <details className="about-details">
        <summary>{t("Under the hood")}</summary>
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
            {t("Reads and writes real")}{" "}<code>.scm</code> / <code>.scx</code>{" "}
            {t("archives. CHK sections the editor does not model are copied back byte for byte, and so are archive members it has no use for, so a map only loses what you deliberately change.")}
          </p>
          <p>
            {t("Terrain and units are drawn from the game's own files. None of Blizzard's data is redistributed here: the editor extracts it from an installed copy of Brood War, or from the free StarEdit download Blizzard still serves, and keeps the result in {here}", { here: hostTerms().here })}{" "}
            {t("for next time.")}
          </p>
          <p>
            {t("There is no server behind any of this — the web build is static files on GitHub Pages, and the one service it talks to is a Cloudflare Worker that adds a CORS header to Blizzard's download. Plugins are fetched from their repositories, compiled in a worker if they are TypeScript, and run with the page's own privileges; there is no sandbox around them.")}
          </p>
          <p>
            {t("The isometric terrain brush is a port of Chkdraft's reverse-engineering of StarEdit (MIT). Palette-cycling tables and tileset names come from Chkdraft as well.")}
          </p>
          <div className="about-links">
            <button
              className="about-link"
              onClick={() => window.open("https://docs.scmjs.dev", "_blank", "noopener,noreferrer")}
            >
              {t("Docs")}
            </button>
            <button
              className="about-link"
              onClick={() => projectPage("/blob/main/ATTRIBUTION.md")}
            >
              {t("Attribution")}
            </button>
            <button className="about-link" onClick={() => projectPage("")}>
              {t("Source")}
            </button>
          </div>
        </div>
      </details>

      <p className="about-disclaimer">
        {t("StarCraft is a trademark of Blizzard Entertainment. Not affiliated with or endorsed by Blizzard.")}
      </p>
    </DialogFrame>
  );
}
