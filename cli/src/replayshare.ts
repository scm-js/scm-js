/**
 * `scmjs replay share game.rep`: the replay stored on the person's scmjs.dev account and a link to it —
 * `https://scmjs.dev/replay/<token>`, which anyone opens to watch it in the editor's analysis, with a card where links
 * get one. One upload (`POST /v1/replays` with `link=1`) answers with the replay's facts and its link; the same bytes
 * shared again give the link that is there. The map's picture, for the card, is drawn from the map the replay carries
 * when a copy of the game is at hand, as `map share` draws a map's.
 *
 * A moment (`--at 6:42`, `--play <player>`) is the link's own query, as the analysis's Share makes it: `?t=6:42` opens
 * the replay there, paused, and `play=<slot>` sends whoever opens it to the play page to play on from there as that
 * player (the game's own slot, as Play From Here hands it over; `play` with no value lets them choose). The replay's
 * one link carries any moment, so sharing it again at another time stores nothing and makes no second link.
 * `--no-link` keeps the replay on the account without one (no `link=1`).
 */
import type { Replay } from "@scm-js/replay";
import { parseScenario } from "../../src/formats/chk/scenario";
import { Client, linkTo, requireSession, serverUrl, sessionPath, type StorageView } from "./account";
import { findGameCopy } from "./engine";
import type { Input } from "./files";
import { openGameFiles } from "./gamefiles";
import { loadGraphics, previewPng } from "./preview";
import { t } from "./i18n";
import { CliError, duration, gameText, pc, size } from "./ui";

/** A frame is 42 ms at Fastest. */
const FRAME_MS = 42;

/** What the server knows of a replay: the header's facts, as `GET /v1/replays/:id` answers. */
export interface ReplayView {
  id: string; fileName: string; note: string; sizeBytes: number; uploadedAt: string;
  mapName: string; mapWidth: number; mapHeight: number;
  players: { name: string; race: "zerg" | "terran" | "protoss" | null; team: number; color: string }[];
  matchup: string; frames: number; durationSec: number; gameTypeName: string; playedAt: string | null; format: string;
  links: { token: string; opens?: number }[];
}
export interface ReplayShareOptions {
  note?: string;
  picture?: boolean;
  starcraft?: string;
  /** `--at`: the moment the link opens at, `m:ss`, `h:mm:ss` or seconds. */
  at?: string;
  /** `--play`: the player whoever opens the link plays as, a slot or a name; `true` (no value) lets them choose. */
  play?: string | boolean;
  /** `--no-link`: false keeps the replay on the account without a link (`keepReplay`). */
  link?: boolean;
}
export interface ReplayShareDeps { server?: string; file?: string; fetchImpl?: typeof fetch }
export interface ReplayShareOutcome {
  link: string;
  /** The moment the link opens at and who plays, when `at` or `play` asked for one. */
  moment?: ReplayMoment;
  replay: { id: string; fileName: string; mapName: string; matchup: string; players: string[]; durationSec: number; gameType: string; playedAt: string | null; bytes: number };
  /** Whether the bytes were already on the account. */
  existing: boolean;
  picture: { bytes: number } | { none: string };
  storage?: StorageView;
}

/** A replay kept on the account without a link (`--no-link`): what `shareReplay` answers, less the link. */
export type ReplayKeepOutcome = Omit<ReplayShareOutcome, "link" | "moment"> & { link: null };

/** A player whoever opens a link may play as: the game's own slot and the name as the replay has it. */
export interface MomentPlayer { slot: number; name: string }

/** Where a replay link opens, and who plays. */
export interface ReplayMoment {
  /** The time as the link writes it (`6:42`, `1:02:03`); null for the start. */
  t: string | null;
  seconds: number;
  /** The frame the analysis and the play page open at: the first whose clock reads the time, `ceil(seconds * 1000 / 42)`. */
  frame: number;
  /** The player whoever opens it plays as; `choose`: they pick one; null: they watch. */
  play: MomentPlayer | "choose" | null;
}

/** `m:ss`, `h:mm:ss` or a whole number of seconds, in seconds; a CliError naming the option for anything else. */
export function parseMomentTime(spec: string, option = "--at"): number {
  const v = spec.trim();
  if (/^\d+$/.test(v)) return Number(v);
  const parts = v.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) throw new CliError(t("{option} takes m:ss, h:mm:ss or seconds, not \"{spec}\"", { option, spec }), t("--at 6:42 opens the replay at 6 minutes 42 seconds of game time."), 2);
  // (1:75 is a slip, not 2:15)
  if (parts.slice(1).some((p) => Number(p) > 59)) throw new CliError(t("{option}: \"{spec}\" is not a time: its seconds and minutes run from 00 to 59", { option, spec }), null, 2);
  return parts.reduce((n, p) => n * 60 + Number(p), 0);
}

