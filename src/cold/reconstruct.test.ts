import { describe, expect, it } from 'vitest';
import {
  KEY_BYTES,
  SCHEDULE_BYTES,
  aAt,
  bAt,
  cAt,
  countOnes,
  dAt,
  expandKey,
  toHex,
} from './aes-schedule';
import { damageBetween, decaySchedule, seededRandom, wrongWayBits } from './decay';
import {
  FIXED_IMAGE_FACTS,
  FIXED_IMAGE_HEAVY,
  FIXED_IMAGE_LIGHT,
  FIXTURE_KEY,
  FIXTURE_KEY_HEX,
  FIXTURE_SCHEDULE,
} from './fixtures';
import { DEFAULT_LIMITS, ladderFor, matchesTruth, reconstruct } from './reconstruct';
import { sha256Hex } from './sha256';
import { zeroBits } from './naive';

const ONE_WAY = { d0: 0.15, d1: 0 } as const;
const fast = { ...DEFAULT_LIMITS, timeBudgetMs: 60_000, maxWrongWayBudget: 0 };

/**
 * CHECK B -- two fixed images, built by a deterministic rule, recovered from
 * the image alone.
 *
 * Every number here came from the brief, which derived them independently of
 * any implementation. They are asserted field by field so that a drift in the
 * decay rule, the expansion or the hash fails naming the field that moved.
 */
describe('check B: the two fixed images', () => {
  it('the fixture schedule is the FIPS 197 Appendix A.1 expansion', () => {
    expect(toHex(FIXTURE_SCHEDULE.subarray(0, KEY_BYTES))).toBe(FIXTURE_KEY_HEX);
    expect(countOnes(FIXTURE_SCHEDULE)).toBe(720);
    expect(sha256Hex(FIXTURE_SCHEDULE)).toBe(
      '2604b57171cdcd0f2e68a831e2354a9f0030a055491f01f7c62392d16e908e9c',
    );
  });

  for (const [name, image] of [
    ['light', FIXED_IMAGE_LIGHT],
    ['heavy', FIXED_IMAGE_HEAVY],
  ] as const) {
    const facts = FIXED_IMAGE_FACTS[name];

    describe(facts.label, () => {
      const damage = damageBetween(FIXTURE_SCHEDULE, image);

      it('cleared exactly the stated number of bits, and only ones', () => {
        expect(damage.lostBits).toBe(facts.clearedBits);
        expect(damage.wrongWayBits).toBe(0);
      });

      it('has the stated key bytes and SHA-256', () => {
        expect(toHex(image.subarray(0, KEY_BYTES))).toBe(facts.imageKeyHex);
        expect(sha256Hex(image)).toBe(facts.imageSha256);
      });

      it('has the stated damage to the key itself', () => {
        expect(damage.lostKeyBits).toBe(facts.lostKeyBits);
        expect(zeroBits(image.subarray(0, KEY_BYTES))).toBe(facts.zeroBitsInKeyBytes);
      });

      it('yields the true key FROM THE IMAGE ALONE', () => {
        const result = reconstruct(image, ONE_WAY, fast);
        expect(result.outcome).toBe('recovered');
        expect(result.key).not.toBeNull();
        expect(toHex(result.key!)).toBe(FIXTURE_KEY_HEX);
      });

      it('certifies that key without being told the answer, and the answer agrees', () => {
        const result = reconstruct(image, ONE_WAY, fast);
        // The certificate: the recovered key re-expanded explains all 176
        // image bytes. Needs no plaintext, no ciphertext, no true key.
        expect(result.certified).toBe(true);
        expect(wrongWayBits(expandKey(result.key!), image)).toBe(0);
        // Reported separately, because only a demo can check it.
        expect(matchesTruth(result.key, FIXTURE_KEY)).toBe(true);
      });

      it('narrows the slices monotonically, round key by round key', () => {
        const result = reconstruct(image, ONE_WAY, fast);
        for (const stage of result.stages) {
          expect(stage.afterRound1).toBeGreaterThan(0);
          expect(stage.afterRound2).toBeLessThanOrEqual(stage.afterRound1);
          expect(stage.afterRound3).toBeLessThanOrEqual(stage.afterRound2);
          expect(stage.final).toBeLessThanOrEqual(stage.afterRound3);
          expect(stage.final).toBeGreaterThan(0);
        }
      });
    });
  }
});

/**
 * CHECK G -- the fail-closed paths, each a named test. Every one of these is
 * an EDGE CASE from the brief, and each teaches through the message it
 * produces rather than by crashing.
 */
