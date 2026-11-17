import { describe, expect, it } from 'vitest';
import { KEY_BYTES, SCHEDULE_BYTES, countOnes, expandKey, toHex } from './aes-schedule';
import {
  assertModel,
  cryptoRandom,
  damageBetween,
  decaySchedule,
  seededRandom,
  wrongWayBits,
} from './decay';
import { FIXTURE_SCHEDULE } from './fixtures';

describe('the decay channel', () => {
  it('at d0 = d1 = 0 the image is the schedule', () => {
    const image = decaySchedule(FIXTURE_SCHEDULE, { d0: 0, d1: 0 }, seededRandom(7));
    expect(toHex(image)).toBe(toHex(FIXTURE_SCHEDULE));
  });

  it('at d0 = 1, d1 = 0 every one bit is gone and the image is all zeros', () => {
    const image = decaySchedule(FIXTURE_SCHEDULE, { d0: 1, d1: 0 }, seededRandom(7));
    expect(countOnes(image)).toBe(0);
  });

  it('at d0 = 0, d1 = 1 every zero bit flips and the image is all ones', () => {
    const image = decaySchedule(FIXTURE_SCHEDULE, { d0: 0, d1: 1 }, seededRandom(7));
    expect(countOnes(image)).toBe(SCHEDULE_BYTES * 8);
  });

  it('decays ONES towards the ground state, never zeros, when d1 = 0', () => {
    // Mutation 8 inverts this. Over 40 draws at a heavy rate, a model that
    // decayed zeros instead would gain bits rather than lose them.
    for (let seed = 0; seed < 40; seed++) {
      const image = decaySchedule(FIXTURE_SCHEDULE, { d0: 0.3, d1: 0 }, seededRandom(seed));
      const damage = damageBetween(FIXTURE_SCHEDULE, image);
      expect(damage.wrongWayBits).toBe(0);
      expect(countOnes(image)).toBeLessThanOrEqual(countOnes(FIXTURE_SCHEDULE));
      for (let i = 0; i < SCHEDULE_BYTES; i++) {
        // Every image byte is a subset of the stored byte.
        expect(image[i] & ~FIXTURE_SCHEDULE[i] & 0xff).toBe(0);
      }
    }
  });

  it('loses roughly the modelled fraction of one bits', () => {
    const ones = countOnes(FIXTURE_SCHEDULE);
    for (const d0 of [0.15, 0.3]) {
      let lost = 0;
      const draws = 60;
      for (let seed = 0; seed < draws; seed++) {
        lost += damageBetween(
          FIXTURE_SCHEDULE,
          decaySchedule(FIXTURE_SCHEDULE, { d0, d1: 0 }, seededRandom(seed + 1000)),
        ).lostBits;
      }
      // 720 ones x 60 draws is enough that the mean sits well inside 15%.
      expect(lost / draws / ones).toBeGreaterThan(d0 * 0.85);
      expect(lost / draws / ones).toBeLessThan(d0 * 1.15);
    }
  });

  it('does not modify its input', () => {
    const before = toHex(FIXTURE_SCHEDULE);
    decaySchedule(FIXTURE_SCHEDULE, { d0: 0.5, d1: 0.5 }, seededRandom(3));
    expect(toHex(FIXTURE_SCHEDULE)).toBe(before);
  });

  it('refuses a schedule that is not 176 bytes', () => {
    expect(() => decaySchedule(new Uint8Array(175), { d0: 0, d1: 0 }, seededRandom(1))).toThrow(
      RangeError,
    );
  });

  it('refuses a model that is not a pair of probabilities', () => {
    for (const model of [
      { d0: -1, d1: 0 },
      { d0: 0, d1: 2 },
      { d0: Number.NaN, d1: 0 },
      { d0: Number.POSITIVE_INFINITY, d1: 0 },
    ]) {
      expect(() => assertModel(model)).toThrow(RangeError);
    }
    expect(() => assertModel({ d0: 0, d1: 0 })).not.toThrow();
    expect(() => assertModel({ d0: 1, d1: 1 })).not.toThrow();
  });
});

describe('wrong-way accounting', () => {
  it('counts bits the image shows that a candidate does not', () => {
    expect(wrongWayBits(Uint8Array.of(0b1111), Uint8Array.of(0b1111))).toBe(0);
    expect(wrongWayBits(Uint8Array.of(0b1111), Uint8Array.of(0b0011))).toBe(0); // decayed bits are free
    expect(wrongWayBits(Uint8Array.of(0b0011), Uint8Array.of(0b1111))).toBe(2);
    expect(wrongWayBits(Uint8Array.of(0b0000), Uint8Array.of(0b1111))).toBe(4);
  });

  it('is one-directional: a superset of the image costs nothing', () => {
    const image = decaySchedule(FIXTURE_SCHEDULE, { d0: 0.3, d1: 0 }, seededRandom(11));
    expect(wrongWayBits(FIXTURE_SCHEDULE, image)).toBe(0);
    // ...and the reverse direction is not free, which is mutation 5.
    expect(wrongWayBits(image, FIXTURE_SCHEDULE)).toBeGreaterThan(0);
  });

  it('separates key-byte damage from schedule damage', () => {
    const image = decaySchedule(FIXTURE_SCHEDULE, { d0: 0.3, d1: 0.01 }, seededRandom(12));
    const damage = damageBetween(FIXTURE_SCHEDULE, image);
    expect(damage.lostKeyBits).toBeLessThanOrEqual(damage.lostBits);
    expect(damage.wrongWayKeyBits).toBeLessThanOrEqual(damage.wrongWayBits);
    expect(damage.lostMask).toHaveLength(SCHEDULE_BYTES);
    let maskedLost = 0;
    for (let i = 0; i < KEY_BYTES; i++) maskedLost += countOnes(damage.lostMask.subarray(i, i + 1));
    expect(maskedLost).toBe(damage.lostKeyBits);
  });

  it('refuses mismatched lengths', () => {
    expect(() => damageBetween(new Uint8Array(176), new Uint8Array(175))).toThrow(RangeError);
  });
});

describe('randomness sources', () => {
  it('cryptoRandom returns floats in [0, 1) and refills its buffer', () => {
    const random = cryptoRandom();
    for (let i = 0; i < 1000; i++) {
      const v = random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('cryptoRandom is not constant', () => {
    const random = cryptoRandom();
    const seen = new Set(Array.from({ length: 200 }, () => random()));
    expect(seen.size).toBeGreaterThan(150);
  });

  it('seededRandom repeats exactly, which is why it is for tests only', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const first = Array.from({ length: 50 }, () => a());
    const second = Array.from({ length: 50 }, () => b());
    expect(first).toEqual(second);
    expect(new Set(first).size).toBeGreaterThan(40);
  });

  it('different seeds give different streams', () => {
    const a = seededRandom(1);
    const b = seededRandom(2);
    expect(Array.from({ length: 20 }, () => a())).not.toEqual(
      Array.from({ length: 20 }, () => b()),
    );
  });

  it('a key drawn from crypto.getRandomValues expands and decays', () => {
    const key = new Uint8Array(KEY_BYTES);
    crypto.getRandomValues(key);
    const image = decaySchedule(expandKey(key), { d0: 0.2, d1: 0 }, cryptoRandom());
    expect(image).toHaveLength(SCHEDULE_BYTES);
  });
});
