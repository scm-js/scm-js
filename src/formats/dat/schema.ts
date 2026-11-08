/**
 * Every field of every `arr\*.dat` table, as data: what the game's tables hold, in file order, with the names PyMS
 * gives them (so a table exported here as PyDAT TXT reads in PyDAT, and the other way round).
 *
 * A table is a struct of arrays: field 1 for every entry, then field 2 for every entry, and so on. Three layouts are
 * in use, and `table.ts` reads all three, taking the width (how many entries) from the file's length:
 *
 *  - **dat**, the game's own: a fixed count (228 units, 130 weapons, …), and a few columns that exist only for a
 *    range of ids (`first` / `count` below — units.dat's infestation column covers ids 106–201 only, the sounds a unit
 *    says when selected cover 0–105). units.dat from before Brood War also lacks its last two columns (`legacy`).
 *  - **expanded**, DatExtend's as PyMS reads it: any count, every column at the full count, and units.dat's flingy
 *    column widened to u16 (`expanded`). PyMS adds rules for units (a multiple of 12, 250–912, ids 228–250 reserved);
 *    they are not a property of the file, so nothing here enforces them.
 *  - **datex**, GPTP's DatExtend (`*.datex`): no header, every column at the full count, and units.dat's flingy, ground
 *    weapon and air weapon columns and orders.dat's weapon column widened to u16 (`datex`). The count is the file's
 *    size over the entry size (99 bytes a unit). GPTP's own limits (3,000 units, …) are its build's, not the file's.
 *
 * The schema is plain JSON-able data (`JSON.stringify(DAT_SCHEMAS)`), so it can be published and read by other tools.
 * Field meanings and pointers follow PyMS (`FileFormats/DAT/*.py`, Help/Files/DAT) and GPTP's DatExtend sources; the
 * code of neither is included here. Sources and licenses: ../../../ATTRIBUTION.md
 */

export type DatValueType = "u8" | "u16" | "u32";

/** How PyDAT TXT writes a value that is not a plain number. */
export type DatTextCoder =
  /** 0 → False, 1 → True, anything else as the number. */
  | { kind: "bool" }
  /** One line a bit: `field.name True|False`; `names[bit]` names it, "" for `flag_0xNN`. */
  | { kind: "flags"; bits: number; names: readonly string[] }
  /** `whole` = value >> 8, `fraction` = value & 0xFF (units.dat hit points are 24.8 fixed point). */
  | { kind: "hitPoints" }
  /** `whole` = value >> 1, `half` = value & 1 (supply is counted in halves). */
  | { kind: "supply" };

export interface DatField {
  /** PyDAT TXT's name for the field; also the column's key. */
  name: string;
  /** The value's width in the standard layout. */
  type: DatValueType;
  /** A small struct of `type` values an entry (placement box, extents): the part names, in file order. */
  parts?: readonly string[];
  /** Standard layout only: the field is stored for ids `first` to `first + count - 1` and nothing else. */
  first?: number;
  count?: number;
  /** The width in DatExtend's expanded layout (PyMS), when it differs. */
  expanded?: DatValueType;
  /** The width in GPTP's `.datex`, when it differs. */
  datex?: DatValueType;
  /** How PyDAT TXT writes it, when not as a plain number. */
  text?: DatTextCoder;
  /** PyDAT TXT's dotted name when it is not `name` (portdata's `idle.portrait_file`). */
  textName?: string;
  /** What the value points at: a table (`flingy`, …), a string table (`stat_txt.tbl`), `iscript.bin`, `cmdicons.grp`. */
  ref?: string;
  /** Absent from the original (pre-Brood War) game's units.dat. */
  broodWar?: true;
}

export type DatTableName = "units" | "weapons" | "flingy" | "sprites" | "images" | "upgrades" | "techdata" | "orders" | "sfxdata" | "portdata" | "mapdata";

