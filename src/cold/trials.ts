/**
 * The worker protocol, and the trial loop that runs behind it.
 *
 * Recovery at 30% decay can take seconds on an unlucky image, and running that
 * on the main thread would freeze the page mid-search. So both exhibit 5 and
 * exhibit 6 post a request into a worker and stream results back.
 *
 * The worker is cancellable and has a time budget, per invariant 5. Hitting
 * the budget is reported as "not recovered within the budget" and nothing
 * else: it is a fact about one run on one machine, never a claim about the
 * method.
 */

import { KEY_BYTES, expandKey } from './aes-schedule';
import { cryptoRandom, damageBetween, decaySchedule } from './decay';
import { matchesTruth, reconstruct } from './reconstruct';
import type { ErrorModel, Outcome, ReconstructResult } from './types';

/** Recover one key from one image the page is holding. */
export interface RecoverRequest {
  readonly kind: 'recover';
  readonly id: number;
  readonly image: Uint8Array;
  readonly model: ErrorModel;
  readonly timeBudgetMs: number;
  readonly maxWrongWayBudget: number;
}

/** Measure a rate over N freshly drawn keys. */
export interface TrialsRequest {
  readonly kind: 'trials';
  readonly id: number;
  readonly trials: number;
  readonly model: ErrorModel;
  readonly timeBudgetMs: number;
  readonly maxWrongWayBudget: number;
}

export interface CancelRequest {
  readonly kind: 'cancel';
}

export type WorkerRequest = RecoverRequest | TrialsRequest | CancelRequest;

/** A `ReconstructResult` with the typed arrays flattened for postMessage. */
export interface RecoverReply {
  readonly kind: 'recovered';
  readonly id: number;
  readonly result: Omit<ReconstructResult, 'key'> & { readonly key: Uint8Array | null };
}

export interface TrialsProgress {
  readonly kind: 'trials-progress';
  readonly id: number;
  readonly done: number;
  readonly trials: number;
  readonly summary: TrialsSummary;
}

export interface TrialsDone {
  readonly kind: 'trials-done';
  readonly id: number;
  readonly summary: TrialsSummary;
}

export interface WorkerError {
  readonly kind: 'error';
  readonly id: number;
  readonly message: string;
}

export type WorkerReply = RecoverReply | TrialsProgress | TrialsDone | WorkerError;

/** What a run of N trials measured. */
export interface TrialsSummary {
  readonly trials: number;
  /** Recovered AND equal to the key the harness drew. */
  readonly recovered: number;
  /** Certified against the image but NOT equal to the true key. Must stay 0. */
  readonly wrongKeys: number;
  /** Finished the search and found nothing consistent. */
  readonly noConsistentKey: number;
  /** Ran out of time. Not a failure of the method. */
  readonly budgetExhausted: number;
  /** Images whose wrong-way damage was inside the budget on offer. */
  readonly withinBudget: number;
  /** Of those, how many were recovered. This is the number that must be all of them. */
  readonly recoveredWithinBudget: number;
  readonly meanMs: number;
  readonly medianMs: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  /** Median candidates surviving each stage, across all slices of all trials. */
  readonly medianAfterRound1: number;
  readonly medianAfterRound2: number;
  readonly medianFinal: number;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  return sorted[sorted.length >> 1];
}

function summarise(
  trials: number,
  times: number[],
  outcomes: Map<Outcome, number>,
  truthMatches: number,
  wrongKeys: number,
  withinBudget: number,
  recoveredWithinBudget: number,
  stage1: number[],
  stage2: number[],
  stageFinal: number[],
): TrialsSummary {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    trials,
    recovered: truthMatches,
    wrongKeys,
    noConsistentKey: outcomes.get('no-consistent-key') ?? 0,
    budgetExhausted: outcomes.get('budget-exhausted') ?? 0,
    withinBudget,
    recoveredWithinBudget,
    meanMs: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
    medianMs: median(sorted),
    p99Ms: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] : 0,
    maxMs: sorted.length ? sorted[sorted.length - 1] : 0,
    medianAfterRound1: median([...stage1].sort((a, b) => a - b)),
    medianAfterRound2: median([...stage2].sort((a, b) => a - b)),
    medianFinal: median([...stageFinal].sort((a, b) => a - b)),
  };
}

/**
 * Run `trials` independent recoveries, reporting progress through `onProgress`.
 *
 * Each trial draws a fresh key and a fresh decay draw from
 * `crypto.getRandomValues`, expands, decays, and hands the reconstruction the
 * image and the model only. The true key stays in this loop so the harness can
 * tell a recovered key from a merely certified one -- the reconstruction never
 * sees it.
 */
export function runTrials(
  trials: number,
  model: ErrorModel,
  timeBudgetMs: number,
  maxWrongWayBudget: number,
  onProgress: (done: number, summary: TrialsSummary) => void,
  cancelled: () => boolean,
  progressEvery = 10,
): TrialsSummary {
  const random = cryptoRandom();
  const times: number[] = [];
  const outcomes = new Map<Outcome, number>();
  const stage1: number[] = [];
  const stage2: number[] = [];
  const stageFinal: number[] = [];
  let truthMatches = 0;
  let wrongKeys = 0;
  let withinBudget = 0;
  let recoveredWithinBudget = 0;
  let done = 0;

  for (let n = 0; n < trials; n++) {
    if (cancelled()) break;
    const key = new Uint8Array(KEY_BYTES);
    crypto.getRandomValues(key);
    const schedule = expandKey(key);
    const image = decaySchedule(schedule, model, random);
    const inBudget = damageBetween(schedule, image).wrongWayBits <= maxWrongWayBudget;
    if (inBudget) withinBudget++;

    const result = reconstruct(image, model, {
      timeBudgetMs,
      maxWrongWayBudget,
      sliceLimit: 1 << 16,
      cancelled,
    });

    times.push(result.ms);
    outcomes.set(result.outcome, (outcomes.get(result.outcome) ?? 0) + 1);
    for (const stage of result.stages) {
      stage1.push(stage.afterRound1);
      stage2.push(stage.afterRound2);
      stageFinal.push(stage.final);
    }
    if (result.outcome === 'recovered') {
      if (matchesTruth(result.key, key)) {
        truthMatches++;
        if (inBudget) recoveredWithinBudget++;
      } else {
        wrongKeys++;
      }
    }
    done = n + 1;
    if (done % progressEvery === 0) {
      onProgress(
        done,
        summarise(done, times, outcomes, truthMatches, wrongKeys, withinBudget, recoveredWithinBudget, stage1, stage2, stageFinal),
      );
    }
  }

  return summarise(
    done,
    times,
    outcomes,
    truthMatches,
    wrongKeys,
    withinBudget,
    recoveredWithinBudget,
    stage1,
    stage2,
    stageFinal,
  );
}
