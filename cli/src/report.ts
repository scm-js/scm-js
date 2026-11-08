/**
 * `scmjs map check --format github|junit|sarif`: Check Map's findings in the forms CI reads, so a problem shows where
 * the pull request is read rather than in a log — GitHub's workflow annotations, JUnit XML for everything that takes
 * test results, SARIF for code-scanning tools. `scmjs map test` gives its scenarios in the same three forms. The text
 * and JSON forms stay in main.ts; these are pure functions of the reports, one per map.
 */
import { relative } from "node:path";
import type { Issue, IssueLevel } from "../../src/editor/validate";

export const FORMATS = ["text", "json", "github", "junit", "sarif"] as const;
export type Format = (typeof FORMATS)[number];

/** One map's check, as `map check` collects it: the path as given, the map's name and the findings kept. */
export interface CheckReport { file: string; name: string; issues: Issue[]; failed: boolean }

/** A path for a report: relative to the working directory, forward slashes, as CI tools match files. */
export const reportPath = (file: string) => relative(process.cwd(), file).split("\\").join("/") || file;

/** A GitHub Actions workflow command: `::error file=…,title=…::message`, escaped as the runner wants. */
function annotation(kind: "error" | "warning" | "notice", props: Record<string, string>, message: string): string {
  const data = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const prop = (s: string) => data(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  const list = Object.entries(props).filter(([, v]) => v).map(([k, v]) => `${k}=${prop(v)}`).join(",");
  return `::${kind}${list ? ` ${list}` : ""}::${data(message)}`;
}

const GITHUB_KIND: Record<IssueLevel, "error" | "warning" | "notice"> = { error: "error", warn: "warning", info: "notice" };

/** One annotation per finding; GitHub shows them on the pull request's Files and in the job's summary. */
export function githubAnnotations(reports: CheckReport[]): string[] {
  return reports.flatMap((r) => r.issues.map((i) => annotation(GITHUB_KIND[i.level], { file: reportPath(r.file), title: `${r.name || r.file}${i.where ? ` · ${i.where}` : ""}` }, i.text)));
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const LEVEL_WORD: Record<IssueLevel, string> = { error: "error", warn: "warning", info: "note" };

/** JUnit XML: one test case per map, failed when the check failed it, every finding in the case's output. */
export function junitXml(reports: CheckReport[]): string {
  const failures = reports.filter((r) => r.failed).length;
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`, `<testsuites name="scmjs map check" tests="${reports.length}" failures="${failures}">`, `  <testsuite name="scmjs map check" tests="${reports.length}" failures="${failures}">`];
  for (const r of reports) {
    const lines = r.issues.map((i) => `${LEVEL_WORD[i.level]}: ${i.text}${i.where ? ` (${i.where})` : ""}`);
    out.push(`    <testcase name="${xml(r.name || reportPath(r.file))}" classname="${xml(reportPath(r.file))}" file="${xml(reportPath(r.file))}">`);
    if (r.failed) {
      const n = (level: IssueLevel) => r.issues.filter((i) => i.level === level).length;
      const summary = [n("error") && `${n("error")} error${n("error") === 1 ? "" : "s"}`, n("warn") && `${n("warn")} warning${n("warn") === 1 ? "" : "s"}`].filter(Boolean).join(", ");
      out.push(`      <failure message="${xml(summary)}">${xml(lines.join("\n"))}</failure>`);
    } else if (lines.length) out.push(`      <system-out>${xml(lines.join("\n"))}</system-out>`);
    out.push(`    </testcase>`);
  }
  out.push(`  </testsuite>`, `</testsuites>`, "");
  return out.join("\n");
}

const SARIF_LEVEL: Record<IssueLevel, "error" | "warning" | "note"> = { error: "error", warn: "warning", info: "note" };
const ruleId = (where: string) => `scmjs/${(where || "map").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

/** SARIF 2.1.0: a rule per area of the check (Players, Triggers, …), a result per finding, located at the map file. */
export function sarifJson(reports: CheckReport[], version: string): string {
  const rules = new Map<string, string>();
  const results = reports.flatMap((r) => r.issues.map((i) => {
    const id = ruleId(i.where);
    rules.set(id, i.where || "Map");
    return { ruleId: id, level: SARIF_LEVEL[i.level], message: { text: i.text }, locations: [{ physicalLocation: { artifactLocation: { uri: reportPath(r.file), uriBaseId: "%SRCROOT%" } } }] };
  }));
  const log = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0",
    runs: [{
      tool: { driver: { name: "scmjs map check", version, informationUri: "https://docs.scmjs.dev/cli/", rules: [...rules].map(([id, name]) => ({ id, name, shortDescription: { text: `Check Map: ${name}` } })) } },
      results,
    }],
  };
  return JSON.stringify(log, null, 2) + "\n";
}

/* ── `scmjs map test`'s results in the same forms ──────────── */

/** One scenario of `map test`, as the formats need it: where it is written, and what did not hold. */
export interface TestCaseReport {
  name: string;
  /** The tests file and the line the scenario's name is on. */
  file: string;
  line: number | null;
  ok: boolean;
  ms: number;
  failures: { kind: string; what: string; actual: string }[];
  /** The replay kept of a scenario that failed. */
  replay: string | null;
  /** The clip of its game `--clips` made. */
  clip?: string | null;
}
/** A map's test run: the map as given, and its scenarios. */
export interface TestReport { map: string; name: string; cases: TestCaseReport[] }

const failureText = (f: TestCaseReport["failures"][number]) => `${f.what} — ${f.actual}`;
const replayNote = (c: TestCaseReport) => [
  c.replay ? `replay: ${reportPath(c.replay)} (scmjs replay open ${reportPath(c.replay)})` : "",
  c.clip ? `clip: ${reportPath(c.clip)}` : "",
].filter(Boolean).join("\n");

/** An error annotation per expectation that did not hold, on the scenario's line of its tests file. */
export function githubTestAnnotations(reports: TestReport[]): string[] {
  return reports.flatMap((r) => r.cases.flatMap((c) => c.failures.map((f) => annotation("error", { file: reportPath(c.file), line: c.line ? String(c.line) : "", title: `${r.name || reportPath(r.map)} · ${c.name}` }, [failureText(f), replayNote(c)].filter(Boolean).join("\n")))));
}

/** JUnit XML: a test suite per map, a test case per scenario, failed with every expectation that did not hold. */
export function junitTestXml(reports: TestReport[]): string {
  const all = reports.flatMap((r) => r.cases), failures = all.filter((c) => !c.ok).length;
  const time = (ms: number) => (ms / 1000).toFixed(3);
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`, `<testsuites name="scmjs map test" tests="${all.length}" failures="${failures}">`];
  for (const r of reports) {
    const failed = r.cases.filter((c) => !c.ok).length;
    out.push(`  <testsuite name="${xml(r.name || reportPath(r.map))}" tests="${r.cases.length}" failures="${failed}" time="${time(r.cases.reduce((n, c) => n + c.ms, 0))}">`);
    for (const c of r.cases) {
      out.push(`    <testcase name="${xml(c.name)}" classname="${xml(reportPath(r.map))}" file="${xml(reportPath(c.file))}"${c.line ? ` line="${c.line}"` : ""} time="${time(c.ms)}">`);
      if (!c.ok) out.push(`      <failure message="${xml(`${c.failures.length} expectation${c.failures.length === 1 ? "" : "s"} did not hold`)}">${xml([...c.failures.map(failureText), replayNote(c)].filter(Boolean).join("\n"))}</failure>`);
      out.push(`    </testcase>`);
    }
    out.push(`  </testsuite>`);
  }
  out.push(`</testsuites>`, "");
  return out.join("\n");
}

/** SARIF 2.1.0: a rule per kind of expectation, a result per one that did not hold, at the scenario's line. */
export function sarifTestJson(reports: TestReport[], version: string): string {
  const rules = new Set<string>();
  const results = reports.flatMap((r) => r.cases.flatMap((c) => c.failures.map((f) => {
    rules.add(f.kind);
    return {
      ruleId: `scmjs/test-${f.kind}`, level: "error", message: { text: [`${r.name || reportPath(r.map)} · ${c.name}: ${failureText(f)}`, replayNote(c)].filter(Boolean).join("\n") },
      locations: [{ physicalLocation: { artifactLocation: { uri: reportPath(c.file), uriBaseId: "%SRCROOT%" }, ...(c.line ? { region: { startLine: c.line } } : {}) } }],
    };
  })));
  const log = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0",
    runs: [{ tool: { driver: { name: "scmjs map test", version, informationUri: "https://docs.scmjs.dev/cli/", rules: [...rules].map((k) => ({ id: `scmjs/test-${k}`, name: k, shortDescription: { text: `A map test's ${k} expectation` } })) } }, results }],
  };
  return JSON.stringify(log, null, 2) + "\n";
}

/* ── `scmjs map coverage`'s triggers in the same forms ──────── */

/** One trigger of a coverage run, as the formats need it. */
export interface CoverageCase {
  /** The trigger's number, as map trace prints it (1-based). */
  number: number;
  text: string;
  games: number;
  fired: number;
  /** Why it never fired, for one that did not. */
  why: string | null;
}
/** A map's coverage: the map as given, the games counted, the triggers a player in them owned, the games that parted from the map. */
export interface CoverageForm { map: string; name: string; games: number; strict: boolean; cases: CoverageCase[]; parted: { name: string; clock: string }[] }

const neverText = (r: CoverageForm, c: CoverageCase) => `Trigger #${c.number} never fired in ${r.games} game${r.games === 1 ? "" : "s"}: ${c.text}${c.why ? `\n${c.why}` : ""}`;
const partedText = (p: CoverageForm["parted"][number]) => `${p.name} parted from the map at ${p.clock}: what fired after that is not counted`;

/** A warning annotation per trigger that never fired (an error with `--strict`), a notice per game that parted from the map. */
export function githubCoverageAnnotations(reports: CoverageForm[]): string[] {
  return reports.flatMap((r) => [
    ...r.cases.filter((c) => !c.fired).map((c) => annotation(r.strict ? "error" : "warning", { file: reportPath(r.map), title: `${r.name || reportPath(r.map)} · trigger #${c.number}` }, neverText(r, c))),
    ...r.parted.map((p) => annotation("notice", { file: reportPath(r.map), title: `${r.name || reportPath(r.map)} · ${p.name}` }, partedText(p))),
  ]);
}

/** JUnit XML: a test suite per map, a test case per trigger; one that never fired is skipped (failed with `--strict`). */
export function junitCoverageXml(reports: CoverageForm[]): string {
  const all = reports.flatMap((r) => r.cases), never = all.filter((c) => !c.fired).length;
  const strict = reports.some((r) => r.strict);
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`, `<testsuites name="scmjs map coverage" tests="${all.length}" ${strict ? "failures" : "skipped"}="${never}">`];
  for (const r of reports) {
    const n = r.cases.filter((c) => !c.fired).length;
    out.push(`  <testsuite name="${xml(r.name || reportPath(r.map))}" tests="${r.cases.length}" ${r.strict ? "failures" : "skipped"}="${n}">`);
    for (const c of r.cases) {
      const name = xml(`#${c.number} ${c.text}`);
      if (c.fired) { out.push(`    <testcase name="${name}" classname="${xml(reportPath(r.map))}" file="${xml(reportPath(r.map))}"><system-out>${xml(`fired ${c.fired} time${c.fired === 1 ? "" : "s"} in ${c.games} of ${r.games} games`)}</system-out></testcase>`); continue; }
      out.push(`    <testcase name="${name}" classname="${xml(reportPath(r.map))}" file="${xml(reportPath(r.map))}">`);
      out.push(r.strict ? `      <failure message="never fired">${xml(neverText(r, c))}</failure>` : `      <skipped message="${xml(neverText(r, c).split("\n")[0])}"/>`);
      out.push(`    </testcase>`);
    }
    if (r.parted.length) out.push(`    <system-out>${xml(r.parted.map(partedText).join("\n"))}</system-out>`);
    out.push(`  </testsuite>`);
  }
  out.push(`</testsuites>`, "");
  return out.join("\n");
}

