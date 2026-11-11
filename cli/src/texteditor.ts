/**
 * `scmjs map triggers edit` and `scmjs map strings edit`: the export written to a file of its own, opened in the
 * person's editor, and imported when the editor closes — `git commit`'s and `crontab -e`'s way. The import is
 * `exchange.ts`'s, so the text, the parser and its errors are the ones `export` and `import` use. Text that does not
 * read is kept where it was written, and the command says where, so an edit is never lost.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { OpenedMap } from "../../src/editor/mapFile";
import { readBriefing, readTriggers, sameTriggers } from "../../src/editor/triggers";
import { parseStringTable } from "../../src/editor/exchange";
import { exportStrings, exportTriggers, importStrings, importTriggers, type StringImportResult, type TriggerImport } from "./exchange";
import { t } from "./i18n";
import { CliError } from "./ui";

export type EditKind = "triggers" | "strings";

/**
 * The editor to run: `--editor`, else `VISUAL`, else `EDITOR` (as git reads them), else Notepad on Windows and vi
 * elsewhere.
 */
export function editorCommand(given?: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  for (const v of [given, env.VISUAL, env.EDITOR]) if (v && v.trim()) return v.trim();
  return platform === "win32" ? "notepad" : "vi";
}

/**
 * How to start the editor on `file`. A plain program name or path is run as it is; a value with arguments or quotes
 * (`code --wait`, `"C:\Program Files\…" -multiInst`) goes through the shell, as git runs `$EDITOR` — on Windows always,
 * since a `.cmd` such as VS Code's `code` only starts that way.
 */
export function editorSpawn(editor: string, file: string, platform: NodeJS.Platform = process.platform): { command: string; args: string[]; shell: boolean } {
  const plain = existsSync(editor) || /^[\w@%+=:,./\\-]+$/.test(editor);
  if (platform === "win32") return plain && existsSync(editor) && /\.exe$/i.test(editor) ? { command: editor, args: [file], shell: false } : { command: `${editor} "${file}"`, args: [], shell: true };
  if (plain) return { command: editor, args: [file], shell: false };
  // `sh -c '<editor> "$@"' <editor> <file>`: the editor's own words as the shell reads them, the file as one argument.
  return { command: "sh", args: ["-c", `${editor} "$@"`, editor, file], shell: false };
}

/** Run the editor on `file` and wait for it to close. Ctrl-C is the editor's while it runs, as git leaves it. */
export async function runEditor(editor: string, file: string): Promise<void> {
  const how = editorSpawn(editor, file);
  const ignore = () => {};
  process.on("SIGINT", ignore);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(how.command, how.args, { stdio: "inherit", shell: how.shell });
      child.on("error", (e: NodeJS.ErrnoException) => reject(new CliError(
        e.code === "ENOENT" ? t("No editor \"{editor}\" here", { editor }) : t("The editor \"{editor}\" could not be started ({reason})", { editor, reason: e.code ?? e.message }),
        t("Name one with --editor, or set EDITOR: code --wait, nano, vim, notepad."), 2)));
      child.on("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new CliError(signal ? t("The editor stopped ({signal})", { signal }) : code === 127 && !how.shell ? t("No editor \"{editor}\" here", { editor }) : t("The editor exited with code {code}", { code: String(code) })));
      });
    });
  } finally {
    process.off("SIGINT", ignore);
  }
}

export type EditOutcome =
  | { kind: "triggers"; changed: false; file: string }
  | { kind: "triggers"; changed: true; file: string; triggers: TriggerImport }
  | { kind: "strings"; changed: false; file: string }
  | { kind: "strings"; changed: true; file: string; strings: StringImportResult };

