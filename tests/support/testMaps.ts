/**
 * The maps in `tests/maps/`, as the code that makes them. They are built from nothing but
 * the editor's own code — no tileset, no archive, no file of Blizzard's — so they can be
 * committed, and a test run without game data (CI) still opens real `.scx` / `.scm` files.
 *
 *   npm run test:maps        # write them again after changing this file
 *
 * `tests/maps.test.ts` rebuilds each one and compares it with the committed file, so a
 * change here without that command fails. Terrain is the one thing these maps do not
 * have: laying real terrain needs a tileset, and the suites that check it keep using
 * `fixtures/maps/`.
 */
import { createScenario } from "../../src/formats/chk/create";
import { markDirty, serializeScenario, setMapVersion, type MapVersion, type Scenario } from "../../src/formats/chk/scenario";
import { saveMap, type ArchiveCompression } from "../../src/formats/mpq/scm";
import { PlayerRace, PlayerType, ColorMode, defaultPlayerRgb } from "../../src/formats/chk/sections/players";
import { SpriteFlag, UnitState, UnitUsed, type UnitRecord } from "../../src/formats/chk/sections/objects";
import { ActionType, BriefingActionType, ConditionType, PlayerGroup } from "../../src/formats/chk/sections/triggers";
import { CuwpField, CuwpState, CuwpValid } from "../../src/formats/chk/sections/cuwp";
import { cloneUnitSettings } from "../../src/formats/chk/sections/settings";
import { internString } from "../../src/editor/settings";
import { applySounds, wavMemberName } from "../../src/editor/sounds";
import { newAction, newCondition, newTrigger } from "../../src/editor/triggers";
import { encodeWav } from "../../src/formats/wav";

export interface TestMap {
  /** File name in `tests/maps/`. */
  name: string;
  scenario: Scenario;
  /** Archive members besides the scenario, name → bytes. */
  extras: Map<string, Uint8Array>;
  compress: ArchiveCompression;
  encrypt: boolean;
  /** Whether the archive names its members; a protected map does not. */
  listfile: boolean;
}

const W = 64, H = 64;
const UNIT = { marine: 0, ghost: 1, zergling: 37, carrier: 72, commandCenter: 106, mineral: 176, geyser: 188, start: 214 };
const px = (tile: number) => tile * 32 + 16;

/** The original sections' names, which a 1.00 or hybrid file carries next to (or instead of) the `x` ones. */
const ORIGINAL_TABLES = ["UNIS", "UPGS", "TECS", "UPGR", "PTEC"];
const EXPANSION_TABLES = ["UNIx", "UPGx", "TECx", "PUPx", "PTEx"];

function revision(scn: Scenario, version: MapVersion) {
  setMapVersion(scn, version);
  if (version === "original" || version === "hybrid") markDirty(scn, ...ORIGINAL_TABLES);
  if (version === "original") for (const name of EXPANSION_TABLES) scn.dirty.delete(name);
}

function unit(serial: number, unitId: number, owner: number, tx: number, ty: number, extra: Partial<UnitRecord> = {}): UnitRecord {
  return {
    serial, x: px(tx), y: px(ty), unitId, relationType: 0, validProperties: 0, validStates: 0,
    owner, hitPointsPercent: 100, shieldPercent: 100, energyPercent: 100, resourceAmount: 0, hangarUnits: 0,
    stateFlags: 0, unused: 0, relatedSerial: 0, ...extra,
  };
}

function setLocation(scn: Scenario, index: number, name: string, tx0: number, ty0: number, tx1: number, ty1: number) {
  scn.locations[index] = { left: tx0 * 32, top: ty0 * 32, right: tx1 * 32, bottom: ty1 * 32, nameIndex: internString(scn, name), elevationFlags: 0 };
  markDirty(scn, "MRGN");
}

/**
 * A two-player map: a start location each, a mineral line and a geyser beside it. The
 * tile numbers are the null tile throughout, as a map is before any terrain is laid.
 */
function base(name: string, description: string, era: number): Scenario {
  const scn = createScenario({ width: W, height: H, era, name, description });
  scn.playerTypes = scn.playerTypes.map((t, i) => (i < 2 ? PlayerType.Human : i < 8 ? PlayerType.Inactive : t));
  scn.editorPlayerTypes = [...scn.playerTypes];
  scn.playerRaces = scn.playerRaces.map((r, i) => (i >= 2 && i < 8 ? PlayerRace.Inactive : r));
  let serial = 1;
  const resources = { validProperties: 0, validStates: UnitUsed.Resources };
  for (const [owner, bx, by, dy] of [[0, 10, 54, -1], [1, 54, 10, 1]] as const) {
    scn.units.push(unit(serial++, UNIT.start, owner, bx, by));
    for (let i = 0; i < 6; i++) scn.units.push(unit(serial++, UNIT.mineral, 11, bx - 5 + i * 2, by + dy * 6, { ...resources, resourceAmount: 1500 }));
    scn.units.push(unit(serial++, UNIT.geyser, 11, bx + 8, by + dy * 2, { ...resources, resourceAmount: 5000 }));
  }
  markDirty(scn, "OWNR", "IOWN", "SIDE", "UNIT");
  return scn;
}

