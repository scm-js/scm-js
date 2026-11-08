/**
 * `scmjs init` (cli/src/init.ts): a folder of maps set up for git and GitHub. Each test copies the committed maps in
 * tests/maps into a temporary folder; the git ones make a repository there and skip where git is missing.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openMapBytes, writeMapBytes } from "../src/editor/mapFile";
import { VERSION } from "../cli/src/about";
import { ATTRIBUTE_LINES, GIT_SETTINGS, IGNORE_LINES, initFolder, mapGlobs, missingLines, printInit, printRecipe, readmeText, TYPESCRIPT, WORKFLOW_PATH, workflowText } from "../cli/src/init";
import { program } from "../cli/src/main";
import { CliError, visible } from "../cli/src/ui";
import { TEST_MAPS_DIR as mapsDir } from "./support/maps";

const MAPS = readdirSync(mapsDir).filter((f) => /\.(scx|scm|chk)$/i.test(f)).sort();

/** A temporary folder holding a copy of the committed maps (in `sub`, when given). */
function folder(sub = ""): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), "scmjs-init-"));
  const dir = join(root, sub);
  mkdirSync(dir, { recursive: true });
  for (const f of MAPS) copyFileSync(join(mapsDir, f), join(dir, f));
  return { root, dir };
}
const read = (...p: string[]) => readFileSync(join(...p), "utf8");
const hasGit = spawnSync("git", ["--version"]).status === 0;
const git = (dir: string, ...args: string[]) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
/** The vendored TrigScript plugin (`npm run vendor:plugins`), which tells a map with a script. */
const haveTrigScript = existsSync(join(import.meta.dirname, "..", "plugins", "trigscript", "script.ts"));