export interface DatSchema {
  table: DatTableName;
  /** The file's name in the game's archives. */
  file: string;
  /** Entries in the game's own file. */
  entries: number;
  /** The entry header PyDAT TXT writes: `Unit(0):`. */
  textType: string;
  fields: readonly DatField[];
  /** PyMS's rules for an expanded file of this table; informational (see the module comment). */
  expandedRules?: { min?: number; max?: number; multiple?: number; reserved?: readonly [number, number] };
  /** GPTP DatExtend's id limit for the table (`dat_limits.h`); informational — the width is always the file's. */
  datexLimit?: number;
  /** PyDAT TXT's line order when it is not field order (portdata groups idle and talking). */
  textOrder?: readonly string[];
}

const bool: DatTextCoder = { kind: "bool" };

const SPECIAL_ABILITY_FLAGS = [
  "building", "addon", "flyer", "resource_miner", "subunit", "flying_building", "hero", "regenerate",
  "animated_idle", "cloakable", "two_units_in_one_egg", "single_entity", "resource_depot", "resource_container", "robotic", "detector",
  "organic", "requires_creep", "unused", "requires_psi", "burrowable", "spellcaster", "permanent_cloak", "pickup_item",
  "ignores_supply_check", "use_medium_overlays", "use_large_overlays", "battle_reactions", "full_auto_attack", "invincible", "mechanical", "produces_units",
];
const GROUP_FLAGS = ["zerg", "terran", "protoss", "men", "building", "factory", "independent", "neutral"];
const AVAILABILITY_FLAGS = ["non_neutral", "unit_listing", "mission_briefing", "player_settings", "all_races", "set_doodad_state", "non_location_triggers", "unit_hero_settings", "location_triggers", "broodwar_only"];
const TARGET_FLAGS = ["air", "ground", "mechanical", "organic", "non_building", "non_robotic", "terrain", "organic_or_mechanical", "own"];
const SOUND_FLAGS = ["preload", "unit_speech", "", "", "one_at_a_time", "never_preempt"];

const UNITS: DatSchema = {
  table: "units", file: "arr\\units.dat", entries: 228, textType: "Unit",
  expandedRules: { min: 250, max: 912, multiple: 12, reserved: [228, 250] }, datexLimit: 3000,
  fields: [
    { name: "graphics", type: "u8", expanded: "u16", datex: "u16", ref: "flingy" },
    { name: "subunit1", type: "u16", ref: "units" },
    { name: "subunit2", type: "u16", ref: "units" },
    { name: "infestation", type: "u16", first: 106, count: 96, ref: "units" },
    { name: "construction_animation", type: "u32", ref: "images" },
    { name: "unit_direction", type: "u8" },
    { name: "shield_enabled", type: "u8" },
    { name: "shield_amount", type: "u16" },
    { name: "hit_points", type: "u32", text: { kind: "hitPoints" } },
    { name: "elevation_level", type: "u8" },
    { name: "unknown_flags", type: "u8", text: { kind: "flags", bits: 8, names: [] } },
    { name: "sublabel", type: "u8", ref: "stat_txt.tbl" },
    { name: "comp_ai_idle", type: "u8", ref: "orders" },
    { name: "human_ai_idle", type: "u8", ref: "orders" },
    { name: "return_to_idle", type: "u8", ref: "orders" },
    { name: "attack_unit", type: "u8", ref: "orders" },
    { name: "attack_move", type: "u8", ref: "orders" },
    { name: "ground_weapon", type: "u8", datex: "u16", ref: "weapons" },
    { name: "max_ground_hits", type: "u8" },
    { name: "air_weapon", type: "u8", datex: "u16", ref: "weapons" },
    { name: "max_air_hits", type: "u8" },
    { name: "ai_internal", type: "u8" },
    { name: "special_ability_flags", type: "u32", text: { kind: "flags", bits: 32, names: SPECIAL_ABILITY_FLAGS } },
    { name: "target_acquisition_range", type: "u8" },
    { name: "sight_range", type: "u8" },
    { name: "armor_upgrade", type: "u8", ref: "upgrades" },
    { name: "unit_size", type: "u8" },
    { name: "armor", type: "u8" },
    { name: "right_click_action", type: "u8" },
    { name: "ready_sound", type: "u16", first: 0, count: 106, ref: "sfxdata" },
    { name: "what_sound_start", type: "u16", ref: "sfxdata" },
    { name: "what_sound_end", type: "u16", ref: "sfxdata" },
    { name: "pissed_sound_start", type: "u16", first: 0, count: 106, ref: "sfxdata" },
    { name: "pissed_sound_end", type: "u16", first: 0, count: 106, ref: "sfxdata" },
    { name: "yes_sound_start", type: "u16", first: 0, count: 106, ref: "sfxdata" },
    { name: "yes_sound_end", type: "u16", first: 0, count: 106, ref: "sfxdata" },
    { name: "staredit_placement_size", type: "u16", parts: ["width", "height"] },
    { name: "addon_position", type: "u16", parts: ["x", "y"], first: 106, count: 96 },
    { name: "unit_extents", type: "u16", parts: ["left", "up", "right", "down"] },
    { name: "portrait", type: "u16", ref: "portdata" },
    { name: "mineral_cost", type: "u16" },
    { name: "vespene_cost", type: "u16" },
    { name: "build_time", type: "u16" },
    { name: "requirements", type: "u16" },
    { name: "staredit_group_flags", type: "u8", text: { kind: "flags", bits: 8, names: GROUP_FLAGS } },
    { name: "supply_provided", type: "u8", text: { kind: "supply" } },
    { name: "supply_required", type: "u8", text: { kind: "supply" } },
    { name: "space_required", type: "u8" },
    { name: "space_provided", type: "u8" },
    { name: "build_score", type: "u16" },
    { name: "destroy_score", type: "u16" },
    { name: "unit_map_string", type: "u16", ref: "stat_txt.tbl" },
    { name: "broodwar_unit_flag", type: "u8", broodWar: true },
    { name: "staredit_availability_flags", type: "u16", text: { kind: "flags", bits: 10, names: AVAILABILITY_FLAGS }, broodWar: true },
  ],
};

