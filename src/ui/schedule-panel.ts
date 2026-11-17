/**
 * EXHIBIT 1 -- the expanded key.
 *
 * A key and its 176-byte schedule, with the relations of FIPS 197 shown by
 * EVALUATING them on demand rather than asserting them in prose. Pick any byte
 * outside the key and the page highlights the bytes that determine it, prints
 * the relation, and computes both sides so they can be compared.
 */

import {
  SCHEDULE_BYTES,
  SLICES,
  determinedBy,
  recomputeByte,
  roundOf,
  toHex,
} from '../cold/aes-schedule';
import { byteGrid, bitsView, gridLegend } from './byte-grid';
import { el, fill, readout, scrollRegion, statStrip } from './dom';
import { hasTruth, type LabState, type Store } from './state';

const ROUND_NAMES = ['the key', 'round key 1', 'round key 2', 'round key 3', 'round key 4', 'round key 5', 'round key 6', 'round key 7', 'round key 8', 'round key 9', 'round key 10'];

function byteName(index: number): string {
  const word = (index / 4) | 0;
  return `w${word}[${index % 4}]`;
}

/** The relation for the inspected byte, computed on both sides. */
function relationCard(state: LabState, index: number): HTMLElement {
  const { schedule } = state;
  const { inputs, subByte, rcon } = determinedBy(index);
  const round = roundOf(index);

  if (inputs.length === 0) {
    return el('div', { class: 'card' }, [
      el('h4', { text: `${byteName(index)} is a key byte` }),
      el('p', {
        text:
          'Nothing in the schedule determines this byte. It is part of the secret — which is ' +
          'exactly why the other 160 bytes are worth so much to an attacker: they are all ' +
          'functions of these sixteen.',
      }),
      bitsView(schedule[index], state.damage.lostMask[index], state.damage.wrongWayMask[index]),
    ]);
  }

  const terms: string[] = inputs.map(byteName);
  if (subByte !== null) terms.push(`S(${byteName(subByte)})`);
  if (rcon) terms.push(`rcon${round}`);

  const values: string[] = inputs.map((i) => schedule[i].toString(16).padStart(2, '0'));
  if (subByte !== null) {
    values.push(`S(${schedule[subByte].toString(16).padStart(2, '0')})`);
  }
  if (rcon) values.push(rcon.toString(16).padStart(2, '0'));

  const recomputed = recomputeByte(schedule, index);
  const stored = schedule[index];

  return el('div', { class: 'card' }, [
    el('h4', { text: `${byteName(index)} — a byte of ${ROUND_NAMES[round]}` }),
    el('p', {
      text:
        subByte !== null
          ? 'This is the key-schedule core: one byte of the previous round key, plus the S-box ' +
            'applied to a byte of the previous round key one position along, plus the round constant.'
          : 'This is a running XOR down the round key: the byte above it, XORed with the byte ' +
            'beside it. Three of the four bytes at every position are built this way, and that is ' +
            'the redundancy the attack lives on.',
    }),
    readout([
      ['Relation', el('span', { class: 'hex', text: `${byteName(index)} = ${terms.join(' ⊕ ')}` })],
      ['With values', el('span', { class: 'hex', text: `${values.join(' ⊕ ')}` })],
      ['Recomputed', el('span', { class: 'hex', text: recomputed.toString(16).padStart(2, '0') })],
      ['Stored', el('span', { class: 'hex', text: stored.toString(16).padStart(2, '0') })],
    ]),
    recomputed === stored
      ? el('p', { class: 'check-line check-pass' }, [
          el('span', { class: 'check-mark', 'aria-hidden': 'true', text: 'OK' }),
          el('span', { text: 'Pass: both sides agree, byte for byte. Computed, not asserted.' }),
        ])
      : el('p', { class: 'check-line check-fail' }, [
          el('span', { class: 'check-mark', 'aria-hidden': 'true', text: 'XX' }),
          el('span', { text: 'Fail: the relation does not reproduce the stored byte.' }),
        ]),
    el('h4', { text: 'The eight bits, and what the image did to them' }),
    bitsView(schedule[index], state.damage.lostMask[index], state.damage.wrongWayMask[index]),
  ]);
}

