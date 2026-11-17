/**
 * `api.clipboard` and `api.exchange`: the user's clip, `.trg` files and the strings text.
 */
import { t } from "../../i18n";
import { activeLayerAtom, clipboardAtom, clipPartsAtom, clipPasteModeAtom, clipPastingAtom, clipSelectionAtom, selectedDoodadsAtom, selectedLocationsAtom, selectedSpritesAtom, selectedUnitsAtom } from "../../atoms/editorAtoms";
import { commitEditAtom, scenarioAtom, tilesetFileNameAtom } from "../../atoms/documentAtoms";
import { peekTileset } from "../../formats/tileset/load";
import { NO_DOODADS } from "../../formats/tileset/doodads";
import type { Rect } from "../../editor/terrain";
import type { ClipboardApi, ClipSource, ExchangeApi } from "../api";
import { decodeTrg, encodeTrg, formatStringTable, parseStringTable } from "../../editor/exchange";
import { clipSummary, copyObjects, copyRegion, EMPTY_SELECTION, pasteClip, regionObjects as regionObjectsOf, removeObjects, selectionSize, type Clip, type ClipParts, type ObjectSelection } from "../../editor/clipboard";
import { type Store, assertWritable } from "./shared";

/** `api.clipboard`: what the Cut / Copy / Paste layer does, over `editor/clipboard.ts`, with the user's clip. */
export function clipboardApi(store: Store): ClipboardApi {
  const scenario = () => store.get(scenarioAtom);
  const graphics = () => { const l = peekTileset(store.get(tilesetFileNameAtom)); return { catalogue: l?.doodads ?? NO_DOODADS, tileset: l?.tileset ?? null }; };
  /** The source as given, else what Ctrl+C would take: the object layer's selection, or the marked area. */
  const resolve = (source?: ClipSource): { rect: Rect } | { sel: ObjectSelection } | null => {
    if (source && "rect" in source) return { rect: source.rect };
    if (source) {
      const sel = { ...EMPTY_SELECTION, units: source.units ?? [], sprites: source.sprites ?? [], doodads: source.doodads ?? [], locations: source.locations ?? [] };
      return selectionSize(sel) > 0 ? { sel } : null;
    }
    const layer = store.get(activeLayerAtom);
    const objects = (part: Partial<ObjectSelection>) => { const sel = { ...EMPTY_SELECTION, ...part }; return selectionSize(sel) > 0 ? { sel } : null; };
    if (layer === "units") return objects({ units: store.get(selectedUnitsAtom) });
    if (layer === "sprites") return objects({ sprites: store.get(selectedSpritesAtom) });
    if (layer === "doodads") return objects({ doodads: store.get(selectedDoodadsAtom) });
    if (layer === "locations") return objects({ locations: store.get(selectedLocationsAtom) });
    const rect = store.get(clipSelectionAtom);
    return rect ? { rect } : null;
  };
  const take = (source?: ClipSource, partsOver?: Partial<ClipParts>): { clip: Clip; src: { rect: Rect } | { sel: ObjectSelection } } | null => {
    const scn = scenario();
    const src = resolve(source);
    if (!scn || !src) return null;
    const parts = { ...store.get(clipPartsAtom), ...partsOver };
    const clip = "rect" in src ? copyRegion(scn, src.rect, parts, graphics().catalogue) : copyObjects(scn, src.sel, parts, graphics().catalogue);
    return clip ? { clip, src } : null;
  };
  return {
    clip: () => store.get(clipboardAtom),
    setClip: (clip) => store.set(clipboardAtom, clip),
    copy: (source) => { const taken = take(source); if (taken) store.set(clipboardAtom, taken.clip); return taken?.clip ?? null; },
    capture: (source, options = {}) => take(source, options.parts)?.clip ?? null,
    cut: (source) => {
      const scn = scenario();
      if (scn) assertWritable(store);
      const taken = take(source);
      if (!scn || !taken) return null;
      store.set(clipboardAtom, taken.clip);
      const { catalogue, tileset } = graphics();
      const parts = store.get(clipPartsAtom);
      const all = "rect" in taken.src ? regionObjectsOf(scn, taken.src.rect, catalogue) : taken.src.sel;
      const sel: ObjectSelection = { units: parts.units ? all.units : [], sprites: parts.sprites ? all.sprites : [], doodads: parts.doodads ? all.doodads : [], locations: parts.locations ? all.locations : [] };
      const n = selectionSize(sel);
      if (n > 0) {
        const edit = removeObjects(scn, sel, catalogue, tileset);
        store.set(selectedUnitsAtom, []); store.set(selectedSpritesAtom, []); store.set(selectedDoodadsAtom, []); store.set(selectedLocationsAtom, []);
        store.set(commitEditAtom, { label: t("Cut {n, plural, one {# object} other {# objects}}", { n }), ...edit });
      }
      return taken.clip;
    },
    paste: (tx, ty, options = {}) => {
      const scn = scenario();
      if (scn) assertWritable(store);
      const clip = store.get(clipboardAtom);
      if (!scn || !clip) return null;
      const { catalogue, tileset } = graphics();
      const result = pasteClip(scn, clip, tx, ty, { parts: { ...store.get(clipPartsAtom), ...options.parts }, mode: options.mode ?? store.get(clipPasteModeAtom), catalogue, tileset });
      const c = result.counts;
      if (c.tiles + c.doodads + c.units + c.sprites + c.locations + c.fog + c.removed > 0) {
        store.set(selectedUnitsAtom, []); store.set(selectedSpritesAtom, []); store.set(selectedDoodadsAtom, []); store.set(selectedLocationsAtom, []);
        store.set(commitEditAtom, { label: t("Paste {clipSummary}", { clipSummary: clipSummary(clip) }), ...result.edit });
        store.set(clipSelectionAtom, { x0: Math.max(0, tx), y0: Math.max(0, ty), x1: Math.min(scn.width, tx + clip.width), y1: Math.min(scn.height, ty + clip.height) });
      }
      return result;
    },
    parts: () => ({ ...store.get(clipPartsAtom) }),
    setParts: (patch) => store.set(clipPartsAtom, { ...store.get(clipPartsAtom), ...patch }),
    mode: () => store.get(clipPasteModeAtom),
    setMode: (mode) => store.set(clipPasteModeAtom, mode),
    pasting: () => store.get(clipPastingAtom),
    setPasting: (on) => { if (on && store.get(activeLayerAtom) !== "clipboard") store.set(activeLayerAtom, "clipboard"); store.set(clipPastingAtom, on); },
    summary: clipSummary,
  };
}

/** `api.exchange`: `.trg` files and the strings text. */
export function exchangeApi(store: Store): ExchangeApi {
  const scenario = () => store.get(scenarioAtom);
  return {
    encodeTrg,
    decodeTrg,
    formatStrings: () => { const scn = scenario(); return scn ? formatStringTable(scn.strings) : ""; },
    parseStrings: parseStringTable,
  };
}
