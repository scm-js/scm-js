/**
 * How fast a unit walks, from the game's own tables. Most ground units move by flingy.dat's top speed; some (the
 * Marine, the Zergling, the Zealot, …) are moved by their walking animation instead — flingy.dat's "move control" says
 * iscript, its top speed is a placeholder, and each `move` in iscript.bin's Walking loop is how far the unit goes that
 * frame. For those the speed is the loop's moves over its frames: 4 for a Marine, 39 / 7 ≈ 5.57 for a Zergling.
 * Upgrades (Metabolic Boost, Leg Enhancements) and the acceleration at the start of a walk are not counted.
 */
import type { FlingyDat, ImagesDat, SpritesDat, UnitsDat } from "./dat";
import { Anim, animOffset, Op, readInstruction, type IscriptBin } from "./iscript";

/** The tables a walking speed is read from. */
export interface SpeedTables {
  units: UnitsDat;
  flingy: FlingyDat;
  sprites: SpritesDat;
  images: ImagesDat;
  iscript: IscriptBin;
}

/** flingy.dat's move control: the unit is moved by its animation. */
const BY_ISCRIPT = 2;

/** Pixels a frame a unit walks at its top speed, unupgraded; null when the tables do not say (a building, a bad id). */
export function walkSpeed(t: SpeedTables, unitId: number): number | null {
  const flingy = t.units.flingy[unitId];
  if (flingy === undefined || flingy >= t.flingy.topSpeed.length) return null;
  if (t.flingy.moveControl[flingy] !== BY_ISCRIPT) {
    const speed = t.flingy.topSpeed[flingy] / 256;
    return speed > 0 ? speed : null;
  }
  const image = t.sprites.image[t.flingy.sprite[flingy]];
  const script = image === undefined ? undefined : t.images.iscript[image];
  if (script === undefined) return null;
  // The Walking animation is one loop: moves and waits until the goto that starts it again.
  let pc = animOffset(t.iscript, script, Anim.Walking), moves = 0, frames = 0;
  const seen = new Set<number>();
  while (pc && !seen.has(pc)) {
    seen.add(pc);
    const ins = readInstruction(t.iscript.data, pc);
    if (!ins || ins.op === Op.end || ins.op === Op.return) break;
    if (ins.op === Op.goto) { pc = ins.args[0]; continue; }
    if (ins.op === Op.move) moves += ins.args[0];
    else if (ins.op === Op.wait) frames += ins.args[0];
    else if (ins.op === Op.waitrand) frames += (ins.args[0] + ins.args[1]) / 2;
    pc = ins.next;
  }
  return moves > 0 && frames > 0 ? moves / frames : null;
}
