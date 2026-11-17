/**
 * CHECK E -- recovery rates and times, measured.
 *
 * Slow by design: these are the only tests that run the whole attack over
 * hundreds of random keys, and they are the source of every rate and time this
 * lab prints. Keys and decay draws come from `crypto.getRandomValues`, per
 * invariant 4, so each run is a fresh measurement rather than a replay.
 *
 * TIMES ARE REPORTED HERE AND ASSERTED NOWHERE, and that is a measurement
 * rather than a preference. The same code, over the same number of keys, is
 * about NINE TIMES slower inside Vitest than it is standalone: 56 ms mean
 * against 6.1 ms at d0 = 0.15, and a worst case of 4.9 s against 742 ms. The
 * runner's module boundaries are between every call in a hot numeric loop, so
 * what a timing assertion here would be pinning is the runner, not the method.
 * The figures in the README come from `node scripts/run-measure.mjs`, which
 * runs the same modules through the same bundler the browser gets.
 *
 * What IS asserted is what the brief states as an outcome and what no amount
 * of machine noise can change: how many keys come back, and that not one of
 * them is ever the wrong key.
 *
 * TWO deliberate departures from the brief, and the reasons for them.
 *
 *   1. The brief's check E asks for 200 of 200 at d0 = 0.15 "each within 1 s".
 *      The rate is asserted exactly as written; the per-key second is not,
 *      for the reason above -- inside this runner the observed maximum is
 *      already 4.9 s, so the assertion would be measuring Vitest. Standalone,
 *      every one of 1,000 keys came back inside 742 ms.
 *
 *   2. The brief's check E expects 100 of 100 at d0 = 0.15, d1 = 0.001 with a
 *      budget up to 3. That cannot be asserted as a hard gate either, and the
 *      arithmetic says why. A 176-byte image has about 704 zero bits, so the
 *      number of wrong-way flips is Poisson with mean ~0.70, and P(4 or more)
 *      is about 0.6%. Four wrong-way flips cannot be explained within a budget
 *      of 3 -- not by this implementation, but by the full-schedule check
 *      itself, which is the certificate. So 100 of 100 is a coin flip of
 *      roughly 55%, and the brief's own 200 of 200 had about a 30% chance of
 *      coming up. The CLAIM is sound; asserting it as a count is not.
 *
 *      What is asserted instead is the thing that is actually true and that a
 *      flaky count was standing in for: every image WITHIN the budget is
 *      recovered, and no wrong key is ever returned. The raw rate is reported
 *      alongside.
 */

import { describe, expect, it } from 'vitest';
import { KEY_BYTES, expandKey } from './aes-schedule';
import { cryptoRandom, damageBetween, decaySchedule } from './decay';
import { DEFAULT_LIMITS, matchesTruth, reconstruct } from './reconstruct';
import type { ErrorModel } from './types';

interface Measurement {
  readonly recovered: number;
  readonly wrongKeys: number;
  readonly withinBudget: number;
  readonly recoveredWithinBudget: number;
  readonly notRecovered: number;
  readonly times: number[];
}

function measure(model: ErrorModel, trials: number, maxBudget: number): Measurement {
  const random = cryptoRandom();
  const times: number[] = [];
  let recovered = 0;
  let wrongKeys = 0;
  let withinBudget = 0;
  let recoveredWithinBudget = 0;
  let notRecovered = 0;

  for (let n = 0; n < trials; n++) {
    const key = new Uint8Array(KEY_BYTES);
    crypto.getRandomValues(key);
    const schedule = expandKey(key);
    const image = decaySchedule(schedule, model, random);
    // Known only to the harness: how much wrong-way damage this image carries.
    // The reconstruction is never told.
    const inBudget = damageBetween(schedule, image).wrongWayBits <= maxBudget;
    if (inBudget) withinBudget++;

    const result = reconstruct(image, model, {
      ...DEFAULT_LIMITS,
      maxWrongWayBudget: maxBudget,
      timeBudgetMs: 120_000,
    });
    times.push(result.ms);

    if (result.outcome === 'recovered') {
      if (matchesTruth(result.key, key)) {
        recovered++;
        if (inBudget) recoveredWithinBudget++;
      } else {
        wrongKeys++;
      }
    } else {
      notRecovered++;
    }
  }
  return { recovered, wrongKeys, withinBudget, recoveredWithinBudget, notRecovered, times };
}

