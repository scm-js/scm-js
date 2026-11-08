/**
 * `scmjs replay share game.rep`: the replay stored on the person's scmjs.dev account and a link to it —
 * `https://scmjs.dev/editor/replay/<token>`, which anyone opens to watch it in the editor's replay viewer, with a
 * card where links get one. One upload (`POST /v1/replays` with `link=1`) answers with the replay's facts and its
 * link; the same bytes shared again give the link that is there. The map's picture, for the card, is drawn from the
 * map the replay carries when a copy of the game is at hand, as `map share` draws a map's.
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

/** What the server knows of a replay: the header's facts, as `GET /v1/replays/:id` answers. */
export interface ReplayView {
  id: string; fileName: string; note: string; sizeBytes: number; uploadedAt: string;
  mapName: string; mapWidth: number; mapHeight: number;
  players: { name: string; race: "zerg" | "terran" | "protoss" | null; team: number; color: string }[];
  matchup: string; frames: number; durationSec: number; gameTypeName: string; playedAt: string | null; format: string;
  links: { token: string; opens?: number }[];
}
export interface ReplayShareOptions { note?: string; picture?: boolean; starcraft?: string }
export interface ReplayShareDeps { server?: string; file?: string; fetchImpl?: typeof fetch }
export interface ReplayShareOutcome {
  link: string;
  replay: { id: string; fileName: string; mapName: string; matchup: string; players: string[]; durationSec: number; gameType: string; playedAt: string | null; bytes: number };
  /** Whether the bytes were already on the account. */
  existing: boolean;
  picture: { bytes: number } | { none: string };
  storage?: StorageView;
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

export async function shareReplay(input: Input, rep: Replay, o: ReplayShareOptions = {}, deps: ReplayShareDeps = {}): Promise<ReplayShareOutcome> {
  const server = (deps.server ?? serverUrl()).replace(/\/+$/, "");
  const session = requireSession(server, deps.file ?? sessionPath());
  const client = new Client({ server, session: session.session, fetchImpl: deps.fetchImpl });
  const fileName = /\.rep$/i.test(input.name) ? input.name : `${input.name.replace(/^stdin$/, "replay")}.rep`;
  const pics = o.picture === false ? { picture: null, none: t("left out with --no-picture") } : await replayPicture(rep, o.starcraft);
  const form = new FormData();
  form.append("file", new Blob([input.bytes as BlobPart], { type: "application/octet-stream" }), fileName);
  form.append("fileName", fileName);
  if (o.note) form.append("note", o.note);
  form.append("link", "1");
  if (pics.picture) form.append("picture", new Blob([pics.picture as BlobPart], { type: "image/png" }), "picture.png");
  const r = await client.request<{ replay: ReplayView; storage?: StorageView; link?: { token: string }; existing?: boolean }>("POST", "/v1/replays", form, { timeoutMs: 120_000 });
  const token = r.link?.token ?? r.replay.links[0]?.token;
  if (!token) throw new CliError(t("The server stored the replay but gave no link"), t("Make one in My Maps ▸ Replays, or try again."));
  return {
    link: linkTo("replay", token, server),
    replay: { id: r.replay.id, fileName: r.replay.fileName, mapName: r.replay.mapName, matchup: r.replay.matchup, players: r.replay.players.map((p) => p.name), durationSec: r.replay.durationSec, gameType: r.replay.gameTypeName, playedAt: r.replay.playedAt, bytes: r.replay.sizeBytes },
    existing: !!r.existing,
    picture: pics.picture ? { bytes: pics.picture.length } : { none: pics.none ?? t("none") },
    ...(r.storage ? { storage: r.storage } : {}),
  };
}

/** The lines: the link first, alone, then what the replay is. */
export function printReplayShare(r: ReplayShareOutcome): string[] {
  const facts = [gameText(r.replay.mapName) || t("Untitled"), r.replay.matchup, r.replay.players.map(gameText).join(" vs "), duration(r.replay.durationSec * 1000), size(r.replay.bytes)].filter(Boolean);
  return [r.link, `${facts.join(" · ")} · ${r.existing ? t("already on your account") : t("stored on your account")}`,
    pc.dim(`${t("Anyone with the link watches it in the editor, without signing in.")}${"none" in r.picture ? ` ${t("No map picture for its card: {why}.", { why: r.picture.none })}` : ""}`)];
}
