import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { GitCompareArrows } from "lucide-react";
import { compareBaseAtom, documentsAtom, documentTabsAtom, scenarioAtom } from "../../atoms/documentAtoms";
import { centerViewOnAtom, viewFlagsAtom } from "../../atoms/editorAtoms";
import { closeDialogAtom } from "../../atoms/uiAtoms";
import { anyChange, scenarioCopy } from "../../editor/compare";
import { locationName } from "../../editor/locations";
import { plainText } from "../../editor/textColors";
import { ANYWHERE_INDEX } from "../../formats/chk/sections/objects";
import { unitLabel } from "../../data/units";
import { useCompare, type Comparison } from "../../hooks/useCompare";
import { countView } from "../../services/usage";
import { tabTitle } from "../chrome/TabStrip";
import { Button, Check, Field, Group, Select } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";
import { t } from "../../i18n";

/** How many places, units and locations the dialog lists of each; the overlay shows the rest. */
const LISTED = 6;

/**
 * What the comparison found, with a button for each place: it turns View ▸ Differences
 * on and goes there. `show` takes a spot in tiles.
 */
function Findings({ comparison, show }: { comparison: Comparison; show: (x: number, y: number) => void }) {
  const scenario = useAtomValue(scenarioAtom);
  const { changes, places, sameTileset } = comparison;
  const c = changes.counts;
  const units = changes.units, locations = changes.locations.filter((l) => l.index !== ANYWHERE_INDEX);
  const nothing = !anyChange({ ...c, tiles: sameTileset ? c.tiles : 0, locations: locations.length });
  return (
    <div className="col" style={{ gap: 6 }}>
      {!sameTileset && <p className="hint">{t("The two maps are of different tilesets, so their ground cannot be compared tile by tile. Units and locations are compared.")}</p>}
      {c.resized > 0 && <p className="hint">{t("The two maps are of different sizes: {n, plural, one {# tile is} other {# tiles are}} in only one of them. They are compared from the top left corner.", { n: c.resized })}</p>}
      {nothing && <p className="hint">{sameTileset ? t("The ground, the units and the locations are the same in both maps.") : t("The units and the locations are the same in both maps.")}</p>}
      {sameTileset && c.tiles > 0 && (
        <>
          <p className="hint">{t("{n, plural, one {# tile differs} other {# tiles differ}} in {places, plural, one {# place} other {# places}}:", { n: c.tiles, places: places.length })}</p>
          {places.slice(0, LISTED).map((p, i) => (
            <Button key={i} size="sm" className="wrap" style={{ alignSelf: "flex-start" }} onClick={() => show((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2)}>
              {t("Tiles {x0}–{x1}, {y0}–{y1}: {n, plural, one {# tile} other {# tiles}}", { x0: p.x0, x1: p.x1 - 1, y0: p.y0, y1: p.y1 - 1, n: p.tiles })}
            </Button>
          ))}
          {places.length > LISTED && <p className="hint">{t("And {n} smaller places.", { n: places.length - LISTED })}</p>}
        </>
      )}
      {units.length > 0 && (
        <>
          <p className="hint">{t("Units: {added} added, {removed} removed, {moved} moved, {changed} changed where they stand.", { added: c.unitsAdded, removed: c.unitsRemoved, moved: c.unitsMoved, changed: c.unitsChanged })}</p>
          {units.slice(0, LISTED).map((u, i) => {
            const at = { unit: unitLabel(u.unitId), x: u.x >> 5, y: u.y >> 5 };
            return (
              <Button key={i} size="sm" className="wrap" style={{ alignSelf: "flex-start" }} onClick={() => show(u.x / 32, u.y / 32)}>
                {u.change === "added" ? t("{unit} added at tile {x}, {y}", at)
                  : u.change === "removed" ? t("{unit} removed from tile {x}, {y}", at)
                  : u.change === "moved" ? t("{unit} moved to tile {x}, {y}", at)
                  : t("{unit} at tile {x}, {y}: its properties changed", at)}
              </Button>
            );
          })}
          {units.length > LISTED && <p className="hint">{t("And {n} more units.", { n: units.length - LISTED })}</p>}
        </>
      )}
      {locations.length > 0 && (
        <>
          <p className="hint">{t("{n, plural, one {# location differs} other {# locations differ}}:", { n: locations.length })}</p>
          {locations.slice(0, LISTED).map((l) => {
            const box = l.b ?? l.a!;
            // A removed location's name is the other map's to say; its slot is what both maps share.
            const name = l.b && scenario ? plainText(locationName(scenario, l.index)) : t("Location {n}", { n: l.index + 1 });
            return (
              <Button key={l.index} size="sm" className="wrap" style={{ alignSelf: "flex-start" }} onClick={() => show((box.left + box.right) / 64, (box.top + box.bottom) / 64)}>
                {l.change === "added" ? t("{name}: added", { name }) : l.change === "removed" ? t("{name}: removed", { name }) : t("{name}: moved, resized or renamed", { name })}
              </Button>
            );
          })}
          {locations.length > LISTED && <p className="hint">{t("And {n} more locations.", { n: locations.length - LISTED })}</p>}
        </>
      )}
    </div>
  );
}

/**
 * Tools ▸ Compare Maps…: hold the map in front against another open map, or against
 * itself as it is now, and see where they differ (editor/compare.ts, the comparison
 * `scmjs map diff --picture` draws). Editor state, not map data: nothing here touches
 * either scenario. What is chosen stays with the map (`compareBaseAtom`) until another
 * is chosen, and View ▸ Differences marks the map with it.
 */
export function CompareDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  const [base, setBase] = useAtom(compareBaseAtom);
  const slots = useAtomValue(documentsAtom);
  const tabs = useAtomValue(documentTabsAtom);
  const [flags, setFlags] = useAtom(viewFlagsAtom);
  const setCenter = useSetAtom(centerViewOnAtom);
  const close = useSetAtom(closeDialogAtom);
  const comparison = useCompare(true);

  // The other open maps, by the names their tabs have.
  const others = slots.flatMap((slot) => {
    const tab = tabs.find((x) => x.id === slot.id);
    return slot.parked && tab ? [{ id: slot.id, name: tabTitle(tab), scenario: slot.parked.scenario }] : [];
  });
  const chosen = base ? others.find((o) => o.scenario === base.scenario) : undefined;
  // A copy kept of this map, or a map closed since: still compared with, under the name it had.
  const kept = base && !chosen ? base : null;
  const value = chosen ? `map:${chosen.id}` : kept ? "kept" : "none";
  const choose = (v: string) => {
    if (v === "kept") return;
    const other = others.find((o) => `map:${o.id}` === v);
    setBase(other ? { name: other.name, scenario: other.scenario } : null);
  };
  const keepNow = () => {
    if (!scenario) return;
    setBase({ name: t("This map as it was at {time}", { time: new Date().toLocaleTimeString() }), scenario: scenarioCopy(scenario) });
  };
  const setShown = (on: boolean, via: "dialog") => {
    if (flags.changes !== on) countView("changes", on, via);
    setFlags({ ...flags, changes: on });
  };
  const show = (x: number, y: number) => {
    setShown(true, "dialog");
    setCenter({ x, y, animate: true });
    close(entry.key);
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={t("Compare Maps")}
      icon={<GitCompareArrows size={14} />}
      size="sm"
      footer={<Button onClick={() => close(entry.key)}>{t("Close")}</Button>}
    >
      <Group title={t("Compare this map with")}>
        <div className="col" style={{ gap: 6 }}>
          <Field label={t("Map")}>
            <Select
              value={value}
              disabled={!scenario}
              onChange={(e) => choose(e.target.value)}
              options={[
                { value: "none", label: t("Nothing") },
                ...(kept ? [{ value: "kept", label: kept.name }] : []),
                ...others.map((o) => ({ value: `map:${o.id}`, label: o.name })),
              ]}
            />
          </Field>
          <Button size="sm" style={{ alignSelf: "flex-start" }} disabled={!scenario} onClick={keepNow}>{t("Compare with this map as it is now")}</Button>
          <p className="hint">
            {others.length === 0
              ? t("No other map is open. Open another version of this map (File ▸ Open…, or File ▸ Previous Versions… for what a save replaced) and choose it here. Or keep the map as it is now, and see from here on what you change.")
              : t("The other map is the older one: what this map has and it has not is said as added. Keeping the map as it is now shows what you change from here on.")}
          </p>
        </div>
      </Group>
      {comparison && (
        <Group title={t("What differs")}>
          <Findings comparison={comparison} show={show} />
          <Check label={t("Show on the map (View ▸ Differences)")} checked={flags.changes} onChange={(e) => setShown(e.target.checked, "dialog")} />
          <p className="hint" style={{ marginTop: 6 }}>
            {t("On the map, ground that differs is magenta; what this map has more is green, what it has no longer is red where it was, and what moved or changed is yellow. Triggers, strings and settings are not compared here.")}
          </p>
        </Group>
      )}
    </DialogFrame>
  );
}
