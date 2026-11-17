/**
 * An INDEPENDENT check on the key expansion.
 *
 * `aes-schedule.test.ts` pins all 44 words of FIPS 197 Appendix A.1. On its
 * own that is a regression baseline: a test that agrees with the code it
 * tests. So this suite closes the loop from outside. It builds the AES-128
 * cipher out of `expandKey`'s output -- which consumes every one of the 176
 * bytes, since each round key is XORed into the state -- and checks the
 * ciphertext against two things the code has no say in:
 *
 *   1. the FIPS 197 Appendix C.1 known-answer vector, and
 *   2. the platform's own AES, through WebCrypto, over random keys.
 *
 * A single wrong byte anywhere in the expansion changes the ciphertext, so if
 * these pass, the A.1 table in the sibling suite is right and so is the
 * expansion. The cipher lives here, in a test file, because the lab does not
 * encrypt anything -- the whole point of the attack is that it never needs to.
 */

import { describe, expect, it } from 'vitest';
import { SBOX, expandKey, fromHex, toHex } from './aes-schedule';

/** Multiply by x in GF(2^8). */
const xtime = (v: number): number => (((v << 1) & 0xff) ^ (v & 0x80 ? 0x1b : 0)) & 0xff;

/** AES-128 encryption of one block, driven by `expandKey`. */
function encryptBlock(key: Uint8Array, block: Uint8Array): Uint8Array {
  const rk = expandKey(key);
  let state = Uint8Array.from(block);
  for (let i = 0; i < 16; i++) state[i] ^= rk[i];
  for (let round = 1; round <= 10; round++) {
    // SubBytes + ShiftRows: the byte at row q, column c comes from column
    // (c + q) mod 4. FIPS 197 lays the state out column-major.
    const t = new Uint8Array(16);
    for (let c = 0; c < 4; c++) {
      for (let q = 0; q < 4; q++) t[c * 4 + q] = SBOX[state[(((c + q) % 4) * 4) + q]];
    }
    const out = new Uint8Array(16);
    if (round < 10) {
      for (let c = 0; c < 4; c++) {
        const a0 = t[c * 4];
        const a1 = t[c * 4 + 1];
        const a2 = t[c * 4 + 2];
        const a3 = t[c * 4 + 3];
        out[c * 4] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3;
        out[c * 4 + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3;
        out[c * 4 + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3);
        out[c * 4 + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3);
      }
    } else {
      out.set(t);
    }
    for (let i = 0; i < 16; i++) out[i] ^= rk[round * 16 + i];
    state = out;
  }
  return state;
}

/**
 * One AES block through WebCrypto. AES-CBC always pads, but with a zero IV the
 * FIRST output block is exactly the raw block cipher applied to the input, so
 * the first 16 bytes are an ECB encryption of `block`.
 */
async function platformEncryptBlock(key: Uint8Array, block: Uint8Array): Promise<Uint8Array> {
  // `.slice()` hands WebCrypto a view backed by a plain ArrayBuffer, which is
  // what the BufferSource type wants.
  const imported = await crypto.subtle.importKey('raw', key.slice(), { name: 'AES-CBC' }, false, [
    'encrypt',
  ]);
  const out = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: new Uint8Array(16) },
    imported,
    block.slice(),
  );
  return new Uint8Array(out).subarray(0, 16);
}

describe('check A (independent): the expansion drives a correct AES-128', () => {
  it('reproduces the FIPS 197 Appendix C.1 vector', () => {
    const key = fromHex('000102030405060708090a0b0c0d0e0f');
    const plain = fromHex('00112233445566778899aabbccddeeff');
    expect(toHex(encryptBlock(key, plain))).toBe('69c4e0d86a7b0430d8cdb78070b4c55a');
  });

  it("agrees with the platform's AES on the Appendix A.1 key", async () => {
    const key = fromHex('2b7e151628aed2a6abf7158809cf4f3c');
    const plain = fromHex('00112233445566778899aabbccddeeff');
    const theirs = await platformEncryptBlock(key, plain);
    expect(toHex(encryptBlock(key, plain))).toBe(toHex(theirs));
  });

  it("agrees with the platform's AES over 64 random keys and blocks", async () => {
    for (let i = 0; i < 64; i++) {
      const key = new Uint8Array(16);
      const plain = new Uint8Array(16);
      crypto.getRandomValues(key);
      crypto.getRandomValues(plain);
      const theirs = await platformEncryptBlock(key, plain);
      expect(toHex(encryptBlock(key, plain))).toBe(toHex(theirs));
    }
  });

  it('would notice a single corrupted schedule byte', () => {
    // Proves the oracle above has teeth: perturbing one byte of the expansion
    // moves the ciphertext, which is why matching it pins all 176 bytes.
    const key = fromHex('000102030405060708090a0b0c0d0e0f');
    const plain = fromHex('00112233445566778899aabbccddeeff');
    const good = expandKey(key);
    for (const index of [0, 17, 88, 175]) {
      const bent = Uint8Array.from(good);
      bent[index] ^= 0x01;
      let state = Uint8Array.from(plain);
      for (let i = 0; i < 16; i++) state[i] ^= bent[i];
      // Re-run the same rounds against the bent schedule; one XOR difference
      // is enough to change the output.
      let differs = false;
      for (let round = 1; round <= 10; round++) {
        const t = new Uint8Array(16);
        for (let c = 0; c < 4; c++) for (let q = 0; q < 4; q++) t[c * 4 + q] = SBOX[state[(((c + q) % 4) * 4) + q]];
        const out = new Uint8Array(16);
        if (round < 10) {
          for (let c = 0; c < 4; c++) {
            const [a0, a1, a2, a3] = [t[c * 4], t[c * 4 + 1], t[c * 4 + 2], t[c * 4 + 3]];
            out[c * 4] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3;
            out[c * 4 + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3;
            out[c * 4 + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3);
            out[c * 4 + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3);
          }
        } else {
          out.set(t);
        }
        for (let i = 0; i < 16; i++) out[i] ^= bent[round * 16 + i];
        state = out;
      }
      differs = toHex(state) !== '69c4e0d86a7b0430d8cdb78070b4c55a';
      expect(differs).toBe(true);
    }
  });
});
