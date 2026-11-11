/**
 * The developer commands as the audit of 0.13.3 found them: `plugin new` with a name that makes no id, its folder
 * named with `--out` (`--dir` kept), `plugin check` on an id or version the editor reads otherwise, and `lsp` typed at
 * a terminal. The commands run in-process through `run`, as the built command runs them.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";
import { buildProgram, run } from "../cli/src/main";
import { checkPlugin, editorId, newPlugin } from "../cli/src/plugin";
import { CliError, visible } from "../cli/src/ui";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-plugin-new-"));

async function scmjs(...args: string[]): Promise<{ out: string; err: string; code: number }> {
  let out = "", err = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation((s) => { out += String(s); return true; });
  const e = vi.spyOn(process.stderr, "write").mockImplementation((s) => { err += String(s); return true; });
  process.exitCode = 0;
  try {
    const program = buildProgram();
    const override = (c: Command): void => { c.exitOverride(); c.commands.forEach(override); };
    override(program);
    await run(args, program);
  } finally { o.mockRestore(); e.mockRestore(); }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return { out: visible(out), err: visible(err), code };
}
afterEach(() => { process.exitCode = 0; });

describe("scmjs plugin new", () => {
  it("says when the name makes no id, and takes one with --id", () => {
    const dir = tmp();
    for (const name of ["한글 이름", "!!!"]) {
      const e = (() => { try { newPlugin({ name, dir: join(dir, "x") }); } catch (x) { return x as CliError; } return null; })();
      expect(e?.message).toBe(`"${name}" makes no id: an id is lowercase letters, digits and dashes`);
      expect(e?.exitCode).toBe(2);
    }
    const made = newPlugin({ name: "한글 이름", id: "hangul", dir: join(dir, "hangul") });
    expect(made.id).toBe("hangul");
    expect(JSON.parse(readFileSync(join(made.dir, "plugin.json"), "utf8"))).toMatchObject({ name: "한글 이름", id: "hangul" });
    expect(() => newPlugin({ name: "X", id: "Bad Id", dir: join(dir, "bad") })).toThrow(/is not an id/);
  });

  it("writes into --out, keeps --dir, and refuses standard output", async () => {
    const dir = tmp();
    expect((await scmjs("plugin", "new", "Base Check", "--out", join(dir, "a"))).code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "a", "plugin.json"), "utf8")).id).toBe("base-check");
    expect((await scmjs("plugin", "new", "Base Check", "--dir", join(dir, "b"))).code).toBe(0);
    const piped = await scmjs("plugin", "new", "Base Check", "--out", "-");
    expect(piped.code).toBe(2);
    expect(piped.err).toContain("--out - (standard output) cannot take it");
  });
});

describe("scmjs plugin check", () => {
  it("says the id the editor keeps when plugin.json's is not one, and a version that is not three numbers", () => {
    const dir = tmp();
    writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name: "X", id: "Bad Id!", version: "1", api: 1 }));
    writeFileSync(join(dir, "plugin.ts"), "export function activate() {}\n");
    const c = checkPlugin(dir);
    expect(c.id).toBe("bad-id");
    expect(c.issues).toContainEqual(expect.objectContaining({ level: "warn", message: "The id \"Bad Id!\" is kept by the editor as \"bad-id\"" }));
    expect(c.issues).toContainEqual(expect.objectContaining({ level: "info", message: "The version \"1\" is not three numbers (1.2.0)" }));
    expect(editorId("base-check")).toBe("base-check");
  });
});

describe("scmjs lsp", () => {
  it("typed at a terminal, says what it is and exits 2 rather than wait", async () => {
    const was = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      const r = await scmjs("lsp");
      expect(r.code).toBe(2);
      expect(r.err).toContain("scmjs lsp is a language server");
    } finally {
      if (was) Object.defineProperty(process.stdin, "isTTY", was); else delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  });
});
