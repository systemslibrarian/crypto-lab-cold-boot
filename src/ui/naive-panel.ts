/**
 * EXHIBIT 3 -- the naive search.
 *
 * Count the zero bits in the image's 16 key bytes, and count the keys that
 * leaves. Every number is exact, in BigInt, because the whole point is how big
 * "out of reach" is and a rounded double would blur it.
 */

import { toHex } from '../cold/aes-schedule';
import {
  PAPER_EXAMPLE,
  asPowerOfTwo,
  candidatesWithKnownLossCount,
  choose,
  log2Big,
  supersetCandidates,
  zeroBits,
} from '../cold/naive';
import { el, fill, scrollRegion } from './dom';
import { hasTruth, type LabState, type Store } from './state';

/** Years at a billion-billion keys a second, for scale. */
function yearsAtExascale(count: bigint): string {
  // 10^18 keys/second is about the rate of the fastest machines ever built,
  // applied to nothing but this search. Divide in BigInt, then describe.
  const perYear = 31_557_600n * 10n ** 18n;
  if (count < perYear) return 'under a year';
  const years = count / perYear;
  const exponent = log2Big(years) / Math.log2(10);
  if (years < 1_000_000n) return `about ${years.toLocaleString('en-US')} years`;
  return `about 10^${exponent.toFixed(1)} years`;
}

export function renderNaivePanel(target: HTMLElement, store: Store): void {
  const render = (state: LabState): void => {
    const keyBytes = state.image.subarray(0, 16);
    const zeros = zeroBits(keyBytes);
    const supersets = supersetCandidates(keyBytes);
    const lostKeyBits = state.damage.lostKeyBits;
    const withCount = hasTruth(state) ? candidatesWithKnownLossCount(keyBytes, lostKeyBits) : null;

    const paperRow = el('tr', {}, [
      el('th', { scope: 'row', text: 'The paper’s 256-bit example' }),
      el('td', { class: 'num', text: '140' }),
      el('td', { class: 'num', text: '12' }),
      el('td', { class: 'num', text: asPowerOfTwo(PAPER_EXAMPLE.count) }),
      el('td', { text: 'Section 5.2: with 10% of the ones decayed, the image sits an expected 12 bits from the key.' }),
    ]);

    const thisRow = el('tr', {}, [
      el('th', { scope: 'row', text: 'The image on this page' }),
      el('td', { class: 'num', text: String(zeros) }),
      el('td', { class: 'num', text: hasTruth(state) ? String(lostKeyBits) : 'unknown' }),
      el('td', { class: 'num', text: withCount ? asPowerOfTwo(withCount) : '—' }),
      el('td', {
        text: hasTruth(state)
          ? 'And the attacker does not actually know how many decayed, so this is the easy version.'
          : 'There is no key behind this image, so there is no loss count to know.',
      }),
    ]);

    const table = el('table', { class: 'data' }, [
      el('caption', {
        text:
          'If the attacker were TOLD how many bits had decayed, the search would be a choice of ' +
          'which zeros were really ones. It is still out of reach.',
      }),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: '' }),
          el('th', { scope: 'col', class: 'num', text: 'Zero bits' }),
          el('th', { scope: 'col', class: 'num', text: 'Lost bits' }),
          el('th', { scope: 'col', class: 'num', text: 'Candidates' }),
          el('th', { scope: 'col', text: 'Note' }),
        ]),
      ]),
      el('tbody', {}, [thisRow, paperRow]),
    ]);

    fill(target, [
      el('h2', { text: 'The naive search' }),
      el('div', { class: 'card intro' }, [
        el('p', {
          text:
            'The obvious attack is to guess. You have the damaged key bytes in front of you, you ' +
            'know bits only fell from 1 to 0, so every 0 you see might really be a 1. Try every ' +
            'combination and test each guess.',
        }),
        el('p', {
          text:
            'That is the approach the paper opens by dismissing, and the counting below is why. ' +
            'Note what it does NOT depend on: not the cleverness of the search, not the speed of ' +
            'the machine. The space is simply too large.',
        }),
      ]),

      el('h3', { text: 'How many keys fit the damaged key bytes?' }),
      el('div', { class: 'card' }, [
        el('p', {}, [
          document.createTextNode('Image key bytes: '),
          el('span', { class: 'hex', text: toHex(keyBytes) }),
        ]),
        el('p', {
          text:
            `Those sixteen bytes hold ${zeros} zero bits. Each one could be a 0 that stayed a 0, ` +
            'or a 1 that fell. Every 1 bit you can see, on the other hand, must have been a 1 — ' +
            'bits do not appear out of nowhere under a one-way model. So the keys consistent with ' +
            'what you are holding are exactly the supersets of it:',
        }),
        el('span', {
          class: 'big-count',
          'data-claim': 'naive-count',
          'data-zero-bits': String(zeros),
          text: `2^${zeros} candidate keys`,
        }),
        el('p', {
          text:
            `Written out, that is ${supersets.toString()} — and at a billion billion keys a ` +
            `second, ${yearsAtExascale(supersets)}.`,
        }),
      ]),

      scrollRegion('Naive search sizes for this image and for the paper’s example', table),

      el('div', { class: 'card' }, [
        el('h4', { text: 'The paper’s own number' }),
        el('p', {
          text:
            'Section 5.2 works the example with a 256-bit key and equal numbers of ones and ' +
            'zeros: once 10% of the ones have decayed, the recovered data sits an expected Hamming ' +
            'distance of 12 from the key, and the number of keys at that distance is C(140, 12), ' +
            `which is ${asPowerOfTwo(PAPER_EXAMPLE.count)} — the paper states it as greater than 2^56. ` +
            `Exactly: ${choose(140, 12).toString()}.`,
        }),
        el('p', {
          text:
            'The paper also reports what happens when you try anyway: their own implementation of ' +
            'the distance-ordered search took twenty minutes to get through 10^9 candidate keys and ' +
            'reconstruct a key with 7 bits flipped, and they estimated ten days for one with 11.',
        }),
      ]),

      el('div', { class: 'notice notice-scope' }, [
        el('p', {}, [
          el('strong', { text: 'What this count is not. ' }),
          document.createTextNode(
            'It is the size of a search over the KEY BYTES alone. The next two exhibits throw it ' +
              'away entirely: the attack never searches keys. It searches four bytes at a time and ' +
              'spends them against the rest of the schedule, which is why the same damage that ' +
              'makes this number hopeless costs the real attack milliseconds.',
          ),
        ]),
      ]),
    ]);
  };

  render(store.get());
  store.subscribe((state, changed) => {
    if (changed.has('image') || changed.has('key') || changed.has('damage') || changed.has('source')) {
      render(state);
    }
  });
}
