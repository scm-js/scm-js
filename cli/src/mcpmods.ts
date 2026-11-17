/** The MCP tools for a mod: what `scmjs mod` does. */
import { z } from "zod";
import { expectKind, readInput } from "./files";
import { checkModSource, printModCheck } from "./mod/check";
import { diffModSources, printModDiff } from "./mod/diff";
import { modInfo, printModInfo } from "./mod/info";
import { newMod } from "./mod/new";
import { gameFilesOrNull, openMod } from "./mod/open";
import { sourceHash } from "./mod/hash";
import { MOD_COMPRESSIONS, packMod, readModFolder, type ModCompression } from "./mod/pack";
import { unpackMod } from "./mod/unpack";
import { writeModHeader } from "./mod/header";
import { pageRace, playBotOf, playOnPage, playSet } from "./mod/play";
import { CliError, visible, nearPath, printErr } from "./ui";
import { ok, noPipe, tool, type Reg } from "./mcpkit";

export function addModTools(reg: Reg): void {
  const modPath = z.string().describe("the mod: a folder of its files, an .mpq, a mod's self-executing .exe, a .zip, or a folder mod_unpack wrote");
  const starcraft = z.string().optional().describe("the folder of the person's StarCraft installation, whose files are under the mod; found in the usual places otherwise");

  reg("mod_info", {
    title: "What a mod is",
    description: "A StarCraft mod's name, files and sizes by kind (tables, scripts, pictures, sounds, terrain, strings, AI), which tables are wider than the game's and in which layout (DatExtend's expanded .dat, GPTP's .datex), the plugins and FireGraft files it carries (never run), the game it is for, and its hash (`hash`: the name the play page and a replay know the mod by, over every file it provides, its plugins and its FireGraft project; `withoutPlugins`: the same without the plugins, what a page that runs none of them presents), as `scmjs mod info` prints it. A copy of the game in the folder (a folder that holds StarDat.mpq) is not the mod: its own archives and everything under its Maps folder are left out, and the archives among them are named in `gameCopy`. `races` lists the races the mod adds as its mod.json declares them (empty when none are declared). `terrain` is its terrain.json beside mod.json (named flat ground, pieces and borrowed-terrain tables per tileset, for the editor), with counts per tileset; null when it has none.",
    inputSchema: { path: modPath, starcraft },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, starcraft: sc }) => {
    const source = await openMod(file, await gameFilesOrNull(sc));
    const r = modInfo(source, await sourceHash(source));
    return ok(printModInfo(r), r);
  }));

  reg("mod_check", {
    title: "Check a mod",
    description: "The lints across a mod's tables, strings, scripts and files (scmjs mod check): references past their tables, strings past their string table, images with no GRP or no iscript entry, button sets and requirements for things that are not there (errors); weapons and iscript entries the mod added that nothing uses, sound rows with no file, mixed extended layouts, units with one name (warnings). Each finding has where and why; `failed` is true when there is an error. What the mod leaves as the game had it is not judged. `hints` are not findings and fail nothing: one says when the mod's files suggest races of its own (names past the game's in network.tbl, per-race console files) and its mod.json declares none. A terrain.json beside the mod's mod.json is checked too: rows its reader leaves out, a tileset section made for another tile table than the mod's (the editor does not use it), rows the table has no pictures for (warnings).",
    inputSchema: { path: modPath, all: z.boolean().optional().describe("list every finding in the text; the data always has them all"), starcraft },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, all, starcraft: sc }) => {
    const base = await gameFilesOrNull(sc);
    const r = await checkModSource(await openMod(file, base), base);
    return ok(printModCheck(r, { all: !!all }), r);
  }));

  reg("mod_diff", {
    title: "What changed between two mods",
    description: "A changelog between two mods (scmjs mod diff), or with only `a`, between the game and the mod (everything the mod changes): table fields by name (\"Terran Marine: ground weapon damage 6 → 7\"), entries added, string table entries, iscript animations changed, and pictures, sounds and other files counted. Needs a copy of StarCraft for the one-mod form.",
    inputSchema: { a: modPath, b: z.string().optional().describe("the other mod; without it, the game against `a`"), all: z.boolean().optional().describe("list every change in the text"), starcraft },
    annotations: { readOnlyHint: true },
  }, tool(async ({ a, b, all, starcraft: sc }) => {
    const base = await gameFilesOrNull(sc);
    const r = await diffModSources(await openMod(a, base), b ? await openMod(b, base) : null, base);
    return ok(printModDiff(r, { all: !!all }), r);
  }));

  reg("mod_unpack", {
    title: "A mod as a folder of text",
    description: "Write a mod as a folder of text and pictures (scmjs mod unpack): tables as PyDAT text in tables/, string tables in strings/, iscript in iscript/, the AI scripts in ai/aiscript.txt, overlays in overlays/, .graft files in grafts/, GRPs as PNG sheets in graphics/, sounds in sounds/, everything else under files/, and mod.json. A text or picture is kept only when it packs back into the same bytes; mod.json says which files were kept as bytes and why. Edit the texts, then mod_pack. Refuses a folder that is there and is not an earlier unpack.",
    inputSchema: { path: modPath, out: z.string().describe("the folder to write"), palette: z.string().optional().describe("the tileset whose palette the GRPs are drawn with (jungle by default)"), force: z.boolean().optional().describe("replace a mod folder that is there already, edits and all (refused otherwise); its dot files, such as .git, are kept"), starcraft },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, out: dir, palette, force, starcraft: sc }) => {
    const base = await gameFilesOrNull(sc);
    const r = await unpackMod(await openMod(file, base), dir, { base, palette, force: !!force });
    const lines = [`${r.name}: ${r.members} files → ${nearPath(r.dir)}`, ...Object.entries(r.forms).map(([k, n]) => `  ${k}: ${n}`), ...r.kept.map((k) => `  kept as bytes, ${k.count}: ${k.why}`), ...r.notes];
    const { manifest: _m, ...data } = r;
    return ok(lines, data);
  }));

  reg("mod_pack", {
    title: "A mod folder back into an MPQ",
    description: "Pack a folder mod_unpack or mod_new wrote (scmjs mod pack): an MPQ the launchers load (MPQDraft, Chaoslauncher, FireGraft), or with `folder` the files loose in the game's paths (samase, the play page). The same folder gives the same bytes. Overwrites `out`.",
    inputSchema: {
      path: z.string().describe("the mod folder (with mod.json)"),
      out: z.string().optional().describe("the MPQ to write; <folder>.mpq beside the folder by default"),
      folder: z.string().optional().describe("write the files loose under this folder instead of an MPQ"),
      compression: z.enum(MOD_COMPRESSIONS as [ModCompression, ...ModCompression[]]).optional().describe("zlib (the default), pkware or none"),
      starcraft,
    },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: dir, out: to, folder, compression, starcraft: sc }) => {
    noPipe(folder);
    const manifest = await readModFolder(dir);
    const r = await packMod(dir, manifest, { out: to, folder, compression, base: await gameFilesOrNull(sc) });
    return ok([`Written ${nearPath(r.path)}: ${r.members} files, ${r.bytes} bytes${r.compression ? `, ${r.compression}` : ", loose"}`, ...r.quantised.map((q) => `${q.file}: ${q.pixels} pixels brought to the palette`), ...(r.left.length ? [`Left out: ${r.left.join(", ")}`] : [])], r);
  }));

  reg("mod_header", {
    title: "A mod's ids by name, for a bot",
    description: "Write a mod's units, weapons, upgrades and techs by name for a BWAPI bot made for it (scmjs mod header): <Mod>.h, C++ for a bot built with scmbot (Cosmonarchy_BW::UnitTypes::Terran_Mason is a BWAPI::UnitType), and <Mod>.ids.json, the same ids for other languages, both carrying the mod's name and hash. With `bot`, `out` is a bot's folder (it has scmbot.json) and its scmbot.json gains the mod, which `scmjs bot build` (Docker) writes into the .scmbot file; the runners and the play page then say the bot was made for that mod. With `js`, <Mod>.mjs in place of the header: the same ids as a JavaScript module for a JavaScript bot (which is also given the mod's names, name and hash at run time). Overwrites the two files in `out`.",
    inputSchema: {
      path: modPath,
      out: z.string().optional().describe("the folder the files go in (the working directory by default); with `bot`, the bot's folder"),
      namespace: z.string().optional().describe("the C++ namespace and the files' name (the mod's name made an identifier by default)"),
      bot: z.boolean().optional().describe("`out` is a bot's folder: write the mod into its scmbot.json"),
      js: z.boolean().optional().describe("for a JavaScript bot: <Mod>.mjs in place of the C++ header (not with `bot`)"),
      starcraft,
    },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, out: to, namespace, bot, js, starcraft: sc }) => {
    const base = await gameFilesOrNull(sc);
    const r = await writeModHeader(await openMod(file, base), base, { out: to, namespace, bot, js });
    return ok([
      `${r.mod.name}: ${r.counts.units} units, ${r.counts.weapons} weapons, ${r.counts.upgrades} upgrades, ${r.counts.techs} techs named · hash ${r.mod.hash}`,
      `${js ? "Module" : "Header"}: ${nearPath(r.files.header)}`, `Ids: ${nearPath(r.files.ids)}`,
      ...(r.files.scmbot ? [`Bot: ${nearPath(r.files.scmbot)} now names the mod: build the bot again (scmjs bot build)`] : []),
      ...(r.fromGame.length ? [`From the game: the names of ${r.fromGame.join(", ")} (the mod has not got them)`] : []),
    ], r);
  }));

  reg("mod_play", {
    title: "Play a mod on the play page",
    description: "Hand a mod to the play page in the person's browser (scmjs mod play): a page on this computer's loopback address opens scmjs.dev/play and gives it every file of the mod (nothing is uploaded; the page keeps the mod in the browser), with `map` the map, and with `bot` a bot for the other side — a .scmbot file, or a bot of the play page by its key (cosmonarchy-example, mcrave, ualbertabot, example), at `race`. With a bot the map is on the page's setup screen with the bot's row filled, saying whether it was made for the mod, and the person presses Start Game (`start` starts at once). Opens the person's browser, then waits for the page: returns the loopback link (to open by hand if no browser opened) and what the page said (ready, shown, started, the bot's row), or says the page was not reached. A bot of the play page needs the person signed in to scmjs.dev; the page asks. The first hand-over of a large mod takes minutes (Cosmonarchy: about two).",
    inputSchema: {
      path: modPath,
      map: z.string().optional().describe("the map to play: .scm or .scx; without it the page shows its maps"),
      bot: z.string().optional().describe("a .scmbot file on this computer, or a play page bot's key; needs `map`"),
      race: z.string().optional().describe("the bot's race where the map leaves it open: zerg, terran, protoss or random, or a race the mod's mod.json declares, by its name or number"),
      start: z.boolean().optional().describe("with `bot`, start the game at once instead of showing the setup screen"),
      wait: z.number().int().min(10).max(900).optional().describe("seconds to wait for the page, 300 by default"),
      starcraft,
    },
    annotations: { openWorldHint: true },
  }, tool(async ({ path: file, map: mapFile, bot, race, start, wait, starcraft: sc }) => {
    noPipe(mapFile, bot);
    if (bot && !mapFile) throw new CliError("`bot` needs `map`: the bot plays on a map.", null, 2);
    const playBot = bot ? playBotOf(bot) : null;
    const source = await openMod(file, await gameFilesOrNull(sc));
    const botRace = race ? pageRace(race, source.races) : undefined;
    const set = await playSet(source);
    const map = mapFile ? await readInput(mapFile) : null;
    if (map) expectKind(map, "map");
    let link = "";
    const lines: string[] = [];
    try {
      const r = await playOnPage(set, {
        map: map && { name: map.name, bytes: map.bytes }, bot: playBot, botRace, start,
        live: (line) => { lines.push(visible(line)); printErr(visible(line)); }, onAddress: (a) => { link = a; }, timeout: (wait ?? 300) * 1000,
      });
      const said = r.said.map((m) => m.type);
      const head = r.error ? `The play page said: ${r.error}` : r.shown ? `${set.name} is on the play page's setup screen${r.bot ? `, the bot's row: ${r.bot}. The person presses Start Game.` : "."}` : `${set.name} is playing on the play page${r.bot ? `, against ${r.bot}` : ""}.`;
      const data = { link, name: set.name, hash: set.hash, withoutPlugins: set.withoutPlugins, files: set.total.files, started: r.started, shown: r.shown, error: r.error, bot: r.bot, said };
      return { ...ok([head, `Hand-over page: ${link}`, `The page said: ${said.join(", ") || "nothing"}`], data), ...(r.error ? { isError: true } : {}) };
    } catch (e) {
      if (e instanceof CliError && link) throw new CliError(`${e.message}. The hand-over page was ${link}; the person can open it in a browser while the tool waits, or call mod_play again.`, e.hint, e.exitCode);
      throw e;
    }
  }));

  reg("mod_new", {
    title: "A new mod folder",
    description: "Start an empty mod folder (scmjs mod new): mod.json and a README. Put the game's files the mod changes under files/ at their paths, or the texts under tables/, strings/ and the rest, then mod_pack. Refuses a folder that is there and not empty; a mod folder that is there is replaced only with `force`.",
    inputSchema: { path: z.string().describe("the folder to make"), name: z.string().optional().describe("the mod's name (the folder's by default)"), force: z.boolean().optional().describe("replace a mod folder that is there already, edits and all") },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: dir, name, force }) => {
    const r = await newMod(dir, name, { force: !!force });
    return ok([`${r.name}: ${r.files.join(", ")} in ${nearPath(r.dir)}`], r);
  }));
}
