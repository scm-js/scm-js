/**
 * A map linked to the command line (`scmjs map open --live`), in its three parts:
 *
 * - the undo step a linked command's change is (`applyDocumentAtom`): the whole document swapped, and swapped back;
 * - the editor's end (`services/editorLink.ts`) over a stand-in for the page: read, apply, what is selected, and
 *   the refusals a command acts on;
 * - the command's end (`cli/src/link.ts`) over a stand-in for the page and the editor: the owner, a peer finding it
 *   by the file's path, a save written to disk.
 *
 * The three together, with the real page and editor between them, are `e2e/link.spec.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, scenarioName, serializeScenario, setScenarioName } from "../src/formats/chk/scenario";
import {
  applyDocumentAtom, archiveExtrasAtom, commitEditAtom, loadDocumentAtom, redoAtom, redoStackAtom, scenarioAtom, undoAtom, undoStackAtom,
} from "../src/atoms/documentAtoms";
import { mapFileHandleAtom, mapModifiedAtom, mapNameAtom, selectedUnitsAtom, viewOnlyAtom } from "../src/atoms/editorAtoms";
import { linkedDocumentAtom } from "../src/atoms/linkAtoms";
import { openMapBytes } from "../src/editor/mapFile";
import { applyUnitChanges, makeUnit } from "../src/editor/units";
import { createEditorLink, GAME_FILE, isLinkHandle, type LinkMessage } from "../src/services/editorLink";
import { gameDataSourceAtom } from "../src/atoms/gameDataAtoms";
import { memberOfStored } from "../src/gamedata/paths";
import { writeNewMap } from "../cli/src/create";
import { findGameCopy } from "../cli/src/engine";
import { archiveFiles, storageFiles } from "../cli/src/gamefiles";
import { storeHandle, loadHandle } from "../src/services/handleStore";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../cli/src/mcp";
import { allLinks, linkedGame, linkedRead, linkedWrite, linkFor, LinkError, LinkOwner, setLinkLabel } from "../cli/src/link";

type Store = ReturnType<typeof createStore>;

const fresh = (name: string) => createScenario({ width: 16, height: 12, era: 0, name });
const chkOf = (store: Store) => Array.from(serializeScenario(store.get(scenarioAtom)!));
/** The open map with another name, as a command would hand it back: parsed again from bytes. */
function renamed(store: Store, name: string) {
  const scn = parseScenario(serializeScenario(store.get(scenarioAtom)!));
  setScenarioName(scn, name);
  return scn;
}
function placeUnit(store: Store, x: number) {
  const scn = store.get(scenarioAtom)!;
  const units = [{ index: scn.units.length, before: null, after: makeUnit(null, 0, 0, x, 64, 100 + x) }];
  applyUnitChanges(scn, units);
  store.set(commitEditAtom, { label: "Place unit", changes: [], units });
}

describe("a change from a linked command is one undo step", () => {
  function open() {
    const store = createStore();
    store.set(loadDocumentAtom, { scenario: fresh("before"), extras: new Map(), fileName: "a.scx" });
    return store;
  }

  it("swaps the document, keeps the history beneath it, and undoes and redoes to the byte", () => {
    const store = open();
    placeUnit(store, 96);
    const before = chkOf(store);
    const extras = new Map([["staredit\\wav\\a.wav", new Uint8Array([1, 2, 3])]]);
    expect(store.set(applyDocumentAtom, { scenario: renamed(store, "after"), extras, stored: null }, "scmjs map set")).toBe(true);
    const after = chkOf(store);
    expect(store.get(mapNameAtom)).toBe("after");
    expect(store.get(archiveExtrasAtom)).toBe(extras);
    expect(store.get(mapModifiedAtom)).toBe(true);
    expect(store.get(undoStackAtom).map((e) => e.label)).toEqual(["Place unit", "scmjs map set"]);

    // An edit on top, then everything back down, the step beneath the swap included.
    placeUnit(store, 160);
    expect(store.set(undoAtom)).toBe("Place unit");
    expect(chkOf(store)).toEqual(after);
    expect(store.set(undoAtom)).toBe("scmjs map set");
    expect(chkOf(store)).toEqual(before);
    expect(store.get(mapNameAtom)).toBe("before");
    expect(store.get(archiveExtrasAtom).size).toBe(0);
    expect(store.set(undoAtom)).toBe("Place unit");
    expect(store.get(scenarioAtom)!.units).toHaveLength(0);

    // And up again.
    store.set(redoAtom);
    expect(store.set(redoAtom)).toBe("scmjs map set");
    expect(chkOf(store)).toEqual(after);
    expect(store.get(archiveExtrasAtom)).toBe(extras);
    expect(store.get(redoStackAtom).map((e) => e.label)).toEqual(["Place unit"]);
  });

  it("is refused on a map open to look at only", () => {
    const store = open();
    store.set(viewOnlyAtom, { reason: "replay" } as never);
    expect(store.set(applyDocumentAtom, { scenario: renamed(store, "after"), extras: new Map(), stored: null }, "x")).toBe(false);
    expect(store.get(mapNameAtom)).toBe("before");
  });
});