/** The seven-byte slice, named on the page because the attack turns on it. */
function sliceCard(state: LabState): HTMLElement {
  const rows = SLICES.map((slice) =>
    el('tr', {}, [
      el('th', { scope: 'row', text: `Slice ${slice.p}` }),
      el('td', { class: 'num', text: slice.keyBytes.map(byteName).join(', ') }),
      el('td', { class: 'num', text: slice.derived.map(byteName).join(', ') }),
      el('td', {
        class: 'num',
        text: toHex(Uint8Array.from(slice.keyBytes.map((i) => state.schedule[i]))),
      }),
    ]),
  );
  const table = el('table', { class: 'data' }, [
    el('caption', {
      text:
        'Four key bytes determine three bytes of the next round key. Seven stored bytes, four ' +
        'unknowns — and the same relations chain on through all ten round keys.',
    }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: '' }),
        el('th', { scope: 'col', text: 'Key bytes' }),
        el('th', { scope: 'col', text: 'Determines' }),
        el('th', { scope: 'col', class: 'num', text: 'Values' }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
  return scrollRegion('The four slices of the AES-128 key schedule', table);
}

export function renderSchedulePanel(target: HTMLElement, store: Store): void {
  const render = (state: LabState): void => {
    const inspecting = state.inspecting;
    const { inputs, subByte } = inspecting === null ? { inputs: [], subByte: null } : determinedBy(inspecting);
    const highlighted = subByte === null ? inputs : [...inputs, subByte];

    fill(target, [
      el('h2', { text: 'The expanded key' }),
      el('div', { class: 'card intro' }, [
        el('p', {
          text:
            'Before AES can encrypt anything it stretches your 16-byte key into 176 bytes: eleven ' +
            'round keys, one per round. Software keeps that expansion in memory for as long as the ' +
            'disk is mounted, because recomputing it per block would be slower.',
        }),
        el('p', {
          text:
            'Those 176 bytes are not 176 independent secrets. They are 16 secrets written out ' +
            'eleven times over, each time XORed and shuffled. Pick any byte below that is not part ' +
            'of the key and the page will show you which bytes determine it — and compute both ' +
            'sides so you can check it rather than take it on faith.',
        }),
      ]),
      statStrip([
        ['Key', '16 bytes'],
        ['Expanded', `${SCHEDULE_BYTES} bytes`],
        ['Determined by the key', `${SCHEDULE_BYTES - 16} bytes`],
        ['Bytes of true secret', '16'],
      ]),
      el('p', {
        text: hasTruth(state)
          ? `Key on the page: ${toHex(state.key)}`
          : 'This image is random bytes; there is no key behind it.',
        class: 'hex',
      }),
      el('h3', { text: 'The schedule, as stored' }),
      el('p', {
        text:
          'Eleven rows of sixteen bytes. The first row IS the key. Select a byte to inspect the ' +
          'relation that produces it; its inputs are outlined.',
      }),
      scrollRegion(
        'The AES-128 key schedule as a grid of 176 bytes',
        byteGrid({
          bytes: state.schedule,
          lostMask: null,
          wrongMask: null,
          inputs: highlighted,
          target: inspecting,
          noun: 'schedule',
          onPick: (index) => store.inspect(index === state.inspecting ? null : index),
        }),
        'grid-scroll',
      ),
      gridLegend(false),
      inspecting === null
        ? el('div', { class: 'card' }, [
            el('h4', { text: 'Which bytes determine this one?' }),
            el('p', {
              text:
                'Select any byte in the grid above. Bytes in the first row are the key itself and ' +
                'are determined by nothing — everything else is a function of them.',
            }),
          ])
        : relationCard(state, inspecting),
      el('h3', { text: 'The seven-byte slice' }),
      sliceCard(state),
      el('div', { class: 'notice notice-scope' }, [
        el('p', {}, [
          el('strong', { text: 'Scope. ' }),
          document.createTextNode(
            'This is AES-128 only. AES-192 and AES-256 expand differently, DES expands to a ' +
              'repetition code, and an RSA private-key record carries its own redundancy; the ' +
              'paper covers all of them and this lab builds none of them. Not production ' +
              'software — a teaching demo, and nothing here reads real memory.',
          ),
        ]),
      ]),
    ]);
  };

  render(store.get());
  store.subscribe((state, changed) => {
    if (changed.has('key') || changed.has('schedule') || changed.has('image') || changed.has('inspecting') || changed.has('damage')) {
      render(state);
    }
  });
}