describe('check G: fail-closed paths', () => {
  it('EDGE: decay 0 means the image IS the schedule, and nothing was lost', () => {
    const image = decaySchedule(FIXTURE_SCHEDULE, { d0: 0, d1: 0 }, seededRandom(1));
    expect(toHex(image)).toBe(toHex(FIXTURE_SCHEDULE));
    const damage = damageBetween(FIXTURE_SCHEDULE, image);
    expect(damage.lostBits).toBe(0);
    expect(damage.wrongWayBits).toBe(0);
    const result = reconstruct(image, { d0: 0, d1: 0 }, fast);
    expect(result.outcome).toBe('recovered');
    expect(matchesTruth(result.key, FIXTURE_KEY)).toBe(true);
  });

  it('EDGE: 176 random bytes are not a decayed AES-128 schedule, so no key is returned', () => {
    const image = new Uint8Array(SCHEDULE_BYTES);
    crypto.getRandomValues(image);
    const result = reconstruct(image, ONE_WAY, fast);
    expect(result.outcome).toBe('no-consistent-key');
    expect(result.key).toBeNull();
    expect(result.certified).toBe(false);
  });

  it('EDGE: an image that is not 176 bytes is refused before any search runs', () => {
    for (const length of [0, 15, 16, 175, 177, 352]) {
      const result = reconstruct(new Uint8Array(length), ONE_WAY, fast);
      expect(result.outcome).toBe('refused');
      expect(result.key).toBeNull();
      expect(result.nodes).toBe(0);
      expect(result.refusal).toMatch(/176 bytes/);
      expect(result.refusal).toContain(String(length));
    }
  });

  it('EDGE: a wrong-way flip with budget 0 fails the hard test, and says so', () => {
    const image = Uint8Array.from(FIXED_IMAGE_LIGHT);
    // Set a bit the true schedule does not have: a flip AWAY from the ground
    // state, which the hard test forbids by construction.
    const index = 100;
    const spare = ~FIXTURE_SCHEDULE[index] & 0xff;
    const bit = spare & -spare;
    expect(bit).toBeGreaterThan(0);
    image[index] |= bit;
    expect(wrongWayBits(FIXTURE_SCHEDULE, image)).toBe(1);

    const hard = reconstruct(image, { d0: 0.15, d1: 0 }, { ...fast, maxWrongWayBudget: 0 });
    expect(hard.outcome).toBe('no-consistent-key');
    expect(hard.ladder).toHaveLength(1);
    expect(hard.ladder[0].budget).toBe(0);
    expect(hard.ladder[0].slackFromRound).toBe(11);

    // The ranked search, offered a budget, finds it.
    const ranked = reconstruct(image, { d0: 0.15, d1: 0.001 }, { ...fast, maxWrongWayBudget: 3 });
    expect(ranked.outcome).toBe('recovered');
    expect(matchesTruth(ranked.key, FIXTURE_KEY)).toBe(true);
    expect(ranked.wrongWayBitsUsed).toBe(1);
    expect(ranked.ladder.length).toBeGreaterThan(1);
  });

  it('EDGE: a time budget that runs out reports a budget, never a failed method', () => {
    // Drive the clock by hand so the test is deterministic: the injected
    // `now` jumps past the budget on its third reading.
    let reads = 0;
    const result = reconstruct(FIXED_IMAGE_HEAVY, ONE_WAY, {
      ...fast,
      timeBudgetMs: 10,
      now: () => (++reads > 2 ? 10_000 : 0),
    });
    expect(result.outcome).toBe('budget-exhausted');
    expect(result.key).toBeNull();
    expect(result.certified).toBe(false);
  });

  it('EDGE: a cancelled search reports the budget outcome, not a result', () => {
    const result = reconstruct(FIXED_IMAGE_HEAVY, ONE_WAY, { ...fast, cancelled: () => true });
    expect(result.outcome).toBe('budget-exhausted');
    expect(result.key).toBeNull();
  });

  it('refuses a model whose probabilities are not probabilities', () => {
    for (const model of [
      { d0: -0.1, d1: 0 },
      { d0: 1.5, d1: 0 },
      { d0: 0.15, d1: Number.NaN },
    ]) {
      const result = reconstruct(FIXED_IMAGE_LIGHT, model, fast);
      expect(result.outcome).toBe('refused');
      expect(result.refusal).toMatch(/probability/);
    }
  });
});

