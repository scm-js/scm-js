/**
 * TypeScript → JavaScript for a plugin file, with no type check: `transpileModule` on
 * one file at a time, ES module output. Takes the `typescript` namespace as an argument
 * so the compile worker (bundled) and the tests (Node) share it without this module
 * pulling the compiler into the main bundle.
 */
import type ts from "typescript";

export type TS = typeof ts;

export function transpileTs(tsc: TS, source: string, fileName: string): string {
  const out = tsc.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { module: tsc.ModuleKind.ESNext, target: tsc.ScriptTarget.ES2022, sourceMap: false, verbatimModuleSyntax: false },
  });
  const fatal = out.diagnostics?.find((d) => d.category === tsc.DiagnosticCategory.Error);
  if (fatal) {
    const where = fatal.file && fatal.start !== undefined ? `:${fatal.file.getLineAndCharacterOfPosition(fatal.start).line + 1}` : "";
    throw new Error(`${fileName}${where}: ${tsc.flattenDiagnosticMessageText(fatal.messageText, "\n")}`);
  }
  return out.outputText;
}
