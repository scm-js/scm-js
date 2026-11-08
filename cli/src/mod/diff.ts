/**
 * `scmjs mod diff <a> [b]`: a changelog between two mods, or with one, between the game and the mod (what the mod
 * changes). Each side is the mod over the game's own files when a copy is here, so a table one mod lacks reads as the
 * game's.
 */
import { diffMods, type ModChange, type ModChangeKind } from "../../../src/formats/mod/diff";
import { loadModData } from "../../../src/formats/mod/data";
import type { GameFiles } from "../gamefiles";
import { msg, t, translate } from "../i18n";
import { CliError, mark, pc } from "../ui";
import { iscriptMembers, modTables } from "./check";
import { emptySource, reader, type ModSource } from "./source";

export interface ModDiffReport {
  a: string;
  b: string;
  game: string | null;
  changes: ModChange[];
  same: boolean;
}

async function side(source: ModSource, base: GameFiles | null) {
  const own = reader(source);
  const read = async (name: string) => (await own(name)) ?? (base ? await base.read(name) : null);
  const data = await loadModData(own, base ? (n) => base.read(n) : null, modTables(source), iscriptMembers(source));
  return { data, read, names: [...source.files.keys()] };
}

/** `b` null: the game against `a`. */
export async function diffModSources(a: ModSource, b: ModSource | null, base: GameFiles | null): Promise<ModDiffReport> {
  if (!b && !base) throw new CliError(t("With one mod, diff compares it with the game, and no copy of StarCraft was found."), t("Name the copy with --starcraft (or SCMJS_STARCRAFT), or name two mods."), 2);
  const before = b ? a : emptySource("game", "game", base!.label);
  const after = b ?? a;
  const changes = await diffMods(await side(before, base), await side(after, base));
  return { a: b ? a.path : base!.label, b: after.path, game: base?.label ?? null, changes, same: changes.length === 0 };
}

const HEADINGS: Record<ModChangeKind, string> = {
  table: msg("Tables"), strings: msg("Strings"), iscript: msg("Animation scripts"), ai: msg("AI"), pictures: msg("Pictures"), overlays: msg("Overlays"), sounds: msg("Sounds"), grafts: msg("Buttons and requirements"), maps: msg("Maps"), files: msg("Other files"),
};

export function printModDiff(r: ModDiffReport, { all = false } = {}): string[] {
  if (r.same) return [`${mark.ok} ${t("{a} and {b} are the same", { a: pc.bold(r.a), b: pc.bold(r.b) })}`];
  const lines = [`${pc.bold(r.a)} → ${pc.bold(r.b)}${pc.dim(` · ${t("{n, plural, one {# change} other {# changes}}", { n: r.changes.length })}`)}`];
  for (const kind of Object.keys(HEADINGS) as ModChangeKind[]) {
    const list = r.changes.filter((c) => c.kind === kind);
    if (!list.length) continue;
    lines.push("", pc.bold(translate(HEADINGS[kind])));
    const shown = all ? list : list.slice(0, 30);
    for (const c of shown) lines.push(`  ${c.text}`);
    if (shown.length < list.length) lines.push(pc.dim(`  ${t("… and {n} more (--all lists them)", { n: list.length - shown.length })}`));
  }
  return lines;
}
