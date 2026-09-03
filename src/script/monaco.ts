/**
 * Monaco, lazily: this module is only ever `import()`ed by the Script editor, so the
 * editor core, its TypeScript service and the two workers stay out of the main bundle.
 * Only the TypeScript language is registered (no other tokenizers), the language service
 * is configured `noLib` with the generated declarations as its one extra lib, and the
 * theme is the editor's own palette (tokens.css) rather than VS Code's.
 */
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/features/register.all";
import "monaco-editor/languages/definitions/typescript/register";
import { ScriptTarget, typescriptDefaults } from "monaco-editor/languages/features/typescript/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import TsWorker from "monaco-editor/languages/features/typescript/ts.worker?worker";
import { DECLARATIONS_FILE } from "./declarations";
import type { ScriptDiagnostic } from "./compiler";

self.MonacoEnvironment = {
  getWorker: (_id, label) => (label === "typescript" || label === "javascript" ? new TsWorker() : new EditorWorker()),
};

typescriptDefaults.setCompilerOptions({
  noLib: true,
  strict: true,
  target: ScriptTarget.ESNext,
  allowNonTsExtensions: true,
  noEmit: true,
  types: [],
});
typescriptDefaults.setEagerModelSync(true);
typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });

export const THEME = "scm";

monaco.editor.defineTheme(THEME, {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "5d6675", fontStyle: "italic" },
    { token: "keyword", foreground: "e6b95c" },
    { token: "string", foreground: "4fd1c5" },
    { token: "number", foreground: "f4d08a" },
    { token: "type.identifier", foreground: "8fd3ff" },
    { token: "identifier", foreground: "dde2ea" },
    { token: "delimiter", foreground: "99a2b3" },
    { token: "operator", foreground: "99a2b3" },
  ],
  colors: {
    "editor.background": "#0a0c10",
    "editor.foreground": "#dde2ea",
    "editor.lineHighlightBackground": "#12151b",
    "editor.lineHighlightBorder": "#12151b",
    "editorLineNumber.foreground": "#5d6675",
    "editorLineNumber.activeForeground": "#99a2b3",
    "editor.selectionBackground": "#2b4f80",
    "editor.inactiveSelectionBackground": "#222732",
    "editorCursor.foreground": "#e6b95c",
    "editorIndentGuide.background1": "#222732",
    "editorIndentGuide.activeBackground1": "#353c4b",
    "editorWidget.background": "#191d25",
    "editorWidget.border": "#2c3341",
    "editorSuggestWidget.background": "#191d25",
    "editorSuggestWidget.border": "#2c3341",
    "editorSuggestWidget.selectedBackground": "#2b4f80",
    "editorHoverWidget.background": "#191d25",
    "editorHoverWidget.border": "#2c3341",
    "editorError.foreground": "#d9534f",
    "editorWarning.foreground": "#e0a545",
    "scrollbarSlider.background": "#353c4b80",
    "scrollbarSlider.hoverBackground": "#3b4453a0",
    "editorGutter.background": "#0a0c10",
    "minimap.background": "#0a0c10",
  },
});

export const SCRIPT_URI = monaco.Uri.parse("file:///triggers.ts");

/** Point the language service at a fresh declaration file (the map's names changed). */
export function setDeclarations(content: string) {
  typescriptDefaults.setExtraLibs([{ content, filePath: `file:///${DECLARATIONS_FILE}` }]);
}

/** The compiler's own diagnostics, drawn under the TypeScript ones. */
export function setCompilerMarkers(model: monaco.editor.ITextModel, diagnostics: ScriptDiagnostic[]) {
  monaco.editor.setModelMarkers(
    model,
    "scm-compiler",
    diagnostics.filter((d) => d.source === "compiler").map((d) => ({
      severity: monaco.MarkerSeverity.Error,
      message: d.message,
      startLineNumber: d.line,
      startColumn: d.column,
      endLineNumber: d.endLine,
      endColumn: d.endColumn,
    })),
  );
}

export interface ScriptEditor {
  editor: monaco.editor.IStandaloneCodeEditor;
  model: monaco.editor.ITextModel;
  dispose(): void;
}

/**
 * The Script Editor closed: drop the model and stop Monaco's TypeScript worker. Monaco 0.56
 * never idles that worker out on its own, and it is a second TypeScript instance next to
 * the compile worker; re-setting the compiler options is the one public way to make its
 * `WorkerManager` stop it (`onDidChange` → `_stopWorker`) — it starts again on the next
 * `createScriptEditor`. The source itself lives in the archive extras, so only the undo
 * history of the closed session goes with the model.
 */
export function releaseScriptEditor(): void {
  monaco.editor.getModel(SCRIPT_URI)?.dispose();
  typescriptDefaults.setCompilerOptions(typescriptDefaults.getCompilerOptions());
}

export function createScriptEditor(host: HTMLElement, source: string, onChange: (text: string) => void): ScriptEditor {
  const model = monaco.editor.getModel(SCRIPT_URI) ?? monaco.editor.createModel(source, "typescript", SCRIPT_URI);
  if (model.getValue() !== source) model.setValue(source);
  const editor = monaco.editor.create(host, {
    model,
    theme: THEME,
    automaticLayout: true,
    fontFamily: '"Cascadia Mono", "JetBrains Mono", ui-monospace, Consolas, Menlo, monospace',
    fontSize: 12.5,
    lineHeight: 18,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: "line",
    tabSize: 2,
    insertSpaces: true,
    wordWrap: "off",
    fixedOverflowWidgets: true,
    padding: { top: 8, bottom: 8 },
    quickSuggestions: { other: true, strings: true, comments: false },
    suggest: { showWords: false },
  });
  const sub = model.onDidChangeContent(() => onChange(model.getValue()));
  return {
    editor,
    model,
    dispose() {
      sub.dispose();
      editor.dispose();
    },
  };
}

export { monaco };
