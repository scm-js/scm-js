/**
 * The GitHub Action in action/ (action/README.md): its inputs and outputs as the README lists them, third-party actions
 * pinned by commit, the shell scripts it runs readable by bash, and the workflow `scmjs init` writes using it with
 * inputs it has. The action itself runs in .github/workflows/action-test.yml.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workflowText } from "../cli/src/init";

const root = join(import.meta.dirname, "..");
const action = join(root, "action");
const read = (...p: string[]) => readFileSync(join(...p), "utf8");
const hasBash = spawnSync("bash", ["--version"]).status === 0;
/** js-yaml where node_modules has it (it comes with the tools, not as a dependency of ours): the YAML read as GitHub reads it. */
const yaml = (() => { try { return createRequire(import.meta.url)("js-yaml") as { load(text: string): unknown }; } catch { return null; } })();

/** The keys of a top-level YAML mapping's block (`inputs:`), read by indentation: no YAML parser is a dependency. */
function keysUnder(text: string, block: string): string[] {
  const lines = text.split("\n");
  const at = lines.indexOf(`${block}:`);
  const keys: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (/^\S/.test(l)) break;
    const m = /^ {2}([\w-]+):/.exec(l);
    if (m) keys.push(m[1]);
  }
  return keys;
}

describe("the scmjs action", () => {
  const yml = read(action, "action.yml");
  const readme = read(action, "README.md");
  const inputs = keysUnder(yml, "inputs"), outputs = keysUnder(yml, "outputs");

  it("lists every input and output in its README, and nothing else", () => {
    expect(inputs).toEqual(["version", "install", "maps", "check", "strict", "baseline", "sarif", "diff", "base", "pictures", "comment", "build", "artifact", "token"]);
    expect(outputs).toEqual(["problems", "new_problems", "changed_maps"]);
    const rows = (heading: string) => {
      const part = readme.slice(readme.indexOf(heading));
      return [...part.slice(0, part.indexOf("\n## ", 3)).matchAll(/^\| `([\w-]+)` \|/gm)].map((m) => m[1]);
    };
    expect(rows("## Inputs")).toEqual(inputs);
    expect(rows("## Outputs")).toEqual(outputs);
    // Each output is one run.sh writes.
    const run = read(action, "scripts", "run.sh");
    for (const o of outputs) expect(run).toContain(`out ${o} `);
  });

  it("pins the actions it uses by commit, with the version beside it", () => {
    for (const file of [join(action, "action.yml"), join(root, ".github", "workflows", "action-test.yml")]) {
      const uses = [...read(file).matchAll(/uses: (\S+)(.*)/g)].filter((m) => !m[1].startsWith("./"));
      expect(uses.length).toBeGreaterThan(0);
      for (const [, ref, comment] of uses) expect(`${ref}${comment}`, file).toMatch(/^[\w-]+\/[\w/-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    }
  });

  it.skipIf(!yaml)("is YAML, as are the workflow that tests it and the one scmjs init writes", () => {
    const manifest = yaml!.load(yml) as { inputs: Record<string, { description: string }>; runs: { using: string } };
    expect(Object.keys(manifest.inputs)).toEqual(inputs);
    for (const [k, v] of Object.entries(manifest.inputs)) expect(typeof v.description, k).toBe("string");
    expect(manifest.runs.using).toBe("composite");
    yaml!.load(read(root, ".github", "workflows", "action-test.yml"));
    for (const globs of [["*.scx"], ["maps/*.scm", "maps/*.scx"], ["my maps/*.scx"]]) {
      const w = yaml!.load(workflowText({ version: "1.2.3", globs, scripted: [] })) as { jobs: { maps: { steps: { with?: { maps: string } }[] } } };
      expect(w.jobs.maps.steps[1].with!.maps.trim().split("\n")).toEqual(globs);
    }
  });

  it("runs scripts that are there and that bash reads", () => {
    const named = [...yml.matchAll(/"\$GITHUB_ACTION_PATH\/scripts\/([\w.]+)"/g)].map((m) => m[1]);
    expect(new Set(named)).toEqual(new Set(readdirSync(join(action, "scripts"))));
    if (!hasBash) return;
    for (const f of named) {
      const r = spawnSync("bash", ["-n", join(action, "scripts", f)], { encoding: "utf8" });
      expect(r.status, `${f}: ${r.stderr}`).toBe(0);
    }
  });

  it("is what scmjs init's workflow uses, with inputs the action has", () => {
    const text = workflowText({ version: "1.2.3", globs: ["maps/*.scm", "maps/*.scx"], scripted: ["maps/a.scx"] });
    expect(text).toContain("      - uses: scm-js/scm-js/action@v1.2.3\n");
    const withBlock = text.slice(text.indexOf("        with:\n") + 14).split("\n").filter((l) => /^ {10}[\w-]+:/.test(l)).map((l) => l.trim().split(":")[0]);
    expect(withBlock).toEqual(["version", "maps", "strict", "pictures", "build"]);
    for (const k of withBlock) expect(inputs).toContain(k);
  });
});
