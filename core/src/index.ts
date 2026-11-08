/**
 * `@scm-js/core`: the editor's reading, checking and editing of StarCraft maps, as a library.
 *
 * This file is the package's whole public surface. Everything it names is the code the
 * editor itself runs — the same modules, built from the same tree (`scripts/build-core.mjs`)
 * — so a map reads and writes here exactly as it does in scmJS of the same version. Nothing
 * here reaches the browser: `tests/core.test.ts` walks the modules behind these exports and
 * refuses a value import of the UI (`atoms/`, `components/`, `hooks/`, the plugin host, React,
 * Jotai), and the declaration bundle refuses a type from them. `docs/core.md` is the guide.
 *
 * Adding to the surface is one line here. Taking from it is a breaking change for whoever
 * imports the name, so an export stays once released, or goes with a note in the guide.
 */

// ── Files ──
export { openMapBytes, writeMapBytes, type OpenedMap, type WriteOptions, readArchive, type ArchiveContents, writeArchiveBytes, type WriteArchiveOptions } from "../../src/editor/mapFile";
export { loadMap, readMembers, readExtras, looksLikeMpq, memberInfo, MapLoadError, SCENARIO_PATH, type LoadedMap, type MemberInfo, type StoredMembers, type ArchiveMembers, type ArchiveCompression } from "../../src/formats/mpq/scm";
export { type MapFormat, type SaveOptions, DEFAULT_SAVE_OPTIONS, SAVE_PRESETS, formatOf, defaultSaveOptions, planSave, buildChk, keptExtras, buildMapFile, type SavePlan, type PlannedSection, type PlannedExtra, type SectionFate, extraKind, type ExtraKind, formatBytes } from "../../src/editor/save";
export { type BuiltBy, type BuildManifest, readBuildManifest, restoreBuiltMap, type Restored, packBuiltMap, type PackInput, BUILD_SOURCE_MEMBER, BUILD_MANIFEST_MEMBER } from "../../src/editor/mapBuild";

// ── The scenario ──
// `unitSettingsSections` and its kin: which of a revision pair (UNIS/UNIx, …) a change to that table marks dirty — what
// the file has, or its revision needs (`scmjs map merge` writes the tables directly).
export {
  parseScenario, serializeScenario, type Scenario, type SectionName, MODELLED_SECTIONS,
  scenarioName, scenarioDescription, setScenarioName, setScenarioDescription, markDirty,
  type MapVersion, MAP_VERSIONS, mapVersionOf, isExpansion, isRemasteredRevision, setMapVersion,
  type TilesetIndex, tilesetIndex, setTextEncoding, setExtendedStrings,
  unitSettingsSections, upgradeSettingsSections, upgradeRestrictionSections, techSettingsSections, techRestrictionSections,
  encodeSection,
} from "../../src/formats/chk/scenario";
export { createScenario, type CreateScenarioOptions, type GameKind, requiredSections, REQUIRED_SECTIONS } from "../../src/formats/chk/create";
export { parseChk, serializeChk, type ChkFile, type ChkSection } from "../../src/formats/chk/reader";
export { type TextEncoding, TEXT_ENCODINGS, DEFAULT_TEXT_ENCODING, decodeText } from "../../src/formats/text/encoding";