const WEAPONS: DatSchema = {
  table: "weapons", file: "arr\\weapons.dat", entries: 130, textType: "Weapon", expandedRules: { max: 255 }, datexLimit: 1001,
  fields: [
    { name: "label", type: "u16", ref: "stat_txt.tbl" },
    { name: "graphics", type: "u32", ref: "flingy" },
    { name: "unused_technology", type: "u8", ref: "techdata" },
    { name: "target_flags", type: "u16", text: { kind: "flags", bits: 9, names: TARGET_FLAGS } },
    { name: "minimum_range", type: "u32" },
    { name: "maximum_range", type: "u32" },
    { name: "damage_upgrade", type: "u8", ref: "upgrades" },
    { name: "weapon_type", type: "u8" },
    { name: "weapon_behavior", type: "u8" },
    { name: "remove_after", type: "u8" },
    { name: "explosion_type", type: "u8" },
    { name: "inner_splash_range", type: "u16" },
    { name: "medium_splash_range", type: "u16" },
    { name: "outer_splash_range", type: "u16" },
    { name: "damage_amount", type: "u16" },
    { name: "damage_bonus", type: "u16" },
    { name: "weapon_cooldown", type: "u8" },
    { name: "damage_factor", type: "u8" },
    { name: "attack_angle", type: "u8" },
    { name: "launch_spin", type: "u8" },
    { name: "forward_offset", type: "u8" },
    { name: "upward_offset", type: "u8" },
    { name: "target_error_message", type: "u16", ref: "stat_txt.tbl" },
    { name: "icon", type: "u16", ref: "cmdicons.grp" },
  ],
};

