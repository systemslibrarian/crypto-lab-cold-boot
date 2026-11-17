import { describe, expect, it } from 'vitest';
import {
  INV_SBOX,
  KEY_BYTES,
  POPCOUNT,
  RCON,
  SBOX,
  SCHEDULE_BYTES,
  SLICES,
  aAt,
  bAt,
  cAt,
  countOnes,
  dAt,
  determinedBy,
  expandKey,
  fromHex,
  recomputeByte,
  toHex,
  wordByteAt,
} from './aes-schedule';

/**
 * CHECK A -- the key expansion is real AES-128 before anything else runs.
 *
 * FIPS 197 Appendix A.1 expands key 2b7e151628aed2a6abf7158809cf4f3c into
 * these 44 words. The table is NOT taken on trust from this file: the
 * `aes-cipher.test.ts` suite beside it builds the AES-128 cipher out of this
 * very expansion and checks it against the platform's own AES and against the
 * FIPS 197 Appendix C.1 known-answer vector. A wrong round key anywhere in the
 * table changes that ciphertext, so the two suites pin each other.
 */
const FIPS197_A1 = [
  '2b7e1516', '28aed2a6', 'abf71588', '09cf4f3c',
  'a0fafe17', '88542cb1', '23a33939', '2a6c7605',
  'f2c295f2', '7a96b943', '5935807a', '7359f67f',
  '3d80477d', '4716fe3e', '1e237e44', '6d7a883b',
  'ef44a541', 'a8525b7f', 'b671253b', 'db0bad00',
  'd4d1c6f8', '7c839d87', 'caf2b8bc', '11f915bc',
  '6d88a37a', '110b3efd', 'dbf98641', 'ca0093fd',
  '4e54f70e', '5f5fc9f3', '84a64fb2', '4ea6dc4f',
  'ead27321', 'b58dbad2', '312bf560', '7f8d292f',
  'ac7766f3', '19fadc21', '28d12941', '575c006e',
  'd014f9a8', 'c9ee2589', 'e13f0cc8', 'b6630ca6',
];

export const FIPS197_A1_KEY = '2b7e151628aed2a6abf7158809cf4f3c';

describe('check A: AES-128 key expansion (FIPS 197)', () => {
  const schedule = expandKey(fromHex(FIPS197_A1_KEY));

  it('expands to 176 bytes', () => {
    expect(schedule).toHaveLength(SCHEDULE_BYTES);
  });

  it('reproduces every one of the 44 words of Appendix A.1', () => {
    const got = FIPS197_A1.map((_, n) => toHex(schedule.subarray(n * 4, n * 4 + 4)));
    expect(got).toEqual(FIPS197_A1);
  });

  it('reproduces the two words the brief names: w4 and w43', () => {
    expect(toHex(schedule.subarray(16, 20))).toBe('a0fafe17');
    expect(toHex(schedule.subarray(172, 176))).toBe('b6630ca6');
  });

  it('contains 720 one bits', () => {
    expect(countOnes(schedule)).toBe(720);
  });

  it('round key 0 is the key itself', () => {
    expect(toHex(schedule.subarray(0, KEY_BYTES))).toBe(FIPS197_A1_KEY);
  });

  it('refuses a key that is not 16 bytes', () => {
    expect(() => expandKey(new Uint8Array(15))).toThrow(RangeError);
    expect(() => expandKey(new Uint8Array(32))).toThrow(RangeError);
  });
});

describe('the S-box is generated, not asserted', () => {
  it('is a permutation of 0..255', () => {
    expect(new Set(SBOX)).toHaveProperty('size', 256);
  });

  it('inverts', () => {
    for (let x = 0; x < 256; x++) expect(INV_SBOX[SBOX[x]]).toBe(x);
  });

  it('matches the published fixed points and corners', () => {
    // From the FIPS 197 S-box table: S(00)=63, S(53)=ed, S(7c)=10, S(ff)=16.
    expect(SBOX[0x00]).toBe(0x63);
    expect(SBOX[0x53]).toBe(0xed);
    expect(SBOX[0x7c]).toBe(0x10);
    expect(SBOX[0xff]).toBe(0x16);
  });

  it('has the ten AES round constants', () => {
    expect([...RCON]).toEqual([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]);
  });
});

/**
 * CHECK D -- the relations the attack is built on hold on the real schedule,
 * for 1,000 random keys, and a slice's four key bytes really do reproduce its
 * three derived bytes.
 */
