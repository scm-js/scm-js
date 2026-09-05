/**
 * The extraction off the main thread: opens the archives it is handed, runs
 * `extractGameData`, writes the result into the browser's private file storage and
 * reports progress. When there is no such storage here the files are posted back for
 * the main thread to keep for the session (`store.ts#keepInMemory`).
 */
import { memberKey, openArchives, readerFor } from "./archives";
import { describeExtraction, ExtractError, extractGameData } from "./extract";
import { DEFAULT_PROFILE, type GameDataProfile } from "./profiles";
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
    post({ kind: "progress", fraction: 0, label: "Opening the archives" });
    const { archives, problems } = openArchives(req.archives.map((a) => ({ name: a.name, bytes: new Uint8Array(a.bytes) })));
    if (archives.length === 0) throw new ExtractError(problems[0] ?? "No archive could be opened.");

    const overlay = new Map<string, Uint8Array>();
    for (const { path, bytes } of req.overlay ?? []) overlay.set(memberKey(path), new Uint8Array(bytes));

    // Extraction is 0–80% of the bar, the write the rest.
    const result = extractGameData(readerFor(archives, overlay.size ? overlay : undefined), (f, label) => post({ kind: "progress", fraction: f * 0.8, label }));
    const stamp: StoredStamp = {
      from: req.from,
      at: new Date().toISOString(),
      files: result.files.size,
      bytes: result.bytes,
      summary: describeExtraction(result),
      ...(req.profile ? { profile: req.profile } : {}),
    };

    try {
      await writeStoredCopy(result.files, stamp, (f) => post({ kind: "progress", fraction: 0.8 + f * 0.2, label: "Saving in the browser" }), req.profile?.id ?? DEFAULT_PROFILE.id);
      post({ kind: "done", stamp, where: "opfs", problems });
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
