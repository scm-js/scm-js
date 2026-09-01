/**
 * Idle animation for placed units, driven by the game's own iscript bytecode.
 *
 * Every unit is a *sprite*: a stack of *images* (shadow underlay, the main graphic,
 * overlays such as a Nexus's glow or a Missile Turret's turret) each running its own
 * script. The editor plays what StarCraft plays for a finished, idle unit:
 *
 *   - the main image's `Init` (which adds the shadow and picks the resting frame), then
 *     `StarEditInit` when the script has one (StarEdit's own hook — tanks and Goliaths
 *     use it to draw their turret as an overlay), otherwise `Built` for buildings (their
 *     working overlays and pulsing live there);
 *   - subunits of anything without a `StarEditInit` as a second sprite on the same spot;
 *   - burning/sparking/bleeding damage overlays when the record's hit points are below
 *     two thirds, at the `.lo` positions the game uses — more of them the lower the HP,
 *     the large set below one third;
 *   - geyser and refinery smoke, which the scripts request with `creategasoverlays`.
 *
 * One `tick()` is one game frame (see GAME_FRAME_MS in tileset/cycle.ts). Opcodes that
 * only mean something in a running game — sounds, attacks, orders, projectile sprites —
 * are skipped; jumps that depend on game state take the "no" branch.
 */
import { UnitFlag, NO_UNIT, RANDOM_DIRECTION } from "../dat/dat";
import { facingFrame } from "../dat/grp";
import { Anim, animOffset, Op, readInstruction } from "../dat/iscript";
import { loOffset, loUsedSlots } from "../dat/lo";
import { SpriteFlag, UnitUsed, type SpriteRecord, type UnitRecord } from "../chk/sections/objects";
import { imageLoPath, requestLo, unitImageId, type UnitAssets } from "./load";

export interface ImageState {
  imageId: number;
  /** Program counter into iscript.bin; -1 once the script has halted. */
  pc: number;
  wait: number;
  stack: number[];
  /** What `playfram` set; for turning graphics the facing is added on top. */
  frameBase: number;
  frame: number;
  flip: boolean;
  flipState: boolean;
  /** Offset from the sprite's position, map pixels. */
  x: number;
  y: number;
  hidden: boolean;
  followMain: boolean;
  ended: boolean;
  /** Overlays pinned to a slot of the main image's `.lo` file (damage flames). */
  lo: { path: string; slot: number } | null;
  kind: "main" | "overlay" | "damage";
}

export interface SpriteState {
  /** The placed unit this sprite draws, or null for a THG2 sprite (no vitals to read). */
  record: UnitRecord | null;
  /** The unit type, or NO_UNIT for a pure sprite. */
  unitId: number;
  /** Facing 0–31, shared by every image on the sprite. */
  direction: number;
  /** Bottom to top. */
  images: ImageState[];
  main: ImageState;
  /** The subunit's own sprite, drawn over this one. */
  turret: SpriteState | null;
  /** For THG2 sprites: the record this state belongs to. */
  spriteRecord?: SpriteRecord;
  damageLevel: number;
  damageCount: number;
  changed: boolean;
}

/**
 * Damage overlays: every damage `.lo` has 22 slots, and slot `i` is drawn with image
 * 450 + i (small) or 472 + i (large). The slots are laid out by race — Terran flames use
 * 0–7, Zerg blood 8–15, Protoss sparks 16–21 — so a Nexus's file fills slots 16–18 and a
 * Missile Turret's just slot 1; the race never has to be looked up.
 */
const DAMAGE_SMALL = 450;
const DAMAGE_LARGE = 472;
const DAMAGE_SLOTS = 22;
/** Geyser smoke images: five puffs, plus the "depleted" set five further on. */
const GAS_SMOKE = 430;
const GAS_SMOKE_DEPLETED = 435;
/** Frames per facing set in a turning GRP. */
const FRAMES_PER_SET = 17;
/** A script that never waits is broken; stop it rather than hang the frame. */
const MAX_OPS_PER_TICK = 1000;

