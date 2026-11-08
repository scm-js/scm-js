/**
 * The single executable of `scmjs` (cli/src/runtime.ts, sea.ts; scripts/build-cli-binary.mjs): what it says about
 * itself and how to update it, by the folder a package manager put it in; how it runs the game's runners as Node; and
 * the CommonJS its bundle must be (no top-level await anywhere in cli/src). The executable itself is checked by hand
 * and in CI with scripts/check-cli-binary.mjs.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { newestLine } from "../cli/src/about";
import { mcpAddLine, MCP_ADD, mcpCheck, nodeCheck, versionCheck } from "../cli/src/doctor";
import { INSTALL, installInfo, installLabel, managerOf, RELEASES_URL, runnerEnv, scriptArgv, updateCommand, type Install } from "../cli/src/runtime";
import { VERSION } from "../cli/src/about";
import { dot, visible } from "../cli/src/ui";

const binary = (path: string): Install => installInfo("binary", path);

describe("how scmjs was installed", () => {
  it("is the npm package under the tests", () => {
    expect(INSTALL).toBe("npm");
    expect(installInfo()).toMatchObject({ kind: "npm", manager: null });
  });

  it("knows the package manager by the folder it installs into", () => {
    expect(managerOf("C:\\Users\\me\\scoop\\apps\\scmjs\\current\\scmjs.exe")).toBe("scoop");
    expect(managerOf("C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Packages\\scm-js.scmjs_Microsoft.Winget.Source_8wekyb3d8bbwe\\scmjs.exe")).toBe("winget");
    expect(managerOf("/opt/homebrew/Cellar/scmjs/0.12.0/bin/scmjs")).toBe("homebrew");
    expect(managerOf("/home/linuxbrew/.linuxbrew/Cellar/scmjs/0.12.0/bin/scmjs")).toBe("homebrew");
    expect(managerOf("/usr/local/Cellar/scmjs/0.12.0/bin/scmjs")).toBe("homebrew");
    expect(managerOf("/home/me/bin/scmjs")).toBeNull();
    expect(managerOf("C:\\tools\\scmjs.exe")).toBeNull();
  });

  it("says how to update each kind", () => {
    expect(updateCommand(installInfo("npm", "/x/scmjs.mjs"))).toBe("npm install -g @scm-js/cli@latest");
    expect(updateCommand(binary("C:\\Users\\me\\scoop\\apps\\scmjs\\current\\scmjs.exe"))).toBe("scoop update scmjs");
    expect(updateCommand(binary("C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Packages\\x\\scmjs.exe"))).toBe("winget upgrade scm-js.scmjs");
    expect(updateCommand(binary("/opt/homebrew/Cellar/scmjs/0.12.0/bin/scmjs"))).toBe("brew upgrade scmjs");
    expect(updateCommand(binary("/home/me/bin/scmjs"))).toBe(`download it again from ${RELEASES_URL}`);
    expect(installLabel(binary("/home/me/bin/scmjs"))).toBe("single executable");
    expect(installLabel(binary("/opt/homebrew/Cellar/scmjs/0.12.0/bin/scmjs"))).toBe("single executable, from Homebrew");
    expect(installLabel(installInfo("npm", "/x"))).toBe("npm package");
  });

  it("about's Newest row offers the update this install takes", () => {
    expect(visible(newestLine("0.8.9", "0.9.0", binary("/home/me/bin/scmjs")))).toBe(`0.9.0${visible(dot)}download it again from ${RELEASES_URL}`);
    expect(visible(newestLine("0.8.9", "0.9.0", binary("C:\\scoop\\apps\\scmjs\\current\\scmjs.exe")))).toBe(`0.9.0${visible(dot)}scoop update scmjs`);
    expect(visible(newestLine("0.9.0", "0.9.0", binary("/home/me/bin/scmjs")))).toBe("this one");
  });

  it("doctor names the single executable and its update, and never finds its Node too old", async () => {
    const newer = "999.0.0";
    const brew = await versionCheck(newer, binary("/opt/homebrew/Cellar/scmjs/1/bin/scmjs"));
    expect([brew.state, visible(brew.detail), brew.fix]).toEqual(["warn", `${VERSION}, ${newer} is out · single executable, from Homebrew`, "brew upgrade scmjs"]);
    const same = await versionCheck(VERSION, binary("/home/me/bin/scmjs"));
    expect(visible(same.detail)).toBe(`${VERSION} · the newest · single executable`);
    const npm = await versionCheck(VERSION, installInfo("npm", "/x"));
    expect(visible(npm.detail)).toBe(`${VERSION} · the newest`);
    expect(nodeCheck("v20.19.0", "binary").state).toBe("ok");
    expect(nodeCheck("v20.19.0", "npm").state).toBe("bad");
  });

  it("registers itself with Claude Code by the name a package manager gives it, else by its path", () => {
    expect(mcpAddLine(installInfo("npm", "/x"))).toBe(MCP_ADD);
    expect(mcpAddLine(binary("C:\\Users\\me\\scoop\\apps\\scmjs\\current\\scmjs.exe"))).toBe("claude mcp add scmjs -- scmjs mcp");
    expect(mcpAddLine(binary("/home/me/bin/scmjs-cli-linux-x64"))).toBe("claude mcp add scmjs -- /home/me/bin/scmjs-cli-linux-x64 mcp");
    expect(mcpAddLine(binary("C:\\Program Files\\scmjs\\scmjs.exe"))).toBe('claude mcp add scmjs -- "C:\\Program Files\\scmjs\\scmjs.exe" mcp');
    expect(mcpCheck("/nonexistent/.claude.json").detail).toContain("Claude Code not found");
  });
});

describe("the game's runners, started by the single executable", () => {
  it("tells the executable to run the script as Node, and only when it is the executable starting itself", () => {
    expect(runnerEnv(process.execPath, { A: "1" }, "binary")).toEqual({ A: "1", SCMJS_RUN_AS_NODE: "1" });
    expect(runnerEnv(`${process.execPath}-another`, { A: "1" }, "binary")).toBeUndefined();
    expect(runnerEnv(process.execPath, { A: "1" }, "npm")).toBeUndefined();
  });

  it("gives the script the argv Node would", () => {
    expect(scriptArgv(["/bin/scmjs", "scmjs", "run.mjs", "--engine", "e"], "/cache")).toEqual(["/bin/scmjs", resolve("/cache", "run.mjs"), "--engine", "e"]);
    expect(scriptArgv(["/bin/scmjs", "/bin/scmjs", "/abs/map.mjs"], "/cache")).toEqual(["/bin/scmjs", resolve("/abs/map.mjs")]);
    expect(scriptArgv(["/bin/scmjs", "scmjs"])).toBeNull();
  });
});

describe("the single executable's bundle", () => {
  it("has no top-level await in the command's modules: it is CommonJS", () => {
    const dir = join(import.meta.dirname, "..", "cli", "src");
    const found: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const source = ts.createSourceFile(f, readFileSync(join(dir, f), "utf8"), ts.ScriptTarget.Latest, true);
      const walk = (node: ts.Node): void => {
        if (ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node)) return;
        if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier)) found.push(`${f}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        ts.forEachChild(node, walk);
      };
      walk(source);
    }
    expect(found).toEqual([]);
  });
});
