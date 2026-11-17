/**
 * EXHIBIT 4 -- one slice, stepped through.
 *
 * The one headline mechanism of this lab, shown rather than asserted. Pick a
 * slice, and watch the candidate count fall as each round key's bytes are
 * brought to bear on it: a few hundred thousand four-byte combinations, down
 * to about five hundred after round key 1, about sixteen after round key 2,
 * and a handful by round key 3.
 *
 * Every number on this panel is measured by the same `searchSlice` the full
 * recovery uses. The steps reveal the stages of one real search; they do not
 * re-enact it with made-up figures.
 */

import { SLICES, toHex } from '../cold/aes-schedule';
import { asPowerOfTwo, zeroBits } from '../cold/naive';
import { HARD_TEST, candidatesFor, searchSlice, type SliceSearch } from '../cold/slice';
import { control, count, el, fill, readout, scrollRegion } from './dom';
import { hasTruth, type LabState, type Store } from './state';

interface StepState {
  readonly search: SliceSearch | null;
  readonly revealed: number;
  readonly generation: number;
  readonly slice: number;
}

const STEP_LABELS = [
  'Enumerate the four key bytes',
  'Apply the hard test on round key 1',
  'Carry the chain to round key 2',
  'Carry the chain to round key 3',
  'Carry it through all ten round keys',
];

function byteName(index: number): string {
  return `w${(index / 4) | 0}[${index % 4}]`;
}

/** The product of the four key bytes' candidate counts, before any test. */
function enumeratedCombinations(image: Uint8Array, p: number): bigint {
  const slice = SLICES[p];
  let total = 1n;
  for (const index of slice.keyBytes) {
    total *= BigInt(candidatesFor(image[index], 0, false).length);
  }
  return total;
}

