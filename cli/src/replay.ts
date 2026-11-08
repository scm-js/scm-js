/** `scmjs replay info`: who played, on what, for how long, from the replay's header, commands and its copy of the map. */
import { parseScenario, MAP_VERSIONS, mapVersionOf, tilesetIndex } from "../../src/formats/chk/scenario";
import { TILESETS } from "../../src/data/tilesets";
import { FRAME_MS, type Replay } from "@scm-js/replay";
import type { Input } from "./files";
import { dot, duration, gameText, num, pc, rgb, rows, size, table, truecolor } from "./ui";

const RACES = ["Zerg", "Terran", "Protoss"];
export const GAME_TYPES: Record<number, string> = {
  2: "Melee", 3: "Free For All", 4: "One on One", 5: "Capture The Flag", 6: "Greed", 7: "Slaughter", 8: "Sudden Death",
  9: "Ladder", 10: "Use Map Settings", 11: "Team Melee", 12: "Team Free For All", 13: "Team Capture The Flag", 15: "Top vs Bottom",
};
const SPEEDS = ["Slowest", "Slower", "Slow", "Normal", "Fast", "Faster", "Fastest"];
const FORMATS = { legacy: "1.16 or earlier", "1.18": "Remastered (1.18 to 1.20)", "1.21": "Remastered (1.21 or later)" };

export interface ReplayReport {
  file: { name: string; bytes: number };
  format: string;
  engine: "StarCraft" | "Brood War";
  started: string | null;
  frames: number;
  ms: number;
  speed: string;
  gameType: string;
  title: string;
  host: string;
  map: { name: string; width: number; height: number; tileset: string | null; version: string | null };
  players: { name: string; race: string; computer: boolean; team: number; color: string; commands: number; apm: number }[];
  chat: number;
}

export function replayReport(input: Input, rep: Replay): ReplayReport {
  const h = rep.header, ms = h.frames * FRAME_MS;
  // APM as Aftermath counts it (analysis.ts): what a player does in the game, not talk, leaving or the session's
  // traffic, over the time until they left.
  const actions = new Map<number, number>(), left = new Map<number, number>();
  const frames = Math.max(h.frames, rep.commands.at(-1)?.frame ?? 0);
  let chat = 0;
  for (const c of rep.commands) {
    if (c.kind === "chat") chat++;
    else if (c.kind === "leave") { if (!left.has(c.player)) left.set(c.player, c.frame); }
    else if (c.kind !== "system") actions.set(c.player, (actions.get(c.player) ?? 0) + 1);
  }
  let map: ReplayReport["map"] = { name: h.mapName, width: h.mapWidth, height: h.mapHeight, tileset: null, version: null };
  try {
    const scn = parseScenario(rep.chk);
    map = { ...map, width: scn.width, height: scn.height, tileset: TILESETS[tilesetIndex(scn)]?.name ?? null, version: MAP_VERSIONS[mapVersionOf(scn.fileVersion)].label };
  } catch { /* the header's own size stands */ }
  return {
    file: { name: input.name, bytes: input.bytes.length },
    format: FORMATS[rep.format], engine: h.engine === 1 ? "Brood War" : "StarCraft",
    started: h.started ? h.started.toISOString() : null, frames: h.frames, ms,
    speed: SPEEDS[h.speed] ?? `Speed ${h.speed}`, gameType: GAME_TYPES[h.gameType] ?? `Type ${h.gameType}`,
    title: h.title, host: h.host, map,
    players: rep.players.map((p) => {
      const commands = actions.get(p.id) ?? 0, end = left.get(p.id) ?? frames;
      return { name: p.name, race: RACES[p.race] ?? `Race ${p.race}`, computer: p.type === 1, team: p.team, color: p.color, commands, apm: end > 0 ? Math.round(commands / ((end * FRAME_MS) / 60000)) : 0 };
    }),
    chat,
  };
}

/** `2013-01-12 18:25`, in this machine's time zone. */
function localTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function printReplayInfo(r: ReplayReport): string[] {
  const teams = new Set(r.players.map((p) => p.team));
  const matchup = teams.size > 1 && teams.size <= 4
    ? [...teams].map((t) => r.players.filter((p) => p.team === t).map((p) => p.race[0]).join("")).join("v")
    : null;
  const when = r.started ? new Date(r.started) : null;
  return [
    pc.bold(`${r.players.map((p) => rgb(p.color, gameText(p.name))).join(pc.dim(" vs "))}`) + (matchup ? pc.dim(`  ${matchup}`) : ""),
    pc.dim(`${r.gameType} on ${gameText(r.map.name)}`),
    "",
    ...rows([
      ["Length", `${duration(r.ms)}${dot}${num(r.frames)} frames${dot}${r.speed}`],
      ["Played", when ? localTime(when) : null],
      ["Map", `${gameText(r.map.name)}${dot}${r.map.width} × ${r.map.height}${r.map.tileset ? dot + r.map.tileset : ""}`],
      ["Game", `${gameText(r.title)}${r.host ? pc.dim(` hosted by ${gameText(r.host)}`) : ""}`],
      ["Recorded by", `${r.engine}${dot}${r.format}`],
      ["File", `${r.file.name}${dot}${size(r.file.bytes)}`],
      ["Chat", r.chat ? `${num(r.chat)} lines` : null],
    ]),
    "",
    pc.dim("  Players"),
    ...table(r.players.map((p) => [
      (truecolor ? rgb(p.color, "■") + " " : "") + gameText(p.name), p.race, p.computer ? pc.dim("computer") : `${num(p.apm)} APM`, teams.size > 1 ? pc.dim(`team ${p.team}`) : "",
    ])),
  ];
}
