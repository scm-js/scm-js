import { useAtom, useAtomValue } from "jotai";
import { FlipHorizontal2 } from "lucide-react";
import { mapHeightAtom, mapWidthAtom, symmetryAtom, symmetryOptionsAtom } from "../../atoms/editorAtoms";
import { SYMMETRY_MODES, symmetryAvailable, symmetryLabel, type SymmetryMode } from "../../editor/symmetry";
import { useScenarioForm } from "../../hooks/useScenarioForm";
import { scenarioAtom } from "../../atoms/documentAtoms";
import { hotkeysAtom } from "../../atoms/preferencesAtoms";
import { shortcutOf } from "../../editor/commands";
import { Check, Group } from "../ui";
import { SymmetryIcon } from "../ui/SymmetryIcon";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";
import { t, translate } from "../../i18n";

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
                <span><div>{translate(m.label)}</div><div className="hint">{disabled ? t("Needs a square map") : translate(m.hint)}</div></span>
              </label>
            );
          })}
        </div>
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
