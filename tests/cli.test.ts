/**
 * The `scmjs` command's pieces (cli/src, docs/cli.md): what kind a file is, a map's report and its lines, Check Map's
 * lines, StarCraft text in a terminal, and the overview's banner. picocolors may write colour (it does under CI), so
 * lines are compared without it.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newestLine, olderThan } from "../cli/src/about";
import { banner, GLOBE, GLOBE_ASCII } from "../cli/src/banner";
import { dockerArgs } from "../cli/src/bot";
import { doctorJson, engineCheck, nodeCheck, printDoctor, type Check } from "../cli/src/doctor";
import { kindOf, loadMapInput, type Input } from "../cli/src/files";
import { checkPlugin, devEditorUrl, nameFromFolder, newPlugin, pluginId, sourceImports } from "../cli/src/plugin";
import { devPluginSpec } from "../src/plugins/devLink";
import { program } from "../cli/src/main";
import { mapReport, printIssues, printMapInfo } from "../cli/src/map";
import { columns, dot, gameLines, gameText, rows, table, visible } from "../cli/src/ui";
import { githubAnnotations, junitXml, sarifJson, type CheckReport } from "../cli/src/report";
import { TEST_MAPS_DIR } from "./support/maps";

/** The lines as the reader sees them, without colour. */
const plain = (lines: string[]) => lines.map(visible);

const input = (name: string): Input => {
  const bytes = new Uint8Array(readFileSync(join(TEST_MAPS_DIR, name)));
  return { path: join(TEST_MAPS_DIR, name), name, bytes, kind: kindOf(name, bytes) };
};

describe("scmjs: files", () => {
  it("knows a map, a replay and a bot file by their first bytes", () => {
    expect(input("melee.scx").kind).toBe("map");
    expect(kindOf("x.chk", new Uint8Array(8))).toBe("map");
    expect(kindOf("x.scmbot", new TextEncoder().encode("SCMBOT1\n\0\0\0\0"))).toBe("bot");
    expect(kindOf("notes.txt", new TextEncoder().encode("hello"))).toBeNull();
  });
});

describe("scmjs map info", () => {
  it("reports a map as the editor reads it", async () => {
    const i = input("ums.scx");
    const r = mapReport(i, await loadMapInput(i));
    expect(r.name).toBe("Test Scenario");
    expect([r.width, r.height, r.tileset]).toEqual([64, 64, "Badlands"]);
    expect(r.usedSlots).toEqual([0, 1]);
    expect(r.statistics.triggers.count).toBe(3);
    const lines = plain(printMapInfo(r)).join("\n");
    expect(lines).toMatch(/^Test Scenario\n/);
    expect(lines).toMatch(/ {2}Map +64 × 64 · Badlands · Brood War 1\.04/);
    expect(lines).toContain("1  Human     Terran  5 units  start location");
  });
  it("says the check in one line, and lists it worst first", async () => {
    const i = input("ums.scx");
    const r = mapReport(i, await loadMapInput(i));
    expect(plain(printMapInfo(r)).join("\n")).toContain("▲ 1 warning");
    const lines = plain(printIssues(r.issues, true));
    expect(lines[0]).toMatch(/^ {2}▲ Nothing makes Player 1 lose/);
    expect(lines.at(-1)).toMatch(/^ {2}ℹ /);
    expect(plain(printIssues(r.issues, false)).some((l) => l.includes("ℹ"))).toBe(false);
  });
  it("every committed map reads", async () => {
    for (const name of ["melee.scx", "ums.scx", "remastered.scx", "hybrid.scm", "original.scm"]) {
      const i = input(name);
      expect(printMapInfo(mapReport(i, await loadMapInput(i))).length).toBeGreaterThan(5);
    }
  });
});

