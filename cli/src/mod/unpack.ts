/**
 * `scmjs mod unpack <source> <dir>`: a mod as a folder of text and pictures (`src/formats/mod/folder.ts` has the
 * layout). Each member is written as text or a PNG sheet only when that packs back to the same bytes; anything else is
 * kept as bytes under `files/`, and `mod.json` says which and why. Plugins and FireGraft files are copied as they are.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  DEFAULT_PALETTE, emptyManifest, MOD_FOLDERS, MOD_MANIFEST, recordRendered, renderAiScripts, renderMember, tidyManifest, folderPath,
  type ModManifest, type Rendered,
} from "../../../src/formats/mod/folder";
import { gameName } from "../../../src/formats/mod/sources";
import { loadModData } from "../../../src/formats/mod/data";
import { datTableOf, type DatTableName } from "../../../src/formats/dat/schema";
import type { GameFiles } from "../gamefiles";
import { inEnglish, t } from "../i18n";
import { CliError } from "../ui";
import { gameCopyFolders, gameCopyWords, reader, type ModSource } from "./source";
import { modTarget } from "./target";

export interface UnpackReport {
  dir: string;
  source: string;
  name: string;
  /** Members written, by form (text, pictures, kept as bytes …). */
  members: number;
  forms: Record<string, number>;
  /** Members with a text or picture form kept as bytes, grouped by why. */
  kept: { why: string; count: number; files: string[] }[];
  plugins: number;
  firegraft: number;
  bytes: number;
  notes: string[];
  /** Where the names in the texts came from, and the palette the pictures were drawn with (null: none found). */
  names: ModManifest["names"];
  palette: string | null;
  left: string[];
  manifest: ModManifest;
}

export interface UnpackOptions {
  /** The game's files (names, a palette), or null. */
  base?: GameFiles | null;
  /** The palette to draw the GRPs with: a tileset's name (`jungle` by default). */
  palette?: string;
  /** Called after each member, for a progress line. */
  progress?: (done: number, total: number) => void;
  /** Replace a mod folder that is there (one an earlier unpack or mod new wrote). */
  force?: boolean;
}

