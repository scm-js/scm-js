import { useAtomValue, useStore } from "jotai";
import { X } from "lucide-react";
import { documentTabsAtom } from "../../atoms/documentAtoms";
import { activateDocumentIn, closeDocumentIn } from "../../hooks/useMapFileActions";
import type { OpenDocumentInfo } from "../../plugins/api";
import { t } from "../../i18n";
import { useT } from "../../i18n/react";

/** What a tab says: the file the map came from when it has one, else the scenario's name — as the window title does. */
export function tabTitle(doc: OpenDocumentInfo): string {
  return (doc.fileName ?? doc.name).trim() || t("Untitled Scenario");
}

/**
 * The open maps, one tab each, between the toolbar and the map. Nothing is rendered
 * with one map open — the editor then looks as it always has — and the strip appears
 * with the second. A click brings a map to the front (`activateDocumentAtom`: nothing is
 * re-read, its history and view come back as left); the × and a middle click close it
 * through the unsaved-changes gate. The Window menu lists the same maps.
 */
export default function TabStrip() {
  const t = useT();
  const tabs = useAtomValue(documentTabsAtom);
  const store = useStore();
  if (tabs.length < 2) return null;
  return (
    <div className="tabstrip" role="tablist" aria-label={t("Open maps")}>
      {tabs.map((doc) => {
        const title = tabTitle(doc);
        return (
          <div
            key={doc.id}
            role="tab"
            aria-selected={doc.active}
            tabIndex={0}
            className={`tab${doc.active ? " active" : ""}${doc.modified ? " modified" : ""}`}
            title={doc.modified ? t("{title} — {w}×{h}, unsaved changes", { title, w: doc.width, h: doc.height }) : t("{title} — {w}×{h}", { title, w: doc.width, h: doc.height })}
            onClick={() => { activateDocumentIn(store, doc.id); }}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); void closeDocumentIn(store, doc.id); } }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activateDocumentIn(store, doc.id); } }}
          >
            <span className="dot" aria-hidden />
            <span className="tab-title">{title}</span>
            <button
              type="button"
              className="tab-close"
              aria-label={t("Close {title}", { title })}
              title={t("Close")}
              onClick={(e) => { e.stopPropagation(); void closeDocumentIn(store, doc.id); }}
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
