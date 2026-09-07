/**
 * A stand-in for scmjs.dev's server, for the user guide's pictures only.
 *
 * The scmjs.dev plugin talks to one service — the account, the map storage and the AI
 * recipes all live at `api.scmjs.dev` — and a picture of it signed in, with maps stored
 * and an answer on screen, cannot be taken against the live service without an account,
 * a payment and a model run that comes out differently every time. So the screenshot
 * script points the plugin here (`?scmjs-server=`) and this answers as the server would:
 * one signed-in account with a ledger, real map storage (what the editor uploads is
 * kept and listed back, thumbnails included), and canned recipe results written for the
 * fixture maps the pictures use. The wire shapes are the plugin's `protocol.ts`; a
 * recipe streams as server-sent events the way the server does, so the dialogs go
 * through their waiting states.
 *
 * Nothing here is a test of the plugin or the server, and none of it ships: the pictures
 * show the editor's chrome around content that came from a file rather than a model.
 */
import { createServer } from "node:http";

const ACCOUNT_NAME = "Jeany";

export function startMock({ port = 8765, log = () => {} } = {}) {
  const state = {
    balance: 0.63,
    maps: [],
    nextMap: 1,
    requests: [],
  };
  const now = Date.now();
  const daysAgo = (d, h = 0) => new Date(now - d * 86_400_000 - h * 3_600_000).toISOString();

  const storage = () => {
    const bytes = new Set();
    let used = 0, revisions = 0;
    for (const m of state.maps) for (const r of m.history) { revisions++; if (!bytes.has(r.hash)) { bytes.add(r.hash); used += r.sizeBytes; } }
    return { usedBytes: used, capBytes: 250 * 1024 * 1024, maps: state.maps.length, revisions };
  };
  const account = () => ({
    kind: "account", name: ACCOUNT_NAME, role: "free", balanceUsd: round(state.balance), weeklyUsd: 0, creditUsd: round(state.balance),
    providers: ["discord"], storage: storage(),
  });
  const ledger = () => [
    { at: daysAgo(0, 1), kind: "charge", usd: -0.04, note: "agent" },
    { at: daysAgo(0, 1), kind: "charge", usd: -0.01, note: "describe" },
    { at: daysAgo(1), kind: "charge", usd: -0.09, note: "map-plan" },
    { at: daysAgo(1), kind: "charge", usd: -0.02, note: "review" },
    { at: daysAgo(3), kind: "charge", usd: -0.01, note: "strings" },
    { at: daysAgo(6), kind: "signup", usd: 0.8, note: "Sign-in credit" },
  ];
  const offers = () => ({
    providers: [{ id: "discord", name: "Discord" }], trial: true, trialUsd: 0.2, signupUsd: 0.8, weeklyUsd: 0,
    packs: [{ id: "five", priceUsd: 5, creditUsd: 4.55 }, { id: "ten", priceUsd: 10, creditUsd: 9.4 }],
    accountUrl: "https://scmjs.dev/account", maps: true,
  });
  const publicMap = (m) => ({ id: m.id, name: m.name, description: m.description, createdAt: m.createdAt, updatedAt: m.updatedAt, revisions: m.history.length, head: m.history[m.history.length - 1] });
  const detail = (m) => ({ ...publicMap(m), history: [...m.history].reverse() });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const path = url.pathname.replace(/\/+$/, "");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-Anthropic-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const signedIn = /^Bearer\s+\S+/.test(req.headers.authorization ?? "");
    const json = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    const body = await readBody(req);
    log(`${req.method} ${path}`);
    state.requests.push({ method: req.method, path, body: body.length < 2_000_000 ? body : null, type: req.headers["content-type"] ?? "" });

    try {
      if (path === "/v1/info" && req.method === "GET") {
        return json(200, {
          protocol: 1, version: "0.9.0", name: "scmjs.dev", models: [],
          recipes: ["map-plan", "region-plan", "triggers", "explain-triggers", "describe", "briefing", "review", "strings", "agent", "ums-design"].map((name) => ({ name, enabled: true, model: "" })),
          access: { anonymous: false, byok: false }, accounts: offers(),
          caller: signedIn ? { kind: "user", name: ACCOUNT_NAME, remaining: { balanceUsd: round(state.balance) }, account: account() } : { kind: "anonymous", remaining: {} },
        });
      }
      if (!signedIn) return json(401, { error: { code: "unauthorized", message: "no session." } });
      if (path === "/v1/account") return json(200, { account: account(), ledger: ledger() });
      if (path === "/v1/storage") return json(200, { storage: storage() });
      if (path === "/v1/auth/logout") return json(200, {});
      if (path === "/v1/maps" && req.method === "GET") return json(200, { maps: [...state.maps].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(publicMap), storage: storage() });
      if (path === "/v1/maps" && req.method === "POST") {
        const form = multipart(body, req.headers["content-type"] ?? "");
        const id = `m${state.nextMap++}`;
        const at = url.searchParams.get("at") ?? new Date().toISOString();
        const m = { id, name: form.fields.name || form.fields.fileName || "Untitled", description: form.fields.description ?? "", createdAt: at, updatedAt: at, history: [] };
        m.history.push(revision(m, 1, form, at));
        state.maps.push(m);
        return json(200, { map: detail(m), storage: storage() });
      }
      let mm = /^\/v1\/maps\/([^/]+)(?:\/revisions(?:\/(\d+)(\/file)?)?)?$/.exec(path);
      if (mm) {
        const m = state.maps.find((x) => x.id === decodeURIComponent(mm[1]));
        if (!m) return json(404, { error: { code: "not_found", message: "No such map." } });
        if (mm[2] === undefined && !path.endsWith("/revisions")) {
          if (req.method === "GET") return json(200, { map: detail(m), storage: storage() });
          if (req.method === "PATCH") { const p = JSON.parse(body.toString() || "{}"); if (p.name) m.name = p.name; if (p.description !== undefined) m.description = p.description; return json(200, { map: detail(m), storage: storage() }); }
          if (req.method === "DELETE") { state.maps = state.maps.filter((x) => x !== m); return json(200, { storage: storage() }); }
        }
        if (path.endsWith("/revisions") && req.method === "POST") {
          const form = multipart(body, req.headers["content-type"] ?? "");
          const at = url.searchParams.get("at") ?? new Date().toISOString();
          m.history.push(revision(m, m.history.length + 1, form, at));
          m.updatedAt = at;
          return json(200, { map: detail(m), storage: storage() });
        }
        const rev = m.history.find((r) => r.number === Number(mm[2]));
        if (!rev) return json(404, { error: { code: "not_found", message: "No such revision." } });
        if (mm[3]) { res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${rev.fileName}"` }); res.end(rev.bytes); return; }
        if (req.method === "PATCH") { const p = JSON.parse(body.toString() || "{}"); if (p.note !== undefined) rev.note = p.note; return json(200, { map: detail(m), storage: storage() }); }
        if (req.method === "DELETE") { m.history = m.history.filter((r) => r !== rev); return json(200, { map: detail(m), storage: storage() }); }
      }
      mm = /^\/v1\/recipes\/([a-z-]+)$/.exec(path);
      if (mm && req.method === "POST") {
        const request = JSON.parse(body.toString());
        const answer = RECIPES[mm[1]];
        if (!answer) return json(400, { error: { code: "recipe_disabled", message: `no canned answer for ${mm[1]}` } });
        const { output, text, thinking, tools = [], cost, inputTokens = 4000, outputTokens = 600 } = answer(request.input, state);
        state.balance = round(state.balance - cost);
        return stream(res, mm[1], { output, text, thinking, tools, usage: { model: "", inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: cost, durationMs: 4200 }, remaining: { balanceUsd: state.balance } });
      }
      return json(404, { error: { code: "not_found", message: `nothing at ${path}` } });
    } catch (err) {
      log(`mock error on ${path}: ${err.message}`);
      return json(500, { error: { code: "upstream", message: err.message } });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({ url: `http://localhost:${port}`, state, close: () => new Promise((r) => server.close(r)) }));
  });
}

