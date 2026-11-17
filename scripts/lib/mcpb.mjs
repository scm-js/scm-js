// The MCP bundle (.mcpb) of `scmjs mcp`: the single executable with a manifest, which Claude Desktop and other AI apps
// install from one file, asking the person for their maps folder (docs/ai-tools.md "Setting it up"). The bundle is
// built per platform beside the executable's archive (scripts/build-cli-binary.mjs --archive) and run as the app runs
// it by scripts/check-cli-binary.mjs --mcpb. The format is the one `npx @anthropic-ai/mcpb` packs and validates
// (github.com/modelcontextprotocol/mcpb, MANIFEST.md); the build validates each manifest with that command.
import { spawn } from "node:child_process";

/** The packer's command line, pinned, through npx as postject is: only the build runs it. */
export const MCPB_CLI = "@anthropic-ai/mcpb@2.1.2";

/** The asset's name: beside `scmjs-cli-<os>-<arch>.<zip|tar.gz>`, whose names it must not equal but for case. */
export const mcpbAsset = (os, arch) => `scmjs-mcp-${os}-${arch}.mcpb`;

/** The first sentence of a tool's description, for the list the app shows before it installs the bundle. */
export function firstSentence(text) {
  const one = text.replace(/\s+/g, " ").trim();
  const end = one.search(/\.(\s|$)/);
  const cut = end >= 0 ? one.slice(0, end + 1) : one;
  return cut.length > 200 ? `${cut.slice(0, 199).trimEnd()}…` : cut;
}

/**
 * The manifest for one platform's bundle. `exe` is the executable's path inside the bundle; `tools` the server's own
 * list (name, description). The maps folder is asked for (Browse, no default), and handed over as `--folder`: an app starts the server in a
 * folder of its own choosing, and the tools keep to the one folder they work in. The StarCraft folder may be left
 * empty, in which case the app passes its `${user_config.starcraft}` unreplaced and the server drops it
 * (`dropUnsetSettings`). `SCMJS_MCPB` tells `about` and `doctor` how the executable was installed.
 */
export function mcpbManifest({ version, platform, exe, tools }) {
  return {
    manifest_version: "0.3",
    name: "scmjs",
    display_name: "scmJS",
    version,
    description: "StarCraft: Brood War maps on your computer: read them, check them, change them, and watch the changes in the scmJS editor.",
    long_description: [
      "Ask about the maps in your maps folder and have them changed: what a map holds and what Check Map finds, its triggers and strings as text, units, locations, terrain, doodads, players and forces, a new melee map from a seed.",
      "With a copy of StarCraft on the computer, the tools also draw a map, read a melee map's layout and run a map's triggers in the game.",
      "Ask to open the map in the scmJS editor and each change arrives there as one step you can undo.",
      "The tools read and write files in the maps folder you choose, and nowhere else. Sharing a map or replay to scmjs.dev, or deleting one there, is described to you first and done only when you agree.",
    ].join("\n\n"),
    author: { name: "scmJS", url: "https://scmjs.dev" },
    repository: { type: "git", url: "https://github.com/scm-js/scm-js" },
    homepage: "https://scmjs.dev",
    documentation: "https://docs.scmjs.dev/ai-tools/",
    support: "https://github.com/scm-js/scm-js/issues",
    icon: "icon.png",
    server: {
      type: "binary",
      entry_point: exe,
      mcp_config: {
        command: `\${__dirname}/${exe}`,
        args: ["mcp", "--folder", "${user_config.maps_folder}"],
        env: { SCMJS_STARCRAFT: "${user_config.starcraft}", SCMJS_MCPB: "1" },
      },
    },
    tools: tools.map((t) => ({ name: t.name, description: firstSentence(t.description ?? "") })),
    tools_generated: false,
    keywords: ["StarCraft", "Brood War", "map editor", "scm", "scx", "triggers"],
    license: "MIT",
    privacy_policies: ["https://scmjs.dev/privacy.html"],
    compatibility: { platforms: [platform] },
    user_config: {
      maps_folder: {
        type: "directory",
        title: "Maps folder",
        description: "The folder your maps are in. The tools read and write files in this folder and the folders inside it, and nowhere else.",
        // No default: Claude Desktop shows a default's `${DOCUMENTS}` as typed, does not count it as filled in, and
        // would hand it to the server unreplaced. The person picks the folder with Browse.
        required: true,
      },
      starcraft: {
        type: "directory",
        title: "StarCraft folder (optional)",
        description: "Only needed when scmJS does not find your copy of StarCraft by itself. Pictures of a map, terrain, doodads and running a map in the game use it.",
        required: false,
      },
    },
  };
}

/**
 * The command, arguments and environment an app makes of `manifest` for a bundle unpacked in `dir`, with `userConfig`
 * as the person filled in the install dialog: the variable rules of the packer's own `getMcpConfigForManifest`
 * (`${__dirname}`, `${DOCUMENTS}` and the like, `${user_config.x}` from the person or the field's default; a field
 * with neither stays as written). For the check, which runs the bundle the way an app does.
 */
export function appConfig(manifest, dir, userConfig, systemDirs = {}) {
  const values = { __dirname: dir, ...systemDirs };
  const merged = {};
  for (const [k, field] of Object.entries(manifest.user_config ?? {})) if (field.default !== undefined) merged[k] = field.default;
  Object.assign(merged, userConfig);
  for (const [k, v] of Object.entries(merged)) values[`user_config.${k}`] = String(v);
  const fill = (s) => s.replace(/\$\{([^}]+)\}/g, (all, name) => (name in values ? values[name] : all));
  const { command, args = [], env = {} } = manifest.server.mcp_config;
  return { command: fill(command), args: args.map(fill), env: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, fill(v)])) };
}

/**
 * Starts an MCP server, sends initialize and then `requests` (each `{ method, params }`), and resolves with the
 * answers in order and what it wrote to stderr, then ends it. Rejects after `timeout` ms without all the answers.
 */
export function askServer(command, args, { cwd, env, timeout = 20000 } = {}, requests = []) {
  return new Promise((resolveAll, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const answers = new Map();
    const timer = setTimeout(() => { child.kill(); reject(new Error(`no answer from ${command}: ${out}${err}`)); }, timeout);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.stderr.on("data", (b) => { err += b; });
    child.stdout.on("data", (b) => {
      out += b;
      const lines = out.split("\n");
      out = lines.pop();
      for (const line of lines) {
        try { const m = JSON.parse(line); if (typeof m.id === "number") answers.set(m.id, m); } catch { /* not a message */ }
      }
      // Once every request has its answer, the pipe is closed and the server ends by itself.
      if (requests.every((_, i) => answers.has(i + 2))) child.stdin.end();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (requests.every((_, i) => answers.has(i + 2))) resolveAll({ answers: requests.map((_, i) => answers.get(i + 2)), stderr: err, code });
      else reject(new Error(`${command} ended (${code}) without answering: ${err.trim() || out}`));
    });
    const send = (m) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
    send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "scmjs-build", version: "1" } } });
    send({ method: "notifications/initialized" });
    requests.forEach((r, i) => send({ id: i + 2, ...r }));
  });
}
