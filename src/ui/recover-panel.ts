/**
 * EXHIBIT 5 -- full recovery.
 *
 * The reconstruction runs in a worker, and this panel reports what it found:
 * survivors per stage, the recovered key, the full-schedule check, and the
 * measured time.
 *
 * Two things this panel is careful about.
 *
 * The verdict colour tracks SYSTEM INTEGRITY, not the return value. A key
 * recovered out of a damaged image is the alarm state, even though the search
 * "succeeded"; "no consistent key exists" is the reassuring one.
 *
 * The certificate and the truth are reported as two separate lines. The first
 * -- this key's own expansion explains all 176 image bytes -- is available to
 * an attacker with nothing but the image. The second -- it is the key this
 * page was holding -- is available only to a demo. A learner should be able to
 * see which of the two the attack actually needs.
 */

import { KEY_BYTES, countOnes, toHex } from '../cold/aes-schedule';
import { asPowerOfTwo, supersetCandidates, zeroBits } from '../cold/naive';
import { matchesTruth } from '../cold/reconstruct';
import type { RecoverReply, WorkerReply } from '../cold/trials';
import type { ReconstructResult } from '../cold/types';
import { checkLine, count, el, fill, ms, readout, scrollRegion, statStrip } from './dom';
import type { SearchWorker } from './search-worker';
import { hasTruth, sourceLabel, type LabState, type Store } from './state';

/** The negative claim, scoped to the image on the page. */
export const NEGATIVE_CLAIM =
  'This image has lost bits in the key itself, and a direct search for them is out of reach. ' +
  'That says nothing about whether the key is safe: the rest of the schedule pinned it down, ' +
  'with no plaintext or ciphertext.';

const TIME_BUDGET_MS = 30_000;

interface RunState {
  /**
   * `retired` is its own status and not a flavour of `idle`, because the two
   * have to SAY different things. A page that blanks a stale verdict has told
   * the reader nothing; one that says it withdrew it has.
   */
  readonly status: 'idle' | 'running' | 'done' | 'cancelled' | 'retired';
  readonly result: ReconstructResult | null;
  readonly generation: number;
  readonly requestId: number;
  /** The key the page held when the run started, for the truth line. */
  readonly truth: Uint8Array | null;
  readonly error: string | null;
}

const IDLE: RunState = {
  status: 'idle',
  result: null,
  generation: -1,
  requestId: -1,
  truth: null,
  error: null,
};

