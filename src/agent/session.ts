/**
 * One conversation with Claude about one open map: the message history, the transcript
 * the panel draws, and the tool-use loop.
 *
 * The loop is the Messages API's manual one, streamed: send the history, show the text and
 * the tool calls as they arrive, run the tools the turn asked for (in order — they change
 * the map, so order matters), send every result back in one user message, and go round
 * until Claude ends its turn. The history is only ever appended to, never edited, which is
 * what keeps both the prompt cache and Claude's earlier reasoning valid from turn to turn.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaContentBlockParam, BetaMessage, BetaMessageParam, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { PluginApi } from "../plugins/api";
import { SYSTEM_PROMPT } from "./prompt";
import { validate } from "./schema";
import { mapState } from "./tools/map";
import { TOOL_BY_NAME, TOOL_DEFINITIONS } from "./tools/index";
import { effectOf, LABEL_PREFIX, ToolError, type ToolContext, type ToolEffect, type ToolOutput, type Touched } from "./tools/types";
import { MODELS, type AgentSettings } from "./settings";

export type ToolStatus = "streaming" | "approval" | "running" | "done" | "error" | "denied" | "stopped";

export type TranscriptItem =
  | { kind: "user"; id: number; text: string }
  | { kind: "text"; id: number; text: string; done: boolean }
  | { kind: "thinking"; id: number; text: string; done: boolean }
  | {
    kind: "tool"; id: number; toolUseId: string; name: string; title: string; status: ToolStatus; effect: ToolEffect;
    input?: unknown; result?: string; images?: string[];
  }
  | { kind: "notice"; id: number; level: "info" | "warn" | "error"; text: string; action?: "settings" }
  | { kind: "turn"; id: number; edits: number; undone: boolean; seconds: number };

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  /** The size of the last request's prompt, which is how full the context is. */
  context: number;
}

type Listener = () => void;

const MAX_ROUNDS = 60;
const TEXT_LIMIT = 100_000;

let nextId = 1;

