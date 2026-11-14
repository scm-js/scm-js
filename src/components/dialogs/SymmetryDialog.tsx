import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { FlipHorizontal2 } from "lucide-react";
import { centerViewOnAtom, mapHeightAtom, mapWidthAtom, symmetryAtom, symmetryOptionsAtom, viewFlagsAtom } from "../../atoms/editorAtoms";
import { closeDialogAtom } from "../../atoms/uiAtoms";
import { useTileset } from "../../hooks/useTileset";
import { useFairness, type Fairness } from "../../hooks/useFairness";
import { unitLabel } from "../../data/units";
import { SYMMETRY_MODES, symmetryAvailable, symmetryLabel, type SymmetryMode } from "../../editor/symmetry";
import { useScenarioForm } from "../../hooks/useScenarioForm";
import { scenarioAtom } from "../../atoms/documentAtoms";
import { hotkeysAtom } from "../../atoms/preferencesAtoms";
import { shortcutOf } from "../../editor/commands";
import { Button, Check, Group } from "../ui";
import { SymmetryIcon } from "../ui/SymmetryIcon";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";
import { t, translate } from "../../i18n";

/** A share as a percentage, rounded down so that 100% is said only of a map with no difference at all. */
const percent = (share: number) => `${(Math.floor(share * 1000) / 10).toFixed(1)}%`;

/** How many places the dialog lists; the overlay shows the rest. */
const LISTED = 6;

/**
 * The map held against the chosen mode (editor/fairness.ts): how much of its ground plays
 * alike on every side, the largest places where it does not, and the resources with no
 * equal counterpart. A place is a button: it applies the mode, turns View ▸ Symmetry
 * Differences on and goes there.
 */
