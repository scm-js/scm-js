/**
 * `scmjs map fetch`: the scmscx.com client against a stand-in for the site on the loopback address (no network in
 * these tests — CI has none), the search table, file naming, the download's refusals and its errors. The live site is
 * one test run by hand: `SCMJS_LIVE=1 npx vitest run tests/cli-fetch.test.ts`.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchJson, fetchMap, mapIdFrom, outputPath, parseLimit, printFetched, printSearch, safeFileName, searchJson, searchMaps } from "../cli/src/fetch";
import { scmscx, USER_AGENT } from "../cli/src/scmscx";
import { CliError, visible } from "../cli/src/ui";
import { TEST_MAPS_DIR } from "./support/maps";

const UMS = new Uint8Array(readFileSync(join(TEST_MAPS_DIR, "ums.scx")));
const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-fetch-"));

const info = (hash: string, extra: object = {}) => ({
  scenario: "\x04Ridge\x01 Test", scenario_description: "", player_owners: [6, 6, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  meta: { mpq_hash: hash, mpq_size: UMS.length, downloads: 12, views: 40, uploaded_by: "someone", uploaded_time: 1616904673 },
  properties: { width: 64, height: 96, tileset: 4, ver: 205 }, ...extra,
});

/** What the stand-in answers, by path; a function takes over the response itself. */
const ROUTES: Record<string, unknown> = {
  "/api/uiv2/search/ridge%20test": {
    total_results: 4,
    maps: [
      { id: "ABC", filename: "(2)Ridge.scx", scenario_name: "\x04Ridge\x01 Test" },
      { id: "ABC", filename: "Ridge 1.1.scx", scenario_name: "\x04Ridge\x01 Test" },
      { id: "DEF", filename: "ridge2.scm", scenario_name: "" },
      { id: "BAD", filename: "gone.scx", scenario_name: "Gone" },
    ],
  },
  "/api/uiv2/search/nothing": { maps: [], total_results: 0 },
  "/api/uiv2/search/odd": { results: [] },
  "/api/uiv2/map_info/ABC": info("good"),
  "/api/uiv2/map_info/DEF": info("good", { properties: { width: 128, height: 128, tileset: 0, ver: 59 } }),
  "/api/uiv2/map_info/HTML": info("html"),
  "/api/uiv2/map_info/MPQ": info("garbage"),
  "/api/uiv2/map_info/STALL": info("stall"),
  "/api/uiv2/map_info/NONAME": info("good", { scenario: "" }),
  "/api/uiv2/filenames2/ABC": [{ filename: "(2)Ridge<1>.scx", modified_time: 1 }, { filename: "Ridge 1.1.scx", modified_time: 2 }, { filename: "(2)Ridge<1>.scx", modified_time: 3 }],
  "/api/uiv2/filenames2/DEF": [{ filename: "ridge2", modified_time: 1 }],
  "/api/maps/good": UMS,
  "/api/maps/html": new TextEncoder().encode("<!doctype html><title>Not here</title>"),
  "/api/maps/garbage": new Uint8Array([0x4d, 0x50, 0x51, 0x1a, ...new Array(60).fill(0)]),
};

let server: Server;
let base = "";
const seen: IncomingMessage["headers"][] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(req.headers);
    const path = (req.url ?? "/").split("?")[0];
    // An id the site cannot read is a 500 from map_info; a busy site is a 503; a slow one says nothing.
    if (path === "/api/uiv2/map_info/BAD") { res.writeHead(500, { "content-type": "text/plain" }).end("Something went wrong :)"); return; }
    if (path === "/api/uiv2/map_info/BUSY") { res.writeHead(503).end(); return; }
    if (path === "/api/uiv2/map_info/SLOW") return;
    if (path === "/api/maps/stall") { res.writeHead(200, { "content-type": "application/octet-stream" }); res.write(UMS.subarray(0, 100)); return; }
    const body = ROUTES[path];
    if (body === undefined) { res.writeHead(404).end(); return; }
    if (body instanceof Uint8Array) res.writeHead(200, { "content-type": "application/octet-stream" }).end(body);
    else res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.closeAllConnections(); server.close(); });

const site = (timeout = 2000) => scmscx({ base, timeout });
async function refusal(p: Promise<unknown>): Promise<CliError> {
  try { await p; } catch (e) { if (e instanceof CliError) return e; throw e; }
  throw new Error("expected a CliError");
}

