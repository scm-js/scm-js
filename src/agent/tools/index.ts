/**
 * Every tool the agent has, in a fixed order. The order is part of the prompt cache's
 * prefix (tools render first), so it must never depend on anything that varies between
 * requests.
 */
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { locationTools } from "./locations";
import { mapTools } from "./map";
import { scenarioTools } from "./scenario";
import { terrainTools } from "./terrain";
import { triggerTools } from "./triggers";
import { unitTools } from "./units";
import type { AnyTool } from "./types";

export const TOOLS: readonly AnyTool[] = [...mapTools, ...unitTools, ...locationTools, ...triggerTools, ...scenarioTools, ...terrainTools];

export const TOOL_BY_NAME: ReadonlyMap<string, AnyTool> = new Map(TOOLS.map((t) => [t.name, t]));

/** The tool definitions as the Messages API takes them; inputs stream as they are written. */
export const TOOL_DEFINITIONS: BetaTool[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.schema as BetaTool["input_schema"],
  eager_input_streaming: true,
}));
