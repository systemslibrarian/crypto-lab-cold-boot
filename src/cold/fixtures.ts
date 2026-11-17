/**
 * The two fixed images of the brief's check B.
 *
 * Built from the FIPS 197 Appendix A.1 schedule by a deterministic rule, so a
 * test and a clearly labelled control on the page can hold the same damaged
 * image in their hands and get the same answer twice. Everything else in the
 * lab draws from `crypto.getRandomValues`.
 *
 * Rule: for byte index i (0..175) and bit b (0 = least significant), if the
 * stored bit is 1 and the first byte of SHA-256("decay" || i || b) is less
 * than the threshold, clear it. Only ones are cleared, so these images have
 * d1 = 0 by construction and the hard consistency test applies.
 */

import { expandKey, fromHex } from './aes-schedule';
import { FIXED_IMAGE_THRESHOLDS, fixedDecayImage } from './decay';
import { sha256 } from './sha256';

/** The FIPS 197 Appendix A.1 key, which the fixed images decay from. */
export const FIXTURE_KEY_HEX = '2b7e151628aed2a6abf7158809cf4f3c';

export const FIXTURE_KEY: Uint8Array = fromHex(FIXTURE_KEY_HEX);
export const FIXTURE_SCHEDULE: Uint8Array = expandKey(FIXTURE_KEY);

const first = (bytes: Uint8Array): number => sha256(bytes)[0];

/** Threshold 38: about 14.8% of ones cleared. */
export const FIXED_IMAGE_LIGHT: Uint8Array = fixedDecayImage(
  FIXTURE_SCHEDULE,
  FIXED_IMAGE_THRESHOLDS.light,
  first,
);

/** Threshold 77: about 30.1% of ones cleared. */
export const FIXED_IMAGE_HEAVY: Uint8Array = fixedDecayImage(
  FIXTURE_SCHEDULE,
  FIXED_IMAGE_THRESHOLDS.heavy,
  first,
);

/**
 * What the brief says each fixed image is, independently of this code. The
 * tests assert every field; if the rule or the expansion drifts, they fail
 * naming the field that moved.
 */
export interface FixedImageFacts {
  readonly label: string;
  readonly threshold: number;
  readonly clearedBits: number;
  readonly imageKeyHex: string;
  readonly imageSha256: string;
  readonly lostKeyBits: number;
  readonly zeroBitsInKeyBytes: number;
}

export const FIXED_IMAGE_FACTS: Readonly<Record<'light' | 'heavy', FixedImageFacts>> = {
  light: {
    label: 'T = 38 (14.8% of ones cleared)',
    threshold: 38,
    clearedBits: 96,
    imageKeyHex: '207c0516288a92a6abb6158809494f2c',
    imageSha256: 'df2813a71468a70b33575a4ce30fe1152ce757d8d460bd192f672a801c0f9806',
    lostKeyBits: 14,
    zeroBitsInKeyBytes: 77,
  },
  heavy: {
    label: 'T = 77 (30.1% of ones cleared)',
    threshold: 77,
    clearedBits: 217,
    imageKeyHex: '207c0506208292a0a286158009094f2c',
    imageSha256: '6e7a2943b7b85d3a2b4344407e936be11ee065e858465ce122428b4e90966bd1',
    lostKeyBits: 25,
    zeroBitsInKeyBytes: 88,
  },
} as const;