/**
 * INVARIANT 2 -- the reconstruction gets the image and the model, and nothing
 * else. Enforced by the signature; this test is the demonstration that nothing
 * else is in scope.
 */
describe('invariant 2: the reconstruction sees the image and the model only', () => {
  it('recovers with only those two values in scope', () => {
    // Everything about the key and the decay draw is confined to this block
    // and discarded; `call` closes over the image and the model alone.
    const call = (() => {
      const key = new Uint8Array(KEY_BYTES);
      crypto.getRandomValues(key);
      const image = decaySchedule(expandKey(key), ONE_WAY, seededRandom(99));
      const expected = toHex(key);
      const model = ONE_WAY;
      return {
        expected,
        run: () => reconstruct(image, model, fast),
      };
    })();

    const result = call.run();
    expect(result.outcome).toBe('recovered');
    expect(toHex(result.key!)).toBe(call.expected);
  });

  it('takes exactly three parameters, the third optional', () => {
    expect(reconstruct).toHaveLength(2);
  });
});

/**
 * INVARIANT 3 -- certification and truth are two different claims, reported
 * separately, because only one of them is available to an attacker.
 */
describe('invariant 3: certification is separate from knowing the answer', () => {
  it('certifies against the image, not against the key', () => {
    const result = reconstruct(FIXED_IMAGE_HEAVY, ONE_WAY, fast);
    expect(result.certified).toBe(true);
    expect(matchesTruth(result.key, FIXTURE_KEY)).toBe(true);
    // And matchesTruth is choosy: a different key is not the key.
    const other = Uint8Array.from(FIXTURE_KEY);
    other[0] ^= 1;
    expect(matchesTruth(other, FIXTURE_KEY)).toBe(false);
    expect(matchesTruth(null, FIXTURE_KEY)).toBe(false);
    expect(matchesTruth(new Uint8Array(15), FIXTURE_KEY)).toBe(false);
  });

  it('never reports certified without a key', () => {
    const image = new Uint8Array(SCHEDULE_BYTES);
    crypto.getRandomValues(image);
    const result = reconstruct(image, ONE_WAY, fast);
    expect(result.certified).toBe(result.key !== null);
  });
});

/**
 * What the full-schedule check adds that nothing else does.
 *
 * The certificate is the last step of the search, and it is easy to assume it
 * is belt-and-braces over the chained test that came before it. It is not.
 * Four bytes of the 176 -- w43, the d column of the last round key -- are
 * viewed by NO slice search: slice p reads its neighbour's d chain only as far
 * as d[j][9], because d[j][10] is never an S-box input for anything. So those
 * four bytes are checked exactly once, by the full expansion, and an image
 * that disagrees with a key only there is rejected only there.
 *
 * This is also the correct bite for the brief's mutation 7 ("recovered" set
 * without the full-schedule check). The brief names 176 random bytes as that
 * bite, and measured here it does not bite: for a random image all four slice
 * lists come back EMPTY, so the search never reaches the check the mutation
 * removes. The test below does reach it.
 */
