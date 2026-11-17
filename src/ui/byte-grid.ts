/**
 * The 11 x 16 byte grid, with row and column headers.
 *
 * Damage is marked with a TEXT GLYPH as well as a colour, per WCAG 1.4.1, and
 * each cell carries an accessible name saying in words what it is: which round
 * key, which byte, what value, and what happened to it. In grayscale the grid
 * reads exactly the same.
 */

import { SCHEDULE_BYTES, roundOf } from '../cold/aes-schedule';
import { el } from './dom';

/** Glyph for a byte that lost bits to the ground state. */
export const LOST_MARK = '▾'; // small down triangle: bits fell
/** Glyph for a byte carrying a bit that flipped AWAY from the ground state. */
export const WRONG_MARK = '▴'; // small up triangle: a bit appeared
/** Glyph for a byte the image kept intact. */
export const INTACT_MARK = '·'; // middle dot

export interface GridOptions {
  /** The bytes to render. */
  readonly bytes: Uint8Array;
  /** Per-byte mask of bits lost to the ground state, or null. */
  readonly lostMask?: Uint8Array | null;
  /** Per-byte mask of bits that flipped the wrong way, or null. */
  readonly wrongMask?: Uint8Array | null;
  /** Byte indices to outline as the inputs of the inspected relation. */
  readonly inputs?: readonly number[];
  /** Byte index to outline as the inspected byte. */
  readonly target?: number | null;
  /** Called when a cell is activated. */
  readonly onPick?: (index: number) => void;
  /** Name used in each cell's accessible label, e.g. "image" or "schedule". */
  readonly noun: string;
}

const ROUND_LABELS = [
  'Key',
  'RK1',
  'RK2',
  'RK3',
  'RK4',
  'RK5',
  'RK6',
  'RK7',
  'RK8',
  'RK9',
  'RK10',
];

/** Column heading for byte `i` of a round key: the word and the position in it. */
function columnLabel(i: number): string {
  return `w${(i / 4) | 0}.${i % 4}`;
}

/**
 * Describe a byte in words. This is the cell's accessible name, so it has to
 * carry everything the colour and the glyph carry.
 */
export function describeByte(
  index: number,
  value: number,
  lost: number,
  wrong: number,
  noun: string,
): string {
  const round = roundOf(index);
  const where = `${ROUND_LABELS[round]} byte ${index % 16}`;
  const hex = value.toString(16).padStart(2, '0');
  const parts = [`${where}, ${noun} value ${hex}`];
  if (lost) parts.push(`${countBits(lost)} bit${countBits(lost) === 1 ? '' : 's'} lost to the ground state`);
  if (wrong) parts.push(`${countBits(wrong)} bit${countBits(wrong) === 1 ? '' : 's'} flipped the wrong way`);
  if (!lost && !wrong) parts.push('intact');
  return parts.join(', ');
}

function countBits(v: number): number {
  let n = 0;
  for (let b = 0; b < 8; b++) if ((v >> b) & 1) n++;
  return n;
}

/** Build the grid table. */
export function byteGrid(options: GridOptions): HTMLElement {
  const { bytes, lostMask, wrongMask, inputs, target, onPick, noun } = options;
  if (bytes.length !== SCHEDULE_BYTES) {
    throw new RangeError(`the grid renders ${SCHEDULE_BYTES} bytes, got ${bytes.length}`);
  }
  const inputSet = new Set(inputs ?? []);

  const head = el('tr', {}, [el('th', { scope: 'col', text: '' })]);
  for (let i = 0; i < 16; i++) head.append(el('th', { scope: 'col', text: columnLabel(i) }));

  const body = el('tbody');
  for (let r = 0; r < 11; r++) {
    const row = el('tr', {}, [el('th', { scope: 'row', text: ROUND_LABELS[r] })]);
    for (let i = 0; i < 16; i++) {
      const index = r * 16 + i;
      const value = bytes[index];
      const lost = lostMask ? lostMask[index] : 0;
      const wrong = wrongMask ? wrongMask[index] : 0;
      const classes = ['byte'];
      if (lost) classes.push('lost');
      if (wrong) classes.push('wrong-way');
      if (inputSet.has(index)) classes.push('is-input');
      if (target === index) classes.push('is-target');
      const mark = wrong ? WRONG_MARK : lost ? LOST_MARK : INTACT_MARK;
      const cell = el(
        'button',
        {
          type: 'button',
          class: classes.join(' '),
          'data-index': index,
          'aria-pressed': target === index ? 'true' : 'false',
          'aria-label': describeByte(index, value, lost, wrong, noun),
        },
        [
          document.createTextNode(value.toString(16).padStart(2, '0')),
          el('span', { class: 'mark', 'aria-hidden': 'true', text: mark }),
        ],
      );
      if (onPick) cell.addEventListener('click', () => onPick(index));
      row.append(el('td', {}, [cell]));
    }
    body.append(row);
  }

  return el('table', { class: 'bytes' }, [
    el('caption', { class: 'sr-only', text: `The ${noun}, 11 round keys of 16 bytes` }),
    el('thead', {}, [head]),
    body,
  ]);
}

/** The grid's legend, which is what makes the glyphs readable. */
export function gridLegend(showWrong: boolean): HTMLElement {
  const items = [
    el('li', {}, [
      el('span', { class: 'swatch swatch-kept', 'aria-hidden': 'true', text: `${INTACT_MARK} ` }),
      document.createTextNode('intact — every bit read back as stored'),
    ]),
    el('li', {}, [
      el('span', { class: 'swatch swatch-lost', 'aria-hidden': 'true', text: `${LOST_MARK} ` }),
      document.createTextNode('lost — one or more 1 bits fell to the ground state'),
    ]),
  ];
  if (showWrong) {
    items.push(
      el('li', {}, [
        el('span', { class: 'swatch swatch-wrong', 'aria-hidden': 'true', text: `${WRONG_MARK} ` }),
        document.createTextNode('wrong way — a 0 bit read back as 1'),
      ]),
    );
  }
  const list = el('ul', { class: 'legend', role: 'list' }, items);
  for (const item of list.children) item.setAttribute('role', 'listitem');
  return list;
}

/** The eight bits of one byte, side by side, with what happened to each. */
export function bitsView(value: number, lost: number, wrong: number): HTMLElement {
  const items: HTMLElement[] = [];
  for (let bit = 7; bit >= 0; bit--) {
    const mask = 1 << bit;
    const isLost = (lost & mask) !== 0;
    const isWrong = (wrong & mask) !== 0;
    const shown = (value & mask) !== 0 ? '1' : '0';
    const classes = ['bits-item'];
    if (isLost) classes.push('bit-lost');
    if (isWrong) classes.push('bit-wrong');
    const note = isLost ? 'lost' : isWrong ? 'wrong way' : 'intact';
    items.push(
      el('li', { class: classes.join(' '), role: 'listitem' }, [
        el('span', { class: 'bit-value', text: shown }),
        el('span', { class: 'bit-index', text: `b${bit}` }),
        el('span', { class: 'sr-only', text: ` bit ${bit} reads ${shown}, ${note}` }),
        el('span', {
          class: 'bit-index',
          'aria-hidden': 'true',
          text: isLost ? LOST_MARK : isWrong ? WRONG_MARK : INTACT_MARK,
        }),
      ]),
    );
  }
  return el('ul', { class: 'bits', role: 'list' }, items);
}
