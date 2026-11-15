/**
 * Maps in git, as the audit of 0.13.3 found them: `map diff --rev` with a range and with git's three dots, `map log`'s
 * order when commit dates are out of order, a reorder of the triggers in `map diff`, a folder given as a map,
 * locations numbered as triggers number them, and `scmjs init` over a second folder, a folder of folders and maps
 * that fail the check. Repositories are made here in temporary folders from the committed test maps.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openMapBytes } from "../src/editor/mapFile";
import { diffMaps, printDiff, revisionInput } from "../cli/src/diff";
import { mapLog } from "../cli/src/maplog";
import { blameMap } from "../cli/src/blame";
import { exportTriggers, importStrings, importTriggers, writeBack } from "../cli/src/exchange";
import { setHeader } from "../cli/src/edit";
import { initFolder, printInit, withGlobs, workflowGlobs, WORKFLOW_PATH } from "../cli/src/init";
import { CliError, visible } from "../cli/src/ui";
import { testMap } from "./support/maps";

const hasGit = spawnSync("git", ["--version"]).status === 0;
const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-git-audit-"));
const open = async (file: string) => openMapBytes(new Uint8Array(readFileSync(file)), "ridge.scx");
const caught = (fn: () => unknown): CliError => { try { fn(); } catch (e) { if (e instanceof CliError) return e; throw e; } throw new Error("no error"); };

/** A repository with ums.scx as maps/ridge.scx, and a way to commit as of a date. */
function repository() {
  const dir = tmp();
  const file = join(dir, "maps", "ridge.scx");
  mkdirSync(join(dir, "maps"));
  copyFileSync(testMap("ums.scx"), file);
  const git = (...args: string[]) => {
    const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const commit = (subject: string, date: string) => {
    const env = { ...process.env, GIT_AUTHOR_NAME: "A", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "A", GIT_COMMITTER_EMAIL: "a@x", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
    const r = spawnSync("git", ["-C", dir, "commit", "-qam", subject], { encoding: "utf8", env });
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
    return git("rev-parse", "HEAD");
  };
  const edit = async (fn: (doc: Awaited<ReturnType<typeof open>>) => void) => { const doc = await open(file); fn(doc); await writeBack(doc, file, null); };
  git("init", "-q", "-b", "main");
  git("add", "maps/ridge.scx");
  return { dir, file, git, commit, edit };
}

describe.skipIf(!hasGit)("map diff --rev", () => {
  it("refuses a range, which git show reads as nothing", () => {
    const { file, commit } = repository();
    commit("start", "2026-11-01T10:00:00Z");
    const e = caught(() => revisionInput("HEAD~1..HEAD", file));
    expect(e.exitCode).toBe(2);
    expect(e.message).toBe("--rev takes one revision, not a range: HEAD~1..HEAD");
    expect(e.hint).toContain("map log and map blame take ranges");
  });

  it("reads A... as where this branch left A, so the diff is what the branch did", async () => {
    const { file, git, commit, edit } = repository();
    commit("start", "2026-11-01T10:00:00Z");
    git("checkout", "-q", "-b", "side");
    await edit((doc) => setHeader(doc, { name: "Side" }));
    commit("side", "2026-11-02T10:00:00Z");
    git("checkout", "-q", "main");
    await edit((doc) => { importStrings(doc, "s.txt", "3\tRenegades\n"); });
    commit("main", "2026-11-03T10:00:00Z");
    git("checkout", "-q", "side");
    const tip = revisionInput("main", file), base = revisionInput("main...", file);
    const now = { name: "ridge.scx", doc: await open(file) };
    // Against main's tip, main's own change shows as if the branch had undone it.
    expect(diffMaps({ name: tip.name, doc: await openMapBytes(tip.bytes, tip.name) }, now).strings.map((s) => s.a)).toContain("Renegades");
    const d = diffMaps({ name: base.name, doc: await openMapBytes(base.bytes, base.name) }, now);
    expect(d.strings.filter((s) => s.number === 3)).toEqual([]);
    expect(d.header.map((h) => h.field)).toEqual(["Name"]);
    expect(caught(() => revisionInput("nosuch...", file)).exitCode).toBe(2);
  });
});

describe.skipIf(!hasGit)("map log", () => {
  it("lists the commits in git's order, though their dates are out of order", async () => {
    const { dir, file, commit, edit, git } = repository();
    commit("root", "2026-11-10T10:00:00Z");
    writeFileSync(join(dir, "other.txt"), "x\n");
    git("add", "other.txt");
    commit("other", "2026-11-02T10:00:00Z");
    await edit((doc) => setHeader(doc, { name: "Two" }));
    commit("c1", "2026-11-01T10:00:00Z");
    await edit((doc) => setHeader(doc, { name: "Three" }));
    commit("c2", "2026-11-05T10:00:00Z");
    expect((await mapLog(file)).entries.map((e) => e.subject)).toEqual(["c2", "c1", "root"]);
    expect((await mapLog(file, { limit: 2 })).entries.map((e) => e.subject)).toEqual(["c2", "c1"]);
  });

  it("refuses a folder given as a map, in log and blame", async () => {
    const { dir, commit } = repository();
    commit("start", "2026-11-01T10:00:00Z");
    for (const fn of [() => mapLog(join(dir, "maps")), () => blameMap(join(dir, "maps"), ["triggers"])]) {
      const e = await fn().then(() => null, (x: unknown) => x);
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).message).toBe(`${join(dir, "maps")} is a folder, not a map`);
      expect((e as CliError).exitCode).toBe(2);
    }
  });

  it("blames a location by the number triggers give it, from 1", async () => {
    const { file, commit } = repository();
    commit("start", "2026-11-01T10:00:00Z");
    const b = await blameMap(file, ["locations"]);
    const first = b.kinds.locations![0];
    expect(first).toMatchObject({ number: 1, index: 0 });
    expect(first.text.startsWith("#1  ")).toBe(true);
  });
});