function report(label: string, trials: number, m: Measurement): void {
  const sorted = [...m.times].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  // eslint-disable-next-line no-console
  console.log(
    `  ${label}: ${m.recovered}/${trials} recovered, ${m.wrongKeys} wrong keys | ` +
      `mean ${mean.toFixed(2)}ms, median ${at(0.5).toFixed(2)}ms, ` +
      `99th ${at(0.99).toFixed(0)}ms, max ${sorted[sorted.length - 1].toFixed(0)}ms`,
  );
}

// Minutes, not seconds: these are the only tests that run the attack hundreds
// of times, and the per-test default would stop them mid-measurement. Vitest 4
// measures elapsed time and fails afterwards rather than racing a timer, so a
// budget here is a real backstop against a hang and not a performance claim.
const SLOW = { timeout: 900_000 };

describe('check E: recovery rates, one-way decay (d1 = 0)', () => {
  it('recovers 200 of 200 random keys at 15% decay', SLOW, () => {
    const trials = 200;
    const m = measure({ d0: 0.15, d1: 0 }, trials, 0);
    report('d0=0.15 d1=0', trials, m);
    expect(m.wrongKeys).toBe(0);
    expect(m.recovered).toBe(trials);
  });

  it('recovers 200 of 200 random keys at 30% decay', SLOW, () => {
    const trials = 200;
    const m = measure({ d0: 0.3, d1: 0 }, trials, 0);
    report('d0=0.30 d1=0', trials, m);
    expect(m.wrongKeys).toBe(0);
    expect(m.recovered).toBe(trials);
  });
});

describe('check E: recovery rates with wrong-way flips (d1 = 0.001)', () => {
  it('recovers every image within a budget of 3 at 15% decay, and no wrong key', SLOW, () => {
    const trials = 100;
    const maxBudget = 3;
    const m = measure({ d0: 0.15, d1: 0.001 }, trials, maxBudget);
    report('d0=0.15 d1=0.001 budget<=3', trials, m);
    // eslint-disable-next-line no-console
    console.log(
      `    of which ${m.withinBudget}/${trials} carried at most ${maxBudget} wrong-way flips; ` +
        `${m.recoveredWithinBudget} of those were recovered`,
    );
    expect(m.wrongKeys).toBe(0);
    // The claim that is actually true: within the budget, nothing is missed.
    expect(m.recoveredWithinBudget).toBe(m.withinBudget);
    // And the budget is nearly always enough: P(4 or more flips) is ~0.6%.
    expect(m.recovered / trials).toBeGreaterThanOrEqual(0.95);
  });

  it('the hard test alone recovers only about half of these images', SLOW, () => {
    // The brief's FACTS 6 observation, and the reason the budget exists: about
    // half the images carry at least one wrong-way flip, and the hard test
    // rejects the true key outright when they do.
    const trials = 120;
    const m = measure({ d0: 0.15, d1: 0.001 }, trials, 0);
    report('d0=0.15 d1=0.001 hard test only', trials, m);
    expect(m.wrongKeys).toBe(0);
    const rate = m.recovered / trials;
    expect(rate).toBeGreaterThan(0.3);
    expect(rate).toBeLessThan(0.7);
    // Every image it DID recover was one with no wrong-way flip at all.
    expect(m.recovered).toBe(m.recoveredWithinBudget);
  });

  // d0 = 0.30 WITH wrong-way flips is deliberately NOT gated here. The brief
  // reports it in FACTS 6 but check E does not ask for it, and it is the one
  // configuration whose tail runs to tens of seconds per key -- gating it
  // would add minutes to every CI run to re-measure something no acceptance
  // check depends on. It is measured by `node scripts/run-measure.mjs`, which
  // is where the figures in the README's Performance table come from.
});

describe('check E: no wrong key is ever returned', () => {
  it('certifies nothing against 120 images that are not decayed schedules', SLOW, () => {
    // The other half of "no wrong key": feed it noise and it must say so.
    let certified = 0;
    for (let n = 0; n < 120; n++) {
      const image = new Uint8Array(176);
      crypto.getRandomValues(image);
      const result = reconstruct(image, { d0: 0.15, d1: 0 }, {
        ...DEFAULT_LIMITS,
        maxWrongWayBudget: 0,
        timeBudgetMs: 120_000,
      });
      if (result.outcome === 'recovered') certified++;
    }
    expect(certified).toBe(0);
  });
});