// Section records, as `Scenario` holds them.
export type { UnitRecord, SpriteRecord, DoodadRecord, LocationRecord } from "../../src/formats/chk/sections/objects";
export type { ConditionRecord, ActionRecord, TriggerRecord, ReadonlyTrigger } from "../../src/formats/chk/sections/triggers";
// The numbers a condition or action record holds, by name.
export { ConditionType, ActionType, PlayerGroup, Comparison, SwitchState, SwitchAction, SetModifier, ResourceType, UnitClass } from "../../src/formats/chk/sections/triggers";
export { PlayerType, PlayerRace, ColorMode, ForceFlag, PLAYER_SLOTS, FORCE_SLOTS, type Forces, type PlayerRgb } from "../../src/formats/chk/sections/players";
export type { UnitSettings, UnitAvailability, UpgradeSettings, UpgradeRestrictions, TechSettings, TechRestrictions } from "../../src/formats/chk/sections/settings";
// Each settings table as a map has it before anyone opens its dialog (every entry on the game's own values).
export { defaultUnitSettings, defaultUnitAvailability, defaultUpgradeSettings, defaultUpgradeRestrictions, defaultTechSettings, defaultTechRestrictions } from "../../src/formats/chk/sections/settings";
// How many location slots MRGN holds in a file of a revision (64 below VER 63, 255 from it).
export { locationSlots } from "../../src/formats/chk/sections/objects";
export type { StringTable } from "../../src/formats/chk/sections/strings";
export type { CuwpSlot } from "../../src/formats/chk/sections/cuwp";

// ── Describing and checking ──
export { mapStatistics, statisticsText, type MapStatistics, type PlayerStatistics } from "../../src/editor/statistics";
export { validateScenario, issueCounts, type Issue, type IssueLevel, type IssueTarget, type ValidateContext, UNIT_LIMIT, STRX_CAPACITY } from "../../src/editor/validate";
export { findInScenario, FIND_KINDS, type FindKind, type FindOptions, type FindResult } from "../../src/editor/find";

// ── Triggers and the briefing ──
export { readTriggers, applyTriggers, readBriefing, applyBriefing, newTrigger, newCondition, newAction, triggerNames, triggerUsage, isPreserved, setPreserved, fingerprintTrigger, sameTriggers, TRIGGER_OWNERS } from "../../src/editor/triggers";
export { triggersToText, triggersFromText, readTriggerFile, triggerFormatOf, type TriggerFileFormat, encodeTrg, decodeTrg } from "../../src/editor/exchange";
export { formatTrigger, formatTriggers, parseTriggers, summarizeTrigger, triggerComment, TriggerTextError, type TriggerNames, type TextTrigger } from "../../src/formats/triggers/text";
// What each trigger reads, writes and names (`memory` is an EUD address: a death counter out of range).
export { triggerReferences, type TriggerRef, type TriggerRefs, type TriggerRefKind } from "../../src/editor/triggerRefs";
export { CONDITION_DEFS, ACTION_DEFS, BRIEFING_ACTION_DEFS, conditionDef, conditionDefByName, actionDef, actionDefByName, type ConditionDef, type ActionDef, type ArgDef, type ArgKind, CHOICES, choiceLabel, choiceValue, AI_SCRIPT_NAMES, aiScriptName, aiScriptByName } from "../../src/data/triggerDefs";

// ── Strings and text ──
export { readStrings, applyStrings, stringUsages, unusedStrings, deleteUnused, stringCapacity, type StringUsage, type StringUsageKind } from "../../src/editor/strings";
export { formatStringTable, parseStringTable, applyStringImport, escapeStringText, unescapeStringText, type StringImport } from "../../src/editor/exchange";
export { plainText, runsOf, TEXT_CODES, textCode } from "../../src/editor/textColors";