/** The plain melee map: nothing but the base, in the archive layout StarEdit writes. */
function melee(): TestMap {
  const scn = base("Test Melee", "Two start locations and their resources.", 4);
  return { name: "melee.scx", scenario: scn, extras: new Map(), compress: "pkware", encrypt: true, listfile: true };
}

/** A second of a 440 Hz tone at 11 kHz, 8 bits: a sound member that is nobody's recording. */
function tone(): Uint8Array {
  const rate = 11025;
  const samples = Float32Array.from({ length: rate }, (_, i) => Math.round(Math.sin((i * 440 * 2 * Math.PI) / rate) * 64) / 128);
  return encodeWav([samples], rate, 8);
}

/**
 * The Use Map Settings map: forces, locations, triggers of several kinds, a briefing, a
 * sound in the archive, a used unit-properties slot, a renamed unit, sprites and placed
 * units with properties — one of everything the editor models outside terrain.
 */
function ums(): TestMap {
  const scn = base("Test Scenario", "Triggers, a briefing, locations, a sound and unit settings.", 0);
  const extras = new Map<string, Uint8Array>();

  // Player 2 is a Zerg computer in a force of its own.
  scn.playerTypes[1] = scn.editorPlayerTypes[1] = PlayerType.Computer;
  scn.playerRaces[0] = PlayerRace.Terran;
  scn.playerRaces[1] = PlayerRace.Zerg;
  scn.forces.playerForce = [0, 1, 0, 0, 0, 0, 0, 0];
  scn.forces.nameIndex[0] = internString(scn, "Defenders");
  scn.forces.nameIndex[1] = internString(scn, "Swarm");
  scn.forces.flags = [0x0e, 0x0e, 0, 0];
  markDirty(scn, "OWNR", "IOWN", "SIDE", "FORC");

  let serial = scn.units.length + 1;
  scn.units.push(
    unit(serial++, UNIT.commandCenter, 0, 10, 54),
    unit(serial++, UNIT.marine, 0, 14, 50, { validStates: UnitUsed.HitPoints, hitPointsPercent: 50 }),
    unit(serial++, UNIT.ghost, 0, 15, 50, { validProperties: UnitState.Cloaked, validStates: UnitUsed.Energy | UnitUsed.State, energyPercent: 75, stateFlags: UnitState.Cloaked }),
    unit(serial++, UNIT.carrier, 0, 18, 48, { validStates: UnitUsed.Hangar, hangarUnits: 4 }),
    unit(serial++, UNIT.zergling, 1, 50, 14, { validProperties: UnitState.Burrowed, validStates: UnitUsed.State, stateFlags: UnitState.Burrowed }),
  );
  scn.sprites.push(
    { spriteId: 318, x: px(30), y: px(30), owner: 0, unused: 0, flags: SpriteFlag.PureSprite },
    { spriteId: UNIT.marine, x: px(32), y: px(30), owner: 0, unused: 0, flags: 0 },
  );
  markDirty(scn, "UNIT", "THG2");

  setLocation(scn, 0, "Base", 6, 50, 16, 58);
  setLocation(scn, 1, "Nest", 48, 6, 58, 16);
  setLocation(scn, 2, "Middle", 28, 28, 36, 36);

  // A Marine with a name and numbers of its own.
  const settings = cloneUnitSettings(scn.unitSettings);
  settings.useDefault[UNIT.marine] = 0;
  settings.hitPoints[UNIT.marine] = 80 * 256;
  settings.armor[UNIT.marine] = 2;
  settings.buildTime[UNIT.marine] = 300;
  settings.mineralCost[UNIT.marine] = 75;
  settings.nameIndex[UNIT.marine] = internString(scn, "Test Marine");
  scn.unitSettings = settings;
  markDirty(scn, "UNIx");

  // Slot 1 of the unit properties, used by the Create Unit with Properties below.
  scn.cuwp[0] = {
    ...scn.cuwp[0], validProperties: CuwpValid.Invincible, validFields: CuwpField.HitPoints | CuwpField.Energy,
    hitPointsPercent: 60, energyPercent: 100, stateFlags: CuwpState.Invincible,
  };
  scn.cuwpUsed[0] = true;
  markDirty(scn, "UPRP", "UPUS");

  const member = wavMemberName("tone.wav");
  extras.set(member, tone());
  const wavs = scn.wavs!.slice();
  wavs[0] = internString(scn, member);
  applySounds(scn, wavs);

  scn.switchNames = Array.from({ length: 256 }, () => 0);
  scn.switchNames[0] = internString(scn, "Alarm raised");
  markDirty(scn, "SWNM");

  const greet = newTrigger([PlayerGroup.Player1]);
  greet.conditions.push(newCondition(ConditionType.Always));
  greet.actions.push(
    { ...newAction(ActionType.DisplayText), text: internString(scn, "Hold the base.") },
    { ...newAction(ActionType.PlayWav), wav: wavs[0], time: 1000 },
    { ...newAction(ActionType.SetMissionObjectives), text: internString(scn, "Bring a Marine to the middle.") },
    { ...newAction(ActionType.Comment), text: internString(scn, "Opening") },
  );

  const reinforce = newTrigger([PlayerGroup.Player1]);
  reinforce.conditions.push({ ...newCondition(ConditionType.Bring), player: PlayerGroup.Player1, unitId: UNIT.marine, location: 3, amount: 1 });
  reinforce.actions.push(
    { ...newAction(ActionType.CreateUnitWithProperties), player: PlayerGroup.Player1, unitId: UNIT.ghost, modifier: 2, location: 1, target: 1 },
    { ...newAction(ActionType.SetSwitch), target: 0 },
    { ...newAction(ActionType.PreserveTrigger) },
  );

  const win = newTrigger([PlayerGroup.Force1]);
  win.conditions.push({ ...newCondition(ConditionType.Switch), resource: 0 });
  win.actions.push({ ...newAction(ActionType.Victory) });

  scn.triggers = [greet, reinforce, win];

  const brief = newTrigger([PlayerGroup.Player1]);
  brief.conditions.push(newCondition(ConditionType.Briefing));
  brief.actions.push(
    { ...newAction(BriefingActionType.TextMessage, true), text: internString(scn, "The swarm is nesting to the north."), time: 4000 },
    { ...newAction(BriefingActionType.MissionObjectives, true), text: internString(scn, "Reach the middle of the map.") },
  );
  scn.briefing = [brief];
  markDirty(scn, "TRIG", "MBRF");

  return { name: "ums.scx", scenario: scn, extras, compress: "zlib", encrypt: false, listfile: true };
}