describe('check D: the (position, round) relations hold', () => {
  const keys = Array.from({ length: 1000 }, () => {
    const k = new Uint8Array(KEY_BYTES);
    crypto.getRandomValues(k);
    return k;
  });

  it('a[p][r], b, c and d satisfy the stated recurrence for every p, r', () => {
    for (const key of keys) {
      const w = expandKey(key);
      for (let r = 1; r < 11; r++) {
        for (let p = 0; p < 4; p++) {
          const j = (p + 1) % 4;
          const a = (w[aAt(p, r - 1)] ^ SBOX[w[dAt(j, r - 1)]] ^ (p === 0 ? RCON[r - 1] : 0)) & 0xff;
          expect(w[aAt(p, r)]).toBe(a);
          expect(w[bAt(p, r)]).toBe((w[bAt(p, r - 1)] ^ a) & 0xff);
          expect(w[cAt(p, r)]).toBe((w[cAt(p, r - 1)] ^ w[bAt(p, r)]) & 0xff);
          expect(w[dAt(p, r)]).toBe((w[dAt(p, r - 1)] ^ w[cAt(p, r)]) & 0xff);
        }
      }
    }
  });

  it("a slice's four key bytes reproduce its three derived bytes", () => {
    for (const key of keys) {
      const w = expandKey(key);
      for (const slice of SLICES) {
        const [ka, kb, kc, kd] = slice.keyBytes.map((i) => w[i]);
        const rcon = slice.p === 0 ? RCON[0] : 0;
        const a1 = (ka ^ SBOX[kd] ^ rcon) & 0xff;
        const b1 = (kb ^ a1) & 0xff;
        const c1 = (kc ^ b1) & 0xff;
        expect([w[slice.derived[0]], w[slice.derived[1]], w[slice.derived[2]]]).toEqual([a1, b1, c1]);
      }
    }
  });

  it('the fourth byte of a slice is the NEIGHBOUR position, (p+1) mod 4', () => {
    expect(SLICES.map((s) => s.keyBytes[3])).toEqual([dAt(1, 0), dAt(2, 0), dAt(3, 0), dAt(0, 0)]);
    // Spelled out, because getting this wrong is mutation 3: the four slices
    // between them cover all four d bytes of the key exactly once.
    expect(new Set(SLICES.map((s) => s.keyBytes[3])).size).toBe(4);
  });

  it('every schedule byte outside round key 0 is recomputable from its inputs', () => {
    const w = expandKey(fromHex(FIPS197_A1_KEY));
    for (let i = 0; i < SCHEDULE_BYTES; i++) {
      expect(recomputeByte(w, i)).toBe(w[i]);
    }
    // ...and key bytes are determined by nothing: they are the secret.
    for (let i = 0; i < KEY_BYTES; i++) expect(determinedBy(i).inputs).toHaveLength(0);
    for (let i = KEY_BYTES; i < SCHEDULE_BYTES; i++) {
      expect(determinedBy(i).inputs.length).toBeGreaterThan(0);
    }
  });

  it('only position 0 takes a round constant, and only in the a column', () => {
    for (let r = 1; r < 11; r++) {
      expect(determinedBy(aAt(0, r)).rcon).toBe(RCON[r - 1]);
      for (const p of [1, 2, 3]) expect(determinedBy(aAt(p, r)).rcon).toBe(0);
      for (const p of [0, 1, 2, 3]) {
        expect(determinedBy(bAt(p, r)).rcon).toBe(0);
        expect(determinedBy(cAt(p, r)).rcon).toBe(0);
        expect(determinedBy(dAt(p, r)).rcon).toBe(0);
      }
    }
  });

  it('only the a column passes a byte through the S-box', () => {
    for (let r = 1; r < 11; r++) {
      for (let p = 0; p < 4; p++) {
        expect(determinedBy(aAt(p, r)).subByte).toBe(dAt((p + 1) % 4, r - 1));
        expect(determinedBy(bAt(p, r)).subByte).toBeNull();
        expect(determinedBy(cAt(p, r)).subByte).toBeNull();
        expect(determinedBy(dAt(p, r)).subByte).toBeNull();
      }
    }
  });
});

describe('index helpers and hex', () => {
  it('the (position, round) view and FIPS 197 word numbering address the same bytes', () => {
    for (let r = 0; r < 11; r++) {
      for (let p = 0; p < 4; p++) {
        expect(aAt(p, r)).toBe(wordByteAt(4 * r + 0, p));
        expect(bAt(p, r)).toBe(wordByteAt(4 * r + 1, p));
        expect(cAt(p, r)).toBe(wordByteAt(4 * r + 2, p));
        expect(dAt(p, r)).toBe(wordByteAt(4 * r + 3, p));
      }
    }
  });

  it('the four views together cover all 176 bytes exactly once', () => {
    const seen = new Set<number>();
    for (let r = 0; r < 11; r++) {
      for (let p = 0; p < 4; p++) for (const i of [aAt(p, r), bAt(p, r), cAt(p, r), dAt(p, r)]) seen.add(i);
    }
    expect(seen.size).toBe(SCHEDULE_BYTES);
  });

  it('round trips hex', () => {
    expect(toHex(fromHex(FIPS197_A1_KEY))).toBe(FIPS197_A1_KEY);
    expect(() => fromHex('0g')).toThrow(SyntaxError);
    expect(() => fromHex('abc')).toThrow(SyntaxError);
  });

  it('counts bits', () => {
    expect(POPCOUNT[0]).toBe(0);
    expect(POPCOUNT[0xff]).toBe(8);
    expect(countOnes(Uint8Array.of(0xff, 0x01))).toBe(9);
  });
});
