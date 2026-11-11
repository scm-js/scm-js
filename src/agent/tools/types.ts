/**
 * The agent's tools: what each one is called, the JSON schema Claude fills in, how much it
 * may change the map (which decides whether the user is asked first), a one-line
 * description for the transcript, and the code that runs it against the plugin API.
 *
 * Every write goes through `api.document.edit` / `update`, so each tool call is one undo
 * entry labelled `Claude: …`, dirties the right sections, repaints, and reaches the other
 * editors of a shared map — exactly like an edit made by hand.
 */
import type { PluginApi, Rect } from "../../plugins/api";
import type { JsonSchema } from "../schema";

/** `read` never changes the map; `write` does, undoably; `destructive` removes or replaces the user's work. */
export type ToolEffect = "read" | "write" | "destructive";

export interface ToolImage {
  mediaType: "image/png";
  /** Base64, no `data:` prefix. */
  data: string;
}

/** What a tool hands back to Claude: text (usually JSON), and pictures for the map tools. */
export type ToolOutput = string | { text: string; images?: ToolImage[] };

/** Where an edit landed, so the panel can flash it and, when the user wants, bring it on screen. */
export interface Touched {
  rect?: Rect;
  units?: number[];
  locations?: number[];
}

export interface ToolContext {
  readonly api: PluginApi;
  /** The undo label for an edit: `Claude: <text>`. */
  label(text: string): string;
  /** Tell the panel what an edit touched. */
  touched(target: Touched): void;
  readonly signal: AbortSignal;
}

export interface AgentTool<I = Record<string, unknown>> {
  name: string;
  description: string;
  schema: JsonSchema;
  effect: ToolEffect | ((input: I) => ToolEffect);
  /** The transcript's line for a call, in the user's terms: "Place 12 Zerg Zerglings for Player 2". */
  describe(input: I): string;
  run(input: I, ctx: ToolContext): ToolOutput | Promise<ToolOutput>;
}

/** A failure the model should read and act on ("No location 12. There are 9."). */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the registry holds tools of every input shape
export type AnyTool = AgentTool<any>;

export function effectOf(tool: AnyTool, input: unknown): ToolEffect {
  return typeof tool.effect === "function" ? tool.effect(input) : tool.effect;
}

/** Undo labels the agent writes start with this, which is how "undo the agent's edits" stays clear of the user's own. */
export const LABEL_PREFIX = "Claude: ";
