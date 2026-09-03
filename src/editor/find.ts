/**
 * Edit ▸ Find: a text search over what is on the map, returning things the dialog can
 * jump to. Pure, so the matching is testable; names that need the game data (sprites)
 * come in through a callback.
 */
import type { Scenario } from "../formats/chk/scenario";
import { getString } from "../formats/chk/sections/strings";
import { isLocationUsed, type DoodadRecord, type SpriteRecord } from "../formats/chk/sections/objects";
import type { TriggerRecord } from "../formats/chk/sections/triggers";
import { conditionDef } from "../data/triggerDefs";
import { actionStrings } from "./triggers";
import { unitName } from "../data/units";
import { locationName } from "./locations";
import { unitCustomName } from "./settings";
import { TILE_PX } from "./units";

export type FindKind = "units" | "locations" | "sprites" | "doodads" | "strings" | "triggers" | "briefing";
export const FIND_KINDS: { value: FindKind; label: string }[] = [
  { value: "units", label: "Units" },
  { value: "locations", label: "Locations" },
  { value: "sprites", label: "Sprites" },
  { value: "doodads", label: "Doodads" },
  { value: "strings", label: "Strings" },
  { value: "triggers", label: "Triggers" },
  { value: "briefing", label: "Mission briefing" },
];

export interface FindResult {
  kind: FindKind;
  /** Index into the list the kind names (unit / sprite / trigger index, location slot, string index). */
  index: number;
  label: string;
  detail: string;
  /** Tile coordinates to centre on, where the thing has a position. */
  x?: number;
  y?: number;
}

export interface FindOptions {
  kind: FindKind;
  query: string;
  matchCase?: boolean;
  /** Display name of a sprite record (needs the game data); the id when omitted. */
  spriteName?: (r: SpriteRecord) => string;
  /** Display name of a doodad record (needs the tileset); the id when omitted. */
  doodadName?: (r: DoodadRecord) => string;
  limit?: number;
}

/** Every string index a trigger's conditions and actions refer to (text, comments, labels, wav paths); `briefing` reads the MBRF action table. */
export function triggerStrings(t: TriggerRecord, briefing = false): number[] {
  const out: number[] = [];
  for (const c of t.conditions) {
    const def = conditionDef(c.type);
    for (const a of def?.args ?? []) if ((a.kind === "text" || a.kind === "wav") && c[a.field] > 0) out.push(c[a.field]);
  }
  for (const a of t.actions) for (const s of actionStrings(a, briefing)) out.push(s.index);
  return out;
}

export function findInScenario(scn: Scenario, options: FindOptions): FindResult[] {
  const { kind, matchCase = false, limit = 200 } = options;
  const q = matchCase ? options.query.trim() : options.query.trim().toLowerCase();
  if (!q) return [];
  const hit = (s: string) => (matchCase ? s : s.toLowerCase()).includes(q);
  const out: FindResult[] = [];
  const push = (r: FindResult) => { if (out.length < limit) out.push(r); };

  switch (kind) {
    case "units": {
      const id = /^\d+$/.test(q) ? Number(q) : -1;
      scn.units.forEach((u, index) => {
        const custom = unitCustomName(scn, u.unitId);
        const name = unitName(u.unitId);
        if (u.unitId === id || hit(name) || (custom && hit(custom)) || hit(`player ${u.owner + 1}`)) {
          push({ kind, index, label: custom || name, detail: `Player ${u.owner + 1} · ${Math.floor(u.x / TILE_PX)}, ${Math.floor(u.y / TILE_PX)}`, x: u.x / TILE_PX, y: u.y / TILE_PX });
        }
      });
      break;
    }
    case "locations":
      scn.locations.forEach((l, index) => {
        if (!isLocationUsed(l)) return;
        const name = locationName(scn, index);
        if (hit(name) || String(index) === q) {
          push({ kind, index, label: name, detail: `Slot ${index} · ${Math.min(l.left, l.right) / TILE_PX}, ${Math.min(l.top, l.bottom) / TILE_PX}`, x: (l.left + l.right) / 2 / TILE_PX, y: (l.top + l.bottom) / 2 / TILE_PX });
        }
      });
      break;
    case "sprites":
      scn.sprites.forEach((s, index) => {
        const name = options.spriteName ? options.spriteName(s) : `Sprite #${s.spriteId}`;
        if (hit(name) || String(s.spriteId) === q) {
          push({ kind, index, label: name, detail: `Player ${s.owner + 1} · ${Math.floor(s.x / TILE_PX)}, ${Math.floor(s.y / TILE_PX)}`, x: s.x / TILE_PX, y: s.y / TILE_PX });
        }
      });
      break;
    case "strings":
      scn.strings.strings.forEach((s, index) => {
        if (index === 0 || s === null) return;
        if (hit(s) || String(index) === q) push({ kind, index, label: s, detail: `String #${index}` });
      });
      break;
    case "doodads":
      scn.doodads.forEach((d, index) => {
        const name = options.doodadName ? options.doodadName(d) : `Doodad #${d.doodadId}`;
        if (hit(name) || String(d.doodadId) === q) {
          push({ kind, index, label: name, detail: `Player ${d.owner + 1} · ${Math.floor(d.x / TILE_PX)}, ${Math.floor(d.y / TILE_PX)}`, x: d.x / TILE_PX, y: d.y / TILE_PX });
        }
      });
      break;
    case "triggers":
    case "briefing": {
      const briefing = kind === "briefing";
      (briefing ? scn.briefing : scn.triggers).forEach((t, index) => {
        const texts = triggerStrings(t, briefing).map((i) => getString(scn.strings, i) ?? "");
        const match = texts.find((s) => hit(s));
        if (match !== undefined || String(index + 1) === q) push({ kind, index, label: `${briefing ? "Briefing" : "Trigger"} ${index + 1}`, detail: match ?? `${t.conditions.length} conditions · ${t.actions.length} actions` });
      });
      break;
    }
    default: {
      const never: never = kind;
      return never;
    }
  }
  return out;
}