describe("scmjs map fetch: the search", () => {
  it("merges the site's rows by map, adds each map's details and prints the table", async () => {
    const r = await searchMaps(site(), "ridge test", 10);
    expect(r.total).toBe(4);
    expect(r.maps.map((m) => [m.id, m.name, m.fileNames])).toEqual([
      ["ABC", "Ridge Test", ["(2)Ridge.scx", "Ridge 1.1.scx"]],
      ["DEF", "ridge2.scm", ["ridge2.scm"]],
      ["BAD", "Gone", ["gone.scx"]],
    ]);
    expect(r.maps[0].info).toMatchObject({ width: 64, height: 96, tileset: 4, version: 205, humans: 2, computers: 1, downloads: 12, fileNames: [] });
    // A map the site will not describe stays in the list, without its details.
    expect(r.maps[2].info).toBeNull();
    const lines = printSearch(r, 120).map(visible);
    expect(lines[0]).toBe('scmscx.com · 4 files match "ridge test" · the best 3 maps');
    expect(lines[2]).toMatch(/^ {2}Name +Size +Tileset +Players +Downloads +Id$/);
    expect(lines[3]).toMatch(/^ {2}Ridge Test +64 × 96 +Jungle World +2 \+ 1 computer +12 +ABC$/);
    expect(lines[4]).toMatch(/ridge2\.scm +128 × 128 +Badlands +2 \+ 1 computer +12 +DEF$/);
    expect(lines[5]).toMatch(/^ {2}Gone +BAD$/);
    expect(lines.at(-1)).toContain("scmscx.com");
    expect(searchJson(r).maps[0]).toMatchObject({ id: "ABC", url: `${base}/map/ABC`, tileset: "Jungle World", version: "Brood War 1.04", humans: 2 });
    expect((await searchMaps(site(), "ridge test", 1)).maps).toHaveLength(1);
  });

  it("says who is asking", async () => {
    await site().search("nothing");
    expect(seen.at(-1)?.["user-agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^scmjs\/\S+ \(\+https:\/\/docs\.scmjs\.dev\/cli\/\)$/);
  });

  it("says when nothing matched, and refuses an answer it does not understand", async () => {
    const r = await searchMaps(site(), "nothing");
    expect(r.maps).toEqual([]);
    expect(printSearch(r).map(visible)).toEqual(['Nothing on scmscx.com matches "nothing"']);
    expect((await refusal(site().search("odd"))).message).toMatch(/answered the search with something unexpected/);
  });

  it("takes --limit between 1 and 50", () => {
    expect(parseLimit(undefined)).toBe(10);
    expect(parseLimit("25")).toBe(25);
    for (const bad of ["0", "51", "two", "1.5"]) expect(() => parseLimit(bad)).toThrow(CliError);
  });
});

describe("scmjs map fetch: naming", () => {
  it("makes the site's file name safe for any system", () => {
    expect(safeFileName("(4)Lost Temple 2.4 PGT.scm", 59)).toBe("(4)Lost Temple 2.4 PGT.scm");
    expect(safeFileName("(2)Ridge<1>.scx", 205)).toBe("(2)Ridge_1_.scx");
    expect(safeFileName('a/b\\c:d*e?f"g|h', 205)).toBe("a_b_c_d_e_f_g_h.scx");
    expect(safeFileName("ridge2", 59)).toBe("ridge2.scm");
    expect(safeFileName("ridge2", 206)).toBe("ridge2.scx");
    expect(safeFileName("Map.SCX", 59)).toBe("Map.SCX");
    expect(safeFileName("..\\..\\x.scm", 59)).toBe("_.._x.scm");
    expect(safeFileName("../x.scm", 59)).toBe("_x.scm");
    expect(safeFileName("\x04Name\x01 .", 205)).toBe("Name.scx");
    expect(safeFileName("CON.scm", 59)).toBe("_CON.scm");
    expect(safeFileName("", 205, "ABC")).toBe("ABC.scx");
    expect(safeFileName(" .scx", 205, "ABC")).toBe("ABC.scx");
    expect(safeFileName("이름 리마스터", 206)).toBe("이름 리마스터.scx");
    expect([...safeFileName("x".repeat(300), 205)]).toHaveLength(124);
  });

  it("takes an id or the map's address", () => {
    expect(mapIdFrom("B8V7fdyj")).toBe("B8V7fdyj");
    expect(mapIdFrom("https://scmscx.com/map/B8V7fdyj")).toBe("B8V7fdyj");
    expect(mapIdFrom("scmscx.com/map/B8V7fdyj?x=1#top")).toBe("B8V7fdyj");
    expect(() => mapIdFrom("not an id")).toThrow(CliError);
  });

  it("writes into the folder named, the file named, or standard output", () => {
    const dir = tmp();
    expect(outputPath(undefined, "a.scx")).toBe("a.scx");
    expect(outputPath("-", "a.scx")).toBe("-");
    expect(outputPath(dir, "a.scx")).toBe(join(dir, "a.scx"));
    expect(outputPath("maps/", "a.scx")).toBe(join("maps", "a.scx"));
    expect(outputPath(join(dir, "b.scx"), "a.scx")).toBe(join(dir, "b.scx"));
  });
});

describe("scmjs map fetch: the download", () => {
  it("writes the map under the site's name, opened first, and refuses to overwrite it", async () => {
    const dir = tmp();
    const r = await fetchMap(site(), "ABC", { out: dir });
    const file = join(dir, "(2)Ridge_1_.scx");
    expect(r.written).toEqual({ path: file, bytes: UMS.length });
    expect(new Uint8Array(readFileSync(file))).toEqual(UMS);
    expect(r.report).toMatchObject({ name: "Test Scenario", width: 64, height: 64 });
    const lines = printFetched(r).map(visible);
    expect(lines[0]).toBe("Test Scenario");
    expect(lines[1]).toMatch(/^ {2}Map +64 × 64 · .+ · /);
    expect(lines[2]).toMatch(/^ {2}File +\(2\)Ridge_1_\.scx · /);
    expect(lines[3]).toContain(`${base}/map/ABC · uploaded by someone · 12 downloads`);
    expect(lines[4]).toBe(`✔ Written to ${file}`);
    expect(fetchJson(r)).toMatchObject({ id: "ABC", file: "(2)Ridge_1_.scx", written: { path: file } });

    writeFileSync(file, "mine");
    const e = await refusal(fetchMap(site(), "ABC", { out: dir }));
    expect([e.message, e.exitCode]).toEqual([`${file} is there already`, 2]);
    expect(readFileSync(file, "utf8")).toBe("mine");
    await fetchMap(site(), "ABC", { out: dir, force: true });
    expect(new Uint8Array(readFileSync(file))).toEqual(UMS);

    // A name of its own, and a map whose site names nothing.
    const named = join(dir, "mine.scx");
    expect((await fetchMap(site(), "ABC", { out: named })).written.path).toBe(named);
    expect((await fetchMap(site(), "NONAME", { out: dir })).written.path).toBe(join(dir, "NONAME.scx"));
  });

  it("writes to a stream for `-`", async () => {
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on("data", (c: Buffer) => chunks.push(c));
    const r = await fetchMap(site(), "ABC", { out: "-", stdout: out });
    expect(r.written).toEqual({ path: "-", bytes: UMS.length });
    expect(new Uint8Array(Buffer.concat(chunks))).toEqual(UMS);
    expect(visible(printFetched(r).at(-1)!)).toBe("✔ Written to standard output");
  });

  it("refuses bytes that are not a map, and writes nothing", async () => {
    const dir = tmp();
    const html = await refusal(fetchMap(site(), "HTML", { out: dir }));
    expect(html.message).toMatch(/^What scmscx\.com sent for HTML is not a map \(\d+ B, no archive header\)$/);
    const mpq = await refusal(fetchMap(site(), "MPQ", { out: dir }));
    expect(mpq.message).toMatch(/^What scmscx\.com sent for MPQ is not a map this can read: /);
    expect(existsSync(join(dir, "Ridge Test.scx"))).toBe(false);
  });

  it("says when the site has no such map, refuses, is slow or cannot be reached", async () => {
    const dir = tmp();
    const missing = await refusal(fetchMap(site(), "BAD", { out: dir }));
    expect([missing.message, missing.exitCode]).toEqual([`${new URL(base).host} has no such map`, 1]);
    expect((await refusal(site().file("nope"))).message).toMatch(/has no such map$/);
    expect((await refusal(site().mapInfo("BUSY"))).message).toMatch(/answered 503 Service Unavailable$/);
    const slow = await refusal(site(200).mapInfo("SLOW"));
    expect(slow.message).toMatch(/did not answer within 0\.2 seconds$/);
    // A download that stops half way gives up the same way.
    expect((await refusal(fetchMap(site(200), "STALL", { out: dir }))).message).toMatch(/did not answer within 0\.2 seconds$/);
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const port = (closed.address() as { port: number }).port;
    await new Promise((r) => closed.close(r));
    const down = await refusal(scmscx({ base: `http://127.0.0.1:${port}` }).search("x"));
    expect(down.message).toMatch(/could not be reached \(ECONNREFUSED\)$/);
    expect(down.exitCode).toBe(1);
  });
});

describe.skipIf(!process.env.SCMJS_LIVE)("scmjs map fetch: the live site (SCMJS_LIVE=1, by hand)", () => {
  it("finds Lost Temple and downloads the best match", async () => {
    const live = scmscx();
    const r = await searchMaps(live, "lost temple", 3);
    expect(r.maps.length).toBeGreaterThan(0);
    expect(r.maps[0].info?.width).toBeGreaterThan(0);
    const got = await fetchMap(live, r.maps[0].id, { out: tmp() });
    expect(got.report.width).toBe(r.maps[0].info?.width);
    expect(got.written.bytes).toBe(got.info.bytes);
  }, 30_000);
});