/** The players a link may name to play as: those who played (not observers or empty slots), by the play page's rule. */
export const playersOf = (rep: Replay): MomentPlayer[] =>
  rep.players.filter((p) => [1, 2, 5, 6].includes(p.type)).map((p) => ({ slot: p.slot, name: p.name.replace(/[\x00-\x1f]/g, "").trim() || t("Player {n}", { n: p.slot + 1 }) }));

/** The player `who` names: the game's slot number, or a name (case aside), whole or the start of only one. */
export function pickMomentPlayer(players: readonly MomentPlayer[], who: string, file: string): MomentPlayer {
  const w = who.trim();
  const list = players.map((p) => `${p.slot} ${gameText(p.name)}`).join(", ");
  const hint = players.length ? t("Its players, by slot: {list}.", { list }) : t("The replay names no players.");
  if (/^\d+$/.test(w)) {
    const bySlot = players.find((p) => p.slot === Number(w));
    if (bySlot) return bySlot;
    throw new CliError(t("--play {who}: no player of {file} is in slot {who}", { who: w, file }), hint, 2);
  }
  const name = w.toLowerCase();
  const exact = players.filter((p) => p.name.toLowerCase() === name);
  const start = players.filter((p) => p.name.toLowerCase().startsWith(name));
  const found = exact.length === 1 ? exact[0] : !exact.length && start.length === 1 ? start[0] : null;
  if (found && name) return found;
  throw new CliError(exact.length > 1 || start.length > 1 ? t("--play {who} is more than one player of {file}", { who: w, file }) : t("--play {who} is nobody in {file}", { who: w, file }), hint, 2);
}

/**
 * The moment `--at` and `--play` ask for, checked against the replay: a time past its end, or a player it does not
 * have, is a CliError naming what there is. Null when neither was given. `--play` alone plays on from the start.
 */
export function replayMoment(rep: Replay, o: { at?: string; play?: string | boolean }, file: string): ReplayMoment | null {
  if (o.at === undefined && (o.play === undefined || o.play === false)) return null;
  const seconds = o.at === undefined ? 0 : parseMomentTime(o.at);
  const frames = rep.header.frames;
  const frame = Math.ceil((seconds * 1000) / FRAME_MS);
  if (frame > frames) {
    const length = duration(Math.floor((frames * FRAME_MS) / 1000) * 1000);
    throw new CliError(t("--at {at} is past the end of {file}, which is {length} long", { at: o.at!.trim(), file, length }), t("A time from 0:00 to {length}.", { length }), 2);
  }
  const play = o.play === undefined || o.play === false ? null : o.play === true ? "choose" : pickMomentPlayer(playersOf(rep), o.play, file);
  return { t: seconds ? duration(seconds * 1000) : null, seconds, frame, play };
}

/** A replay link with its moment: `?t=6:42`, `&play=<slot>`, or `play` alone for the person to choose; after any query the link has. */
export function withMoment(link: string, moment: ReplayMoment | null): string {
  if (!moment) return link;
  const params = [moment.t ? `t=${moment.t}` : "", moment.play === null ? "" : moment.play === "choose" ? "play" : `play=${moment.play.slot}`].filter(Boolean);
  return params.length ? `${link}${link.includes("?") ? "&" : "?"}${params.join("&")}` : link;
}

/** The map's picture for the card, from the map the replay carries; none without a copy of the game. */
export async function replayPicture(rep: Replay, starcraft: string | undefined): Promise<{ picture: Uint8Array | null; none?: string }> {
  try { findGameCopy(starcraft); } catch (e) {
    if (e instanceof CliError && !starcraft) return { picture: null, none: t("no copy of StarCraft here to draw it with") };
    throw e;
  }
  try {
    const scn = parseScenario(rep.chk);
    const graphics = await loadGraphics(scn, await openGameFiles(starcraft));
    const perTile = Math.max(1, Math.min(8, Math.floor(512 / Math.max(scn.width, scn.height, 1))));
    for (let width = perTile * scn.width; width >= Math.min(scn.width, 128); width = Math.floor(width / 2)) {
      const { png } = previewPng(scn, graphics, { width, marks: true });
      if (png.length <= 900_000) return { picture: png };
    }
    return { picture: null, none: t("the picture came out larger than the server takes") };
  } catch (e) {
    if (e instanceof CliError) return { picture: null, none: e.message };
    return { picture: null, none: t("the replay's map could not be drawn ({reason})", { reason: String(e instanceof Error ? e.message : e) }) };
  }
}

