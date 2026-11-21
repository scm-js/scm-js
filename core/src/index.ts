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
export { packStored, relocate, fileKey, storedInOtherForm, storedMethods, REMASTERED_ONLY_METHODS, keepStoredForm, storedFormOf, type StoredForm } from "../../src/formats/mpq/stored";
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
export { locationSlots, ANYWHERE_INDEX, isLocationUsed } from "../../src/formats/chk/sections/objects";
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
export { addUnits, removeUnits, updateUnits, moveUnits, applyUnitChanges, makeUnit, nextSerial, unitAt, unitsInBox, isResource, type UnitChange, MINERAL_FIELD_IDS, VESPENE_GEYSER, DEFAULT_MINERALS, DEFAULT_GAS, UnitUsed, UnitState } from "../../src/editor/units";
export { addLocation, editLocation, removeLocations, moveLocations, applyLocationChanges, locationName, usedLocations, placedLocations, locationCapacity, type Bounds, type LocationChange, type LocationPatch, ANYWHERE_NAME } from "../../src/editor/locations";
export {
  readPlayerSettings, applyPlayerSettings, type PlayerSettings, readForceSettings, applyForceSettings, type ForceSettings, forceName,
  readUnitSettings, applyUnitSettings, readUpgradeSettings, applyUpgradeSettings, readTechSettings, applyTechSettings,
  changeMapVersion, changeTextEncoding, unitCustomName, internString,
} from "../../src/editor/settings";
export { readSwitchNames } from "../../src/editor/switches";
export { soundList, readWavs, applySounds, type SoundRow } from "../../src/editor/sounds";
export {
  parseWavHeader, wavDuration, wavFormatLabel, type WavInfo,
  // The codec: any WAV the game or a sound tool writes read into floats (the game's IMA ADPCM included), and PCM written back.
  decodeWav, decodePcmWav, decodeImaAdpcm, encodeWav, isPlainPcm, canDecodeWav, wavFrames, wavCodecName, WAV_FORMAT, type PcmAudio, type WavBits,
} from "../../src/formats/wav";
export { resizeScenario, resizeOffset, type ResizeOptions, type ResizeResult } from "../../src/editor/resize";
// Two maps held against each other (`scmjs map diff`, the editor's Compare Maps): the tiles that differ and the places
// they make, the units added, removed, moved or changed, the locations by slot. From the first map to the second.
export { diffChanges, unitChanges, locationChanges, changedPlaces, anyChange, unitKey, locationText, TILE_KIND, MOVE_RADIUS, type Change, type DiffChanges, type DiffCounts, type UnitDifference, type LocationDifference, type TileBox, type ChangedPlace } from "../../src/editor/compare";
export { placeStartLocations, idealStarts, playableCount, DEFAULT_START_PLACEMENT, type StartLayout, type StartPlacementOptions, type StartPlacementResult } from "../../src/editor/startLocations";
export { DEFAULT_PLACEMENT, type PlacementOptions } from "../../src/editor/placement";
// Terrain and doodads as the editor lays them: the isometric brush (it needs the tileset's CV5 to say which tile joins
// which), a doodad checked against StarEdit's rule and placed, and the symmetry modes' maps (`scmjs map generate`).
export { paintIsom, paintIsomDiamonds, checkIsom, hasIsom, isomTables, diamondAt, type Diamond, type IsomEdit } from "../../src/editor/isom";
// Borrowed terrain: another tileset's isometric brush laying its ground in a tileset that holds copies of its pictures.
export {
  borrowTable, borrowableTerrains, borrowBase, copiesOf, picturesOf, providedTable, tableCounts, tilesetHash, sourceTiles,
  encodeBorrowTable, decodeBorrowTable, borrowedTerrainId, isBorrowedTerrain, borrowedParts, BORROWED_TERRAIN, BORROW_BLOCK, BORROW_PIXEL,
  TAKE_BACK, takeBackId, isTakeBack,
  type BorrowTable, type BorrowKind, type BorrowedTerrain, type Copy, type Pictures, type Slicing,
} from "../../src/editor/modTerrain/borrow";
export {
  BorrowStroke, borrowMember, BORROW_MEMBERS, encodeBorrowLattice, decodeBorrowLattice, latticeOf, baseLattice, resizeBorrowMember, borrowedCells,
  type BorrowContext, type BorrowStrokeResult,
} from "../../src/editor/modTerrain/borrowLattice";
// Copied terrain: a terrain of the tileset held again at another height, with the edge pieces it holds for it there,
// found from the tileset's files and laid by the isometric brush through a shadow lattice.
export {
  findCopyBlocks, gateBlock, edgeSetsOf, blockKey, encodeCopyBlocks, decodeCopyBlocks, KEPT_BLOCKS, GATE_FLAGS,
  type CopyBlock, type CopySource, type CopyStatus, type EdgeSetInfo,
} from "../../src/editor/modTerrain/terrainCopyTable";
export {
  CopyStroke, copyTable, relayCopies, paintCount, rankGrounds, chooseOuter, groundUnder, groundsOf, patchAt,
  COPY_MEMBER, encodeCopyMember, decodeCopyMember, resizeCopyMember, COPIED_TERRAIN, copiedTerrainId, isCopiedTerrain, copiedParts,
  type CopyTable, type CopyGround, type RankedGround, type CopyPatch, type CopyStrokeResult, type RelayResult,
} from "../../src/editor/modTerrain/terrainCopyLattice";
// Drawn borders: where borrowed ground meets the tileset's own, the tileset's border pieces, learned from maps or given.
export {
  badlandsStandIns, BADLANDS_STANDIN, standInShapes, diamondsOf, patternKey, flatTerrainsOf, BORDER_MODES,
  type StandIn, type StandIns, type BorderMode, type BorderShape, type StandInLaid,
} from "../../src/editor/modTerrain/borderLattice";
export {
  borderClasses, gatherBorderEvidence, mergeBorderEvidence, cutBorderTables, emptyBorderEvidence, encodeBorderEvidence, decodeBorderEvidence,
  sheetPool, poolOf, pairKey, pairOf, pairStandIn, hostTerrainOf, cellKind,
  type BorderEvidence, type BorderClasses, type BorderSourceCtx, type BorderPairTable, type BorderSetup,
} from "../../src/editor/modTerrain/borderTable";
export { layBorder, warmBorderPass, type BorderCell, type BorderPassResult } from "../../src/editor/modTerrain/borderPass";
export {
  bordersMember, BORDER_MEMBERS, encodeBorderRecord, decodeBorderRecord, resizeBorderRecord, emptyRecord,
  type BorderRecord,
} from "../../src/editor/modTerrain/borderRecord";
export { applyChanges, type TileChange } from "../../src/editor/terrain";
export { checkDoodadPlacement, placeDoodad, applyDoodadChanges, DEFAULT_DOODAD_PLACEMENT, type DoodadPlacementOptions, type DoodadEdit } from "../../src/editor/doodads";
export { symmetryImages, mirroredOwner, type SymmetryMode, type SymmetryImage } from "../../src/editor/symmetry";
// A tileset as its sheet (a group a row, 16 slots wide): blocks picked from it and laid, once or as a pattern; the pieces
// maps lay whole, cut from the maps' evidence a join of the sheet at a time; the same tile twice (picture and flags) and
// pieces folded by it; learning from a folder of maps; the plugins' named pieces and declared ground beside the cut.
export {
  sheetRows, runBounds, blockFromRect, blockRect, blockCells, layBlock, layPattern, patternOrigin, patternTileAt, firstTile, PatternStroke,
  HOLE, SHEET_COLUMNS, SHEET_BRIDGE, type SheetRow, type SheetRect, type TileBlock,
} from "../../src/editor/modTerrain/tileSheet";
export {
  gatherEvidence, mergeEvidence, cutPieces, pieceBlock, pieceIndex, emptyEvidence, encodeEvidence, decodeEvidence, DEFAULT_CUT,
  type PieceEvidence, type Piece, type CutOptions,
} from "../../src/editor/modTerrain/pieces";
export { learnFromMaps, piecesPerTileset, tableHash, isMapName, type LearnFile, type LearnResult, type LearnDeps, type SkipReason } from "../../src/editor/modTerrain/pieceLearn";
export {
  collapsePieces, entryPieces, uniqueTiles, sameTileKey, pictureKey, samePicture, COPY_BLOCK_MEAN, COPY_CELL_MEAN,
  type PieceEntry, type FlagDifference,
} from "../../src/editor/modTerrain/tileCopies";
export { laidPieceAt, sheetTile } from "../../src/editor/modTerrain/piecePick";
export {
  pieceSections, declaredTerrains, blockTiles, blockFits,
  type ProvidedPiece, type ProvidedPieceSet, type DeclaredTerrain, type ListedPiece, type PieceSection,
} from "../../src/editor/modTerrain/pieceList";
export { kindKey } from "../../src/editor/heal";
export { addedGroupsFrom } from "../../src/data/remasteredTiles";
// The flat ground a new map is filled with: the tileset's own tiles when it is loaded, the base-ground ids without it (as the editor does without game data).
export { baseTerrain, flatTerrain, DIRT, type BaseTerrain, type TerrainFill } from "../../src/formats/tileset/terrain";

