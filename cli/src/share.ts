/**
 * `scmjs map share <map> [--edit]`: the editor's Account ▸ Copy Link to This Map… and Account ▸ Share this Map…, from a
 * file. A copy link stores the map on the account (`POST /v1/maps`, or a revision of the map with the same file name)
 * and links that revision (`POST /v1/maps/:id/links`); an edit link opens a shared-editing room on it
 * (`POST /v1/rooms`), kept open with `--keep`. A picture for the link's card is drawn with the copy of the game when
 * there is one; without, the map goes up without (the server makes no card then, and the link still opens).
 */
import { createHash } from "node:crypto";
import type { OpenedMap } from "../../src/editor/mapFile";
import { writeArchiveBytes } from "../../src/editor/mapFile";
import { Client, keepWords, linkTo, requireSession, serverUrl, sessionPath, type KeepDays, type StorageView } from "./account";
import { findGameCopy } from "./engine";
import type { Input } from "./files";
import { STDIO } from "./files";
import { openGameFiles } from "./gamefiles";
import { mapReport } from "./map";
import { loadGraphics, previewPng, tilesetOf } from "./preview";
import { t } from "./i18n";
import { CliError, gameText, pc, size, visible } from "./ui";

/** `--keep`: the editor's *Keep it open…* choices; none is *Until everyone leaves*. */
export const KEEP: Record<string, KeepDays> = { day: 1, week: 7, month: 30, forever: null };

export function parseKeep(keep: string | undefined): KeepDays | undefined {
  if (keep === undefined) return undefined;
  if (!(keep in KEEP)) throw new CliError(t("--keep {keep} is not one of {list}", { keep, list: Object.keys(KEEP).join(", ") }), t("--keep week keeps the map open for a week after its last edit; without --keep it is open until everyone leaves."), 2);
  return KEEP[keep];
}

/** What the server keeps beside a revision for its list (`MapMeta`): all optional, display only. */
export interface MapMeta { scenarioName?: string; description?: string; tileset?: string; width?: number; height?: number; players?: number; humanPlayers?: number; units?: number; triggers?: number; thumbnail?: string }

interface MapRevisionView { number: number; fileName: string; sizeBytes: number; sha256: string; picture?: boolean }
interface MapLinkView { token: string; revision: number | null }
interface MapSummary { id: string; name: string; updatedAt: string; revisions: number; head: MapRevisionView }
interface MapDetail extends MapSummary { history: MapRevisionView[]; linkList: MapLinkView[] }

export interface ShareOptions {
  name?: string;
  note?: string;
  edit?: boolean;
  keep?: string;
  /** A new map even when the account has one with this file name. */
  new?: boolean;
  /** `--no-picture`: false. */
  picture?: boolean;
  starcraft?: string;
}

export interface ShareDeps { server?: string; file?: string; fetchImpl?: typeof fetch }

export interface ShareOutcome {
  kind: "copy" | "edit";
  link: string;
  name: string;
  file: { name: string; bytes: number };
  width: number;
  height: number;
  tileset: string;
  /** A copy link: the stored map and the revision the link opens, and whether this upload made the map, added the revision, or found it there. */
  map?: { id: string; name: string; revision: number; action: "new map" | "new revision" | "unchanged" };
  /** An edit link: how long it stays open (`keepDays` absent: until everyone leaves) and, kept, the stored map it is. */
  room?: { id: string; name: string; keepDays?: KeepDays; endsAt?: string; mapId?: string };
  /** Why there is no picture, when there is none. */
  picture: { bytes: number } | { none: string };
  storage?: StorageView;
}

/** `<scenario name>.scx` for a map from a pipe (`stdin.scx` says nothing), with what a file name may not hold replaced. */
export function shareFileName(input: Input, scenarioName: string): string {
  if (input.path !== STDIO) return input.name;
  const ext = input.name.endsWith(".chk") ? "chk" : "scx";
  const stem = scenarioName.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 80);
  return `${stem || "map"}.${ext}`;
}

