/**
 * The map commands that need no game, held to what the command-line audit of 0.13.3 found: bytes that are not a map
 * are refused rather than read as a blank one, a write keeps the members it did not change as they were stored, an
 * empty import is refused, an edit is kept when the map cannot be written — and the smaller findings after them.
 * Everything runs on the committed maps in tests/maps (and, where present, the fixtures); writes go to a temporary
 * folder.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { looksLikeScenario, openMapBytes, readArchive } from "../src/editor/mapFile";
import { program } from "../cli/src/main";
import { CliError, visible } from "../cli/src/ui";
import { testMap } from "./support/maps";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-audit-maps-"));

/** A command run as `scmjs …` would run it: what it printed, and its exit code. */
async function scmjs(...args: string[]): Promise<{ out: string; err: string; code: number; raw: Buffer }> {
  const chunks: Buffer[] = [];
  let err = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array, ...rest: unknown[]) => {
    chunks.push(Buffer.from(s));
    const cb = rest.find((r) => typeof r === "function") as ((e?: Error) => void) | undefined;
    cb?.();
    return true;
  });
  const e = vi.spyOn(process.stderr, "write").mockImplementation((s) => { err += String(s); return true; });
  process.exitCode = 0;
  try {
    await program.parseAsync(args, { from: "user" });
  } catch (x) {
    if (!(x instanceof CliError)) throw x;
    err += x.message + (x.hint ? `\n  ${x.hint}` : "");
    process.exitCode = x.exitCode;
  } finally { o.mockRestore(); e.mockRestore(); }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  const raw = Buffer.concat(chunks);
  return { out: visible(raw.toString("utf8")), err: visible(err), code, raw };
}
afterEach(() => { process.exitCode = 0; });

describe("S1: bytes that are not a map", () => {
  it("are refused where every map is opened, and the editor's real maps are not", async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const random = new Uint8Array(3000).map((_, i) => (i * 2654435761) >>> 24);
    for (const bytes of [enc("hello\n"), new Uint8Array(0), enc("abcde"), enc("# A readme\n\nSome text about a thing.\n"), random, new Uint8Array(64)]) {
      expect(looksLikeScenario(bytes)).toBe(false);
      await expect(openMapBytes(bytes, "x.chk")).rejects.toThrow(/no section a map has/);
    }
    for (const m of ["ums.scx", "melee.scx", "original.scm", "hybrid.scm", "remastered.scx"]) {
      const bytes = new Uint8Array(readFileSync(testMap(m)));
      expect(looksLikeScenario((await readArchive(bytes)).chk)).toBe(true);
    }
    // A bare scenario of one section is still one.
    expect(looksLikeScenario(new Uint8Array([0x54, 0x59, 0x50, 0x45, 4, 0, 0, 0, 82, 65, 87, 66]))).toBe(true);
  });

  it("is said and exits 2, and a writer leaves the file as it was", async () => {
    const dir = tmp();
    const note = join(dir, "note.scm");
    writeFileSync(note, "hello\n");
    const info = await scmjs("map", "info", note);
    expect(info.code).toBe(2);
    expect(info.err).toMatch(/note\.scm is not a map this can read: .*no section a map has/);
    const set = await scmjs("map", "set", note, "--name", "x");
    expect(set.code).toBe(2);
    expect(readFileSync(note, "utf8")).toBe("hello\n");
  });

  it("refuses a folder to pack whose scenario is not one", async () => {
    const dir = tmp();
    const folder = join(dir, "ums");
    expect((await scmjs("map", "unpack", testMap("ums.scx"), "--out", folder)).code).toBe(0);
    writeFileSync(join(folder, "staredit", "scenario.chk"), "not a scenario");
    const r = await scmjs("map", "pack", folder, "--out", join(dir, "x.scx"));
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/not a map the editor reads/);
    expect(existsSync(join(dir, "x.scx"))).toBe(false);
  });
});