export interface EditOptions {
  /** The editor's command; `editorCommand()` by default. */
  editor?: string;
  /** The mission briefing's triggers instead (triggers only). */
  briefing?: boolean;
  /** Where the file is written; a new folder under the system's temporary one by default. */
  dir?: string;
  /** Called with the file's path before the editor starts (the command says it waits). */
  onWait?: (file: string) => void;
  /**
   * Writes the map once the text has been imported and changed it. The file is removed only after this succeeds; when
   * it fails, the text is kept and the error says where, with the import command that brings it in.
   */
  write?: () => Promise<void>;
}

/** Line ends and trailing space aside: what an editor adds on save (a final newline, CRLF) is no change. */
const same = (a: string, b: string) => a.replace(/\r\n/g, "\n").trimEnd() === b.replace(/\r\n/g, "\n").trimEnd();

/**
 * The map's triggers or strings in the editor and back. Unchanged (or changed only where the import reads nothing, a
 * comment) → `changed: false` and the map as it was. Text that does not read throws, and the file stays for the
 * person to fix; on success, or no change, it is removed.
 */
export async function editInEditor(doc: OpenedMap, mapName: string, kind: EditKind, o: EditOptions = {}): Promise<EditOutcome> {
  const editor = editorCommand(o.editor);
  const text = kind === "triggers" ? exportTriggers(doc, null, !!o.briefing).text! : exportStrings(doc).text;
  const dir = o.dir ?? (await mkdtemp(join(tmpdir(), "scmjs-edit-")));
  const stem = basename(mapName).replace(/\.(scm|scx|chk)$/i, "") || "map";
  const file = join(dir, `${stem}.${kind === "triggers" && o.briefing ? "briefing" : kind}.txt`);
  const cleanUp = () => (o.dir ? rm(file, { force: true }) : rm(dir, { recursive: true, force: true }));
  await writeFile(file, text);
  const kept = t("The map is unchanged; your text is kept in {file}.", { file });
  o.onWait?.(file);
  try {
    await runEditor(editor, file);
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    // The editor never started: nothing was edited. It started and failed: what it saved stays.
    if (e.exitCode === 2) { await cleanUp(); throw e; }
    throw new CliError(e.message, kept);
  }
  const after = await readFile(file, "utf8");
  if (same(after, text)) { await cleanUp(); return { kind, changed: false, file }; }
  const importAgain = `scmjs map ${kind} import ${JSON.stringify(mapName)} ${JSON.stringify(file)}${o.briefing ? " --briefing" : ""}`;
  let outcome: EditOutcome;
  try {
    if (kind === "triggers") {
      const before = o.briefing ? readBriefing(doc.scenario) : readTriggers(doc.scenario);
      // Emptied in the editor is meant: the person took every trigger out themselves.
      const triggers = importTriggers(doc, basename(file), new TextEncoder().encode(after), { briefing: !!o.briefing, allowEmpty: true });
      const now = o.briefing ? readBriefing(doc.scenario) : readTriggers(doc.scenario);
      outcome = sameTriggers(before, now) ? { kind, changed: false, file } : { kind, changed: true, file, triggers };
    } else if (!parseStringTable(after).entries.length && !parseStringTable(after).errors.length) {
      // Every line taken out: a line taken out leaves its string as it was, so nothing changes.
      outcome = { kind, changed: false, file };
    } else {
      const strings = importStrings(doc, basename(file), after);
      outcome = strings.replaced + strings.added === 0 ? { kind, changed: false, file } : { kind, changed: true, file, strings };
    }
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    throw new CliError(e.message, `${kept} ${t("Fix it there, then: {command}", { command: importAgain })}${e.hint ? `\n  ${e.hint}` : ""}`);
  }
  // The map written before the text goes: a map that cannot be written keeps the edit.
  if (outcome.changed && o.write) {
    try {
      await o.write();
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      throw new CliError(e.message, `${t("Your text is kept in {file}. Once the map can be written: {command}", { file, command: importAgain })}${e.hint ? `\n  ${e.hint}` : ""}`, e.exitCode);
    }
  }
  await cleanUp();
  return outcome;
}
