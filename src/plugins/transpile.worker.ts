/**
 * The transpile worker: TypeScript is a few megabytes of JavaScript, and a plugin
 * written in TypeScript has to become JavaScript before the browser will `import()` it.
 * One request in, one answer out, matched by id (see `transpileClient.ts`). No type
 * check happens here — `transpileModule` strips the types and nothing more.
 */
import ts from "typescript";
import { transpileTs } from "./transpile";

export interface TranspileRequest {
  id: number;
  source: string;
  fileName: string;
}

export interface TranspileResponse {
  id: number;
  code?: string;
  error?: string;
}

self.onmessage = (e: MessageEvent<TranspileRequest>) => {
  const { id, source, fileName } = e.data;
  let response: TranspileResponse;
  try {
    response = { id, code: transpileTs(ts, source, fileName) };
  } catch (err) {
    response = { id, error: err instanceof Error ? err.message : String(err) };
  }
  postMessage(response);
};
