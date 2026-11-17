/**
 * Candidate enumeration for one slice, with the chained consistency test.
 *
 * This is the step that makes cold-boot key recovery cheap, and the reason it
 * is cheap is worth stating plainly: the search never enumerates keys. It
 * enumerates the four key bytes of ONE position at a time, and immediately
 * spends them against every stored byte they determine.
 *
 * Slice p owns four key bytes -- a[p][0], b[p][0], c[p][0], d[j][0] with
 * j = (p+1) % 4 -- and from them derives a[p][1], b[p][1], c[p][1]. That is
 * the seven-byte slice of FIPS 197 redundancy: four unknowns, seven stored
 * bytes to check them against.
 *
 * Stopping there is a mistake, and an expensive one. Carrying the chain on
 * through round keys 2 .. 10 costs one more guessed byte per round -- the
 * neighbour's d[j][r-1], which position p's chain needs for its S-box input --
 * and buys FOUR more consistency tests:
 *
 *     a[p][r] = a[p][r-1] ^ S(d[j][r-1]) ^ rcon      <- tested
 *     b[p][r] = b[p][r-1] ^ a[p][r]                  <- tested
 *     c[p][r] = c[p][r-1] ^ b[p][r]                  <- tested
 *     c[j][r-1] = d[j][r-2] ^ d[j][r-1]              <- tested, and free:
 *                                                       two bytes we already
 *                                                       guessed pin a third
 *
 * One guessed byte is worth about 5 bits here; four tested bytes cost a
 * candidate about 14. So every extra round key shrinks the survivor set by
 * roughly 2^-9, and the measured figures follow: about 512 candidates survive
 * round key 1, about 16 survive round key 2, and from round key 3 on the slice
 * is pinned down. Joining slices on their round-key-1 bytes alone and
 * expanding every combination is the version that faces millions.
 */

import { POPCOUNT, RCON, SBOX, SCHEDULE_BYTES, aAt, bAt, cAt, dAt, roundOf } from './aes-schedule';
import type { StageCounts } from './types';

/** One surviving slice candidate: its key bytes and the chains it implies. */
export interface SliceChain {
  /** a[p][0], b[p][0], c[p][0], d[j][0] -- the four key bytes. */
  readonly keyBytes: Uint8Array;
  /** d[j][0 .. 9], the neighbour's d-chain this candidate assumed. */
  readonly dChain: Uint8Array;
  /** c[p][0 .. 10], this position's own c-chain, which the stitch checks. */
  readonly cChain: Uint8Array;
  /** Wrong-way bits this candidate needs across the bytes it was tested on. */
  readonly wrongWay: number;
}

export interface SliceSearch {
  readonly p: number;
  readonly chains: SliceChain[];
  readonly stages: StageCounts;
  readonly nodes: number;
  /** True when the search stopped early at `limit` rather than finishing. */
  readonly truncated: boolean;
}

/**
 * How much wrong-way slack the consistency test may spend, and where.
 *
 * `budget` is a count of wrong-way bits -- bits the image shows as 1 where a
 * candidate says 0. With d1 = 0 the budget is 0 and the test is hard.
 *
 * `slackFromRound` is the lowest round key in which a wrong-way bit may be
 * spent; 11 means nowhere. It exists for cost, not for correctness: slack in
 * round key 1 multiplies a set of ~512 survivors, slack in round key 7
 * multiplies a set of about one. reconstruct.ts offers the cheap end of that
 * first and ends by allowing slack everywhere, so no key is missed.
 */
export interface SliceBudget {
  readonly budget: number;
  readonly slackFromRound: number;
}

export const HARD_TEST: SliceBudget = { budget: 0, slackFromRound: 11 };

/* ------------------------------------------------------------------ *
 * Per-byte candidates.
 *
 * For an image byte g, the candidates needing exactly v wrong-way bits are the
 * bytes c with popcount(g & ~c) === v. v = 0 is "c contains every 1 bit of g",
 * the hard test. Within a v the list is ordered by how many bits the candidate
 * claims decayed, fewest first, which is likelihood order under the model:
 * every extra 1 bit in the candidate is another bit that had to decay.
 * ------------------------------------------------------------------ */

const CANDIDATE_CACHE = new Map<number, Uint8Array[][]>();

