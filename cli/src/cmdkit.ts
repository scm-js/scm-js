/**
 * What the commands' actions share: reading files one by one, opening a map to change it, where a writing command's
 * words go when the map takes standard output, and a shared link's lines. A command module returns data and lines;
 * these do the printing for the wiring.
 */
import { readInput, STDIO, toStdout, type Input } from "./files";
import { copyLinks } from "./sharefiles";
import { qrFor } from "./qr";
import { t } from "./i18n";
import { CliError, mark, pc, print, printErr } from "./ui";
import { raiseExitCode, refuseJsonOnPipe } from "./options";

/**
 * Runs `fn` on each file in turn; a file that fails is said and the rest go on. JSON: one value, or a list for
 * several. `silent` prints nothing and only collects, for a command that lays the results out itself afterwards.
 */
export async function eachFile(paths: string[], asJson: boolean, fn: (input: Input) => Promise<{ data: unknown; lines: string[] }>, rule = true, silent = false): Promise<unknown[]> {
  const results: unknown[] = [];
  let printed = false;
  for (const path of paths) {
    try {
      const { data, lines } = await fn(await readInput(path));
      results.push(data);
      // A file with nothing to say (no match in `find`) prints nothing, and no separator either.
      if (!silent && !asJson && lines.length) { if (printed) print(...(rule ? ["", pc.dim("─".repeat(Math.min(process.stdout.columns || 60, 60))), ""] : [""])); print(...lines); printed = true; }
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      // Said on standard error in every form, so a file left out of the JSON or a CI report is never left out silently.
      if (asJson) results.push({ file: path, error: e.message });
      fail(e);
      raiseExitCode(e.exitCode);
    }
  }
  if (asJson && !silent) print(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  return results;
}

export function fail(e: CliError): void {
  process.stderr.write(`${mark.error} ${e.message}\n${e.hint ? pc.dim(`  ${e.hint}`) + "\n" : ""}`);
}

/**
 * A command that writes a map: when the map itself is going to standard output (`--out -`, or a map read from `-` with
 * no `--out`), what the command says goes to standard error instead, and `--json` is refused — both want the pipe.
 */
export function piping(input: Input, o: { out?: string; json?: boolean; dryRun?: boolean }): boolean {
  const piped = toStdout(input.path, o.out) && !o.dryRun;
  refuseJsonOnPipe(piped, o.json, "map");
  return piped;
}
/** What a writing command says: standard output, or standard error while the map takes standard output. */
export function say(piped: boolean, ...lines: (string | null | undefined | false)[]): void {
  if (!piped) { print(...lines); return; }
  printErr(...lines);
}
/** The output's name for a message: the file, or "standard output". */
export const outName = (w: { path: string; live?: boolean }) => (w.path === STDIO ? t("standard output") : w.live ? t("the editor, as one undo step") : pc.cyan(w.path));

/** A link's lines with its QR code under the first (the link alone stays the first line, for `| head -1`). */
export const withQr = (lines: string[], link: string, qr: boolean | undefined) => (qr ? [lines[0], "", ...qrFor(link), "", ...lines.slice(1)] : lines);
/** `--copy`: the links to the clipboard, said on standard error; no clipboard tool is a warning, not a failure. */
export const copyShared = async (links: (string | null)[]) => {
  const c = await copyLinks(links);
  if (c) process.stderr.write(c.copied ? `${mark.ok} ${t("{n, plural, one {Link copied to the clipboard} other {# links copied to the clipboard}}", { n: links.filter(Boolean).length })}\n` : `${mark.warn} ${t("Not copied: {why}", { why: c.why })}\n`);
};
/** A share's lines, with its QR code under the link (none kept without a link). */
export const sharedLines = (lines: string[], link: string | null, qr: boolean | undefined) => (link ? withQr(lines, link, qr) : lines);

/** Progress and notes while a game command works: standard error, so standard output holds the report alone. */
export const note = (line: string) => printErr(line);