describe('the certificate is the only thing that sees the last round key', () => {
  /** The four bytes w43 -- d[p][10] for p = 0..3. */
  const LAST_WORD = [172, 173, 174, 175];

  it('no slice search looks at w43, so only the full expansion can reject it', () => {
    const viewed = new Set<number>();
    for (let p = 0; p < 4; p++) {
      const j = (p + 1) % 4;
      for (let r = 0; r <= 10; r++) {
        viewed.add(aAt(p, r));
        viewed.add(bAt(p, r));
        viewed.add(cAt(p, r));
      }
      // Slice p guesses its neighbour's d chain only to d[j][9] ...
      for (let r = 0; r <= 9; r++) viewed.add(dAt(j, r));
      // ... and derives the neighbour's c chain from consecutive d bytes.
      for (let r = 1; r <= 9; r++) viewed.add(cAt(j, r));
    }
    const unviewed = [...Array(SCHEDULE_BYTES).keys()].filter((i) => !viewed.has(i));
    expect(unviewed).toEqual(LAST_WORD);
  });

  it.each(LAST_WORD)(
    'BITE: a valid schedule with one wrong-way bit in byte %i yields NO key',
    (index) => {
      const image = Uint8Array.from(FIXTURE_SCHEDULE);
      // Set a bit the true schedule does not have, in a byte nothing but the
      // full expansion examines.
      const spare = ~FIXTURE_SCHEDULE[index] & 0xff;
      const bit = spare & -spare;
      expect(bit).toBeGreaterThan(0);
      image[index] |= bit;
      expect(wrongWayBits(FIXTURE_SCHEDULE, image)).toBe(1);

      const result = reconstruct(image, ONE_WAY, fast);
      // Every slice still agrees, every chain still joins -- and the key is
      // still refused, because its expansion cannot explain this image.
      expect(result.outcome).toBe('no-consistent-key');
      expect(result.key).toBeNull();
      expect(result.certified).toBe(false);
      // Proof the search really did get that far, unlike the random-bytes
      // fixture, where all four slice lists come back empty.
      expect(result.combinationsChecked).toBeGreaterThan(0);
    },
  );

  it('and with a budget for that one bit, the same image yields the key', () => {
    const image = Uint8Array.from(FIXTURE_SCHEDULE);
    const spare = ~FIXTURE_SCHEDULE[172] & 0xff;
    image[172] |= spare & -spare;
    const result = reconstruct(image, { d0: 0.15, d1: 0.001 }, { ...fast, maxWrongWayBudget: 1 });
    expect(result.outcome).toBe('recovered');
    expect(matchesTruth(result.key, FIXTURE_KEY)).toBe(true);
    expect(result.wrongWayBitsUsed).toBe(1);
  });

  it('a random image never reaches the certificate at all', () => {
    // Recorded because it is what makes the brief's named bite fixture for
    // mutation 7 inert: the chained test rejects a random image four slices
    // before the full expansion is reached.
    const noise = new Uint8Array(SCHEDULE_BYTES);
    crypto.getRandomValues(noise);
    const result = reconstruct(noise, ONE_WAY, fast);
    expect(result.outcome).toBe('no-consistent-key');
    expect(result.combinationsChecked).toBe(0);
    for (const stage of result.stages) expect(stage.final).toBe(0);
  });
});

describe('the escalation ladder', () => {
  it('has a single hard rung when there are no wrong-way flips to expect', () => {
    expect(ladderFor({ d0: 0.3, d1: 0 }, 3)).toEqual([
      { sliceBudget: 0, slackFromRound: 11, totalBudget: 0 },
    ]);
  });

  it('offers each slice budget first in the later round keys, then anywhere', () => {
    expect(ladderFor({ d0: 0.15, d1: 0.001 }, 1)).toEqual([
      { sliceBudget: 0, slackFromRound: 11, totalBudget: 0 },
      { sliceBudget: 1, slackFromRound: 3, totalBudget: 1 },
      { sliceBudget: 1, slackFromRound: 0, totalBudget: 1 },
    ]);
  });

  it('tries a HIGHER total budget against the same slice budget before raising it', () => {
    // The point of the three dials: two wrong-way flips usually land in two
    // different slices' views, so a slice budget of one with a total of two
    // finds them -- without paying for a slice search at budget two.
    const ladder = ladderFor({ d0: 0.15, d1: 0.001 }, 2);
    const firstTwoTotal = ladder.findIndex((s) => s.totalBudget === 2);
    const firstTwoSlice = ladder.findIndex((s) => s.sliceBudget === 2);
    expect(firstTwoTotal).toBeGreaterThan(0);
    expect(firstTwoTotal).toBeLessThan(firstTwoSlice);
  });

  it('never offers a total budget below the slice budget', () => {
    for (const step of ladderFor({ d0: 0.15, d1: 0.001 }, 3)) {
      expect(step.totalBudget).toBeGreaterThanOrEqual(step.sliceBudget);
    }
  });

  it('ends at the widest rung, so the ordering cannot hide a key', () => {
    const ladder = ladderFor({ d0: 0.15, d1: 0.001 }, 3);
    expect(ladder[ladder.length - 1]).toEqual({
      sliceBudget: 3,
      slackFromRound: 0,
      totalBudget: 3,
    });
  });
});

describe('recovery across the decay range', () => {
  for (const d0 of [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]) {
    it(`recovers a random key at ${Math.round(d0 * 100)}% decay`, () => {
      const key = new Uint8Array(KEY_BYTES);
      crypto.getRandomValues(key);
      const schedule = expandKey(key);
      const image = decaySchedule(schedule, { d0, d1: 0 }, seededRandom(0xc01d + d0 * 1000));
      const result = reconstruct(image, { d0, d1: 0 }, { ...fast, timeBudgetMs: 120_000 });
      expect(result.outcome).toBe('recovered');
      expect(matchesTruth(result.key, key)).toBe(true);
      expect(result.certified).toBe(true);
    });
  }
});
