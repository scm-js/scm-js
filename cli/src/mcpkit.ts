/**
 * What the MCP tools share: a result as the model reads it, a failure as a result, the checks every path argument
 * passes (no `-`, inside the server's folder, no links), and the arguments several tools take alike.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { isWebAddress } from "./weblink";
import { LinkError } from "./link";
import { CliError, visible, nearPath } from "./ui";

export const path = z.string().describe("the map file: .scm, .scx or .chk");
export const out = z.string().optional().describe("write the result to this file instead of over the map");

/** The result as the model reads it: text lines (without colour), and the command's JSON shape beside them. */
export function ok(lines: string[] | string, data?: unknown): CallToolResult {
  const text = typeof lines === "string" ? lines : lines.map(visible).join("\n");
  return { content: [{ type: "text", text }], ...(data === undefined ? {} : { structuredContent: toJson(data) as Record<string, unknown> }) };
}
/** Failures are results the model can read, not protocol errors: the command's message and its hint. */
function failed(e: unknown): CallToolResult {
  // A hint about quoting a name is for a shell; the model passes the name as it is.
  const hint = e instanceof CliError ? e.hint?.replace(/;? ?put quotes round a name with spaces or brackets\./, ".") : null;
  const text = e instanceof CliError ? `${e.message}${hint ? `\n${hint}` : ""}` : e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text", text }] };
}

/**
 * The SDK's words for arguments that do not fit, said as the model reads them: "Input validation error: Invalid
 * arguments for tool map_info: Invalid input: expected string, received undefined at path" is "map_info: `path` is
 * missing (a string)". What it does not know stays as the SDK said it.
 */
export function argumentError(text: string): string {
  const m = /^(?:MCP error -?\d+: )?Input validation error: Invalid arguments for tool (\S+): ([^]*)$/.exec(text);
  if (!m) return text;
  const lines = m[2].split("\n").map((l) => l.replace(/^Invalid input: /, "")
    .replace(/^expected (\w+), received undefined at (\S+)$/, (_, kind: string, at: string) => `\`${at}\` is missing (${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind})`)
    .replace(/^expected (\w+), received (\w+) at (\S+)$/, (_, kind: string, got: string, at: string) => `\`${at}\` takes ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind}, not ${/^[aeiou]/.test(got) ? "an" : "a"} ${got}`));
  return `${m[1]}: ${lines.join("\n")}`;
}

/** The words for arguments a tool does not take, with the ones it does: a misspelt `dry_run` must not write a map. */
export function unknownArguments(name: string, keys: readonly string[], takes: readonly string[]): string {
  const list = (ks: readonly string[]) => ks.map((k) => `\`${k}\``).join(", ");
  return `${list(keys)} ${keys.length === 1 ? "is not an argument" : "are not arguments"} of ${name}: it takes ${takes.length ? list(takes) : "none"}`;
}
/** JSON as `--json` prints it: typed arrays and maps become plain values. */
const toJson = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (x instanceof Uint8Array ? [...x] : x instanceof Map ? Object.fromEntries(x) : x)));

export const written = (w: { path: string; bytes: number; live?: boolean }) => (w.live
  ? `Changed in the editor, where ${nearPath(w.path)} is linked: one undo step there, not saved to the file yet (editor_save saves it)`
  : `Written to ${nearPath(w.path)} (${w.bytes} bytes)`);

/**
 * `-` is standard input or output to the commands, and both are the protocol here: a tool reading `-` would eat the
 * client's messages, one writing to it would put a map in the middle of them. Every path argument is checked.
 */
export function noPipe(...paths: (string | undefined)[]): void {
  if (paths.includes("-")) throw new CliError("`-` (standard input or output) is not a file here: the server speaks the protocol on it.", "Name a file on this computer.", 2);
}

/** The arguments that name a file or folder on this computer (`starcraft`, the game's own folder, is not confined). */
const PATH_ARGS = ["path", "out", "a", "b", "paths", "replays", "baseline", "mod", "map", "bot", "folder", "folders", "replay", "plugin"] as const;

/**
 * A path a tool was given that is outside `root`, the folder the server was started in: the server an AI drives keeps
 * to that folder unless started with --allow-outside. `bot` may be a play page bot's key and `plugin` a github: or
 * URL source; neither is a path then.
 */
