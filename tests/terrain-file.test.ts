/**
 * A mod's terrain file (`terrain.json`): the reader and writer, the data set that carries one into the editor (its
 * pieces, terrain names and borrow tables provided while it is in use; a plugin's declaration first; a file made for
 * another tile table said once and not used), the writer of the Pieces view, and the command line's `mod info`,
 * `mod check` and `mod unpack`. Every file and tileset here is made by the test.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import {
  emptyTerrainFile, isTerrainFilePath, readTerrainFile, sectionAgainstTable, TERRAIN_LIMITS, terrainFileCounts, terrainFileOf, withTerrainSection, writeTerrainFile,
} from "../src/formats/mod/terrain";
import { applyDataSetTerrain, beforeDataSet, keepDataSetTerrain, keptDataSetTerrain } from "../src/services/dataSetTerrain";
import { memoryPieceStore } from "../src/services/pieceStore";
import { providedPiecesAtom, providedTypesAtom } from "../src/atoms/pieceAtoms";
import { providedBorrowAtom } from "../src/atoms/borrowAtoms";
import { gameDataSourceAtom } from "../src/atoms/gameDataAtoms";
import { toastsAtom } from "../src/atoms/uiAtoms";
import { resetAssetSource, setAssetSource, type AssetSource } from "../src/gamedata/source";
import { pickedDataSet } from "../src/gamedata/modInput";
import { declaredTerrains, pieceSections, type ProvidedPieceSet } from "../src/editor/pieceList";
import { terrainFileSection } from "../src/editor/terrainFileSection";
import { providedTable } from "../src/editor/borrowTable";
import { decodeCv5, type Cv5Group, type Tileset } from "../src/formats/tileset/decode";
import { tableHash } from "../src/editor/pieceLearn";
import { openMod } from "../cli/src/mod/open";
import { sourceHash } from "../cli/src/mod/hash";
import { modInfo, printModInfo } from "../cli/src/mod/info";
import { checkModSource } from "../cli/src/mod/check";
import { unpackMod } from "../cli/src/mod/unpack";

const text = (s: string) => new TextEncoder().encode(s);

/** A made CV5: `groups` groups, group g's slots 0–3 holding megatiles, the rest empty. */
function madeCv5(groups: number): Uint8Array {
  const cv5 = new Uint8Array(groups * 52);
  const v = new DataView(cv5.buffer);
  for (let g = 0; g < groups; g++) for (let s = 0; s < 4; s++) v.setUint16(g * 52 + 20 + s * 2, g * 4 + s + 1, true);
  return cv5;
}
const TABLE = tableHash(decodeCv5(madeCv5(40)));

const GOOD = {
  format: 1,
  tilesets: {
    badlands: {
      table: TABLE,
      terrains: [{ name: "Plating", group: 20 }],
      pieces: [{ name: "Long ramp", category: "Ramps", cols: 2, rows: 2, tiles: [0x140, 0x141, -1, 0x151] }, { cols: 1, rows: 1, tiles: [0x160] }],
      borrow: [{ source: "install", pairs: [[0x30, 0x170], [0x31, 0x171]] }],
      borders: [{ future: true }],
    },
  },
  maker: "made by hand",
};

