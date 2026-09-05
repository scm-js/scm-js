/**
 * Names out of the game data (`src/data/gameNames.ts`): the rule that a name shows from
 * the data where it differs from what the game's own data says, the `stat_txt.tbl`
 * reading behind it, and — against the real files — the tables that say what the game's
 * own data calls things, which the rule leans on.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanLabel, composeUnitName, GAME_TECH_NAMES, GAME_UNIT_NAMES, GAME_UPGRADE_NAMES, GAME_WEAPON_NAMES, gameUnitName, gameWeaponName, namesAreTheGames, namesFromAssets,
} from "../src/data/gameNames";
import { installNames, TECH_NAMES, techName, UNIT_NAMES, unitName, UPGRADE_NAMES, UPGRADE_RACE, upgradeName } from "../src/data/units";
import { WEAPON_NAMES, weaponName } from "../src/data/weapons";
import { decodeTechdataDat, decodeUpgradesDat, decodeWeaponsDat } from "../src/formats/dat/dat";
import { decodeTbl, decodeTblEntries } from "../src/formats/dat/tbl";

const PUBLIC = join(__dirname, "..", "public");
const read = (rel: string) => new Uint8Array(readFileSync(join(PUBLIC, rel)));
const haveData = ["tileset/stat_txt.tbl", "arr/weapons.dat", "arr/upgrades.dat", "arr/techdata.dat"].every((f) => existsSync(join(PUBLIC, f)));

afterEach(() => installNames(null));

/** A `.tbl` with the given entries, each part NUL-terminated as the game writes them. */
function tbl(entries: string[][]): Uint8Array {
  const enc = new TextEncoder();
  const bodies = entries.map((parts) => enc.encode(parts.map((p) => p + "\0").join("")));
  const header = 2 + entries.length * 2;
  const out = new Uint8Array(header + bodies.reduce((n, b) => n + b.length, 0));
  const view = new DataView(out.buffer);
  view.setUint16(0, entries.length, true);
  let at = header;
  bodies.forEach((b, i) => {
    view.setUint16(2 + i * 2, at, true);
    out.set(b, at);
    at += b.length;
  });
  return out;
}

describe("stat_txt reading", () => {
  it("keeps every part of an entry, and decodeTbl only the first", () => {
    const data = tbl([["Terran Marine", "*", "Ground Units"], ["Terran Siege Tank", "Tank Mode", "Ground Units"], ["Gauss Rifle"]]);
    expect(decodeTblEntries(data)).toEqual([["Terran Marine", "*", "Ground Units"], ["Terran Siege Tank", "Tank Mode", "Ground Units"], ["Gauss Rifle"]]);
    expect(decodeTbl(data)).toEqual(["Terran Marine", "Terran Siege Tank", "Gauss Rifle"]);
  });

  it("composes a unit's name the way the game does", () => {
    expect(composeUnitName(["Terran Marine", "*", "Ground Units"])).toBe("Terran Marine");
    expect(composeUnitName(["Terran Siege Tank", "Tank Mode"])).toBe("Terran Siege Tank (Tank Mode)");
    expect(composeUnitName(["Alone"])).toBe("Alone");
  });

  it("strips a button label's hotkey and colour codes", () => {
    expect(cleanLabel("i\u0003\u0003I\u0001rradiate")).toBe("Irradiate");
    expect(cleanLabel("w\u0003Dark S\u0003w\u0001arm")).toBe("Dark Swarm");
    expect(cleanLabel("Maelstrom ")).toBe("Maelstrom");
    expect(cleanLabel("Gauss Rifle")).toBe("Gauss Rifle");
    expect(cleanLabel("i")).toBe("i");
    expect(cleanLabel("x\u0003")).toBe("");
  });
});

