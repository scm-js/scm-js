/** `scmjs replay info`: who played, on what, for how long, from the replay's header, commands and its copy of the map. */
import { parseScenario, MAP_VERSIONS, mapVersionOf, tilesetIndex } from "../../src/formats/chk/scenario";
import { TILESETS } from "../../src/data/tilesets";
import { FRAME_MS, type ModTag, type Replay } from "@scm-js/replay";
import { normalizeRaces, type DataSetRace } from "../../src/formats/mod/races";
import type { Input } from "./files";
import { msg, t, translate } from "./i18n";
import { printBuilds, type NamesFrom, type PlayerBuilds } from "./replaymod";
import { dot, duration, gameText, num, pc, rgb, rows, size, table, truecolor } from "./ui";

// English in the report (`--json`), shown through `translate`.
const RACES = [msg("Zerg"), msg("Terran"), msg("Protoss")];
export const GAME_TYPES: Record<number, string> = {
  2: msg("Melee"), 3: msg("Free For All"), 4: msg("One on One"), 5: msg("Capture The Flag"), 6: msg("Greed"), 7: msg("Slaughter"), 8: msg("Sudden Death"),
  9: msg("Ladder"), 10: msg("Use Map Settings"), 11: msg("Team Melee"), 12: msg("Team Free For All"), 13: msg("Team Capture The Flag"), 15: msg("Top vs Bottom"),
};
const SPEEDS = [msg("Slowest"), msg("Slower"), msg("Slow"), msg("Normal"), msg("Fast"), msg("Faster"), msg("Fastest")];
const FORMATS = { legacy: msg("1.16 or earlier"), "1.18": msg("Remastered (1.18 to 1.20)"), "1.21": msg("Remastered (1.21 or later)") };

export interface ReplayReport {
  /** The path as it was typed (an entry that failed is `{ file: <path>, error }`, its `file` the same path). */
  path: string;
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
  /**
   * `race` is the race's name: Zerg, Terran or Protoss, a race the mod adds as the replay's tag (or the mod named with
   * `--mod`) declares it, else `Race {n}`. `raceId` is the race byte as the replay holds it.
   */
  players: { name: string; race: string; raceId: number; computer: boolean; team: number; color: string; commands: number; apm: number }[];
  chat: number;
  /** The mod the game was played with, as the replay's SCMJ section says; null for the game itself. */
  mod: ModTag | null;
  /** With `--mod` or `--builds`: where the names came from. */
  names?: NamesFrom;
  /** With `--builds`: what each player ordered. */
  builds?: PlayerBuilds[];
}

/**
 * A player's race by its byte: the game's three by name, then a race the replay's tag declares, then one `races`
 * declares (the mod named with `--mod`), else `Race {n}` (English, as the report is).
 */
export function replayRaceName(race: number, tag: ModTag | null, races: readonly DataSetRace[] = []): string {
  return RACES[race] ?? normalizeRaces(tag?.dataSet.races).find((r) => r.id === race)?.name ?? races.find((r) => r.id === race)?.name ?? `Race ${race}`;
}

/** A race in the matchup (`ZvA`): the game's letter, a declared race's letter (else its name's first), else `?`. */
function matchupLetter(race: number, name: string, tag: ModTag | null, races: readonly DataSetRace[]): string {
  if (race >= 0 && race < 3) return name[0];
  const declared = normalizeRaces(tag?.dataSet.races).find((r) => r.id === race) ?? races.find((r) => r.id === race);
  return declared ? (declared.letter ?? declared.name[0]).toUpperCase() : "?";
}

export function replayReport(input: Input, rep: Replay, races: readonly DataSetRace[] = []): ReplayReport {
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
    path: input.path,
    file: { name: input.name, bytes: input.bytes.length },
    format: FORMATS[rep.format], engine: h.engine === 1 ? "Brood War" : "StarCraft",
    // (a replay the engine wrote has no real time in it — a second past 1970 —, which is no time a game was played)
    started: h.started && h.started.getUTCFullYear() >= 1998 ? h.started.toISOString() : null, frames: h.frames, ms,
    speed: SPEEDS[h.speed] ?? `Speed ${h.speed}`, gameType: GAME_TYPES[h.gameType] ?? `Type ${h.gameType}`,
    title: h.title, host: h.host, map,
    players: rep.players.map((p) => {
      const commands = actions.get(p.id) ?? 0, end = left.get(p.id) ?? frames;
      return { name: p.name, race: replayRaceName(p.race, rep.mod, races), raceId: p.race, computer: p.type === 1, team: p.team, color: p.color, commands, apm: end > 0 ? Math.round(commands / ((end * FRAME_MS) / 60000)) : 0 };
    }),
    chat,
    mod: rep.mod,
  };
}

