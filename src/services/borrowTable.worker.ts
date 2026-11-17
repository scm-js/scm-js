/**
 * The borrowed-terrain scan's worker: the table from one source tileset into the host, off the
 * page's thread. All of it is `editor/modTerrain/borrowWorker.ts#borrowWorkerHandler`; this only wires it to
 * the worker's messages (the client is `borrowTableClient.ts`).
 */
import { borrowWorkerHandler, type BorrowWorkerRequest, type BorrowWorkerResponse } from "../editor/modTerrain/borrowWorker";

const handle = borrowWorkerHandler((message: BorrowWorkerResponse, transfer?: Transferable[]) => postMessage(message, { transfer: transfer ?? [] }));
self.onmessage = (e: MessageEvent<BorrowWorkerRequest>) => { void handle(e.data); };
