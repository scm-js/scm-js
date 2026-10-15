import { useEffect, useRef } from "react";
import { useAtomValue, useStore } from "jotai";
import { activeDocumentIdAtom } from "../../atoms/documentAtoms";
import { mapViewStateAtom, pluginMapViewsAtom, type PluginMapViewEntry } from "../../atoms/pluginAtoms";
import { showMapView } from "../../plugins/mapViews";
import { pluginText } from "../../i18n";
import { useT } from "../../i18n/react";

/**
 * `ui.mapView`: the plugins' other views of a map, laid over the map's area, and the switch
 * between them and the map itself in the area's top-left corner. Each view's element is put
 * in the page the first time it is shown and stays there, hidden while the map (or another
 * view) is shown: an iframe moved in the page would load again.
 */
export default function PluginMapViews() {
  const t = useT();
  const store = useStore();
  const views = useAtomValue(pluginMapViewsAtom);
  const state = useAtomValue(mapViewStateAtom);
  const doc = useAtomValue(activeDocumentIdAtom) ?? -1;
  if (views.length === 0) return null;
  const offered = (state.offered.get(doc) ?? []).map((k) => views.find((v) => v.key === k)).filter((v): v is PluginMapViewEntry => !!v);
  const shown = state.shown.get(doc) ?? null;
  const pick = (key: number | null) => store.set(mapViewStateAtom, showMapView(store.get(mapViewStateAtom), doc, key));
  return (
    <>
      {views.map((v) => <MapViewSlot key={v.key} entry={v} shown={shown === v.key} />)}
      {offered.length > 0 && (
        <div className="map-view-switch" role="tablist" aria-label={t("Ways to look at this map")}>
          <button type="button" role="tab" aria-selected={shown === null} className={shown === null ? "active" : ""} onClick={() => pick(null)}>{t("Map")}</button>
          {offered.map((v) => (
            <button key={v.key} type="button" role="tab" aria-selected={shown === v.key} className={shown === v.key ? "active" : ""} title={pluginText(v.plugin.id, v.plugin.name)} onClick={() => pick(v.key)}>
              {pluginText(v.plugin.id, v.spec.title)}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function MapViewSlot({ entry, shown }: { entry: PluginMapViewEntry; shown: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const slot = ref.current, el = entry.element;
    if (shown && slot && el && el.parentNode !== slot) slot.appendChild(el);
  }, [entry, shown]);
  return <div ref={ref} className="plugin-map-view" hidden={!shown} />;
}