/** What survives a THG2 record being replaced: its type, place and flags. */
function spriteKey(r: SpriteRecord): string {
  return `${r.spriteId}:${r.x}:${r.y}:${r.flags}`;
}

function damageLevel(hp: number): number {
  return hp > 66 ? 0 : hp > 33 ? 1 : 2;
}

export class UnitAnimator {
  private readonly assets: UnitAssets;
  private readonly byRecord = new Map<UnitRecord, SpriteState>();
  private readonly bySerial = new Map<number, SpriteState>();
  /** THG2 sprites, by record and by the position key a replaced record keeps. */
  private readonly bySprite = new Map<SpriteRecord, SpriteState>();
  private readonly bySpriteKey = new Map<string, SpriteState>();
  private tilesetIndex = 0;

  constructor(assets: UnitAssets) {
    this.assets = assets;
  }

  /** True when the bytecode is installed and there is something to animate at all. */
  get enabled(): boolean {
    return this.assets.iscript !== null;
  }

  /** The sprite for a record, once `sync` has seen it. */
  spriteFor(record: UnitRecord): SpriteState | undefined {
    return this.byRecord.get(record);
  }

  /** The sprite for a THG2 record, once `syncSprites` has seen it. */
  spriteForRecord(record: SpriteRecord): SpriteState | undefined {
    return this.bySprite.get(record);
  }

  /**
   * Match sprites to the current unit list: new records get a sprite, replaced records
   * (a moved or re-owned unit is a fresh object with the same serial) keep theirs, gone
   * records are dropped. Damage overlays follow the record's hit points.
   */
  sync(units: readonly UnitRecord[], tilesetIndex: number) {
    this.setTileset(tilesetIndex);
    const live = new Set(units);
    for (const u of units) {
      let s = this.byRecord.get(u);
      if (!s) {
        const same = this.bySerial.get(u.serial);
        if (same && same.record && same.unitId === u.unitId && !live.has(same.record)) {
          this.byRecord.delete(same.record);
          same.record = u;
          s = same;
        } else {
          s = this.createSprite(u, u.unitId, true);
          this.bySerial.set(u.serial, s);
        }
        this.byRecord.set(u, s);
      }
      this.updateDamage(s);
    }
    for (const [record, s] of this.byRecord) {
      if (live.has(record)) continue;
      this.byRecord.delete(record);
      if (this.bySerial.get(record.serial) === s) this.bySerial.delete(record.serial);
    }
  }

  /**
   * Match sprites to the THG2 list: a pure sprite (`SpriteFlag.PureSprite`) plays its
   * sprites.dat image's Init, a unit sprite is drawn like a placed unit of that type.
   * A record replaced in place (re-owned, moved with its doodad) keeps its sprite by
   * position; the `Flipped` bit mirrors the whole image stack.
   */
  syncSprites(sprites: readonly SpriteRecord[], tilesetIndex: number) {
    this.setTileset(tilesetIndex);
    const live = new Set(sprites);
    for (const r of sprites) {
      let s = this.bySprite.get(r);
      if (!s) {
        const key = spriteKey(r);
        const same = this.bySpriteKey.get(key);
        if (same && !live.has(same.spriteRecord!)) {
          this.bySprite.delete(same.spriteRecord!);
          same.spriteRecord = r;
          s = same;
        } else {
          const created = this.createThg2Sprite(r);
          if (!created) continue;
          s = created;
          this.bySpriteKey.set(key, s);
        }
        this.bySprite.set(r, s);
      }
    }
    for (const [record, s] of this.bySprite) {
      if (live.has(record)) continue;
      this.bySprite.delete(record);
      if (this.bySpriteKey.get(spriteKey(record)) === s) this.bySpriteKey.delete(spriteKey(record));
    }
  }

  private setTileset(tilesetIndex: number) {
    if (tilesetIndex === this.tilesetIndex) return;
    this.tilesetIndex = tilesetIndex;
    this.byRecord.clear();
    this.bySerial.clear();
    this.bySprite.clear();
    this.bySpriteKey.clear();
  }

