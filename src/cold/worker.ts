/// <reference lib="webworker" />
/**
 * The search worker.
 *
 * Holds no secrets and keeps nothing between messages. Exhibit 5 sends it an
 * image; exhibit 6 asks it to draw its own keys and measure a rate. A `cancel`
 * message makes the next check inside the search return, so a long run can be
 * stopped from the page.
 */

import { reconstruct } from './reconstruct';
import { runTrials, type WorkerReply, type WorkerRequest } from './trials';

let cancelRequested = false;
const cancelled = (): boolean => cancelRequested;

function reply(message: WorkerReply): void {
  self.postMessage(message);
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.kind === 'cancel') {
    cancelRequested = true;
    return;
  }

  cancelRequested = false;

  try {
    if (request.kind === 'recover') {
      const result = reconstruct(request.image, request.model, {
        timeBudgetMs: request.timeBudgetMs,
        maxWrongWayBudget: request.maxWrongWayBudget,
        sliceLimit: 1 << 16,
        cancelled,
      });
      reply({ kind: 'recovered', id: request.id, result });
      return;
    }

    const summary = runTrials(
      request.trials,
      request.model,
      request.timeBudgetMs,
      request.maxWrongWayBudget,
      (done, partial) => reply({ kind: 'trials-progress', id: request.id, done, trials: request.trials, summary: partial }),
      cancelled,
    );
    reply({ kind: 'trials-done', id: request.id, summary });
  } catch (error) {
    reply({
      kind: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