describe("map diff's words", () => {
  it("says a reorder of the triggers, in the text and the JSON", async () => {
    const a = await open(testMap("ums.scx")), b = await open(testMap("ums.scx"));
    const SEP = "\n//-----------------------------------------------------------------//\n\n";
    const parts = exportTriggers(b, null).text!.trimEnd().split(SEP);
    [parts[0], parts[1]] = [parts[1], parts[0]];
    importTriggers(b, "t.txt", new TextEncoder().encode(parts.join(SEP) + "\n"));
    const d = diffMaps({ name: "a", doc: a }, { name: "b", doc: b });
    expect(d.same).toBe(false);
    expect(d.triggers).toEqual([]);
    expect(d.triggersReordered).toBe(true);
    const text = printDiff(d).map(visible);
    expect(text).toContain("Triggers reordered");
    expect(text).toContain("  ~ the same triggers in another order");
  });

  it("numbers strings and locations one way: the number, then what changed", async () => {
    const a = await open(testMap("ums.scx")), b = await open(testMap("ums.scx"));
    importStrings(b, "s.txt", "3\tRenamed\n40\tFirst wave.\n");
    const d = diffMaps({ name: "a", doc: a }, { name: "b", doc: b });
    const text = printDiff(d).map(visible);
    expect(text).toContain("  ~ 3  Force 1 → Renamed");
    expect(text).toContain("  + 40  First wave.");
    // A location is shown by the number triggers give it, and the JSON keeps the slot beside it.
    const c = await open(testMap("ums.scx"));
    c.scenario.locations[0] = { ...c.scenario.locations[0], left: c.scenario.locations[0].left + 32 };
    c.scenario.dirty.add("MRGN");
    const moved = diffMaps({ name: "a", doc: a }, { name: "c", doc: c });
    expect(moved.locations[0]).toMatchObject({ change: "changed", text: "0", number: 1, index: 0 });
    expect(printDiff(moved).map(visible).some((l) => l.startsWith("  ~ 1  "))).toBe(true);
  });
});

