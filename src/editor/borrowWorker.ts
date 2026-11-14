/**
 * The borrowed-terrain scan's worker, as a function: the messages it takes and answers, and the
 * handler that does the work (`borrowWorkerHandler`). The worker module
 * (`services/borrowTable.worker.ts`) only wires it to `self`, so a Node test calls the same
 * handler without a Worker.
 *
 * The worker is given the host tileset once (`host`), then one source at a time (`table`): the
 * host's picture summary (`picturesOf`, kept per Tileset object) is worked out once for a scan,
 * not once per source. A tileset travels as the fields the table reads (`TilesetParts`), the
 * groups packed into one array, so the structured clone is a few typed arrays and not thousands
 * of small objects. The answer is the table as numbers (`encodeBorrowTable`), its buffer
 * transferred.
 */
import type { Cv5Group, Tileset } from "../formats/tileset/decode";
import { borrowTable, encodeBorrowTable } from "./borrowTable";

/** What the table reads of a tileset. */
export interface TilesetParts {
  palette: Uint8Array;
  minitiles: Uint8Array;
  megatileRefs: Uint32Array;
  megatileCount: number;
  megatileFlags: Uint16Array;
  /** Per group: index, flag word, the sixteen megatiles (18 words). */
  groups: Uint16Array;
}

const GROUP_WORDS = 18;

/** A tileset's parts for the worker. The arrays are the tileset's own: the structured clone copies them. */
export function tilesetParts(ts: Tileset): TilesetParts {
  const groups = new Uint16Array(ts.groups.length * GROUP_WORDS);
  ts.groups.forEach((g, i) => {
    groups[i * GROUP_WORDS] = g.index;
    groups[i * GROUP_WORDS + 1] = g.flags;
    groups.set(g.megatiles, i * GROUP_WORDS + 2);
  });
  return { palette: ts.palette, minitiles: ts.minitiles, megatileRefs: ts.megatileRefs, megatileCount: ts.megatileCount, megatileFlags: ts.megatileFlags, groups };
}

/** A tileset from its parts: what the table needs, the links and stack values left zero. */
export function tilesetFromParts(p: TilesetParts): Tileset {
  const count = p.groups.length / GROUP_WORDS;
  const groups: Cv5Group[] = [];
  for (let i = 0; i < count; i++) {
    const flags = p.groups[i * GROUP_WORDS + 1];
    groups.push({
      index: p.groups[i * GROUP_WORDS], flags, buildability: flags & 0xff, groundHeight: flags >> 8,
      edges: { left: 0, top: 0, right: 0, bottom: 0 }, stack: { left: 0, top: 0, right: 0, bottom: 0 },
      megatiles: p.groups.slice(i * GROUP_WORDS + 2, i * GROUP_WORDS + GROUP_WORDS),
    });
  }
  return { palette: p.palette, minitiles: p.minitiles, megatileRefs: p.megatileRefs, megatileCount: p.megatileCount, extended: false, megatileFlags: p.megatileFlags, groups };
}

export type BorrowWorkerRequest =
  /** The host every following table is into; replaces the one before. */
  | { kind: "host"; host: TilesetParts }
  /** The table from `source` into the host, answered under `id`. */
  | { kind: "table"; id: number; source: TilesetParts };

export type BorrowWorkerResponse =
  | { kind: "progress"; id: number; done: number; total: number }
  | { kind: "table"; id: number; table: Int32Array; ms: number }
  | { kind: "error"; id: number; message: string };

/** How often progress is posted, at most (ms). */
const PROGRESS_MS = 100;

/**
 * The worker's handler: `post` sends an answer (with the buffers to transfer). Requests are
 * handled in turn; each `table` request is answered once, with the table or an error.
 */
export function borrowWorkerHandler(post: (message: BorrowWorkerResponse, transfer?: Transferable[]) => void): (request: BorrowWorkerRequest) => Promise<void> {
  let host: Tileset | null = null;
  return async (request) => {
    if (request.kind === "host") {
      host = tilesetFromParts(request.host);
      return;
    }
    const { id } = request;
    if (!host) { post({ kind: "error", id, message: "no host tileset was given" }); return; }
    try {
      const started = performance.now();
      let posted = 0;
      const table = await borrowTable(host, tilesetFromParts(request.source), {
        // Nothing else runs here: the pause is only where progress is told.
        pause: async () => {},
        progress: (done, total) => {
          const now = performance.now();
          if (now - posted < PROGRESS_MS) return;
          posted = now;
          post({ kind: "progress", id, done, total });
        },
      });
      const encoded = encodeBorrowTable(table);
      post({ kind: "table", id, table: encoded, ms: performance.now() - started }, [encoded.buffer]);
    } catch (err) {
      post({ kind: "error", id, message: err instanceof Error ? err.message : String(err) });
    }
  };
}
