/**
 * Joining the four slices, and certifying the result.
 *
 * Each slice search returns candidates that fit the stored bytes its own
 * position touches. The four are not independent: slice p guessed its
 * neighbour's d-chain, d[j][0 .. 9] with j = (p+1) % 4, and slice j computes
 * that same chain from its own bytes, because
 *
 *     d[j][r] = d[j][r-1] ^ c[j][r]
 *
 * So a combination is only coherent when what slice p assumed about its
 * neighbour is what slice j actually produces. Nine bytes have to agree per
 * adjacent pair, which is why so few combinations reach the expansion below.
 *
 * The certificate is the last step and it is the point of the whole attack:
 * expand the assembled key for real and ask whether all 176 bytes of that
 * expansion could have decayed into the image. No plaintext. No ciphertext.
 * Nothing but the damaged image and FIPS 197.
 */

import { KEY_BYTES, POPCOUNT, SCHEDULE_BYTES, aAt, bAt, cAt, dAt, expandKey } from './aes-schedule';
import type { SliceChain } from './slice';

export interface StitchResult {
  /** Keys whose full expansion is consistent with the whole image. */
  readonly keys: Uint8Array[];
  /** Combinations whose d-chains agreed and were therefore fully expanded. */
  readonly combinationsChecked: number;
  /** Wrong-way bits the first accepted key needs across all 176 bytes. */
  readonly wrongWayBitsUsed: number;
  /** Nodes walked in the join. */
  readonly nodes: number;
}

/**
 * Wrong-way bits a candidate schedule needs to explain an image, stopping as
 * soon as it exceeds `cap`. Bits the candidate has but the image does not are
 * free -- those are the bits that decayed.
 */
export function scheduleWrongWayBits(candidate: Uint8Array, image: Uint8Array, cap: number): number {
  // Both arguments must be whole schedules. Checked rather than assumed: a
  // caller that passed the 16 key bytes here would otherwise read past the
  // end, get 0xff for every missing byte, and be told the candidate was
  // hopeless -- a silent wrong answer where "compare only the key bytes" is
  // precisely the mistake this function exists to prevent.
  if (candidate.length !== SCHEDULE_BYTES || image.length !== SCHEDULE_BYTES) {
    throw new RangeError(`the full-schedule check needs two ${SCHEDULE_BYTES}-byte arrays`);
  }
  let total = 0;
  for (let i = 0; i < SCHEDULE_BYTES; i++) {
    total += POPCOUNT[image[i] & ~candidate[i] & 0xff];
    if (total > cap) return total;
  }
  return total;
}

/**
 * Assemble the 16 key bytes implied by one candidate per slice.
 *
 * Slice p contributes a[p][0], b[p][0], c[p][0] and d[(p+1) % 4][0]; over the
 * four slices the d bytes come round to cover all four positions, so the 16
 * bytes are each written exactly once.
 */
export function assembleKey(picks: readonly SliceChain[]): Uint8Array {
  if (picks.length !== 4) throw new RangeError('need one candidate per slice');
  const key = new Uint8Array(KEY_BYTES);
  for (let p = 0; p < 4; p++) {
    const chain = picks[p].keyBytes;
    key[aAt(p, 0)] = chain[0];
    key[bAt(p, 0)] = chain[1];
    key[cAt(p, 0)] = chain[2];
    key[dAt((p + 1) % 4, 0)] = chain[3];
  }
  return key;
}

/**
 * Does what slice `p` assumed about its neighbour's d-chain match what slice
 * `j` produces? Checks d[j][r] = d[j][r-1] ^ c[j][r] for r = 1 .. 9.
 *
 * r = 10 is left out on purpose: slice p never needed d[j][10], so it never
 * guessed it. The full expansion below is what checks that byte.
 */
export function neighbourAgrees(owner: SliceChain, neighbour: SliceChain): boolean {
  for (let r = 1; r <= 9; r++) {
    if (((owner.dChain[r - 1] ^ neighbour.cChain[r]) & 0xff) !== owner.dChain[r]) return false;
  }
  return true;
}

/**
 * Join four candidate lists into keys consistent with the whole image.
 *
 * `cap` is the wrong-way budget for the full 176-byte check. `stopAtFirst`
 * returns as soon as one key is certified, which is what the page does: the
 * full-schedule check is a certificate, so the first key to pass it is the
 * answer. Pass false to count how many keys pass at all.
 */
export function stitch(
  lists: readonly SliceChain[][],
  image: Uint8Array,
  cap: number,
  stopAtFirst = true,
): StitchResult {
  if (lists.length !== 4) throw new RangeError('need four slice candidate lists');
  if (image.length !== SCHEDULE_BYTES) throw new RangeError(`image must be ${SCHEDULE_BYTES} bytes`);

  const keys: Uint8Array[] = [];
  const picks: SliceChain[] = new Array(4);
  let combinationsChecked = 0;
  let wrongWayBitsUsed = 0;
  let nodes = 0;
  let done = false;

  const walk = (p: number): void => {
    if (done) return;
    if (p === 4) {
      // Close the cycle: slice 3 assumed slice 0's d-chain.
      if (!neighbourAgrees(picks[3], picks[0])) return;
      combinationsChecked++;
      const key = assembleKey(picks);
      const used = scheduleWrongWayBits(expandKey(key), image, cap);
      if (used > cap) return;
      if (keys.length === 0) wrongWayBitsUsed = used;
      keys.push(key);
      if (stopAtFirst) done = true;
      return;
    }
    for (const candidate of lists[p]) {
      nodes++;
      picks[p] = candidate;
      // Check the pair (p-1, p) the moment both are chosen.
      if (p > 0 && !neighbourAgrees(picks[p - 1], candidate)) continue;
      walk(p + 1);
      if (done) return;
    }
  };

  walk(0);
  return { keys, combinationsChecked, wrongWayBitsUsed, nodes };
}