/** SARIF 2.1.0: a result per trigger that never fired (a warning, an error with `--strict`), a note per game that parted. */
export function sarifCoverageJson(reports: CoverageForm[], version: string): string {
  const at = (r: CoverageForm) => [{ physicalLocation: { artifactLocation: { uri: reportPath(r.map), uriBaseId: "%SRCROOT%" } } }];
  const results = reports.flatMap((r) => [
    ...r.cases.filter((c) => !c.fired).map((c) => ({ ruleId: "scmjs/coverage-never-fired", level: r.strict ? "error" : "warning", message: { text: `${r.name || reportPath(r.map)}: ${neverText(r, c)}` }, locations: at(r) })),
    ...r.parted.map((p) => ({ ruleId: "scmjs/coverage-parted", level: "note", message: { text: `${r.name || reportPath(r.map)}: ${partedText(p)}` }, locations: at(r) })),
  ]);
  const log = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0",
    runs: [{ tool: { driver: { name: "scmjs map coverage", version, informationUri: "https://docs.scmjs.dev/cli/", rules: [
      { id: "scmjs/coverage-never-fired", name: "never fired", shortDescription: { text: "A trigger a player owned that fired in none of the games" } },
      { id: "scmjs/coverage-parted", name: "parted", shortDescription: { text: "A game whose players' commands parted from the map" } },
    ] } }, results }],
  };
  return JSON.stringify(log, null, 2) + "\n";
}