describe("scmjs: terminal text", () => {
  it("StarCraft text: colour codes taken out where there is no colour, other control bytes dropped", () => {
    expect(gameText("\x03Lost \x04Temple\x13")).toBe("Lost Temple");
    expect(gameText("a\nb\tc")).toBe("a b c");
    expect(gameLines("Players: 2\r\n\r\n\r\n\x06Ice\x01 is nice")).toBe("Players: 2\n\nIce is nice");
  });
  it("a table pads by the columns a cell takes, Korean counting two a character", () => {
    expect(columns("ab")).toBe(2);
    expect(columns("리마스터")).toBe(8);
    expect(columns("\x1b[1m한\x1b[0m!")).toBe(3);
    // Both first cells take 13 columns; the Korean one is four code units shorter than the room it fills.
    const lines = plain(table([["Test 리마스터", "x"], ["Test Melee", "y"]], 0));
    expect(lines[1].indexOf("y") - lines[0].indexOf("x")).toBe(4);
    expect(lines[0].indexOf("x")).toBe(11);
  });
  it("rows line up, drop empty values and keep a group's gap", () => {
    expect(plain(rows([["Map", "64 × 64"], ["Built by", null], null, ["Strings", "20"]]))).toEqual(["  Map      64 × 64", "", "  Strings  20"]);
    expect(plain(table([["1", "Human", "Terran"], ["12", "Computer", "Zerg"]]))).toEqual(["    1   Human     Terran", "    12  Computer  Zerg"]);
  });
});

describe("scmjs bot", () => {
  it("runs the toolchain in the bot's folder, named, as the person running it", () => {
    expect(dockerArgs({ folder: "/home/a/ZergRush", args: ["build"], image: "img", tty: true, user: "1000:1000" }))
      .toEqual(["run", "--rm", "-it", "-v", "/home/a/ZergRush:/bot", "-e", "SCMBOT_FOLDER=ZergRush", "-e", "SCMBOT_COMMAND=scmjs bot", "-u", "1000:1000", "img", "build"]);
    // Windows (Docker Desktop maps the files itself) and no terminal (a script, CI)
    expect(dockerArgs({ folder: "/x/b", args: ["init", "b.vcxproj"], image: "img", tty: false, user: null }))
      .toEqual(["run", "--rm", "-i", "-v", "/x/b:/bot", "-e", "SCMBOT_FOLDER=b", "-e", "SCMBOT_COMMAND=scmjs bot", "img", "init", "b.vcxproj"]);
  });
});

