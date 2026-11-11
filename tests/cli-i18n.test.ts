/**
 * `scmjs` in Korean (cli/src/i18n.ts, commanderText.ts, ui.ts): how the language is chosen, the width of Hangul in a
 * terminal, and commands run in-process in Korean — the help, a map's report with the map's own text untouched,
 * `--json` keys as in English, the formats that stay the same in every language, and a baseline written in one
 * language that holds in the other.
 */
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";
import { chooseLocale, locale, setLocale } from "../cli/src/i18n";
import { commanderError, helpExtras } from "../cli/src/commanderText";
import { buildProgram } from "../cli/src/main";
import { charWidth, CliError, columns, padColumns, rows, table, visible } from "../cli/src/ui";
import { openMapBytes } from "../src/editor/mapFile";
import { scenarioName } from "../src/formats/chk/scenario";
import { testMap } from "./support/maps";

const HANGUL = /[가-힣]/;

/** `scmjs …` run in-process in `lang`, as the command would be: what it printed and its exit code. */
async function scmjs(lang: "en" | "ko", ...args: string[]): Promise<{ out: string; err: string; code: number }> {
  setLocale(lang);
  let out = "", err = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation((s) => { out += String(s); return true; });
  const e = vi.spyOn(process.stderr, "write").mockImplementation((s) => { err += String(s); return true; });
  process.exitCode = 0;
  let program: Command | null = null;
  try {
    program = buildProgram();
    // commander's own errors throw rather than end the process.
    const override = (c: Command): void => { c.exitOverride(); c.commands.forEach(override); };
    override(program);
    await program.parseAsync(args, { from: "user" });
  } catch (x) {
    if (x instanceof CliError) { err += x.message; process.exitCode = x.exitCode; }
    else if (!(x && typeof x === "object" && "code" in x && String((x as { code: unknown }).code).startsWith("commander."))) throw x;
    else process.exitCode = Number((x as { exitCode?: number }).exitCode ?? 1);
  } finally { o.mockRestore(); e.mockRestore(); setLocale("en"); }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return { out: visible(out), err: visible(err), code };
}
afterEach(() => { setLocale("en"); process.exitCode = 0; });

/** Every key path of a JSON value (`a.b`, `list[].c`), to compare two outputs' shapes. */
function keyPaths(v: unknown, at = ""): string[] {
  if (Array.isArray(v)) return [...new Set(v.flatMap((x) => keyPaths(x, `${at}[]`)))].sort();
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [`${at}.${k}`, ...keyPaths(x, `${at}.${k}`)]).sort();
  return [];
}

describe("the language", () => {
  const none = {};
  it("is --lang first, anywhere before --", () => {
    expect(chooseLocale(["--lang", "ko", "info", "a.scx"], none, "en-US")).toBe("ko");
    expect(chooseLocale(["info", "a.scx", "--lang=ko"], { SCMJS_LANG: "en" }, "en-US")).toBe("ko");
    expect(chooseLocale(["--lang", "en"], { LANG: "ko_KR.UTF-8" }, "ko-KR")).toBe("en");
    expect(chooseLocale(["map", "run", "a.scx", "--", "--lang", "ko"], none, "en-US")).toBe("en");
  });

  it("then SCMJS_LANG, then the POSIX locale, then the system's, then English", () => {
    expect(chooseLocale([], { SCMJS_LANG: "ko" }, "en-US")).toBe("ko");
    expect(chooseLocale([], { SCMJS_LANG: "ko-KR", LANG: "en_US.UTF-8" }, "en-US")).toBe("ko");
    expect(chooseLocale([], { LANG: "ko_KR.UTF-8" }, "en-US")).toBe("ko");
    // LC_ALL over LC_MESSAGES over LANG, as POSIX has it; C is English.
    expect(chooseLocale([], { LC_ALL: "C.UTF-8", LANG: "ko_KR.UTF-8" }, "ko-KR")).toBe("en");
    expect(chooseLocale([], { LC_MESSAGES: "ko_KR.UTF-8", LANG: "en_US.UTF-8" }, "en-US")).toBe("ko");
    // No POSIX locale (Windows): the system's language.
    expect(chooseLocale([], none, "ko-KR")).toBe("ko");
    expect(chooseLocale([], none, "fr-FR")).toBe("en");
    expect(chooseLocale([], { SCMJS_LANG: "fr" }, "ko-KR")).toBe("en");
  });
});

describe("terminal width", () => {
  it("counts Hangul, CJK and full-width forms as two columns, combining marks as none", () => {
    expect(charWidth("a".codePointAt(0)!)).toBe(1);
    expect(charWidth("한".codePointAt(0)!)).toBe(2);
    expect(charWidth("漢".codePointAt(0)!)).toBe(2);
    expect(charWidth("ア".codePointAt(0)!)).toBe(2);
    expect(charWidth("Ａ".codePointAt(0)!)).toBe(2);
    expect(charWidth(0x0301)).toBe(0);
    expect(charWidth("─".codePointAt(0)!)).toBe(1);
    expect(columns("맵 검사")).toBe(7);
    expect(columns("é")).toBe(1);
    expect(columns("\x1b[1m리플레이\x1b[22m")).toBe(8);
    expect(columns("😀")).toBe(2);
    expect(padColumns("유닛", 6)).toBe("유닛  ");
  });

  it("lines up Korean labels and cells", () => {
    // Each value starts at the same terminal column, whatever the width of the label before it.
    const labelled = rows([["이름", "a"], ["타일셋", "b"], ["Size", "c"]]).map(visible);
    expect(new Set(labelled.map((l) => columns(l) - 1)).size).toBe(1);
    const last = ["Test Remastered 리마스터", "b", "끝"];
    const cells = table([["파일", last[0]], ["melee.scx", last[1]], ["a", last[2]]], 0).map(visible);
    expect(new Set(cells.map((l, i) => columns(l) - columns(last[i]))).size).toBe(1);
  });
});

