import { describe, expect, it } from 'vitest';
import {
  PAPER_EXAMPLE,
  asPowerOfTwo,
  candidatesWithKnownLossCount,
  choose,
  log2Big,
  supersetCandidates,
  zeroBits,
} from './naive';
import { FIXED_IMAGE_FACTS, FIXED_IMAGE_HEAVY, FIXED_IMAGE_LIGHT } from './fixtures';

/**
 * CHECK C -- the naive counts, in BigInt, for the two fixed images and for the
 * paper's own 256-bit example.
 */
describe('check C: the size of the naive search', () => {
  it('the paper 256-bit example: C(140, 12) is just over 2^56', () => {
    expect(PAPER_EXAMPLE.count).toBe(choose(140, 12));
    expect(log2Big(PAPER_EXAMPLE.count)).toBeCloseTo(56.02, 2);
    expect(asPowerOfTwo(PAPER_EXAMPLE.count)).toBe('2^56.02');
    // The paper says "> 2^56"; check that literally rather than to 2 places.
    expect(PAPER_EXAMPLE.count).toBeGreaterThan(1n << 56n);
  });

  it('the light image leaves 2^77 supersets of its key bytes', () => {
    const keyBytes = FIXED_IMAGE_LIGHT.subarray(0, 16);
    expect(zeroBits(keyBytes)).toBe(77);
    expect(supersetCandidates(keyBytes)).toBe(1n << 77n);
    expect(asPowerOfTwo(supersetCandidates(keyBytes), 0)).toBe('2^77');
  });

  it('the heavy image leaves 2^88 supersets of its key bytes', () => {
    const keyBytes = FIXED_IMAGE_HEAVY.subarray(0, 16);
    expect(zeroBits(keyBytes)).toBe(88);
    expect(supersetCandidates(keyBytes)).toBe(1n << 88n);
    expect(asPowerOfTwo(supersetCandidates(keyBytes), 0)).toBe('2^88');
  });

  it('knowing HOW MANY bits decayed does not rescue the naive search', () => {
    const light = candidatesWithKnownLossCount(
      FIXED_IMAGE_LIGHT.subarray(0, 16),
      FIXED_IMAGE_FACTS.light.lostKeyBits,
    );
    const heavy = candidatesWithKnownLossCount(
      FIXED_IMAGE_HEAVY.subarray(0, 16),
      FIXED_IMAGE_FACTS.heavy.lostKeyBits,
    );
    expect(light).toBe(choose(77, 14));
    expect(heavy).toBe(choose(88, 25));
    expect(log2Big(light)).toBeCloseTo(49.6, 1);
    expect(log2Big(heavy)).toBeCloseTo(72.4, 1);
    // Smaller than the superset count, and still out of reach.
    expect(light).toBeLessThan(supersetCandidates(FIXED_IMAGE_LIGHT.subarray(0, 16)));
    expect(heavy).toBeLessThan(supersetCandidates(FIXED_IMAGE_HEAVY.subarray(0, 16)));
    expect(light).toBeGreaterThan(1n << 49n);
    expect(heavy).toBeGreaterThan(1n << 72n);
  });
});

describe('exact arithmetic, because these numbers do not fit a double', () => {
  it('computes small binomials correctly', () => {
    expect(choose(0, 0)).toBe(1n);
    expect(choose(5, 0)).toBe(1n);
    expect(choose(5, 5)).toBe(1n);
    expect(choose(5, 2)).toBe(10n);
    expect(choose(52, 5)).toBe(2598960n);
    expect(choose(77, 14)).toBe(839983521106400n);
    expect(choose(88, 25)).toBe(6031435276240042413888n);
    expect(choose(140, 12)).toBe(72880766421258705n);
  });

  it('is symmetric and zero outside range', () => {
    for (const [n, k] of [
      [20, 7],
      [88, 25],
      [140, 12],
    ] as const) {
      expect(choose(n, k)).toBe(choose(n, n - k));
    }
    expect(choose(5, 6)).toBe(0n);
    expect(choose(5, -1)).toBe(0n);
  });

  it('log2Big stays exact well past the range of a double', () => {
    expect(log2Big(1n)).toBe(0);
    expect(log2Big(1024n)).toBe(10);
    expect(log2Big(1n << 2000n)).toBeCloseTo(2000, 9);
    expect(log2Big((1n << 1408n) - 1n)).toBeCloseTo(1408, 6);
    expect(() => log2Big(0n)).toThrow(RangeError);
  });

  it('a 176-byte image of all zeros would leave 2^1408 candidates, which Number cannot hold', () => {
    const everything = supersetCandidates(new Uint8Array(176));
    expect(everything).toBe(1n << 1408n);
    expect(Number(everything)).toBe(Number.POSITIVE_INFINITY);
    expect(asPowerOfTwo(everything, 0)).toBe('2^1408');
  });

  it('a fully intact image leaves exactly one candidate', () => {
    const allOnes = new Uint8Array(16).fill(0xff);
    expect(supersetCandidates(allOnes)).toBe(1n);
    expect(asPowerOfTwo(supersetCandidates(allOnes))).toBe('1');
  });

  it('rejects non-integers', () => {
    expect(() => choose(5.5, 2)).toThrow(RangeError);
  });
});