describe("the terrain file, read and written", () => {
  it("reads a good file whole, and keeps what it does not know through a write", () => {
    const { file, dropped } = readTerrainFile(JSON.stringify(GOOD));
    expect(dropped).toEqual([]);
    const s = file.tilesets.badlands;
    expect(s.table).toBe(TABLE);
    expect(s.terrains).toEqual([{ name: "Plating", group: 20 }]);
    expect(s.pieces).toHaveLength(2);
    expect(s.borrow[0].pairs).toHaveLength(2);
    expect(s.extra).toEqual({ borders: [{ future: true }] });
    expect(file.extra).toEqual({ maker: "made by hand" });
    const again = readTerrainFile(writeTerrainFile(file));
    expect(again.dropped).toEqual([]);
    expect(again.file).toEqual(file);
    expect(JSON.parse(writeTerrainFile(file))).toEqual(GOOD);
  });

  it("drops every kind of bad row, says where and why, and never throws", () => {
    const bad = {
      tilesets: {
        badlands: {
          table: TABLE,
          terrains: [{ name: "", group: 2 }, { name: "Odd", group: 3 }, { name: "x".repeat(61), group: 4 }, { name: "Ok", group: 6 }, { name: "Again", group: 6 }, 7],
          pieces: [{ cols: 0, rows: 1, tiles: [] }, { cols: 2, rows: 1, tiles: [1] }, { cols: 1, rows: 1, tiles: [-1] }, { cols: 1, rows: 1, tiles: [70000] }, { cols: 1, rows: 1, tiles: [5], name: 3 }, { cols: 1, rows: 1, tiles: [5] }],
          borrow: [{ source: "badlands", pairs: [[1, 2]] }, { source: "nowhere", pairs: [[1, 2]] }, { source: "jungle", pairs: [[1], [2, 3]] }, { source: "jungle", pairs: [[4, 5]] }, { source: "ice", pairs: "no" }],
        },
        lava: { table: "x" },
        install: { terrains: [] },
        jungle: "nope",
      },
    };
    const { file, dropped } = readTerrainFile(bad);
    const reasons = (prefix: string) => dropped.filter((d) => d.at.startsWith(prefix)).map((d) => d.reason);
    expect(reasons("tilesets.badlands.terrains")).toEqual(["name", "group", "name", "duplicate", "not-an-object"]);
    expect(reasons("tilesets.badlands.pieces")).toEqual(["size", "tiles", "empty", "tiles", "name"]);
    expect(reasons("tilesets.badlands.borrow")).toEqual(["source", "source", "pair", "duplicate", "not-a-list"]);
    expect(reasons("tilesets.lava")).toEqual(["tileset"]);
    expect(reasons("tilesets.install")).toEqual(["table"]);
    expect(reasons("tilesets.jungle")).toEqual(["not-an-object"]);
    expect(file.tilesets.badlands.terrains).toEqual([{ name: "Ok", group: 6 }]);
    expect(file.tilesets.badlands.pieces).toEqual([{ cols: 1, rows: 1, tiles: [5] }]);
    expect(file.tilesets.badlands.borrow).toEqual([{ source: "jungle", pairs: [[2, 3]] }]);
    // An unknown tileset is kept and written back as it was.
    expect(JSON.parse(writeTerrainFile(file)).tilesets.lava).toEqual({ table: "x" });
    expect(readTerrainFile("{ not json").dropped).toEqual([{ at: "", reason: "not-json" }]);
    expect(readTerrainFile("[1]").dropped).toEqual([{ at: "", reason: "not-an-object" }]);
    // A later format: nothing used, the whole kept.
    const later = readTerrainFile({ format: 2, tilesets: GOOD.tilesets });
    expect(later.file.tilesets).toEqual({});
    expect(later.dropped).toEqual([{ at: "format", reason: "format" }]);
  });

  it("keeps to its limits", () => {
    const terrains = Array.from({ length: TERRAIN_LIMITS.terrains + 5 }, (_, i) => ({ name: `T${i}`, group: (i * 2) % 4096 }));
    const { file, dropped } = readTerrainFile({ tilesets: { badlands: { table: TABLE, terrains } } });
    expect(file.tilesets.badlands.terrains.length).toBeLessThanOrEqual(TERRAIN_LIMITS.terrains);
    expect(dropped.some((d) => d.reason === "too-many")).toBe(true);
    expect(readTerrainFile({ tilesets: { badlands: { table: TABLE, pieces: [{ cols: 65, rows: 1, tiles: Array(65).fill(1) }] } } }).dropped[0].reason).toBe("size");
  });

  it("replaces one tileset's section and keeps the others", () => {
    const file = readTerrainFile(GOOD).file;
    const next = withTerrainSection(file, "jungle", { table: "abc", terrains: [{ name: "Swamp", group: 2 }], pieces: [], borrow: [], extra: {} });
    const back = readTerrainFile(writeTerrainFile(next)).file;
    expect(Object.keys(back.tilesets)).toEqual(["badlands", "jungle"]);
    expect(back.tilesets.badlands).toEqual(file.tilesets.badlands);
    expect(back.extra).toEqual({ maker: "made by hand" });
    expect(terrainFileCounts(back).jungle).toEqual({ terrains: 1, pieces: 0, borrow: [] });
  });

  it("says what the table cannot use", () => {
    const groups = decodeCv5(madeCv5(40));
    const has = (tile: number) => (groups[tile >> 4]?.megatiles[tile & 15] ?? 0) !== 0;
    const s = readTerrainFile({ tilesets: { badlands: { table: TABLE, terrains: [{ name: "A", group: 20 }, { name: "Past", group: 60 }], pieces: [{ cols: 1, rows: 1, tiles: [0x14f] }], borrow: [{ source: "install", pairs: [[1, 0x999]] }] } } }).file.tilesets.badlands;
    expect(sectionAgainstTable(s, "badlands", { groups: 40, hasPicture: has }).map((d) => d.at)).toEqual(["tilesets.badlands.terrains[1]", "tilesets.badlands.pieces[0]", "tilesets.badlands.borrow[0]"]);
  });

  it("is found beside mod.json: in the folder named or one down, never in a game folder", () => {
    expect(isTerrainFilePath("Mod/terrain.json", "Mod")).toBe(true);
    expect(isTerrainFilePath("Mod/Release/terrain.json", "Mod")).toBe(true);
    expect(isTerrainFilePath("Mod/arr/terrain.json", "Mod")).toBe(false);
    expect(isTerrainFilePath("Mod/a/b/terrain.json", "Mod")).toBe(false);
    expect(terrainFileOf(["Mod/Release/terrain.json", "Mod/terrain.json", "Mod/mod.json"], "Mod")).toBe("Mod/terrain.json");
  });
});