function round(v) { return Math.round(v * 100) / 100; }

function revision(m, number, form, at) {
  const meta = form.fields.meta ? JSON.parse(form.fields.meta) : {};
  return { id: `${m.id}r${number}`, number, note: form.fields.note ?? "", fileName: form.fields.fileName || form.file?.filename || "map.scx", sizeBytes: form.file?.data.length ?? 0, meta, createdAt: at, bytes: form.file?.data ?? Buffer.alloc(0), hash: hash(form.file?.data ?? Buffer.alloc(0)) };
}

function hash(buf) { let h = 2166136261; for (let i = 0; i < buf.length; i++) { h ^= buf[i]; h = Math.imul(h, 16777619); } return `${buf.length}-${(h >>> 0).toString(16)}`; }

function readBody(req) {
  return new Promise((resolve) => { const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => resolve(Buffer.concat(chunks))); });
}

/** The few fields of a `FormData` upload: one file part and text parts. */
function multipart(body, contentType) {
  const b = /boundary=("?)([^";]+)\1/.exec(contentType)?.[2];
  const out = { fields: {}, file: null };
  if (!b) return out;
  const boundary = Buffer.from(`--${b}`);
  let at = body.indexOf(boundary);
  while (at !== -1) {
    const start = at + boundary.length;
    if (body.slice(start, start + 2).toString() === "--") break;
    const next = body.indexOf(boundary, start);
    const part = body.slice(start + 2, (next === -1 ? body.length : next) - 2); // past CRLF, before CRLF
    const split = part.indexOf("\r\n\r\n");
    const headers = part.slice(0, split).toString();
    const data = part.slice(split + 4);
    const name = /name="([^"]*)"/.exec(headers)?.[1];
    const filename = /filename="([^"]*)"/.exec(headers)?.[1];
    if (filename !== undefined) out.file = { filename, data };
    else if (name) out.fields[name] = data.toString("utf8");
    at = next;
  }
  return out;
}

