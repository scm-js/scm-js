/**
 * The tests' temporary folder (vitest.config.ts's `globalSetup`): one folder for the run, which every suite's
 * temporary folders — and those of the commands the suites run — are made in, removed when the run ends. Suites make
 * folders freely and need not remove them, and a run leaves nothing in the system's temporary folder.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), "scmjs-tests-"));
  // Read by os.tmpdir() on each call, and inherited by the workers and every process they start.
  for (const name of ["TMPDIR", "TMP", "TEMP"]) process.env[name] = dir;
  return () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}