function candidateTable(maxBudget: number): Uint8Array[][] {
  const cached = CANDIDATE_CACHE.get(maxBudget);
  if (cached) return cached;
  const table: Uint8Array[][] = [];
  for (let g = 0; g < 256; g++) {
    const byViolations: number[][] = [];
    for (let v = 0; v <= maxBudget; v++) byViolations.push([]);
    for (let c = 0; c < 256; c++) {
      const v = POPCOUNT[g & ~c & 0xff];
      if (v <= maxBudget) byViolations[v].push(c);
    }
    for (const list of byViolations) {
      list.sort((x, y) => POPCOUNT[x & ~g & 0xff] - POPCOUNT[y & ~g & 0xff]);
    }
    table.push(byViolations.map((l) => Uint8Array.from(l)));
  }
  CANDIDATE_CACHE.set(maxBudget, table);
  return table;
}

/** Candidate bytes for image byte `g`, as a list of (value, violations) pairs. */
export function candidatesFor(g: number, budget: number, slack: boolean): Uint16Array {
  const table = candidateTable(slack ? budget : 0);
  const out: number[] = [];
  const cap = slack ? budget : 0;
  for (let v = 0; v <= cap; v++) {
    for (const c of table[g][v]) out.push(c | (v << 8));
  }
  return Uint16Array.from(out);
}

/**
 * Search slice `p` of an image.
 *
 * Receives the image and the budget. It is given no key, no schedule and no
 * decay draw -- the whole point of the attack is that the stored redundancy is
 * enough, so anything else in scope here would be cheating.
 *
 * `limit` caps the number of surviving chains kept, so a pathological image
 * cannot exhaust memory; `truncated` says when it bit.
 */
