// Reading vitest's JSON report (`--reporter=json --outputFile.json=…`): which suites skipped. Shared by
// `npm run verify`'s summary and CI's job summary (scripts/test-summary.mjs), so both name the same suites.
import { readFileSync } from "node:fs";
import { relative } from "node:path";

/**
 * The suites vitest skipped, as `{ name: "file › describe", n }`, or null when the report cannot be read.
 * A suite that skips with `describe.skipIf` is listed; one guarded by `if (have) describe(…)` is never
 * collected and so is not — say those separately.
 */
export function skippedSuites(file, root) {
  let report;
  try { report = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
  const suites = new Map();
  for (const f of report.testResults ?? []) {
    for (const a of f.assertionResults ?? []) {
      if (a.status === "passed" || a.status === "failed") continue;
      const key = `${relative(root, f.name).replaceAll("\\", "/")} › ${a.ancestorTitles?.[0] ?? "(top level)"}`;
      suites.set(key, (suites.get(key) ?? 0) + 1);
    }
  }
  return [...suites].map(([name, n]) => ({ name, n }));
}

/** The report's totals: `{ passed, failed, skipped, total }`, or null. */
export function testTotals(file) {
  try {
    const r = JSON.parse(readFileSync(file, "utf8"));
    return { passed: r.numPassedTests, failed: r.numFailedTests, skipped: r.numPendingTests + r.numTodoTests, total: r.numTotalTests };
  } catch {
    return null;
  }
}