describe("commander's own words", () => {
  it("translates the extras after an option and the errors it knows, and leaves the rest", () => {
    setLocale("ko");
    expect(helpExtras("the size (default: \"128x128\")")).toBe("the size (기본값: \"128x128\")");
    expect(commanderError("unknown command 'mpa'\n(Did you mean map?)")).toBe("알 수 없는 명령 'mpa'\n(map 말씀인가요?)");
    expect(commanderError("something commander says")).toBe("something commander says");
    setLocale("en");
    expect(commanderError("unknown command 'mpa'")).toBe("unknown command 'mpa'");
  });
});

describe("scmjs in Korean", () => {
  it("shows the overview and a command's help in Korean", async () => {
    setLocale("ko");
    const program = buildProgram();
    const root = visible(program.helpInformation());
    expect(root).toContain("사용법:");
    expect(root).toContain("옵션:");
    expect(root).toMatch(HANGUL);
    const map = program.commands.find((c) => c.name() === "map")!;
    const help = visible(map.helpInformation());
    // The usage line's syntax is commander's, as typed.
    expect(help.split("\n")[0]).toBe("사용법: scmjs map [options] [command]");
    // Its commands in groups by task (main.ts COMMAND_GROUPS), the headings in Korean.
    expect(help).toContain("맵 들여다보기:");
    const plugin = program.commands.find((c) => c.name() === "plugin")!;
    expect(visible(plugin.helpInformation())).toContain("명령:");
    const check = map.commands.find((c) => c.name() === "check")!;
    expect(visible(check.helpInformation()).replace(/\s+/g, " ")).toContain("(기본값: \"text\")");
  });

  it("says a map's report in Korean, and the map's own text as the map has it", async () => {
    const path = testMap("remastered.scx");
    const name = scenarioName((await openMapBytes(new Uint8Array(readFileSync(path)), "remastered.scx")).scenario);
    const { out, code } = await scmjs("ko", "info", path);
    expect(code).toBe(0);
    expect(out).toMatch(HANGUL);
    expect(out).toContain(name);
    const en = await scmjs("en", "info", path);
    expect(en.out).toContain(name);
    expect(en.out.replace(/리마스터/g, "")).not.toMatch(HANGUL);
  });

  it("keeps --json's keys in English, whatever the language", async () => {
    for (const args of [["info", "--json", testMap("melee.scx")], ["map", "check", "--json", "--all", testMap("ums.scx")]]) {
      const ko = JSON.parse((await scmjs("ko", ...args)).out), en = JSON.parse((await scmjs("en", ...args)).out);
      expect(keyPaths(ko)).toEqual(keyPaths(en));
    }
  });

  it("gives Check Map's findings in Korean, and the CI formats' rule ids in English", async () => {
    const ko = await scmjs("ko", "map", "check", "--all", testMap("ums.scx"));
    expect(ko.out).toMatch(HANGUL);
    const sarif = JSON.parse((await scmjs("ko", "map", "check", "--all", "--format", "sarif", testMap("ums.scx"))).out);
    for (const rule of sarif.runs[0].tool.driver.rules) expect(rule.id).toMatch(/^scmjs\/[a-z0-9-]+$/);
  });

  it("writes a dump the same in every language", async () => {
    const ko = await scmjs("ko", "map", "dump", testMap("ums.scx"));
    const en = await scmjs("en", "map", "dump", testMap("ums.scx"));
    expect(ko.out).toBe(en.out);
  });

  it("keeps a baseline in English, so it holds in either language", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scmjs-i18n-"));
    const map = join(dir, "ums.scx");
    copyFileSync(testMap("ums.scx"), map);
    const baseline = join(dir, "baseline.json");
    const written = await scmjs("ko", "map", "check", map, "--all", "--write-baseline", baseline);
    expect(written.code).toBe(0);
    expect(readFileSync(baseline, "utf8")).not.toMatch(HANGUL);
    const en = await scmjs("en", "map", "check", map, "--all", "--strict", "--baseline", baseline, "--json");
    expect(JSON.parse(en.out).baseline.new).toBe(0);
    const ko = await scmjs("ko", "map", "check", map, "--all", "--strict", "--baseline", baseline, "--json");
    expect(JSON.parse(ko.out).baseline.new).toBe(0);
  });

  it("takes SCMJS_LANG as the command does at start", async () => {
    setLocale(chooseLocale([], { SCMJS_LANG: "ko" }, "en-US"));
    expect(locale()).toBe("ko");
    const { out } = await scmjs(locale(), "info", testMap("melee.scx"));
    expect(out).toMatch(HANGUL);
  });

  it("refuses a language it does not have, in the language it has", async () => {
    const { err, code } = await scmjs("en", "--lang", "fr", "about");
    expect(code).not.toBe(0);
    expect(err).toContain("--lang");
  });
});
