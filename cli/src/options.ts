/**
 * The options several commands declare alike, and the checks they make alike: one place for their words, so that
 * `--starcraft` or "both want standard output" reads the same in every command.
 */
import { existsSync } from "node:fs";
import { Option } from "commander";
import { STDIO } from "./files";
import { t } from "./i18n";
import { FORMATS, type Format } from "./report";
import { CliError } from "./ui";

export const jsonOption = () => new Option("--json", t("print JSON instead of text, for scripts"));

/** `--starcraft <folder>`, with what the command reads from the copy when it says. */
export const starcraftOption = (description = t("your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise")) => new Option("--starcraft <folder>", description);

/** `-o, --out <value>`: where the command writes. */
export const outOption = (value: "map" | "file" | "folder" | "picture.png" | "path", description: string) => new Option(`-o, --out <${value}>`, description);
/** `-o, --out <map>` of a command that changes a map, which is written over it otherwise. */
export const mapOutOption = (description = t("write the result here instead of over the map; - for standard output")) => outOption("map", description);

export const forceOption = (description = t("overwrite a file that is there")) => new Option("--force", description);
export const dryRunOption = (description = t("say what would change and write nothing")) => new Option("--dry-run", description);

/** `--engine`, hidden: the tests', and a staged deploy's. */
export const engineOption = () => new Option("--engine <where>", t("the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)")).hideHelp();
export const playOption = () => new Option("--play <url>", t("the play page's address (SCMJS_PLAY_URL)")).hideHelp();
export const editorUrlOption = (description = t("the editor's address (SCMJS_EDITOR_URL)")) => new Option("--editor <url>", description).hideHelp();
export const modOption = () => new Option("--mod <mod>", t("lay a mod over the game: a mod folder, an .mpq, a mod's .exe or .zip, or a folder of its files"));
export const formatOption = () => new Option("--format <kind>", t("{formats}: github is workflow annotations, junit and sarif the files CI tools read", { formats: FORMATS.join(", ") })).default("text");

export const qrOption = () => new Option("--qr", t("the link as a QR code under it too, for a phone"));
export const copyOption = () => new Option("--copy", t("put the link on the clipboard too"));
export const noLinkOption = () => new Option("--no-link", t("keep it on your account without making a link"));

/** What goes to standard output besides `--json`, and the hint for it. */
const PIPED = {
  map: () => [t("--json and the map both want standard output"), t("Write the map to a file with --out, or leave --json off.")],
  newMap: () => [t("--json and the map both want standard output"), t("Name a file to write, or leave --json off.")],
  picture: () => [t("--json and the picture both want standard output"), t("Write the PNG to a file with --out, or leave --json off.")],
  file: () => [t("--json and the file both want standard output"), t("Write the file with --out, or leave --json off.")],
  mpq: () => [t("--json and the MPQ both want standard output"), t("Write the MPQ to a file with --out, or leave --json off.")],
} as const;

/** `--json` refused when what the command makes goes to standard output (`--out -`): both want the pipe. Exit 2. */
export function refuseJsonOnPipe(piped: boolean, json: boolean | undefined, what: keyof typeof PIPED): void {
  if (!(piped && json)) return;
  const [message, hint] = PIPED[what]();
  throw new CliError(message, hint, 2);
}

/** What a command reads besides the map, which cannot come from standard input too. */
const READ = {
  settings: () => t("The map and the settings cannot both come from standard input"),
  edits: () => t("The map and the edits cannot both come from standard input"),
  triggers: () => t("The map and the triggers cannot both come from standard input"),
  strings: () => t("The map and the strings cannot both come from standard input"),
} as const;

/** The map and the file beside it both named `-`: one standard input for two. Exit 2. */
export function refuseBothFromStdin(map: string, other: string | undefined, what: keyof typeof READ): void {
  if (map === STDIO && other === STDIO) throw new CliError(READ[what](), t("Name one of them as a file."), 2);
}

/** A file that is there, refused unless `--force` (or the tool's `force`): exit 2, with how to go on. */
export function refuseOverwrite(file: string, force: boolean | undefined, hint: string, shown = file): void {
  if (existsSync(file) && !force) throw new CliError(t("{file} is there already", { file: shown }), hint, 2);
}

/** `--format`: one of the report forms, or exit 2. */
export function checkFormat(format: string): void {
  if (!(FORMATS as readonly string[]).includes(format)) throw new CliError(t("--format takes {formats}, not \"{value}\"", { formats: FORMATS.join(", "), value: format }), null, 2);
}
/** `--format` beside `--json`, which is `--format json` and so cannot be another: the form asked for, or exit 2. */
export function reportFormat(o: { json?: boolean; format: string }): Format {
  checkFormat(o.format);
  if (o.json && o.format !== "text" && o.format !== "json") throw new CliError(t("--json is --format json: it cannot be --format {format} too", { format: o.format }), t("Leave one of them off."), 2);
  return o.json ? "json" : (o.format as Format);
}

/** The exit code raised to `code` (never lowered): a failure later in a list does not hide an earlier, worse one. */
export function raiseExitCode(code: number): void {
  process.exitCode = Math.max(Number(process.exitCode ?? 0), code);
}
