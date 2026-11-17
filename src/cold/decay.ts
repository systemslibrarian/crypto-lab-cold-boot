/**
 * The decay model of "Lest We Remember" section 5.1, applied to a stored AES
 * key schedule.
 *
 * Each memory cell has a ground state. After power is cut, a cell holding the
 * opposite value flips to its ground state with probability d0, which grows
 * with time; a flip AWAY from the ground state stays rare (the paper measured
 * under 0.1%). This file fixes one ground state, 0, for every bit: a stored 1
 * reads back as 0 with probability d0, a stored 0 reads back as 1 with
 * probability d1.
 *
 * Real memory does not work that way everywhere -- it has regions with either
 * ground state, which is why the paper's algorithms take the ground state of
 * each cell as input. The page says so. See the GroundState seam in types.ts.
 *
 * Nothing here is a measurement of how long real DRAM holds data. The decay
 * figure is a dial on a model.
 */

import { POPCOUNT, SCHEDULE_BYTES } from './aes-schedule';
import type { ErrorModel } from './types';

/** A source of uniform floats in [0, 1). */
export type Random = () => number;

/**
 * A `Random` drawing from `crypto.getRandomValues`, which is what the page
 * uses for keys and for decay draws.
 */
export function cryptoRandom(): Random {
  const buf = new Uint32Array(256);
  let next = buf.length;
  return () => {
    if (next >= buf.length) {
      crypto.getRandomValues(buf);
      next = 0;
    }
    // 2^-32 scaling: uniform on [0, 1) to 32 bits, which is finer than any
    // decay probability this lab offers.
    return buf[next++] * 2 ** -32;
  };
}

/**
 * A seeded, reproducible `Random` (xoshiro128**). Used ONLY where a test or a
 * clearly labelled fixed-image control needs the same draw twice; the page's
 * own keys and decay draws come from `cryptoRandom`.
 */
export function seededRandom(seed: number): Random {
  let s0 = seed | 0 || 0x9e3779b9;
  let s1 = (seed ^ 0x85ebca6b) | 0 || 0x243f6a88;
  let s2 = (seed ^ 0xc2b2ae35) | 0 || 0xb7e15162;
  let s3 = (seed ^ 0x27d4eb2f) | 0 || 0x9e3779b1;
  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
  return () => {
    const result = (Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7) >>> 0, 9) >>> 0) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result * 2 ** -32;
  };
}

/**
 * Read back a stored schedule through the decay channel.
 *
 * Returns a new 176-byte image; the input is not modified.
 */
export function decaySchedule(schedule: Uint8Array, model: ErrorModel, random: Random): Uint8Array {
  if (schedule.length !== SCHEDULE_BYTES) {
    throw new RangeError(`schedule must be ${SCHEDULE_BYTES} bytes, got ${schedule.length}`);
  }
  assertModel(model);
  const image = new Uint8Array(SCHEDULE_BYTES);
  for (let i = 0; i < SCHEDULE_BYTES; i++) {
    let out = 0;
    for (let bit = 0; bit < 8; bit++) {
      const stored = (schedule[i] >> bit) & 1;
      const flips = random() < (stored === 1 ? model.d0 : model.d1);
      const read = stored === 1 ? (flips ? 0 : 1) : flips ? 1 : 0;
      out |= read << bit;
    }
    image[i] = out;
  }
  return image;
}

/** Reject a model whose probabilities are not probabilities. */
export function assertModel(model: ErrorModel): void {
  for (const [name, v] of [
    ['d0', model.d0],
    ['d1', model.d1],
  ] as const) {
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      throw new RangeError(`${name} must be a probability in [0, 1], got ${String(v)}`);
    }
  }
}

