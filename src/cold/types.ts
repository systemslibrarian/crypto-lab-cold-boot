/**
 * The error model, and the extension seams the brief asks to be shaped but not
 * built.
 */

/**
 * The decay model: a binary asymmetric channel, from "Lest We Remember"
 * section 5.1.
 *
 * `d0` is the probability a stored 1 has decayed to 0; `d1` the probability a
 * stored 0 has flipped the wrong way, to 1. In the paper d0 grows with time
 * since power loss and d1 stays small and roughly constant (under 0.1% in
 * their tests).
 *
 * This is a MODEL, not a measurement. The paper's own numbers for how fast
 * real DRAM decays, and at what temperature, are in its section 3; nothing in
 * this lab reproduces them, and the decay control here is not a clock.
 */
export interface ErrorModel {
  /** P(stored 1 reads as 0). 0 .. 1. */
  readonly d0: number;
  /** P(stored 0 reads as 1). 0 .. 1. */
  readonly d1: number;
}

/**
 * Ground state per bit.
 *
 * Real memory has regions whose cells decay to 0 and regions whose cells decay
 * to 1; the paper says so, and says its algorithms work either way given the
 * ground state of each cell. This lab fixes one ground state, 0, for every
 * bit, and the page says so.
 *
 * [extension] point: a GroundState map over the 176 byte positions, read by
 * decay.ts and by the consistency test in slice.ts, would lift that
 * restriction. Not built here.
 */
export type GroundState = 0 | 1;

/**
 * The relations a stored key expansion satisfies.
 *
 * [extension] point: AES-192 and AES-256 have the same shape with different
 * word recurrences; DES's schedule is a repetition code (paper section 5.1);
 * an RSA private-key record relates p, q, d, dp, dq (section 5.4). Each would
 * supply a different Schedule and reuse the search in slice.ts and stitch.ts
 * unchanged. Not built here.
 */
export interface Schedule {
  /** Bytes in the stored, expanded form. */
  readonly storedBytes: number;
  /** Bytes in the secret itself. */
  readonly secretBytes: number;
  /** Expand a secret into its stored form. */
  expand(secret: Uint8Array): Uint8Array;
}

/** What a reconstruction attempt concluded. */
export type Outcome =
  /** A key was found whose full expansion is consistent with the whole image. */
  | 'recovered'
  /** The search finished and no key is consistent with the image under the model. */
  | 'no-consistent-key'
  /** The time budget ran out before the search finished. Not a failure of the method. */
  | 'budget-exhausted'
  /** The input was refused before any search ran. */
  | 'refused';

/** Per-slice survivor counts, by round key, as the chained test narrows them. */
export interface StageCounts {
  /** Survivors after round key 1's three derived bytes. */
  readonly afterRound1: number;
  /** Survivors after round key 2. */
  readonly afterRound2: number;
  /** Survivors after round key 3. */
  readonly afterRound3: number;
  /** Survivors after all ten round keys -- what the stitch receives. */
  readonly final: number;
}

/** What one reconstruction run measured and concluded. */
export interface ReconstructResult {
  readonly outcome: Outcome;
  /** The recovered key, or null. 16 bytes. */
  readonly key: Uint8Array | null;
  /**
   * True when `key` re-expanded is consistent with all 176 image bytes under
   * the model. This is the certificate, and it needs no plaintext, no
   * ciphertext and no knowledge of the true key.
   */
  readonly certified: boolean;
  /** Wrong-way bits the accepted key's own expansion needs across the image. */
  readonly wrongWayBitsUsed: number;
  /** Per-slice stage counts, in position order. */
  readonly stages: readonly StageCounts[];
  /** Candidate combinations the stitch fully expanded and checked. */
  readonly combinationsChecked: number;
  /** Search tree nodes visited, the honest measure of work done. */
  readonly nodes: number;
  /** Milliseconds spent, measured. */
  readonly ms: number;
  /** The rungs of the escalation ladder actually run. */
  readonly ladder: readonly LadderRung[];
  /** Set when the input was refused; the reason, for the page to show. */
  readonly refusal: string | null;
}

/**
 * One rung of the wrong-way budget ladder.
 *
 * With d1 = 0 only the first rung runs and the consistency test is hard: every
 * true byte must contain every 1 bit of its image byte. With d1 > 0 a budget
 * of wrong-way bits is allowed and raised until a key passes the full-schedule
 * test.
 */
export interface LadderRung {
  /** Wrong-way bits allowed on this rung. */
  readonly budget: number;
  /**
   * Lowest round key in which a wrong-way bit may be spent. 11 means nowhere
   * (the hard test). Slack is offered first in the later round keys, where the
   * search is already narrow, and only then in the key and the first round
   * keys, where it is wide -- the last rung allows it anywhere, so nothing is
   * missed.
   */
  readonly slackFromRound: number;
  /** Whether this rung found a certified key. */
  readonly found: boolean;
  /** Nodes visited on this rung. */
  readonly nodes: number;
  /** Milliseconds spent on this rung. */
  readonly ms: number;
}
