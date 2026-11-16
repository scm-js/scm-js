/**
 * The Scenario menu's settings from the command line (cli/src/settings.ts): `scmjs map settings` and what
 * `scmjs map set --settings` and the tool `map_set` set. Players, forces, names, availability, levels and switches
 * on tests/maps/ums.scx with no game data; the numbers of a unit, upgrade or technology, which are filled in from
 * the game's tables, in a suite that needs a copy of StarCraft on this computer and is skipped on CI.
 */
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";
import { findGameCopy } from "../cli/src/engine";
import { writeBack } from "../cli/src/exchange";
import { loadMapInput, readInput } from "../cli/src/files";
import { buildProgram, run } from "../cli/src/main";
import { createMcpServer } from "../cli/src/mcp";
import { applySettings, listSettings, needsTables, parseSettings, printSettingChanges, printSettings } from "../cli/src/settings";
import { CliError, visible } from "../cli/src/ui";
import { testMap } from "./support/maps";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-settings-"));
const failure = async (p: Promise<unknown>): Promise<CliError> => p.then(() => { throw new Error("did not fail"); }, (e: unknown) => e as CliError);
/** A copy of ums.scx to change, with what the command reads of it. */
async function copy() {
  const path = join(tmp(), "ums.scx");
  copyFileSync(testMap("ums.scx"), path);
  const input = await readInput(path);
  return { path, input, doc: await loadMapInput(input) };
}
const open = async (path: string) => loadMapInput(await readInput(path));
/** Set `settings` on the map at `path` and write it, as the command does. */
async function set(path: string, settings: unknown, options: { starcraft?: string } = {}) {
  const input = await readInput(path);
  const r = await applySettings(await loadMapInput(input), parseSettings(settings), options);
  if (r.changes.length) await writeBack(r.doc, input.path, null);
  return r;
}
const said = (changes: { subject: string; field: string; from: string; to: string }[]) => changes.map((c) => `${c.subject} ${c.field}: ${c.from} → ${c.to}`);

/** `scmjs …` as the command runs it: what it wrote where, and its exit code. */
async function scmjs(...args: string[]): Promise<{ out: string; err: string; code: number }> {
  let out = "", err = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation((s) => { out += String(s); return true; });
  const e = vi.spyOn(process.stderr, "write").mockImplementation((s) => { err += String(s); return true; });
  process.exitCode = 0;
  try {
    const program = buildProgram();
    const override = (c: Command): void => { c.exitOverride(); c.commands.forEach(override); };
    override(program);
    await run(args, program);
  } finally { o.mockRestore(); e.mockRestore(); }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return { out: visible(out), err: visible(err), code };
}
afterEach(() => { process.exitCode = 0; });