// ── The game's own files, decoded ──
// The library carries none of them: these read what a person brings from their own copy of the game (`scmjs map preview`).
export { loadTileset, decodeCv5, CV5_ENTRY_BYTES, megatileForTile, drawMegatile, MEGATILE_PX, megatileHeight, groupBuildable, tileGroupOf, TileFlag, type Tileset, type TilesetFiles, type Cv5Group } from "../../src/formats/tileset/decode";
export { buildDoodadCatalogue, type DoodadCatalogue, type DoodadDef } from "../../src/formats/tileset/doodads";
export { decodeUnitsDat, decodeFlingyDat, decodeSpritesDat, decodeImagesDat, type UnitsDat, type FlingyDat, type SpritesDat, type ImagesDat } from "../../src/formats/dat/dat";
export { decodeIscript, type IscriptBin } from "../../src/formats/dat/iscript";
export { walkSpeed, type SpeedTables } from "../../src/formats/dat/speed";
export { unitGeometry, type UnitGeometry } from "../../src/editor/units";
export { displayColorHex } from "../../src/data/players";

// ── Mods: the game's data files read and written ──
// Every table in all three layouts (the game's .dat, DatExtend's expanded .dat, GPTP's .datex) with the width from the
// file's length; PyDAT TXT, PyTBL, PyLO, PyICE and PyAI text both ways; GRP, PCX, .lo?, .graft; PNG sheets of a GRP.
export { DAT_SCHEMAS, DAT_TABLES, datTableOf, type DatSchema, type DatField, type DatTableName, type DatValueType, type DatTextCoder } from "../../src/formats/dat/schema";
export {
  decodeDat, encodeDat, datShape, datEntrySize, datStandardSize, emptyDat, datRow, datRows, setDatRow, datFromRows, datHas, fieldType, storedRange,
  datToText, datFromText, parseDatText, DatTextError, type DatFile, type DatLayout, type DatRow, type DatShape, type DecodeDatOptions, type DatFromTextOptions, type DatTextEntry, type DatToTextOptions,
} from "../../src/formats/dat/table";
export { decodeTblFile, encodeTblFile, tblToText, tblFromText, tblEscape, tblUnescape, type TblFile } from "../../src/formats/dat/tblFile";
export { decodeGrpImage, encodeGrpImage, encodeGrpFrame, encodeGrpLine, frameFromPicture, framePicture, opaqueBox, type GrpImage, type GrpFramePixels } from "../../src/formats/dat/grpFile";
export { decodePcxImage, encodePcxImage, type PcxImage } from "../../src/formats/dat/pcxFile";
export { decodeLoFile, encodeLoFile, loToText, loFromText, type LoOverlays, type EncodeLoOptions } from "../../src/formats/dat/loFile";
export {
  iscriptToText, iscriptFromText, readIscriptHeaders, iscriptEntryCount, ISCRIPT_OPCODES, ISCRIPT_ANIMS, ISCRIPT_TYPE_ANIMS, IscriptTextError,
  type IscriptOpcode, type IscriptArgKind, type IscriptEntryRule, type IscriptHeaderInfo, type IscriptToTextOptions, type IscriptFromTextOptions,
} from "../../src/formats/dat/iscriptText";
export {
  aiscriptToText, aiscriptFromText, aiStringText, AI_OPCODES, AI_ENUMS, AI_FLAGS, AI_SCRIPT_FLAGS, AiScriptTextError,
  type AiOpcode, type AiArgKind, type AiNames, type AiScriptFiles, type AiScriptToTextOptions, type AiScriptFromTextOptions,
} from "../../src/formats/dat/aiscript";
export {
  decodeReqGraft, encodeReqGraft, reqGraftToText, reqGraftFromText, decodeButtonGraft, encodeButtonGraft, buttonGraftToText, buttonGraftFromText, GraftTextError,
  type ReqGraft, type ButtonGraft, type GraftButton,
} from "../../src/formats/dat/graft";
export { decodePng, encodePng, isPng, inflate, deflate, type PngImage, type EncodePngInput } from "../../src/formats/png";
export { grpToPng, pngToGrp, sheetColumns, type GrpToPngOptions, type NamedPalette, type PngToGrpOptions, type QuantiseReport } from "../../src/formats/dat/grpPng";