describe("scmjs plugin", () => {
  const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-plugin-"));

  it("names a plugin and its folder", () => {
    expect(pluginId("Base Check")).toBe("base-check");
    expect(pluginId("  Ünits ++ Tools ")).toBe("units-tools");
    expect(nameFromFolder("/x/plugin-base-check")).toBe("Base Check");
    expect(nameFromFolder("scmjs-plugin-trigger_tools")).toBe("Trigger Tools");
  });

  it("writes a plugin that loads once it is built", () => {
    const dir = join(tmp(), "plugin-base-check");
    const made = newPlugin({ name: "Base Check", dir });
    expect(made.files).toEqual(expect.arrayContaining(["plugin.json", "plugin.ts", "ko.ts", "tests/ko.test.ts", "package.json", "tsconfig.json", ".github/workflows/ci.yml", "LICENSE"]));
    const manifest = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8"));
    expect(manifest).toMatchObject({ name: "Base Check", id: "base-check", entry: "plugin.ts", build: "dist/plugin.js", api: 1 });
    // Not built yet: the editor would load dist/plugin.js and fail.
    expect(checkPlugin(dir).issues.filter((i) => i.level === "error").map((i) => i.message)).toEqual([expect.stringContaining("dist/plugin.js is not there")]);
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist/plugin.js"), "export default () => {};\n");
    const c = checkPlugin(dir);
    expect(c.issues.filter((i) => i.level !== "info")).toEqual([]);
    expect(c.loads).toBe("dist/plugin.js");
    // The starter's strings are all in its catalogue, as its own test checks.
    const source = readFileSync(join(dir, "plugin.ts"), "utf8");
    const keys = [...source.matchAll(/\b(?:t|msg)\("((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
    const ko = readFileSync(join(dir, "ko.ts"), "utf8");
    for (const k of keys) expect(ko, k).toContain(JSON.stringify(k));
    expect(() => newPlugin({ name: "Base Check", dir })).toThrow(/not empty/);
  });

  it("follows the source as the editor would when there is no build", () => {
    const dir = tmp();
    writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name: "Src", api: 1 }));
    writeFileSync(join(dir, "plugin.ts"), 'import type { PluginApi } from "@scm-js/plugin-api";\nimport { a } from "./lib";\n// import x from "nowhere";\nexport default (api: PluginApi) => a(api);\n');
    writeFileSync(join(dir, "lib.ts"), 'import { b } from "./missing.js";\nimport lodash from "lodash";\nexport const a = (x: unknown) => b(x, lodash);\n');
    const errors = checkPlugin(dir).issues.filter((i) => i.level === "error").map((i) => i.message);
    expect(errors).toEqual(["lib.ts imports ./missing.js, which is not there", 'lib.ts imports the package "lodash"']);
  });

  it("refuses what the editor would refuse in the manifest", () => {
    const dir = tmp();
    writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name: "Later", api: 99, entry: "plugin.ts", icon: "art/mark.png" }));
    writeFileSync(join(dir, "plugin.ts"), "export default () => {};\n");
    const errors = checkPlugin(dir).issues.filter((i) => i.level === "error").map((i) => i.message);
    expect(errors).toEqual(["It needs plugin API 99; the editor provides 1", "The icon art/mark.png is not in the folder"]);
    writeFileSync(join(dir, "plugin.json"), JSON.stringify({ description: "no name" }));
    expect(checkPlugin(dir).issues[0]).toMatchObject({ level: "error", message: expect.stringContaining("needs a \"name\"") });
  });

  it("reads imports, leaving type-only ones and comments out", () => {
    expect(sourceImports('import type { A } from "pkg";\nexport type { B } from "./b";\nimport x from "./x";\nconst y = await import("./y");\n/* import z from "z" */\nexport { c } from "./c";\n'))
      .toEqual(["./x", "./y", "./c"]);
  });

  it("gives the editor the address it serves the plugin on", () => {
    expect(devEditorUrl("https://scmjs.dev/editor/", "http://127.0.0.1:5310/")).toBe("https://scmjs.dev/editor/?plugin-dev=http%3A%2F%2F127.0.0.1%3A5310%2F");
    expect(devPluginSpec(new URL(devEditorUrl("http://localhost:5173/?nosplash", "http://127.0.0.1:5310/")).searchParams.get("plugin-dev"))).toBe("http://127.0.0.1:5310/");
  });
});

describe("the editor's ?plugin-dev= link", () => {
  it("takes only a plugin served on this machine, at the root of a port", () => {
    expect(devPluginSpec("http://127.0.0.1:5310/")).toBe("http://127.0.0.1:5310/");
    expect(devPluginSpec("http://localhost:3000")).toBe("http://localhost:3000/");
    expect(devPluginSpec("http://[::1]:8080/")).toBe("http://[::1]:8080/");
    for (const bad of [null, "", "https://127.0.0.1:5310/", "http://127.0.0.1/", "http://evil.example:5310/", "http://127.0.0.2:5310/", "http://127.0.0.1:5310/other/", "http://user@127.0.0.1:5310/", "http://127.0.0.1:5310/?x=1", "javascript:alert(1)", "http://localhost.evil.example:80/"])
      expect(devPluginSpec(bad), String(bad)).toBeNull();
  });
});

