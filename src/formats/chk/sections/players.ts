import { Reader, Writer } from "../binary";

export const PLAYER_SLOTS = 12;
/** Forces only cover the eight playable slots. */
export const FORCE_SLOTS = 8;

/** OWNR / IOWN controller byte. */
export const PlayerType = {
  Inactive: 0,
  ComputerGame: 1,
  Occupied: 2,
  Rescuable: 3,
  ComputerUnused: 4,
  Computer: 5,
  Human: 6,
  Neutral: 7,
  Closed: 8,
  Observer: 9,
  PlayerLeft: 10,
  ComputerLeft: 11,
} as const;
export type PlayerType = (typeof PlayerType)[keyof typeof PlayerType];

/** SIDE race byte. */
export const PlayerRace = {
  Zerg: 0,
  Terran: 1,
  Protoss: 2,
  Independent: 3,
  Neutral: 4,
  UserSelectable: 5,
  Random: 6,
  Inactive: 7,
} as const;
export type PlayerRace = (typeof PlayerRace)[keyof typeof PlayerRace];

export function decodeBytes(data: Uint8Array, count: number): number[] {
  const out: number[] = Array.from({ length: count }, () => 0);
  for (let i = 0; i < count && i < data.length; i++) out[i] = data[i];
  return out;
}

export function encodeBytes(values: number[], count: number): Uint8Array {
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = values[i] ?? 0;
  return out;
}

/* ── FORC: force assignments and names, 20 bytes ─────────── */

export interface Forces {
  /** Force index (0-3) each of the 8 playable slots belongs to. */
  playerForce: number[];
  /** String index of each force's name. */
  nameIndex: number[];
  /** Bit 0 random start, 1 allied, 2 allied victory, 3 shared vision. */
  flags: number[];
}

export function decodeForces(data: Uint8Array): Forces {
  const r = new Reader(data);
  const playerForce = decodeBytes(data.subarray(0, FORCE_SLOTS), FORCE_SLOTS);
  r.skip(FORCE_SLOTS);
  const nameIndex = [0, 0, 0, 0].map(() => (r.remaining >= 2 ? r.u16() : 0));
  const flags = [0, 0, 0, 0].map(() => (r.remaining >= 1 ? r.u8() : 0));
  return { playerForce, nameIndex, flags };
}

export function encodeForces(forces: Forces): Uint8Array {
  const w = new Writer(20);
  w.bytes(encodeBytes(forces.playerForce, FORCE_SLOTS));
  for (let i = 0; i < 4; i++) w.u16(forces.nameIndex[i] ?? 0);
  for (let i = 0; i < 4; i++) w.u8(forces.flags[i] ?? 0);
  return w.finish();
}

export function defaultForces(): Forces {
  return {
    playerForce: [0, 0, 0, 0, 0, 0, 0, 0],
    nameIndex: [0, 0, 0, 0],
    flags: [0, 0, 0, 0],
  };
}

/** FORC per-force flag bits. */
export const ForceFlag = {
  RandomStart: 1,
  Allied: 2,
  AlliedVictory: 4,
  SharedVision: 8,
} as const;

/* ── CRGB: Remastered player colours, 32 bytes ───────────── */

/** How Remastered picks each of the eight playable slots' colour. */
export const ColorMode = {
  /** A random entry from the predefined table. */
  Random: 0,
  /** Whatever the player chose in the lobby. */
  PlayerChoice: 1,
  /** The RGB triple stored alongside. */
  Custom: 2,
  /** The COLR byte, as every older client reads it (StarEdit's default). */
  Palette: 3,
} as const;
export type ColorMode = (typeof ColorMode)[keyof typeof ColorMode];

export interface PlayerRgb {
  /** `[r, g, b]` for each of the 8 playable slots; only read when `mode` is `Custom`. */
  rgb: [number, number, number][];
  /** A `ColorMode` per slot. */
  mode: number[];
}

export function decodePlayerRgb(data: Uint8Array): PlayerRgb {
  const rgb: [number, number, number][] = [];
  for (let i = 0; i < FORCE_SLOTS; i++) rgb.push([data[i * 3] ?? 0, data[i * 3 + 1] ?? 0, data[i * 3 + 2] ?? 0]);
  const mode = decodeBytes(data.subarray(FORCE_SLOTS * 3), FORCE_SLOTS);
  return { rgb, mode };
}

export function encodePlayerRgb(colors: PlayerRgb): Uint8Array {
  const w = new Writer(32);
  for (let i = 0; i < FORCE_SLOTS; i++) {
    const [r, g, b] = colors.rgb[i] ?? [0, 0, 0];
    w.u8(r).u8(g).u8(b);
  }
  w.bytes(encodeBytes(colors.mode, FORCE_SLOTS));
  return w.finish();
}

/** What StarEdit writes: every slot on its COLR colour, RGB zeroed. */
export function defaultPlayerRgb(): PlayerRgb {
  return {
    rgb: Array.from({ length: FORCE_SLOTS }, () => [0, 0, 0]),
    mode: Array.from({ length: FORCE_SLOTS }, () => ColorMode.Palette),
  };
}