/** `2013-01-12 18:25`, in this machine's time zone. */
function localTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A race as shown: a game's race in the language in use, a mod's as it declares it, else "Race {n}" translated. */
const raceShown = (p: ReplayReport["players"][number]) => (p.race === `Race ${p.raceId}` ? t("Race {n}", { n: p.raceId }) : translate(p.race));

/** `races`: those the mod named with `--mod` declares, for the matchup's letters. */
export function printReplayInfo(r: ReplayReport, races: readonly DataSetRace[] = []): string[] {
  const teams = new Set(r.players.map((p) => p.team));
  const matchup = teams.size > 1 && teams.size <= 4
    ? [...teams].map((t) => r.players.filter((p) => p.team === t).map((p) => matchupLetter(p.raceId, p.race, r.mod, races)).join("")).join("v")
    : null;
  const when = r.started ? new Date(r.started) : null;
  // (sides of more than one player, as a team game has them: "A & B vs C & D"; else each player a side)
  const sides = teams.size > 1 && teams.size < r.players.length ? [...teams].map((t) => r.players.filter((p) => p.team === t)) : r.players.map((p) => [p]);
  return [
    pc.bold(sides.map((side) => side.map((p) => rgb(p.color, gameText(p.name))).join(pc.dim(" & "))).join(pc.dim(" vs "))) + (matchup ? pc.dim(`  ${matchup}`) : ""),
    pc.dim(t("{type} on {map}", { type: translate(r.gameType), map: gameText(r.map.name) })),
    "",
    ...rows([
      [t("Length"), `${duration(r.ms)}${dot}${t("{n} frames", { n: num(r.frames) })}${dot}${translate(r.speed)}`],
      [t("Played"), when ? localTime(when) : null],
      [t("Map"), `${gameText(r.map.name)}${dot}${r.map.width} × ${r.map.height}${r.map.tileset ? dot + translate(r.map.tileset) : ""}`],
      [t("Game"), `${gameText(r.title)}${r.host ? pc.dim(` ${t("hosted by {host}", { host: gameText(r.host) })}`) : ""}`],
      [t("Recorded by"), `${translate(r.engine)}${dot}${translate(r.format)}`],
      [t("Mod"), r.mod ? `${gameText(r.mod.dataSet.name) || pc.italic(t("unnamed"))}${dot}${r.mod.dataSet.hash}${r.mod.dataSet.url ? dot + r.mod.dataSet.url : ""}` : pc.dim(t("none"))],
      [t("Plugins"), r.mod ? (r.mod.noplugins ? pc.dim(t("none: played without them")) : [...r.mod.plugins.map((p) => p.name), ...(r.mod.firegraft ? [r.mod.firegraft.name] : [])].join(", ") || pc.dim(t("none"))) : null],
      // (the same data set only where the replay names its mod and the mod named matched it; an untagged replay was warned of)
      [t("Names"), r.names?.kind === "mod" ? (r.mod ? t("from {mod}, the same data set", { mod: r.names.name ?? "" }) : t("from {mod}", { mod: r.names.name ?? "" })) : null],
      [t("File"), `${r.file.name}${dot}${size(r.file.bytes)}`],
      [t("Chat"), r.chat ? t("{n, plural, one {# line} other {# lines}}", { n: r.chat }) : null],
    ]),
    "",
    pc.dim(`  ${t("Players")}`),
    ...table(r.players.map((p) => [
      (truecolor ? rgb(p.color, "■") + " " : "") + gameText(p.name), raceShown(p), p.computer ? pc.dim(t("computer")) : `${num(p.apm)} APM`, teams.size > 1 ? pc.dim(t("team {n}", { n: p.team })) : "",
    ])),
    ...(r.builds && r.names ? printBuilds(r.builds, r.names, r.mod) : []),
  ];
}