  private createThg2Sprite(r: SpriteRecord): SpriteState | null {
    const flipped = (r.flags & SpriteFlag.Flipped) !== 0;
    let s: SpriteState;
    if (r.flags & SpriteFlag.PureSprite) {
      const imageId = this.assets.sprites.image[r.spriteId];
      if (imageId === undefined) return null;
      s = this.createFromImage(null, NO_UNIT, imageId, 0, false, false);
    } else {
      if (r.spriteId < 0 || r.spriteId >= NO_UNIT) return null;
      s = this.createSprite(null, r.spriteId, true);
    }
    if (flipped) {
      for (const img of s.images) img.flipState = !img.flipState;
      this.settle(s);
    }
    s.spriteRecord = r;
    return s;
  }

  /** Advance every sprite one game frame. Returns whether anything visible changed. */
  tick(): boolean {
    if (!this.enabled) return false;
    let changed = false;
    for (const s of this.byRecord.values()) {
      if (this.tickSprite(s)) changed = true;
      if (s.turret && this.tickSprite(s.turret)) changed = true;
    }
    for (const s of this.bySprite.values()) {
      if (this.tickSprite(s)) changed = true;
      if (s.turret && this.tickSprite(s.turret)) changed = true;
    }
    return changed;
  }

  /* ── sprites ─────────────────────────────────────────── */

  private createSprite(record: UnitRecord | null, unitId: number, withSubunit: boolean): SpriteState {
    const { units } = this.assets;
    const dir = units.direction[unitId];
    return this.createFromImage(
      record, unitId, unitImageId(this.assets, unitId),
      dir === RANDOM_DIRECTION ? Math.floor(Math.random() * 32) : dir & 31,
      (units.flags[unitId] & UnitFlag.Building) !== 0, withSubunit,
    );
  }

  /** A sprite from its main image: Init, then StarEditInit or (for buildings) Built, then the subunit. */
  private createFromImage(record: UnitRecord | null, unitId: number, imageId: number, direction: number, building: boolean, withSubunit: boolean): SpriteState {
    const main = this.newImage(imageId, 0, 0, "main");
    const s: SpriteState = { record, unitId, images: [main], main, turret: null, damageLevel: 0, damageCount: 0, changed: true, direction };
    this.play(s, main, Anim.Init);
    const hasStarEditInit = this.hasAnim(main, Anim.StarEditInit);
    if (hasStarEditInit) this.play(s, main, Anim.StarEditInit);
    else if (building) this.play(s, main, Anim.Built);
    if (withSubunit && !hasStarEditInit && unitId < NO_UNIT) {
      const sub = this.assets.units.subunit[unitId];
      if (sub !== NO_UNIT && sub < NO_UNIT) s.turret = this.createSprite(record, sub, false);
    }
    this.settle(s);
    return s;
  }

  private newImage(imageId: number, x: number, y: number, kind: ImageState["kind"]): ImageState {
    return {
      imageId, pc: -1, wait: 0, stack: [], frameBase: 0, frame: 0, flip: false, flipState: false,
      x, y, hidden: false, followMain: false, ended: false, lo: null, kind,
    };
  }

  private hasAnim(img: ImageState, anim: number): boolean {
    const bin = this.assets.iscript;
    return bin !== null && animOffset(bin, this.assets.images.iscript[img.imageId], anim) !== 0;
  }

  /** Start `anim` on `img` and run it up to its first wait. False when the script lacks it. */
  private play(s: SpriteState, img: ImageState, anim: number): boolean {
    const bin = this.assets.iscript;
    if (!bin) return false;
    const off = animOffset(bin, this.assets.images.iscript[img.imageId], anim);
    if (!off) return false;
    img.pc = off;
    img.wait = 0;
    img.stack = [];
    this.execute(s, img);
    return true;
  }

  /** Insert a new image next to `parent` and run its Init. */
  private spawn(s: SpriteState, parent: ImageState, imageId: number, x: number, y: number, above: boolean, kind: ImageState["kind"] = "overlay"): ImageState | null {
    if (imageId < 0 || imageId >= this.assets.images.grp.length) return null;
    const img = this.newImage(imageId, x, y, kind);
    const at = s.images.indexOf(parent);
    s.images.splice(at < 0 ? s.images.length : above ? at + 1 : at, 0, img);
    s.changed = true;
    this.play(s, img, Anim.Init);
    return img;
  }

