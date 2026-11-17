/** The MCP tools that read a replay: `replay_info` and `replay_map`. */
import { z } from "zod";
import { besideInput, expectKind, loadReplayInput, readInput } from "./files";
import { printReplayInfo, replayReport } from "./replay";
import { buildOrders, replayNamer } from "./replaymod";
import { mapFileFor, writeReplayMap } from "./replaymap";
import { refuseOverwrite } from "./options";
import { ok, written, tool, type Reg } from "./mcpkit";

export function addReplayInfoTool(reg: Reg): void {
  reg("replay_info", {
    title: "What a replay holds",
    description: "Who played a replay (.rep), their races (a race a mod adds by the name the replay's tag or the mod's mod.json declares, else \"Race\" and its number; `raceId` is the byte), colours, teams and APM, on which map, for how long, when, and at what speed, as `scmjs replay info` prints it, and the mod it was played with when the replay says (`mod`: the data set's name, hash and link, the plugins that ran; null for the game itself). `builds` adds what each player ordered (units, buildings, upgrades, technologies) by name with their cost. A mod's replay names them only with `mod`, the mod's folder (or .mpq, .exe, .zip), which is refused when its data set's hash is not the replay's; without it the orders are ids.",
    inputSchema: {
      path: z.string().describe("the replay file (.rep)"),
      builds: z.boolean().optional().describe("also list what each player ordered, by name, with its cost"),
      mod: z.string().optional().describe("the mod the replay was played with, for its names and costs: a folder, an .mpq, a mod's .exe or .zip"),
      starcraft: z.string().optional().describe("the folder of the person's StarCraft installation, for the game's costs and the files under a mod; found in the usual places otherwise"),
    },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, builds, mod, starcraft }) => {
    const input = await readInput(file);
    expectKind(input, "replay");
    const rep = await loadReplayInput(input);
    const warnings: string[] = [];
    const names = mod || builds ? await replayNamer(rep, input.name, { mod, starcraft, costs: !!builds, warn: (line) => warnings.push(line) }) : null;
    const races = names?.races ?? [];
    const r = replayReport(input, rep, races);
    if (names) {
      r.names = names.from;
      if (builds) r.builds = buildOrders(rep, names);
    }
    return ok([...warnings, ...printReplayInfo(r, races)], r);
  }));
}

export function addReplayMapTool(reg: Reg): void {
  reg("replay_map", {
    title: "The map a replay was played on",
    description: "Write out the map a replay (.rep) was played on, which the replay carries whole (scmjs replay map): to `out` (.scx, .scm or .chk), or beside the replay with its name and .scx. The map's sounds and other files are not in a replay, only the scenario. Refuses a file that is there unless `force`.",
    inputSchema: { path: z.string().describe("the replay file (.rep)"), out: z.string().optional().describe("the map file to write; the replay's name with .scx, beside it, by default"), force: z.boolean().optional() },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, out: to, force }) => {
    const input = await readInput(file);
    expectKind(input, "replay");
    const out = to ?? mapFileFor(besideInput(input));
    refuseOverwrite(out, force, "force overwrites it, out names another file.");
    const r = await writeReplayMap(await loadReplayInput(input), out);
    return ok([`${r.name || "Untitled"}: ${r.width} × ${r.height}, from ${input.name}`, written(r.written)], { file: input.name, ...r });
  }));
}