const FLINGY: DatSchema = {
  table: "flingy", file: "arr\\flingy.dat", entries: 209, textType: "Flingy", expandedRules: { max: 65536 }, datexLimit: 1000,
  fields: [
    { name: "sprite", type: "u16", ref: "sprites" },
    { name: "speed", type: "u32" },
    { name: "acceleration", type: "u16" },
    { name: "halt_distance", type: "u32" },
    { name: "turn_radius", type: "u8" },
    { name: "iscript_mask", type: "u8" },
    { name: "movement_control", type: "u8" },
  ],
};

const SPRITES: DatSchema = {
  table: "sprites", file: "arr\\sprites.dat", entries: 517, textType: "Sprite", expandedRules: { max: 65536 }, datexLimit: 2000,
  fields: [
    { name: "image", type: "u16", ref: "images" },
    { name: "health_bar", type: "u8", first: 130, count: 387 },
    { name: "unused", type: "u8", text: bool },
    { name: "is_visible", type: "u8", text: bool },
    { name: "selection_circle_image", type: "u8", first: 130, count: 387, ref: "images" },
    { name: "selection_circle_offset", type: "u8", first: 130, count: 387 },
  ],
};

const IMAGES: DatSchema = {
  table: "images", file: "arr\\images.dat", entries: 999, textType: "Image", expandedRules: { max: 65536 }, datexLimit: 5000,
  fields: [
    { name: "grp_file", type: "u32", ref: "images.tbl" },
    { name: "gfx_turns", type: "u8", text: bool },
    { name: "clickable", type: "u8", text: bool },
    { name: "use_full_iscript", type: "u8", text: bool },
    { name: "draw_if_cloaked", type: "u8", text: bool },
    { name: "draw_function", type: "u8" },
    { name: "remapping", type: "u8" },
    { name: "iscript_id", type: "u32", ref: "iscript.bin" },
    { name: "shield_overlay", type: "u32", ref: "images.tbl" },
    { name: "attack_overlay", type: "u32", ref: "images.tbl" },
    { name: "damage_overlay", type: "u32", ref: "images.tbl" },
    { name: "special_overlay", type: "u32", ref: "images.tbl" },
    { name: "landing_dust_overlay", type: "u32", ref: "images.tbl" },
    { name: "lift_off_dust_overlay", type: "u32", ref: "images.tbl" },
  ],
};

const UPGRADES: DatSchema = {
  table: "upgrades", file: "arr\\upgrades.dat", entries: 61, textType: "Upgrade", expandedRules: { max: 256 }, datexLimit: 100,
  fields: [
    { name: "mineral_cost_base", type: "u16" },
    { name: "mineral_cost_factor", type: "u16" },
    { name: "vespene_cost_base", type: "u16" },
    { name: "vespene_cost_factor", type: "u16" },
    { name: "research_time_base", type: "u16" },
    { name: "research_time_factor", type: "u16" },
    { name: "requirements", type: "u16" },
    { name: "icon", type: "u16", ref: "cmdicons.grp" },
    { name: "label", type: "u16", ref: "stat_txt.tbl" },
    { name: "staredit_race", type: "u8" },
    { name: "max_repeats", type: "u8" },
    { name: "broodwar_only", type: "u8", text: bool },
  ],
};

const TECHDATA: DatSchema = {
  table: "techdata", file: "arr\\techdata.dat", entries: 44, textType: "Technology", expandedRules: { max: 255 }, datexLimit: 100,
  fields: [
    { name: "mineral_cost", type: "u16" },
    { name: "vespene_cost", type: "u16" },
    { name: "research_time", type: "u16" },
    { name: "energy_required", type: "u16" },
    { name: "research_requirements", type: "u16" },
    { name: "use_requirements", type: "u16" },
    { name: "icon", type: "u16", ref: "cmdicons.grp" },
    { name: "label", type: "u16", ref: "stat_txt.tbl" },
    { name: "staredit_race", type: "u8" },
    { name: "researched", type: "u8", text: bool },
    { name: "broodwar_only", type: "u8", text: bool },
  ],
};

