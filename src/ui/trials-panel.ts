/**
 * EXHIBIT 6 -- many keys.
 *
 * Recovery rate and time distribution over N freshly drawn keys at the chosen
 * decay, beside the figures the brief's author measured. Two columns, one
 * machine each; the point of showing both is that they are different machines
 * and the shape is the same.
 *
 * Every number in the left column is measured in this browser, now. Nothing
 * here is a stored result.
 */

import type { TrialsSummary, WorkerReply } from '../cold/trials';
import { control, count, el, fill, ms, pct, scrollRegion } from './dom';
import type { SearchWorker } from './search-worker';
import type { LabState, Store } from './state';

/**
 * What two helpers measured for the brief on 15 November 2026, in Node, on
 * their own machines. Printed beside this browser's own figures and never
 * presented as this lab's result.
 */
interface Reference {
  readonly label: string;
  readonly d0: number;
  readonly d1: number;
  readonly keys: string;
  readonly time: string;
}

export const BRIEF_REFERENCE: readonly Reference[] = [
  { label: 'd0 = 0.15, d1 = 0', d0: 0.15, d1: 0, keys: '1000 / 1000', time: 'mean 0.54 ms, 99th 5.1 ms, max 67 ms' },
  { label: 'd0 = 0.30, d1 = 0', d0: 0.3, d1: 0, keys: '500 / 500', time: 'mean 16 ms, 99th 147 ms, max 2.1 s' },
  {
    label: 'd0 = 0.15, d1 = 0.001',
    d0: 0.15,
    d1: 0.001,
    keys: '200 / 200, budget up to 3',
    time: 'mean 16 ms, max 0.87 s',
  },
  {
    label: 'd0 = 0.30, d1 = 0.001',
    d0: 0.3,
    d1: 0.001,
    keys: '200 / 200, budget up to 3',
    time: 'mean 0.82 s, 99th 12 s, max 63 s',
  },
];

const TRIAL_CHOICES = [20, 50, 100, 200];
const TIME_BUDGET_MS = 30_000;

interface RunState {
  readonly status: 'idle' | 'running' | 'done' | 'stopped';
  readonly summary: TrialsSummary | null;
  readonly done: number;
  readonly trials: number;
  readonly requestId: number;
  readonly model: { d0: number; d1: number } | null;
  readonly maxBudget: number;
  readonly error: string | null;
}

const IDLE: RunState = {
  status: 'idle',
  summary: null,
  done: 0,
  trials: 0,
  requestId: -1,
  model: null,
  maxBudget: 0,
  error: null,
};