describe("scmjs about", () => {
  it("compares versions as numbers", () => {
    expect(olderThan("0.8.9", "0.8.10")).toBe(true);
    expect(olderThan("0.9.0", "0.8.10")).toBe(false);
    expect(olderThan("0.8.9", "0.8.9")).toBe(false);
    expect(olderThan("0.8.9-dev", "0.8.9")).toBe(false);
    expect(olderThan("1.0.0", "1.0.1+build")).toBe(true);
  });
  it("offers the update only when npm has a newer version", () => {
    expect(visible(newestLine("0.8.9", "0.9.0"))).toBe(`0.9.0${visible(dot)}npm install -g @scm-js/cli@latest`);
    expect(visible(newestLine("0.8.9", "0.8.9"))).toBe("this one");
    expect(visible(newestLine("0.9.0", "0.8.9"))).toBe("0.8.9 on npm");
    expect(visible(newestLine("0.8.9", null))).toBe("could not ask npm");
  });
});

describe("scmjs map check --format", () => {
  const reports: CheckReport[] = [
    { file: "maps/ridge.scx", name: "Ridge: the sequel", failed: true, issues: [
      { level: "error", text: "No start location for Player 1 (slot is Human): 100% sure.\nSecond line", where: "Players" },
      { level: "warn", text: "Nothing makes Player 1 lose", where: "Triggers" },
      { level: "info", text: "Map revision: Brood War 1.04 <VER 205>", where: "Header" },
    ] },
    { file: "maps/ok.scx", name: "", failed: false, issues: [] },
  ];

  it("writes GitHub workflow annotations, one a finding, escaped as the runner reads them", () => {
    const lines = githubAnnotations(reports);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("::error file=maps/ridge.scx,title=Ridge%3A the sequel · Players::No start location for Player 1 (slot is Human): 100%25 sure.%0ASecond line");
    expect(lines[1]).toMatch(/^::warning file=maps\/ridge\.scx,title=Ridge%3A the sequel · Triggers::Nothing makes/);
    expect(lines[2]).toMatch(/^::notice /);
  });

  it("writes JUnit with a case per map, failed when the check failed it", () => {
    const xml = junitXml(reports);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<testsuites name="scmjs map check" tests="2" failures="1">/);
    expect(xml).toContain('<testcase name="Ridge: the sequel" classname="maps/ridge.scx" file="maps/ridge.scx">');
    expect(xml).toContain('<failure message="1 error, 1 warning">error: No start location for Player 1 (slot is Human): 100% sure.\nSecond line (Players)\nwarning: Nothing makes Player 1 lose (Triggers)\nnote: Map revision: Brood War 1.04 &lt;VER 205&gt; (Header)</failure>');
    expect(xml).toContain('<testcase name="maps/ok.scx" classname="maps/ok.scx" file="maps/ok.scx">\n    </testcase>');
    expect(xml.match(/<testcase /g)).toHaveLength(2);
  });

  it("writes SARIF 2.1.0 with a rule per area and a result per finding at the map's file", () => {
    const log = JSON.parse(sarifJson(reports, "1.2.3")) as { version: string; runs: { tool: { driver: { name: string; version: string; rules: { id: string }[] } }; results: { ruleId: string; level: string; message: { text: string }; locations: { physicalLocation: { artifactLocation: { uri: string } } }[] }[] }[] };
    expect(log.version).toBe("2.1.0");
    expect(log.runs[0].tool.driver).toMatchObject({ name: "scmjs map check", version: "1.2.3" });
    expect(log.runs[0].tool.driver.rules.map((r) => r.id)).toEqual(["scmjs/players", "scmjs/triggers", "scmjs/header"]);
    expect(log.runs[0].results.map((r) => r.level)).toEqual(["error", "warning", "note"]);
    expect(log.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe("maps/ridge.scx");
    expect(log.runs[0].results[1].message.text).toBe("Nothing makes Player 1 lose");
  });
});

