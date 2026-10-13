/**
 * The extraction off the main thread: opens the archives it is handed, runs
 * `extractGameData`, writes the result into the browser's private file storage and
 * reports progress. When there is no such storage here the files are posted back for
 * the main thread to keep for the session (`store.ts#keepInMemory`).
 *
 * A StarCraft: Remastered installation arrives as a folder instead of archives
 * (`remastered.ts`): a directory handle, or the folder's files where the browser has no
 * folder picker. Both can be posted to a worker, and neither is read until asked.
 *
 * After the editor's own files the play set is copied (`play.ts`: what the game itself runs
 * on, the sounds among it), straight from the source into the storage a file at a time. A
 * source that is not a full installation has none and the copy is the editor's alone; so is
 * a copy that could only be kept in memory.
 */
import { memberKey, openArchives, readerFor } from "./archives";
import { describeExtraction, ExtractError, extractGameData, type GameDataExtraction } from "./extract";
import { copyPlaySet } from "./play";
import { DEFAULT_PROFILE, type GameDataProfile } from "./profiles";
import { extractRemastered, pickedFilesSource, type PickedFile } from "./remastered";
import { writeStoredCopy, type StoredStamp } from "./store";

export interface ExtractRequest {
  kind: "extract";
  archives: { name: string; bytes: ArrayBuffer }[];
  /** What the stamp records as the origin. */
  from: string;
  /** The data set being installed; the game's own when absent. */
  profile?: GameDataProfile;
  /** Loose files laid over the archives, by member path. */
  overlay?: { path: string; bytes: ArrayBuffer }[];
  /** A StarCraft: Remastered installation folder, read in the archives' place. */
  remastered?: FileSystemDirectoryHandle | PickedFile[];
  /** Keep what the play page's real-time lighting reads of Remastered's sprites (about 200 MB more). */
  lighting?: boolean;
}

export type ExtractResponse =
  | { kind: "progress"; fraction: number; label: string }
  | { kind: "done"; stamp: StoredStamp; where: "opfs" | "memory"; problems: string[]; files?: [string, ArrayBuffer][] }
  | { kind: "error"; message: string };

const post = (msg: ExtractResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<ExtractRequest>) => {
  const req = e.data;
  if (req.kind !== "extract") return;
  try {
    let result: GameDataExtraction;
    let problems: string[];
    let from = req.from;
    /** A file of the source by the game's name for it, for the play set. */
    let member: (name: string) => Promise<Uint8Array | null>;
    if (req.remastered) {
      post({ kind: "progress", fraction: 0, label: "Opening the installation" });
      const { Storage, directoryHandleSource } = await import("kascade");
      const source = Array.isArray(req.remastered)
        ? pickedFilesSource(req.remastered)
        : directoryHandleSource(req.remastered as unknown as Parameters<typeof directoryHandleSource>[0]);
      if (!source) throw new ExtractError("The folder is not a StarCraft: Remastered installation.");
      // Reading and extracting are 0–80% of the bar, the write the rest.
      const storage = await Storage.open(source);
      const read = await extractRemastered(storage, (f, label) => post({ kind: "progress", fraction: f * 0.8, label }));
      ({ result, problems, from } = read);
      member = async (name) => (storage.fileInfo(memberKey(name))?.installed ? storage.readFile(memberKey(name)) : null);
    } else {
      post({ kind: "progress", fraction: 0, label: "Opening the archives" });
      const opened = openArchives(req.archives.map((a) => ({ name: a.name, bytes: new Uint8Array(a.bytes) })));
      problems = opened.problems;
      if (opened.archives.length === 0) throw new ExtractError(problems[0] ?? "No archive could be opened.");

      const overlay = new Map<string, Uint8Array>();
      for (const { path, bytes } of req.overlay ?? []) overlay.set(memberKey(path), new Uint8Array(bytes));

      // Extraction is 0–80% of the bar, the write the rest.
      const reader = readerFor(opened.archives, overlay.size ? overlay : undefined);
      result = extractGameData(reader, (f, label) => post({ kind: "progress", fraction: f * 0.8, label }));
      member = async (name) => reader(name);
    }
    const stamp: StoredStamp = {
      from,
      at: new Date().toISOString(),
      files: result.files.size,
      bytes: result.bytes,
      summary: describeExtraction(result),
      ...(req.profile ? { profile: req.profile } : {}),
    };

    try {
      // The editor's files are 80–88% of the bar, the play set the rest.
      let playing = false;
      const written = await writeStoredCopy(
        result.files,
        stamp,
        (f) => { if (!playing) post({ kind: "progress", fraction: 0.8 + f * 0.08, label: "Saving in the browser" }); },
        req.profile?.id ?? DEFAULT_PROFILE.id,
        async (write) => {
          playing = true;
          let play = null;
          try {
            play = await copyPlaySet(
              member,
              write,
              { sfxDat: result.files.get("arr/sfxdata.dat"), sfxTbl: result.files.get("arr/sfxdata.tbl"), imagesDat: result.files.get("arr/images.dat"), imagesTbl: result.files.get("arr/images.tbl") },
              (f, label) => post({ kind: "progress", fraction: 0.88 + f * 0.12, label }),
              (path) => result.files.has(path),
              { lighting: req.lighting === true },
            );
          } catch (err) {
            // The editor's copy is whole without it.
            problems.push(`The game's own files for playing were not copied: ${err instanceof Error ? err.message : String(err)}`);
          }
          if (!play) return {};
          return { play, files: stamp.files + play.files + play.sounds, bytes: stamp.bytes + play.bytes, summary: `${stamp.summary}, ${play.sounds} game sounds` };
        },
      );
      post({ kind: "done", stamp: written, where: "opfs", problems });
    } catch {
      const files: [string, ArrayBuffer][] = [];
      const transfer: Transferable[] = [];
      for (const [path, data] of result.files) {
        const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        files.push([path, buf]);
        transfer.push(buf);
      }
      post({ kind: "done", stamp, where: "memory", problems, files }, transfer);
    }
  } catch (err) {
    post({ kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