describe("map settings", () => {
  it("lists the players, the forces, and what the map changes from the game's", async () => {
    const { doc } = await copy();
    const r = await listSettings(doc, "ums.scx");
    expect(r.players).toHaveLength(12);
    expect(r.players[0]).toEqual({ player: 1, type: "Human", race: "Terran", color: "Red", rgb: null, force: 1, forceName: "Defenders" });
    expect(r.players[1]).toMatchObject({ player: 2, type: "Computer", race: "Zerg", color: "Blue", force: 2 });
    expect(r.players[11]).toMatchObject({ player: 12, type: "Neutral", color: null, force: null });
    expect(r.forces.map((f) => [f.force, f.name, f.players])).toEqual([[1, "Defenders", [1, 3, 4, 5, 6, 7, 8]], [2, "Swarm", [2]], [3, "Force 3", []], [4, "Force 4", []]]);
    expect(r.forces[0]).toMatchObject({ allied: true, alliedVictory: true, sharedVision: true, randomStart: false });
    expect(r.units.map((u) => [u.id, u.customName, u.useDefault, u.hitPoints])).toEqual([[0, "Test Marine", false, 80]]);
    expect([r.upgrades, r.techs, r.game, r.one]).toEqual([[], [], null, false]);
    expect(r.switches).toEqual([{ switch: 1, name: "Alarm raised" }]);
    const lines = printSettings("ums.scx", r).map(visible);
    expect(lines.slice(0, 4)).toEqual(["ums.scx", "Players", "  player  type      race      colour  force", "  1       Human     Terran    Red     1 Defenders"]);
    expect(lines).toContain("  Terran Marine  0  named \"Test Marine\" · 80 hit points, armor 2, build time 300, 75 minerals, 0 gas");
    expect(lines.slice(-3)).toEqual(["Upgrades: as the game has them", "Technologies: as the game has them", "Switches: 1 \"Alarm raised\""]);
  });

  it("shows one row alone when it is asked for by name, changed or not", async () => {
    const { doc } = await copy();
    const marine = await listSettings(doc, "ums.scx", { unit: "Marine", game: false });
    expect([marine.one, marine.units.map((u) => u.id), marine.upgrades, marine.techs]).toEqual([true, [0], [], []]);
    expect(printSettings("ums.scx", marine).map(visible)).toEqual(["ums.scx", "  Terran Marine  0  named \"Test Marine\" · 80 hit points, armor 2, build time 300, 75 minerals, 0 gas"]);
    const stim = await listSettings(doc, "ums.scx", { tech: "stim", game: false });
    expect(stim.techs.map((x) => [x.id, x.name, x.useDefault])).toEqual([[0, "Stim Packs", true]]);
    expect(printSettings("ums.scx", stim).map(visible)[1]).toBe("  Stim Packs  0  the game's numbers · available by default");
    expect((await failure(listSettings(doc, "ums.scx", { upgrade: "Warp Drive", game: false }))).message).toBe("No upgrade is called \"Warp Drive\"");
    expect((await failure(listSettings(doc, "ums.scx", { upgrade: "plating", game: false }))).message).toMatch(/^"plating" could be any of "Terran Vehicle Plating", "Terran Ship Plating"/);
  });
});

describe("map set --settings: the shape", () => {
  it("takes any of the groups, and names what does not fit by its place", () => {
    const given = { players: [{ player: 2, type: "Computer", race: "Zerg", color: [10, 20, 30], force: 2 }], switches: [{ switch: 3, name: "Gate" }] };
    expect(parseSettings(given)).toEqual(given);
    const cases: [unknown, RegExp][] = [
      [[], /The settings are a JSON object/],
      [{}, /The settings name nothing to set/],
      [{ players: [{ player: 13 }] }, /^`players\[0\]\.player`: /],
      [{ players: [{ player: 1, colour: "Red" }] }, /^`players\[0\]`: Unrecognized key: "colour"/],
      [{ forces: [{ force: 1, players: [9] }] }, /^`forces\[0\]\.players\[0\]`: /],
      [{ units: [{ unit: "Marine", weapons: [] }] }, /^`units\[0\]\.weapons`: /],
      [{ sounds: [] }, /Unrecognized key: "sounds"/],
    ];
    for (const [value, words] of cases) expect(() => parseSettings(value), JSON.stringify(value)).toThrow(words);
  });

  it("knows which settings read the game's tables", () => {
    const needs = (s: unknown) => needsTables(parseSettings(s));
    expect(needs({ players: [{ player: 2, race: "Zerg" }], forces: [{ force: 1, name: "A" }], switches: [{ switch: 1, name: "S" }] })).toBe(false);
    expect(needs({ units: [{ unit: "Marine", name: "Trooper", available: [{ player: 2, value: false }] }] })).toBe(false);
    expect(needs({ units: [{ unit: "Marine", useDefault: true }] })).toBe(false);
    expect(needs({ upgrades: [{ upgrade: 0, levels: [{ player: "default", max: 1 }] }], techs: [{ tech: 0, state: [{ player: 1, researched: true }] }] })).toBe(false);
    for (const s of [{ units: [{ unit: "Marine", hitPoints: 60 }] }, { units: [{ unit: "Marine", useDefault: false }] }, { units: [{ unit: "Marine", weapons: [{ weapon: 0, damage: 9 }] }] }, { upgrades: [{ upgrade: 0, gasCost: 50 }] }, { techs: [{ tech: 0, energyCost: 0 }] }]) expect(needs(s), JSON.stringify(s)).toBe(true);
  });
});

