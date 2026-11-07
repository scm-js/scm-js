/**
 * `scmjs map check --format github|junit|sarif`: Check Map's findings in the forms CI reads, so a problem shows where
 * the pull request is read rather than in a log — GitHub's workflow annotations, JUnit XML for everything that takes
 * test results, SARIF for code-scanning tools. The text and JSON forms stay in main.ts; these are pure functions of
 * the reports, one per map.
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
