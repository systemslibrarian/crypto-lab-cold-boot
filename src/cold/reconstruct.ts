/**
 * The reconstruction, end to end.
 *
 * INVARIANT (brief 2): this function receives the 176-byte image and the error
 * model, and nothing else. No key, no stored schedule, no decay draw, no
 * plaintext, no ciphertext. The signature is the enforcement, and a test calls
 * it with nothing else in scope.
 *
 * INVARIANT (brief 3): "recovered" means the returned key, re-expanded, is
 * consistent with all 176 image bytes under the model. That is a certificate
 * the attacker can check alone. Whether the key also EQUALS the one the page
 * is holding is a separate question, reported separately, because a learner
 * should see that the first needs no secret.
 *
 * INVARIANT (brief 5): the search is interruptible and has a time budget.
 * Hitting it is reported as "not recovered within the budget" -- a statement
 * about this run, never about the method.
 */

import { KEY_BYTES, SCHEDULE_BYTES } from './aes-schedule';
import { assertModel } from './decay';
import { HARD_TEST, searchSlice, type SliceChain } from './slice';
import { stitch } from './stitch';
import type { ErrorModel, LadderRung, ReconstructResult, StageCounts } from './types';

export interface ReconstructLimits {
  /** Milliseconds the whole search may take before it gives up. */
  readonly timeBudgetMs: number;
  /** Highest wrong-way budget the ladder will climb to. */
  readonly maxWrongWayBudget: number;
  /** Candidate chains kept per slice before the search truncates. */
  readonly sliceLimit: number;
  /** Called between rungs and slices; return true to abort. */
  readonly cancelled?: () => boolean;
  /** Milliseconds now. Injected so tests can drive the time budget. */
  readonly now?: () => number;
}

export const DEFAULT_LIMITS: ReconstructLimits = {
  timeBudgetMs: 30_000,
  maxWrongWayBudget: 3,
  sliceLimit: 1 << 16,
};

const EMPTY_STAGES: StageCounts = { afterRound1: 0, afterRound2: 0, afterRound3: 0, final: 0 };

/**
 * One rung of the escalation ladder.
 *
 * Three dials, not one, and separating them is what keeps the wrong-way search
 * affordable.
 *
 * `sliceBudget` is how many wrong-way bits ONE slice's search may spend inside
 * its own view. `totalBudget` is how many the finished key's whole expansion
 * may need across all 176 bytes. These are not the same number, and treating
 * them as one is expensive: a slice sees about 52 of the 176 bytes, so two
 * wrong-way flips in an image usually land in two different slices' views and
 * each slice only needs a budget of one. Running every slice at a budget of
 * two to find them costs roughly thirty times as much per step, measured here,
 * and buys nothing.
 *
 * `slackFromRound` is the lowest round key in which a slice may spend a
 * wrong-way bit; 11 means nowhere, which is the hard test. It exists for cost
 * and not for correctness: slack in round key 1 loosens a test applied to
 * about 512 surviving candidates per slice, while the same slack in round key
 * 5 loosens a test applied to about one.
 *
 * The ladder is ordered cheapest-first and ENDS at the widest rung -- slack
 * anywhere, both budgets at the maximum -- so the ordering can only save time.
 * It cannot change which keys are findable.
 */
export interface LadderStep {
  readonly sliceBudget: number;
  readonly slackFromRound: number;
  readonly totalBudget: number;
}

export function ladderFor(model: ErrorModel, maxBudget: number): LadderStep[] {
  const hard: LadderStep = { sliceBudget: 0, slackFromRound: HARD_TEST.slackFromRound, totalBudget: 0 };
  if (model.d1 <= 0 || maxBudget <= 0) return [hard];

  const steps: LadderStep[] = [hard];
  for (let sliceBudget = 1; sliceBudget <= maxBudget; sliceBudget++) {
    // Slack in the later round keys first: 128 of the 176 image bytes live in
    // round key 3 and beyond, and slack there is nearly free.
    for (const slackFromRound of [3, 0]) {
      for (let totalBudget = sliceBudget; totalBudget <= maxBudget; totalBudget++) {
        steps.push({ sliceBudget, slackFromRound, totalBudget });
      }
    }
  }
  return steps;
}

/**
 * Recover an AES-128 key from a decayed image of its key schedule.
 *
 * @param image 176 bytes read back from memory after power loss.
 * @param model the decay channel the image is assumed to have come through.
 */