describe("map set --settings: setting", () => {
  it("sets players, forces, names, availability, levels, state and switches, and says each change", async () => {
    const { path } = await copy();
    const r = await set(path, {
      players: [{ player: 2, race: "Protoss", color: "Teal" }, { player: 3, type: "Computer", race: "Zerg", force: 2 }, { player: 4, color: [200, 100, 50] }],
      forces: [{ force: 2, name: "The Swarm", randomStart: true }, { force: 3, name: "Watchers", players: [8], allied: true }],
      units: [{ unit: "Terran Ghost", name: "Spectre", available: [{ player: "default", value: false }, { player: 1, value: true }] }],
      upgrades: [{ upgrade: "Zerg Carapace", levels: [{ player: 2, start: 1, max: 3 }, { player: "default", max: 2 }] }],
      techs: [{ tech: "Stim Packs", state: [{ player: 1, researched: true }, { player: "default", available: false }] }],
      switches: [{ switch: 1, name: "Gate is open" }, { switch: 2, name: "Bridge is down" }],
    });
    expect(r.game).toBeNull();
    expect(said(r.changes)).toEqual([
      "Player 2 race: Zerg → Protoss", "Player 2 colour: Blue → Teal",
      "Player 3 type: Inactive → Computer", "Player 3 race: Inactive → Zerg", "Player 3 force: 1 → 2",
      "Player 4 colour: Purple → rgb(200, 100, 50)",
      "Force 2 name: Swarm → The Swarm", "Force 2 random start: no → yes",
      "Force 3 name: Force 3 → Watchers", "Force 3 players: none → 8", "Force 3 allied: no → yes",
      "Terran Ghost name:  → Spectre", "Terran Ghost available by default: yes → no", "Terran Ghost available to Player 1: default → yes",
      "Zerg Carapace top level by default: 3 → 2", "Zerg Carapace levels of Player 2: default → 1–3",
      "Stim Packs by default: available → not available", "Stim Packs for Player 1: default → researched",
      "Switch 1 name: Alarm raised → Gate is open", "Switch 2 name:  → Bridge is down",
    ]);
    expect(r.changes[0]).toEqual({ kind: "player", id: 2, subject: "Player 2", field: "race", from: "Zerg", to: "Protoss" });
    expect(printSettingChanges(r.changes).map(visible)[11]).toMatch(/^ {2}Terran Ghost {2,}name {2,}\(none\) → Spectre$/);
    // Read back from the written file.
    const after = await listSettings(await open(path), "ums.scx");
    expect(after.players.slice(1, 4).map((p) => [p.type, p.race, p.color, p.rgb, p.force])).toEqual([["Computer", "Protoss", "Teal", null, 2], ["Computer", "Zerg", "Teal", null, 2], ["Inactive", "Inactive", "Purple", [200, 100, 50], 1]]);
    expect(after.forces.map((f) => [f.name, f.players, f.allied, f.randomStart])).toEqual([["Defenders", [1, 4, 5, 6, 7], true, false], ["The Swarm", [2, 3], true, true], ["Watchers", [8], true, false], ["Force 4", [], false, false]]);
    const ghost = after.units.find((u) => u.id === 1)!;
    expect([ghost.customName, ghost.useDefault, ghost.availability.defaultAvailable, ghost.availability.players.slice(0, 2)]).toEqual(["Spectre", true, false, [true, "default"]]);
    expect(after.upgrades.map((u) => [u.name, u.useDefault, u.levels.defaultMax, u.levels.players[1]])).toEqual([["Zerg Carapace", true, 2, { start: 1, max: 3, usesDefault: false }]]);
    expect(after.techs.map((x) => [x.name, x.state.defaultAvailable, x.state.players[0]])).toEqual([["Stim Packs", false, { available: true, researched: true, usesDefault: false }]]);
    expect(after.switches).toEqual([{ switch: 1, name: "Gate is open" }, { switch: 2, name: "Bridge is down" }]);
    const lines = printSettings("ums.scx", after).map(visible);
    expect(lines).toContain("  Terran Ghost   1  named \"Spectre\" · the game's numbers · not available by default · available to Player 1");
    expect(lines).toContain("  Zerg Carapace  3  the game's numbers · levels 0–2 by default · Player 2 1–3");
    expect(lines).toContain("  Stim Packs  0  the game's numbers · not available by default · Player 1 researched");
    // The same again changes nothing.
    expect((await set(path, { players: [{ player: 2, race: "Protoss" }], switches: [{ switch: 1, name: "Gate is open" }] })).changes).toEqual([]);
  });

  it("checks every name before it sets anything, and names the entry", async () => {
    const { path, doc } = await copy();
    const before = readFileSync(path);
    const fails = async (settings: unknown) => failure(applySettings(doc, parseSettings(settings)));
    const race = await fails({ players: [{ player: 2, race: "Protoss" }, { player: 3, race: "Zergg" }] });
    expect(race.message).toBe("players[1]: No race is called \"Zergg\"");
    expect(race.hint).toBe("One of Zerg, Terran, Protoss, User Selectable, Random, Independent, Neutral, Inactive. Nothing was changed.");
    // The first entry was not set: the map in memory still has Player 2 as Zerg.
    expect((await listSettings(doc, "ums.scx")).players[1].race).toBe("Zerg");
    expect((await fails({ players: [{ player: 9, color: "Red" }] })).message).toBe("players[0]: Player 9 has no colour or force: those are for players 1 to 8");
    expect((await fails({ players: [{ player: 1, color: "Mauve" }] })).message).toBe("players[0]: No colour is called \"Mauve\"");
    expect((await fails({ players: [{ player: 1 }] })).message).toMatch(/^players\[0\]: nothing to set: give `type`, `race`, `color` or `force`$/);
    expect((await fails({ units: [{ unit: "Space Whale", name: "x" }] })).message).toMatch(/^units\[0\]: No unit is called "Space Whale"/);
    expect((await fails({ techs: [{ tech: "Teleport", state: [{ player: 1, researched: true }] }] })).message).toBe("techs[0]: No technology is called \"Teleport\"");
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it("refuses a number without the game's tables to fill in the rest of the row", async () => {
    const { path, doc } = await copy();
    const dir = tmp();
    const e = await failure(applySettings(doc, parseSettings({ units: [{ unit: "Zergling", hitPoints: 50 }] }), { starcraft: dir }));
    expect(e).toBeInstanceOf(CliError);
    expect(e.message).toMatch(/is not a copy of StarCraft/);
    // The map in memory is as it was: the Zergling is still on the game's numbers.
    expect((await listSettings(doc, "ums.scx", { unit: "Zergling", game: false })).units[0].useDefault).toBe(true);
    expect(readFileSync(path).equals(readFileSync(testMap("ums.scx")))).toBe(true);
  });

  it("runs as commands: map settings, and map set with a file, a dry run and a name", async () => {
    const { path } = await copy();
    const file = join(tmp(), "settings.json");
    writeFileSync(file, JSON.stringify({ players: [{ player: 2, race: "Protoss" }], forces: [{ force: 2, name: "The Swarm" }] }));
    const dry = await scmjs("map", "set", path, "--settings", file, "--name", "Hold the Ridge", "--dry-run");
    expect(dry.code).toBe(0);
    expect(dry.out.trimEnd().split("\n")).toEqual([
      "  Player 2  race  Zerg → Protoss",
      "  Force 2   name  Swarm → The Swarm",
      "ℹ ums.scx: Name Test Scenario → Hold the Ridge · 2 settings changed (--dry-run: nothing written)",
    ]);
    expect(readFileSync(path).equals(readFileSync(testMap("ums.scx")))).toBe(true);
    const done = await scmjs("map", "set", path, "--settings", file);
    expect(done.out).toMatch(/\n✔ ums\.scx: 2 settings changed · written to .*ums\.scx · [\d.]+ KB\n$/);
    const listed = await scmjs("map", "settings", path);
    expect(listed.out).toContain("  2       Computer  Protoss   Blue    2 The Swarm\n");
    const json = JSON.parse((await scmjs("map", "set", path, "--settings", file, "--json")).out) as { changes: unknown[]; settings: unknown[]; written: unknown };
    expect([json.changes, json.settings, json.written]).toEqual([[], [], null]);
    const bad = await scmjs("map", "set", path, "--settings", file, "--revision", "nonsense");
    expect(bad.code).toBe(2);
    writeFileSync(file, "{ not json");
    const notJson = await scmjs("map", "set", path, "--settings", file);
    expect([notJson.code, /settings\.json is not JSON/.test(notJson.err)]).toEqual([2, true]);
    expect((await scmjs("map", "set", path)).err).toMatch(/Nothing to set\n\s+--name, --description, --revision, --encoding or --settings, any of them\./);
  });
});

describe("scmjs mcp: map_settings and map_set", () => {
  type Result = { content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
  const text = (r: Result) => r.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  async function connected() {
    const client = new Client({ name: "test", version: "0" });
    const { server } = createMcpServer();
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return { client, call: async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Result };
  }

  it("reads the settings, sets some with the name, and refuses what is not a setting", async () => {
    const { client, call } = await connected();
    try {
      const { path } = await copy();
      const { tools } = await client.listTools();
      expect(tools.find((x) => x.name === "map_settings")?.annotations?.readOnlyHint).toBe(true);
      const setTool = tools.find((x) => x.name === "map_set")!;
      expect(Object.keys(setTool.inputSchema.properties as object)).toEqual(["path", "name", "description", "revision", "encoding", "players", "forces", "units", "upgrades", "techs", "switches", "out", "dryRun", "starcraft"]);
      for (const group of ["players", "forces", "units", "upgrades", "techs", "switches"]) expect(setTool.description, group).toContain(`- ${group}: `);
      expect(JSON.stringify(setTool).length).toBeLessThan(10000);

      const read = await call("map_settings", { path });
      expect(text(read)).toMatch(/^ums\.scx\nPlayers\n\s+player\s+type\s+race\s+colour\s+force\n\s+1\s+Human\s+Terran\s+Red\s+1 Defenders\n/);
      expect((read.structuredContent as { players: unknown[]; switches: unknown[] }).switches).toEqual([{ switch: 1, name: "Alarm raised" }]);

      const out = join(tmp(), "set.scx");
      const done = await call("map_set", { path, out, name: "Hold the Ridge", players: [{ player: 2, type: "Human", race: "Protoss" }], forces: [{ force: 2, name: "Raiders", allied: false }], switches: [{ switch: 4, name: "Gate" }] });
      expect(done.isError, text(done)).toBeFalsy();
      expect(text(done).split("\n")).toEqual([
        "Name: Test Scenario → Hold the Ridge",
        "Player 2 type: Computer → Human", "Player 2 race: Zerg → Protoss",
        "Force 2 name: Swarm → Raiders", "Force 2 allied: yes → no",
        "Switch 4 name: (none) → Gate",
        expect.stringMatching(/^Written to .*set\.scx \(\d+ bytes\)$/),
      ]);
      expect((done.structuredContent as { settings: unknown[]; game: unknown }).game).toBeNull();
      expect((await listSettings(await open(out), "set.scx")).players[1]).toMatchObject({ type: "Human", race: "Protoss" });
      // The map it started from is as it was.
      expect(readFileSync(path).equals(readFileSync(testMap("ums.scx")))).toBe(true);

      const dry = await call("map_set", { path, dryRun: true, players: [{ player: 2, race: "Random" }] });
      expect(text(dry)).toBe("Player 2 race: Zerg → Random\nNot written (dryRun).");
      const unknown = await call("map_set", { path, players: [{ player: 2, race: "Zergg" }] });
      expect([unknown.isError, text(unknown).split("\n")[0]]).toEqual([true, "players[0]: No race is called \"Zergg\""]);
      const stray = await call("map_set", { path, sounds: [] });
      expect([stray.isError, /`sounds` is not an argument of map_set/.test(text(stray))]).toEqual([true, true]);
      expect(text(await call("map_set", { path }))).toMatch(/^Nothing to set\nname, description, revision, encoding, or any of players, forces, units, upgrades, techs, switches\.$/);
    } finally { await client.close(); }
  });
});

const game = (() => { try { return findGameCopy(process.env.SCMJS_STARCRAFT, { pictures: true }); } catch { return null; } })();

describe.skipIf(!game)("map set --settings: numbers, with a copy of the game", () => {
  it("takes a type off the game's numbers and fills the rest of its row from the game's tables", async () => {
    const { path } = await copy();
    const r = await set(path, {
      units: [{ unit: "Zergling", hitPoints: 50, weapons: [{ weapon: "Claws", damage: 8 }] }],
      upgrades: [{ upgrade: "Zerg Carapace", mineralCost: 100 }],
      techs: [{ tech: "Lockdown", energyCost: 50 }],
    });
    expect(r.game).toMatchObject({ units: true });
    expect(said(r.changes)).toEqual([
      "Zerg Zergling uses the game's numbers: yes → no", "Zerg Zergling hit points: 35 → 50", "Zerg Zergling Claws damage: 5 → 8",
      "Zerg Carapace uses the game's numbers: yes → no", "Zerg Carapace minerals: 150 → 100",
      "Lockdown uses the game's numbers: yes → no", "Lockdown energy: 100 → 50",
    ]);
    // Read back with no game data: the row holds the game's own build time, cost and armour, not zeros.
    const after = await listSettings(await open(path), "ums.scx");
    expect(after.game).toBeNull();
    const ling = after.units.find((u) => u.id === 37)!;
    expect([ling.useDefault, ling.hitPoints, ling.armor, ling.buildTime, ling.mineralCost, ling.gasCost]).toEqual([false, 50, 0, 420, 50, 0]);
    expect(after.upgrades.map((u) => [u.name, u.mineralCost, u.mineralFactor, u.gasCost, u.timeCost])).toEqual([["Zerg Carapace", 100, 75, 150, 4000]]);
    expect(after.techs.map((x) => [x.name, x.mineralCost, x.gasCost, x.researchTime, x.energyCost])).toEqual([["Lockdown", 200, 200, 1500, 50]]);
    // Asked for by name with the game there: the map's numbers with the game's beside them.
    const one = await listSettings(await open(path), "ums.scx", { unit: "Zergling" });
    expect(one.game).not.toBeNull();
    expect(printSettings("ums.scx", one).map(visible)[1]).toBe("  Zerg Zergling  37  50 hit points, armor 0, build time 420, 50 minerals, 0 gas, Claws 8 +1 (the game's: 35 hit points, armor 0, build time 420, 50 minerals, 0 gas, Claws 5 +1)");
    // Back on the game's numbers.
    expect(said((await set(path, { units: [{ unit: "Zergling", useDefault: true }] })).changes)).toEqual(["Zerg Zergling uses the game's numbers: no → yes"]);
  });

  it("refuses a weapon the unit does not fight with", async () => {
    const { doc } = await copy();
    const e = await failure(applySettings(doc, parseSettings({ units: [{ unit: "Zergling", weapons: [{ weapon: "Gauss Rifle", damage: 9 }] }] })));
    expect(e.message).toBe("units[0]: Zerg Zergling does not fight with Gauss Rifle");
    expect(e.hint).toBe("Its weapons: Claws. Nothing was changed.");
  });
});
