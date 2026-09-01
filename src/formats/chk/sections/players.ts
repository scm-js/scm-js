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
