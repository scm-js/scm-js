import { useAtom, useAtomValue } from "jotai";
import { FlipHorizontal2 } from "lucide-react";
import { mapHeightAtom, mapWidthAtom, symmetryAtom } from "../../atoms/editorAtoms";
import { SYMMETRY_MODES, symmetryAvailable, symmetryLabel, type SymmetryMode } from "../../editor/symmetry";
import { useScenarioForm } from "../../hooks/useScenarioForm";
import { scenarioAtom } from "../../atoms/documentAtoms";
import { Check, Group } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";
import { t, translate } from "../../i18n";

/**
 * Tools ▸ Symmetry…: the mirror mode the brushes paint and the palettes place under (see
 * editor/symmetry.ts). Editor state, not map data — nothing here touches the scenario —
 * but it is a settings-style transaction all the same: OK applies, Cancel leaves the mode
 * as it was. Modes that need a square map are listed but disabled on a map that is not.
 */
export function SymmetryDialog({ entry }: DialogProps) {
  const [mode, setMode] = useAtom(symmetryAtom);
  const w = useAtomValue(mapWidthAtom);
  const h = useAtomValue(mapHeightAtom);
  const scenario = useAtomValue(scenarioAtom);
  // Re-read when a map opens under the dialog, like the settings dialogs do.
  const [local, setLocal] = useScenarioForm(scenario, () => mode);
  const chosen: SymmetryMode = local ?? mode;
  const square = w === h;
  const apply = () => setMode(symmetryAvailable(chosen, w, h) ? chosen : "none");

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
                <input type="radio" name="sym" checked={chosen === m.id} disabled={disabled} onChange={() => setLocal(m.id)} style={{ marginTop: 3 }} />
                <span><div>{translate(m.label)}</div><div className="hint">{disabled ? t("Needs a square map") : translate(m.hint)}</div></span>
              </label>
            );
          })}
        </div>
      </Group>
      <Group title={t("Applies to")}>
        <div className="col" style={{ gap: 2 }}>
          <Check label={t("Terrain — Isometric, Rect and Tile brushes, and the fills")} checked disabled />
          <Check label={t("Fog of War brush and fill")} checked disabled />
          <Check label={t("Placing units, sprites, doodads and locations")} checked disabled />
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          {t("Every cell a stroke covers is painted on its mirror images too, and a unit, sprite, doodad or location you place lands on each image of the spot as well (checked against the placement rules one by one; a doodad that would have to turn is skipped) — one undo step each time. Moving and deleting objects is not mirrored, and neither is the Blend brush, which places from a picked anchor. The axes show on the map while a mode is active.")}
        </p>
      </Group>
    </DialogFrame>
  );
}
