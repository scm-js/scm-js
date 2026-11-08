/**
 * A replay's mod in `scmjs replay`: the SCMJ section `@scm-js/replay` reads shown by `replay info`, the names and costs
 * of `--builds` from the game's names, from bare ids for a mod's replay with no mod named, and from a mod named with
 * `--mod` once its data set's hash is the replay's; a different mod refused, an untagged replay warned of; and the
 * commands that play a replay in the engine refusing a mod's. Every replay and mod here is made by the test.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendModTag, parseReplay, type ModTag, type Replay } from "@scm-js/replay";
import { chk, cmds, le16, writeReplay } from "@scm-js/replay/write";
import { describe, expect, it } from "vitest";
import { emptyDat, encodeDat } from "../src/formats/dat/table";
import { encodeTblFile } from "../src/formats/dat/tblFile";
import { dataSetHash } from "../src/formats/mod/sources";
import { printReplayInfo, replayReport } from "../cli/src/replay";
import { buildOrders, checkPlayedMod, modReplayReason, refuseModReplay, replayNamer } from "../cli/src/replaymod";
import { CliError, visible } from "../cli/src/ui";

const players = [{ index: 0, id: 0, race: 1, name: "Alpha" }, { index: 1, id: 1, race: 0, name: "Beta" }];
/** Alpha trains an SCV twice, builds a Supply Depot, researches Stim Packs (tech 0) and upgrades Infantry Weapons (7). */
const commands = cmds([
  [10, 0, 0x1f, ...le16(7)],
  [20, 0, 0x1f, ...le16(7)],
  [30, 0, 0x0c, 0x1e, ...le16(10), ...le16(12), ...le16(109)],
  [40, 0, 0x30, 0],
  [50, 0, 0x32, 7],
]);
const plain = () => writeReplay({ format: "legacy", players, commands, chk: chk(64, 64) });
const input = (bytes: Uint8Array, name = "game.rep") => ({ path: name, name, bytes, kind: "replay" as const });

const dir = mkdtempSync(join(tmpdir(), "scmjs-replay-mod-"));

/** A mod of two files: units.dat with the SCV at 77 minerals, unitnames.tbl calling it "Test Mason". Its folder, and its hash over every file. */
async function testMod(): Promise<{ folder: string; hash: string }> {
  const folder = join(dir, `mod-${Math.random().toString(36).slice(2)}`);
  const units = emptyDat("units");
  units.columns.mineral_cost[7] = 77;
  units.columns.vespene_cost[7] = 1;
  const names = Array.from({ length: 228 }, (_, i) => (i === 7 ? "Test Mason\0" : "\0"));
  const files = [
    { name: "arr\\units.dat", bytes: encodeDat(units) },
    { name: "rez\\unitnames.tbl", bytes: encodeTblFile({ strings: names, encoding: "windows-1252" }) },
  ];
  for (const f of files) {
    const path = join(folder, ...f.name.split("\\"));
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, f.bytes);
  }
  return { folder, hash: await dataSetHash(files) };
}

const tag = (hash: string, more: Partial<ModTag> = {}): ModTag => ({
  v: 1, dataSet: { hash, name: "Test Mod", url: "https://example.org/test-mod" }, plugins: [], firegraft: null, noplugins: false, engine: null, madeBy: "test", ...more,
});

const tagged = async (hash: string, more: Partial<ModTag> = {}): Promise<Replay> => parseReplay(await appendModTag(plain(), tag(hash, more)));
const quiet = () => {};

