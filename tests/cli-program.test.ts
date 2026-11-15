/**
 * The `scmjs` program itself (cli/src/main.ts): what a mistake in the command line exits with and says, asking for
 * help in its several ways, the global options in any place, and the last-resort net for a file-system error no
 * command caught. The commands run in-process through `run`, as the built command runs them.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";
import { unknownLanguage } from "../cli/src/i18n";
import { buildProgram, COMMAND_GROUPS, fileProblem, run, similarNames } from "../cli/src/main";
import { visible } from "../cli/src/ui";
import { testMap } from "./support/maps";

/** `scmjs …` as the command runs it: what it wrote where, and its exit code. */
async function scmjs(...args: string[]): Promise<{ out: string; err: string; code: number }> {
  let out = "", err = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation((s) => { out += String(s); return true; });
  const e = vi.spyOn(process.stderr, "write").mockImplementation((s) => { err += String(s); return true; });
  process.exitCode = 0;
  try {
    const program = buildProgram();
    // commander ends the process; here it throws instead, and run() reads the code off what it throws.
    const override = (c: Command): void => { c.exitOverride(); c.commands.forEach(override); };
    override(program);
    await run(args, program);
  } finally { o.mockRestore(); e.mockRestore(); }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return { out: visible(out), err: visible(err), code };
}
afterEach(() => { process.exitCode = 0; });

describe("a mistake in the command line", () => {
  it("exits 2 and names the help of the command it was made on", async () => {
    const cases: [string[], RegExp, string][] = [
      [["map", "info", "--jsno", "x"], /unknown option '--jsno'/, "(scmjs map info --help lists its options)"],
      [["map", "dump"], /missing required argument 'map'/, "(scmjs map dump --help lists its options)"],
      [["map", "dump", "a", "b"], /too many arguments/, "(scmjs map dump --help lists its options)"],
      [["map", "resize", "x"], /required option '--size/, "(scmjs map resize --help lists its options)"],
      [["--lang", "xx", "about"], /--lang/, "(scmjs --help lists the commands)"],
      [["map", "log", "x", "--rev"], /needs a value/, "(scmjs map log --help lists its options)"],
      [["map", "test", "x", "--clips-format", "mp4"], /does not take 'mp4'/, "(scmjs map test --help lists its options)"],
      [["completion"], /missing required argument 'shell'/, "(scmjs completion --help lists its options)"],
      [["map", "bogus"], /unknown command 'bogus'/, "(scmjs map --help lists its commands)"],
    ];
    for (const [args, said, hint] of cases) {
      const r = await scmjs(...args);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.err, args.join(" ")).toMatch(said);
      expect(r.err, args.join(" ")).toContain(hint);
      expect(r.out, args.join(" ")).toBe("");
    }
  });

  it("suggests the hidden commands the guide documents too", async () => {
    const r = await scmjs("abuot");
    expect(r.code).toBe(2);
    expect(r.err).toContain("(Did you mean about?)");
    expect(similarNames("lps", ["lsp", "map", "mod"])).toEqual(["lsp"]);
    expect(similarNames("zzzz", ["map", "mod"])).toEqual([]);
  });

  it("takes -v as the version only before a command; --lang and --no-color go anywhere", async () => {
    const version = await scmjs("-v");
    expect(version.code).toBe(0);
    expect(version.out).toMatch(/^\d+\.\d+\.\d+/);
    const late = await scmjs("map", "check", testMap("ums.scx"), "-v");
    expect(late.code).toBe(2);
    expect(late.err).toContain("unknown option '-v'");
    const anywhere = await scmjs("map", "info", testMap("ums.scx"), "--lang", "en", "--no-color", "--json");
    expect(anywhere.code).toBe(0);
    expect(JSON.parse(anywhere.out).file.name).toBe("ums.scx");
    expect((await scmjs("map", "info", testMap("ums.scx"), "--lang", "fr")).code).toBe(2);
  });

  it("says once that SCMJS_LANG names a language it does not speak", () => {
    expect(unknownLanguage(["about"], { SCMJS_LANG: "fr" })).toBe("fr");
    expect(unknownLanguage(["about"], { SCMJS_LANG: "ko-KR" })).toBeNull();
    expect(unknownLanguage(["--lang", "en", "about"], { SCMJS_LANG: "fr" })).toBeNull();
    expect(unknownLanguage(["about"], {})).toBeNull();
  });
});