/** Which bits of the stored schedule the image lost or gained, and where. */
export interface DecayDamage {
  /** Stored 1 bits that read back as 0. */
  readonly lostBits: number;
  /** Stored 0 bits that read back as 1 -- wrong-way flips. */
  readonly wrongWayBits: number;
  /** Lost bits among the 16 key bytes alone. */
  readonly lostKeyBits: number;
  /** Wrong-way bits among the 16 key bytes alone. */
  readonly wrongWayKeyBits: number;
  /** Per-byte mask of lost bits, for the grid. */
  readonly lostMask: Uint8Array;
  /** Per-byte mask of wrong-way bits, for the grid. */
  readonly wrongWayMask: Uint8Array;
}

/**
 * Compare a stored schedule with its image. Needs the truth, so it is only
 * ever used by the page to narrate its own exhibit and by the tests -- never
 * by the reconstruction, which sees the image alone.
 */
export function damageBetween(schedule: Uint8Array, image: Uint8Array): DecayDamage {
  if (schedule.length !== SCHEDULE_BYTES || image.length !== SCHEDULE_BYTES) {
    throw new RangeError(`both inputs must be ${SCHEDULE_BYTES} bytes`);
  }
  const lostMask = new Uint8Array(SCHEDULE_BYTES);
  const wrongWayMask = new Uint8Array(SCHEDULE_BYTES);
  let lostBits = 0;
  let wrongWayBits = 0;
  let lostKeyBits = 0;
  let wrongWayKeyBits = 0;
  for (let i = 0; i < SCHEDULE_BYTES; i++) {
    const lost = schedule[i] & ~image[i] & 0xff;
    const gained = image[i] & ~schedule[i] & 0xff;
    lostMask[i] = lost;
    wrongWayMask[i] = gained;
    lostBits += POPCOUNT[lost];
    wrongWayBits += POPCOUNT[gained];
    if (i < 16) {
      lostKeyBits += POPCOUNT[lost];
      wrongWayKeyBits += POPCOUNT[gained];
    }
  }
  return { lostBits, wrongWayBits, lostKeyBits, wrongWayKeyBits, lostMask, wrongWayMask };
}

/**
 * Wrong-way bits a candidate schedule would need to explain an image: bits the
 * image shows as 1 where the candidate says 0.
 *
 * This is the consistency measure the whole search is built on, and it is
 * one-directional on purpose. With d1 = 0 a consistent candidate needs zero of
 * them, which is the hard test: the true byte must CONTAIN every 1 bit of its
 * image byte. A candidate's extra 1 bits are free -- those are just bits that
 * decayed.
 */
export function wrongWayBits(candidate: Uint8Array, image: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < candidate.length; i++) n += POPCOUNT[image[i] & ~candidate[i] & 0xff];
  return n;
}

/**
 * Build the two fixed images of the brief's check B: deterministic decay by a
 * hash rule, so a test and a labelled control can use the same image twice.
 *
 * For byte index i and bit b (0 = least significant), a stored 1 bit is
 * cleared when the first byte of SHA-256("decay" || i || b) is less than
 * `threshold`. Nothing else is touched, so d1 = 0 by construction.
 *
 * `sha256First` is injected because the browser's digest is async and Node's
 * is not; both callers pass their own.
 */
export function fixedDecayImage(
  schedule: Uint8Array,
  threshold: number,
  sha256First: (bytes: Uint8Array) => number,
): Uint8Array {
  if (schedule.length !== SCHEDULE_BYTES) {
    throw new RangeError(`schedule must be ${SCHEDULE_BYTES} bytes`);
  }
  const image = Uint8Array.from(schedule);
  const probe = new Uint8Array(7);
  probe.set([0x64, 0x65, 0x63, 0x61, 0x79]); // "decay"
  for (let i = 0; i < SCHEDULE_BYTES; i++) {
    for (let bit = 0; bit < 8; bit++) {
      if (!((image[i] >> bit) & 1)) continue;
      probe[5] = i;
      probe[6] = bit;
      if (sha256First(probe) < threshold) image[i] &= ~(1 << bit) & 0xff;
    }
  }
  return image;
}

/** The two fixed images of check B, by their thresholds. */
export const FIXED_IMAGE_THRESHOLDS = { light: 38, heavy: 77 } as const;