const ORDERS: DatSchema = {
  table: "orders", file: "arr\\orders.dat", entries: 189, textType: "Order", expandedRules: { max: 255 }, datexLimit: 500,
  fields: [
    { name: "label", type: "u16", ref: "stat_txt.tbl" },
    { name: "use_weapon_targeting", type: "u8", text: bool },
    { name: "unused_is_secondary", type: "u8", text: bool },
    { name: "unused_allow_non_subunits", type: "u8", text: bool },
    { name: "changes_subunit_order", type: "u8", text: bool },
    { name: "unused_allow_subunits", type: "u8", text: bool },
    { name: "interruptable", type: "u8", text: bool },
    { name: "waypoints_slowdown", type: "u8", text: bool },
    { name: "queueable", type: "u8", text: bool },
    { name: "disabled_maintain_unit_target", type: "u8", text: bool },
    { name: "obstructable", type: "u8", text: bool },
    { name: "flee_unreturnable_damage", type: "u8", text: bool },
    { name: "unused_requires_movable_unit", type: "u8", text: bool },
    { name: "weapon_targeting", type: "u8", datex: "u16", ref: "weapons" },
    { name: "technology_energy", type: "u8", ref: "techdata" },
    { name: "iscript_animation", type: "u8" },
    { name: "highlight_icon", type: "u16", ref: "cmdicons.grp" },
    { name: "requirements", type: "u16" },
    { name: "obscured_order", type: "u8", ref: "orders" },
  ],
};

const SFXDATA: DatSchema = {
  table: "sfxdata", file: "arr\\sfxdata.dat", entries: 1144, textType: "Sound", expandedRules: { max: 65536 },
  fields: [
    { name: "sound_file", type: "u32", ref: "sfxdata.tbl" },
    { name: "priority", type: "u8" },
    { name: "flags", type: "u8", text: { kind: "flags", bits: 6, names: SOUND_FLAGS } },
    { name: "portrait_length_adjust", type: "u16" },
    { name: "minimum_volume", type: "u8" },
  ],
};

const PORTDATA: DatSchema = {
  table: "portdata", file: "arr\\portdata.dat", entries: 110, textType: "Portraits", expandedRules: { max: 65535 }, datexLimit: 1003,
  fields: [
    { name: "idle_portrait_file", type: "u32", textName: "idle.portrait_file", ref: "portdata.tbl" },
    { name: "talking_portrait_file", type: "u32", textName: "talking.portrait_file", ref: "portdata.tbl" },
    { name: "idle_smk_change", type: "u8", textName: "idle.smk_change" },
    { name: "talking_smk_change", type: "u8", textName: "talking.smk_change" },
    { name: "idle_unknown", type: "u8", textName: "idle.unknown" },
    { name: "talking_unknown", type: "u8", textName: "talking.unknown" },
  ],
  textOrder: ["idle_portrait_file", "idle_smk_change", "idle_unknown", "talking_portrait_file", "talking_smk_change", "talking_unknown"],
};

const MAPDATA: DatSchema = {
  table: "mapdata", file: "arr\\mapdata.dat", entries: 65, textType: "Map", datexLimit: 65,
  fields: [{ name: "map_file", type: "u32", ref: "mapdata.tbl" }],
};

/** The eleven tables, by name. */
export const DAT_SCHEMAS: Readonly<Record<DatTableName, DatSchema>> = {
  units: UNITS, weapons: WEAPONS, flingy: FLINGY, sprites: SPRITES, images: IMAGES, upgrades: UPGRADES,
  techdata: TECHDATA, orders: ORDERS, sfxdata: SFXDATA, portdata: PORTDATA, mapdata: MAPDATA,
};

export const DAT_TABLES = Object.keys(DAT_SCHEMAS) as DatTableName[];

/** The table a file name is for (`units.dat`, `arr\units.datex`, `UNITS.DAT`), or null. */
export function datTableOf(fileName: string): DatTableName | null {
  const base = fileName.replace(/^.*[\\/]/, "").toLowerCase().replace(/\.datex$|\.dat$/, "");
  return (DAT_TABLES as string[]).includes(base) ? (base as DatTableName) : null;
}
