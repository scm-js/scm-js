/**
 * `scmjs mod new <dir>`: an empty mod folder — `mod.json` and a README of one paragraph — or, with `--tables`, one
 * holding the game's own tables named, as text from the person's copy of the game, to start editing from.
 */
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { emptyManifest, MOD_MANIFEST, type ModManifest } from "../../../src/formats/mod/folder";
import { DAT_TABLES, type DatTableName } from "../../../src/formats/dat/schema";
import type { GameFiles } from "../gamefiles";
import { t } from "../i18n";
import { CliError } from "../ui";
import { gameSource } from "./source";
import { modTarget } from "./target";
import { unpackMod } from "./unpack";

/** `--tables units,weapons` (or `all`): the game's tables named, each once. */
export function parseTables(spec: string): DatTableName[] {
  const words = spec.split(",").map((w) => w.trim().toLowerCase().replace(/\.dat$/, "")).filter(Boolean);
  if (words.includes("all")) return [...DAT_TABLES];
  const out: DatTableName[] = [];
  for (const w of words) {
    if (!(DAT_TABLES as string[]).includes(w)) throw new CliError(t("--tables: \"{name}\" is not one of the game's tables", { name: w }), t("The tables: {list}, or all.", { list: DAT_TABLES.join(", ") }), 2);
    if (!out.includes(w as DatTableName)) out.push(w as DatTableName);
  }
  if (!out.length) throw new CliError(t("--tables names no table"), t("The tables: {list}, or all.", { list: DAT_TABLES.join(", ") }), 2);
  return out;
}

export interface NewMod { dir: string; name: string; files: string[]; manifest: ModManifest }

/**
 * `force`: replace a mod folder that is there (never a folder holding anything else). `tables`: the game's tables to
 * start from, written as `mod unpack` writes a mod's (their text, with the game's names), out of `base`.
 */
export async function newMod(dir: string, name?: string, o: { force?: boolean; tables?: DatTableName[]; base?: GameFiles | null } = {}): Promise<NewMod> {
  let manifest: ModManifest;
  const files: string[] = [];
  if (o.tables?.length) {
    if (!o.base) throw new CliError(t("--tables writes the game's own tables, and no copy of StarCraft was found to read them from."), t("Name your copy of the game with --starcraft (or SCMJS_STARCRAFT)."), 2);
    const source = await gameSource(o.base, o.tables.map((x) => `arr\\${x}.dat`));
    source.name = name?.trim() || basename(dir.replace(/[\\/]+$/, "")) || "mod";
    const r = await unpackMod(source, dir, { base: o.base, force: o.force });
    manifest = r.manifest;
    files.push(...o.tables.filter((x) => r.manifest.tables[x]).map((x) => `tables/${x}.txt`));
  } else {
    const { out } = await modTarget(dir, { force: o.force });
    manifest = emptyManifest(name?.trim() || basename(out));
    await writeFile(join(out, MOD_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const out = dir;
  const readme = `# ${manifest.name}\n\nA StarCraft: Brood War mod, kept as text and pictures: the tables in tables/ (PyDAT's text), the string tables in strings/, the animation scripts in iscript/, the AI in ai/, the GRPs as PNG sheets in graphics/, the sounds in sounds/ and every other file of the game it changes under files/, at the game's own paths. \`scmjs mod pack\` makes the MPQ the launchers load, \`scmjs mod check\` looks for mistakes across the tables and \`scmjs mod play\` plays it on the play page; docs.scmjs.dev/mods has the rest.\n`;
  await writeFile(join(out, "README.md"), readme);
  return { dir, name: manifest.name, files: [MOD_MANIFEST, "README.md", ...files], manifest };
}
