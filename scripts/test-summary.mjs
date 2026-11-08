// CI's job summary for the unit tests: the totals and every suite that skipped, by name, so a green run says
// what it did not cover. CI has no game data, so the terrain, doodad and StarEdit-layout suites always skip
// there; this is where that is written down rather than assumed.
//   node scripts/test-summary.mjs <vitest json report> >> "$GITHUB_STEP_SUMMARY"
import { skippedSuites, testTotals } from "./lib/vitest-report.mjs";

const file = process.argv[2];
const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const totals = file ? testTotals(file) : null;
if (!totals) {
  console.log("### Unit tests\n\nNo report was written (the run stopped before vitest finished).");
  process.exit(0);
}
const lines = ["### Unit tests", "", `${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped, of ${totals.total}.`];
const skipped = skippedSuites(file, root) ?? [];
if (skipped.length) {
  lines.push("", "Skipped (no game data, vendored plugins or network here):", "");
  for (const s of skipped) lines.push(`- \`${s.name}\` (${s.n})`);
}
lines.push("", "Suites guarded with `if (…) describe` are not collected without their files and so are not listed.");
console.log(lines.join("\n"));
