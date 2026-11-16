/**
 * A map linked to `scmjs` on this computer (`scmjs map open --live`, the MCP server's `editor_open`): the command
 * handed the map over and stays on the other end of the page that opened the editor. While the link holds, the
 * command reads the map as the editor has it, unsaved changes included, puts a changed map back as one undo step,
 * asks what is selected and where the view is, and Save writes the file on disk through it.
 *
 * The link belongs to the document that came through it and reaches nothing else: every request is answered for
 * that map alone, and only while it is the map in front. Messages are plain objects over a `LinkPort` (the opener's
 * `postMessage`, in `useOpenerHandoff`); a request carries an id and is answered once, in either direction.
 */
import type { createStore } from "jotai";
import { linkedDocumentAtom } from "../atoms/linkAtoms";
import {
  activeDocumentIdAtom, applyDocumentAtom, archiveExtrasAtom, archiveStoredAtom, commitNoticeAtom, documentsAtom, scenarioAtom, tilesetFileNameAtom,
} from "../atoms/documentAtoms";
import {
  activeLayerAtom, clipSelectionAtom, mapFileHandleAtom, mapFilePathAtom, mapModifiedAtom, mapOriginAtom, mapPointerHeldAtom, saveOptionsAtom,
  selectedDoodadsAtom, selectedLocationsAtom, selectedSpritesAtom, selectedUnitsAtom, viewportRectAtom, zoomAtom,
} from "../atoms/editorAtoms";
import { dialogStackAtom, pushToastAtom, statusMessageAtom } from "../atoms/uiAtoms";
import { unitName } from "../data/units";
import { locationName } from "../editor/locations";
import { openMapBytes } from "../editor/mapFile";
import { DEFAULT_SAVE_OPTIONS, defaultSaveOptions, type SaveOptions } from "../editor/save";
import { ensureTileset } from "../formats/tileset/load";
import { t } from "../i18n";
import { flashOnMap, viewApi } from "../plugins/host";
import { DEFAULT_IMAGE_OPTIONS, exportMapImage } from "./mapImage";
import { TRANSIENT } from "./diskFiles";
import { writeMapBytes, type MapFileHandle } from "./mapIo";
import { HOLDING_DIALOGS } from "./sync";

type Store = ReturnType<typeof createStore>;

/** Where the link's messages go: the page that opened the editor. */
export interface LinkPort {
  post(message: Record<string, unknown>, transfer?: Transferable[]): void;
}

/** A request or its answer, as it travels. `bytes` rides beside the JSON so a map is never encoded as text. */
export interface LinkMessage {
  type: "scmjs.link" | "scmjs.link.reply";
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
  ok?: boolean;
  result?: unknown;
  /** A refusal: `code` for the command to act on, `message` for a person. */
  error?: { code: string; message: string };
  bytes?: Uint8Array;
}

/** Why a request was refused, by a word the command can act on (`changed` means read again and retry). */
export class LinkRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}


const LINK = TRANSIENT;

/** Whether a handle is a linked map's: it writes through the link, and means nothing once the page is gone. */
export function isLinkHandle(handle: unknown): boolean {
  return !!handle && typeof handle === "object" && (handle as Record<symbol, unknown>)[LINK] === true;
}

/** How long a change waits for a stroke or a dialog that holds the map before it is refused. */
const HOLD_MS = 20_000;
/** How long the command has to answer a request of the editor's (a save writes a file). */
const ANSWER_MS = 30_000;

export interface EditorLink {
  /** The handle the map is opened with: Save writes the file on disk through the link. */
  readonly handle: MapFileHandle;
  /** Bind the link to the map in front, once the handed file is open there. False when it is not (the open was refused). */
  attach(): boolean;
  /** A message from the page that opened the editor. */
  receive(message: LinkMessage): void;
  /** End the link from this side, telling the command why. */
  end(reason: string): void;
  readonly ended: boolean;
}

/** The editor's Save, which lives with the file actions: handed in, so this module needs nothing of the chrome. */
export type LinkSave = (store: Store, req: { fileName: string; handle: MapFileHandle; options: SaveOptions; copy: false }) => Promise<boolean>;

