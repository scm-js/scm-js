/**
 * A stand-in of the scmjs.dev server's library routes (ai-server's maps, replays and rooms routes, the parts
 * `scmjs library` and links as input call), on the loopback address with what it keeps in memory. A session is
 * `Bearer sess-ok`; the public link routes take none. `tests/cli-library.test.ts` uses it, and it can be run by
 * itself (`node tests/support/libraryServer.ts <map> <replay>`) to drive the built command by hand.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { basename } from "node:path";

export interface StandInRevision { number: number; note: string; fileName: string; sizeBytes: number; createdAt: string; bytes: Uint8Array; meta: Record<string, unknown> }
export interface StandInMap { id: string; name: string; description: string; createdAt: string; updatedAt: string; revisions: StandInRevision[]; links: { token: string; revision: number | null; opens: number; createdAt: string }[] }
export interface StandInReplay { id: string; fileName: string; note: string; bytes: Uint8Array; uploadedAt: string; mapName: string; matchup: string; players: { name: string; race: string }[]; durationSec: number; gameTypeName: string; playedAt: string | null; links: { token: string; opens: number; createdAt: string }[] }
export interface StandInRoom { id: string; kind: "live" | "kept"; name: string; invite: string; people: string[]; createdAt: string; keepDays?: 1 | 7 | 30 | null }

export interface StandIn {
  base: string; server: Server;
  maps: StandInMap[]; replays: StandInReplay[]; rooms: StandInRoom[];
  /** Every request, as `METHOD /path` with whether it carried the session. */
  seen: { route: string; auth: string | null }[];
  close(): Promise<void>;
}

const T0 = "2026-11-14T09:30:00.000Z";
/** The stand-in's links, shaped as the server's (18 random bytes, base64url): two map links, a replay's, two invites. */
export const TOKENS = ["sJ5Z3w12SFSoLCD6zej-b46a", "Qm8vT0aYc2LrXk1pWd7eNf3h", "pX4nR8Lq0Tz6Vw2yBc9dFg1J", "49vlCkKoYvMJGzIah5I0Vo_y", "Hk2mP7sQ9rT4uW6xZ8bD0fG3"] as const;
const token = (n: number, _kind: string) => TOKENS[n - 1];

/** Two maps (one with three revisions and two links, kept open for editing), one replay with a link, one live room. */
export function standInData(mapBytes: Uint8Array, replayBytes: Uint8Array): { maps: StandInMap[]; replays: StandInReplay[]; rooms: StandInRoom[] } {
  const rev = (number: number, fileName: string, note: string, bytes: Uint8Array, meta: Record<string, unknown> = { width: 64, height: 64, tileset: "jungle" }): StandInRevision =>
    ({ number, note, fileName, sizeBytes: bytes.length, createdAt: T0, bytes, meta });
  const ridge: StandInMap = {
    id: "3f2a9c1e-7b44-4c2e-9a10-5d1e2f3a4b5c", name: "Ridge", description: "", createdAt: T0, updatedAt: T0,
    revisions: [rev(1, "ridge.scx", "first", mapBytes), rev(2, "ridge.scx", "Shared with a link", mapBytes), rev(3, "ridge.scx", "Edited together: Ann", mapBytes)],
    links: [{ token: token(1, "map"), revision: 3, opens: 12, createdAt: T0 }, { token: token(2, "map"), revision: null, opens: 0, createdAt: T0 }],
  };
  const test: StandInMap = { id: "a81b22c0-1111-4222-8333-944455556666", name: "Test map", description: "", createdAt: T0, updatedAt: "2026-11-10T12:00:00.000Z", revisions: [rev(1, "test.scx", "", mapBytes)], links: [] };
  const replay: StandInReplay = {
    id: "77aa01bc-2222-4333-8444-955566667777", fileName: "game.rep", note: "", bytes: replayBytes, uploadedAt: T0, mapName: "Fighting Spirit", matchup: "PvT",
    players: [{ name: "Ann", race: "protoss" }, { name: "Bob", race: "terran" }], durationSec: 754, gameTypeName: "Melee", playedAt: "2026-11-12T20:00:00.000Z",
    links: [{ token: token(3, "rep"), opens: 3, createdAt: T0 }],
  };
  return {
    maps: [ridge, test], replays: [replay],
    rooms: [
      { id: ridge.id, kind: "kept", name: "Ridge", invite: token(4, "inv"), people: [], createdAt: T0, keepDays: 7 },
      { id: "room-live-1", kind: "live", name: "Sketch", invite: token(5, "inv"), people: ["Ann", "Cid"], createdAt: T0 },
    ],
  };
}

