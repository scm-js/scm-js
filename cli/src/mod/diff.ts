/**
 * `scmjs mod diff <a> [b]`: a changelog between two mods, or with one, between the game and the mod (what the mod
 * changes). Each side is the mod over the game's own files when a copy is here, so a table one mod lacks reads as the
 * game's.
 */
import { diffMods, type ModChange, type ModChangeKind } from "../../../src/formats/mod/diff";
import { loadModData } from "../../../src/formats/mod/data";
import type { GameFiles } from "../gamefiles";
import { CliError, mark, pc, plural } from "../ui";
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
  if (!b && !base) throw new CliError("With one mod, diff compares it with the game, and no copy of StarCraft was found.", "Name the copy with --starcraft (or SCMJS_STARCRAFT), or name two mods.", 2);
  const before = b ? a : emptySource("game", "game", base!.label);
  const after = b ?? a;
  const changes = await diffMods(await side(before, base), await side(after, base));
  return { a: b ? a.path : base!.label, b: after.path, game: base?.label ?? null, changes, same: changes.length === 0 };
}

const HEADINGS: Record<ModChangeKind, string> = {
  table: "Tables", strings: "Strings", iscript: "Animation scripts", ai: "AI", pictures: "Pictures", overlays: "Overlays", sounds: "Sounds", grafts: "Buttons and requirements", maps: "Maps", files: "Other files",
};

export function printModDiff(r: ModDiffReport, { all = false } = {}): string[] {
  if (r.same) return [`${mark.ok} ${pc.bold(r.a)} and ${pc.bold(r.b)} are the same`];
  const lines = [`${pc.bold(r.a)} → ${pc.bold(r.b)}${pc.dim(` · ${plural(r.changes.length, "change")}`)}`];
  for (const kind of Object.keys(HEADINGS) as ModChangeKind[]) {
    const list = r.changes.filter((c) => c.kind === kind);
    if (!list.length) continue;
    lines.push("", pc.bold(HEADINGS[kind]));
    const shown = all ? list : list.slice(0, 30);
    for (const c of shown) lines.push(`  ${c.text}`);
    if (shown.length < list.length) lines.push(pc.dim(`  … and ${plural(list.length - shown.length, "more")} (--all lists them)`));
  }
  return lines;
}
