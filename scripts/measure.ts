/**
 * Measurement harness: the source of every rate and time this lab reports.
 *
 * Run with `node scripts/measure.ts` (Node strips the types). Keys and decay
 * draws come from crypto.getRandomValues, so each run is a fresh measurement.
 */

import { KEY_BYTES, expandKey } from '../src/cold/aes-schedule';
import { cryptoRandom, damageBetween, decaySchedule } from '../src/cold/decay';
import { DEFAULT_LIMITS, matchesTruth, reconstruct } from '../src/cold/reconstruct';
import type { ErrorModel } from '../src/cold/types';

const CASES: { model: ErrorModel; trials: number; maxBudget: number }[] = [
  { model: { d0: 0.15, d1: 0 }, trials: Number(process.env.N1 ?? 1000), maxBudget: 0 },
  { model: { d0: 0.3, d1: 0 }, trials: Number(process.env.N2 ?? 500), maxBudget: 0 },
  { model: { d0: 0.15, d1: 0.001 }, trials: Number(process.env.N3 ?? 200), maxBudget: 3 },
  { model: { d0: 0.3, d1: 0.001 }, trials: Number(process.env.N4 ?? 60), maxBudget: 3 },
];

const quantile = (sorted: number[], q: number): number =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0;

for (const { model, trials, maxBudget } of CASES) {
  if (trials <= 0) continue;
  const random = cryptoRandom();
  const times: number[] = [];
  const timesWithin: number[] = [];
  const timesOver: number[] = [];
  const stage1: number[] = [];
  const stage2: number[] = [];
  let recovered = 0;
  let wrongKeys = 0;
  let withinBudget = 0;
  let recoveredWithinBudget = 0;
  let notRecovered = 0;

  const started = performance.now();
  for (let n = 0; n < trials; n++) {
    const key = new Uint8Array(KEY_BYTES);
    crypto.getRandomValues(key);
    const schedule = expandKey(key);
    const image = decaySchedule(schedule, model, random);
    const inBudget = damageBetween(schedule, image).wrongWayBits <= maxBudget;
    if (inBudget) withinBudget++;

    const result = reconstruct(image, model, {
      ...DEFAULT_LIMITS,
      maxWrongWayBudget: maxBudget,
      timeBudgetMs: 120_000,
    });
    times.push(result.ms);
    (inBudget ? timesWithin : timesOver).push(result.ms);
    for (const stage of result.stages) {
      stage1.push(stage.afterRound1);
      stage2.push(stage.afterRound2);
    }
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
    if ((n + 1) % 50 === 0) {
      process.stdout.write(
        `    ... ${n + 1}/${trials} (${((performance.now() - started) / 1000).toFixed(0)}s elapsed)\n`,
      );
    }
  }

  for (const list of [times, timesWithin, timesOver, stage1, stage2]) list.sort((a, b) => a - b);
  const mean = (list: number[]): number =>
    list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  const line = (name: string, list: number[]): string =>
    list.length
      ? `  ${name}: mean ${mean(list).toFixed(2)} ms | median ${quantile(list, 0.5).toFixed(2)} ms | ` +
        `99th ${quantile(list, 0.99).toFixed(0)} ms | max ${list[list.length - 1].toFixed(0)} ms\n`
      : `  ${name}: none\n`;
  process.stdout.write(
    `d0 = ${model.d0}, d1 = ${model.d1}, budget <= ${maxBudget}, N = ${trials}\n` +
      `  recovered ${recovered}/${trials}; wrong keys ${wrongKeys}; not recovered ${notRecovered}\n` +
      `  within budget ${withinBudget}/${trials}, of which recovered ${recoveredWithinBudget}\n` +
      line('all images     ', times) +
      line('within budget  ', timesWithin) +
      line('over budget    ', timesOver) +
      `  median survivors per slice: ${quantile(stage1, 0.5)} after RK1, ${quantile(stage2, 0.5)} after RK2\n\n`,
  );
}