export function renderSlicePanel(target: HTMLElement, store: Store): void {
  let step: StepState = { search: null, revealed: 0, generation: -1, slice: -1 };

  const render = (state: LabState): void => {
    const p = state.slice;
    const slice = SLICES[p];
    const stale = step.generation !== state.generation || step.slice !== p;
    if (stale) step = { search: null, revealed: 0, generation: state.generation, slice: p };

    const picker = el('select', {}) as HTMLSelectElement;
    for (const s of SLICES) {
      const option = el('option', {
        value: String(s.p),
        text: `Slice ${s.p} — ${s.keyBytes.map(byteName).join(', ')}`,
      }) as HTMLOptionElement;
      if (s.p === p) option.selected = true;
      picker.append(option);
    }
    picker.addEventListener('change', () => store.setSlice(Number(picker.value)));

    const run = el('button', {
      type: 'button',
      class: 'action',
      text: step.search === null ? 'Run this slice' : 'Next step',
      disabled: step.search !== null && step.revealed >= STEP_LABELS.length,
    }) as HTMLButtonElement;
    run.addEventListener('click', () => {
      if (step.search === null) {
        step = { ...step, search: searchSlice(state.image, p, HARD_TEST), revealed: 1 };
      } else {
        step = { ...step, revealed: Math.min(STEP_LABELS.length, step.revealed + 1) };
      }
      render(state);
    });

    const reset = el('button', { type: 'button', class: 'action secondary', text: 'Start over' });
    reset.addEventListener('click', () => {
      step = { ...step, search: null, revealed: 0 };
      render(state);
    });

    const enumerated = enumeratedCombinations(state.image, p);
    const search = step.search;

    const sliceBytes = el('table', { class: 'data' }, [
      el('caption', {
        text:
          'The seven bytes of this slice as the image holds them. Four are key bytes the search ' +
          'is solving for; three are bytes of round key 1 that those four determine.',
      }),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Byte' }),
          el('th', { scope: 'col', text: 'Role' }),
          el('th', { scope: 'col', class: 'num', text: 'Image' }),
          el('th', { scope: 'col', class: 'num', text: 'Zero bits' }),
          el('th', { scope: 'col', class: 'num', text: 'Candidates' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        [
          ...slice.keyBytes.map((index) =>
            el('tr', {}, [
              el('th', { scope: 'row', text: byteName(index) }),
              el('td', { text: 'key byte — unknown' }),
              el('td', { class: 'num', text: state.image[index].toString(16).padStart(2, '0') }),
              el('td', { class: 'num', text: String(8 - popcount(state.image[index])) }),
              el('td', { class: 'num', text: String(candidatesFor(state.image[index], 0, false).length) }),
            ]),
          ),
          ...slice.derived.map((index) =>
            el('tr', {}, [
              el('th', { scope: 'row', text: byteName(index) }),
              el('td', { text: 'determined — a test, not an unknown' }),
              el('td', { class: 'num', text: state.image[index].toString(16).padStart(2, '0') }),
              el('td', { class: 'num', text: String(8 - popcount(state.image[index])) }),
              el('td', { class: 'num', text: '—' }),
            ]),
          ),
        ],
      ),
    ]);

    const steps: HTMLElement[] = [];
    const revealed = search ? step.revealed : 0;

    if (revealed >= 1 && search) {
      steps.push(
        el('div', { class: 'card' }, [
          el('h4', { text: `Step 1 — ${STEP_LABELS[0]}` }),
          el('p', {
            text:
              'Each of the four key bytes must contain every 1 bit the image shows for it. That ' +
              'leaves one candidate per zero bit, multiplied out:',
          }),
          el('span', {
            class: 'big-count',
            'data-claim': 'slice-enumerated',
            text: `${enumerated.toString()} combinations (${asPowerOfTwo(enumerated)})`,
          }),
          el('p', {
            text:
              `Those four bytes hold ${zeroBits(Uint8Array.from(slice.keyBytes.map((i) => state.image[i])))} ` +
              'zero bits between them. Note the search never writes this list down — it walks it ' +
              'depth first and throws candidates away as it goes.',
          }),
        ]),
      );
    }

    if (revealed >= 2 && search) {
      steps.push(
        el('div', { class: 'card' }, [
          el('h4', { text: `Step 2 — ${STEP_LABELS[1]}` }),
          el('p', {
            text:
              'Now spend the three bytes of round key 1 that those four determine. For each ' +
              'combination, compute the three bytes and ask whether each one contains every 1 bit ' +
              'of its image byte. If a 1 is in the image, the true byte had a 1 there; a candidate ' +
              'without it is impossible, not merely unlikely.',
          }),
          el('span', {
            class: 'big-count',
            'data-claim': 'slice-after-rk1',
            text: `${count(search.stages.afterRound1)} survive`,
          }),
        ]),
      );
    }

    if (revealed >= 3 && search) {
      steps.push(
        el('div', { class: 'card' }, [
          el('h4', { text: `Step 3 — ${STEP_LABELS[2]}` }),
          el('p', {
            text:
              'Round key 2 needs one byte this slice does not own: its neighbour’s d byte, the ' +
              'S-box input. So guess it — and that guess immediately pays for itself. It pins the ' +
              'three bytes of round key 2 at this position, AND it pins a fourth byte, the ' +
              'neighbour’s c byte, because two d bytes XOR to it. One byte guessed, four bytes ' +
              'tested.',
          }),
          el('span', {
            class: 'big-count',
            'data-claim': 'slice-after-rk2',
            text: `${count(search.stages.afterRound2)} survive`,
          }),
          el('p', {
            text:
              'That is the whole trick. Stopping at round key 1 and joining the four slices there ' +
              'leaves millions of combinations to expand; carrying the chain costs one guessed byte ' +
              'per round and buys four tests, so the survivors collapse instead of multiplying.',
          }),
        ]),
      );
    }

    if (revealed >= 4 && search) {
      steps.push(
        el('div', { class: 'card' }, [
          el('h4', { text: `Step 4 — ${STEP_LABELS[3]}` }),
          el('span', {
            class: 'big-count',
            'data-claim': 'slice-after-rk3',
            text: `${count(search.stages.afterRound3)} survive`,
          }),
          el('p', { text: 'Same step again, one round deeper. The slice is now effectively pinned.' }),
        ]),
      );
    }

    if (revealed >= 5 && search) {
      steps.push(
        el('div', { class: 'card' }, [
          el('h4', { text: `Step 5 — ${STEP_LABELS[4]}` }),
          el('span', {
            class: 'big-count',
            'data-claim': 'slice-final',
            text: `${count(search.stages.final)} candidate${search.stages.final === 1 ? '' : 's'} left`,
          }),
          readout([
            ['Search nodes visited', count(search.nodes)],
            [
              'True key bytes still present',
              hasTruth(state)
                ? search.chains.some(
                    (c) => toHex(c.keyBytes) === toHex(Uint8Array.from(slice.keyBytes.map((i) => state.schedule[i]))),
                  )
                  ? 'yes'
                  : 'NO — the model cannot explain this image'
                : 'no key to compare against',
            ],
          ]),
          el('p', {
            text:
              'Four slices, each down to a handful. Exhibit 5 joins them: what one slice assumed ' +
              'about its neighbour has to be what the neighbour actually produces, and then the ' +
              'assembled key gets expanded for real and laid against all 176 bytes.',
          }),
        ]),
      );
    }

    fill(target, [
      el('h2', { text: 'One slice' }),
      el('div', { class: 'card intro' }, [
        el('p', {
          text:
            'The attack does not search keys. It takes four key bytes at a time — one slice — and ' +
            'spends them immediately against every stored byte they determine. Watch the count ' +
            'fall as each round key is brought in.',
        }),
      ]),
      el('div', { class: 'controls' }, [
        control('slice-pick', 'Slice', picker),
        el('div', { class: 'control' }, [
          el('label', { for: 'slice-run', text: 'Step through it' }),
          el('div', { class: 'slider-row' }, [
            ((): HTMLElement => {
              run.id = 'slice-run';
              return run;
            })(),
            reset,
          ]),
          el('span', {
            class: 'control-hint',
            text: `Step ${revealed} of ${STEP_LABELS.length}.`,
          }),
        ]),
      ]),
      scrollRegion(`The seven bytes of slice ${p}`, sliceBytes),
      ...(steps.length
        ? steps
        : [
            el('div', { class: 'card' }, [
              el('h4', { text: 'Nothing run yet' }),
              el('p', {
                text:
                  'Press "Run this slice". Every count that follows is measured by the same search ' +
                  'the full recovery uses — none of it is illustrative.',
              }),
            ]),
          ]),
    ]);
  };

  render(store.get());
  store.subscribe((state, changed) => {
    if (changed.has('image') || changed.has('slice') || changed.has('generation') || changed.has('key')) {
      render(state);
    }
  });
}

function popcount(v: number): number {
  let n = 0;
  for (let b = 0; b < 8; b++) if ((v >> b) & 1) n++;
  return n;
}