  private tickSprite(s: SpriteState): boolean {
    // Scripts spawn images while running, so iterate a snapshot of the stack.
    for (const img of s.images.slice()) {
      if (img.pc < 0 || img.ended) continue;
      if (img.wait > 0 && --img.wait > 0) continue;
      this.execute(s, img);
    }
    this.settle(s);
    const changed = s.changed;
    s.changed = false;
    return changed;
  }

  /** Drop ended overlays and recompute every image's frame and pinned position. */
  private settle(s: SpriteState) {
    const before = s.images.length;
    s.images = s.images.filter((img) => !img.ended || img === s.main);
    if (s.images.length !== before) s.changed = true;
    const main = s.main;
    for (const img of s.images) {
      let frame: number, flip: boolean;
      if (img.followMain && img !== main) {
        frame = main.frame;
        flip = main.flip;
      } else if (this.assets.images.graphicTurns[img.imageId]) {
        const f = facingFrame(s.direction);
        frame = img.frameBase + f.frame;
        flip = f.flip !== img.flipState;
      } else {
        frame = img.frameBase;
        flip = img.flipState;
      }
      if (frame !== img.frame || flip !== img.flip) { img.frame = frame; img.flip = flip; s.changed = true; }
      if (img.lo) {
        const lo = requestLo(img.lo.path);
        const at = lo ? loOffset(lo, main.frame, img.lo.slot) : null;
        if (at && (at.x !== img.x || at.y !== img.y)) { img.x = at.x; img.y = at.y; s.changed = true; }
      }
    }
  }

  /* ── damage overlays ─────────────────────────────────── */

  private updateDamage(s: SpriteState) {
    const u = s.record;
    if (!u) return;
    const hp = u.validStates & UnitUsed.HitPoints ? u.hitPointsPercent : 100;
    const level = damageLevel(hp);
    const path = imageLoPath(this.assets, s.main.imageId, "damage");
    let slots: number[] = [];
    const base = level === 2 ? DAMAGE_LARGE : DAMAGE_SMALL;
    if (level > 0 && path) {
      const lo = requestLo(path);
      if (lo === undefined) return; // still loading: try again on the next sync
      if (lo) {
        const used = loUsedSlots(lo, s.main.frame).filter((i) => i < DAMAGE_SLOTS);
        // More of the positions light up the lower the hit points go.
        const count = Math.min(used.length, Math.max(1, Math.ceil(((67 - hp) / 67) * used.length)));
        slots = used.slice(0, count);
      }
    }
    if (level === s.damageLevel && slots.length === s.damageCount) return;
    s.damageLevel = level;
    s.damageCount = slots.length;
    for (const img of s.images) if (img.kind === "damage") img.ended = true;
    for (const slot of slots) {
      const img = this.spawn(s, s.main, base + slot, 0, 0, true, "damage");
      if (img && path) img.lo = { path, slot };
    }
    this.settle(s);
  }

  /* ── the interpreter ─────────────────────────────────── */