/* ── The editor ── */

const stored = (id: string, name = "Made Mod"): AssetSource => ({
  kind: "stored", label: "", tried: [], profile: { id, name },
  stored: { from: "", at: "", files: 1, bytes: 1, summary: "", profile: { id, name }, hash: "0123456789abcdef", where: "memory" },
});
const game: AssetSource = { kind: "none", label: "", tried: [], profile: { id: "starcraft", name: "StarCraft: Brood War" } };

describe("a data set's terrain file in the editor", () => {
  afterEach(() => { resetAssetSource(); });

  it("comes with a folder added as a data set, beside its mod.json", async () => {
    const f = (path: string, body: string) => Object.assign(new File([body], path.split("/").pop()!), { webkitRelativePath: path });
    const picked = await pickedDataSet([f("Made/arr/units.dat", "x"), f("Made/terrain.json", JSON.stringify(GOOD)), f("Made/arr/terrain.json", "{}")]);
    expect(JSON.parse(picked.terrain!)).toEqual(GOOD);
    expect((await pickedDataSet([f("Made/arr/units.dat", "x")])).terrain).toBeNull();
  });

  it("provides its pieces, terrains and borrow tables while the data set is in use, and nothing after", async () => {
    const store = createStore();
    const db = memoryPieceStore();
    await keepDataSetTerrain("made", JSON.stringify(GOOD), db);
    store.set(gameDataSourceAtom, stored("made"));
    const tables = async () => TABLE;
    const state = await applyDataSetTerrain(store, { db, tables });
    expect(state).toEqual({ id: "made", used: ["badlands"], mismatched: [] });
    const pieces = store.get(providedPiecesAtom);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ source: "@dataset:made", label: "Made Mod", tileset: "badlands" });
    expect(pieces[0].pieces[0]).toEqual({ name: "Long ramp", category: "Ramps", block: { cols: 2, rows: 2, ids: [0x140, 0x141, -1, 0x151] } });
    expect(store.get(providedTypesAtom)[0].types).toEqual([{ name: "Plating", group: 20 }]);
    expect(store.get(providedBorrowAtom)).toEqual([{ key: "@dataset:made:badlands:install", tileset: "badlands", source: "install", pairs: [[0x30, 0x170], [0x31, 0x171]] }]);
    // Another data set, then the game's own: nothing of the file remains.
    store.set(gameDataSourceAtom, stored("other"));
    await applyDataSetTerrain(store, { db, tables });
    expect(store.get(providedPiecesAtom)).toEqual([]);
    store.set(gameDataSourceAtom, stored("made"));
    await applyDataSetTerrain(store, { db, tables });
    expect(store.get(providedPiecesAtom)).toHaveLength(1);
    store.set(gameDataSourceAtom, game);
    await applyDataSetTerrain(store, { db, tables });
    expect(store.get(providedPiecesAtom)).toEqual([]);
    expect(store.get(providedTypesAtom)).toEqual([]);
    expect(store.get(providedBorrowAtom)).toEqual([]);
    // Removing the data set forgets the file.
    await keepDataSetTerrain("made", null, db);
    expect(await keptDataSetTerrain("made", db)).toBeNull();
  });

  it("says once that a file made for another tile table does not fit, and provides nothing of it", async () => {
    const store = createStore();
    const db = memoryPieceStore();
    await keepDataSetTerrain("fit", JSON.stringify(GOOD), db);
    store.set(gameDataSourceAtom, stored("fit", "Misfit"));
    const other = async () => "someotherhash";
    expect(await applyDataSetTerrain(store, { db, tables: other })).toEqual({ id: "fit", used: [], mismatched: ["badlands"] });
    await applyDataSetTerrain(store, { db, tables: other });
    expect(store.get(providedPiecesAtom)).toEqual([]);
    expect(store.get(toastsAtom).filter((x) => /terrain file does not fit/.test(x.title))).toHaveLength(1);
  });

  it("comes after a plugin's declaration of the same thing", () => {
    const fromFile: ProvidedPieceSet & { tileset: "badlands" } = { key: "@dataset:made:badlands", source: "@dataset:made", label: "Made Mod", tileset: "badlands", pieces: [{ name: "File's name", block: { cols: 1, rows: 1, ids: [0x160] } }] };
    const fromPlugin: ProvidedPieceSet & { tileset: "badlands" } = { key: "walls:p", source: "walls", label: "Walls", tileset: "badlands", pieces: [{ name: "Plugin's name", block: { cols: 1, rows: 1, ids: [0x160] } }] };
    const rows = beforeDataSet([fromFile], fromPlugin);
    expect(rows.map((r) => r.key)).toEqual(["walls:p", "@dataset:made:badlands"]);
    const groups = decodeCv5(madeCv5(40));
    const ts = { groups, megatileCount: 200 } as Pick<Tileset, "groups" | "megatileCount">;
    const sections = pieceSections(ts, [], rows);
    expect(sections.filter((s) => s.label).map((s) => [s.label, s.items.map((i) => i.name)])).toEqual([["Walls", ["Plugin's name"]]]);
    // The same group named twice: the first (the plugin's) stands.
    const pair = (g: number): Cv5Group => ({ index: 0, flags: 0, buildability: 0, groundHeight: 0, edges: { left: 0, top: 0, right: 0, bottom: 0 }, stack: { left: 0, top: 0, right: 0, bottom: 0 }, megatiles: Uint16Array.from({ length: 16 }, (_, s) => (s < 2 ? g * 4 + s + 1 : 0)) });
    const flat = { groups: Array.from({ length: 30 }, (_, g) => pair(g)), megatileCount: 200, megatileFlags: new Uint16Array(200 * 16) } as unknown as Tileset;
    expect(declaredTerrains(flat, [], [{ name: "Plugin's", group: 20 }, { name: "File's", group: 20 }]).map((d) => d.name)).toEqual(["Plugin's"]);
  });

  it("is written from what the editor lists, as exact pairs", () => {
    const section = terrainFileSection(TABLE, [
      { label: "Walls", source: "walls", items: [{ block: { cols: 1, rows: 1, ids: [0x160] }, tiles: [0x160], group: 0x16, slot: 0, name: "Gate", category: "Walls", source: "walls", laid: 0 }] },
      { label: null, source: "maps", items: [{ block: { cols: 2, rows: 1, ids: [0x170, 0x171] }, tiles: [0x170, 0x171], group: 0x17, slot: 0, source: "maps", laid: 9 }, { block: { cols: 1, rows: 1, ids: [0x160] }, tiles: [0x160], group: 0x16, slot: 0, source: "maps", laid: 1 }] },
    ], [{ name: "Plating", group: 20 }, { name: "Again", group: 20 }], [{ source: "install", table: { choices: new Map([[0x31, [0x171]], [0x30, [0x170, 0x172]]]), kinds: new Map([[0x31, "standIn" as const]]), copies: new Map() } }]);
    expect(section.pieces).toEqual([{ name: "Gate", category: "Walls", cols: 1, rows: 1, tiles: [0x160] }, { cols: 2, rows: 1, tiles: [0x170, 0x171] }]);
    expect(section.terrains).toEqual([{ name: "Plating", group: 20 }]);
    expect(section.borrow).toEqual([{ source: "install", pairs: [[0x30, 0x170], [0x30, 0x172], [0x31, 0x171]], standIns: [0x31] }]);
    const file = readTerrainFile(writeTerrainFile(withTerrainSection(emptyTerrainFile(), "badlands", section))).file;
    expect(file.tilesets.badlands.borrow[0]).toEqual(section.borrow[0]);
    // Read back into a table, the stand-in is one again (what is offered is decided as a scan decides it).
    const ts = { groups: decodeCv5(madeCv5(40)), megatileCount: 200 } as unknown as Tileset;
    const table = providedTable(ts, ts, file.tilesets.badlands.borrow[0].pairs, file.tilesets.badlands.borrow[0].standIns);
    expect(table.kinds.get(0x31)).toBe("standIn");
    expect(table.kinds.get(0x30)).toBe("provided");
    expect(readTerrainFile({ tilesets: { badlands: { table: TABLE, borrow: [{ source: "install", pairs: [[1, 2]], standIns: ["x"] }] } } }).dropped).toEqual([{ at: "tilesets.badlands.borrow[0].standIns", reason: "tiles" }]);
  });
});

