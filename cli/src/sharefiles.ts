/**
 * `scmjs share <files…>`: `map share` for each map and `replay share` for each replay, a link apiece, the kind read
 * from the file as `scmjs info` reads it. The options are both commands' together; one that fits only maps or only
 * replays is refused when none of the files is of that kind. `--copy` (here and on `map share`, `replay share`) puts
 * the links on the clipboard; `--no-link` keeps the files on the account and links nothing.
 */
import type { OpenedMap } from "../../src/editor/mapFile";
import type { Replay } from "@scm-js/replay";
import { copyToClipboard, type CopyOutcome } from "./clipboard";
import { expectKind, type FileKind, type Input } from "./files";
import { keepReplay, printReplayShare, shareReplay, type ReplayKeepOutcome, type ReplayShareDeps, type ReplayShareOutcome } from "./replayshare";
import { keepMap, printShare, shareMap, type MapKeepOutcome, type ShareDeps, type ShareOutcome } from "./share";
import { t } from "./i18n";
import { CliError } from "./ui";

export interface ShareFilesOptions {
  /** Maps only: the map's name on the account (one map). */
  name?: string;
  note?: string;
  /** Maps only. */
  edit?: boolean;
  /** Maps only, with `edit`. */
  keep?: string;
  /** Maps only. */
  new?: boolean;
  picture?: boolean;
  starcraft?: string;
  /** Replays only: the moment the link opens at. */
  at?: string;
  /** Replays only: the player whoever opens it plays as; `true` lets them choose. */
  play?: string | boolean;
  /** `--no-link`: false keeps each file on the account without a link. */
  link?: boolean;
  /** Read by the command, refused with `link` false. */
  copy?: boolean;
  qr?: boolean;
}

/** A file shared: its link (null kept without one) and what `map share` or `replay share` answers for it. */
export type SharedFile =
  | { file: string; kind: "map"; link: string | null; map: ShareOutcome | MapKeepOutcome }
  | { file: string; kind: "replay"; link: string | null; replay: ReplayShareOutcome | ReplayKeepOutcome };

const MAP_ONLY = [["name", "--name"], ["edit", "--edit"], ["keep", "--keep"], ["new", "--new"]] as const;
const REPLAY_ONLY = [["at", "--at"], ["play", "--play"]] as const;

const given = (v: unknown) => v !== undefined && v !== false;

/**
 * The options against the files' kinds, before anything is sent: one for maps with no map among the files (or for
 * replays with no replay) is a mistake, said with exit 2; so are a link's options with `--no-link`.
 */
export function checkShareOptions(files: { name: string; kind: FileKind | null }[], o: ShareFilesOptions): void {
  const maps = files.filter((f) => f.kind === "map"), replays = files.filter((f) => f.kind === "replay");
  const refuse = (option: string, wanted: "map" | "replay") => {
    const kind = wanted === "map" ? t("a map") : t("a replay");
    throw new CliError(files.length === 1
      ? t("{option} is for {kind}, and {file} is not one", { option, kind, file: files[0].name })
      : t("{option} is for {kind}, and none of these files is one", { option, kind }), wanted === "map" ? t("--name, --edit, --keep and --new are for maps; --at and --play for replays.") : t("--at and --play are for replays; --name, --edit, --keep and --new for maps."), 2);
  };
  for (const [key, option] of MAP_ONLY) if (given(o[key]) && !maps.length) refuse(option, "map");
  for (const [key, option] of REPLAY_ONLY) if (given(o[key]) && !replays.length) refuse(option, "replay");
  if (o.name !== undefined && maps.length > 1) throw new CliError(t("--name names one map, and {n} are given", { n: maps.length }), t("Share the maps one at a time to name each."), 2);
  if (o.link === false) {
    const linkOnly = [o.edit && "--edit", o.keep !== undefined && "--keep", o.at !== undefined && "--at", given(o.play) && "--play", o.copy && "--copy", o.qr && "--qr"].filter(Boolean) as string[];
    if (linkOnly.length) throw new CliError(linkOnly.length === 1 ? t("{option} is for a link, and --no-link makes none", { option: linkOnly[0] }) : t("{options} are for a link, and --no-link makes none", { options: linkOnly.join(", ") }), t("Leave --no-link off for a link."), 2);
  }
}

/** One file shared (or kept, with `link` false) by its kind; the options that fit the other kind are left out. */
export async function shareFile(input: Input, opened: OpenedMap | Replay, o: ShareFilesOptions, deps: ShareDeps & ReplayShareDeps = {}): Promise<SharedFile> {
  const kind = expectKind(input, "map", "replay");
  const common = { note: o.note, picture: o.picture, starcraft: o.starcraft };
  if (kind === "map") {
    const mo = { ...common, name: o.name, edit: o.edit, keep: o.keep, new: o.new };
    const r = o.link === false ? await keepMap(input, opened as OpenedMap, mo, deps) : await shareMap(input, opened as OpenedMap, mo, deps);
    return { file: input.path, kind: "map", link: r.link, map: r };
  }
  const ro = { ...common, at: o.at, play: o.play };
  const r = o.link === false ? await keepReplay(input, opened as Replay, ro, deps) : await shareReplay(input, opened as Replay, ro, deps);
  return { file: input.path, kind: "replay", link: r.link, replay: r };
}

/** A shared file's lines: `map share`'s or `replay share`'s. */
export const printSharedFile = (r: SharedFile): string[] => (r.kind === "map" ? printShare(r.map) : printReplayShare(r.replay));

/** The links to the clipboard, one a line; null when there is none to copy. */
export async function copyLinks(links: (string | null)[], copy: typeof copyToClipboard = copyToClipboard): Promise<CopyOutcome | null> {
  const some = links.filter((l): l is string => !!l);
  return some.length ? copy(some.join("\n")) : null;
}