export function reconstruct(
  image: Uint8Array,
  model: ErrorModel,
  limits: ReconstructLimits = DEFAULT_LIMITS,
): ReconstructResult {
  const now = limits.now ?? (() => performance.now());
  const started = now();

  const refuse = (reason: string): ReconstructResult => ({
    outcome: 'refused',
    key: null,
    certified: false,
    wrongWayBitsUsed: 0,
    stages: [EMPTY_STAGES, EMPTY_STAGES, EMPTY_STAGES, EMPTY_STAGES],
    combinationsChecked: 0,
    nodes: 0,
    ms: now() - started,
    ladder: [],
    refusal: reason,
  });

  if (!(image instanceof Uint8Array)) return refuse('The image must be a byte array.');
  if (image.length !== SCHEDULE_BYTES) {
    return refuse(
      `An AES-128 key schedule is ${SCHEDULE_BYTES} bytes; this image is ${image.length}. ` +
        'Refused: there is nothing to reconstruct against.',
    );
  }
  try {
    assertModel(model);
  } catch (err) {
    return refuse(err instanceof Error ? err.message : 'The error model is not a pair of probabilities.');
  }

  const steps = ladderFor(model, Math.max(0, Math.trunc(limits.maxWrongWayBudget)));
  const ladder: LadderRung[] = [];
  let stages: StageCounts[] = [EMPTY_STAGES, EMPTY_STAGES, EMPTY_STAGES, EMPTY_STAGES];
  let totalNodes = 0;
  let combinationsChecked = 0;
  let outOfTime = false;

  /**
   * Slice searches are cached per (slice budget, slack position), because
   * several rungs differ only in the TOTAL budget -- those rungs re-stitch the
   * same candidate lists and cost almost nothing. Without this cache the
   * ladder would redo its most expensive step for each total.
   */
  const sliceCache = new Map<string, { lists: SliceChain[][]; stages: StageCounts[]; nodes: number }>();

  const outOfBudget = (): boolean => (limits.cancelled?.() ?? false) || now() - started > limits.timeBudgetMs;

  for (const step of steps) {
    const rungStart = now();
    const cacheKey = `${step.sliceBudget}:${step.slackFromRound}`;
    let searched = sliceCache.get(cacheKey);
    let rungNodes = 0;

    if (!searched) {
      const lists: SliceChain[][] = [];
      const rungStages: StageCounts[] = [];
      let aborted = false;
      for (let p = 0; p < 4; p++) {
        if (outOfBudget()) {
          aborted = true;
          outOfTime = true;
          break;
        }
        const search = searchSlice(
          image,
          p,
          { budget: step.sliceBudget, slackFromRound: step.slackFromRound },
          limits.sliceLimit,
        );
        rungNodes += search.nodes;
        lists.push(search.chains);
        rungStages.push(search.stages);
      }
      totalNodes += rungNodes;
      if (aborted) {
        ladder.push({
          budget: step.totalBudget,
          slackFromRound: step.slackFromRound,
          found: false,
          nodes: rungNodes,
          ms: now() - rungStart,
        });
        break;
      }
      searched = { lists, stages: rungStages, nodes: rungNodes };
      sliceCache.set(cacheKey, searched);
    }

    stages = searched.stages;
    const joined = stitch(searched.lists, image, step.totalBudget);
    rungNodes += joined.nodes;
    totalNodes += joined.nodes;
    combinationsChecked += joined.combinationsChecked;
    ladder.push({
      budget: step.totalBudget,
      slackFromRound: step.slackFromRound,
      found: joined.keys.length > 0,
      nodes: rungNodes,
      ms: now() - rungStart,
    });

    if (joined.keys.length > 0) {
      return {
        outcome: 'recovered',
        key: joined.keys[0],
        certified: true,
        wrongWayBitsUsed: joined.wrongWayBitsUsed,
        stages,
        combinationsChecked,
        nodes: totalNodes,
        ms: now() - started,
        ladder,
        refusal: null,
      };
    }

    if (outOfBudget()) {
      outOfTime = true;
      break;
    }
  }

  return {
    outcome: outOfTime ? 'budget-exhausted' : 'no-consistent-key',
    key: null,
    certified: false,
    wrongWayBitsUsed: 0,
    stages,
    combinationsChecked,
    nodes: totalNodes,
    ms: now() - started,
    ladder,
    refusal: null,
  };
}

/**
 * Did the reconstruction land on the key the page was holding?
 *
 * Deliberately separate from `reconstruct`. The attacker's certificate is the
 * full-schedule check; this comparison is only available to a demo that knows
 * the answer, and keeping the two apart is how a learner can see which of them
 * the attack actually needs.
 */
export function matchesTruth(recovered: Uint8Array | null, truth: Uint8Array): boolean {
  if (!recovered || recovered.length !== KEY_BYTES || truth.length !== KEY_BYTES) return false;
  let diff = 0;
  for (let i = 0; i < KEY_BYTES; i++) diff |= recovered[i] ^ truth[i];
  return diff === 0;
}