/** The map's facts for the server's list, as the plugin's `metaOf` makes them: names without StarCraft's colour bytes. */
export function metaOf(map: OpenedMap, input: Input): { meta: MapMeta; name: string } {
  const r = mapReport(input, map);
  const plain = (s: string) => visible(gameText(s)).replace(/[\x00-\x1f]/g, "").trim();
  const name = plain(r.name);
  const types = map.scenario.playerTypes.slice(0, 8);
  // 1 Computer (game), 2 Occupied, 3 Rescuable, 5 Computer, 6 Human.
  const meta: MapMeta = {
    scenarioName: name.slice(0, 256), tileset: tilesetOf(map.scenario), width: r.width, height: r.height,
    players: types.filter((t) => [1, 2, 3, 5, 6].includes(t)).length,
    humanPlayers: types.filter((t) => t === 2 || t === 6).length,
    units: r.statistics.units.total, triggers: r.statistics.triggers.count,
  };
  const description = plain(r.description);
  if (description) meta.description = description.slice(0, 4000);
  return { meta, name };
}

/**
 * The card's picture (about 512 pixels across, as the editor makes it) and the list's thumbnail (a pixel a tile),
 * drawn with the copy of the game; none, with the reason, when there is no copy or it cannot be read.
 */
export async function picturesOf(map: OpenedMap, starcraft: string | undefined): Promise<{ picture: Uint8Array | null; thumbnail: string | null; none?: string }> {
  try { findGameCopy(starcraft); } catch (e) {
    // (A folder named with --starcraft that is not a copy is said; none found in the usual places is not a problem.)
    if (e instanceof CliError && !starcraft) return { picture: null, thumbnail: null, none: t("no copy of StarCraft here to draw it with") };
    throw e;
  }
  try {
    const graphics = await loadGraphics(map.scenario, await openGameFiles(starcraft));
    const { width: w, height: h } = map.scenario;
    const perTile = Math.max(1, Math.min(8, Math.floor(512 / Math.max(w, h, 1))));
    let picture: Uint8Array | null = null;
    // The server takes up to 1 MB; the plugin's JPEG stays under 900 KB, and so does this PNG, smaller if need be.
    for (let width = perTile * w; width >= Math.min(w, 128); width = Math.floor(width / 2)) {
      const { png } = previewPng(map, graphics, { width });
      if (png.length <= 900_000) { picture = png; break; }
    }
    const thumb = previewPng(map, graphics, { scale: 1 }).png;
    return { picture, thumbnail: thumb.length <= 150_000 ? `data:image/png;base64,${Buffer.from(thumb).toString("base64")}` : null, ...(picture ? {} : { none: t("the picture came out larger than the server takes") }) };
  } catch (e) {
    if (e instanceof CliError) return { picture: null, thumbnail: null, none: e.message };
    throw e;
  }
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** An archive for a shared room (the server takes MPQs only there): a bare `.chk` is packed as a new map would be. */
async function asArchive(input: Input, map: OpenedMap): Promise<Uint8Array> {
  return map.origin ? input.bytes : await writeArchiveBytes(input.bytes, { compression: "pkware", encrypt: true, listfile: true });
}

export async function shareMap(input: Input, map: OpenedMap, o: ShareOptions = {}, deps: ShareDeps = {}): Promise<ShareOutcome> {
  const server = (deps.server ?? serverUrl()).replace(/\/+$/, "");
  const keepDays = parseKeep(o.keep);
  if (keepDays !== undefined && !o.edit) throw new CliError(t("--keep is for --edit"), t("A copy link stays until you remove it in My Maps; --keep says how long a shared-editing link stays open."), 2);
  const session = requireSession(server, deps.file ?? sessionPath());
  const client = new Client({ server, session: session.session, fetchImpl: deps.fetchImpl });
  const { meta, name: scenarioName } = metaOf(map, input);
  const fileName = shareFileName(input, scenarioName);
  const name = (o.name ?? "").trim() || scenarioName || fileName.replace(/\.(scm|scx|chk)$/i, "");
  const note = o.note ?? (o.edit ? "Shared for editing" : "Shared with a link");
  const pics = o.picture === false ? { picture: null, thumbnail: null, none: t("left out with --no-picture") } : await picturesOf(map, o.starcraft);
  if (pics.thumbnail) meta.thumbnail = pics.thumbnail;
  const base = {
    name, file: { name: fileName, bytes: input.bytes.length }, width: map.scenario.width, height: map.scenario.height, tileset: meta.tileset ?? "",
    picture: pics.picture ? { bytes: pics.picture.length } : { none: pics.none ?? t("none") },
  };
  // The account's map with this file name, newest change first: a copy link adds a revision to it, and a kept room is stored as one.
  const same = async (): Promise<MapSummary | null> => {
    if (o.new) return null;
    const list = await client.request<{ maps: MapSummary[] } | null>("GET", "/v1/maps", undefined, { missingOk: true });
    return list?.maps.find((m) => m.head.fileName.toLowerCase() === fileName.toLowerCase()) ?? null;
  };

  if (o.edit) {
    const archive = await asArchive(input, map);
    const kept = keepDays !== undefined;
    const existing = kept ? await same() : null;
    const body = {
      name, map: Buffer.from(archive).toString("base64"),
      ...(kept ? { keepDays, fileName: fileName.replace(/\.chk$/i, ".scx"), note, meta, ...(existing ? { mapId: existing.id } : {}), ...(pics.picture ? { picture: Buffer.from(pics.picture).toString("base64") } : {}) } : {}),
    };
    const r = await client.request<{ room: { id: string; name: string; invite: string; keepDays?: KeepDays; endsAt?: string; mapId?: string }; storage?: StorageView }>("POST", "/v1/rooms", body, { timeoutMs: 120_000 });
    return {
      kind: "edit", link: linkTo("share", r.room.invite, server), ...base,
      room: { id: r.room.id, name: r.room.name, ...(r.room.keepDays !== undefined ? { keepDays: r.room.keepDays } : {}), ...(r.room.endsAt ? { endsAt: r.room.endsAt } : {}), ...(r.room.mapId ? { mapId: r.room.mapId } : {}) },
      ...(r.storage ? { storage: r.storage } : {}),
    };
  }

  const existing = await same();
  let detail: MapDetail;
  let storage: StorageView | undefined;
  let action: "new map" | "new revision" | "unchanged";
  if (existing && existing.head.sha256 === sha256(input.bytes)) {
    // The same bytes as its newest revision: link that one rather than store the file again.
    ({ map: detail, storage } = await client.request<{ map: MapDetail; storage: StorageView }>("GET", `/v1/maps/${encodeURIComponent(existing.id)}`));
    action = "unchanged";
  } else {
    const form = new FormData();
    form.append("file", new Blob([input.bytes as BlobPart], { type: "application/octet-stream" }), fileName);
    form.append("fileName", fileName);
    if (!existing) form.append("name", name);
    form.append("note", note);
    form.append("meta", JSON.stringify(meta));
    if (pics.picture) form.append("picture", new Blob([pics.picture as BlobPart], { type: "image/png" }), "picture.png");
    ({ map: detail, storage } = await client.request<{ map: MapDetail; storage: StorageView }>("POST", existing ? `/v1/maps/${encodeURIComponent(existing.id)}/revisions` : "/v1/maps", form, { timeoutMs: 120_000 }));
    action = existing ? "new revision" : "new map";
  }
  const revision = detail.head.number;
  // A link to this revision already made (an unchanged map shared again) is given again, not made twice.
  const had = action === "unchanged" ? detail.linkList.find((l) => l.revision === revision) : undefined;
  const token = had?.token ?? (await client.request<{ link: MapLinkView; map: MapDetail }>("POST", `/v1/maps/${encodeURIComponent(detail.id)}/links`, { revision })).link.token;
  return { kind: "copy", link: linkTo("map", token, server), ...base, name: detail.name, map: { id: detail.id, name: detail.name, revision, action }, ...(storage ? { storage } : {}) };
}

/** The lines `map share` prints: the link first, alone (so `| head -1` is the link), then what it is. */
export function printShare(r: ShareOutcome): string[] {
  const facts = [r.name, `${r.width} × ${r.height}`, size(r.file.bytes)];
  if (r.kind === "copy" && r.map) {
    const what = r.map.action === "new map" ? t("a new map on your account") : r.map.action === "new revision" ? t("a new revision of {name}", { name: r.map.name }) : t("already on your account as it is");
    return [r.link, `${facts.join(" · ")} · ${t("revision {n}, {what}", { n: r.map.revision, what })}`,
      pc.dim(`${t("Anyone with the link opens a copy in their editor, without signing in.")}${"none" in r.picture ? ` ${t("No picture for its card: {reason}.", { reason: r.picture.none })}` : ""}`)];
  }
  const room = r.room!;
  const open = room.keepDays === undefined
    ? t("open until everyone has left it; if nobody comes, it closes after a while")
    : room.keepDays === null
      ? t("kept open {keep}, stored on your account", { keep: keepWords(room.keepDays) })
      : t("kept open {keep} after its last edit, stored on your account", { keep: keepWords(room.keepDays) });
  return [r.link, `${facts.join(" · ")} · ${t("shared for editing, {open}", { open })}`, pc.dim(t("Anyone with the link edits the map with you in their editor, without signing in."))];
}
