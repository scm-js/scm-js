/**
 * The MCP bundle of `scmjs mcp` (scripts/lib/mcpb.mjs, scripts/lib/zip.mjs) and what the server does for it
 * (`--folder`, an optional setting left empty). The bundle itself is built and run as an app runs it by
 * scripts/check-cli-binary.mjs --mcpb on the Windows and macOS runners; the manifest is validated there by the packer.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dropUnsetSettings, enterFolder } from "../cli/src/mcp";
import { doctorForTools } from "../cli/src/mcpgame";
import type { Check } from "../cli/src/doctor";
import { CliError, visible } from "../cli/src/ui";
// @ts-expect-error: a plain .mjs module of the build
import { appConfig, firstSentence, mcpbAsset, mcpbManifest } from "../scripts/lib/mcpb.mjs";
// @ts-expect-error: a plain .mjs module of the build
import { readZip, zip } from "../scripts/lib/zip.mjs";

const tools = [{ name: "map_info", description: "What a map holds: its size and players. More words." }];
const manifest = mcpbManifest({ version: "1.2.3", platform: "win32", exe: "server/scmjs.exe", tools });

describe("the MCP bundle's manifest", () => {
  it("starts the executable in the bundle with the maps folder asked for at install", () => {
    expect(manifest.server).toMatchObject({ type: "binary", entry_point: "server/scmjs.exe" });
    expect(manifest.server.mcp_config.command).toBe("${__dirname}/server/scmjs.exe");
    expect(manifest.server.mcp_config.args).toEqual(["mcp", "--folder", "${user_config.maps_folder}"]);
    expect(manifest.user_config.maps_folder).toMatchObject({ type: "directory", required: true });
    // Claude Desktop shows a default's ${DOCUMENTS} as typed and passes it on unreplaced: the person browses instead.
    expect(manifest.user_config.maps_folder.default).toBeUndefined();
    expect(manifest.user_config.starcraft).toMatchObject({ type: "directory", required: false });
    expect(manifest.server.mcp_config.env).toEqual({ SCMJS_STARCRAFT: "${user_config.starcraft}", SCMJS_MCPB: "1" });
    expect(manifest.compatibility).toEqual({ platforms: ["win32"] });
    expect(manifest.version).toBe("1.2.3");
  });

  it("lists the tools by the first sentence of each", () => {
    expect(manifest.tools).toEqual([{ name: "map_info", description: "What a map holds: its size and players." }]);
    expect(firstSentence("v1.2 is out. Then more")).toBe("v1.2 is out.");
    expect(firstSentence("x".repeat(300))).toHaveLength(200);
  });

  it("is named apart from the executables' archives and the desktop app's files", () => {
    expect(mcpbAsset("windows", "x64")).toBe("scmjs-mcp-windows-x64.mcpb");
    expect(mcpbAsset("macos", "arm64")).toBe("scmjs-mcp-macos-arm64.mcpb");
  });

  it("is filled in as the app fills it: the person's folder, the default, or the variable left as written", () => {
    const app = appConfig(manifest, "C:/ext", { maps_folder: "D:/Maps" }, { DOCUMENTS: "C:/Docs" });
    expect(app).toEqual({ command: "C:/ext/server/scmjs.exe", args: ["mcp", "--folder", "D:/Maps"], env: { SCMJS_STARCRAFT: "${user_config.starcraft}", SCMJS_MCPB: "1" } });
    expect(appConfig(manifest, "/ext", { starcraft: "/games/sc" }).env.SCMJS_STARCRAFT).toBe("/games/sc");
  });
});

describe("zip files", () => {
  it("keep a file's Unix mode, which an app unpacking a bundle on a Mac needs for the executable", () => {
    const files = readZip(zip([
      { name: "manifest.json", bytes: Buffer.from("{}") },
      { name: "server/scmjs", bytes: Buffer.from("#!/bin/sh\n".repeat(100)), mode: 0o755 },
    ]));
    expect(files.map((f: { name: string; mode: number | null }) => [f.name, f.mode])).toEqual([["manifest.json", null], ["server/scmjs", 0o755]]);
    expect(files[1].bytes.toString()).toBe("#!/bin/sh\n".repeat(100));
  });
});

describe("scmjs mcp for an app that starts it elsewhere", () => {
  const here = process.cwd();
  afterEach(() => process.chdir(here));

  it("works in the folder --folder names, and refuses one that is not there", () => {
    const dir = mkdtempSync(join(tmpdir(), "scmjs-folder-"));
    try {
      expect(enterFolder(dir)).toBe(dir);
      expect(process.cwd()).toBe(realpathSync(dir));
      process.chdir(here);
      expect(() => enterFolder(join(dir, "nothing"))).toThrow(CliError);
      expect(() => enterFolder(join(dir, "nothing"))).toThrow(/No folder .*nothing/);
      writeFileSync(join(dir, "a.scx"), "");
      expect(() => enterFolder(join(dir, "a.scx"))).toThrow(/is a file, not a folder/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("takes a setting the app passed empty, or as its own variable, as not set", () => {
    const env: NodeJS.ProcessEnv = { SCMJS_STARCRAFT: "${user_config.starcraft}", SCMJS_PLAY_URL: "", SCMJS_SESSION: "/s.json", PATH: "" };
    dropUnsetSettings(env);
    expect(env).toEqual({ SCMJS_SESSION: "/s.json", PATH: "" });
  });
});

describe("doctor, as the tools see it", () => {
  const report = {
    blocked: false,
    checks: [
      { what: "Node", state: "ok", detail: "v24.13.0 · win32 x64" },
      { what: "scmjs", state: "ok", detail: "0.17.0 · the newest · single executable, from an MCP bundle (.mcpb)" },
      { what: "TypeScript", state: "warn", detail: "not found", fix: "npm install typescript", note: "scmjs map build … compile with it." },
      { what: "Docker", state: "warn", detail: "not found" },
      { what: "StarCraft", state: "ok", detail: "Remastered · C:\\Program Files (x86)\\StarCraft", path: "C:\\Program Files (x86)\\StarCraft" },
      { what: "Game engine", state: "ok", detail: "not fetched yet", engine: { dir: "/c/engine", build: null, runners: [] } },
      { what: "Browser", state: "warn", detail: "not found" },
      { what: "ffmpeg", state: "ok", detail: "not installed" },
      { what: "Desktop app", state: "ok", detail: "not installed" },
      { what: "MCP", state: "ok", detail: "started by your AI app, from an MCP bundle" },
      { what: "scmjs.dev", state: "ok", detail: "not signed in", fix: '& "C:\\x\\scmjs.exe" login' },
    ] as Check[],
  };

  it("leaves out what no tool uses, and says what the rest is for", () => {
    // The bundle carries TypeScript beside its executable, so a map maker's check finds it.
    const carried = { ...report, checks: report.checks.map((c) => (c.what === "TypeScript" ? { what: "TypeScript", state: "ok", detail: "6.0.3 · C:\\x\\typescript\\lib\\typescript.js" } as Check : c)) };
    const { text, json } = doctorForTools(carried);
    const plain = text.map(visible).join("\n");
    for (const gone of ["Docker", "Browser", "ffmpeg", "Desktop app", "Claude Code", "npm", "scmjs.exe"]) expect(plain).not.toContain(gone);
    expect(plain).toContain("fetch it from the play page by themselves the first time one runs");
    expect(plain).toContain("account_login signs the person in, in their browser");
    expect(plain).toContain("  Also used");
    expect(plain).toMatch(/✔ TypeScript +6\.0\.3/);
    expect(plain).toMatch(/✔ Every tool is ready on this computer\.$/);
    expect(json.ready.every((g) => g.ok)).toBe(true);
    expect(json.checks.map((c) => c.what)).toEqual(["Node", "scmjs", "TypeScript", "StarCraft", "Game engine", "scmjs.dev"]);
  });

  it("says so when there is no TypeScript a build can use, and that only the build waits on it", () => {
    const { text, json } = doctorForTools(report);
    const plain = text.map(visible).join("\n");
    expect(plain).toContain("map_build and the compile check of map_script_import use it (TypeScript 6); every other tool works without.");
    expect(plain).not.toMatch(/Every tool is ready/);
    expect(json.ready.filter((g) => !g.ok)).toEqual([{ commands: "map_build, and the compile check of map_script_import", ok: false, lacks: "TypeScript" }]);
  });
});