function FairnessLines({ fairness, chosen, closeKey, apply }: { fairness: Fairness | null; chosen: SymmetryMode; closeKey: number; apply: () => void }) {
  const [flags, setFlags] = useAtom(viewFlagsAtom);
  const setCenter = useSetAtom(centerViewOnAtom);
  const close = useSetAtom(closeDialogAtom);
  if (!fairness) return <p className="hint">{t("How symmetric the map is can be measured once the tileset graphics are installed (Help ▸ Game Data…).")}</p>;
  const { report, likely, mode } = fairness;
  /** Go to a place, in tiles, with the mode applied and the differences drawn. */
  const show = (x: number, y: number) => {
    apply();
    setFlags({ ...flags, asymmetry: true });
    setCenter({ x, y, animate: true });
    close(closeKey);
  };
  // Flat ground is its own image whichever way it is turned: nothing to read a symmetry from.
  const flat = Object.values(fairness.shares).every((share) => share === 1);
  const about = chosen !== "none" ? null
    : flat ? t("The ground is the same on every side under every mode: there is nothing on it yet to tell them apart.")
    : likely
      ? t("The ground is most alike under {mode}, so the map was probably made with it.", { mode: symmetryLabel(likely) })
      : t("The ground is not alike under any mode: the map was not made with a mirror or a turn.");
  return (
    <div className="col" style={{ gap: 6 }}>
      {about && <p className="hint">{about}</p>}
      {report && mode && !(flat && chosen === "none") && (
        <>
          <p className="hint">
            {report.unlike === 0
              ? t("Under {mode} every small square of ground walks, stands and builds as its image does.", { mode: symmetryLabel(mode) })
              : t("Under {mode}, {share} of the ground plays alike on every side. {n, plural, one {# small square differs} other {# small squares differ}} in {places, plural, one {# place} other {# places}}: {walk} in walking, {height} in height, {build} in building.", { mode: symmetryLabel(mode), share: percent(report.alike), n: report.unlike, places: report.places.length, walk: report.walk, height: report.height, build: report.build })}
          </p>
          {report.places.slice(0, LISTED).map((p, i) => (
            <Button key={i} size="sm" style={{ justifySelf: "start", alignSelf: "flex-start" }} onClick={() => show((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2)}>
              {t("Tiles {x0}–{x1}, {y0}–{y1}: {n, plural, one {# small square} other {# small squares}}", { x0: p.x0, x1: p.x1 - 1, y0: p.y0, y1: p.y1 - 1, n: p.squares })}
            </Button>
          ))}
          {report.places.length > LISTED && <p className="hint">{t("And {n} smaller places.", { n: report.places.length - LISTED })}</p>}
          {report.resources.length > 0 && (
            <>
              <p className="hint">{t("{n, plural, one {# mineral field, geyser or start location has} other {# mineral fields, geysers or start locations have}} no equal counterpart:", { n: report.resources.length })}</p>
              {report.resources.slice(0, LISTED).map((r) => (
                <Button key={r.index} size="sm" style={{ alignSelf: "flex-start" }} onClick={() => show(r.x / 32, r.y / 32)}>
                  {r.why === "amount"
                    ? t("{unit} at tile {x}, {y}: its counterpart holds another amount", { unit: unitLabel(r.unitId), x: r.x >> 5, y: r.y >> 5 })
                    : t("{unit} at tile {x}, {y}: nothing of its kind at its image", { unit: unitLabel(r.unitId), x: r.x >> 5, y: r.y >> 5 })}
                </Button>
              ))}
            </>
          )}
          <Check label={t("Show on the map (View ▸ Symmetry Differences)")} checked={flags.asymmetry} onChange={(e) => setFlags({ ...flags, asymmetry: e.target.checked })} />
        </>
      )}
    </div>
  );
}

/**
 * Tools ▸ Symmetry…: the mirror mode the brushes paint and the palettes place under (see
 * editor/symmetry.ts), and whether copies go to their own players. Editor state, not map
 * data — nothing here touches the scenario — but it is a settings-style transaction all
 * the same: OK applies, Cancel leaves both as they were. Modes that need a square map are
 * listed but disabled on a map that is not. The toolbar and M switch the mode without it.
 */
export function SymmetryDialog({ entry }: DialogProps) {
  const [mode, setMode] = useAtom(symmetryAtom);
  const [options, setOptions] = useAtom(symmetryOptionsAtom);
  const w = useAtomValue(mapWidthAtom);
  const h = useAtomValue(mapHeightAtom);
  const scenario = useAtomValue(scenarioAtom);
  const toggleKey = shortcutOf(useAtomValue(hotkeysAtom), "tools.symmetry");
  // Re-read when a map opens under the dialog, like the settings dialogs do.
  const [local, setLocal] = useScenarioForm(scenario, () => ({ mode, players: options.players }));
  const chosen: SymmetryMode = local?.mode ?? mode;
  const players = local?.players ?? options.players;
  const square = w === h;
  const { loaded } = useTileset();
  const fairness = useFairness(true, loaded?.tileset ?? null, chosen);
  const apply = () => {
    setMode(symmetryAvailable(chosen, w, h) ? chosen : "none");
    if (players !== options.players) setOptions((o) => ({ ...o, players }));
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={t("Symmetry Tool")}
      icon={<FlipHorizontal2 size={14} />}
      size="sm"
      onOk={apply}
      showApply
      footerLeft={<span className="hint">{mode === "none" ? t("Symmetry off") : t("Current: {symmetryLabel}", { symmetryLabel: symmetryLabel(mode) })}{square ? "" : t(" · {w} × {h} map: rotational 90° and the diagonals need a square map", { w, h })}</span>}
    >
      <Group title={t("Mode")}>
        <div className="col" style={{ gap: 4 }}>
          {SYMMETRY_MODES.map((m) => {
            const disabled = m.square === true && !square;
            return (
              <label key={m.id} className="check" style={{ height: "auto", alignItems: "flex-start", opacity: disabled ? 0.55 : 1 }} title={disabled ? t("Needs a square map") : translate(m.hint)}>
                <input type="radio" name="sym" checked={chosen === m.id} disabled={disabled} onChange={() => setLocal({ mode: m.id, players })} style={{ marginTop: 3 }} />
                <span style={{ marginTop: 2 }}><SymmetryIcon mode={m.id} /></span>
                <span style={{ flex: 1, minWidth: 0 }}><div>{translate(m.label)}</div><div className="hint">{disabled ? t("Needs a square map") : translate(m.hint)}</div></span>
                {fairness?.shares[m.id] !== undefined && (
                  <span className={fairness.likely === m.id ? "mono" : "mono faint"} style={{ flex: "none" }} title={t("How much of the map's ground plays alike on every side under this mode")}>{percent(fairness.shares[m.id]!)}</span>
                )}
              </label>
            );
          })}
        </div>
      </Group>
      <Group title={t("The map as it is")}>
        <FairnessLines fairness={fairness} chosen={chosen} closeKey={entry.key} apply={apply} />
      </Group>
      <Group title={t("Mirrored copies")}>
        <Check label={t("Give each copy its own player")} checked={players} onChange={(e) => setLocal({ mode: chosen, players: e.target.checked })} />
        <p className="hint" style={{ marginTop: 4 }}>
          {t("A unit, sprite or doodad placed for Player 1 is copied for Player 2 under the two-way modes, and for Players 2, 3 and 4 under the four-way ones, so each start location and base goes to a different player. Players 5–8 pair up the same way. Neutral units, resources among them, stay neutral.")}
        </p>
      </Group>
      <Group title={t("What is mirrored")}>
        <p className="hint">
          {t("The terrain brushes (all but Blend), the fills and the fog brush also paint on the mirror images. A unit, sprite, doodad or location you place lands on each image of the spot as well, checked against the placement rules one by one; a doodad that would have to turn is skipped. Selecting a unit, sprite, doodad or location also selects whatever stands at its images, so moving, resizing a location and Delete act on them all, and moved copies stay mirror images. Each change is one undo step.")}
        </p>
        <p className="hint" style={{ marginTop: 6 }}>
          {toggleKey ? t("{key} or the toolbar button turns symmetry off and on again.", { key: toggleKey }) : t("The toolbar button turns symmetry off and on again.")}
        </p>
      </Group>
    </DialogFrame>
  );
}
