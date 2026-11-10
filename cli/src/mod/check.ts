/**
 * `scmjs mod check <dir|source>`: the lints across the mod's tables, strings, scripts and files
 * (`src/formats/mod/check.ts`), over the game's own files when a copy is here. Errors fail the check (exit 1).
 */
import { checkMod, type ModFinding } from "../../../src/formats/mod/check";
import { loadModData } from "../../../src/formats/mod/data";
import { gameName } from "../../../src/formats/mod/sources";
import { datTableOf, type DatTableName } from "../../../src/formats/dat/schema";
import { hasRaceCandidates, raceCandidates, type RaceCandidates } from "../../../src/formats/mod/races";
import type { GameFiles } from "../gamefiles";
import { t } from "../i18n";
import { dot, mark, pc } from "../ui";
import { reader, type ModSource } from "./source";

export interface ModCheckReport {
  path: string;
  name: string;
  /** The copy of the game the mod was checked over, or null. */
  game: string | null;
  findings: ModFinding[];
  errors: number;
  warnings: number;
  /** What could not be looked at, and files that could not be read. */
  notes: string[];
  /**
   * Things worth a look that are not wrong: the races the mod's files hint at when its mod.json declares none. Never
   * an error or a warning, so they fail no check.
   */
  hints: string[];
  failed: boolean;
}

/**
 * What the mod's files hint about races it adds (`raceCandidates`): its `rez\network.tbl` past the game's own (the
 * copy's when one is here) and letters with per-race console files. Hints, never names.
 */
export async function modRaceCandidates(source: ModSource, base: GameFiles | null): Promise<RaceCandidates> {
  const network = await reader(source)("rez\\network.tbl").catch(() => null);
  const gameNetwork = base ? await base.read("rez\\network.tbl").catch(() => null) : null;
  return raceCandidates({ network, gameNetwork, paths: source.files.keys() });
}

/** The hint `mod check` gives when the files suggest races and the mod declares none; null otherwise. */
export function racesHint(source: Pick<ModSource, "races">, found: RaceCandidates): string | null {
  if (source.races.length || !hasRaceCandidates(found)) return null;
  const what = [
    found.names.length ? t("names past the game's own in network.tbl: {list}", { list: found.names.map((n) => n.name).join(", ") }) : "",
    found.letters.length ? t("per-race console files under the letters {list}", { list: found.letters.join(", ") }) : "",
  ].filter(Boolean).join("; ");
  return t("The mod may add races of its own ({what}). Its mod.json declares none, so a player of one shows as Race and a number. Declare them under \"races\" in mod.json to name them.", { what });
}

/** Each table's member in the mod: the `.datex` when it has both. */
export function modTables(source: ModSource): Partial<Record<DatTableName, string>> {
  const out: Partial<Record<DatTableName, string>> = {};
  for (const f of source.files.values()) {
    const table = /^arr\\[^\\]+\.dat(?:ex)?$/.test(gameName(f.name)) ? datTableOf(f.name) : null;
    if (table && (!out[table] || /\.datex$/i.test(f.name))) out[table] = f.name;
  }
  return out;
}

/** The mod's iscript files: every `scripts\*.bin` but the AI scripts. */
export const iscriptMembers = (source: ModSource) => [...source.files.values()].map((f) => f.name).filter((n) => /^scripts\\.*\.bin$/.test(gameName(n)) && !/^scripts\\(aiscript|bwscript)\.bin$/.test(gameName(n))).sort();

/**
 * Whether the game's copy has a file, for the kinds of file it holds: unknown (null) for pictures or sounds when the
 * copy answers neither the marine's picture nor the buzz. Both kinds of copy do (a Remastered one at the classic
 * names, its sounds its own WAVs); the probe stands for a copy that is only part of the game.
 */
export async function baseHas(base: GameFiles | null): Promise<((name: string) => Promise<boolean | null>) | null> {
  if (!base) return null;
  const pictures = !!(await base.read("unit\\terran\\marine.grp"));
  const sounds = !!(await base.read("sound\\misc\\buzz.wav"));
  return async (name) => {
    const lower = gameName(name);
    if ((lower.startsWith("unit\\") && !pictures) || (lower.startsWith("sound\\") && !sounds)) return null;
    return !!(await base.read(name));
  };
}

export async function checkModSource(source: ModSource, base: GameFiles | null): Promise<ModCheckReport> {
  const read = reader(source);
  const data = await loadModData(read, base ? (n) => base.read(n) : null, modTables(source), iscriptMembers(source));
  const grafts = [];
  for (const f of source.files.values()) if (/\.graft$/i.test(f.name)) grafts.push({ member: f.name, bytes: await f.read() });
  const inBase = await baseHas(base);
  const findings = await checkMod(data, { inMod: (n) => source.files.has(gameName(n)), inBase, grafts });
  for (const d of source.duplicates) findings.push({ level: "warning", rule: "duplicate-file", where: d, why: t("one game path, two files in another case: the game reads one of them") });
  const notes = [...data.problems];
  if (!base) notes.push(t("No copy of StarCraft was found, so the game's own files were not looked in: only what the mod adds is checked against them (name one with --starcraft)."));
  else if (!(await base.read("unit\\terran\\marine.grp"))) notes.push(t("{copy} has no 1.16.1 GRPs or WAVs: pictures and sounds the mod does not have were not looked for.", { copy: base.label }));
  const errors = findings.filter((f) => f.level === "error").length;
  const hint = racesHint(source, await modRaceCandidates(source, base));
  return { path: source.path, name: source.name, game: base?.label ?? null, findings, errors, warnings: findings.length - errors, notes, hints: hint ? [hint] : [], failed: errors > 0 };
}

/** One line for the whole check: "✔ nothing found", "✖ 2 errors, 1 warning". */
export function checkLine(r: ModCheckReport): string {
  if (!r.findings.length) return `${mark.ok} ${t("nothing found")}`;
  const parts = [r.errors ? pc.red(t("{n, plural, one {# error} other {# errors}}", { n: r.errors })) : "", r.warnings ? pc.yellow(t("{n, plural, one {# warning} other {# warnings}}", { n: r.warnings })) : ""].filter(Boolean);
  return `${r.errors ? mark.error : mark.warn} ${parts.join(", ")}`;
}

export function printModCheck(r: ModCheckReport, { all = false } = {}): string[] {
  const lines = [`${pc.bold(r.name)}${dot}${checkLine(r)}${r.game ? pc.dim(` ${t("(over {copy})", { copy: r.game })}`) : ""}`];
  const sorted = [...r.findings].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  const shown = all ? sorted : sorted.slice(0, 40);
  for (const f of shown) lines.push(`  ${f.level === "error" ? mark.error : mark.warn} ${f.where}${pc.dim(":")} ${f.why}`);
  if (shown.length < sorted.length) lines.push(pc.dim(`  ${t("… and {n, plural, one {# more finding} other {# more findings}} (--all lists them)", { n: sorted.length - shown.length })}`));
  for (const h of r.hints ?? []) lines.push(`  ${mark.info} ${h}`);
  for (const n of r.notes) lines.push(pc.dim(`  ${n}`));
  return lines;
}
