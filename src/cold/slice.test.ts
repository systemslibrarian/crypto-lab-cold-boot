import { describe, expect, it } from 'vitest';
import { KEY_BYTES, RCON, SBOX, SLICES, aAt, bAt, cAt, dAt, expandKey, toHex } from './aes-schedule';
import { decaySchedule, seededRandom, wrongWayBits } from './decay';
import { FIXED_IMAGE_HEAVY, FIXED_IMAGE_LIGHT, FIXTURE_KEY, FIXTURE_SCHEDULE } from './fixtures';
import { HARD_TEST, candidatesFor, searchSlice } from './slice';
import { assembleKey, neighbourAgrees, scheduleWrongWayBits, stitch } from './stitch';

const sliceOf = (image: Uint8Array, p: number, limit?: number) =>
  searchSlice(image, p, HARD_TEST, limit);

describe('per-byte candidates', () => {
  it('under the hard test, candidates are exactly the supersets of the image byte', () => {
    for (const g of [0x00, 0x01, 0x5a, 0xfe, 0xff]) {
      const list = candidatesFor(g, 0, false);
      const values = [...list].map((v) => v & 0xff);
      const zeros = 8 - [...Array(8)].filter((_, b) => (g >> b) & 1).length;
      expect(values).toHaveLength(1 << zeros);
      for (const c of values) expect(c & g).toBe(g); // c contains every 1 bit of g
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('an all-ones image byte pins the byte exactly; an all-zero one pins nothing', () => {
    expect([...candidatesFor(0xff, 0, false)].map((v) => v & 0xff)).toEqual([0xff]);
    expect(candidatesFor(0x00, 0, false)).toHaveLength(256);
  });

  it('orders candidates by likelihood: fewest decayed bits first', () => {
    const list = [...candidatesFor(0x0f, 0, false)].map((v) => v & 0xff);
    const extraOnes = list.map((c) => [...Array(8)].filter((_, b) => ((c & ~0x0f) >> b) & 1).length);
    for (let i = 1; i < extraOnes.length; i++) expect(extraOnes[i]).toBeGreaterThanOrEqual(extraOnes[i - 1]);
    expect(list[0]).toBe(0x0f); // the image byte itself is the most likely candidate
  });

  it('INCLUDES the candidate equal to the image byte itself', () => {
    // Mutation 9 drops it, and it is the single most likely candidate: the
    // case where nothing in that byte decayed at all.
    for (const g of [0x00, 0x3c, 0xa5, 0xff]) {
      expect([...candidatesFor(g, 0, false)].map((v) => v & 0xff)).toContain(g);
    }
  });

  it('with slack, admits candidates that MISS image bits, tagged by how many', () => {
    const list = candidatesFor(0xff, 1, true);
    const byCost = new Map<number, number[]>();
    for (const v of list) {
      const cost = v >> 8;
      if (!byCost.has(cost)) byCost.set(cost, []);
      byCost.get(cost)!.push(v & 0xff);
    }
    expect(byCost.get(0)).toEqual([0xff]);
    expect(byCost.get(1)).toHaveLength(8); // clear any one of the eight bits
  });

  it('without slack, the budget is ignored', () => {
    expect(candidatesFor(0xff, 3, false)).toHaveLength(1);
  });
});

describe('the slice search', () => {
  it('finds the true key bytes for every slice of an undamaged image', () => {
    const search = SLICES.map((s) => sliceOf(FIXTURE_SCHEDULE, s.p));
    for (const s of search) {
      expect(s.chains.length).toBeGreaterThan(0);
      const slice = SLICES[s.p];
      const truth = slice.keyBytes.map((i) => FIXTURE_SCHEDULE[i]);
      expect(s.chains.some((c) => toHex(c.keyBytes) === toHex(Uint8Array.from(truth)))).toBe(true);
    }
  });

  it('keeps the true key bytes for both fixed images', () => {
    for (const image of [FIXED_IMAGE_LIGHT, FIXED_IMAGE_HEAVY]) {
      for (const slice of SLICES) {
        const search = sliceOf(image, slice.p);
        const truth = toHex(Uint8Array.from(slice.keyBytes.map((i) => FIXTURE_SCHEDULE[i])));
        expect(search.chains.some((c) => toHex(c.keyBytes) === truth)).toBe(true);
      }
    }
  });

  it('every surviving chain really satisfies the slice relations', () => {
    const search = sliceOf(FIXED_IMAGE_HEAVY, 0);
    for (const chain of search.chains.slice(0, 200)) {
      const [ka, kb, kc, kd] = chain.keyBytes;
      const a1 = (ka ^ SBOX[kd] ^ RCON[0]) & 0xff;
      const b1 = (kb ^ a1) & 0xff;
      const c1 = (kc ^ b1) & 0xff;
      expect(chain.cChain[1]).toBe(c1);
      // every derived byte contains every 1 bit of its image byte
      expect(a1 & FIXED_IMAGE_HEAVY[aAt(0, 1)]).toBe(FIXED_IMAGE_HEAVY[aAt(0, 1)]);
      expect(b1 & FIXED_IMAGE_HEAVY[bAt(0, 1)]).toBe(FIXED_IMAGE_HEAVY[bAt(0, 1)]);
      expect(c1 & FIXED_IMAGE_HEAVY[cAt(0, 1)]).toBe(FIXED_IMAGE_HEAVY[cAt(0, 1)]);
      // the assumed neighbour d-chain is consistent with the image too
      for (let r = 0; r <= 9; r++) {
        const g = FIXED_IMAGE_HEAVY[dAt(1, r)];
        expect(chain.dChain[r] & g).toBe(g);
      }
      expect(chain.wrongWay).toBe(0);
    }
  });

  it('narrows round key by round key -- about 512 after round key 1, far fewer after 2', () => {
    // The measured shape the whole attack depends on. Loose bounds, because
    // the counts are image-dependent; the ORDER is the invariant.
    const search = sliceOf(FIXED_IMAGE_LIGHT, 0);
    expect(search.stages.afterRound2).toBeLessThan(search.stages.afterRound1);
    expect(search.stages.afterRound3).toBeLessThanOrEqual(search.stages.afterRound2);
    expect(search.stages.final).toBeLessThanOrEqual(search.stages.afterRound3);
    expect(search.stages.afterRound1).toBeGreaterThan(search.stages.final * 4);
  });

  it('carrying the chain past round key 1 is what shrinks the search', () => {
    // Round key 1 alone leaves hundreds of candidates per slice at 30%; after
    // all ten it is a handful. If this ratio ever collapses to 1, the chained
    // test has stopped doing anything.
    let round1 = 0;
    let final = 0;
    for (const slice of SLICES) {
      const search = sliceOf(FIXED_IMAGE_HEAVY, slice.p);
      round1 += search.stages.afterRound1;
      final += search.stages.final;
    }
    expect(round1).toBeGreaterThan(final * 50);
  });

  it('refuses an image that is not 176 bytes, and a position outside 0..3', () => {
    expect(() => sliceOf(new Uint8Array(100), 0)).toThrow(RangeError);
    expect(() => sliceOf(FIXTURE_SCHEDULE, 4)).toThrow(RangeError);
    expect(() => sliceOf(FIXTURE_SCHEDULE, -1)).toThrow(RangeError);
    expect(() => sliceOf(FIXTURE_SCHEDULE, 1.5)).toThrow(RangeError);
  });

  it('truncates rather than exhausting memory, and says it did', () => {
    const search = sliceOf(FIXED_IMAGE_HEAVY, 0, 4);
    expect(search.chains.length).toBeLessThanOrEqual(4);
    expect(search.truncated).toBe(true);
    expect(sliceOf(FIXED_IMAGE_HEAVY, 0).truncated).toBe(false);
  });

  it('counts the nodes it visited', () => {
    const search = sliceOf(FIXED_IMAGE_LIGHT, 2);
    expect(search.nodes).toBeGreaterThan(0);
  });
});

describe('the stitch', () => {
  const lists = SLICES.map((s) => sliceOf(FIXED_IMAGE_LIGHT, s.p).chains);

  it('assembles 16 key bytes, each written exactly once', () => {
    const picks = SLICES.map((s) => {
      const truth = toHex(Uint8Array.from(s.keyBytes.map((i) => FIXTURE_SCHEDULE[i])));
      const found = lists[s.p].find((c) => toHex(c.keyBytes) === truth);
      expect(found).toBeDefined();
      return found!;
    });
    expect(toHex(assembleKey(picks))).toBe(toHex(FIXTURE_KEY));
  });

  it('recovers the key from the four candidate lists', () => {
    const result = stitch(lists, FIXED_IMAGE_LIGHT, 0);
    expect(result.keys).toHaveLength(1);
    expect(toHex(result.keys[0])).toBe(toHex(FIXTURE_KEY));
    expect(result.combinationsChecked).toBeGreaterThan(0);
    expect(result.wrongWayBitsUsed).toBe(0);
  });

  it('rejects a neighbour whose d-chain disagrees', () => {
    const owner = lists[0][0];
    const bogus = { ...lists[1][0], cChain: Uint8Array.from(lists[1][0].cChain) };
    bogus.cChain[1] ^= 0xff;
    expect(neighbourAgrees(owner, bogus)).toBe(false);
  });

  it('finds nothing when a list is empty', () => {
    const result = stitch([lists[0], [], lists[2], lists[3]], FIXED_IMAGE_LIGHT, 0);
    expect(result.keys).toHaveLength(0);
    expect(result.combinationsChecked).toBe(0);
  });

  it('refuses the wrong number of lists or a bad image', () => {
    expect(() => stitch([lists[0]], FIXED_IMAGE_LIGHT, 0)).toThrow(RangeError);
    expect(() => stitch(lists, new Uint8Array(10), 0)).toThrow(RangeError);
    expect(() => assembleKey([lists[0][0]])).toThrow(RangeError);
  });

  it('the full-schedule check compares all 176 bytes, not just the key', () => {
    // Mutation 6 compares only the 16 key bytes. A key that is a superset of
    // the image on every KEY byte can still be flatly impossible once its
    // whole expansion is laid against the image -- which is the only reason
    // the certificate means anything.
    const nearly = Uint8Array.from(FIXTURE_KEY);
    nearly[0] = 0xff; // still a superset of the image's first key byte
    const schedule = expandKey(nearly);
    const keyOnly = wrongWayBits(schedule.subarray(0, KEY_BYTES), FIXED_IMAGE_LIGHT.subarray(0, KEY_BYTES));
    const whole = scheduleWrongWayBits(schedule, FIXED_IMAGE_LIGHT, 1e6);
    expect(keyOnly).toBe(0);
    expect(whole).toBeGreaterThan(0);
  });

  it('the full-schedule check refuses anything that is not a whole schedule', () => {
    expect(() => scheduleWrongWayBits(new Uint8Array(16), FIXED_IMAGE_LIGHT, 0)).toThrow(RangeError);
    expect(() => scheduleWrongWayBits(FIXTURE_SCHEDULE, new Uint8Array(16), 0)).toThrow(RangeError);
  });

  it('the full-schedule check stops counting once past the cap', () => {
    const noise = new Uint8Array(176);
    crypto.getRandomValues(noise);
    expect(scheduleWrongWayBits(new Uint8Array(176), noise, 2)).toBeGreaterThan(2);
  });

  it('a random image produces no certified key', () => {
    const noise = new Uint8Array(176);
    crypto.getRandomValues(noise);
    const noiseLists = SLICES.map((s) => sliceOf(noise, s.p).chains);
    expect(stitch(noiseLists, noise, 0).keys).toHaveLength(0);
  });
});

describe('many random keys through the slice search and stitch', () => {
  it('recovers 25 random keys at 20% decay through the two modules directly', () => {
    for (let n = 0; n < 25; n++) {
      const key = new Uint8Array(KEY_BYTES);
      crypto.getRandomValues(key);
      const image = decaySchedule(expandKey(key), { d0: 0.2, d1: 0 }, seededRandom(n + 7));
      const lists = SLICES.map((s) => sliceOf(image, s.p).chains);
      const result = stitch(lists, image, 0);
      expect(result.keys.length).toBeGreaterThan(0);
      expect(toHex(result.keys[0])).toBe(toHex(key));
    }
  });
});