describe("asking for help", () => {
  it("prints it on standard output with 0 for a noun or a global option alone", async () => {
    for (const args of [[], ["--lang", "en"], ["--no-color"], ["map"], ["map", "triggers"], ["plugin"], ["replay"], ["mod"], ["bot"], ["help"]]) {
      const r = await scmjs(...args);
      expect(r.code, args.join(" ")).toBe(0);
      expect(r.err, args.join(" ")).toBe("");
      expect(r.out, args.join(" ")).toMatch(args.length && args[0] !== "help" && !args[0].startsWith("--") ? /^Usage: scmjs / : /scmJS on the command line/);
    }
  });

  it("takes the whole path after help, at the top or under a noun, and says an unknown one", async () => {
    expect((await scmjs("help", "map", "diff")).out).toMatch(/^Usage: scmjs map diff /);
    expect((await scmjs("map", "help", "diff")).out).toMatch(/^Usage: scmjs map diff /);
    expect((await scmjs("help", "map", "test", "record")).out).toMatch(/^Usage: scmjs map test record /);
    for (const args of [["help", "nosuch"], ["help", "map", "nosuch"], ["map", "help", "nosuch"]]) {
      const r = await scmjs(...args);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.err).toContain("unknown command 'nosuch'");
      expect(r.out).toBe("");
    }
  });

  it("groups a noun's commands by task, every map command in one group", () => {
    const program = buildProgram();
    for (const noun of ["map", "mod"]) {
      const cmd = program.commands.find((c) => c.name() === noun)!;
      const shown = cmd.commands.filter((c) => !(c as unknown as { _hidden?: boolean })._hidden);
      const named = COMMAND_GROUPS[noun].flatMap(([, names]) => names);
      expect(new Set(named).size, noun).toBe(named.length);
      for (const c of shown) expect(named, `${noun} ${c.name()} is in no group of COMMAND_GROUPS`).toContain(c.name());
      for (const c of shown) expect(c.helpGroup(), c.name()).not.toBe("");
    }
    const help = visible(program.commands.find((c) => c.name() === "map")!.helpInformation());
    const headings = COMMAND_GROUPS.map.map(([h]) => help.indexOf(`\n${h}\n`));
    expect(headings.every((at) => at > 0)).toBe(true);
    expect([...headings].sort((a, b) => a - b)).toEqual(headings);
    // A command with commands of its own that runs by itself too shows its own usage.
    expect(help).toMatch(/\n {2}test <map> \[tests\.\.\.\] /);
  });
});

describe("a file-system error no command caught", () => {
  it("is one line naming the path, exit 2, no stack", () => {
    const err = (code: string, path?: string) => Object.assign(new Error(`${code}: something`), { code, path });
    expect(fileProblem(err("ENOENT", "maps/a.scx"))?.message).toBe("No such file or folder: maps/a.scx");
    expect(fileProblem(err("EISDIR", "maps"))?.message).toBe("maps is a folder, not a file");
    expect(fileProblem(err("EISDIR"))?.message).toBe("A folder was given where a file is wanted");
    expect(fileProblem(err("EACCES", "/root/x"))?.exitCode).toBe(2);
    expect(fileProblem(err("ENOSPC", "out.scx"))?.exitCode).toBe(1);
    expect(fileProblem(Object.assign(new Error("wrapped"), { cause: err("ENOTDIR", "a/b") }))?.message).toContain("a/b is not a folder");
    expect(fileProblem(new Error("a bug"))).toBeNull();
    expect(fileProblem(err("ECONNREFUSED"))).toBeNull();
  });

  it("is said that way when a command meets it, with the stack only under SCMJS_DEBUG", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scmjs-program-"));
    const missing = join(dir, "nope.scx");
    const program = buildProgram().exitOverride();
    program.command("boom").action(() => { readFileSync(missing); });
    let err = "";
    const e = vi.spyOn(process.stderr, "write").mockImplementation((s) => { err += String(s); return true; });
    try {
      await run(["boom"], program);
      expect(visible(err)).toBe(`✖ No such file or folder: ${missing}\n`);
      expect(process.exitCode).toBe(2);
      err = "";
      vi.stubEnv("SCMJS_DEBUG", "1");
      await run(["boom"], program);
      expect(err).toMatch(/\n\s+at /);
    } finally { e.mockRestore(); vi.unstubAllEnvs(); }
  });
});
