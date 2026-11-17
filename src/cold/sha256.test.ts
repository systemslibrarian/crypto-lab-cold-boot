import { describe, expect, it } from 'vitest';
import { sha256, sha256Hex } from './sha256';

describe('SHA-256', () => {
  it('matches the published FIPS 180-4 vectors', () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(
      sha256Hex(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it("agrees with the platform's SHA-256 over random inputs, including across block boundaries", async () => {
    for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 191, 1000]) {
      const input = new Uint8Array(length);
      crypto.getRandomValues(input);
      const theirs = new Uint8Array(await crypto.subtle.digest('SHA-256', input.slice()));
      expect(sha256Hex(input)).toBe(
        [...theirs].map((b) => b.toString(16).padStart(2, '0')).join(''),
      );
    }
  });

  it('returns 32 bytes', () => {
    expect(sha256(new Uint8Array(3))).toHaveLength(32);
  });
});
