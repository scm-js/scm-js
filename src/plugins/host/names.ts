/**
 * `api.consts`, `api.names` and `api.text`: the editor's own tables, handed over by identity or by name.
 */
import { t } from "../../i18n";
import { mapTilesetAtom } from "../../atoms/editorAtoms";
import { scenarioAtom, tilesetFileNameAtom } from "../../atoms/documentAtoms";
import { TILESET_BY_ID } from "../../data/tilesets";
import { peekTileset, type LoadedTileset } from "../../formats/tileset/load";
import { tileInfo } from "../../formats/tileset/palette";
import { PLAYER_TYPES, playerTypeLabel } from "../../data/players";
import { dataSetRaceLabel, dataSetRaces } from "../../data/races";
import { raceChoices } from "../../formats/mod/races";
import { TECH_NAMES, techName, UNIT_NAMES, unitName, unitTypeCount, UPGRADE_NAMES, upgradeName, START_LOCATION } from "../../data/units";
import { WEAPON_NAMES, weaponName } from "../../data/weapons";
import { ACTION_DEFS, actionDef, aiScriptName, BRIEFING_ACTION_DEFS, CONDITION_DEFS, conditionDef, DEATHS_TABLE_ADDRESS, PLAYER_GROUP_CHOICES, UNIT_CLASS_CHOICES } from "../../data/triggerDefs";
import { ActionFlag, ActionType, AllianceStatus, BriefingActionType, Comparison, ConditionFlag, ConditionType, Order, PlayerGroup, ResourceType, ScoreType, SetModifier, SwitchAction, SwitchState, TriggerFlag, UnitClass, UnitState as TriggerUnitState } from "../../formats/chk/sections/triggers";
import { getString } from "../../formats/chk/sections/strings";
import { locationName } from "../../editor/locations";
import { readSwitchNames } from "../../editor/switches";
import { bleedingLines, DEFAULT_TEXT_COLOR, escapeCode, fixBleeding, flattenStacks, INSERTABLE_CODES, plainText, runsOf, stackedLines, TEXT_CODES, textCode } from "../../editor/textColors";
import { ANYWHERE_INDEX, Elevation, SpriteFlag, UnitRelation, UnitState, UnitUsed, UnitValid } from "../../formats/chk/sections/objects";
import { DEFAULT_GAS, DEFAULT_MINERALS, isResource, MINERAL_FIELD_IDS, TILE_PX, VESPENE_GEYSER } from "../../editor/units";
import type { ConstsApi, NamesApi, TextApi } from "../api";
import type { Store } from "./shared";

/**
 * Handed over rather than published in the typings: the package is types only, so a
 * value imported from it is undefined at run time (see `ConstsApi`).
 */
export function constsApi(): ConstsApi {
  return {
    tile: TILE_PX,
    unit: {
      startLocation: START_LOCATION,
      mineralFields: MINERAL_FIELD_IDS,
      vespeneGeyser: VESPENE_GEYSER,
      defaultMinerals: DEFAULT_MINERALS,
      defaultGas: DEFAULT_GAS,
      valid: UnitValid,
      used: UnitUsed,
      state: UnitState,
      relation: UnitRelation,
    },
    sprite: { flags: SpriteFlag },
    location: { anywhere: ANYWHERE_INDEX, elevation: Elevation },
    // By identity, like the masks above: these are the codec's own tables, so a plugin
    // reading `type === api.consts.triggers.condition.Bring` is comparing against the
    // number `sections/triggers.ts` writes, not a copy that can drift from it.
    triggers: {
      condition: ConditionType,
      action: ActionType,
      briefingAction: BriefingActionType,
      player: PlayerGroup,
      comparison: Comparison,
      switchState: SwitchState,
      switchAction: SwitchAction,
      modifier: SetModifier,
      unitState: TriggerUnitState,
      order: Order,
      alliance: AllianceStatus,
      resource: ResourceType,
      score: ScoreType,
      unitClass: UnitClass,
      conditionFlags: ConditionFlag,
      actionFlags: ActionFlag,
      triggerFlags: TriggerFlag,
      deathsTable: DEATHS_TABLE_ADDRESS,
      maskedRecord: 0x4353,
    },
    isResource,
  };
}

