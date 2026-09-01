/**
 * The compile worker: TypeScript is a few megabytes of JavaScript and a program check
 * takes tens of milliseconds, neither of which belongs on the main thread while the
 * user types. One request in, one result out, matched by id (see `compileClient.ts`).
 */
import ts from "typescript";
import { compileScript, type CompileResult } from "./compiler";

export interface CompileRequest {
  id: number;
  source: string;
  declarations: string;
}

export interface CompileResponse {
  id: number;
  result?: CompileResult;
  error?: string;
}

self.onmessage = (e: MessageEvent<CompileRequest>) => {
  const { id, source, declarations } = e.data;
  let response: CompileResponse;
  try {
    response = { id, result: compileScript(ts, source, declarations) };
  } catch (err) {
    response = { id, error: err instanceof Error ? err.message : String(err) };
  }
  postMessage(response);
};