describe("scmjs init", () => {
  it("writes the four files into a folder of maps, and says so", async () => {
    const { dir } = folder();
    const r = await initFolder(dir);
    expect(r.repository).toBeNull();
    expect(r.maps.map((m) => m.file)).toEqual(MAPS);
    expect(r.files.map((f) => f.state)).toEqual(["written", "written", "written", "written"]);
    for (const line of ATTRIBUTE_LINES) expect(read(dir, ".gitattributes").split("\n")).toContain(line);
    expect(read(dir, ".gitignore").split("\n")).toContain("*.bak");
    const workflow = read(dir, WORKFLOW_PATH);
    // The scmjs action, pinned with the command to this version, over the folder's maps.
    expect(workflow).toContain(`      - uses: scm-js/scm-js/action@v${VERSION}\n        with:\n          version: ${VERSION}\n          maps: |\n            *.scm\n            *.scx\n          strict: true\n          pictures: true\n`);
    expect(workflow).toContain("  pull-requests: write");
    expect(workflow).toMatch(/^on:\n {2}push:\n {2}pull_request:$/m);
    const readme = read(dir, "README.md");
    for (const m of r.maps) expect(readme).toContain(`| ${m.name} | [${m.file}](${m.file}) | ${m.width} × ${m.height} | ${m.tileset} | ${m.players} |`);
    for (const c of ["scmjs map check *.scm *.scx --strict", "scmjs map dump hybrid.scm", "scmjs map diff --rev HEAD hybrid.scm"]) expect(readme).toContain(c);
    // No repository: the git settings are not made, and the note says what to do.
    expect(r.git.every((g) => g.state === "none")).toBe(true);
    const text = printInit(r).map(visible);
    expect(text[0]).toMatch(/· 5 maps · not in a git repository$/);
    expect(text.some((l) => /✔ README\.md +written: lists the 5 maps/.test(l))).toBe(true);
    expect(text.some((l) => l.includes("Not in a git repository"))).toBe(true);
  });

  it("writes nothing over what is there, a second time or ever without --force", async () => {
    const { dir } = folder();
    writeFileSync(join(dir, "README.md"), "# Mine\n");
    writeFileSync(join(dir, ".gitattributes"), "*.png binary\n*.scm diff=mine");
    await initFolder(dir);
    expect(read(dir, "README.md")).toBe("# Mine\n");
    // The lines it lacked, at the end; a pattern with its own diff driver is left as it is (its merge driver is not one).
    expect(read(dir, ".gitattributes")).toBe("*.png binary\n*.scm diff=mine\n\n# Maps show in git diff as text (scmjs map dump) and git merge merges them (scmjs map merge); scmjs init sets the git config\n*.scx diff=scmjs\n*.chk diff=scmjs\n*.scx merge=scmjs\n*.scm merge=scmjs\n*.chk merge=scmjs\n");
    const before = Object.fromEntries([".gitattributes", ".gitignore", WORKFLOW_PATH, "README.md"].map((f) => [f, read(dir, f)]));
    const again = await initFolder(dir);
    expect(again.files.map((f) => f.state)).toEqual(["kept", "kept", "kept", "kept"]);
    for (const [f, text] of Object.entries(before)) expect(read(dir, f), f).toBe(text);
    const forced = await initFolder(dir, { force: true });
    expect(forced.files.map((f) => f.state)).toEqual(["kept", "kept", "replaced", "replaced"]);
    expect(read(dir, "README.md")).toContain("| Test Melee |");
  });

  it("prints the recipe with --print, and writes nothing", async () => {
    const { dir } = folder();
    const r = await initFolder(dir, { print: true });
    expect(readdirSync(dir).sort()).toEqual(MAPS);
    const text = printRecipe(r);
    for (const line of [...ATTRIBUTE_LINES, ...IGNORE_LINES, 'git config diff.scmjs.textconv "scmjs map dump"', 'git config diff.scmjs.xfuncname "^## .*"', "git config diff.scmjs.cachetextconv true", 'git config merge.scmjs.driver "scmjs map merge %O %A %B --out %A --name %P"', "name: Maps", "| Test Scenario |"]) expect(text).toContain(line);
  });

  it("says there is no such folder, with exit code 2", async () => {
    const missing = join(tmpdir(), "scmjs-init-nowhere", "maps");
    await expect(initFolder(missing)).rejects.toThrow(CliError);
    await expect(initFolder(missing)).rejects.toMatchObject({ exitCode: 2 });
    const file = join(folder().dir, MAPS[0]);
    await expect(initFolder(file)).rejects.toMatchObject({ exitCode: 2, message: expect.stringMatching(/is a file/) });
  });

  it("keeps the workflow's maps, TypeScript and lines as they should be", () => {
    expect(mapGlobs("", ["a.scx", "b.SCM", "c.scx"])).toEqual(["*.SCM", "*.scx"]);
    expect(mapGlobs("maps", ["a.scx"])).toEqual(["maps/*.scx"]);
    expect(mapGlobs("my maps", ["a.scx"])).toEqual(["'my maps/'*.scx"]);
    expect(mapGlobs("", [])).toEqual(["*.scx"]);
    expect(mapGlobs("my maps", ["a.scx"], false)).toEqual(["my maps/*.scx"]);
    const scripted = workflowText({ version: "1.2.3", globs: ["*.scx"], scripted: ["maps/(2)Ridge.scx"] });
    // One glob is on the line, quoted since a plain YAML value may not start with `*`.
    expect(scripted).toContain('          maps: "*.scx"\n');
    expect(scripted).toMatch(/^ {10}build: true$/m);
    expect(workflowText({ version: "1.2.3", globs: ["maps/*.scx"], scripted: [] })).toMatch(/^ {10}maps: maps\/\*\.scx\n[^]*^ {10}# build: true$/m);
    // The TypeScript the action installs for the build is the major the compiler is built with.
    const major = String(JSON.parse(read(import.meta.dirname, "..", "package.json")).dependencies?.typescript ?? JSON.parse(read(import.meta.dirname, "..", "package.json")).devDependencies?.typescript).replace(/^[~^]/, "").split(".")[0];
    expect(TYPESCRIPT).toBe(`typescript@${major}`);
    for (const f of ["install.sh", "run.sh"]) expect(read(import.meta.dirname, "..", "action", "scripts", f)).toContain(` ${TYPESCRIPT}`);
    expect(missingLines("*.scx   diff=scmjs\n", ATTRIBUTE_LINES, true)).toEqual(["*.scm diff=scmjs", "*.chk diff=scmjs", "*.scx merge=scmjs", "*.scm merge=scmjs", "*.chk merge=scmjs"]);
    expect(missingLines("# *.bak\n", IGNORE_LINES)).toEqual(["*.bak", "*.tests/"]);
    expect(missingLines("*.bak\n", IGNORE_LINES)).toEqual(["*.tests/"]);
    // map test needs a copy of the game, which GitHub's runners have not got: a note, not a step.
    expect(workflowText({ version: "1.2.3", globs: ["*.scx"], scripted: [] })).toContain("      # - run: scmjs map test <map> --format github --clips");
    expect(readmeText("Maps", [{ file: "(2)a|b.scx", name: "A\x03|B", width: 64, height: 96, tileset: "Ice", players: 2, script: false }])).toContain("| A\\|B | [(2)a\\|b.scx](%282%29a%7Cb.scx) | 64 × 96 | Ice | 2 |");
  });

  it("is in the command list, under Maps and replays", () => {
    const init = program.commands.find((c) => c.name() === "init");
    expect(init).toBeDefined();
    expect((init as unknown as { _hidden?: boolean })._hidden).toBeFalsy();
    expect(init!.helpGroup()).toBe("Maps and replays:");
    expect(init!.options.map((o) => o.long)).toEqual(["--json", "--print", "--git", "--force"]);
  });

  it.skipIf(!haveTrigScript)("builds the maps that keep a TrigScript script in the workflow", async () => {
    const { dir } = folder();
    const doc = await openMapBytes(new Uint8Array(readFileSync(join(dir, "ums.scx"))), "ums.scx");
    doc.extras.set("trigscript\\main.ts", new TextEncoder().encode("// nothing yet\n"));
    writeFileSync(join(dir, "ums.scx"), await writeMapBytes(doc.scenario, { format: "scx", extras: doc.extras }));
    const r = await initFolder(dir);
    expect(r.maps.filter((m) => m.script).map((m) => m.file)).toEqual(["ums.scx"]);
    expect(read(dir, WORKFLOW_PATH)).toMatch(/^ {10}build: true$/m);
  });
});

describe.skipIf(!hasGit)("scmjs init in a git repository", () => {
  it("sets the git settings in the repository, and leaves another value alone", async () => {
    const { dir } = folder();
    git(dir, "init", "-q");
    git(dir, "config", "diff.scmjs.xfuncname", "^## "); // the 0.9.0 recipe's, replaced as the command's own
    git(dir, "config", "diff.scmjs.cachetextconv", "false"); // someone's own, left alone
    const r = await initFolder(dir);
    expect(r.repository).toBe(r.folder);
    expect(r.git.map((g) => g.state)).toEqual(["set", "set", "other", "set", "set"]);
    for (const [key, value] of GIT_SETTINGS.slice(0, 2)) expect(git(dir, "config", "--get", key).stdout).toBe(`${value}\n`);
    expect(git(dir, "config", "--get", "diff.scmjs.cachetextconv").stdout).toBe("false\n");
    expect(printInit(r).map(visible).some((l) => /▲ git config diff\.scmjs\.cachetextconv +left alone: it is "false"/.test(l))).toBe(true);
    expect(printInit(r).map(visible).some((l) => /✔ git config merge\.scmjs +set: name, driver$/.test(l))).toBe(true);
    expect((await initFolder(dir, { force: true })).git.map((g) => g.state)).toEqual(["kept", "kept", "set", "kept", "kept"]);
    expect((await initFolder(dir)).git.map((g) => g.state)).toEqual(["kept", "kept", "kept", "kept", "kept"]);
  });

  it("puts the workflow at the repository's top, checking the folder's maps from there", async () => {
    const { root, dir } = folder("maps");
    git(root, "init", "-q");
    const r = await initFolder(dir);
    expect(existsSync(join(root, WORKFLOW_PATH))).toBe(true);
    expect(existsSync(join(dir, ".github"))).toBe(false);
    expect(read(root, WORKFLOW_PATH)).toContain("          maps: |\n            maps/*.scm\n            maps/*.scx\n");
    expect(existsSync(join(dir, ".gitattributes")) && existsSync(join(dir, "README.md"))).toBe(true);
    expect(r.notes.some((n) => n.includes("repository's top"))).toBe(true);
  });

  it("runs git init only when asked with --git", async () => {
    const { dir } = folder();
    await initFolder(dir);
    expect(existsSync(join(dir, ".git"))).toBe(false);
    const r = await initFolder(dir, { git: true });
    expect(r.created).toBe(true);
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(git(dir, "config", "--get", "diff.scmjs.textconv").stdout).toBe("scmjs map dump\n");
  });
});
