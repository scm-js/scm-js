/** `scmjs map info` and `scmjs map check`: a map as the editor reads it, its statistics and Check Map's findings. */
import { MAP_VERSIONS, mapVersionOf, scenarioDescription, scenarioName } from "../../src/formats/chk/scenario";
import { mapStatistics, type MapStatistics } from "../../src/editor/statistics";
import { issueCounts, validateScenario, type Issue } from "../../src/editor/validate";
import type { OpenedMap } from "../../src/editor/mapFile";
import type { Input } from "./files";
import { dot, gameLines, gameText, mark, num, pc, plural, rows, size, table, visible } from "./ui";

/** Slots that hold no one: Inactive and Unused. */
const EMPTY_SLOT = new Set([0, 4]);

export interface MapReport {
  file: { name: string; bytes: number; archive: boolean; scenario: { compression: string; bytes: number } | null };
  name: string;
  description: string;
  version: string;
  width: number;
  height: number;
  tileset: string;
  statistics: MapStatistics;
  issues: Issue[];
  builtBy: string[];
  /** The player slots (0–7) someone holds or that have units or a start location. */
  usedSlots: number[];
  /** `map info` only: whether the map keeps a TrigScript script (`map build` builds it); null when this build cannot tell. */
  script?: boolean | null;
}

export function mapReport(input: Input, doc: OpenedMap): MapReport {
  const scn = doc.scenario;
  const statistics = mapStatistics(scn, null, null, null);
  return {
    file: { name: input.name, bytes: input.bytes.length, archive: !!doc.origin, scenario: doc.origin ? { compression: doc.origin.compression, bytes: doc.origin.size } : null },
    name: scenarioName(scn) ?? "", description: scenarioDescription(scn) ?? "",
    version: MAP_VERSIONS[mapVersionOf(scn.fileVersion)].label,
    width: scn.width, height: scn.height, tileset: statistics.tileset,
    statistics,
    issues: validateScenario(scn, { extras: doc.extras }),
    builtBy: (doc.builtBy ?? []).map((b) => b.label),
    usedSlots: statistics.players.filter((p) => p.slot < 8 && (!EMPTY_SLOT.has(scn.playerTypes[p.slot] ?? 0) || p.units || p.startLocations)).map((p) => p.slot),
  };
}

/** One line for the issues: none, or how many of each. */
export function issueLine(issues: Issue[]): string {
  const n = issueCounts(issues);
  if (!n.error && !n.warn) return `${mark.ok} ${pc.green("no problems")}`;
  return [n.error && `${mark.error} ${pc.red(plural(n.error, "error"))}`, n.warn && `${mark.warn} ${pc.yellow(plural(n.warn, "warning"))}`].filter(Boolean).join("  ");
}

