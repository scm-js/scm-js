/**
 * The compile worker: TypeScript is a few megabytes of JavaScript and a program check
 * takes tens of milliseconds, neither of which belongs on the main thread while the
 * user types. One request in, one result out, matched by id (see `compileClient.ts`).
 */
import ts from "typescript";
import { compileScript, type CompileOptions, type CompileResult } from "./compiler";
import { transpileTs } from "../plugins/transpile";

export interface CompileRequest {
  id: number;
  source: string;
  declarations: string;
  options?: CompileOptions;
}

export interface CompileResponse {
  id: number;
  result?: CompileResult;
  error?: string;
}

/** Plain TypeScript → JavaScript, no type check — what the plugin loader needs for a `.ts` entry file. */
export interface TranspileRequest {
  kind: "transpile";
  id: number;
  source: string;
  fileName: string;
}

export interface TranspileResponse {
  kind: "transpile";
  id: number;
  code?: string;
  error?: string;
}

self.onmessage = (e: MessageEvent<CompileRequest | TranspileRequest>) => {
  if ("kind" in e.data && e.data.kind === "transpile") {
    const { id, source, fileName } = e.data;
    let response: TranspileResponse;
    try {
      response = { kind: "transpile", id, code: transpileTs(ts, source, fileName) };
    } catch (err) {
      response = { kind: "transpile", id, error: err instanceof Error ? err.message : String(err) };
    }
    postMessage(response);
    return;
  }
  const { id, source, declarations, options } = e.data as CompileRequest;
  let response: CompileResponse;
  try {
    response = { id, result: compileScript(ts, source, declarations, options) };
  } catch (err) {
    response = { id, error: err instanceof Error ? err.message : String(err) };
  }
  postMessage(response);
};