describe("the editor's end of a link", () => {
  /** A link over a port that records what the editor posts, with a `request` that waits for the answer. */
  async function linked() {
    const store = createStore();
    const posted: LinkMessage[] = [];
    const saves: Uint8Array[] = [];
    const link = createEditorLink(store, { post: (m) => { posted.push(m as unknown as LinkMessage); } }, "a.scx", async (_store, req) => {
      const w = await req.handle.createWritable();
      await w.write(new Uint8Array([7, 7]));
      await w.close();
      return true;
    });
    store.set(loadDocumentAtom, { scenario: fresh("before"), extras: new Map(), fileName: "a.scx", handle: link.handle });
    expect(link.attach()).toBe(true);
    let n = 0;
    const request = async (method: string, params: Record<string, unknown> = {}, bytes?: Uint8Array) => {
      const id = `t${++n}`;
      link.receive({ type: "scmjs.link", id, method, params, bytes });
      for (let i = 0; i < 200; i++) {
        const reply = posted.find((m) => m.type === "scmjs.link.reply" && m.id === id);
        if (reply) return reply;
        // The editor's own requests (a save writing through the link) are answered as the command would.
        for (const m of posted.filter((p) => p.type === "scmjs.link" && p.id && p.method === "write")) {
          posted.splice(posted.indexOf(m), 1);
          saves.push(m.bytes!);
          link.receive({ type: "scmjs.link.reply", id: m.id, ok: true, result: {} });
        }
        await new Promise((r) => setTimeout(r, 5));
      }
      throw new Error(`no answer to ${method}`);
    };
    return { store, link, posted, saves, request };
  }

  it("hands the map over as it stands, takes a changed one back as an undo step, and refuses a stale one", async () => {
    const { store, request } = await linked();
    expect(store.get(linkedDocumentAtom)?.name).toBe("a.scx");
    const read = await request("read");
    expect(read.ok).toBe(true);
    expect(read.result).toMatchObject({ name: "a.scx", rev: 0, modified: false });
    // (An archive, as Save would write it.)
    const scn = (await openMapBytes(read.bytes!, "a.scx")).scenario;
    expect(scenarioName(scn)).toBe("before");

    setScenarioName(scn, "after");
    const applied = await request("apply", { label: "scmjs map set", base: 0 }, serializeScenario(scn));
    expect(applied.ok).toBe(true);
    expect(store.get(mapNameAtom)).toBe("after");
    expect(store.get(undoStackAtom).at(-1)?.label).toBe("scmjs map set");

    // The same bytes again, read before that change: the editor has moved on.
    const stale = await request("apply", { label: "again", base: 0 }, serializeScenario(scn));
    expect(stale.ok).toBe(false);
    expect(stale.error?.code).toBe("changed");
    // The person's own edit moves it on too.
    const at = (applied.result as { rev: number }).rev;
    placeUnit(store, 96);
    expect((await request("apply", { label: "again", base: at }, serializeScenario(scn))).error?.code).toBe("changed");
    // Without a base it is taken as it is.
    expect((await request("apply", { label: "whole" }, serializeScenario(scn))).ok).toBe(true);
  });

  it("says what is selected, and saves through the link", async () => {
    const { store, request, saves } = await linked();
    placeUnit(store, 96);
    store.set(selectedUnitsAtom, [0]);
    const state = (await request("state")).result as { modified: boolean; selection: { units: { index: number; player: number; x: number; y: number }[] } };
    expect(state.modified).toBe(true);
    expect(state.selection.units).toMatchObject([{ index: 0, player: 1, x: 96, y: 64 }]);
    expect((await request("save")).ok).toBe(true);
    expect(saves).toHaveLength(1);
    expect((await request("nonsense")).error?.code).toBe("unknown");
  });

  it("answers only for its own map, and ends when that map closes", async () => {
    const { store, link, posted, request } = await linked();
    store.set(loadDocumentAtom, { scenario: fresh("other"), extras: new Map(), fileName: "b.scx", into: "tab" });
    expect((await request("read")).error?.code).toBe("behind");
    expect(link.ended).toBe(false);
    // Another file opened in the linked map's place: it is closed.
    const second = await linked();
    second.store.set(loadDocumentAtom, { scenario: fresh("other"), extras: new Map(), fileName: "b.scx" });
    expect(second.link.ended).toBe(true);
    expect(second.posted.some((m) => m.method === "ended")).toBe(true);
    expect(second.store.get(linkedDocumentAtom)).toBeNull();
    expect(posted.some((m) => m.method === "ended")).toBe(false);
  });

  it("lends the game's tables of its data set, and nothing else of it", async () => {
    const { store, request } = await linked();
    expect((await request("gamedata")).result).toEqual({ kind: "none", profile: null, name: null, hash: null });
    expect((await request("gamefile", { path: "arr/units.dat" })).result).toEqual({ found: false });
    // A data set in memory, as a mod being edited is: its files are answered by stored path.
    const units = new Uint8Array([1, 2, 3, 4]);
    const asked: string[] = [];
    store.set(gameDataSourceAtom, { kind: "reader", profile: { id: "mymod", name: "My Mod" }, label: "My Mod", tried: [], reader: { base: null, hash: "h1", read: (path) => { asked.push(path); return path === "arr/units.dat" ? units : null; } } });
    expect((await request("gamedata")).result).toEqual({ kind: "reader", profile: "mymod", name: "My Mod", hash: "h1" });
    const file = await request("gamefile", { path: "arr\\Units.dat" });
    expect([file.ok, file.result, Array.from(file.bytes!)]).toEqual([true, { found: true }, [1, 2, 3, 4]]);
    // The answer is a copy: handing its buffer over leaves the data set's own file whole.
    expect(file.bytes).not.toBe(units);
    expect((await request("gamefile", { path: "tileset/jungle.cv5" })).result).toEqual({ found: false });
    expect(asked).toEqual(["arr/units.dat", "tileset/jungle.cv5"]);
    for (const path of ["unit/terran/marine.grp", "sound/terran/marine/tmawht00.wav", "../arr/units.dat", "arr/units.dat/../../x", "", "tileset/jungle.hd.vr4"]) {
      const refused = await request("gamefile", { path });
      expect([path, refused.ok, refused.error?.code]).toEqual([path, false, "failed"]);
    }
    expect(asked).toHaveLength(2);
    for (const path of ["tileset/ice.vx4ex", "tileset/stat_txt.tbl", "arr/images.tbl", "arr/weapons.datex", "rez/stat.txt", "scripts/iscript.bin", "game/tunit.pcx", "unit/manifest.json"]) expect(GAME_FILE.test(path), path).toBe(true);
  });

  it("has a handle that is never kept between sessions", async () => {
    const { store } = await linked();
    const handle = store.get(mapFileHandleAtom);
    expect(isLinkHandle(handle)).toBe(true);
    expect(await storeHandle("recent:a.scx", handle)).toBe(false);
    expect(await loadHandle("recent:a.scx")).toBeNull();
  });
});