export function searchSlice(
  image: Uint8Array,
  p: number,
  budget: SliceBudget,
  limit = 1 << 16,
): SliceSearch {
  if (image.length !== SCHEDULE_BYTES) {
    throw new RangeError(`image must be ${SCHEDULE_BYTES} bytes, got ${image.length}`);
  }
  if (!Number.isInteger(p) || p < 0 || p > 3) throw new RangeError(`slice position must be 0..3, got ${p}`);

  const j = (p + 1) % 4;
  const isCore = p === 0; // only position 0 takes the round constant
  const { budget: cap, slackFromRound } = budget;
  const slackAt = (index: number): boolean => roundOf(index) >= slackFromRound;

  const chains: SliceChain[] = [];
  let nodes = 0;
  let truncated = false;
  const stage = new Int32Array(11); // stage[r] = survivors after round key r

  // Live chain state, reused across the whole depth-first walk.
  const aChain = new Uint8Array(11);
  const bChain = new Uint8Array(11);
  const cChain = new Uint8Array(11);
  const dChain = new Uint8Array(10); // d[j][0 .. 9]

  /**
   * pairList(slot, x): bytes v that are consistent with image byte `gSelf`
   * AND whose XOR with the known byte `x` is consistent with image byte
   * `gXor`, each tagged with the wrong-way bits it costs.
   *
   * Memoised on x per slot. The same x recurs across many partial candidates,
   * and recomputing the intersection for each of them is most of what a slow
   * implementation of this attack spends its time on.
   */
  const memo: Map<number, Uint16Array>[] = [];
  for (let slot = 0; slot < 14; slot++) memo.push(new Map());

  const pairList = (
    slot: number,
    gSelf: number,
    gXor: number,
    selfSlack: boolean,
    xorSlack: boolean,
    x: number,
  ): Uint16Array => {
    const bucket = memo[slot];
    const hit = bucket.get(x);
    if (hit) return hit;
    const self = candidatesFor(gSelf, cap, selfSlack);
    const out: number[] = [];
    for (let n = 0; n < self.length; n++) {
      const value = self[n] & 0xff;
      const cost = self[n] >> 8;
      const xorViolations = POPCOUNT[gXor & ~((value ^ x) & 0xff) & 0xff];
      if (xorViolations > 0 && !xorSlack) continue;
      const total = cost + xorViolations;
      if (total <= cap) out.push(value | (total << 8));
    }
    const list = Uint16Array.from(out);
    bucket.set(x, list);
    return list;
  };

  /* Round keys 2 .. 10: one guessed neighbour byte, four tested bytes. */
  const extend = (r: number, spent: number): void => {
    if (r === 11) {
      if (chains.length >= limit) {
        truncated = true;
        return;
      }
      chains.push({
        keyBytes: Uint8Array.of(aChain[0], bChain[0], cChain[0], dChain[0]),
        dChain: Uint8Array.from(dChain),
        cChain: Uint8Array.from(cChain),
        wrongWay: spent,
      });
      return;
    }

    // d[j][r-1] is the neighbour byte position p needs next. Guessing it also
    // pins c[j][r-1] = d[j][r-2] ^ d[j][r-1], so the list is filtered on both
    // stored bytes before a single round key byte is derived.
    const dIndex = dAt(j, r - 1);
    const cIndex = cAt(j, r - 1);
    const list = pairList(r, image[dIndex], image[cIndex], slackAt(dIndex), slackAt(cIndex), dChain[r - 2]);

    const aIndex = aAt(p, r);
    const bIndex = bAt(p, r);
    const cIndexSelf = cAt(p, r);
    const ha = image[aIndex];
    const hb = image[bIndex];
    const hc = image[cIndexSelf];
    const aSlack = slackAt(aIndex);
    const bSlack = slackAt(bIndex);
    const cSlack = slackAt(cIndexSelf);
    const rcon = isCore ? RCON[r - 1] : 0;

    for (let n = 0; n < list.length; n++) {
      nodes++;
      const guess = list[n] & 0xff;
      let used = spent + (list[n] >> 8);
      if (used > cap) continue;

      const a = (aChain[r - 1] ^ SBOX[guess] ^ rcon) & 0xff;
      const av = POPCOUNT[ha & ~a & 0xff];
      if (av > 0 && !aSlack) continue;
      used += av;
      if (used > cap) continue;

      const b = (bChain[r - 1] ^ a) & 0xff;
      const bv = POPCOUNT[hb & ~b & 0xff];
      if (bv > 0 && !bSlack) continue;
      used += bv;
      if (used > cap) continue;

      const c = (cChain[r - 1] ^ b) & 0xff;
      const cv = POPCOUNT[hc & ~c & 0xff];
      if (cv > 0 && !cSlack) continue;
      used += cv;
      if (used > cap) continue;

      dChain[r - 1] = guess;
      aChain[r] = a;
      bChain[r] = b;
      cChain[r] = c;
      stage[r]++;
      extend(r + 1, used);
      if (truncated) return;
    }
  };

  /* Round key 1: the seven-byte slice itself. */
  const kA = aAt(p, 0);
  const kB = bAt(p, 0);
  const kC = cAt(p, 0);
  const kD = dAt(j, 0);
  const r1a = aAt(p, 1);
  const r1b = bAt(p, 1);
  const r1c = cAt(p, 1);
  const rcon1 = isCore ? RCON[0] : 0;
  const aSlack1 = slackAt(r1a);

  const firstBytes = candidatesFor(image[kA], cap, slackAt(kA));
  const fourthBytes = candidatesFor(image[kD], cap, slackAt(kD));

  for (let i0 = 0; i0 < firstBytes.length; i0++) {
    const k0 = firstBytes[i0] & 0xff;
    const cost0 = firstBytes[i0] >> 8;
    if (cost0 > cap) continue;
    for (let i3 = 0; i3 < fourthBytes.length; i3++) {
      nodes++;
      const k3 = fourthBytes[i3] & 0xff;
      let used = cost0 + (fourthBytes[i3] >> 8);
      if (used > cap) continue;

      const a1 = (k0 ^ SBOX[k3] ^ rcon1) & 0xff;
      const av = POPCOUNT[image[r1a] & ~a1 & 0xff];
      if (av > 0 && !aSlack1) continue;
      used += av;
      if (used > cap) continue;

      // b[p][0] is pinned by two stored bytes at once: its own image byte and
      // b[p][1] = b[p][0] ^ a[p][1], with a[p][1] now known.
      const second = pairList(11, image[kB], image[r1b], slackAt(kB), slackAt(r1b), a1);
      for (let i1 = 0; i1 < second.length; i1++) {
        nodes++;
        const k1 = second[i1] & 0xff;
        const used1 = used + (second[i1] >> 8);
        if (used1 > cap) continue;
        const b1 = (k1 ^ a1) & 0xff;

        const third = pairList(12, image[kC], image[r1c], slackAt(kC), slackAt(r1c), b1);
        for (let i2 = 0; i2 < third.length; i2++) {
          nodes++;
          const k2 = third[i2] & 0xff;
          const used2 = used1 + (third[i2] >> 8);
          if (used2 > cap) continue;
          const c1 = (k2 ^ b1) & 0xff;

          aChain[0] = k0;
          bChain[0] = k1;
          cChain[0] = k2;
          dChain[0] = k3;
          aChain[1] = a1;
          bChain[1] = b1;
          cChain[1] = c1;
          stage[1]++;
          extend(2, used2);
          if (truncated) return finish();
        }
      }
    }
  }

  function finish(): SliceSearch {
    return {
      p,
      chains,
      stages: {
        afterRound1: stage[1],
        afterRound2: stage[2],
        afterRound3: stage[3],
        final: chains.length,
      },
      nodes,
      truncated,
    };
  }

  return finish();
}