/** One recipe as the server streams it: start, the words as they come, the tool calls, the result. */
async function stream(res, recipe, { output, text, thinking, tools, usage, remaining }) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  send({ event: "start", id: `run_${Date.now()}`, recipe, model: "" });
  await pause(400);
  if (thinking) { send({ event: "thinking", text: thinking }); await pause(300); }
  if (text) {
    for (const piece of text.match(/\S+\s*/g) ?? []) { send({ event: "delta", text: piece }); await pause(18); }
  }
  for (const t of tools) { send({ event: "tool_use", id: t.id, name: t.name }); await pause(120); }
  send({ event: "result", output, usage, remaining });
  send({ event: "done" });
  res.end();
}

/* ── The canned answers, written for the fixture maps ─────────────────────────── */

const terrainId = (terrains, ...names) => {
  for (const n of names) { const t = terrains.find((t) => t.name.toLowerCase() === n.toLowerCase()); if (t) return t.id; }
  return terrains[0]?.id ?? 0;
};

const RECIPES = {
  describe(input) {
    const f = input.facts;
    const players = f.players.filter((p) => p.hasStart).length || f.players.length;
    return {
      cost: 0.01, inputTokens: 2600, outputTokens: 180,
      output: {
        name: "Hunter's Bounty",
        description: `${players} players on a ${f.width}×${f.height} ${f.tileset} map. Every main sits on rich mineral lines with room to spare; the fight is for the middle, not the money.`,
        alternatives: [
          { name: "Rich Ground", description: `A ${players}-player free-for-all where no base ever runs dry. Expand for position, not for income.` },
          { name: "The Long Hunt", description: `Eight corners, one centre. Wide lanes and heavy resources make for long games and big armies.` },
        ],
      },
    };
  },

  review(input) {
    const f = input.facts;
    const w = f.width, h = f.height;
    return {
      cost: 0.03, inputTokens: 9800, outputTokens: 520,
      output: {
        summary: `A generous ${f.players.filter((p) => p.hasStart).length}-player melee map: every main has the same mineral count and two geysers, so the economy is even by design. The picture shows the weaknesses are positional rather than economic — the corner mains are safer than the edge mains, and the centre lanes favour whoever holds the high ground first.\n\nCheck Map is clean. What follows is what I would look at, most important first.`,
        findings: [
          { severity: "warning", title: "Edge mains have two entrances, corner mains one", detail: "The bases on the north and south edges can be attacked from either side, while the four corners are reached by one ramp. In a free-for-all that is a real disadvantage for the edge players; in team games it decides which slots get rushed first.", x: Math.round(w / 2), y: 6 },
          { severity: "warning", title: "No contested expansion in the middle", detail: "The centre is empty ground. A single expansion there, or a gold base, would give players a reason to fight for it rather than turtle on nine mineral fields each.", x: Math.round(w / 2), y: Math.round(h / 2) },
          { severity: "info", title: "Mineral lines face outward at four mains", detail: "Workers at these mains gather on the map-edge side, out of the main entrance's line of fire — which is good — but the town hall then stands between the minerals and the ramp, so it takes the first hits in a rush.", x: 8, y: 8 },
          { severity: "info", title: "Doodads are sparse", detail: "The plateaus read as flat colour at a glance. A few trees along the cliff edges would make the height changes easier to see without changing the play." },
        ],
      },
    };
  },

  strings(input) {
    const GERMAN = new Map([
      ["Big Game Hunters", "Großwildjäger"],
      ["Force 1", "Gruppe 1"], ["Force 2", "Gruppe 2"], ["Force 3", "Gruppe 3"], ["Force 4", "Gruppe 4"], ["Hunters", "Jäger"],
    ]);
    const strings = input.strings.map((s) => {
      const exact = GERMAN.get(s.text);
      if (exact) return { index: s.index, text: exact };
      if (/big game hunters/i.test(s.text)) return { index: s.index, text: "Eine riesige Karte mit unzähligen Rohstoffen. Am besten für das Teamspiel geeignet." };
      return { index: s.index, text: s.text };
    });
    return { cost: 0.01, inputTokens: 1900, outputTokens: 140, output: { strings } };
  },

  "map-plan"(input) {
    const T = input.terrains;
    const jungle = terrainId(T, "Jungle", "Dirt");
    const high = terrainId(T, "High Jungle", "High Dirt", "Raised Jungle");
    const water = terrainId(T, "Water");
    const dirt = terrainId(T, "Dirt", "Mud");
    const ruins = terrainId(T, "Ruins", "Rocky Ground", "Mud");
    if (input.language === "shapes") {
      // The shape language: four corner plateaus of the ground the tileset has ramps for, each with a ramp
      // on the corner nearest the middle, water between them, and a ruined arena in the centre.
      const W = input.width, H = input.height;
      const pair = input.rampPairs?.[0];
      const top = pair ? pair.high : high;
      const pw = Math.round(W * 0.3), ph = Math.round(H * 0.28), m = 3;
      const shapes = [
        { op: "ground", terrain: jungle },
        { op: "border", terrain: water, width: 2 },
        { op: "diamond", terrain: water, cx: W / 2, cy: H * 0.14, rx: W * 0.16, ry: H * 0.07 },
        { op: "diamond", terrain: water, cx: W / 2, cy: H * 0.86, rx: W * 0.16, ry: H * 0.07 },
        { op: "diamond", terrain: water, cx: W * 0.14, cy: H / 2, rx: W * 0.1, ry: H * 0.14 },
        { op: "diamond", terrain: water, cx: W * 0.86, cy: H / 2, rx: W * 0.1, ry: H * 0.14 },
        { op: "plateau", terrain: top, x: m, y: m, w: pw, h: ph, ramps: ["se"] },
        { op: "plateau", terrain: top, x: W - m - pw, y: m, w: pw, h: ph, ramps: ["sw"] },
        { op: "plateau", terrain: top, x: m, y: H - m - ph, w: pw, h: ph, ramps: ["se"] },
        { op: "plateau", terrain: top, x: W - m - pw, y: H - m - ph, w: pw, h: ph, ramps: ["sw"] },
        { op: "diamond", terrain: ruins, cx: W / 2, cy: H / 2, rx: W * 0.14, ry: H * 0.08 },
      ];
      // A river across the south-west approach with a bridge, where the tileset has bridges.
      if (input.bridgePair) shapes.push({ op: "stroke", terrain: water, points: [[W * 0.3, H * 0.62], [W * 0.42, H * 0.68]], width: 5 }, { op: "bridge", x: Math.round(W * 0.36), y: Math.round(H * 0.65), along: "se" });
      const spawn = (n, x, y) => ({ name: `Spawn ${n}`, x0: x, y0: y, x1: x + 6, y1: y + 6 });
      const base = (n, x, y) => ({ name: `Base ${n}`, x0: x, y0: y, x1: x + pw, y1: y + ph });
      return {
        cost: 0.05, inputTokens: 5000, outputTokens: 900,
        thinking: "Four plateaus in the corners, ramps on the corners that face the middle; the two northern ramps lead straight into the arena, the two southern ones open onto low ground beside the base that wraps around to it.",
        output: {
          name: "Corner Madness", description: "Four corner plateaus with one ramp each, water between them, a ruined arena in the middle.", symmetry: "none",
          cellSize: 1, columns: W, rows: H, legend: {}, grid: [], shapes,
          bases: [], ramps: [],
          doodads: [{ category: "Water", terrains: [water], density: 0.2 }, { category: "Jungle", terrains: [jungle], density: 0.05 }],
          units: [1, 2, 3, 4].map((p) => ({ unit: "Start Location", player: p, x: p % 2 ? m + 6 : W - m - 7, y: p <= 2 ? m + 5 : H - m - 6 })),
          locations: [base(1, m, m), base(2, W - m - pw, m), base(3, m, H - m - ph), base(4, W - m - pw, H - m - ph), spawn(1, m + pw - 12, m + ph - 12), spawn(2, W - m - pw + 6, m + ph - 12), spawn(3, m + pw - 12, H - m - 6), spawn(4, W - m - pw + 6, H - m - 6), { name: "Centre", x0: W / 2 - 8, y0: H / 2 - 5, x1: W / 2 + 8, y1: H / 2 + 5 }],
          notes: ["Every plateau's ramp faces south, as the game's ramps do."],
        },
      };
    }
    const cell = input.cellSize;
    const columns = Math.ceil(input.width / cell), rows = Math.ceil(input.height / cell);
    const legend = { ".": jungle, "#": high, "~": water, "=": dirt, "+": ruins };
    const grid = [];
    for (let y = 0; y < rows; y++) {
      let row = "";
      for (let x = 0; x < columns; x++) {
        const cx = x - columns / 2 + 0.5, cy = y - rows / 2 + 0.5;
        let c = ".";
        // Mains on high ground in the north-west and south-east corners.
        if ((x < 10 && y < 9) || (x >= columns - 10 && y >= rows - 9)) c = "#";
        // A dirt apron below each main, where the natural sits.
        else if ((x < 13 && y >= 9 && y < 14) || (x >= columns - 13 && y >= rows - 14 && y < rows - 9)) c = "=";
        // The lake in the middle, with a ruins island on either side of it.
        else if (Math.hypot(cx * 1.15, cy) < 6) c = "~";
        else if (Math.hypot(cx - 9, cy + 6) < 2.4 || Math.hypot(cx + 9, cy - 6) < 2.4) c = "+";
        row += c;
      }
      grid.push(row);
    }
    const hallX = 4 * cell, hallY = 3 * cell;
    const category = (re, fallback) => (input.doodadCategories ?? []).find((c) => re.test(c)) ?? fallback;
    return {
      cost: 0.09, inputTokens: 6200, outputTokens: 1900,
      thinking: "Two players, opposite corners, so 180° rotation keeps everything fair. Mains on high ground with the mineral line against the map edge; the natural on the dirt below, reached by one ramp; a lake in the centre to split the map into two lanes, with an island expansion on each side.",
      output: {
        name: "Two Rivers", description: "Two mains on high ground in opposite corners, a natural below each, and a lake in the middle that splits the map into two lanes. Two island expansions for the late game.",
        symmetry: "rot180", cellSize: cell, columns, rows, legend, grid,
        bases: [
          { kind: "main", x: hallX, y: hallY, mineralDirection: "nw", minerals: 9, geysers: 1, player: 1 },
          { kind: "natural", x: 6 * cell, y: 11 * cell, mineralDirection: "w", minerals: 7, geysers: 1 },
          { kind: "island", x: Math.round(columns / 2 + 8) * cell, y: Math.round(rows / 2 - 7) * cell, mineralDirection: "n", minerals: 6, geysers: 1 },
        ],
        ramps: [{ x: 9 * cell, y: 9 * cell, direction: "s" }],
        doodads: [{ category: category(/tree|plant|jungle/i, "Trees"), on: ".", density: 0.06 }, { category: category(/rock|ruin|stone/i, "Rocks"), on: "=", density: 0.04 }],
        units: [], locations: [],
        notes: [
          "The mains are on high ground with one ramp down to the natural, so an early attack has to come up the ramp.",
          "The lake splits the middle into a north lane and a south lane; each player's natural opens onto the nearer lane.",
          "The two island expansions are the late-game fight; they cannot be reached on foot.",
        ],
      },
    };
  },

  "ums-design"() {
    return {
      cost: 0.11, inputTokens: 12400, outputTokens: 2300,
      thinking: "A madness map is a spawn-and-clash game: each player gets a base and a stream of units, kills pay minerals, the last base standing wins. Hyper triggers underneath, a spawn per player, kill-to-cash, a leaderboard, and the melee ending.",
      output: {
        name: "Corner Madness", description: "Four walled corner bases. Zerglings and Marines spawn every few seconds and charge the centre; kills pay minerals; the last base standing wins.",
        genre: "madness", premise: "Four commanders hold the corners of a ruined jungle plateau. Every few seconds each gets a fresh squad; the centre is a meat grinder, and the minerals from kills buy the upgrades that decide who holds it longest.",
        players: [
          { slot: 1, type: "human", race: "userSelect", force: 1, role: "North-west base" },
          { slot: 2, type: "human", race: "userSelect", force: 1, role: "North-east base" },
          { slot: 3, type: "human", race: "userSelect", force: 1, role: "South-west base" },
          { slot: 4, type: "human", race: "userSelect", force: 1, role: "South-east base" },
        ],
        forces: [{ index: 1, name: "Commanders", allied: false, alliedVictory: false, sharedVision: false }],
        layoutBrief: "A square jungle map. Four walled bases in the corners on high ground, each with a single wide gate facing the centre. The middle is open low ground with ruins for cover. A spawn pad just inside each gate, and a Command Center's worth of room behind it for the base buildings.",
        layout: { preset: "corner-camps", params: [{ key: "camps", value: "4" }, { key: "between", value: "water" }] },
        locations: [
          { name: "Spawn 1", purpose: "where Player 1's squads appear, inside the north-west gate" },
          { name: "Spawn 2", purpose: "where Player 2's squads appear, inside the north-east gate" },
          { name: "Spawn 3", purpose: "where Player 3's squads appear, inside the south-west gate" },
          { name: "Spawn 4", purpose: "where Player 4's squads appear, inside the south-east gate" },
          { name: "Centre", purpose: "the middle of the map, where spawned units attack-move to" },
        ],
        systems: [
          { name: "Hyper triggers", kind: "hyper", params: [], description: "Every other system needs the trigger list running fast." },
          { name: "Zergling spawn", kind: "spawn", params: [{ key: "location", value: "Spawn {p}" }, { key: "unit", value: "Zerg Zergling" }, { key: "count", value: "4" }, { key: "every", value: "6" }, { key: "attack", value: "Centre" }], description: "Four Zerglings for each human every six seconds, sent at the centre." },
          { name: "Marine spawn", kind: "spawn", params: [{ key: "location", value: "Spawn {p}" }, { key: "unit", value: "Terran Marine" }, { key: "count", value: "2" }, { key: "every", value: "8" }, { key: "attack", value: "Centre" }], description: "Two Marines for each human every eight seconds." },
          { name: "Kills pay", kind: "kill-to-cash", params: [{ key: "minerals", value: "15" }, { key: "scorePerKill", value: "50" }], description: "Fifteen minerals for every fifty points of kill score." },
          { name: "Leaderboard", kind: "leaderboard", params: [{ key: "kind", value: "kills" }, { key: "label", value: "Kills" }], description: "Kills, top right." },
          { name: "Last base standing", kind: "last-standing", params: [{ key: "unit", value: "Buildings" }, { key: "grace", value: "60" }], description: "A player with no buildings is out; the last one in wins." },
        ],
        objectives: "Hold your corner. Spend the minerals your kills bring on upgrades and defences. Be the last base standing.",
        briefing: ["The plateau is ours if we can hold it.", "Every few seconds you get another squad. Every kill pays.", "Four gates, four commanders, one centre. Last one standing takes it all."],
        notes: ["The spawn rate is the difficulty knob: raise `every` for a slower game.", "Kill score per unit is roughly its cost, so a Zergling pays half what a Marine does."],
      },
    };
  },

  agent(input) {
    const messages = input.messages;
    const last = messages[messages.length - 1];
    const results = last.content.filter((c) => c.type === "tool_result");
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const calls = lastAssistant?.content.filter((c) => c.type === "tool_use") ?? [];
    // A layout conversation: lay lanes out, check the walk from a spawn to the goal, then the game's rules.
    const asked = String(messages[0]?.content?.[0]?.text ?? messages[0]?.content ?? "");
    if (/lane|defense|preset/i.test(asked)) {
      const done = new Set(messages.flatMap((m) => m.role === "assistant" ? m.content.filter((c) => c.type === "tool_use").map((c) => c.name) : []));
      const step = (text, id, name, input) => ({ cost: 0.02, inputTokens: 7200, outputTokens: 140, text, tools: [{ id, name }], output: { stopReason: "tool_use", content: [{ type: "text", text }, { type: "tool_use", id, name, input }] } });
      if (!done.has("layout_preset")) return step("Two lanes with cliff walls, then I'll check the walk and the rules.", "toolu_11", "layout_preset", { preset: "lanes", params: { lanes: "2", wall: "cliff", bends: "yes" } });
      if (!done.has("reachable")) return step("Laid out. Checking that a unit can walk from Spawn 1 to the Goal.", "toolu_12", "reachable", { fromLocation: "Spawn 1", toLocation: "Goal" });
      if (!done.has("scenario_rules")) return step("The lane is joined. Now the game's own rules.", "toolu_13", "scenario_rules", { fix: true });
      const text = "Done. Two cliff-walled lanes from the north spawns to the south goal, a yard and a hire pad per player; Spawn 1 reaches the Goal on foot, and every player owns something. Add the waves with ums_build when you are ready.";
      return { cost: 0.01, inputTokens: 7600, outputTokens: 90, text, output: { stopReason: "end_turn", content: [{ type: "text", text }] } };
    }
    // Turn one: look for Player 1's start location.
    if (!results.length) {
      return {
        cost: 0.02, inputTokens: 7100, outputTokens: 120,
        text: "I'll find Player 1's start location first, then put the squad beside it.",
        tools: [{ id: "toolu_01", name: "list_units" }],
        output: { stopReason: "tool_use", content: [
          { type: "text", text: "I'll find Player 1's start location first, then put the squad beside it." },
          { type: "tool_use", id: "toolu_01", name: "list_units", input: { owner: 1, name: "Start Location" } },
        ] },
      };
    }
    // Turn two: the start location came back; place the units to its south-east.
    if (calls.some((c) => c.name === "list_units")) {
      let x = 20, y = 20;
      try { const r = JSON.parse(String(results[0].content)); if (r.units?.[0]) { x = r.units[0].x; y = r.units[0].y; } } catch { /* keep the fallback */ }
      const units = [
        { unit: "Terran Marine", player: 1, x: x + 4, y: y + 3 }, { unit: "Terran Marine", player: 1, x: x + 5, y: y + 3 },
        { unit: "Terran Marine", player: 1, x: x + 4, y: y + 4 }, { unit: "Terran Marine", player: 1, x: x + 5, y: y + 4 },
        { unit: "Terran Siege Tank (Tank Mode)", player: 1, x: x + 7, y: y + 4 },
      ];
      const text = `Player 1 starts at tile ${x}, ${y}. Placing four Marines and a Siege Tank just south-east of it, clear of the mineral line.`;
      return {
        cost: 0.02, inputTokens: 7400, outputTokens: 260, text,
        tools: [{ id: "toolu_02", name: "place_units" }],
        output: { stopReason: "tool_use", content: [{ type: "text", text }, { type: "tool_use", id: "toolu_02", name: "place_units", input: { units } }] },
      };
    }
    // Turn three: done.
    const text = "Done. Player 1 has four Terran Marines in a block and a Siege Tank on their right flank, south-east of the start location. The placement is one undo step, labelled \"AI: place_units\".\n\nWant the same for the other players, or a different mix?";
    return { cost: 0.01, inputTokens: 7600, outputTokens: 90, text, output: { stopReason: "end_turn", content: [{ type: "text", text }] } };
  },
};