// ── Units, locations and settings ──
export { addUnits, removeUnits, updateUnits, moveUnits, applyUnitChanges, makeUnit, nextSerial, unitAt, unitsInBox, isResource, type UnitChange, MINERAL_FIELD_IDS, VESPENE_GEYSER, DEFAULT_MINERALS, DEFAULT_GAS, UnitUsed } from "../../src/editor/units";
export { addLocation, editLocation, removeLocations, moveLocations, applyLocationChanges, locationName, usedLocations, placedLocations, locationCapacity, type Bounds, type LocationChange, type LocationPatch, ANYWHERE_NAME } from "../../src/editor/locations";
export {
  readPlayerSettings, applyPlayerSettings, type PlayerSettings, readForceSettings, applyForceSettings, type ForceSettings, forceName,
  readUnitSettings, applyUnitSettings, readUpgradeSettings, applyUpgradeSettings, readTechSettings, applyTechSettings,
  changeMapVersion, changeTextEncoding, unitCustomName, internString,
} from "../../src/editor/settings";
export { readSwitchNames } from "../../src/editor/switches";
export { soundList, readWavs, applySounds, type SoundRow } from "../../src/editor/sounds";
export { parseWavHeader, wavDuration, wavFormatLabel, type WavInfo } from "../../src/formats/wav";
export { resizeScenario, type ResizeOptions, type ResizeResult } from "../../src/editor/resize";
export { placeStartLocations, idealStarts, playableCount, DEFAULT_START_PLACEMENT, type StartLayout, type StartPlacementOptions, type StartPlacementResult } from "../../src/editor/startLocations";
export { DEFAULT_PLACEMENT, type PlacementOptions } from "../../src/editor/placement";
// Terrain and doodads as the editor lays them: the isometric brush (it needs the tileset's CV5 to say which tile joins
// which), a doodad checked against StarEdit's rule and placed, and the symmetry modes' maps (`scmjs map generate`).
export { paintIsom, paintIsomDiamonds, checkIsom, hasIsom, isomTables, diamondAt, type Diamond, type IsomEdit } from "../../src/editor/isom";
export { applyChanges, type TileChange } from "../../src/editor/terrain";
export { checkDoodadPlacement, placeDoodad, applyDoodadChanges, DEFAULT_DOODAD_PLACEMENT, type DoodadPlacementOptions, type DoodadEdit } from "../../src/editor/doodads";
export { symmetryImages, mirroredOwner, type SymmetryMode, type SymmetryImage } from "../../src/editor/symmetry";
// The flat ground a new map is filled with: the tileset's own tiles when it is loaded, the base-ground ids without it (as the editor does without game data).
export { baseTerrain, flatTerrain, DIRT, type BaseTerrain, type TerrainFill } from "../../src/formats/tileset/terrain";

// ── The game's own files, decoded ──
// The library carries none of them: these read what a person brings from their own copy of the game (`scmjs map preview`).
export { loadTileset, megatileForTile, drawMegatile, MEGATILE_PX, megatileHeight, groupBuildable, tileGroupOf, TileFlag, type Tileset, type TilesetFiles } from "../../src/formats/tileset/decode";
export { buildDoodadCatalogue, type DoodadCatalogue, type DoodadDef } from "../../src/formats/tileset/doodads";
export { decodeUnitsDat, decodeFlingyDat, decodeSpritesDat, decodeImagesDat, type UnitsDat, type FlingyDat, type SpritesDat, type ImagesDat } from "../../src/formats/dat/dat";
export { decodeIscript, type IscriptBin } from "../../src/formats/dat/iscript";
export { walkSpeed, type SpeedTables } from "../../src/formats/dat/speed";
export { unitGeometry, type UnitGeometry } from "../../src/editor/units";
export { displayColorHex } from "../../src/data/players";

// ── Names and tables ──
export { TILESETS, TILESET_BY_ID, MAP_SIZES, type TilesetId, type TilesetInfo } from "../../src/data/tilesets";
export { UNIT_NAMES, UNIT_TYPE_COUNT, START_LOCATION, unitName, UPGRADE_NAMES, TECH_NAMES, upgradeName, techName, type RaceKey } from "../../src/data/units";
export { WEAPON_NAMES, weaponName } from "../../src/data/weapons";
export { PLAYER_TYPES, PLAYER_RACES, PLAYER_COLORS, playerTypeLabel, playerRaceLabel, playerColorHex, type PlayerColor } from "../../src/data/players";

// ── Plugins ──
export { validateManifest, resolveIcon } from "../../src/plugins/loader";
export { PLUGIN_API_VERSION, type PluginManifest, type PluginIcon } from "../../src/plugins/api";