// ── Mods: a mod as a folder of text and pictures ──
// What a mod comes in (a folder, an MPQ, a self-executing exe, a zip), the folder's form both ways with the check that
// keeps a text only when it packs back to the same bytes, the lints across tables, and a changelog between two mods.
// Reading a mod is `@scm-js/mod`'s (a dependency): these names are its, re-exported so that code written against
// earlier releases of this library keeps working; `readMod` and the description are there too. The hash's helpers
// this library had keep their signatures over it (`legacy.ts`), deprecated in favour of `readMod`'s `identity`.
export {
  GAME_FOLDERS, SYSTEM_FILES, isSystemFile, GAME_ARCHIVES, gameCopyFiles, modRoot, programEnd, libraryName, isMpq, isZip, isExe, readZip,
  sha256Hex as fileDigest, ModError as ModSourceError, PatcherError, hashLines, hashLinesAsWere, isSystemLine, isPluginFile,
  isCodeFile as isModCode, probeNames, readMod, MOD_MESSAGES, renderMessage,
  type CarriedModule as PatcherPlugin, type ZipMember, type ModDescription, type ModFiles, type ModMessage, type Identity,
} from "@scm-js/mod";
export {
  gameName, pluginLine, firegraftLine, exeArchive, modHash, modHashOfDigests, dataSetHash, dataSetHashOfDigests, gameLine, isFiregraftProject,
  type ExeArchive, type ModHash, type ModHashInput, type Digest,
} from "../../src/formats/mod/legacy";
export {
  MOD_MANIFEST, MOD_FORMAT, MOD_FOLDERS, DEFAULT_PALETTE, emptyManifest, readManifest, folderPath, memberPath, placeOf, memberOf, aiNames, renderMember, renderAiScripts, packFile,
  recordRendered, tidyManifest, ModFolderError,
  type MemberForm, type ModTable, type ModCarried, type ModManifest, type ModNames, type RenderContext, type Rendered, type PackContext,
} from "../../src/formats/mod/folder";
export { loadModData, namesOf, entryText, flatRow, rowChanges, ownEntry, NAME_TEXT_FILES, nameFileText, nameList, statTextEntries, statWithText, type ReadMember, type ModData } from "../../src/formats/mod/data";
export { checkMod, GAME_ISCRIPT_LAST, type ModFinding, type CheckFiles } from "../../src/formats/mod/check";
export { diffMods, type ModChange, type ModChangeKind, type DiffSide } from "../../src/formats/mod/diff";
// Races a data set adds to the game's own: the table `mod.json`'s `races` holds, a race's name by its byte, the hints a
// mod's files give, and which of the game's three races a list of units plays as.
export { sameRaces, raceLabel, raceChoices, hasRaceCandidates, racePlaysAs, GAME_RACE_NAMES, FIRST_DATASET_RACE } from "../../src/formats/mod/races";
export {
  readTerrainFile, writeTerrainFile, withTerrainSection, sectionAgainstTable, terrainFileCounts, isTerrainFilePath, terrainFileOf,
  emptyTerrainFile, emptyTerrainSection, TERRAIN_FILE, TERRAIN_FORMAT, TERRAIN_LIMITS,
  type TerrainFile, type TerrainFileSection, type TerrainFilePiece, type TerrainFileTerrain, type TerrainFileBorrow, type TerrainFileBorder, type TerrainFileCopy, type TerrainDrop, type TerrainDropReason, type TerrainFileRead,
} from "../../src/formats/mod/terrain";
export { normalizeRaces, raceCandidates, MAX_RACE_NAME as RACE_NAME_MAX, GAME_NETWORK_TBL_ENTRIES, type DataSetRace, type RaceCandidates } from "@scm-js/mod";

// ── Names and tables ──
export { TILESETS, TILESET_BY_ID, MAP_SIZES, type TilesetId, type TilesetInfo } from "../../src/data/tilesets";
export { UNIT_NAMES, UNIT_TYPE_COUNT, START_LOCATION, unitName, UPGRADE_NAMES, TECH_NAMES, upgradeName, techName, type RaceKey } from "../../src/data/units";
export { WEAPON_NAMES, weaponName } from "../../src/data/weapons";
export { PLAYER_TYPES, PLAYER_RACES, PLAYER_COLORS, playerTypeLabel, playerRaceLabel, playerColorHex, type PlayerColor } from "../../src/data/players";

// ── Plugins ──
export { validateManifest, resolveIcon } from "../../src/plugins/loader";
export { PLUGIN_API_VERSION, type PluginManifest, type PluginIcon } from "../../src/plugins/api";