export class AgentSession {
  readonly messages: BetaMessageParam[] = [];
  items: TranscriptItem[] = [];
  usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, context: 0 };
  busy = false;
  private abort: AbortController | null = null;
  private listeners = new Set<Listener>();
  private approvals = new Map<number, (ok: boolean) => void>();
  private allowAllThisTurn = false;
  private following = true;
  /** Something to tell Claude at the start of the next message (the user undid a turn). */
  private pendingNote = "";
  private readonly api: PluginApi;
  private readonly settings: () => AgentSettings;
  private readonly onBusy: (busy: boolean) => void;

  constructor(api: PluginApi, settings: () => AgentSettings, onBusy: (busy: boolean) => void) {
    this.api = api;
    this.settings = settings;
    this.onBusy = onBusy;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.items = [...this.items];
    for (const fn of this.listeners) fn();
  }

  private push(item: TranscriptItem): TranscriptItem {
    this.items.push(item);
    this.emit();
    return item;
  }

  private update(id: number, patch: Partial<TranscriptItem>): void {
    const n = this.items.findIndex((i) => i.id === id);
    if (n >= 0) this.items[n] = { ...this.items[n], ...patch } as TranscriptItem;
    this.emit();
  }

  /** The user's answer to a change waiting for approval. `all` allows the rest of this turn's changes too. */
  answer(id: number, ok: boolean, all = false): void {
    if (all) this.allowAllThisTurn = true;
    this.approvals.get(id)?.(ok);
    this.approvals.delete(id);
  }

  stop(): void {
    this.abort?.abort();
    for (const resolve of this.approvals.values()) resolve(false);
    this.approvals.clear();
  }

  reset(): void {
    this.stop();
    this.messages.length = 0;
    this.items = [];
    this.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, context: 0 };
    this.emit();
  }

  /** Undo the changes one finished turn made, as long as they are still the newest entries on the undo stack. */
  undoTurn(turnId: number): void {
    const turn = this.items.find((i) => i.id === turnId);
    if (!turn || turn.kind !== "turn" || turn.undone) return;
    let left = turn.edits;
    while (left > 0) {
      const top = this.api.document.history().undo;
      if (!top || !top.startsWith(LABEL_PREFIX)) break;
      this.api.document.undo();
      left--;
    }
    this.update(turnId, { undone: true });
    const undoneCount = turn.edits - left;
    this.push({ kind: "notice", id: nextId++, level: left ? "warn" : "info", text: left ? `Undid ${undoneCount} of ${turn.edits} change(s); the rest are under edits of your own, so they stay (Edit ▸ Undo reaches them).` : `Undid ${undoneCount} change(s).` });
    // Claude does not see this in its history; tell it at the start of the next message.
    this.pendingNote = `(The user undid the ${undoneCount} change(s) you made in that turn; the map is as it was before it.)`;
  }

  async send(text: string): Promise<void> {
    if (this.busy || !text.trim()) return;
    const settings = this.settings();
    this.busy = true;
    this.onBusy(true);
    this.allowAllThisTurn = false;
    this.following = settings.followEdits;
    this.abort = new AbortController();
    const started = performance.now();
    let edits = 0;
    this.push({ kind: "user", id: nextId++, text });
    const note = this.pendingNote ? `${this.pendingNote}\n\n` : "";
    this.pendingNote = "";
    this.messages.push({ role: "user", content: [{ type: "text", text: `<map_state>\n${mapState(this.api)}\n</map_state>\n\n${note}${text}` }] });

    const client = new Anthropic({
      apiKey: settings.apiKey || (settings.baseURL ? "set-by-proxy" : ""),
      baseURL: settings.baseURL || undefined,
      dangerouslyAllowBrowser: true,
      maxRetries: 2,
    });

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const message = await this.stream(client, settings);
        if (!message) return;
        this.messages.push({ role: "assistant", content: message.content as BetaContentBlockParam[] });
        const toolUses = message.content.filter((b): b is Extract<BetaContentBlock, { type: "tool_use" }> => b.type === "tool_use");

        if (message.stop_reason === "refusal") {
          this.push({ kind: "notice", id: nextId++, level: "warn", text: `Claude declined to continue${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : "."}` });
          if (toolUses.length) this.messages.push({ role: "user", content: toolUses.map((t) => this.stoppedResult(t.id, "Not run: the turn ended in a refusal.")) });
          return;
        }
        if (message.stop_reason === "max_tokens" && toolUses.length) {
          this.push({ kind: "notice", id: nextId++, level: "error", text: "The reply ran out of room in the middle of a tool call, so it was not run. Ask again with a smaller step." });
          this.messages.push({ role: "user", content: toolUses.map((t) => this.stoppedResult(t.id, "Not run: the input was cut off at max_tokens.")) });
          return;
        }
        if (message.stop_reason === "pause_turn") continue;
        if (toolUses.length === 0) return;

        const results: BetaToolResultBlockParam[] = [];
        for (const use of toolUses) {
          if (this.abort.signal.aborted) { results.push(this.stoppedResult(use.id, "Not run: the user pressed Stop.")); this.markTool(use.id, { status: "stopped" }); continue; }
          const { result, wrote } = await this.runTool(use);
          if (wrote) edits++;
          results.push(result);
        }
        this.messages.push({ role: "user", content: results });
        if (this.abort.signal.aborted) {
          this.push({ kind: "notice", id: nextId++, level: "info", text: "Stopped." });
          return;
        }
      }
      this.push({ kind: "notice", id: nextId++, level: "warn", text: `Stopped after ${MAX_ROUNDS} rounds of tool calls. Say "continue" to let it go on.` });
    } catch (err) {
      this.fail(err);
    } finally {
      for (const item of this.items) if ((item.kind === "text" || item.kind === "thinking") && !item.done) item.done = true;
      this.push({ kind: "turn", id: nextId++, edits, undone: false, seconds: Math.round((performance.now() - started) / 1000) });
      this.busy = false;
      this.abort = null;
      this.onBusy(false);
    }
  }

  /** One request, streamed into the transcript. Null when the user stopped it. */
  private async stream(client: Anthropic, settings: AgentSettings): Promise<BetaMessage | null> {
    const model = MODELS.find((m) => m.id === settings.model) ?? MODELS[0];
    const stream = client.beta.messages.stream({
      model: model.id,
      max_tokens: 64_000,
      system: [{ type: "text", text: SYSTEM_PROMPT }],
      tools: TOOL_DEFINITIONS,
      messages: this.messages,
      thinking: { type: "adaptive", display: settings.showThinking ? "summarized" : "omitted" },
      output_config: { effort: settings.effort },
      cache_control: { type: "ephemeral" },
      // A safety decline on the chosen model is re-run on a fallback model in the same call.
      ...(model.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    }, { signal: this.abort!.signal });

    const blocks = new Map<number, number>();
    try {
      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const b = event.content_block;
          if (b.type === "text") blocks.set(event.index, this.push({ kind: "text", id: nextId++, text: b.text ?? "", done: false }).id);
          else if (b.type === "thinking" && settings.showThinking) blocks.set(event.index, this.push({ kind: "thinking", id: nextId++, text: b.thinking ?? "", done: false }).id);
          else if (b.type === "tool_use") {
            const tool = TOOL_BY_NAME.get(b.name);
            blocks.set(event.index, this.push({ kind: "tool", id: nextId++, toolUseId: b.id, name: b.name, title: tool ? `${tool.name.replace(/_/g, " ")}…` : b.name, status: "streaming", effect: tool && typeof tool.effect === "string" ? tool.effect : "write" }).id);
          }
        } else if (event.type === "content_block_delta") {
          const id = blocks.get(event.index);
          if (id === undefined) continue;
          const item = this.items.find((i) => i.id === id);
          if (!item) continue;
          if (event.delta.type === "text_delta" && item.kind === "text") this.update(id, { text: item.text + event.delta.text });
          else if (event.delta.type === "thinking_delta" && item.kind === "thinking") this.update(id, { text: item.text + event.delta.thinking });
        } else if (event.type === "content_block_stop") {
          const id = blocks.get(event.index);
          const item = id !== undefined ? this.items.find((i) => i.id === id) : undefined;
          if (item && (item.kind === "text" || item.kind === "thinking")) this.update(item.id, { done: true });
        }
      }
      const message = await stream.finalMessage();
      this.count(message, settings);
      // Empty thinking rows (display omitted, or a block with no summary) are noise.
      this.items = this.items.filter((i) => !(i.kind === "thinking" && !i.text.trim()));
      this.emit();
      return message;
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError || this.abort?.signal.aborted) {
        this.push({ kind: "notice", id: nextId++, level: "info", text: "Stopped." });
        // A tool call cut off mid-stream was never added to the history, so its row is all that is left of it.
        for (const item of this.items) if (item.kind === "tool" && item.status === "streaming") item.status = "stopped";
        this.emit();
        return null;
      }
      throw err;
    }
  }

  private count(message: BetaMessage, settings: AgentSettings): void {
    const u = message.usage;
    const model = MODELS.find((m) => m.id === settings.model) ?? MODELS[0];
    const read = u.cache_read_input_tokens ?? 0, write = u.cache_creation_input_tokens ?? 0;
    this.usage = {
      input: this.usage.input + u.input_tokens,
      output: this.usage.output + u.output_tokens,
      cacheRead: this.usage.cacheRead + read,
      cacheWrite: this.usage.cacheWrite + write,
      cost: this.usage.cost + (u.input_tokens * model.price.input + write * model.price.input * 1.25 + read * model.price.cacheRead + u.output_tokens * model.price.output) / 1_000_000,
      context: u.input_tokens + read + write,
    };
  }

  private markTool(toolUseId: string, patch: Partial<Extract<TranscriptItem, { kind: "tool" }>>): Extract<TranscriptItem, { kind: "tool" }> | undefined {
    const item = this.items.find((i): i is Extract<TranscriptItem, { kind: "tool" }> => i.kind === "tool" && i.toolUseId === toolUseId);
    if (item) this.update(item.id, patch);
    return item;
  }

  private stoppedResult(id: string, text: string): BetaToolResultBlockParam {
    return { type: "tool_result", tool_use_id: id, is_error: true, content: text };
  }

  private needsApproval(effect: ToolEffect): boolean {
    if (effect === "read" || this.allowAllThisTurn) return false;
    const mode = this.settings().approval;
    return mode === "all" || (mode === "destructive" && effect === "destructive");
  }

  private async runTool(use: { id: string; name: string; input: unknown }): Promise<{ result: BetaToolResultBlockParam; wrote: boolean }> {
    const tool = TOOL_BY_NAME.get(use.name);
    const fail = (text: string, status: ToolStatus = "error") => {
      this.markTool(use.id, { status, result: text });
      return { result: { type: "tool_result" as const, tool_use_id: use.id, is_error: true, content: text }, wrote: false };
    };
    if (!tool) return fail(`There is no tool called ${use.name}.`);
    const input = (use.input ?? {}) as Record<string, unknown>;
    const errors = validate(tool.schema, input);
    let title = tool.name;
    try { title = tool.describe(input); } catch { /* a malformed input describes badly; the validation error says why */ }
    const effect = effectOf(tool, input);
    this.markTool(use.id, { title, input, effect });
    if (errors.length) return fail(`The input does not fit the tool's schema: ${errors.join("; ")}. Fix it and call again.`);

    if (this.needsApproval(effect)) {
      const item = this.markTool(use.id, { status: "approval" });
      const ok = await new Promise<boolean>((resolve) => {
        if (!item || this.abort?.signal.aborted) return resolve(false);
        this.approvals.set(item.id, resolve);
      });
      if (!ok) return fail(this.abort?.signal.aborted ? "Not run: the user pressed Stop." : "The user declined this change. Ask what they would like instead, or carry on without it.", "denied");
    }

    this.markTool(use.id, { status: "running" });
    const ctx: ToolContext = {
      api: this.api,
      label: (text) => `${LABEL_PREFIX}${text}`,
      touched: (t) => this.show(t),
      signal: this.abort!.signal,
    };
    try {
      const out: ToolOutput = await tool.run(input, ctx);
      const text = typeof out === "string" ? out : out.text;
      const images = typeof out === "string" ? [] : out.images ?? [];
      const clipped = text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n… (cut at ${TEXT_LIMIT} characters)` : text;
      this.markTool(use.id, { status: "done", result: clipped, images: images.map((im) => `data:${im.mediaType};base64,${im.data}`) });
      const content: BetaToolResultBlockParam["content"] = images.length
        ? [{ type: "text", text: clipped }, ...images.map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.mediaType, data: im.data } }))]
        : clipped;
      return { result: { type: "tool_result", tool_use_id: use.id, content }, wrote: effect !== "read" };
    } catch (err) {
      const text = err instanceof ToolError ? err.message : `The tool failed: ${err instanceof Error ? err.message : String(err)}`;
      if (!(err instanceof ToolError)) this.api.log("tool failed", use.name, err);
      return fail(text);
    }
  }

  /** Flash what an edit touched and, while the user leaves the view alone, bring it on screen. */
  private show(t: Touched): void {
    const api = this.api;
    if (t.units?.length) api.view.flash({ units: t.units });
    else if (t.locations?.length) api.view.flash({ locations: t.locations });
    else if (t.rect) api.view.flash({ rect: t.rect });
    const rect = t.rect;
    if (this.following && rect) {
      void api.view.reveal(rect, { fit: true }).then((shown) => { if (!shown) this.following = false; });
    }
  }

  private fail(err: unknown): void {
    let text: string;
    let action: "settings" | undefined;
    if (err instanceof Anthropic.AuthenticationError) { text = "The Anthropic API refused the key. Check it in the agent's settings."; action = "settings"; }
    else if (err instanceof Anthropic.PermissionDeniedError) { text = `The key may not use this model or feature: ${err.message}`; action = "settings"; }
    else if (err instanceof Anthropic.NotFoundError) { text = `Not found: ${err.message}. Check the model and the API address in settings.`; action = "settings"; }
    else if (err instanceof Anthropic.RateLimitError) text = "Rate limited by the API. Wait a moment and send again.";
    else if (err instanceof Anthropic.BadRequestError) text = `The API rejected the request: ${err.message}`;
    else if (err instanceof Anthropic.APIConnectionError) { text = `Could not reach the API (${err.message}). Check the network, or the API address in settings.`; action = "settings"; }
    else if (err instanceof Anthropic.APIError) text = `API error ${err.status ?? ""}: ${err.message}`;
    else text = err instanceof Error ? err.message : String(err);
    this.push({ kind: "notice", id: nextId++, level: "error", text, action });
    // A request that failed leaves the history ending in the user's message (or tool results),
    // which is a valid place to resume from: the next send appends after it.
  }
}
