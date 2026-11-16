/**
 * `scmjs library` and scmjs.dev links as input, against a stand-in of the server's library routes
 * (tests/support/libraryServer.ts): the list with its links, naming one thing, `get` from the account and from anyone's
 * link (no session sent), `rm` and `unlink` saying what goes before it goes, `rename`, `note`, and any command reading
 * a link through `readInput` while refusing to write back to it.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { linkTo, saveSession } from "../cli/src/account";
import { writeOutput } from "../cli/src/exchange";
import { besideInput, readInput } from "../cli/src/files";
import {
  confirmed, findInLibrary, getFromLibrary, libraryReport, noteRevision, planRemoval, planUnlink, printLibrary, removalLines, removeFromLibrary, renameMap, shortId, unlink, unlinkLines,
} from "../cli/src/library";
import { webLinkArg } from "../cli/src/mcp";
import { CliError, visible } from "../cli/src/ui";
import { dispositionName, isWebAddress, parseWebLink, safeFileName } from "../cli/src/weblink";
import { standInData, startStandIn, TOKENS, type StandIn } from "./support/libraryServer";
import { TEST_MAPS_DIR } from "./support/maps";

const MAP = new Uint8Array(readFileSync(join(TEST_MAPS_DIR, "melee.scx")));
const REPLAY = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1]);
const dir = mkdtempSync(join(tmpdir(), "scmjs-library-"));
const sessionFile = join(dir, "session.json");
let s: StandIn;
let deps: { server: string; file: string };
const link = (kind: "map" | "replay" | "share", token: string) => linkTo(kind, token, s.base);
const tok = (n: number, _kind: string) => TOKENS[n - 1];
const fails = async (p: Promise<unknown>, pattern: RegExp, exitCode?: number) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e, "it fails").toBeInstanceOf(CliError);
  expect((e as CliError).message).toMatch(pattern);
  if (exitCode !== undefined) expect((e as CliError).exitCode).toBe(exitCode);
};

beforeAll(async () => { s = await startStandIn(standInData(MAP, REPLAY)); deps = { server: s.base, file: sessionFile }; });
afterAll(async () => { await s.close(); });
beforeEach(() => {
  Object.assign(s, standInData(MAP, REPLAY));
  s.seen.length = 0;
  saveSession({ server: s.base, session: "sess-ok", name: "Ann", provider: "discord", savedAt: "" }, sessionFile);
});

describe("scmjs.dev links", () => {
  it("reads each form of link: a map, a replay (with its moment), the play page's, a map shared for editing", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(parseWebLink("https://scmjs.dev/editor/map/abcdefgh12345678", env)).toMatchObject({ kind: "map", token: "abcdefgh12345678", server: "https://api.scmjs.dev" });
    expect(parseWebLink("https://scmjs.dev/replay/abcdefgh12345678?t=6:42&play=2", env)).toMatchObject({ kind: "replay", token: "abcdefgh12345678", at: "6:42", play: "2" });
    expect(parseWebLink("https://scmjs.dev/editor/replay/abcdefgh12345678/", env)).toMatchObject({ kind: "replay" });
    expect(parseWebLink("https://scmjs.dev/play/?replay=abcdefgh12345678&t=1:00&play", env)).toMatchObject({ kind: "replay", at: "1:00", play: "" });
    expect(parseWebLink("https://scmjs.dev/nightly/map/abcdefgh12345678", env)).toMatchObject({ kind: "map" });
    expect(parseWebLink("https://scmjs.dev/editor/share/abcdefgh12345678", env)).toMatchObject({ kind: "share" });
    // The server: the link's own, else SCMJS_SERVER.
    expect(parseWebLink("https://scmjs.dev/editor/map/abcdefgh12345678?scmjs-server=http%3A%2F%2F127.0.0.1%3A9%2F", env).server).toBe("http://127.0.0.1:9");
    expect(parseWebLink("https://scmjs.dev/editor/map/abcdefgh12345678", { SCMJS_SERVER: "http://localhost:8787/" } as NodeJS.ProcessEnv).server).toBe("http://localhost:8787");
    expect(() => parseWebLink("https://example.com/editor/map/abcdefgh12345678", env)).toThrow(/not a scmjs.dev link/);
    expect(() => parseWebLink("https://scmjs.dev/library", env)).toThrow(/not a scmjs.dev link/);
    expect(() => parseWebLink("https://scmjs.dev/editor/map/a b", env)).toThrow(/not a scmjs.dev link/);
    expect(isWebAddress("scmjs.dev/replay/abcdefgh12345678")).toBe(false);
    expect(isWebAddress("HTTPS://scmjs.dev/replay/x")).toBe(true);
  });

  it("names the file as the server does, never with a folder", () => {
    expect(dispositionName(`attachment; filename="_.scx"; filename*=UTF-8''%ED%88%AC%ED%98%BC.scx`)).toBe("투혼.scx");
    expect(dispositionName(`attachment; filename="game.rep"`)).toBe("game.rep");
    expect(dispositionName(null)).toBeNull();
    expect(safeFileName("../../etc/passwd", "x.scx")).toBe("passwd");
    expect(safeFileName("..", "x.scx")).toBe("x.scx");
    expect(safeFileName("a:b?.scx", "x.scx")).toBe("a_b_.scx");
  });

  it("is read by any command as the file it links to, downloaded with no session, and is not written to", async () => {
    const url = link("map", tok(1, "map"));
    const input = await readInput(url);
    expect(input).toMatchObject({ path: url, name: "ridge.scx", kind: "map", link: url });
    expect(input.bytes).toEqual(MAP);
    expect(s.seen).toEqual([{ route: `GET /v1/links/${tok(1, "map")}/file`, auth: null }]);
    expect(besideInput(input)).toBe("ridge.scx");
    await fails(writeOutput(MAP, url), /a link cannot be written to/, 2);
    await fails(readInput(link("map", "gone1234567890abcdef")), /removed/, 2);
    await fails(readInput(link("share", tok(4, "inv"))), /link to edit a map together/, 2);
  });

  it("is refused by the MCP tools kept to a folder (a plugin's URL is not a file)", () => {
    expect(webLinkArg({ path: "https://scmjs.dev/editor/map/abcdefgh12345678" })).toBe("https://scmjs.dev/editor/map/abcdefgh12345678");
    expect(webLinkArg({ paths: ["a.scx", "https://scmjs.dev/replay/abcdefgh12345678"] })).toBe("https://scmjs.dev/replay/abcdefgh12345678");
    expect(webLinkArg({ plugin: "https://example.com/plugin.js", path: "a.scx" })).toBeNull();
  });
});

describe("scmjs library", () => {
  it("lists the maps with their links, the replays with theirs, the maps shared for editing and the storage", async () => {
    const r = await libraryReport(deps);
    expect(r.maps!.map((m) => m.name)).toEqual(["Ridge", "Test map"]);
    const ridge = r.maps![0];
    expect(ridge).toMatchObject({ revisions: 3, head: 3, fileName: "ridge.scx", width: 64, shared: link("share", tok(4, "inv")) });
    expect(ridge.links.map((l) => [l.url, l.revision, l.opens])).toEqual([[link("map", tok(1, "map")), 3, 12], [link("map", tok(2, "map")), null, 0]]);
    expect(r.replays![0]).toMatchObject({ fileName: "game.rep", matchup: "PvT", players: ["Ann", "Bob"], links: [{ url: link("replay", tok(3, "rep")), opens: 3 }] });
    expect(r.shared!.rooms.map((x) => [x.name, x.kind, x.people.length])).toEqual([["Ridge", "kept", 0], ["Sketch", "live", 2]]);
    expect(r.storage).toMatchObject({ maps: 2, revisions: 4, replays: 1 });
    // A map's detail is asked for only when it has links.
    expect(s.seen.filter((x) => x.route.startsWith("GET /v1/maps/")).map((x) => x.route)).toEqual([`GET /v1/maps/${ridge.id}`]);
    const text = printLibrary(r).map(visible).join("\n");
    expect(text).toContain(`${link("map", tok(1, "map"))} · revision 3, opened 12 times`);
    expect(text).toContain(`${link("map", tok(2, "map"))} · the newest revision, not opened yet`);
    expect(text).toContain(shortId(ridge.id));
    expect(text).toContain("Sketch  open until everyone leaves · 2 people in it");
    expect(text).toMatch(/Storage {2}.* · 2 maps, 4 revisions, 1 replay/);
  });

  it("narrows to one part, and needs a session", async () => {
    const r = await libraryReport({ ...deps, only: "replays" });
    expect([r.maps, r.shared, r.replays?.length]).toEqual([null, null, 1]);
    expect(s.seen.map((x) => x.route)).toEqual(["GET /v1/replays"]);
    await fails(libraryReport({ ...deps, file: join(dir, "none.json") }), /Sign in first/, 2);
  });

  it("names one thing by its name, file name, id, or a link to it, and lists them when a name is several", async () => {
    expect(await findInLibrary("ridge", deps)).toMatchObject({ kind: "map", map: { name: "Ridge" } });
    expect(await findInLibrary("TEST.SCX", deps)).toMatchObject({ kind: "map", map: { name: "Test map" } });
    expect(await findInLibrary("77aa01bc", deps)).toMatchObject({ kind: "replay", replay: { fileName: "game.rep" } });
    expect(await findInLibrary(link("map", tok(2, "map")), deps)).toMatchObject({ kind: "map", map: { name: "Ridge" }, link: { revision: null } });
    expect(await findInLibrary(link("replay", tok(3, "rep")), deps)).toMatchObject({ kind: "replay" });
    expect(await findInLibrary(link("share", tok(5, "inv")), deps)).toMatchObject({ kind: "shared", room: { name: "Sketch" } });
    await fails(findInLibrary("nothing", deps), /No map or replay on your account is called nothing/, 2);
    await fails(findInLibrary("https://scmjs.dev/editor/map/abcdefgh12345678", deps), /is a link on https:\/\/api.scmjs.dev/, 2);
    await fails(findInLibrary(link("map", "notmine1234567890"), deps), /not a link to anything on your account/, 2);
    s.maps[1].name = "Ridge";
    await fails(findInLibrary("Ridge", deps), /2 things on your account are called Ridge; name one by its id:\n {2}3f2a9c1e {2}map {2}Ridge \(ridge.scx\)\n {2}a81b22c0/, 2);
  });

  it("gets a map's newest revision, an older one, a replay, a kept shared map, and anyone's link without a session", async () => {
    expect(await getFromLibrary("Ridge", deps)).toMatchObject({ kind: "map", fileName: "ridge.scx", revision: 3, from: "account" });
    expect(await getFromLibrary("Ridge", { ...deps, revision: 1 })).toMatchObject({ revision: 1 });
    await fails(getFromLibrary("Ridge", { ...deps, revision: 9 }), /Ridge has no revision 9/, 2);
    const rep = await getFromLibrary("game.rep", deps);
    expect([rep.kind, rep.name, rep.bytes]).toEqual(["replay", "Fighting Spirit · PvT · Ann vs Bob", REPLAY]);
    expect(await getFromLibrary(link("share", tok(4, "inv")), deps)).toMatchObject({ kind: "map", name: "Ridge", revision: 3 });
    await fails(getFromLibrary(link("share", tok(5, "inv")), deps), /until everyone leaves, and is not kept/, 2);
    s.seen.length = 0;
    const anon = { ...deps, file: join(dir, "none.json") };
    expect(await getFromLibrary(link("replay", tok(3, "rep")), anon)).toMatchObject({ kind: "replay", fileName: "game.rep", from: "link" });
    expect(await getFromLibrary(link("map", tok(1, "map")), anon)).toMatchObject({ kind: "map", name: "Ridge", revision: 3, owner: "Ann", from: "link" });
    expect(s.seen.every((x) => x.auth === null)).toBe(true);
    await fails(getFromLibrary(link("map", tok(1, "map")), { ...anon, revision: 2 }), /--revision is for a map on your account/, 2);
    await fails(getFromLibrary(link("share", tok(4, "inv")), anon), /link to edit a map together/, 2);
  });

  it("says what a removal takes with it, then makes it", async () => {
    const map = await planRemoval("Ridge", deps);
    expect(removalLines(map)).toEqual([
      "Deletes the map Ridge: its 3 revisions (8.5 KB) and its 2 links.",
      "People with those links can no longer open it.",
      "It is shared for editing too: that link stops working and anyone in it is sent out.",
    ]);
    const head = await planRemoval("Ridge", { ...deps, revision: 3 });
    expect(removalLines(head)).toEqual(["Deletes revision 3 of Ridge (2.8 KB), and the link to it.", "People with that link can no longer open it.", "Links to the newest revision open revision 2 from then on."]);
    expect(removalLines(await planRemoval("game.rep", deps))).toEqual(["Deletes the replay Fighting Spirit · PvT · Ann vs Bob (9 B) and its link.", "People with that link can no longer watch it."]);
    await fails(planRemoval("Test map", { ...deps, revision: 1 }), /keeps its last revision/, 2);
    expect(s.seen.some((x) => x.route.startsWith("DELETE"))).toBe(false);
    await removeFromLibrary(head, deps);
    expect(s.maps[0].revisions.map((r) => r.number)).toEqual([1, 2]);
    const r = await removeFromLibrary(map, deps);
    expect(s.maps.map((m) => m.name)).toEqual(["Test map"]);
    expect(r.storage).toMatchObject({ maps: 1 });
  });

  it("removes one link: a copy link, a replay's, or a map shared for editing", async () => {
    const copy = await planUnlink(link("map", tok(1, "map")), deps);
    expect(unlinkLines(copy)).toEqual([`Removes the link ${link("map", tok(1, "map"))} to the map Ridge (revision 3); it was opened 12 times.`, "People with it can no longer open the map. The map stays on your account."]);
    await unlink(copy, deps);
    expect(s.maps[0].links.map((l) => l.token)).toEqual([tok(2, "map")]);
    await unlink(await planUnlink(link("replay", tok(3, "rep")), deps), deps);
    expect(s.replays[0].links).toEqual([]);
    const live = await planUnlink(link("share", tok(5, "inv")), deps);
    expect(unlinkLines(live)).toEqual([`Stops sharing Sketch for editing: ${link("share", tok(5, "inv"))} stops working.`, "The 2 people in it are sent out.", "The map is not kept on your account; save it from the editor first if you want it."]);
    await unlink(live, deps);
    expect(s.rooms.map((r) => r.name)).toEqual(["Ridge"]);
    await fails(planUnlink("Ridge", deps), /library unlink takes a link/, 2);
  });

  it("renames a map and sets a revision's note", async () => {
    expect(await renameMap("ridge", "Ridge 2", deps)).toMatchObject({ was: "Ridge", name: "Ridge 2" });
    expect(await noteRevision("Ridge 2", "Ready", deps)).toMatchObject({ revision: 3, note: "Ready" });
    expect(await noteRevision("Ridge 2", "", { ...deps, revision: 1 })).toMatchObject({ revision: 1, note: "" });
    await fails(renameMap("game.rep", "x", deps), /No map on your account is called game.rep/, 2);
  });

  it("asks before something that cannot be undone, and needs --yes where it cannot ask", async () => {
    expect(await confirmed("Delete it?", { yes: true, tty: false })).toBe(true);
    await fails(confirmed("Delete it?", { tty: false }), /no terminal to ask on/, 2);
    const ask = async (answer: string) => {
      const input = new PassThrough(), output = new PassThrough();
      const p = confirmed("Delete it?", { tty: true, input, output });
      input.write(`${answer}\n`);
      return p;
    };
    expect(await ask("y")).toBe(true);
    expect(await ask("yes")).toBe(true);
    expect(await ask("")).toBe(false);
    expect(await ask("n")).toBe(false);
  });
});

