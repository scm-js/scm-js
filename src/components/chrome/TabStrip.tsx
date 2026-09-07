import { useAtomValue, useStore } from "jotai";
import { X } from "lucide-react";
import { documentTabsAtom } from "../../atoms/documentAtoms";
import { activateDocumentIn, closeDocumentIn } from "../../hooks/useMapFileActions";
import type { OpenDocumentInfo } from "../../plugins/api";

/** What a tab says: the file the map came from when it has one, else the scenario's name — as the window title does. */
export function tabTitle(t: OpenDocumentInfo): string {
  return (t.fileName ?? t.name).trim() || "Untitled Scenario";
}

/**
 * The open maps, one tab each, between the toolbar and the map. Nothing is rendered
 * with one map open — the editor then looks as it always has — and the strip appears
 * with the second. A click brings a map to the front (`activateDocumentAtom`: nothing is
 * re-read, its history and view come back as left); the × and a middle click close it
 * through the unsaved-changes gate. The Window menu lists the same maps.
 */
export default function TabStrip() {
  const tabs = useAtomValue(documentTabsAtom);
  const store = useStore();
  if (tabs.length < 2) return null;
  return (
    <div className="tabstrip" role="tablist" aria-label="Open maps">
      {tabs.map((t) => {
        const title = tabTitle(t);
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.active}
            tabIndex={0}
            className={`tab${t.active ? " active" : ""}${t.modified ? " modified" : ""}`}
            title={`${title} — ${t.width}×${t.height}${t.modified ? ", unsaved changes" : ""}`}
            onClick={() => { activateDocumentIn(store, t.id); }}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); void closeDocumentIn(store, t.id); } }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activateDocumentIn(store, t.id); } }}
          >
            <span className="dot" aria-hidden />
            <span className="tab-title">{title}</span>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${title}`}
              title="Close"
              onClick={(e) => { e.stopPropagation(); void closeDocumentIn(store, t.id); }}
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