/** A StarCraft 1.00 file: the original settings sections only, in an uncompressed archive. */
function original(): TestMap {
  const scn = base("Test Original", "A StarCraft 1.00 file.", 1);
  revision(scn, "original");
  const hello = newTrigger([PlayerGroup.AllPlayers]);
  hello.conditions.push(newCondition(ConditionType.Always));
  hello.actions.push({ ...newAction(ActionType.DisplayText), text: internString(scn, "An original map.") });
  scn.triggers = [hello];
  markDirty(scn, "TRIG");
  return { name: "original.scm", scenario: scn, extras: new Map(), compress: "none", encrypt: false, listfile: true };
}

/** A hybrid file: both sets of settings sections. */
function hybrid(): TestMap {
  const scn = base("Test Hybrid", "A hybrid file, with both sets of settings sections.", 2);
  revision(scn, "hybrid");
  return { name: "hybrid.scm", scenario: scn, extras: new Map(), compress: "pkware", encrypt: false, listfile: true };
}

/**
 * A Remastered file — the wide string table, text outside Latin-1 and the players' own
 * colours — in an archive without a file list, as a protector leaves one.
 */
function remastered(): TestMap {
  const scn = base("Test Remastered 리마스터", "A Remastered file with STRx and CRGB.", 6);
  revision(scn, "remastered");
  const rgb = defaultPlayerRgb();
  rgb.mode[0] = ColorMode.Custom;
  rgb.rgb[0] = [0x20, 0x90, 0xd0];
  scn.playerRgb = rgb;
  markDirty(scn, "CRGB");
  setLocation(scn, 0, "시작", 6, 50, 16, 58);
  return { name: "remastered.scx", scenario: scn, extras: new Map(), compress: "zlib", encrypt: true, listfile: false };
}

/** Every map of `tests/maps/`, built afresh. */
export function testMaps(): TestMap[] {
  return [melee(), ums(), original(), hybrid(), remastered()];
}

/** The `.scx` / `.scm` bytes of one. */
export function buildTestMap(map: TestMap): Promise<Uint8Array> {
  return saveMap(serializeScenario(map.scenario), { extras: map.extras, compress: map.compress, encrypt: map.encrypt, listfile: map.listfile });
}