/* ── The command line ── */

describe("a terrain file on the command line", () => {
  const made = () => {
    const root = mkdtempSync(join(tmpdir(), "scmjs-terrain-"));
    const dir = join(root, "Made");
    const put = (path: string, data: Uint8Array | string) => { mkdirSync(join(dir, path, ".."), { recursive: true }); writeFileSync(join(dir, path), typeof data === "string" ? text(data) : data); };
    put("arr/units.dat", "a made units.dat");
    put("tileset/badlands.cv5", madeCv5(40));
    return { root, dir, put };
  };

  it("leaves the mod's hash as it was", async () => {
    const { dir, put } = made();
    const before = await sourceHash(await openMod(dir, null));
    put("terrain.json", JSON.stringify(GOOD));
    const source = await openMod(dir, null);
    expect(source.terrain?.file.tilesets.badlands.pieces).toHaveLength(2);
    expect(source.files.has("terrain.json")).toBe(false);
    expect(await sourceHash(source)).toMatchObject({ hash: before.hash, withoutPlugins: before.withoutPlugins });
  });

  it("mod info counts it per tileset; mod check says what is left out and a table that does not match", async () => {
    const { dir, put } = made();
    put("terrain.json", JSON.stringify({ ...GOOD, tilesets: { ...GOOD.tilesets, jungle: { table: "otherhash", pieces: [{ cols: 1, rows: 1, tiles: [1] }] }, ice: { table: TABLE, terrains: [{ name: "", group: 2 }] } } }));
    const source = await openMod(dir, null);
    const info = modInfo(source);
    expect(info.terrain?.tilesets.badlands).toEqual({ terrains: 1, pieces: 2, borrow: [{ source: "install", pairs: 2 }] });
    expect(info.terrain?.dropped).toBe(1);
    expect(printModInfo(info).join("\n")).toMatch(/badlands.*1 terrain, 2 pieces, 2 pairs from install/);
    const r = await checkModSource(source, null);
    const terrain = r.findings.filter((f) => f.rule.startsWith("terrain"));
    expect(terrain.map((f) => f.where)).toEqual(expect.arrayContaining(["terrain.json: tilesets.ice.terrains[0]"]));
    // The mod has no jungle.cv5 and there is no copy of the game: not checked, said in a note.
    expect(r.notes.some((n) => /jungle section's table was not checked/.test(n))).toBe(true);
    // The badlands section fits the mod's own table: no table finding for it.
    expect(terrain.some((f) => f.where.includes("badlands.table"))).toBe(false);
    put("tileset/jungle.cv5", madeCv5(12));
    const again = await checkModSource(await openMod(dir, null), null);
    expect(again.findings.some((f) => f.rule === "terrain-table" && f.where.includes("jungle.table"))).toBe(true);
  });

  it("mod unpack keeps a folder's terrain file when a new release is unpacked over it", async () => {
    const { root, dir, put } = made();
    put("terrain.json", JSON.stringify(GOOD));
    const out = join(root, "unpacked");
    await unpackMod(await openMod(dir, null), out);
    expect(JSON.parse(readFileSync(join(out, "terrain.json"), "utf8"))).toEqual(GOOD);
    // The unpacked folder reads it back.
    expect((await openMod(out, null)).terrain?.file.tilesets.badlands.pieces).toHaveLength(2);
    // A new release without the file, unpacked over the folder: the folder's stays.
    const { dir: release } = made();
    await unpackMod(await openMod(release, null), out, { force: true });
    expect(existsSync(join(out, "terrain.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(out, "terrain.json"), "utf8"))).toEqual(GOOD);
  });
});