describe("scmjs replay info and a replay's mod", () => {
  it("says none for a replay of the game itself", async () => {
    const r = replayReport(input(plain()), await parseReplay(plain()));
    expect(r.mod).toBeNull();
    const lines = printReplayInfo(r).map(visible);
    expect(lines).toContainEqual(expect.stringMatching(/^ {2}Mod +none$/));
    expect(lines.some((l) => /Plugins/.test(l))).toBe(false);
  });

  it("names the mod, its hash, its link and the plugins from the replay's section", async () => {
    const rep = await tagged("0123456789abcdef", { plugins: [{ name: "first.qdp", sha256: "a".repeat(64) }], firegraft: { name: "Test.fgp", sha256: "b".repeat(64) } });
    const r = replayReport(input(plain()), rep);
    expect(r.mod?.dataSet.hash).toBe("0123456789abcdef");
    const lines = printReplayInfo(r).map(visible);
    expect(lines).toContainEqual(expect.stringMatching(/^ {2}Mod +Test Mod · 0123456789abcdef · https:\/\/example\.org\/test-mod$/));
    expect(lines).toContainEqual(expect.stringMatching(/^ {2}Plugins +first\.qdp, Test\.fgp$/));
    expect(JSON.parse(JSON.stringify(r)).mod.plugins).toEqual([{ name: "first.qdp", sha256: "a".repeat(64) }]);
  });

  it("lists the orders with the game's names for the game itself", async () => {
    const rep = await parseReplay(plain());
    const names = await replayNamer(rep, "game.rep", { warn: quiet });
    expect(names.from.kind).toBe("game");
    const [alpha] = buildOrders(rep, names);
    expect(alpha.items.map((i) => [i.kind, i.id, i.orders, i.first])).toEqual([["unit", 7, 2, 10], ["building", 109, 1, 30], ["tech", 0, 1, 40], ["upgrade", 7, 1, 50]]);
    expect(alpha.items[0].name).toMatch(/SCV/);
    expect(alpha.items[1].name).toMatch(/Supply Depot/);
  });

  it("never gives a mod's replay the game's names: ids, and a word on --mod", async () => {
    const rep = await tagged("0123456789abcdef");
    const names = await replayNamer(rep, "game.rep", { warn: quiet });
    expect(names.from.kind).toBe("ids");
    const [alpha] = buildOrders(rep, names);
    expect(alpha.items.map((i) => i.name)).toEqual(["unit 7", "unit 109", "technology 0", "upgrade 7"]);
    expect(alpha.items.every((i) => i.minerals === null)).toBe(true);
    const r = { ...replayReport(input(plain()), rep), names: names.from, builds: buildOrders(rep, names) };
    expect(printReplayInfo(r).map(visible).join("\n")).toMatch(/name the folder of Test Mod with --mod/);
  });

  it("takes the names and costs from the mod named when its data set is the replay's", async () => {
    const mod = await testMod();
    const rep = await tagged(mod.hash);
    const names = await replayNamer(rep, "game.rep", { mod: mod.folder, warn: quiet });
    expect(names.from).toMatchObject({ kind: "mod", hash: mod.hash });
    const [alpha] = buildOrders(rep, names);
    expect(alpha.items[0]).toMatchObject({ name: "Test Mason", minerals: 77, gas: 1, orders: 2 });
  });

  it("refuses a mod whose data set is another, in one sentence with the replay's link", async () => {
    const mod = await testMod();
    const rep = await tagged("fedcba9876543210");
    const e = await replayNamer(rep, "game.rep", { mod: mod.folder, warn: quiet }).catch((x) => x);
    expect(e).toBeInstanceOf(CliError);
    expect(e.message).toBe(`${mod.folder.split(/[\\/]/).pop()} is not the mod game.rep was played with: its data set is ${mod.hash}, the replay's is fedcba9876543210 (Test Mod).`);
    expect(e.hint).toBe("The mod's makers: https://example.org/test-mod");
  });

  it("warns when the replay does not say, and names from the mod", async () => {
    const mod = await testMod();
    const said: string[] = [];
    const names = await replayNamer(await parseReplay(plain()), "game.rep", { mod: mod.folder, warn: (l) => said.push(l) });
    expect(said).toEqual([expect.stringMatching(/^game\.rep does not say which mod it was played with/)]);
    expect(names.unit(7)).toBe("Test Mason");
  });
});

describe("the commands that play a replay and a mod's replay", () => {
  it("refuse it, naming the mod, where they cannot lay the mod over the game", async () => {
    const rep = await tagged("0123456789abcdef");
    expect(() => refuseModReplay(rep, "game.rep", "replay watch")).toThrow(/^game\.rep was played with Test Mod · 0123456789abcdef, and replay watch cannot play a mod's replay yet/);
    expect(modReplayReason(rep)).toMatch(/^played with Test Mod/);
    const own = await parseReplay(plain());
    expect(() => refuseModReplay(own, "game.rep", "replay watch")).not.toThrow();
    expect(modReplayReason(own)).toBeNull();
  });

  it("with --mod, take only the same data set, and not a game its plugins ran in", async () => {
    const mod = await testMod();
    await expect(checkPlayedMod(await tagged(mod.hash), "game.rep", undefined, undefined, quiet)).rejects.toThrow(/name the mod's folder with --mod/);
    await expect(checkPlayedMod(await tagged(mod.hash), "game.rep", mod.folder, undefined, quiet)).resolves.toBeUndefined();
    await expect(checkPlayedMod(await tagged("fedcba9876543210"), "game.rep", mod.folder, undefined, quiet)).rejects.toThrow(/is not the mod/);
    await expect(checkPlayedMod(await tagged(mod.hash, { plugins: [{ name: "p.qdp", sha256: "c".repeat(64) }] }), "game.rep", mod.folder, undefined, quiet)).rejects.toThrow(/plugins/);
    await expect(checkPlayedMod(await parseReplay(plain()), "game.rep", undefined, undefined, quiet)).resolves.toBeUndefined();
  });
});
