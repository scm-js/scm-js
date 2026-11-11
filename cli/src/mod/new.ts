/** `scmjs mod new <dir>`: an empty mod folder — `mod.json` and a README of one paragraph. */
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { emptyManifest, MOD_MANIFEST, type ModManifest } from "../../../src/formats/mod/folder";
import { modTarget } from "./target";

export interface NewMod { dir: string; name: string; files: string[]; manifest: ModManifest }

/** `force`: replace a mod folder that is there (never a folder holding anything else). */
export async function newMod(dir: string, name?: string, o: { force?: boolean } = {}): Promise<NewMod> {
  const { out } = await modTarget(dir, { force: o.force });
  const manifest = emptyManifest(name?.trim() || basename(out));
  await writeFile(join(out, MOD_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  const readme = `# ${manifest.name}\n\nA StarCraft: Brood War mod, kept as text and pictures: the tables in tables/ (PyDAT's text), the string tables in strings/, the animation scripts in iscript/, the AI in ai/, the GRPs as PNG sheets in graphics/, the sounds in sounds/ and every other file of the game it changes under files/, at the game's own paths. \`scmjs mod pack\` makes the MPQ the launchers load, \`scmjs mod check\` looks for mistakes across the tables and \`scmjs mod play\` plays it on the play page; docs.scmjs.dev/mods has the rest.\n`;
  await writeFile(join(out, "README.md"), readme);
  return { dir, name: manifest.name, files: [MOD_MANIFEST, "README.md"], manifest };
}