describe("the command's end of a link", () => {
  const dirs: string[] = [];
  const owners: LinkOwner[] = [];
  const env = { cache: process.env.SCMJS_CACHE, browser: process.env.BROWSER };
  afterEach(() => {
    for (const o of owners.splice(0)) o.end("test over");
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    process.env.SCMJS_CACHE = env.cache;
    process.env.BROWSER = env.browser;
    if (env.cache === undefined) delete process.env.SCMJS_CACHE;
    if (env.browser === undefined) delete process.env.BROWSER;
  });

  /**
   * An owner with a stand-in for the page and the editor behind it: the stand-in reads the event stream, answers
   * `read` with `held` and takes `apply` into it, as the editor would.
   */
  async function open(answer: "yes" | "no" | "old" = "yes", map: Uint8Array = new Uint8Array([1, 2, 3])) {
    const dir = mkdtempSync(join(tmpdir(), "scmjs-link-"));
    dirs.push(dir);
    process.env.SCMJS_CACHE = join(dir, "cache");
    process.env.BROWSER = "none";
    const file = join(dir, "a.scx");
    writeFileSync(file, map);
    const editor = { held: map, rev: 0, labels: [] as string[], game: null as null | { name: string; read: (path: string) => Promise<Uint8Array | null> | Uint8Array | null; asked: string[] } };
    const owner = new LinkOwner(file, readFileSync(file));
    owners.push(owner);
    let base = "";
    const up = (json: unknown, bytes?: Uint8Array) => fetch(`${base}/up`, { method: "POST", body: Buffer.concat([Buffer.from(`${JSON.stringify(json)}\n`), Buffer.from(bytes ?? [])]) });
    const page = async (address: string) => {
      base = address;
      expect(Array.from(new Uint8Array(await (await fetch(`${base}/file`)).arrayBuffer()))).toEqual(Array.from(map));
      const stream = await fetch(`${base}/events`);
      await up({ type: "scmjs.taken", ...(answer === "old" ? {} : { linked: answer }) });
      const reader = stream.body!.getReader();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        text += new TextDecoder().decode(value);
        for (let at = text.indexOf("\n\n"); at >= 0; at = text.indexOf("\n\n")) {
          const line = text.slice(0, at);
          text = text.slice(at + 2);
          if (!line.startsWith("data: ")) continue;
          const m = JSON.parse(line.slice(6)) as { id?: string; method: string; params: { label?: string; base?: number; path?: string }; blob?: boolean };
          if (!m.id) continue;
          const bytes = m.blob ? new Uint8Array(await (await fetch(`${base}/blob/${m.id}`)).arrayBuffer()) : null;
          if (m.method === "read") await up({ type: "scmjs.link.reply", id: m.id, ok: true, result: { name: "a.scx", rev: editor.rev, modified: editor.rev > 0 } }, editor.held);
          else if (m.method === "apply" && m.params.base !== undefined && m.params.base !== editor.rev) await up({ type: "scmjs.link.reply", id: m.id, ok: false, error: { code: "changed", message: "changed" } });
          else if (m.method === "apply") { editor.held = bytes!; editor.rev++; editor.labels.push(m.params.label ?? ""); await up({ type: "scmjs.link.reply", id: m.id, ok: true, result: { rev: editor.rev } }); }
          else if (m.method === "gamedata" && editor.game) await up({ type: "scmjs.link.reply", id: m.id, ok: true, result: { kind: "stored", profile: "starcraft", name: editor.game.name, hash: "abc" } });
          else if (m.method === "gamefile" && editor.game) {
            editor.game.asked.push(m.params.path!);
            const file = await editor.game.read(m.params.path!);
            await up({ type: "scmjs.link.reply", id: m.id, ok: true, result: { found: !!file } }, file ?? undefined);
          } else await up({ type: "scmjs.link.reply", id: m.id, ok: false, error: { code: "unknown", message: "?" } });
        }
      }
    };
    const said: string[] = [];
    const opening = owner.open({ editor: "http://localhost:1/", timeout: 5_000, say: (...l) => { said.push(...l); const address = /http:\/\/127\.0\.0\.1:\d+\/\w+/.exec(l.join(" "))?.[0]; if (address) void page(address).catch(() => {}); } });
    return { dir, file, owner, editor, opening, up, said };
  }

  it("reads and writes a linked file through the editor, from this process and from another's place", async () => {
    const { file, owner, editor, opening, up } = await open();
    await opening;
    expect((await linkFor(file))).toBe(owner);
    expect((await allLinks()).map((l) => l.name)).toEqual(["a.scx"]);

    setLinkLabel("scmjs map set");
    expect(Array.from((await linkedRead(file))!)).toEqual([1, 2, 3]);
    expect(await linkedWrite(file, new Uint8Array([9, 9]))).toBe(true);
    expect(Array.from(editor.held)).toEqual([9, 9]);
    expect(editor.labels).toEqual(["scmjs map set"]);
    // The file itself is untouched until the editor saves.
    expect(Array.from(readFileSync(file))).toEqual([1, 2, 3]);
    // A second write in the same run starts from what the first left.
    expect(await linkedWrite(file, new Uint8Array([8]))).toBe(true);
    // The editor moved on since this process last read: refused, with the word a caller retries on.
    editor.rev++;
    await expect(linkedWrite(file, new Uint8Array([7]))).rejects.toMatchObject({ code: "changed" });
    expect(Array.from(editor.held)).toEqual([8]);

    // Another scmjs process has only the line in the cache folder: the same calls, over the loopback address.
    const record = JSON.parse(readFileSync(join(process.env.SCMJS_CACHE!, "links", (await import("node:fs")).readdirSync(join(process.env.SCMJS_CACHE!, "links"))[0]), "utf8")) as { port: number; key: string };
    const rpc = async (key: string, body: unknown) => fetch(`http://127.0.0.1:${record.port}/rpc`, { method: "POST", headers: { "x-scmjs-key": key }, body: `${JSON.stringify(body)}\n` });
    expect((await rpc("wrong", { method: "alive" })).status).toBe(403);
    const answer = await rpc(record.key, { method: "read" });
    const body = Buffer.from(await answer.arrayBuffer());
    expect(JSON.parse(body.subarray(0, body.indexOf(10)).toString())).toMatchObject({ ok: true, result: { rev: 3 } });
    expect(Array.from(body.subarray(body.indexOf(10) + 1))).toEqual([8]);

    // The editor's Save comes up through the page and is written here.
    let saved = 0;
    owner.onSave((n) => { saved = n; });
    const reply = await up({ type: "scmjs.link", id: "e1", method: "write" }, new Uint8Array([8]));
    expect(JSON.parse((await reply.text()).split("\n")[0])).toMatchObject({ ok: true });
    expect(Array.from(readFileSync(file))).toEqual([8]);
    expect(saved).toBe(1);

    // The map closed there: the link is over, the line is gone, and the file is a file again.
    let reason = "";
    owner.onEnd((r) => { reason = r; });
    await up({ type: "scmjs.link", method: "ended", params: { reason: "closed" } });
    expect(reason).toBe("the map was closed in the editor");
    expect(await linkFor(file)).toBeNull();
    expect(await linkedRead(file)).toBeNull();
    expect(await linkedWrite(file, new Uint8Array([5]))).toBe(false);
    await expect(owner.call("read")).rejects.toBeInstanceOf(LinkError);
  });

  it("sends the MCP server's tools to the editor for a linked map, and says so", async () => {
    const client = new Client({ name: "test", version: "0" });
    const { server } = createMcpServer();
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    type Result = { content: { type: string; text?: string }[]; isError?: boolean };
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as Result;
      return { text: r.content.map((c) => c.text ?? "").join("\n"), failed: r.isError === true };
    };
    // Nothing linked yet: the editor tools say what to do.
    process.env.SCMJS_CACHE = join(mkdtempSync(join(tmpdir(), "scmjs-link-")), "cache");
    dirs.push(join(process.env.SCMJS_CACHE, ".."));
    expect(await call("editor_state")).toMatchObject({ failed: true, text: expect.stringContaining("No map is linked") });

    const ums = new Uint8Array(readFileSync(join(import.meta.dirname, "maps/ums.scx")));
    const { file, editor, opening } = await open("yes", ums);
    await opening;
    expect((await call("map_info", { path: file })).text).toContain("Test Scenario");
    const set = await call("map_set", { path: file, name: "From a tool" });
    expect(set.failed).toBe(false);
    expect(set.text).toContain("Changed in the editor");
    expect(editor.labels).toEqual(["scmjs map set"]);
    expect(scenarioName((await openMapBytes(editor.held, "a.scx")).scenario)).toBe("From a tool");
    expect(readFileSync(file).equals(Buffer.from(ums))).toBe(true);
    // With `out` the result is a file of its own, and the editor is left as it was.
    const copy = join(file, "..", "copy.scx");
    expect((await call("map_set", { path: file, name: "A copy", out: copy })).text).toContain("Written to");
    expect(editor.labels).toHaveLength(1);
    // The person edits between a tool's read and its write: the tool runs once more from what the editor has now.
    const bump = editor.held;
    Object.defineProperty(editor, "held", { configurable: true, get: () => { Object.defineProperty(editor, "held", { configurable: true, writable: true, value: bump }); editor.rev++; return bump; } });
    expect((await call("map_set", { path: file, name: "After a retry" })).failed).toBe(false);
    expect(scenarioName((await openMapBytes(editor.held, "a.scx")).scenario)).toBe("After a retry");

    expect((await call("editor_close")).text).toContain("no longer linked");
    expect(await linkFor(file)).toBeNull();
    await client.close();
  });

  it("borrows the editor's game data when it has some, each file once", async () => {
    const { file, editor, opening } = await open();
    await opening;
    // An editor from before this answers `unknown`: nothing to borrow, and that is not an error.
    expect(await linkedGame(file)).toBeNull();
    expect(await linkedGame(join(tmpdir(), "not-linked.scx"))).toBeNull();
    editor.game = { name: "StarCraft: Brood War", asked: [], read: (path) => (path === "arr/units.dat" ? new Uint8Array([9, 8, 7]) : null) };
    const game = (await linkedGame(file))!;
    expect(game.label).toBe("the editor's game data (StarCraft: Brood War)");
    expect(Array.from((await game.readStored("arr/units.dat"))!)).toEqual([9, 8, 7]);
    expect(await game.readStored("arr/weapons.dat")).toBeNull();
    await game.readStored("arr/units.dat");
    expect(editor.game.asked).toEqual(["arr/units.dat", "arr/weapons.dat"]);
    // The same data set again is the same copy, so what was decoded from it is kept.
    expect(await linkedGame(file)).toBe(game);
  });

  const copy = (() => { try { return findGameCopy(process.env.SCMJS_STARCRAFT, { pictures: true }); } catch { return null; } })();

  it.skipIf(!copy)("paints a linked map's terrain with the editor's tileset, not the installation's", async () => {
    const made = mkdtempSync(join(tmpdir(), "scmjs-link-map-"));
    dirs.push(made);
    await writeNewMap(join(made, "flat.scx"), { width: 64, height: 64, tileset: "jungle", name: "flat", description: "", version: "broodwar", players: 2, layout: "ring" });
    const { file, editor, opening } = await open("yes", new Uint8Array(readFileSync(join(made, "flat.scx"))));
    await opening;
    // The stand-in editor's data set is this computer's copy of the game, asked for by the editor's own paths.
    const files = copy!.kind === "remastered" ? await storageFiles(copy!.folder) : archiveFiles(copy!.folder);
    editor.game = { name: "StarCraft: Brood War", asked: [], read: async (path) => { const member = memberOfStored(path); return member ? files.read(member) : null; } };
    const client = new Client({ name: "test", version: "0" });
    const { server } = createMcpServer();
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const r = (await client.callTool({ name: "map_edit", arguments: { path: file, edits: [{ op: "paint_terrain", terrain: "High Dirt", tiles: { x0: 20, y0: 16, x1: 44, y1: 40 }, shape: "ellipse" }] } })) as { content: { text?: string }[]; structuredContent?: { game: { from: string; label: string; tileset: boolean; folder: string } }; isError?: boolean };
      expect(r.isError, r.content[0]?.text).toBeFalsy();
      expect(r.structuredContent!.game).toMatchObject({ from: "editor", label: "the editor's game data (StarCraft: Brood War)", tileset: true, folder: "" });
      expect(r.content[0].text).toMatch(/paint_terrain {2}High Dirt · [\d,]+ tiles changed\n.*written to the editor, as one undo step/s);
      expect(editor.game.asked).toEqual(expect.arrayContaining(["tileset/jungle.cv5", "tileset/jungle.vr4", "tileset/jungle.dddata.bin"]));
      // The change went to the editor as one step, and the file on disk is as it was.
      expect([editor.rev, editor.labels]).toEqual([1, ["scmjs map edit"]]);
      expect(readFileSync(file).equals(readFileSync(join(made, "flat.scx")))).toBe(true);
      const terrain = (await client.callTool({ name: "map_terrain", arguments: { path: file, grid: false } })) as { structuredContent?: { game: string; terrains: { name: string; tiles: number }[] } };
      expect(terrain.structuredContent!.game).toBe("the editor's game data (StarCraft: Brood War)");
      expect(terrain.structuredContent!.terrains.find((x) => x.name === "High Dirt")!.tiles).toBeGreaterThan(200);
    } finally { await client.close(); }
  }, 30_000);

  it("says why when the editor did not link the map", async () => {
    const refused = await open("no");
    await expect(refused.opening).rejects.toThrow("did not open a.scx");
    expect(await linkFor(refused.file)).toBeNull();
    const old = await open("old");
    await expect(old.opening).rejects.toThrow("cannot link to scmjs yet");
  });
});
