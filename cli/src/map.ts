/** `scmjs map info` and `scmjs map check`: a map as the editor reads it, its statistics and Check Map's findings. */
import { MAP_VERSIONS, mapVersionOf, scenarioDescription, scenarioName } from "../../src/formats/chk/scenario";
import { mapStatistics, type MapStatistics } from "../../src/editor/statistics";
import { issueCounts, validateScenario, type Issue } from "../../src/editor/validate";
import type { OpenedMap } from "../../src/editor/mapFile";
import type { Input } from "./files";
import { t, translate } from "./i18n";
import { columns, dot, gameLines, gameText, mark, num, pc, rows, size, table } from "./ui";

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

/** One line for the issues: none, or how many of each (`fresh`: the ones a baseline does not hold, "new"). */
export function issueLine(issues: Issue[], fresh = false): string {
  const n = issueCounts(issues);
  if (!n.error && !n.warn) return `${mark.ok} ${pc.green(fresh ? t("no new problems") : t("no problems"))}`;
  const errors = fresh ? t("{n, plural, one {# new error} other {# new errors}}", { n: n.error }) : t("{n, plural, one {# error} other {# errors}}", { n: n.error });
  const warnings = fresh ? t("{n, plural, one {# new warning} other {# new warnings}}", { n: n.warn }) : t("{n, plural, one {# warning} other {# warnings}}", { n: n.warn });
  return [n.error && `${mark.error} ${pc.red(errors)}`, n.warn && `${mark.warn} ${pc.yellow(warnings)}`].filter(Boolean).join("  ");
}

export function printMapInfo(r: MapReport): string[] {
  const s = r.statistics;
  const players = s.players.filter((p) => r.usedSlots.includes(p.slot));
  const neutral = s.players.slice(8).reduce((n, p) => n + p.units, 0);
  const triggers = s.triggers.count ? `${num(s.triggers.count)}${pc.dim(` ${t("({conditions} conditions, {actions} actions)", { conditions: num(s.triggers.conditions), actions: num(s.triggers.actions) })}`)}` : t("none");
  const out: (string | null)[] = [
    pc.bold(gameText(r.name) || pc.italic(t("Untitled"))),
    r.description ? pc.dim(gameLines(r.description).split("\n").map((l) => wrap(l, 76)).join("\n")) : null,
    "",
    ...rows([
      [t("Map"), `${r.width} × ${r.height}${dot}${translate(r.tileset)}${dot}${translate(r.version)}`],
      [t("File"), `${r.file.name}${dot}${size(r.file.bytes)}${r.file.archive ? "" : `${dot}${t("bare scenario.chk")}`}`],
      [t("Players"), `${t("{n, plural, one {# slot} other {# slots}} used", { n: players.length })}${dot}${t("{n, plural, one {# start location} other {# start locations}}", { n: players.reduce((n, p) => n + p.startLocations, 0) })}`],
      [t("Units"), `${num(s.units.total)}${neutral ? pc.dim(` ${t("({n} neutral)", { n: num(neutral) })}`) : ""}`],
      [t("Resources"), s.resources.fields || s.resources.geysers ? `${t("{n, plural, one {# mineral field} other {# mineral fields}}", { n: s.resources.fields })} ${pc.dim(`(${num(s.resources.minerals)})`)}${dot}${t("{n, plural, one {# geyser} other {# geysers}}", { n: s.resources.geysers })} ${pc.dim(`(${num(s.resources.gas)})`)}` : t("none")],
      [t("Triggers"), triggers + (s.briefings.count ? `${dot}${t("briefing {n, plural, one {# trigger} other {# triggers}}", { n: s.briefings.count })}` : "")],
      [t("Objects"), `${t("{n, plural, one {# location} other {# locations}}", { n: s.locations })}${dot}${t("{n, plural, one {# doodad} other {# doodads}}", { n: s.doodads })}${dot}${t("{n, plural, one {# sprite} other {# sprites}}", { n: s.sprites.pure + s.sprites.unit })}`],
      [t("Strings"), `${t("{set} of {slots}", { set: num(s.strings.set), slots: num(s.strings.slots) })}${s.strings.extended ? pc.dim(` ${t("(extended)")}`) : ""}${dot}${t("{n, plural, one {# sound} other {# sounds}}", { n: s.sounds })}`],
      [t("Built by"), r.builtBy.length ? r.builtBy.join(", ") : null],
      [t("Check"), issueLine(r.issues)],
    ]),
  ];
  if (players.length) {
    out.push("", pc.dim(`  ${t("Players")}`), ...table(players.map((p) => [
      pc.dim(String(p.slot + 1)), translate(p.type), translate(p.race), pc.dim(t("{n, plural, one {# unit} other {# units}}", { n: p.units })), p.startLocations ? pc.green(t("start location")) : "",
    ])));
  }
  if (s.units.top.length) {
    const top = s.units.top.slice(0, 5), width = Math.max(...top.map((u) => num(u.count).length));
    out.push("", pc.dim(`  ${t("Most placed")}`), ...table(top.map((u) => [pc.dim(`${num(u.count).padStart(width)} ×`), translate(u.name)])));
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
  return shown.map((i) => `  ${LEVEL[i.level].mark} ${wrap(`${i.text}${i.where ? dot + pc.dim(translate(i.where)) : ""}`, width, 99).split("\n").join("\n    ")}`);
}

function wrap(text: string, width: number, most = 4): string {
  const words = text.split(" "), lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && columns(line + " " + w) > width) { lines.push(line); line = w; }
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
  const head = !n.error && !n.warn ? `${mark.ok} ${pc.green(t("no new problems"))}` : issueLine(fresh, true);
  const known = [b.suppressed && t("{n} known", { n: num(b.suppressed) }), b.fixed && pc.green(t("{n} fixed since the baseline", { n: num(b.fixed) }))].filter(Boolean).join(", ");
  return `${head}${known ? pc.dim(dot) + pc.dim(known) : ""}`;
}

/** The map's line when its findings are written as the baseline: how many, and what changed from the one before. */
export function baselineWritten(name: string, b: BaselineCounts & { written?: number }, before: boolean): string {
  const changed = before ? [b.new && t("{n} new", { n: num(b.new) }), b.fixed && t("{n} fixed and dropped", { n: num(b.fixed) })].filter(Boolean).join(", ") : "";
  return `${pc.bold(name)}  ${t("{n, plural, one {# finding} other {# findings}} in the baseline", { n: b.written ?? 0 })}${changed ? pc.dim(` (${changed})`) : before ? pc.dim(` ${t("(as before)")}`) : ""}`;
}