describe("scmjs doctor", () => {
  it("holds Node to the package's engines", () => {
    expect(nodeCheck("v20.19.0").state).toBe("bad");
    expect(nodeCheck("v22.12.0").state).toBe("ok");
    expect(nodeCheck().state).toBe("ok");
  });
  it("knows an engine that was never fetched, and says so without alarm", () => {
    const c = engineCheck(mkdtempSync(join(tmpdir(), "scmjs-doctor-")));
    expect(c.state).toBe("ok");
    expect(visible(c.detail)).toBe("not fetched yet");
    expect(c.note).toContain("scmjs bot run");
  });
  it("prints each check with its mark and fix, and the JSON without colour", () => {
    const checks: Check[] = [
      { what: "Node", state: "ok", detail: "v22.12.0" },
      { what: "TypeScript", state: "warn", detail: "not found", fix: "npm install typescript", note: "scmjs map build compiles with it." },
    ];
    const lines = plain(printDoctor({ checks, blocked: false }));
    expect(lines[2]).toMatch(/^✔ Node +v22\.12\.0$/);
    expect(lines[3]).toMatch(/^▲ TypeScript +not found$/);
    expect(lines[4]).toBe("    scmjs map build compiles with it.");
    expect(lines[5]).toBe("    npm install typescript");
    expect(lines.at(-3)).toBe("Ready on this computer");
    expect(lines.at(-2)).toMatch(/^ {2}✔ map info\|check\|…/);
    expect(lines.at(-1)).toMatch(/✔ map trace\|cost$/);
    expect(plain(printDoctor({ checks: [{ what: "Node", state: "bad", detail: "v20" }], blocked: true }))).toContain("✖ Something blocks scmjs itself");
    const j = doctorJson({ checks: [{ what: "Node", state: "ok", detail: "\x1b[2mv22\x1b[0m" }], blocked: false });
    expect(j.checks[0].detail).toBe("v22");
  });
});

describe("scmjs: the overview", () => {
  const text = ["scmjs 1.2.3", "scmJS on the command line", "StarCraft: Brood War maps, replays, plugins and bots"];
  const help = (cmd = program) => visible(cmd.helpInformation()).replace(/\n$/, "").split("\n");

  it("draws the globe beside the title, within 80 columns", () => {
    for (const ascii of [false, true]) {
      const lines = plain(banner(text, { ascii }));
      expect(lines).toHaveLength(GLOBE.length);
      expect(lines.some((l) => l.endsWith("   scmjs 1.2.3"))).toBe(true);
      for (const l of lines) expect(l.length, l).toBeLessThanOrEqual(80);
    }
    expect(GLOBE_ASCII).toHaveLength(GLOBE.length);
  });

  it("falls back to ASCII where the marks do, and to the text alone in a narrow terminal", () => {
    for (const l of [...GLOBE_ASCII, ...plain(banner(text, { ascii: true }))]) expect(l).toMatch(/^[\x20-\x7e]*$/);
    expect(plain(banner(text, { width: 60 }))).toEqual(text);
  });

  it("lists every command in its group, and fits a 24-row terminal", () => {
    const lines = help();
    for (const group of ["Maps and replays:", "Plugins and bots:", "This tool:"]) expect(lines).toContain(group);
    for (const cmd of program.commands.filter((c) => !(c as unknown as { _hidden?: boolean })._hidden)) expect(lines.some((l) => l.startsWith(`  ${cmd.name()} `)), cmd.name()).toBe(true);
    // A noun with more verbs than fit beside its description shows the first few and an ellipsis; its own help has them all.
    expect(lines.some((l) => /^ {2}map info\|check\|open\|(\w+\|)*…/.test(l))).toBe(true);
    expect(lines.some((l) => l.includes("completion"))).toBe(false);
    expect(lines.some((l) => l.includes("scmjs 0.0.0-dev"))).toBe(true);
    expect(lines.at(-1)).toBe("Options: -v, --version   --no-color   -h, --help");
    expect(lines.length, "a line left for the prompt").toBeLessThanOrEqual(23);
    for (const l of lines) expect(l.length, l).toBeLessThanOrEqual(80);
  });

  it("leaves a command's own help plain", () => {
    const map = program.commands.find((c) => c.name() === "map")!;
    expect(help(map)[0]).toBe("Usage: scmjs map [options] [command]");
    expect(help(map).join("\n")).not.toContain(GLOBE[3].trim());
  });
});