  private execute(s: SpriteState, img: ImageState) {
    const bin = this.assets.iscript;
    if (!bin) { img.pc = -1; return; }
    const { data } = bin;
    for (let n = 0; n < MAX_OPS_PER_TICK; n++) {
      if (img.pc < 0 || img.pc >= data.length) { img.pc = -1; return; }
      const ins = readInstruction(data, img.pc);
      if (!ins) { img.pc = -1; return; }
      img.pc = ins.next;
      const a = ins.args;
      switch (ins.op) {
        case Op.playfram: img.frameBase = a[0]; break;
        case Op.playframtile: img.frameBase = a[0] + this.tilesetIndex; break;
        case Op.sethorpos: img.x = a[0]; s.changed = true; break;
        case Op.setvertpos: img.y = a[0]; s.changed = true; break;
        case Op.setpos: img.x = a[0]; img.y = a[1]; s.changed = true; break;
        case Op.wait: img.wait = Math.max(1, a[0]); return;
        case Op.waitrand: img.wait = Math.max(1, a[0] + Math.floor(Math.random() * (a[1] - a[0] + 1))); return;
        case Op.goto: img.pc = a[0]; break;
        case Op.imgol: this.spawn(s, img, a[0], img.x + a[1], img.y + a[2], true); break;
        case Op.imgul: this.spawn(s, img, a[0], img.x + a[1], img.y + a[2], false); break;
        case Op.imgolorig: this.spawn(s, img, a[0], 0, 0, true); break;
        case Op.switchul: this.spawn(s, img, a[0], img.x, img.y, false); break;
        case Op.imgoluselo:
        case Op.imguluselo: {
          const at = this.loOffsetOf(img, a[1], a[2]);
          this.spawn(s, img, a[0], img.x + at.x, img.y + at.y, ins.op === Op.imgoluselo);
          break;
        }
        case Op.imgulnextid: this.spawn(s, img, img.imageId + 1, img.x + a[0], img.y + a[1], false); break;
        case Op.end:
          img.ended = img !== s.main;
          img.pc = -1;
          s.changed = true;
          return;
        case Op.setflipstate: img.flipState = a[0] !== 0; break;
        case Op.followmaingraphic: img.followMain = true; break;
        case Op.randcondjmp: if (Math.random() * 256 < a[0]) img.pc = a[1]; break;
        case Op.turnccwise: s.direction = (s.direction - a[0]) & 31; break;
        case Op.turncwise: s.direction = (s.direction + a[0]) & 31; break;
        case Op.turn1cwise: s.direction = (s.direction + 1) & 31; break;
        case Op.turnrand: s.direction = (s.direction + (Math.random() < 0.25 ? -a[0] : a[0])) & 31; break;
        case Op.setfldirect: s.direction = a[0] & 31; break;
        case Op.engframe: img.frameBase = a[0]; break;
        case Op.engset: img.frameBase = a[0] * FRAMES_PER_SET; break;
        case Op.tmprmgraphicstart: img.hidden = true; s.changed = true; break;
        case Op.tmprmgraphicend: img.hidden = false; s.changed = true; break;
        case Op.call: img.stack.push(img.pc); img.pc = a[0]; break;
        case Op.return: img.pc = img.stack.pop() ?? -1; break;
        case Op.creategasoverlays: this.createGasOverlay(s, img, a[0]); break;
        case Op.curdirectcondjmp: {
          // Arguments are on the game's 256-step compass.
          const diff = ((s.direction * 8 - a[0] + 128) & 255) - 128;
          if (Math.abs(diff) <= a[1]) img.pc = a[2];
          break;
        }
        // Everything below needs a running game (targets, orders, sounds, projectiles):
        // fall through without jumping.
        default: break;
      }
    }
    // Ran a full tick's budget without waiting: park the image for a frame.
    img.wait = 1;
  }

  /** Slot `slot` of this image's `.lo` file number `kind` (images.dat order) at its current frame. */
  private loOffsetOf(img: ImageState, kind: number, slot: number): { x: number; y: number } {
    const kinds = ["attack", "damage", "special", "landing", "liftOff", "shield"] as const;
    const path = kinds[kind] ? imageLoPath(this.assets, img.imageId, kinds[kind]) : null;
    const lo = path ? requestLo(path) : null;
    return (lo && loOffset(lo, img.frame, slot)) ?? { x: 0, y: 0 };
  }

  /** `creategasoverlays n`: a smoke puff at slot n of the image's special overlay file. */
  private createGasOverlay(s: SpriteState, img: ImageState, slot: number) {
    const path = imageLoPath(this.assets, img.imageId, "special");
    const lo = path ? requestLo(path) : null;
    // While the file is loading the puff is skipped; the script asks again shortly.
    const at = lo ? loOffset(lo, img.frame, slot) : null;
    if (!at) return;
    const u = s.record;
    const depleted = u !== null && (u.validStates & UnitUsed.Resources) !== 0 && u.resourceAmount === 0;
    this.spawn(s, img, (depleted ? GAS_SMOKE_DEPLETED : GAS_SMOKE) + slot, img.x + at.x, img.y + at.y, true);
  }
}
