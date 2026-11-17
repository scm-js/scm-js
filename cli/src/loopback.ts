/**
 * The pages the commands serve on the loopback address for a browser to open: the sign-in, a file handed to the
 * editor or the play page, a mod handed to the play page, a replay drawn for a clip, a map linked to the editor. Each
 * listens on 127.0.0.1 alone, at a port the system picks, under a random path; each caller keeps its own page and
 * routes.
 */
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";

/** The random first part of a loopback page's path: nothing under it answers without it. */
export const loopbackToken = (): string => randomBytes(12).toString("hex");

/** A server on 127.0.0.1 at a port the system picks, listening once this returns. */
export async function listenLoopback(handler: RequestListener): Promise<{ server: Server; port: number; origin: string }> {
  const server = createServer(handler);
  await new Promise<void>((r, j) => { server.once("error", j); server.listen(0, "127.0.0.1", () => r()); });
  const port = (server.address() as { port: number }).port;
  return { server, port, origin: `http://127.0.0.1:${port}` };
}

/** A request's address, for its path and query. */
export const requestUrl = (req: IncomingMessage): URL => new URL(req.url ?? "/", "http://127.0.0.1");

/** A request's (or a response's) body, whole. */
export const readBody = (req: IncomingMessage): Promise<Buffer> => new Promise((r, j) => { const parts: Buffer[] = []; req.on("data", (c: Buffer) => parts.push(c)); req.on("end", () => r(Buffer.concat(parts))); req.on("error", j); });

/** A request's body as text, or "" past `max` characters or on an error. */
export function readText(req: IncomingMessage, max = 16_384): Promise<string> {
  return new Promise((resolveBody) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => { text += c; if (text.length > max) { text = ""; req.destroy(); } });
    req.on("end", () => resolveBody(text));
    req.on("error", () => resolveBody(""));
  });
}

/** What the opened page says back, forwarded by the loopback page. */
export interface PageMessage { type: string; [key: string]: unknown }

/**
 * A message the loopback page posts (`/<token>/message`): answered 204 at once, then handed to `on` when it is JSON
 * with a `type`. Anything else is not ours, and is dropped.
 */
export function takeMessage(req: IncomingMessage, res: ServerResponse, on: (m: PageMessage) => void): void {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    res.writeHead(204).end();
    let m: PageMessage | null = null;
    try { m = JSON.parse(Buffer.concat(chunks).toString("utf8")) as PageMessage; } catch { /* not ours */ }
    if (!m || typeof m.type !== "string") return;
    on(m);
  });
}

/**
 * What a loopback page's requests settle (the file taken, the session posted), waited for: `within` starts the clock
 * and settles with `timedOut` when it runs out first; `stop` clears the clock, as soon as the wait is over or given up.
 */
export function pageWait<T>(): { settle: (value: T) => void; within: (ms: number, timedOut: T) => Promise<T>; stop: () => void } {
  let settle: (value: T) => void = () => {};
  const settled = new Promise<T>((r) => { settle = r; });
  let timer: NodeJS.Timeout | undefined;
  return {
    settle: (value) => settle(value),
    within: (ms, timedOut) => { timer = setTimeout(() => settle(timedOut), ms); return settled; },
    stop: () => clearTimeout(timer),
  };
}