describe.skipIf(!hasGit)("scmjs init", () => {
  const maps = (dir: string, ...names: string[]) => { mkdirSync(dir, { recursive: true }); for (const n of names) copyFileSync(testMap(n), join(dir, n)); };

  it("adds a second folder to the workflow it wrote, and checks every extension from the start", async () => {
    const root = tmp();
    spawnSync("git", ["-C", root, "init", "-q"]);
    maps(join(root, "maps"), "ums.scx");
    maps(join(root, "more"), "melee.scx");
    await initFolder(join(root, "maps"));
    expect(workflowGlobs(readFileSync(join(root, WORKFLOW_PATH), "utf8"))).toEqual(["maps/*.chk", "maps/*.scm", "maps/*.scx"]);
    const r = await initFolder(join(root, "more"));
    expect(r.files.find((f) => f.path.endsWith("maps.yml"))).toMatchObject({ state: "added" });
    expect(workflowGlobs(readFileSync(join(root, WORKFLOW_PATH), "utf8"))).toEqual(["maps/*.chk", "maps/*.scm", "maps/*.scx", "more/*.chk", "more/*.scm", "more/*.scx"]);
    expect(r.notes.some((n) => n.includes("checks more/ from there"))).toBe(true);
    // One it did not write is left, and what to add is said rather than claimed.
    writeFileSync(join(root, WORKFLOW_PATH), "name: Mine\n");
    maps(join(root, "third"), "melee.scx");
    const mine = await initFolder(join(root, "third"));
    expect(mine.notes.some((n) => n.includes("checks third/"))).toBe(false);
    expect(mine.notes.some((n) => n.includes("add third/*.chk, third/*.scm, third/*.scx"))).toBe(true);
    expect(withGlobs("name: Mine\n", ["x"])).toBeNull();
  });

  it("says when a folder's maps are in the folders below it, and writes nothing", async () => {
    const root = tmp();
    spawnSync("git", ["-C", root, "init", "-q"]);
    maps(join(root, "maps"), "ums.scx");
    const e = await initFolder(root).then(() => null, (x: unknown) => x as CliError);
    expect(e?.exitCode).toBe(2);
    expect(e?.message).toMatch(/has no maps of its own: they are in .*maps/);
    expect(existsSync(join(root, "README.md"))).toBe(false);
    expect((await initFolder(root, { force: true })).maps).toEqual([]);
  });

  it("says what --print would write, not that it wrote it", async () => {
    const dir = tmp();
    maps(dir, "ums.scx");
    const r = await initFolder(dir, { print: true });
    expect(r.files.map((f) => f.state)).toEqual(["would-write", "would-write", "would-write", "would-write"]);
    expect(existsSync(join(dir, "README.md"))).toBe(false);
  });

  it("says which maps fail the check the workflow runs, and how to start from a baseline", async () => {
    const dir = tmp();
    maps(dir, "ums.scx", "original.scm");
    const r = await initFolder(dir);
    const note = r.notes.find((n) => n.includes("--write-baseline"));
    expect(note).toBeDefined();
    expect(note).toContain("original.scm");
    expect(note).not.toContain("ums.scx:");
  });

  it("names the repository from inside it", async () => {
    const root = tmp();
    spawnSync("git", ["-C", root, "init", "-q"]);
    maps(join(root, "maps"), "ums.scx");
    const was = process.cwd();
    try {
      process.chdir(join(root, "maps"));
      const r = await initFolder(".", { print: true });
      expect(visible(printInit(r)[0])).toContain(`in the git repository ${root.split(/[\\/]/).pop()}`);
    } finally { process.chdir(was); }
  });
});
