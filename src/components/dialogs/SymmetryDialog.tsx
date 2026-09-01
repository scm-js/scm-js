import { useAtom, useAtomValue } from "jotai";
import { FlipHorizontal2 } from "lucide-react";
import { mapHeightAtom, mapWidthAtom, symmetryAtom } from "../../atoms/editorAtoms";
import { SYMMETRY_MODES, symmetryAvailable, symmetryLabel, type SymmetryMode } from "../../editor/symmetry";
import { useScenarioForm } from "../../hooks/useScenarioForm";
import { scenarioAtom } from "../../atoms/documentAtoms";
import { Check, Group } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/**
 * Tools ▸ Symmetry…: the mirror mode the Rect, Tile and Fog brushes paint under (see
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
      title="Symmetry Tool"
      icon={<FlipHorizontal2 size={14} />}
      size="sm"
      onOk={apply}
      showApply
      footerLeft={<span className="hint">{mode === "none" ? "Symmetry off" : `Current: ${symmetryLabel(mode)}`}{square ? "" : ` · ${w} × ${h} map: rotational 90° and the diagonals need a square map`}</span>}
    >
      <Group title="Mode">
        <div className="col" style={{ gap: 4 }}>
          {SYMMETRY_MODES.map((m) => {
            const disabled = m.square === true && !square;
            return (
              <label key={m.id} className="check" style={{ height: "auto", alignItems: "flex-start", opacity: disabled ? 0.55 : 1 }} title={disabled ? "Needs a square map" : m.hint}>
                <input type="radio" name="sym" checked={chosen === m.id} disabled={disabled} onChange={() => setLocal(m.id)} style={{ marginTop: 3 }} />
                <span><div>{m.label}</div><div className="hint">{disabled ? "Needs a square map" : m.hint}</div></span>
              </label>
            );
          })}
        </div>
      </Group>
      <Group title="Applies to">
        <div className="col" style={{ gap: 2 }}>
          <Check label="Terrain — Rect and Tile brushes, and their fills" checked disabled />
          <Check label="Fog of War brush and fill" checked disabled />
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          Every cell a stroke covers is painted on its mirror images too, as one undo step. The Isometric and Blend brushes are
          not mirrored — the ISOM lattice does not mirror tile by tile — and neither is object placement. The axes show on the map
          while a mode is active.
        </p>
      </Group>
    </DialogFrame>
  );
}