export function outsideRoot(args: Record<string, unknown>, root: string): string | null {
  for (const key of PATH_ARGS) {
    const v = args[key];
    for (const p of Array.isArray(v) ? v : [v]) {
      if (typeof p !== "string" || p === "" || p === "-") continue;
      if (key === "plugin" && /^(github:|https?:)/i.test(p)) continue;
      if (key === "bot" && !/[\\/.]/.test(p)) continue;
      const r = relative(root, resolve(root, p));
      if (r.startsWith("..") || isAbsolute(r)) return p;
    }
  }
  return null;
}

/**
 * A scmjs.dev link given where a file is named (`plugin` takes a URL of its own). A server kept to a folder reads no
 * links: reaching the network is a reach beyond that folder, and a model would otherwise fetch whatever a page it
 * read told it to. Started with --allow-outside, the tools read links as the commands do.
 */
export function webLinkArg(args: Record<string, unknown>): string | null {
  for (const key of PATH_ARGS) {
    if (key === "plugin") continue;
    const v = args[key];
    for (const p of Array.isArray(v) ? v : [v]) if (typeof p === "string" && isWebAddress(p)) return p;
  }
  return null;
}

export type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
/** Runs `fn` as a tool: its lines become the result, a CliError the error text. */
export const tool = <T>(fn: (args: T, extra: Extra) => Promise<CallToolResult>, root: string | null = null) => async (args: T, extra: Extra): Promise<CallToolResult> => {
  try {
    const a = args as { path?: string; out?: string; a?: string; b?: string; paths?: string[] };
    noPipe(a.path, a.out, a.a, a.b, ...(a.paths ?? []));
    const web = root === null ? null : webLinkArg(args as Record<string, unknown>);
    if (web !== null) throw new CliError(`${web} is a link, and the tools read files in the folder the server was started in (${root})`, "The person can download it with scmjs library get, or start the server with scmjs mcp --allow-outside, which lets the tools read scmjs.dev links too.", 2);
    const outside = root === null ? null : outsideRoot(args as Record<string, unknown>, root);
    if (outside !== null) throw new CliError(`${outside} is outside the folder the server was started in (${root})`, "The tools read and write files in that folder only; the person can start the server with scmjs mcp --allow-outside to lift that.", 2);
    try {
      return await fn(args, extra);
    } catch (e) {
      // The person edited the linked map in the editor while the tool ran: once more, from what the editor has now.
      if (e instanceof LinkError && e.code === "changed") return await fn(args, extra);
      throw e;
    }
  } catch (e) { return failed(e); }
};

/**
 * The longest run each game tool takes: ten minutes of play, a few seconds of running. A trace's result is a line
 * per trigger; a cost's carries five numbers a frame (about 150 KB of structured data at the cap), which is as much
 * as a model should be handed in one result.
 */
export const MAX_FRAMES = { trace: 24 * 60 * 10, cost: 24 * 60 * 10 } as const;
/** The run the commands make by default (`--frames 2400`): 100 seconds of play. */
export const FRAMES = 2400;
/** Columns for a trigger's text in the trace and cost tables: wider than a terminal, since nobody wraps them. */
export const WIDTH = 140;

/**
 * Where the game tools' engine and weigher come from when not from the play page and beside the command: for tests,
 * which hand the server a staged folder and a stand-in. A person sets `SCMJS_PLAY_URL` in the client's settings instead.
 */
export interface McpOptions {
  engine?: string; weigh?: string;
  /** Keep the tools' paths inside this folder (the command passes its working directory unless --allow-outside). */
  root?: string;
  /** The account tools' server, session file, fetch, replay sync state and replay folders: for tests, which hand a stand-in. */
  account?: McpAccountOptions;
}

export interface McpAccountOptions {
  server?: string; file?: string; fetchImpl?: typeof fetch;
  stateFile?: string;
  /** The replay folders `replay_sync` takes when none is named (StarCraft's own, found as the command finds them). */
  replayFolders?: () => string[];
  settleMs?: number;
}

/** The copy of the game, named: the same argument on every tool that reads one, so said briefly. */
export const starcraftArg = z.string().optional().describe("the person's StarCraft folder, when doctor found none");

/** What a tool family is handed: the server's options and the folder its paths keep to (null: anywhere). */
export interface McpContext { options: McpOptions; root: string | null }
/** The server's registerTool, as createMcpServer wraps it (strict arguments, the link's label, the folder). */
export type Reg = McpServer["registerTool"];