/** The upload: with `link=1` when a link is wanted, the server's answer as it came. */
async function upload(input: Input, rep: Replay, o: ReplayShareOptions, deps: ReplayShareDeps, link: boolean) {
  const server = (deps.server ?? serverUrl()).replace(/\/+$/, "");
  const session = requireSession(server, deps.file ?? sessionPath());
  const client = new Client({ server, session: session.session, fetchImpl: deps.fetchImpl });
  const fileName = /\.rep$/i.test(input.name) ? input.name : `${input.name.replace(/^stdin$/, "replay")}.rep`;
  const pics = o.picture === false ? { picture: null, none: t("left out with --no-picture") } : await replayPicture(rep, o.starcraft);
  const form = new FormData();
  form.append("file", new Blob([input.bytes as BlobPart], { type: "application/octet-stream" }), fileName);
  form.append("fileName", fileName);
  if (o.note) form.append("note", o.note);
  if (link) form.append("link", "1");
  if (pics.picture) form.append("picture", new Blob([pics.picture as BlobPart], { type: "image/png" }), "picture.png");
  const r = await client.request<{ replay: ReplayView; storage?: StorageView; link?: { token: string }; existing?: boolean }>("POST", "/v1/replays", form, { timeoutMs: 120_000 });
  return {
    server, r,
    out: {
      replay: { id: r.replay.id, fileName: r.replay.fileName, mapName: r.replay.mapName, matchup: r.replay.matchup, players: r.replay.players.map((p) => p.name), durationSec: r.replay.durationSec, gameType: r.replay.gameTypeName, playedAt: r.replay.playedAt, bytes: r.replay.sizeBytes },
      existing: !!r.existing,
      picture: pics.picture ? { bytes: pics.picture.length } : { none: pics.none ?? t("none") },
      ...(r.storage ? { storage: r.storage } : {}),
    },
  };
}

/**
 * The replay on the account and its link, at the moment `o.at` / `o.play` ask for (checked against the replay before
 * anything is sent). `o.link` false is refused here: `keepReplay` is that.
 */
export async function shareReplay(input: Input, rep: Replay, o: ReplayShareOptions = {}, deps: ReplayShareDeps = {}): Promise<ReplayShareOutcome> {
  if (o.link === false) throw new CliError(t("--no-link keeps the replay without a link"), t("Leave --no-link off for a link."), 2);
  const moment = replayMoment(rep, o, input.name);
  const { server, r, out } = await upload(input, rep, o, deps, true);
  const token = r.link?.token ?? r.replay.links[0]?.token;
  if (!token) throw new CliError(t("The server stored the replay but gave no link"), t("Make one in My Maps ▸ Replays, or try again."));
  return { link: withMoment(linkTo("replay", token, server), moment), ...(moment ? { moment } : {}), ...out };
}

/** `--no-link`: the replay kept on the account, no link made (a moment needs a link, so `at` and `play` are refused). */
export async function keepReplay(input: Input, rep: Replay, o: ReplayShareOptions = {}, deps: ReplayShareDeps = {}): Promise<ReplayKeepOutcome> {
  if (o.at !== undefined || (o.play !== undefined && o.play !== false)) throw new CliError(t("--at and --play are a link's: --no-link makes none"), t("Leave --no-link off for a link that opens at a moment."), 2);
  const { out } = await upload(input, rep, o, deps, false);
  return { link: null, ...out };
}

/** What the link does for whoever opens it, at its moment. */
function linkDoes(m: ReplayMoment | undefined): string {
  if (!m || m.play === null) return m?.t ? t("Anyone with the link watches it from {time} in the editor, without signing in.", { time: m.t }) : t("Anyone with the link watches it in the editor, without signing in.");
  if (m.play === "choose") return m.t ? t("Anyone with the link picks a player and plays on from {time} on the play page, with their own copy of StarCraft.", { time: m.t }) : t("Anyone with the link picks a player and plays it from the start on the play page, with their own copy of StarCraft.");
  return m.t ? t("Anyone with the link plays on from {time} as {name} on the play page, with their own copy of StarCraft.", { time: m.t, name: gameText(m.play.name) }) : t("Anyone with the link plays it from the start as {name} on the play page, with their own copy of StarCraft.", { name: gameText(m.play.name) });
}

/** The lines: the link first, alone, then what the replay is; kept without a link, what it is and that nothing was linked. */
export function printReplayShare(r: ReplayShareOutcome | ReplayKeepOutcome): string[] {
  const facts = [gameText(r.replay.mapName) || t("Untitled"), r.replay.matchup, r.replay.players.map(gameText).join(" vs "), duration(r.replay.durationSec * 1000), size(r.replay.bytes)].filter(Boolean);
  const where = r.existing ? t("already on your account") : t("stored on your account");
  if (r.link === null) return [`${facts.join(" · ")} · ${where}`, pc.dim(t("Not linked: nothing was made for anyone to open. scmjs replay share gives it a link."))];
  return [r.link, `${facts.join(" · ")} · ${where}`,
    pc.dim(`${linkDoes((r as ReplayShareOutcome).moment)}${"none" in r.picture ? ` ${t("No map picture for its card: {why}.", { why: r.picture.none })}` : ""}`)];
}