export async function unpackMod(source: ModSource, dir: string, o: UnpackOptions = {}): Promise<UnpackReport> {
  if (resolve(source.path) === resolve(dir)) throw new CliError(t("The folder to write is the mod itself."), t("Name another folder."), 2);
  // A new or empty folder; one an earlier unpack wrote only with --force, and then replaced whole (its edits are the
  // person's: never written over in silence, and nothing stale left beside the new files).
  const { out, earlier } = await modTarget(dir, { force: o.force, source: source.path });

  const read = reader(source);
  const base = o.base ?? null;
  const baseRead = base ? (n: string) => base.read(n) : null;
  const manifest = emptyManifest(source.name);
  manifest.layers = [...source.layers];
  manifest.palette = o.palette ?? DEFAULT_PALETTE;
  // The races a person declared: the mod's own mod.json's, else those of the folder unpacked over (a new release of the
  // mod into the folder of the last keeps them). No file of a mod says them.
  const races = source.races.length ? source.races : earlier?.races ?? [];
  if (races.length) manifest.races = races.map((r) => ({ ...r }));

  // The names the texts are written with: the mod's own string tables, else the game's.
  // Each table's member; a mod with both a .dat and a .datex of one table is read by GPTP from the .datex.
  const modTables: Partial<Record<DatTableName, string>> = {};
  for (const f of source.files.values()) {
    const table = /^arr\\[^\\]+\.dat(?:ex)?$/.test(gameName(f.name)) ? datTableOf(f.name) : null;
    if (table && (!modTables[table] || /\.datex$/i.test(f.name))) modTables[table] = f.name;
  }
  const ownNames = source.files.has("rez\\stat_txt.tbl") || source.files.has("rez\\unitnames.tbl");
  manifest.names = ownNames ? "mod" : base ? "game" : "none";
  const data = manifest.names === "none" ? null : await loadModData(read, manifest.names === "game" ? baseRead : null, modTables);
  const names = data?.names ?? null;

  const paletteName = manifest.palette;
  const wpe = await read(`tileset\\${paletteName}.wpe`) ?? (base ? await base.read(`tileset\\${paletteName}.wpe`) : null);
  const palette = wpe ? { name: paletteName, colours: wpe } : null;

  const forms: Record<string, number> = {};
  const taken = new Map<string, string>(); // folder file, lower case → member
  let written = 0, bytes = 0, done = 0;
  const write = async (r: Rendered, members: string[]) => {
    let rendered = r;
    // Two members for one folder file (strings/images.txt from two folders): the second keeps its bytes.
    const key = rendered.file.toLowerCase();
    if (taken.has(key) && taken.get(key) !== members[0]) {
      const data = await read(members[0]);
      rendered = { form: "file", file: `${MOD_FOLDERS.files}/${folderPath(members[0])}`, data: data!, kept: `${taken.get(key)} has the same text name` };
    }
    taken.set(rendered.file.toLowerCase(), members[0]);
    const path = join(out, ...rendered.file.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, rendered.data);
    recordRendered(manifest, members, rendered);
    forms[rendered.kept ? "kept" : rendered.form] = (forms[rendered.kept ? "kept" : rendered.form] ?? 0) + members.length;
    written += members.length;
    bytes += rendered.data.length;
  };

  const all = [...source.files.values()].sort((a, b) => (gameName(a.name) < gameName(b.name) ? -1 : 1));
  // A table that is there twice (units.dat and units.datex): the one read is the text, the other kept.
  const total = all.length;
  for (const f of all) {
    const lower = gameName(f.name);
    if (/^scripts\\(aiscript|bwscript)\.bin$/.test(lower)) continue;
    const bytesOf = await f.read();
    let r = await renderMember(f.name, bytesOf, { names, palette });
    const table = datTableOf(f.name);
    if (r.form === "table" && table && modTables[table] !== f.name) r = { form: "file", file: `${MOD_FOLDERS.files}/${folderPath(f.name)}`, data: bytesOf, kept: `${modTables[table]} is the ${table} table's text` };
    await write(r, [f.name]);
    o.progress?.(++done, total);
  }
  const ai = source.files.get("scripts\\aiscript.bin"), bw = source.files.get("scripts\\bwscript.bin");
  if (ai || bw) {
    const rendered = renderAiScripts(ai ? { member: ai.name, bytes: await ai.read() } : null, bw ? { member: bw.name, bytes: await bw.read() } : null, { names });
    for (const r of rendered) {
      const members = r.form === "ai" ? [ai!.name, ...(bw ? [bw.name] : [])] : [r.file.slice(MOD_FOLDERS.files.length + 1).split("/").join("\\")];
      // (A kept script's member is its own name, which the path gives back only up to its case.)
      const own = r.form === "ai" ? members : [[ai, bw].find((x) => x && folderPath(x.name) === r.file.slice(MOD_FOLDERS.files.length + 1))?.name ?? members[0]];
      await write(r, own);
      done += own.length;
      o.progress?.(done, total);
    }
  }

  // Plugins and FireGraft files, as they are.
  for (const [list, folder, into] of [[source.plugins, MOD_FOLDERS.plugins, manifest.plugins], [source.firegraft, MOD_FOLDERS.firegraft, manifest.firegraft]] as const) {
    const names = new Set<string>();
    for (const p of list) {
      let leaf = p.name.split(/[\\/]/).pop()!;
      while (names.has(leaf.toLowerCase())) leaf = `${leaf.replace(/(\.[^.]+)$/, "")}.2${leaf.match(/\.[^.]+$/)?.[0] ?? ""}`;
      names.add(leaf.toLowerCase());
      const file = `${folder}/${folderPath(leaf)}`;
      const data = await p.read();
      const path = join(out, ...file.split("/"));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
      into.push({ name: p.name.split(/[\\/]/).pop()!, bytes: data.length, file, ...(p.member ? { member: p.member } : {}) });
      bytes += data.length;
    }
  }
  if (source.probed.length) manifest.notes.push(`${source.probed.join(", ")} had no list of its files: only the names the game reads were found in it`);
  // (mod.json is in English whatever the language, as every file a command writes.)
  for (const copy of gameCopyFolders(source)) manifest.notes.push(inEnglish(() => gameCopyWords(copy)));
  if (!palette) manifest.notes.push(`no palette ${paletteName} was found (the mod's tileset\\${paletteName}.wpe, or the game's): the GRPs are kept as bytes`);
  tidyManifest(manifest);
  await writeFile(join(out, MOD_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    dir: out, source: source.path, name: manifest.name, members: written, forms,
    kept: manifest.kept.map((k) => ({ why: k.why, count: k.files.length, files: k.files })),
    plugins: manifest.plugins.length, firegraft: manifest.firegraft.length, bytes, notes: manifest.notes,
    names: manifest.names, palette: palette ? paletteName : null, left: source.left, manifest,
  };
}