export function printMapInfo(r: MapReport): string[] {
  const s = r.statistics;
  const players = s.players.filter((p) => r.usedSlots.includes(p.slot));
  const neutral = s.players.slice(8).reduce((n, p) => n + p.units, 0);
  const triggers = s.triggers.count ? `${num(s.triggers.count)}${pc.dim(` (${num(s.triggers.conditions)} conditions, ${num(s.triggers.actions)} actions)`)}` : "none";
  const out: (string | null)[] = [
    pc.bold(gameText(r.name) || pc.italic("Untitled")),
    r.description ? pc.dim(gameLines(r.description).split("\n").map((l) => wrap(l, 76)).join("\n")) : null,
    "",
    ...rows([
      ["Map", `${r.width} × ${r.height}${dot}${r.tileset}${dot}${r.version}`],
      ["File", `${r.file.name}${dot}${size(r.file.bytes)}${r.file.archive ? "" : `${dot}bare scenario.chk`}`],
      ["Players", `${plural(players.length, "slot")} used${dot}${plural(players.reduce((n, p) => n + p.startLocations, 0), "start location")}`],
      ["Units", `${num(s.units.total)}${neutral ? pc.dim(` (${num(neutral)} neutral)`) : ""}`],
      ["Resources", s.resources.fields || s.resources.geysers ? `${plural(s.resources.fields, "mineral field")} ${pc.dim(`(${num(s.resources.minerals)})`)}${dot}${plural(s.resources.geysers, "geyser")} ${pc.dim(`(${num(s.resources.gas)})`)}` : "none"],
      ["Triggers", triggers + (s.briefings.count ? `${dot}briefing ${plural(s.briefings.count, "trigger")}` : "")],
      ["Objects", `${plural(s.locations, "location")}${dot}${plural(s.doodads, "doodad")}${dot}${plural(s.sprites.pure + s.sprites.unit, "sprite")}`],
      ["Strings", `${num(s.strings.set)} of ${num(s.strings.slots)}${s.strings.extended ? pc.dim(" (extended)") : ""}${dot}${plural(s.sounds, "sound")}`],
      ["Built by", r.builtBy.length ? r.builtBy.join(", ") : null],
      ["Check", issueLine(r.issues)],
    ]),
  ];
  if (players.length) {
    out.push("", pc.dim("  Players"), ...table(players.map((p) => [
      pc.dim(String(p.slot + 1)), p.type, p.race, pc.dim(plural(p.units, "unit")), p.startLocations ? pc.green("start location") : "",
    ])));
  }
  if (s.units.top.length) {
    const top = s.units.top.slice(0, 5), width = Math.max(...top.map((u) => num(u.count).length));
    out.push("", pc.dim("  Most placed"), ...table(top.map((u) => [pc.dim(`${num(u.count).padStart(width)} ×`), u.name])));
  }
  return out.filter((l): l is string => l !== null);
}

const LEVEL = {
  error: { mark: mark.error },
  warn: { mark: mark.warn },
  info: { mark: mark.info },
} as const;

/** Check Map's findings, worst first, each with where it is. */
export function printIssues(issues: Issue[], all: boolean): string[] {
  const order = { error: 0, warn: 1, info: 2 };
  const shown = issues.filter((i) => all || i.level !== "info").sort((a, b) => order[a.level] - order[b.level]);
  const width = Math.max(40, Math.min(process.stdout.columns || 100, 110) - 6);
  return shown.map((i) => `  ${LEVEL[i.level].mark} ${wrap(`${i.text}${i.where ? dot + pc.dim(i.where) : ""}`, width, 99).split("\n").join("\n    ")}`);
}

function wrap(text: string, width: number, most = 4): string {
  const words = text.split(" "), lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && visible(line + " " + w).length > width) { lines.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.slice(0, most).join("\n") + (lines.length > most ? " …" : "");
}

/** What a check held against a baseline says beside the map's name. */
export interface BaselineCounts { suppressed: number; fixed: number; new: number }

/** The map's line with a baseline: its new findings, then how many were known and how many are fixed since. */
export function baselineLine(fresh: Issue[], b: BaselineCounts): string {
  const n = issueCounts(fresh);
  const head = !n.error && !n.warn ? `${mark.ok} ${pc.green("no new problems")}` : issueLine(fresh).replace(/(errors?|warnings?)/g, "new $1");
  const known = [b.suppressed && `${num(b.suppressed)} known`, b.fixed && pc.green(`${num(b.fixed)} fixed since the baseline`)].filter(Boolean).join(", ");
  return `${head}${known ? pc.dim(dot) + pc.dim(known) : ""}`;
}

/** The map's line when its findings are written as the baseline: how many, and what changed from the one before. */
export function baselineWritten(name: string, b: BaselineCounts & { written?: number }, before: boolean): string {
  const changed = before ? [b.new && `${num(b.new)} new`, b.fixed && `${num(b.fixed)} fixed and dropped`].filter(Boolean).join(", ") : "";
  return `${pc.bold(name)}  ${plural(b.written ?? 0, "finding")} in the baseline${changed ? pc.dim(` (${changed})`) : before ? pc.dim(" (as before)") : ""}`;
}
