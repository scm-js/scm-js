/**
 * `scmjs map triggers edit` and `scmjs map strings edit` (cli/src/texteditor.ts): the text in an editor and back. The
 * editor here is a stand-in, a small Node script named the way a person names one (`--editor "node script.mjs"`), so
 * it goes through the shell as `code --wait` would; it rewrites the file and exits.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openMapBytes } from "../src/editor/mapFile";
import { readTriggers } from "../src/editor/triggers";
import { getString } from "../src/formats/chk/sections/strings";
import { writeBack } from "../cli/src/exchange";
import { editInEditor, editorCommand, editorSpawn } from "../cli/src/texteditor";
import { CliError } from "../cli/src/ui";
import { testMap } from "./support/maps";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-edit-test-"));

/** A stand-in editor: `node <script> <mode> <file>`, rewriting the file as the mode says. */
function standIn(dir: string, mode: "same" | "newline" | "comment" | "drop" | "break" | "string" | "fail"): string {
  const script = join(dir, "editor.mjs");
  writeFileSync(script, `import { readFileSync, writeFileSync } from "node:fs";
const [mode, file] = process.argv.slice(2);
let t = readFileSync(file, "utf8");
if (mode === "fail") process.exit(3);
if (mode === "newline") t = t.replace(/\\n/g, "\\r\\n") + "\\r\\n";
if (mode === "comment") t = "// a note\\n" + t;
if (mode === "drop") t = t.slice(0, t.lastIndexOf("Trigger("));
if (mode === "break") t = t.replace("Conditions:", "Conditions:\\n\\tNoSuchCondition(1);");
if (mode === "string") t = t.replace(/^(\\d+)\\t.*$/m, "$1\\tChanged in the editor");
writeFileSync(file, t);
`);
  return `"${process.execPath}" "${script}" ${mode}`;
}

const open = async (dir: string) => {
  const path = join(dir, "ums.scx");
  writeFileSync(path, readFileSync(testMap("ums.scx")));
  return { path, doc: await openMapBytes(new Uint8Array(readFileSync(path)), "ums.scx") };
};

describe("scmjs map … edit: which editor", () => {
  it("--editor, then VISUAL, then EDITOR, then Notepad or vi", () => {
    expect(editorCommand("nano", { VISUAL: "code --wait", EDITOR: "vim" }, "linux")).toBe("nano");
    expect(editorCommand(undefined, { VISUAL: "code --wait", EDITOR: "vim" }, "linux")).toBe("code --wait");
    expect(editorCommand(undefined, { VISUAL: " ", EDITOR: "vim" }, "linux")).toBe("vim");
    expect(editorCommand(undefined, {}, "linux")).toBe("vi");
    expect(editorCommand(undefined, {}, "win32")).toBe("notepad");
  });

  it("runs a plain name as it is, and one with arguments through the shell", () => {
    expect(editorSpawn("vim", "/t/a.txt", "linux")).toEqual({ command: "vim", args: ["/t/a.txt"], shell: false });
    expect(editorSpawn("code --wait", "/t/a b.txt", "linux")).toEqual({ command: "sh", args: ["-c", 'code --wait "$@"', "code --wait", "/t/a b.txt"], shell: false });
    // Windows: through cmd, since `code` is a .cmd there.
    expect(editorSpawn("code --wait", "C:\\t\\a.txt", "win32")).toEqual({ command: 'code --wait "C:\\t\\a.txt"', args: [], shell: true });
    expect(editorSpawn("notepad", "C:\\t\\a.txt", "win32").shell).toBe(true);
  });
});

describe.skipIf(process.platform === "win32")("scmjs map triggers edit", () => {
  it("imports what the editor saved, as triggers import does, and removes the file", async () => {
    const dir = tmp();
    const { path, doc } = await open(dir);
    const files: string[] = [];
    const r = await editInEditor(doc, path, "triggers", { dir, editor: standIn(dir, "drop"), onWait: (f) => files.push(f) });
    expect(r).toMatchObject({ kind: "triggers", changed: true, triggers: { before: 3, after: 2, read: 2 } });
    expect(files[0]).toMatch(/ums\.triggers\.txt$/);
    expect(existsSync(files[0])).toBe(false);
    await writeBack(doc, path, null);
    const again = await openMapBytes(new Uint8Array(readFileSync(path)), "ums.scx");
    expect(readTriggers(again.scenario)).toHaveLength(2);
  });

  it("says nothing changed when the text is the same, a final newline and CRLF aside, or only a comment was added", async () => {
    for (const mode of ["same", "newline", "comment"] as const) {
      const dir = tmp();
      const { path, doc } = await open(dir);
      const r = await editInEditor(doc, path, "triggers", { dir, editor: standIn(dir, mode) });
      expect(r.changed, mode).toBe(false);
      expect(doc.scenario.dirty.size, mode).toBe(0);
    }
  });

  it("keeps the text that does not read and says where it is, the map untouched", async () => {
    const dir = tmp();
    const { path, doc } = await open(dir);
    const before = readTriggers(doc.scenario);
    const e = await editInEditor(doc, path, "triggers", { dir, editor: standIn(dir, "break") }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CliError);
    const err = e as CliError;
    expect(err.exitCode).toBe(1);
    expect(err.message).toMatch(/^ums\.triggers\.txt, line 3: .*NoSuchCondition/);
    const kept = /kept in (\S+ums\.triggers\.txt)/.exec(err.hint ?? "")![1];
    expect(readFileSync(kept, "utf8")).toContain("NoSuchCondition(1);");
    expect(err.hint).toContain(`scmjs map triggers import "${path}" "${kept}"`);
    expect(readTriggers(doc.scenario)).toEqual(before);
  });

  it("keeps the file when the editor fails, and says so when there is no such editor", async () => {
    const dir = tmp();
    const { path, doc } = await open(dir);
    const failed = await editInEditor(doc, path, "triggers", { dir, editor: standIn(dir, "fail") }).catch((x: unknown) => x as CliError);
    expect(failed.message).toBe("The editor exited with code 3");
    expect(existsSync(/kept in (\S+\.txt)/.exec(failed.hint ?? "")![1])).toBe(true);
    const none = await editInEditor(doc, path, "triggers", { dir, editor: "no-such-editor-here" }).catch((x: unknown) => x as CliError);
    expect([none.message, none.exitCode]).toEqual(['No editor "no-such-editor-here" here', 2]);
  });

  it("edits the briefing with --briefing", async () => {
    const dir = tmp();
    const { path, doc } = await open(dir);
    const files: string[] = [];
    const r = await editInEditor(doc, path, "triggers", { dir, editor: standIn(dir, "same"), briefing: true, onWait: (f) => files.push(f) });
    expect(r.changed).toBe(false);
    expect(files[0]).toMatch(/ums\.briefing\.txt$/);
  });
});

describe.skipIf(process.platform === "win32")("scmjs map strings edit", () => {
  it("sets the string the editor changed and nothing else", async () => {
    const dir = tmp();
    const { path, doc } = await open(dir);
    const r = await editInEditor(doc, path, "strings", { dir, editor: standIn(dir, "string") });
    expect(r).toMatchObject({ kind: "strings", changed: true, strings: { replaced: 1, added: 0 } });
    expect(getString(doc.scenario.strings, 1)).toBe("Changed in the editor");
    const same = await editInEditor(doc, path, "strings", { dir, editor: standIn(dir, "same") });
    expect(same.changed).toBe(false);
  });
});
