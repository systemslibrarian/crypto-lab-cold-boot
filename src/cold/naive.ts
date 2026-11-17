/**
 * How big the naive search is -- the thing the key schedule's redundancy makes
 * unnecessary.
 *
 * "Lest We Remember" opens section 5.2 by dismissing the obvious approach:
 * search keys in order of Hamming distance from the image and keep any whose
 * schedule is close enough. The paper's own numbers for why, at 10% decay on a
 * 256-bit key with equal ones and zeros, are reproduced in `PAPER_EXAMPLE`
 * below.
 *
 * Every count here is exact, in BigInt. These numbers overflow a double long
 * before they stop mattering, and a demo that printed 1.2e23 where it should
 * print a binomial coefficient would be teaching the wrong lesson about how
 * big "out of reach" is.
 */

import { POPCOUNT } from './aes-schedule';

/** Exact binomial coefficient. */
export function choose(n: number, k: number): bigint {
  if (!Number.isInteger(n) || !Number.isInteger(k)) throw new RangeError('choose takes integers');
  if (k < 0 || n < 0 || k > n) return 0n;
  const kk = BigInt(Math.min(k, n - k));
  let out = 1n;
  for (let i = 0n; i < kk; i++) out = (out * (BigInt(n) - i)) / (i + 1n);
  return out;
}

/**
 * log2 of a positive BigInt, to full double precision.
 *
 * Taking Number(x) first would overflow to Infinity for anything past about
 * 2^1024, and lose precision long before that; this shifts the top 60 bits
 * down, takes the log there, and adds the shift back.
 */
export function log2Big(x: bigint): number {
  if (x <= 0n) throw new RangeError('log2Big needs a positive integer');
  const bits = x.toString(2).length;
  if (bits <= 60) return Math.log2(Number(x));
  const shift = BigInt(bits - 60);
  return Math.log2(Number(x >> shift)) + Number(shift);
}

/** "2^56.02"-style rendering for a count. */
export function asPowerOfTwo(x: bigint, digits = 2): string {
  if (x === 0n) return '0';
  if (x === 1n) return '1';
  return `2^${log2Big(x).toFixed(digits)}`;
}

/**
 * How many keys are consistent with the image's key bytes alone, under the
 * one-way model?
 *
 * Every zero bit in the image could be a 0 that stayed 0, or a 1 that decayed.
 * Every one bit must have been a 1. So the candidates are exactly the
 * supersets of the image's 16 key bytes: 2^(zero bits).
 *
 * This is the count the page shows for "the search this damage leaves you",
 * and it is why the rest of the schedule matters.
 */
export function supersetCandidates(imageKeyBytes: Uint8Array): bigint {
  let zeros = 0n;
  for (const b of imageKeyBytes) zeros += BigInt(8 - POPCOUNT[b]);
  return 1n << zeros;
}

/** Zero bits in a byte range -- the exponent of `supersetCandidates`. */
export function zeroBits(bytes: Uint8Array): number {
  let zeros = 0;
  for (const b of bytes) zeros += 8 - POPCOUNT[b];
  return zeros;
}

/**
 * How many keys are consistent if the attacker is also TOLD how many bits
 * decayed -- choose which of the zero bits were really ones.
 *
 * Strictly smaller than `supersetCandidates`, and still out of reach, which is
 * the point: the naive search is not saved by extra information of this kind.
 */
export function candidatesWithKnownLossCount(imageKeyBytes: Uint8Array, lostBits: number): bigint {
  return choose(zeroBits(imageKeyBytes), lostBits);
}

/**
 * The paper's own example, section 5.2: a 256-bit key with equal numbers of
 * ones and zeros, 10% of its ones decayed. The recovered data sits an expected
 * Hamming distance of 12 from the key, and the number of keys at that distance
 * from a 128-zero image is C(128+12, 12), which the paper gives as > 2^56.
 */
export const PAPER_EXAMPLE = {
  keyBits: 256,
  decayedFractionOfOnes: 0.1,
  expectedDistance: 12,
  zerosToChooseFrom: 140,
  get count(): bigint {
    return choose(140, 12);
  },
} as const;