export function createEditorLink(store: Store, port: LinkPort, name: string, saveDocument: LinkSave): EditorLink {
  let docId: number | null = null;
  let ended = false;
  /** Counts every committed change to the linked map, so a change made from stale bytes can be told. */
  let rev = 0;
  let nextId = 1;
  const waiting = new Map<string, { resolve: (m: LinkMessage) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const stops: (() => void)[] = [];

  const inFront = () => docId !== null && store.get(activeDocumentIdAtom) === docId && store.get(mapFileHandleAtom) === handle;
  const gone = () => new LinkRefusal("ended", "The link to this map has ended.");

  /** Ask the command for something and wait for its answer. */
  function ask(method: string, params: Record<string, unknown> = {}, bytes?: Uint8Array): Promise<LinkMessage> {
    if (ended) return Promise.reject(gone());
    const id = `e${nextId++}`;
    return new Promise<LinkMessage>((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error("scmjs did not answer")); }, ANSWER_MS);
      waiting.set(id, { resolve, reject, timer });
      port.post({ type: "scmjs.link", id, method, params, ...(bytes ? { bytes } : {}) });
    }).then((m) => {
      if (m.ok) return m;
      throw new LinkRefusal(m.error?.code ?? "failed", m.error?.message ?? "scmjs refused");
    });
  }

  const handle = {
    kind: "file",
    name,
    [LINK]: true,
    async getFile() {
      const m = await ask("file");
      return new File([(m.bytes ?? new Uint8Array()) as unknown as BlobPart], name);
    },
    async createWritable() {
      const parts: Uint8Array[] = [];
      return {
        async write(data: Blob | Uint8Array) { parts.push(data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer())); },
        async close() {
          const bytes = parts.length === 1 ? parts[0] : new Uint8Array(await new Blob(parts as unknown as BlobPart[]).arrayBuffer());
          await ask("write", {}, bytes);
        },
      };
    },
  } as unknown as MapFileHandle;

  function end(reason: string, tell = true) {
    if (ended) return;
    ended = true;
    for (const stop of stops.splice(0)) stop();
    for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(gone()); }
    waiting.clear();
    if (tell) port.post({ type: "scmjs.link", method: "ended", params: { reason } });
    if (store.get(linkedDocumentAtom)?.id === docId) store.set(linkedDocumentAtom, null);
  }

  /** The map in front must be the linked one: the registers hold only the map in front. */
  function front() {
    if (ended) throw gone();
    const scn = store.get(scenarioAtom);
    if (!scn || !inFront()) throw new LinkRefusal("behind", t("{name} is behind another map in the editor. Bring it to the front.", { name }));
    return scn;
  }

  async function read() {
    const scn = front();
    const remembered = store.get(saveOptionsAtom) ?? defaultSaveOptions(scn, store.get(mapOriginAtom), store.get(mapFilePathAtom));
    const at = rev;
    const bytes = await writeMapBytes(scn, {
      format: remembered.format, extras: store.get(archiveExtrasAtom), stored: store.get(archiveStoredAtom), options: { ...DEFAULT_SAVE_OPTIONS, ...remembered },
    });
    return { result: { name, rev: at, modified: store.get(mapModifiedAtom) }, bytes };
  }

  const held = () => store.get(mapPointerHeldAtom) || store.get(dialogStackAtom).some((d) => HOLDING_DIALOGS.has(d.id));

  async function apply(params: Record<string, unknown>, bytes: Uint8Array | undefined) {
    front();
    if (!bytes?.length) throw new LinkRefusal("failed", "No map came with the change.");
    const label = typeof params.label === "string" && params.label ? params.label : "scmjs";
    const base = typeof params.base === "number" ? params.base : null;
    const stale = () => { if (base !== null && base !== rev) throw new LinkRefusal("changed", t("The map changed in the editor while the command ran.")); };
    stale();
    const opened = await openMapBytes(bytes, name);
    // A stroke under way or a dialog holding a working copy of the map: the change waits for it, as other people's do on a shared map.
    const until = Date.now() + HOLD_MS;
    while (held()) {
      if (Date.now() > until) throw new LinkRefusal("busy", t("The editor is in the middle of an edit to {name}. Finish or close it, then try again.", { name }));
      await new Promise((r) => setTimeout(r, 100));
    }
    front();
    stale();
    const ok = store.set(applyDocumentAtom, { scenario: opened.scenario, extras: opened.extras, stored: opened.stored ?? null }, label);
    if (!ok) throw new LinkRefusal("view-only", t("{name} is open to look at only in the editor.", { name }));
    store.set(statusMessageAtom, t("{label}: changed from scmjs. Undo takes it back.", { label }));
    return { result: { rev } };
  }

  function state() {
    const scn = front();
    const v = store.get(viewportRectAtom);
    const units = store.get(selectedUnitsAtom).filter((i) => scn.units[i]).map((i) => {
      const u = scn.units[i];
      return { index: i, type: unitName(u.unitId), unitId: u.unitId, player: u.owner + 1, x: u.x, y: u.y };
    });
    const locations = store.get(selectedLocationsAtom).filter((i) => scn.locations[i]).map((i) => {
      const l = scn.locations[i];
      return { index: i, name: locationName(scn, i), left: l.left, top: l.top, right: l.right, bottom: l.bottom };
    });
    const area = store.get(clipSelectionAtom);
    return {
      result: {
        name, modified: store.get(mapModifiedAtom), rev,
        size: { width: scn.width, height: scn.height },
        layer: store.get(activeLayerAtom), zoom: store.get(zoomAtom),
        // Tiles, the far edge exclusive, as the marked area is.
        view: { x0: Math.max(0, Math.floor(v.x)), y0: Math.max(0, Math.floor(v.y)), x1: Math.min(scn.width, Math.ceil(v.x + v.w)), y1: Math.min(scn.height, Math.ceil(v.y + v.h)) },
        selection: {
          units, locations,
          doodads: store.get(selectedDoodadsAtom), sprites: store.get(selectedSpritesAtom),
          area: area ? { x0: area.x0, y0: area.y0, x1: area.x1, y1: area.y1 } : null,
        },
      },
    };
  }

  const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n >= 0) : []);

  /** Bring a part of the map into view, flash it, and select the units or locations named. */
  async function show(params: Record<string, unknown>) {
    const scn = front();
    const units = numbers(params.units).filter((i) => scn.units[i]);
    const locations = numbers(params.locations).filter((i) => scn.locations[i]);
    const r = params.rect as { x0?: unknown; y0?: unknown; x1?: unknown; y1?: unknown } | undefined;
    const tiles = (px: number, up = false) => (up ? Math.ceil(px / 32) : Math.floor(px / 32));
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
    const grow = (x0: number, y0: number, x1: number, y1: number) => {
      box = box ? { x0: Math.min(box.x0, x0), y0: Math.min(box.y0, y0), x1: Math.max(box.x1, x1), y1: Math.max(box.y1, y1) } : { x0, y0, x1, y1 };
    };
    if (r && [r.x0, r.y0, r.x1, r.y1].every((n) => typeof n === "number" && Number.isFinite(n))) grow(r.x0 as number, r.y0 as number, r.x1 as number, r.y1 as number);
    for (const i of units) { const u = scn.units[i]; grow(tiles(u.x) - 1, tiles(u.y) - 1, tiles(u.x) + 2, tiles(u.y) + 2); }
    for (const i of locations) { const l = scn.locations[i]; grow(tiles(Math.min(l.left, l.right)), tiles(Math.min(l.top, l.bottom)), tiles(Math.max(l.left, l.right), true), tiles(Math.max(l.top, l.bottom), true)); }
    if (!box) throw new LinkRefusal("failed", "Nothing to show: give a rect, units or locations.");
    const b = box as { x0: number; y0: number; x1: number; y1: number };
    const rect = { x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(scn.width, b.x1), y1: Math.min(scn.height, b.y1) };
    if (units.length) { store.set(activeLayerAtom, "units"); store.set(selectedLocationsAtom, []); store.set(selectedUnitsAtom, units); }
    else if (locations.length) { store.set(activeLayerAtom, "locations"); store.set(selectedUnitsAtom, []); store.set(selectedLocationsAtom, locations); }
    await viewApi(store).reveal(rect, { fit: true });
    if (units.length) flashOnMap(store, { units, kind: "attention" });
    else if (locations.length) flashOnMap(store, { locations, kind: "attention" });
    else flashOnMap(store, { rect, kind: "attention" });
    return { result: { rect } };
  }

  /** The map as the editor draws it, as a PNG: the view, or the tiles asked for. */
  async function picture(params: Record<string, unknown>) {
    const scn = front();
    try { await ensureTileset(store.get(tilesetFileNameAtom)); } catch { throw new LinkRefusal("no-graphics", t("The editor has no game data for this tileset, so there is no picture to send.")); }
    const v = state().result.view;
    const p = params.rect as { x0: number; y0: number; x1: number; y1: number } | undefined;
    const whole = params.whole === true;
    const rect = whole ? { x0: 0, y0: 0, x1: scn.width, y1: scn.height } : p ? { x0: Math.max(0, Math.floor(p.x0)), y0: Math.max(0, Math.floor(p.y0)), x1: Math.min(scn.width, Math.ceil(p.x1)), y1: Math.min(scn.height, Math.ceil(p.y1)) } : v;
    if (!(rect.x1 > rect.x0 && rect.y1 > rect.y0)) throw new LinkRefusal("failed", "The rect is empty or outside the map.");
    // At most about 1,600 pixels on the long side: enough to read, small enough to send.
    const longest = Math.max(rect.x1 - rect.x0, rect.y1 - rect.y0);
    const pixelsPerTile = Math.max(1, Math.min(32, Math.floor(1600 / longest)));
    const blob = await exportMapImage(scn, { ...DEFAULT_IMAGE_OPTIONS, pixelsPerTile, locations: params.locations !== false, locationNames: params.locations !== false, rect });
    return { result: { rect, pixelsPerTile }, bytes: new Uint8Array(await blob.arrayBuffer()) };
  }

  async function save() {
    const scn = front();
    const path = store.get(mapFilePathAtom) ?? name;
    const options = store.get(saveOptionsAtom) ?? defaultSaveOptions(scn, store.get(mapOriginAtom), path);
    const saved = await saveDocument(store, { fileName: path, handle, options, copy: false });
    if (!saved) throw new LinkRefusal("failed", t("The editor could not save {name}.", { name }));
    return { result: { modified: store.get(mapModifiedAtom) } };
  }

  async function answer(m: LinkMessage): Promise<{ result?: unknown; bytes?: Uint8Array }> {
    const params = m.params ?? {};
    switch (m.method) {
      case "ping": return { result: { name } };
      case "read": return read();
      case "apply": return apply(params, m.bytes);
      case "state": return state();
      case "show": return show(params);
      case "picture": return picture(params);
      case "save": return save();
      default: throw new LinkRefusal("unknown", `The editor does not know "${m.method}". It may be older than this scmjs.`);
    }
  }

  function receive(m: LinkMessage) {
    if (ended) return;
    if (m.type === "scmjs.link.reply") {
      const w = m.id ? waiting.get(m.id) : undefined;
      if (!w) return;
      waiting.delete(m.id!);
      clearTimeout(w.timer);
      w.resolve(m);
      return;
    }
    if (m.method === "ended") { end(String(m.params?.reason ?? "closed"), false); store.set(statusMessageAtom, t("{name} is no longer linked to scmjs.", { name })); return; }
    const id = m.id;
    if (!id) return;
    void answer(m).then(
      (r) => port.post({ type: "scmjs.link.reply", id, ok: true, result: r.result ?? null, ...(r.bytes ? { bytes: r.bytes } : {}) }, r.bytes ? [r.bytes.buffer as ArrayBuffer] : undefined),
      (e) => port.post({ type: "scmjs.link.reply", id, ok: false, error: { code: e instanceof LinkRefusal ? e.code : "failed", message: e instanceof Error ? e.message : String(e) } }),
    );
  }

  function attach(): boolean {
    if (ended || store.get(mapFileHandleAtom) !== handle) return false;
    docId = store.get(activeDocumentIdAtom);
    if (docId === null) return false;
    store.set(linkedDocumentAtom, { id: docId, name });
    // Every commit to the map in front counts, and so does a change to the archive's other files.
    const bump = () => { if (inFront()) rev++; };
    stops.push(store.sub(commitNoticeAtom, bump), store.sub(archiveExtrasAtom, bump));
    // The map closed, or another file opened in its place: its id is no longer among the open maps. Parked behind another map, it still is.
    stops.push(store.sub(documentsAtom, () => { if (!store.get(documentsAtom).some((d) => d.id === docId)) end("closed"); }));
    store.set(pushToastAtom, { kind: "info", title: t("Linked to scmjs"), detail: t("Commands and AI tools on this computer now change {name} here, one undo step each. Save writes the file.", { name }) });
    return true;
  }

  return { handle, attach, receive, end: (reason) => end(reason), get ended() { return ended; } };
}