function measuredTable(run: RunState): HTMLElement {
  const s = run.summary;
  const rows: HTMLElement[] = [];
  const add = (label: string, value: string): void => {
    rows.push(el('tr', {}, [el('th', { scope: 'row', text: label }), el('td', { class: 'num', text: value })]));
  };

  if (!s || s.trials === 0) {
    add('Keys attempted', '0');
  } else {
    add('Keys attempted', count(s.trials));
    add('Recovered, and equal to the true key', `${count(s.recovered)} (${pct(s.recovered / s.trials, 1)})`);
    add('Certified but NOT the true key', count(s.wrongKeys));
    add('No consistent key found', count(s.noConsistentKey));
    add('Stopped by the time budget', count(s.budgetExhausted));
    add(
      `Images within the wrong-way budget of ${run.maxBudget}`,
      `${count(s.withinBudget)} of ${count(s.trials)}`,
    );
    add('Of those, recovered', `${count(s.recoveredWithinBudget)} of ${count(s.withinBudget)}`);
    add('Mean time', ms(s.meanMs));
    add('Median time', ms(s.medianMs));
    add('99th percentile', ms(s.p99Ms));
    add('Slowest', ms(s.maxMs));
    add('Median survivors per slice after RK1', count(s.medianAfterRound1));
    add('Median survivors per slice after RK2', count(s.medianAfterRound2));
    add('Median survivors per slice after all ten', count(s.medianFinal));
  }

  const table = el('table', { class: 'data', 'data-claim': 'trials-measured' }, [
    el('caption', {
      text: run.model
        ? `Measured in this browser, now: d0 = ${run.model.d0}, d1 = ${run.model.d1}, wrong-way budget up to ${run.maxBudget}.`
        : 'Measured in this browser, once you run it.',
    }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'This run' }),
        el('th', { scope: 'col', class: 'num', text: 'Value' }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
  return scrollRegion('What this browser measured over the keys it just tried', table);
}

function referenceTable(state: LabState): HTMLElement {
  const rows = BRIEF_REFERENCE.map((row) => {
    const current = row.d0 === state.model.d0 && row.d1 === state.model.d1;
    return el('tr', {}, [
      el('th', { scope: 'row', text: row.label + (current ? '  ← the model set here' : '') }),
      el('td', { class: 'num', text: row.keys }),
      el('td', { text: row.time }),
    ]);
  });
  const table = el('table', { class: 'data' }, [
    el('caption', {
      text:
        'For comparison: what two helpers measured in Node on their own machines on 15 November ' +
        '2026, each recovered key checked against the true key, with no wrong key ever accepted. ' +
        'Different machines and a different runtime, so read the shape rather than the milliseconds.',
    }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Decay' }),
        el('th', { scope: 'col', class: 'num', text: 'Keys recovered' }),
        el('th', { scope: 'col', text: 'Time per key' }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
  return scrollRegion('Reference measurements from the brief', table);
}

export function renderTrialsPanel(target: HTMLElement, store: Store, worker: SearchWorker): void {
  let run: RunState = IDLE;
  let chosenTrials = 50;

  const render = (state: LabState): void => {
    const picker = el('select', {}) as HTMLSelectElement;
    for (const n of TRIAL_CHOICES) {
      const option = el('option', { value: String(n), text: `${n} keys` }) as HTMLOptionElement;
      if (n === chosenTrials) option.selected = true;
      picker.append(option);
    }
    picker.addEventListener('change', () => {
      chosenTrials = Number(picker.value);
      render(state);
    });

    const start = el('button', {
      type: 'button',
      class: 'action',
      text: 'Measure',
      disabled: run.status === 'running',
    }) as HTMLButtonElement;
    start.addEventListener('click', () => {
      const maxBudget = state.model.d1 > 0 ? 3 : 0;
      const id = worker.send({
        kind: 'trials',
        trials: chosenTrials,
        model: state.model,
        timeBudgetMs: TIME_BUDGET_MS,
        maxWrongWayBudget: maxBudget,
      });
      run = {
        status: 'running',
        summary: null,
        done: 0,
        trials: chosenTrials,
        requestId: id,
        model: { ...state.model },
        maxBudget,
        error: null,
      };
      render(state);
    });

    const stop = el('button', {
      type: 'button',
      class: 'action secondary',
      text: 'Stop',
      disabled: run.status !== 'running',
    }) as HTMLButtonElement;
    stop.addEventListener('click', () => {
      worker.cancel();
      run = { ...run, status: 'stopped' };
      render(state);
    });

    const progress = run.trials
      ? Math.min(100, Math.round((run.done / run.trials) * 100))
      : 0;

    fill(target, [
      el('h2', { text: 'Many keys' }),
      el('div', { class: 'card intro' }, [
        el('p', {
          text:
            'One recovery proves the method runs. A few hundred show whether it is reliable, and ' +
            'how badly the slow cases misbehave. Each key below is freshly drawn, expanded, decayed ' +
            'and handed to the search as an image and a model and nothing else.',
        }),
        el('p', {
          text:
            'Watch the "certified but not the true key" row especially. It is the row that would ' +
            'say the certificate is worthless, and across every run measured for this lab it has ' +
            'stayed at zero.',
        }),
      ]),
      el('div', { class: 'controls' }, [
        control('trials-count', 'Keys to try', picker, `At d0 ${(state.model.d0 * 100).toFixed(0)}% and d1 ${state.model.d1}.`),
        el('div', { class: 'control' }, [
          el('label', { for: 'trials-run', text: 'Run the measurement' }),
          el('div', { class: 'slider-row' }, [
            ((): HTMLElement => {
              start.id = 'trials-run';
              return start;
            })(),
            stop,
          ]),
          el('span', {
            class: 'control-hint',
            text: 'Runs in a worker. Change the decay in exhibit 2.',
          }),
        ]),
      ]),

      run.status === 'running' || run.status === 'done' || run.status === 'stopped'
        ? el('div', { class: 'card', role: 'status', 'aria-live': 'polite' }, [
            el('p', {
              text:
                run.status === 'running'
                  ? `Measuring: ${run.done} of ${run.trials} keys done.`
                  : run.status === 'stopped'
                    ? `Stopped after ${run.summary?.trials ?? run.done} keys. The figures below cover only those.`
                    : `Done: ${run.summary?.trials ?? run.done} keys.`,
            }),
            el('div', { class: 'progress-bar' }, [
              ((): HTMLElement => {
                const fillBar = el('div', { class: 'progress-fill' });
                fillBar.style.width = `${progress}%`;
                return fillBar;
              })(),
            ]),
            run.error ? el('p', { text: run.error }) : null,
          ])
        : null,

      measuredTable(run),
      referenceTable(state),

      el('div', { class: 'notice notice-scope' }, [
        el('p', {}, [
          el('strong', { text: 'What these times are. ' }),
          document.createTextNode(
            'Milliseconds measured in this browser, on this machine, under whatever else it is ' +
              'doing. They are not claimed as typical of any machine, and the slowest case is the ' +
              'number worth looking at rather than the mean: the distribution has a long tail, ' +
              'because an unlucky image leaves far more candidates than a median one. The paper’s ' +
              'own figures are for its implementation in its mixed-ground-state setting and are not ' +
              'directly comparable to either column.',
          ),
        ]),
      ]),
    ]);
  };

  worker.on((reply: WorkerReply) => {
    if (reply.kind === 'error' && reply.id === run.requestId) {
      run = { ...run, status: 'done', error: reply.message };
      render(store.get());
      return;
    }
    if (reply.kind === 'trials-progress' && reply.id === run.requestId) {
      run = { ...run, done: reply.done, summary: reply.summary };
      render(store.get());
      return;
    }
    if (reply.kind === 'trials-done' && reply.id === run.requestId) {
      run = { ...run, status: run.status === 'stopped' ? 'stopped' : 'done', summary: reply.summary, done: reply.summary.trials };
      render(store.get());
    }
  });

  render(store.get());
  store.subscribe((state, changed) => {
    if (changed.has('generation')) {
      // A rate measured at one decay says nothing about another.
      if (run.status === 'running') worker.cancel();
      run = IDLE;
    }
    if (changed.has('generation') || changed.has('model')) render(state);
  });
}