export async function startStandIn(data: { maps: StandInMap[]; replays: StandInReplay[]; rooms: StandInRoom[] }, port = 0): Promise<StandIn> {
  const self: StandIn = { base: "", server: null as unknown as Server, ...data, seen: [], close: async () => { await new Promise((r) => self.server.close(() => r(null))); } };
  const storage = () => {
    const revs = self.maps.flatMap((m) => m.revisions);
    return { usedBytes: revs.reduce((n, r) => n + r.sizeBytes, 0) + self.replays.reduce((n, r) => n + r.bytes.length, 0), capBytes: 262_144_000, maps: self.maps.length, revisions: revs.length, replays: self.replays.length };
  };
  const revView = (r: StandInRevision) => ({ id: `rev-${r.number}`, number: r.number, note: r.note, fileName: r.fileName, sizeBytes: r.sizeBytes, sha256: createHash("sha256").update(r.bytes).digest("hex"), meta: r.meta, createdAt: r.createdAt });
  const summary = (m: StandInMap) => {
    const head = m.revisions.reduce((a, r) => (r.number > a.number ? r : a));
    return { id: m.id, name: m.name, description: m.description, createdAt: m.createdAt, updatedAt: m.updatedAt, revisions: m.revisions.length, head: revView(head), links: m.links.length };
  };
  const detail = (m: StandInMap) => ({ ...summary(m), history: [...m.revisions].sort((a, b) => b.number - a.number).map(revView), linkList: m.links.map((l) => ({ ...l, mapId: m.id })) });
  const replayView = (r: StandInReplay) => {
    const { bytes, ...rest } = r;
    return { ...rest, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), mapWidth: 128, mapHeight: 128, frames: Math.round(r.durationSec * 1000 / 42), gameType: 2, title: "", format: "1.21", links: r.links.map((l) => ({ ...l, replayId: r.id })) };
  };
  const roomView = (r: StandInRoom) => r;

  self.server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const auth = req.headers.authorization ?? null;
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => { raw += c; });
    req.on("end", () => {
      const route = `${req.method} ${url.pathname}`;
      self.seen.push({ route, auth });
      const send = (status: number, v: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
      const notFound = (message: string) => send(404, { error: { code: "not_found", message } });
      const file = (bytes: Uint8Array, name: string, revision?: number) => {
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(bytes.length), "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`, ...(revision ? { "x-map-revision": String(revision) } : {}) });
        res.end(Buffer.from(bytes));
      };
      const body = (): Record<string, unknown> => { try { return JSON.parse(raw || "{}"); } catch { return {}; } };
      const p = url.pathname.split("/").slice(1).map(decodeURIComponent);
      // The public link routes: no session.
      if (req.method === "GET" && p[1] === "links") {
        const m = self.maps.find((x) => x.links.some((l) => l.token === p[2]));
        const l = m?.links.find((x) => x.token === p[2]);
        if (!m || !l) return notFound("This link has been removed, or the map it opened is gone.");
        const r = l.revision === null ? m.revisions.reduce((a, x) => (x.number > a.number ? x : a)) : m.revisions.find((x) => x.number === l.revision)!;
        if (p[3] === "file") { l.opens++; return file(r.bytes, r.fileName, r.number); }
        return send(200, { map: { token: l.token, name: m.name, description: m.description, owner: "Ann", revision: r.number, fileName: r.fileName, sizeBytes: r.sizeBytes, meta: r.meta, savedAt: r.createdAt } });
      }
      if (req.method === "GET" && p[1] === "replay-links") {
        const r = self.replays.find((x) => x.links.some((l) => l.token === p[2]));
        const l = r?.links.find((x) => x.token === p[2]);
        if (!r || !l) return notFound("This link has been removed, or the replay it opened is gone.");
        if (p[3] === "file") { l.opens++; return file(r.bytes, r.fileName); }
        const { links: _l, id: _i, ...facts } = replayView(r);
        return send(200, { replay: { ...facts, token: l.token } });
      }
      if (auth !== "Bearer sess-ok") return send(401, { error: { code: "unauthorized", message: "Sign in before using map storage." } });
      if (route === "GET /v1/storage") return send(200, { storage: storage() });
      if (route === "GET /v1/maps") return send(200, { maps: [...self.maps].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summary), storage: storage() });
      if (route === "GET /v1/replays") return send(200, { replays: self.replays.map(replayView), storage: storage() });
      if (route === "GET /v1/rooms/mine") return send(200, { rooms: self.rooms.map(roomView), limit: 3 });
      if (p[1] === "rooms" && p[2] === "mine" && req.method === "DELETE") {
        const i = self.rooms.findIndex((r) => r.id === p[3]);
        if (i < 0) return notFound("You are not sharing a map by that id.");
        self.rooms.splice(i, 1);
        return send(200, { rooms: self.rooms, limit: 3 });
      }
      if (p[1] === "maps" && p[2]) {
        const m = self.maps.find((x) => x.id === p[2]);
        if (!m) return notFound("There is no map with that id on this account.");
        if (p.length === 3) {
          if (req.method === "GET") return send(200, { map: detail(m), storage: storage() });
          if (req.method === "PATCH") { const b = body(); if (typeof b.name === "string") m.name = b.name; return send(200, { map: detail(m), storage: storage() }); }
          if (req.method === "DELETE") { self.maps.splice(self.maps.indexOf(m), 1); self.rooms = self.rooms.filter((r) => r.id !== m.id); return send(200, { storage: storage() }); }
        }
        if (p[3] === "links" && req.method === "DELETE") {
          const i = m.links.findIndex((l) => l.token === p[4]);
          if (i < 0) return notFound("There is no such link on this map.");
          m.links.splice(i, 1);
          return send(200, { map: detail(m), storage: storage() });
        }
        if (p[3] === "revisions") {
          const n = Number(p[4]);
          const r = m.revisions.find((x) => x.number === n);
          if (!r) return notFound("There is no revision with that number on this map.");
          if (p[5] === "file" && req.method === "GET") return file(r.bytes, r.fileName, r.number);
          if (req.method === "PATCH") { const b = body(); if (typeof b.note === "string") r.note = b.note; return send(200, { map: detail(m), storage: storage() }); }
          if (req.method === "DELETE") {
            if (m.revisions.length <= 1) return send(400, { error: { code: "invalid_input", message: "A map keeps its last revision; delete the map to remove it." } });
            m.revisions.splice(m.revisions.indexOf(r), 1);
            m.links = m.links.filter((l) => l.revision !== n);
            return send(200, { map: detail(m), storage: storage() });
          }
        }
      }
      if (p[1] === "replays" && p[2]) {
        const r = self.replays.find((x) => x.id === p[2]);
        if (!r) return notFound("There is no replay with that id on this account.");
        if (p.length === 3 && req.method === "GET") return send(200, { replay: replayView(r), storage: storage() });
        if (p.length === 3 && req.method === "DELETE") { self.replays.splice(self.replays.indexOf(r), 1); return send(200, { storage: storage() }); }
        if (p[3] === "file" && req.method === "GET") return file(r.bytes, r.fileName);
        if (p[3] === "links" && req.method === "DELETE") {
          const i = r.links.findIndex((l) => l.token === p[4]);
          if (i < 0) return notFound("There is no such link on this replay.");
          r.links.splice(i, 1);
          return send(200, { replay: replayView(r), storage: storage() });
        }
      }
      send(404, { error: { code: "not_found", message: `No route ${route}` } });
    });
  });
  await new Promise<void>((r) => self.server.listen(port, "127.0.0.1", () => r()));
  self.base = `http://127.0.0.1:${(self.server.address() as { port: number }).port}`;
  return self;
}

// By itself: `node tests/support/libraryServer.ts <map> <replay> [port]`, for the built command.
if (process.argv[1] && basename(process.argv[1]) === "libraryServer.ts") {
  const [map, replay, port] = process.argv.slice(2);
  const s = await startStandIn(standInData(new Uint8Array(readFileSync(map)), new Uint8Array(readFileSync(replay))), Number(port ?? 0));
  console.log(s.base);
}
