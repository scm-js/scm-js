/** `scmjs mod new <dir>`: an empty mod folder — `mod.json` and a README of one paragraph. */
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { emptyManifest, MOD_MANIFEST, type ModManifest } from "../../../src/formats/mod/folder";
import { CliError } from "../ui";

export interface NewMod { dir: string; name: string; files: string[]; manifest: ModManifest }

export async function newMod(dir: string, name?: string): Promise<NewMod> {
  const out = resolve(dir);
  if (existsSync(out) && (await readdir(out)).length) throw new CliError(`${dir} is there and is not empty.`, "Name a new folder; scmjs mod unpack starts a folder from an existing mod.", 2);
  const manifest = emptyManifest(name?.trim() || basename(out));
  await mkdir(out, { recursive: true });
  await writeFile(join(out, MOD_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  const readme = `# ${manifest.name}\n\nA StarCraft: Brood War mod, kept as text and pictures: the tables in tables/ (PyDAT's text), the string tables in strings/, the animation scripts in iscript/, the AI in ai/, the GRPs as PNG sheets in graphics/, the sounds in sounds/ and every other file of the game it changes under files/, at the game's own paths. \`scmjs mod pack\` makes the MPQ the launchers load, \`scmjs mod check\` looks for mistakes across the tables and \`scmjs mod play\` plays it on the play page; docs.scmjs.dev/mods has the rest.\n`;
  await writeFile(join(out, "README.md"), readme);
  return { dir: out, name: manifest.name, files: [MOD_MANIFEST, "README.md"], manifest };
}
