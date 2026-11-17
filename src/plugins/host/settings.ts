/**
 * `api.settings`: the Scenario menu's tables, read without a transaction.
 */
import { archiveExtrasAtom, scenarioAtom } from "../../atoms/documentAtoms";
import { peekUnitAssets } from "../../formats/units/load";
import { isUnusedTech, isUnusedUpgrade, UNIT_NAMES as UNIT_NAME_TABLE } from "../../data/units";
import { cuwpSlotView, cuwpSlotViews } from "../../editor/cuwp";
import { forceViews, mapVersionView, playerSlotViews, techView, unitTypeView, upgradeView } from "../../editor/settings";
import { soundList } from "../../editor/sounds";
import { TECHS_BW, UNIT_TYPES, UPGRADES_BW, isUnitAvailable } from "../../formats/chk/sections/settings";
import type { SettingsApi, UnitTypeView } from "../api";
import type { Store } from "./shared";

/** `api.settings`: the dialogs' tables without a transaction. */
export function settingsApi(store: Store): SettingsApi {
  const scenario = () => store.get(scenarioAtom);
  const units = () => peekUnitAssets()?.units ?? null;
  const weapons = () => peekUnitAssets()?.weapons ?? null;
  const upgrades = () => peekUnitAssets()?.upgrades ?? null;
  const techs = () => peekUnitAssets()?.techs ?? null;
  return {
    players: () => { const scn = scenario(); return scn ? playerSlotViews(scn) : []; },
    player: (slot) => { const scn = scenario(); return scn ? playerSlotViews(scn)[slot] ?? null : null; },
    forces: () => { const scn = scenario(); return scn ? forceViews(scn) : []; },
    unitType: (id) => { const scn = scenario(); return scn && id >= 0 && id < UNIT_TYPES ? unitTypeView(scn, id, units(), weapons()) : null; },
    unitTypes: () => {
      const scn = scenario();
      if (!scn) return [];
      const out: UnitTypeView[] = [];
      for (let id = 0; id < UNIT_TYPES; id++) if (UNIT_NAME_TABLE[id]) out.push(unitTypeView(scn, id, units(), weapons()));
      return out;
    },
    upgrade: (id) => { const scn = scenario(); return scn && id >= 0 && id < UPGRADES_BW ? upgradeView(scn, id, upgrades()) : null; },
    upgrades: () => { const scn = scenario(); return scn ? Array.from({ length: UPGRADES_BW }, (_, id) => id).filter((id) => !isUnusedUpgrade(id)).map((id) => upgradeView(scn, id, upgrades())) : []; },
    tech: (id) => { const scn = scenario(); return scn && id >= 0 && id < TECHS_BW ? techView(scn, id, techs()) : null; },
    techs: () => { const scn = scenario(); return scn ? Array.from({ length: TECHS_BW }, (_, id) => id).filter((id) => !isUnusedTech(id)).map((id) => techView(scn, id, techs())) : []; },
    sounds: () => { const scn = scenario(); return scn ? soundList(scn, store.get(archiveExtrasAtom)) : []; },
    unitAvailable: (player, id) => { const scn = scenario(); return scn?.unitAvailability ? isUnitAvailable(scn.unitAvailability, player, id) : true; },
    cuwpSlots: () => { const scn = scenario(); return scn ? cuwpSlotViews(scn) : []; },
    cuwpSlot: (index) => { const scn = scenario(); return scn ? cuwpSlotView(scn, index) : null; },
    version: () => { const scn = scenario(); return scn ? mapVersionView(scn) : null; },
  };
}