function stageTable(result: ReconstructResult): HTMLElement {
  const rows = result.stages.map((stage, p) =>
    el('tr', {}, [
      el('th', { scope: 'row', text: `Slice ${p}` }),
      el('td', { class: 'num', text: count(stage.afterRound1) }),
      el('td', { class: 'num', text: count(stage.afterRound2) }),
      el('td', { class: 'num', text: count(stage.afterRound3) }),
      el('td', { class: 'num', text: count(stage.final) }),
    ]),
  );
  const table = el('table', { class: 'data', 'data-claim': 'stage-table' }, [
    el('caption', {
      text:
        'Candidates surviving per slice as each round key is brought to bear. The counts fall ' +
        'because every extra round key costs one guessed byte and buys four tests.',
    }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: '' }),
        el('th', { scope: 'col', class: 'num', text: 'After RK1' }),
        el('th', { scope: 'col', class: 'num', text: 'After RK2' }),
        el('th', { scope: 'col', class: 'num', text: 'After RK3' }),
        el('th', { scope: 'col', class: 'num', text: 'All ten' }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
  return scrollRegion('Candidates surviving each stage of the search, by slice', table);
}

function ladderTable(result: ReconstructResult): HTMLElement | null {
  if (result.ladder.length <= 1) return null;
  const rows = result.ladder.map((rung, i) =>
    el('tr', {}, [
      el('th', { scope: 'row', text: `Rung ${i + 1}` }),
      el('td', { class: 'num', text: String(rung.budget) }),
      el('td', {
        text:
          rung.slackFromRound >= 11
            ? 'nowhere — the hard test'
            : rung.slackFromRound === 0
              ? 'anywhere, including the key bytes'
              : `round key ${rung.slackFromRound} and later`,
      }),
      el('td', { class: 'num', text: count(rung.nodes) }),
      el('td', { class: 'num', text: ms(rung.ms) }),
      el('td', { text: rung.found ? 'found a key' : 'nothing consistent' }),
    ]),
  );
  const table = el('table', { class: 'data' }, [
    el('caption', {
      text:
        'The wrong-way budget, raised until a key passed the full-schedule test. Slack is offered ' +
        'first in the later round keys, where the search is already narrow, and last in the key ' +
        'bytes, where it is widest — the ladder ends at "anywhere", so the ordering only saves ' +
        'time and cannot hide a key.',
    }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: '' }),
        el('th', { scope: 'col', class: 'num', text: 'Budget' }),
        el('th', { scope: 'col', text: 'Slack allowed' }),
        el('th', { scope: 'col', class: 'num', text: 'Nodes' }),
        el('th', { scope: 'col', class: 'num', text: 'Time' }),
        el('th', { scope: 'col', text: 'Outcome' }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
  return scrollRegion('The wrong-way budget ladder', table);
}

function verdict(run: RunState, state: LabState): HTMLElement {
  const marker = (kind: string): Record<string, string> => ({
    class: 'verdict',
    'data-verdict': kind,
    role: 'status',
    'aria-live': 'polite',
  });

  // A verdict computed against an earlier generation describes an image that
  // is no longer on the page, so it is withdrawn -- and the withdrawal is
  // stated rather than performed silently.
  const stale = run.status === 'retired' || (run.status === 'done' && run.generation !== state.generation);
  if (stale) {
    return el('div', marker('idle'), [
      el('span', { class: 'verdict-icon', 'aria-hidden': 'true', text: '--' }),
      el('div', { class: 'verdict-body' }, [
        el('p', {
          class: 'verdict-headline',
          text: 'VERDICT RETIRED \u2014 THE KEY, THE DECAY OR THE IMAGE CHANGED',
        }),
        el('p', {
          class: 'verdict-detail',
          text:
            'The previous verdict described a different image, so it has been withdrawn rather ' +
            'than left standing. Run the search again.',
        }),
      ]),
    ]);
  }

  if (run.status === 'idle' || run.generation !== state.generation) {
    return el('div', marker('idle'), [
      el('span', { class: 'verdict-icon', 'aria-hidden': 'true', text: '--' }),
      el('div', { class: 'verdict-body' }, [
        el('p', { class: 'verdict-headline', text: 'NOTHING RUN YET' }),
        el('p', {
          class: 'verdict-detail',
          text: 'Press "Recover the key" to run the reconstruction against the image on this page.',
        }),
      ]),
    ]);
  }

  if (run.status === 'running') {
    return el('div', marker('running'), [
      el('span', { class: 'verdict-icon', 'aria-hidden': 'true', text: '>>' }),
      el('div', { class: 'verdict-body' }, [
        el('p', { class: 'verdict-headline', text: 'SEARCHING' }),
        el('p', {
          class: 'verdict-detail',
          text: `Running in a worker with a ${TIME_BUDGET_MS / 1000}-second budget. The page stays usable.`,
        }),
      ]),
    ]);
  }

  if (run.error) {
    return el('div', marker('refused'), [
      el('span', { class: 'verdict-icon', 'aria-hidden': 'true', text: '!!' }),
      el('div', { class: 'verdict-body' }, [
        el('p', { class: 'verdict-headline', text: 'THE SEARCH COULD NOT RUN' }),
        el('p', { class: 'verdict-detail', text: run.error }),
      ]),
    ]);
  }

  const result = run.result;
  if (!result) {
    return el('div', marker('idle'), [
      el('span', { class: 'verdict-icon', 'aria-hidden': 'true', text: '--' }),
      el('div', { class: 'verdict-body' }, [
        el('p', { class: 'verdict-headline', text: 'NOTHING RUN YET' }),
      ]),
    ]);
  }

  if (result.outcome === 'refused') {
    return el('div', marker('refused'), [
      el('span', { class: 'verdict-icon', 'aria-hidden': 'true', text: '!!' }),
      el('div', { class: 'verdict-body' }, [
        el('p', { class: 'verdict-headline', text: 'REFUSED' }),
        el('p', { class: 'verdict-detail', text: result.refusal ?? 'The input was refused.' }),
      ]),
    ]);
  }

  if (result.outcome === 'budget-exhausted') {
    return el('div', marker('budget-exhausted'), [
      el('span', { class: 'verdict-icon', 'aria-hidden': 'true', text: '~~' }),
      el('div', { class: 'verdict-body' }, [
        el('p', { class: 'verdict-headline', text: 'NOT RECOVERED WITHIN THE BUDGET' }),
        el('p', {
          class: 'verdict-detail',
          text:
            `The search ran for ${ms(result.ms)} and was stopped by its time budget. That is a ` +
            'statement about this run on this machine, not about the method: the search had not ' +
            'finished, so nothing has been ruled out. Lower the decay, or run it again.',
        }),
      ]),
    ]);
  }

  if (result.outcome === 'no-consistent-key') {
    return el('div', marker('no-consistent-key'), [
      el('span', { class: 'verdict-icon', 'aria-hidden': 'true', text: 'OK' }),
      el('div', { class: 'verdict-body' }, [
        el('p', { class: 'verdict-headline', text: 'NO CONSISTENT KEY EXISTS UNDER THE MODEL' }),
        el('p', {
          class: 'verdict-detail',
          text:
            'The search finished and found no AES-128 key whose expansion could have decayed into ' +
            `this image. It visited ${count(result.nodes)} nodes in ${ms(result.ms)} and returned ` +
            'nothing — which is the right answer when the bytes are not a decayed key schedule at ' +
            'all. Nothing is being reported as recovered.',
        }),
      ]),
    ]);
  }

  // Recovered. The alarm state.
  const lostKeyBits = hasTruth(state) ? state.damage.lostKeyBits : null;
  const headline =
    lostKeyBits === null
      ? 'KEY RECOVERED FROM THE IMAGE ALONE'
      : `${lostKeyBits} KEY BITS LOST — AND THE KEY WAS RECOVERED FROM THE IMAGE ALONE`;

  return el('div', marker('recovered'), [
    el('span', { class: 'verdict-icon', 'aria-hidden': 'true', text: '!!' }),
    el('div', { class: 'verdict-body' }, [
      el('p', { class: 'verdict-headline', 'data-claim': 'recovered-headline', text: headline }),
      el('p', {
        class: 'verdict-detail',
        text:
          `Found in ${ms(result.ms)} after ${count(result.nodes)} search nodes and ` +
          `${count(result.combinationsChecked)} full expansions. ` +
          'The damage to the key bytes was never repaired by guessing them — it was repaired by ' +
          'the 160 bytes that depend on them.',
      }),
      el('p', { class: 'negative-claim', 'data-claim': 'negative-claim', text: NEGATIVE_CLAIM }),
    ]),
  ]);
}

export function renderRecoverPanel(target: HTMLElement, store: Store, worker: SearchWorker): void {
  let run: RunState = IDLE;

  const render = (state: LabState): void => {
    const result = run.generation === state.generation ? run.result : null;
    const keyBytes = state.image.subarray(0, 16);

    const start = el('button', {
      type: 'button',
      class: 'action',
      text: 'Recover the key',
      disabled: run.status === 'running',
    }) as HTMLButtonElement;
    start.addEventListener('click', () => {
      const id = worker.send({
        kind: 'recover',
        image: state.image,
        model: state.model,
        timeBudgetMs: TIME_BUDGET_MS,
        maxWrongWayBudget: state.model.d1 > 0 ? 3 : 0,
      });
      run = {
        status: 'running',
        result: null,
        generation: state.generation,
        requestId: id,
        truth: hasTruth(state) ? Uint8Array.from(state.key) : null,
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
      worker.terminate();
      run = { ...run, status: 'cancelled', result: null, error: 'The search was stopped from the page.' };
      render(state);
    });

    const recovered = result?.outcome === 'recovered' ? result.key : null;

    fill(target, [
      el('h2', { text: 'Full recovery' }),
      el('div', { class: 'card intro' }, [
        el('p', {
          text:
            'Four slices, each narrowed by the chained test, then joined: what one slice assumed ' +
            'about its neighbour has to be what that neighbour actually produces. Any key that ' +
            'survives is expanded for real and laid against all 176 image bytes.',
        }),
        el('p', {
          text:
            'That last step is the certificate, and it is why this attack is self-contained. There ' +
            'is no decryption here, no known plaintext, no ciphertext at all — just the question of ' +
            'whether this key’s expansion could have decayed into what was read out of memory. ' +
            'Only one key in practice can.',
        }),
      ]),
      el('div', { class: 'controls' }, [
        el('div', { class: 'control' }, [
          el('label', { for: 'recover-run', text: 'Run the reconstruction' }),
          el('div', { class: 'slider-row' }, [
            ((): HTMLElement => {
              start.id = 'recover-run';
              return start;
            })(),
            stop,
          ]),
          el('span', {
            class: 'control-hint',
            text: `${sourceLabel(state)} · d0 ${(state.model.d0 * 100).toFixed(0)}% · d1 ${state.model.d1}`,
          }),
        ]),
      ]),

      verdict(run, state),

      result && result.outcome === 'recovered'
        ? el('div', { class: 'card' }, [
            el('h3', { text: 'The two checks, kept apart' }),
            checkLine(
              result.certified ? 'pass' : 'fail',
              'this key’s own expansion explains all 176 bytes of the image under the model. ' +
                'An attacker can run this check with nothing but the image.',
            ),
            hasTruth(state)
              ? checkLine(
                  matchesTruth(recovered, run.truth ?? state.key) ? 'pass' : 'fail',
                  'it is the key this page was holding. Only a demo can run this check, and the ' +
                    'attack never needed it.',
                )
              : checkLine(
                  'note',
                  'there is no key behind this image to compare against, so only the certificate above applies.',
                ),
            result.wrongWayBitsUsed > 0
              ? checkLine(
                  'note',
                  `the accepted expansion needs ${result.wrongWayBitsUsed} wrong-way bit` +
                    `${result.wrongWayBitsUsed === 1 ? '' : 's'} to explain the image, inside the budget on offer.`,
                )
              : checkLine('note', 'no wrong-way bits were needed: the image is explained by one-way decay alone.'),
            readout([
              ['Recovered key', el('span', { class: 'hex', 'data-claim': 'recovered-key', text: recovered ? toHex(recovered) : '—' })],
              ['Key on the page', el('span', { class: 'hex', text: hasTruth(state) ? toHex(state.key) : 'none' })],
              ['Image key bytes', el('span', { class: 'hex', text: toHex(keyBytes) })],
            ]),
          ])
        : null,

      result
        ? statStrip([
            ['Outcome', result.outcome],
            ['Time', ms(result.ms)],
            ['Search nodes', count(result.nodes)],
            ['Full expansions checked', count(result.combinationsChecked)],
            ['Keys returned', result.key ? '1' : '0'],
            [
              'Naive search this replaced',
              asPowerOfTwo(supersetCandidates(keyBytes), 0),
            ],
          ])
        : null,

      result && result.outcome !== 'refused' ? stageTable(result) : null,
      result ? ladderTable(result) : null,

      el('div', { class: 'card' }, [
        el('h4', { text: 'What the certificate is worth' }),
        el('p', {
          text:
            `The image on this page holds ${zeroBits(keyBytes)} zero bits in its key bytes, so ` +
            `${asPowerOfTwo(supersetCandidates(keyBytes), 0)} keys are consistent with those sixteen ` +
            'bytes on their own. Laying a candidate’s whole expansion against all 176 bytes cuts ' +
            'that to one, and does it without ever decrypting anything. The schedule has ' +
            `${countOnes(state.image)} one bits still standing in this image; every one of them is a ` +
            'constraint.',
        }),
      ]),

      el('div', { class: 'notice notice-scope' }, [
        el('p', {}, [
          el('strong', { text: 'Times are measured here, on your machine. ' }),
          document.createTextNode(
            'They are not claimed as typical of anything. The paper’s own figures for its ' +
              'implementation, in its mixed-ground-state setting, are not directly comparable, and ' +
              'the figures in exhibit 6 were measured on the author’s machine. Not production ' +
              'software — a teaching demo.',
          ),
        ]),
      ]),
    ]);

    void KEY_BYTES;
  };

  worker.on((reply: WorkerReply) => {
    if (reply.kind === 'error' && reply.id === run.requestId) {
      run = { ...run, status: 'done', result: null, error: reply.message };
      render(store.get());
      return;
    }
    if (reply.kind !== 'recovered') return;
    const recoverReply = reply as RecoverReply;
    if (recoverReply.id !== run.requestId) return; // a reply from an abandoned run
    run = { ...run, status: 'done', result: recoverReply.result as ReconstructResult, error: null };
    render(store.get());
  });

  render(store.get());
  store.subscribe((state, changed) => {
    if (changed.has('generation')) {
      // Retire rather than leave a stale verdict standing -- and only call it
      // RETIRED when there was something to retire, so a reader who has not
      // run anything is not told a verdict was withdrawn.
      const hadSomething = run.status === 'running' || run.status === 'done' || run.status === 'cancelled';
      if (run.status === 'running') worker.terminate();
      run = hadSomething ? { ...IDLE, status: 'retired' } : IDLE;
    }
    if (changed.has('generation') || changed.has('image') || changed.has('key') || changed.has('model')) {
      render(state);
    }
  });
}