describe("the naming rule", () => {
  const statTxt = (): string[][] => {
    const entries: string[][] = [];
    for (let id = 0; id < UNIT_NAMES.length; id++) entries.push([gameUnitName(id), "*", "Units"]);
    return entries;
  };

  it("shows the data's name where it differs from the game's own, and StarEdit's elsewhere", () => {
    const entries = statTxt();
    entries[0] = ["Lakizilisk", "*", "Units"];
    entries[5] = ["Terran Siege Tank", "Tank Mode", "Units"]; // the game's own, composed
    entries[91] = ["Unused", "*", "Units"]; // the game's own, where StarEdit says "Cargo Ship (Unused)"
    entries[92] = ["Zorthos", "Hero", "Units"];
    const names = namesFromAssets({ statTxt: entries, weapons: null, upgrades: null, techs: null });
    expect(names).not.toBeNull();
    expect(names!.units[0]).toBe("Lakizilisk");
    expect(names!.units[5]).toBeNull();
    expect(names!.units[91]).toBeNull();
    expect(names!.units[92]).toBe("Zorthos (Hero)");
    expect(namesAreTheGames(names)).toBe(false);
    installNames(names);
    expect(unitName(0)).toBe("Lakizilisk");
    expect(unitName(5)).toBe("Terran Siege Tank (Tank Mode)");
    expect(unitName(91)).toBe("Cargo Ship (Unused)");
    expect(unitName(92)).toBe("Zorthos (Hero)");
    installNames(null);
    expect(unitName(0)).toBe("Terran Marine");
  });

  it("resolves weapon, upgrade and technology names through the dat files' labels", () => {
    const entries = statTxt();
    entries.push(["Gauss Rifle"], ["Plasma Lance"], ["Terran Infantry Armor"], ["Stim Packs"], ["x\u0003\u0003X\u0001-Ray Beam"]);
    const at = (i: number) => UNIT_NAMES.length + i + 1; // 1-based label
    const label = (count: number, set: Record<number, number>) => { const a = new Uint16Array(count); for (const [k, v] of Object.entries(set)) a[Number(k)] = v; return a; };
    const names = namesFromAssets({
      statTxt: entries,
      weapons: { label: label(WEAPON_NAMES.length, { 0: at(0), 1: at(1), 2: 0 }), damage: new Uint16Array(0), bonus: new Uint16Array(0) },
      upgrades: { label: label(UPGRADE_NAMES.length, { 0: at(2), 1: at(4) }) } as never,
      techs: { label: label(TECH_NAMES.length, { 0: at(3) }) } as never,
    })!;
    expect(names.weapons[0]).toBeNull(); // "Gauss Rifle" is what the game calls weapon 0
    expect(names.weapons[1]).toBe("Plasma Lance"); // renamed
    expect(names.weapons[2]).toBeNull(); // no label: the table stands
    expect(names.upgrades[0]).toBeNull();
    expect(names.upgrades[1]).toBe("X-Ray Beam");
    expect(names.techs[0]).toBeNull();
    installNames(names);
    expect(weaponName(1)).toBe("Plasma Lance");
    expect(weaponName(2)).toBe("C-10 Canister Rifle");
    expect(upgradeName(1)).toBe("X-Ray Beam");
    expect(techName(0)).toBe("Stim Packs");
  });

  it("answers null without a names file, which leaves the tables alone", () => {
    expect(namesFromAssets({ statTxt: null, weapons: null, upgrades: null, techs: null })).toBeNull();
    expect(namesAreTheGames(null)).toBe(true);
  });

  it("knows the game's own names where they differ from StarEdit's", () => {
    expect(gameUnitName(0)).toBe("Terran Marine");
    expect(gameUnitName(91)).toBe("Unused");
    expect(gameWeaponName(1)).toBe("Gauss Rifle");
    expect(new Map(GAME_UNIT_NAMES).size).toBe(GAME_UNIT_NAMES.length);
  });
});

describe("the upgrade table", () => {
  it("has Plasma Shields at 15, after the weapons, as upgrades.dat orders them", () => {
    expect(UPGRADE_NAMES[7]).toBe("Terran Infantry Weapons");
    expect(UPGRADE_NAMES[15]).toBe("Protoss Plasma Shields");
    expect(UPGRADE_RACE.slice(5, 16)).toEqual(["protoss", "protoss", "terran", "terran", "terran", "zerg", "zerg", "zerg", "protoss", "protoss", "protoss"]);
  });
});

describe.skipIf(!haveData)("against the real files", () => {
  const assets = () => ({
    statTxt: decodeTblEntries(read("tileset/stat_txt.tbl")),
    weapons: decodeWeaponsDat(read("arr/weapons.dat")),
    upgrades: decodeUpgradesDat(read("arr/upgrades.dat")),
    techs: decodeTechdataDat(read("arr/techdata.dat")),
  });

  it("names nothing differently from the game's own data, so every name stays StarEdit's", () => {
    const names = namesFromAssets(assets());
    expect(names).not.toBeNull();
    const differing = (list: readonly (string | null)[]) => list.map((n, i) => (n === null ? null : `${i}: ${n}`)).filter((x) => x !== null);
    expect(differing(names!.units)).toEqual([]);
    expect(differing(names!.weapons)).toEqual([]);
    expect(differing(names!.upgrades)).toEqual([]);
    expect(differing(names!.techs)).toEqual([]);
    expect(namesAreTheGames(names)).toBe(true);
  });

  it("carries exactly the game's names that differ from StarEdit's — no more, no fewer", () => {
    const a = assets();
    const label = (i: number) => (i > 0 ? cleanLabel(a.statTxt[i - 1]?.[0] ?? "") : "");
    const diff = (labels: Uint16Array, table: readonly string[]) => {
      const out: [number, string][] = [];
      for (let id = 0; id < table.length; id++) {
        const g = label(labels[id]);
        if (g && g !== table[id]) out.push([id, g]);
      }
      return out;
    };
    const units: [number, string][] = [];
    for (let id = 0; id < UNIT_NAMES.length; id++) {
      const c = composeUnitName(a.statTxt[id]);
      if (c !== UNIT_NAMES[id]) units.push([id, c]);
    }
    expect(units).toEqual([...GAME_UNIT_NAMES]);
    expect(diff(a.weapons.label, WEAPON_NAMES)).toEqual([...GAME_WEAPON_NAMES]);
    expect(diff(a.upgrades.label, UPGRADE_NAMES)).toEqual([...GAME_UPGRADE_NAMES]);
    expect(diff(a.techs.label, TECH_NAMES)).toEqual([...GAME_TECH_NAMES]);
  });

  it("orders the upgrades as upgrades.dat labels them", () => {
    const a = assets();
    const label = (i: number) => cleanLabel(a.statTxt[i - 1][0]);
    expect(label(a.upgrades.label[7])).toBe("Terran Infantry Weapons");
    expect(label(a.upgrades.label[15])).toBe("Protoss Plasma Shields");
    expect(label(a.upgrades.label[16])).toBe("U-238 Shells");
    expect(label(a.weapons.label[0])).toBe("Gauss Rifle");
    expect(label(a.techs.label[0])).toBe("Stim Packs");
  });
});