/** `api.names`: the names the editor shows for ids. */
export function namesApi(store: Store): NamesApi {
  const scenario = () => store.get(scenarioAtom);
  const loaded = (): LoadedTileset | null => peekTileset(store.get(tilesetFileNameAtom));
  const names = () => TILESET_BY_ID[store.get(mapTilesetAtom)].terrain;
  return {
    unit: (id) => UNIT_CLASS_CHOICES.find((c) => c.value === id)?.label ?? (id === UNIT_NAMES.length ? "None" : unitName(id)),
    // 228 is the game's "None", between the types and the classes: listed so that an entry's place is its value.
    // A data set with more types lists the rest after the classes, from 233, where their place is their value again.
    units: () => [
      ...UNIT_NAMES.map((_, id) => ({ value: id, label: unitName(id) })), { value: UNIT_NAMES.length, label: "None" }, ...UNIT_CLASS_CHOICES.map((c) => ({ value: c.value, label: c.label })),
      ...Array.from({ length: Math.max(0, unitTypeCount() - 233) }, (_, i) => ({ value: 233 + i, label: unitName(233 + i) })),
    ],
    upgrade: upgradeName,
    upgrades: () => UPGRADE_NAMES.map((_, id) => ({ value: id, label: upgradeName(id) })),
    tech: techName,
    techs: () => TECH_NAMES.map((_, id) => ({ value: id, label: techName(id) })),
    weapon: weaponName,
    weapons: () => WEAPON_NAMES.map((_, id) => ({ value: id, label: weaponName(id) })),
    playerType: playerTypeLabel,
    playerTypes: () => PLAYER_TYPES.map((t) => ({ value: t.value, label: t.label })),
    race: (value) => dataSetRaceLabel(value),
    races: () => raceChoices(dataSetRaces()),
    playerGroup: (value) => PLAYER_GROUP_CHOICES.find((c) => c.value === value)?.label ?? `Group ${value}`,
    playerGroups: () => PLAYER_GROUP_CHOICES.map((c) => ({ value: c.value, label: c.label })),
    condition: (type) => (type === 0 ? "None" : conditionDef(type)?.name ?? `Condition ${type}`),
    conditions: () => [{ value: 0, label: t("None") }, ...CONDITION_DEFS.map((d) => ({ value: d.type, label: d.name })).sort((a, b) => a.value - b.value)],
    action: (type, briefing = false) => (type === 0 ? "None" : actionDef(type, briefing)?.name ?? `Action ${type}`),
    actions: (briefing = false) => [{ value: 0, label: t("None") }, ...(briefing ? BRIEFING_ACTION_DEFS : ACTION_DEFS).map((d) => ({ value: d.type, label: d.name })).sort((a, b) => a.value - b.value)],
    aiScript: aiScriptName,
    string: (index) => { const scn = scenario(); return scn ? getString(scn.strings, index) : null; },
    location: (index) => { const scn = scenario(); return scn ? locationName(scn, index) : `Location ${index}`; },
    switch: (index) => { const scn = scenario(); return (scn && readSwitchNames(scn)[index]) || `Switch ${index + 1}`; },
    player: (slot) => `Player ${slot + 1}`,
    tile: (id) => { const l = loaded(); return l ? tileInfo(l.tileset, names(), id).label : null; },
  };
}

/**
 * Pure and map-independent: the whole of it is `editor/textColors.ts`, handed over so
 * a plugin that shows or rewrites map text does not carry its own copy of the table.
 */
export function textApi(): TextApi {
  return {
    codes: () => [...TEXT_CODES],
    code: (byte) => textCode(byte) ?? null,
    insertable: () => [...INSERTABLE_CODES],
    defaultColor: () => DEFAULT_TEXT_COLOR,
    runs: (text, options) => runsOf(text, options),
    plain: plainText,
    escape: escapeCode,
    bleedingLines,
    fixBleeding,
    stackedLines,
    flattenStacks,
  };
}
