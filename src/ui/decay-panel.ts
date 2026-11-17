/**
 * EXHIBIT 2 -- decay.
 *
 * The decay control, the wrong-way rate, and the image: which bits were lost.
 * Labelled as a model throughout, because it is one. The paper's measurements
 * of how long real DRAM holds data are in its section 3 and this lab
 * reproduces none of them.
 */

import { SCHEDULE_BYTES, countOnes, toHex } from '../cold/aes-schedule';
import { FIXED_IMAGE_FACTS } from '../cold/fixtures';
import { sha256Hex } from '../cold/sha256';
import { byteGrid, bitsView, gridLegend } from './byte-grid';
import { control, el, fill, pct, readout, scrollRegion, statStrip } from './dom';
import { hasTruth, sourceLabel, type ImageSource, type LabState, type Store } from './state';

const SOURCES: [ImageSource, string][] = [
  ['random', 'Fresh random key and decay draw'],
  ['fixed-light', `Fixed image — ${FIXED_IMAGE_FACTS.light.label}`],
  ['fixed-heavy', `Fixed image — ${FIXED_IMAGE_FACTS.heavy.label}`],
  ['noise', '176 random bytes (not a schedule)'],
];

export function renderDecayPanel(target: HTMLElement, store: Store): void {
  const render = (state: LabState): void => {
    const { image, damage, model } = state;
    const storedOnes = hasTruth(state) ? countOnes(state.schedule) : null;

    const slider = el('input', {
      type: 'range',
      min: '0',
      max: '40',
      step: '1',
      value: String(Math.round(model.d0 * 100)),
      'aria-describedby': 'decay-slider-hint',
    }) as HTMLInputElement;
    slider.addEventListener('input', () => store.setModel({ d0: Number(slider.value) / 100 }));

    const wrongWay = el('select', {}) as HTMLSelectElement;
    for (const [value, label] of [
      ['0', '0 — strictly one-way'],
      ['0.001', '0.1% — the paper’s measured ceiling'],
    ] as const) {
      const option = el('option', { value, text: label }) as HTMLOptionElement;
      if (Number(value) === model.d1) option.selected = true;
      wrongWay.append(option);
    }
    wrongWay.addEventListener('change', () => store.setModel({ d1: Number(wrongWay.value) }));

    const source = el('select', {}) as HTMLSelectElement;
    for (const [value, label] of SOURCES) {
      const option = el('option', { value, text: label }) as HTMLOptionElement;
      if (value === state.source) option.selected = true;
      source.append(option);
    }
    source.addEventListener('change', () => store.setSource(source.value as ImageSource));

    const newKey = el('button', { type: 'button', class: 'action', text: 'New key' });
    newKey.addEventListener('click', () => store.newKey());
    const redraw = el('button', { type: 'button', class: 'action secondary', text: 'Re-draw decay' });
    redraw.addEventListener('click', () => store.redraw());

    const fixedFacts =
      state.source === 'fixed-light' || state.source === 'fixed-heavy'
        ? FIXED_IMAGE_FACTS[state.source === 'fixed-light' ? 'light' : 'heavy']
        : null;

    fill(target, [
      el('h2', { text: 'Decay' }),
      el('div', { class: 'card intro' }, [
        el('p', {
          text:
            'Cut the power to a machine and its DRAM does not forget at once. Cells drift towards ' +
            'a ground state, and the paper this lab follows measured that drift: at room ' +
            'temperature most bits survive for seconds, and cooling the chips stretches that to ' +
            'minutes. So an attacker who reboots into their own tiny kernel, or simply pulls the ' +
            'memory module, gets a copy of what was in memory — damaged, but a copy.',
        }),
        el('p', {
          text:
            'Below, every stored 1 bit is given a chance d0 of having fallen to 0, and every ' +
            'stored 0 a much smaller chance d1 of having flipped the other way. Move the slider ' +
            'and watch the image come apart.',
        }),
      ]),
      el('div', { class: 'notice notice-model' }, [
        el('p', {}, [
          el('strong', { text: 'This slider is a model, not a clock. ' }),
          document.createTextNode(
            'It does not say how long real memory holds data, and it is not a measurement of ' +
              'anything. The decay physics, the temperatures and the timings belong to the paper’s ' +
              'own experiments; this lab reproduces none of them and you should not read a time off ' +
              'this control. The model also fixes ONE ground state, 0, for every bit. Real memory ' +
              'has regions with either ground state, which is why the paper’s algorithms take the ' +
              'ground state of each cell as an input.',
          ),
        ]),
      ]),
      el('div', { class: 'controls' }, [
        control(
          'decay-source',
          'Image',
          source,
          'The two fixed images are built by a published deterministic rule, so they are the same every time.',
        ),
        el('div', { class: 'control' }, [
          el('label', { for: 'decay-d0', text: 'Decay d0 — P(stored 1 reads 0)' }),
          el('div', { class: 'slider-row' }, [
            ((): HTMLElement => {
              slider.id = 'decay-d0';
              return slider;
            })(),
            el('span', { class: 'slider-value', text: pct(model.d0, 0) }),
          ]),
          el('span', {
            class: 'control-hint',
            id: 'decay-slider-hint',
            text: 'Zero to forty per cent. A model parameter, not a time.',
          }),
        ]),
        control(
          'decay-d1',
          'Wrong way d1 — P(stored 0 reads 1)',
          wrongWay,
          'The paper measured this under 0.1% and roughly constant.',
        ),
        el('div', { class: 'control' }, [
          el('label', { for: 'decay-newkey', text: 'Draw again' }),
          el('div', { class: 'slider-row' }, [
            ((): HTMLElement => {
              newKey.id = 'decay-newkey';
              return newKey;
            })(),
            redraw,
          ]),
          el('span', {
            class: 'control-hint',
            text: 'Keys and decay draws come from crypto.getRandomValues.',
          }),
        ]),
      ]),

      el('h3', { text: 'What this image lost' }),
      statStrip([
        ['Source', sourceLabel(state)],
        ['Bits lost', String(damage.lostBits)],
        ['Of stored one bits', storedOnes ? `${damage.lostBits} of ${storedOnes}` : 'n/a'],
        ['Measured loss rate', storedOnes ? pct(damage.lostBits / storedOnes) : 'n/a'],
        ['Wrong-way bits', String(damage.wrongWayBits)],
        ['Lost in the key itself', String(damage.lostKeyBits)],
      ]),
      el('p', {
        text: hasTruth(state)
          ? 'The grid shows the IMAGE — what was read back. A byte is marked where the image ' +
            'differs from what was stored.'
          : 'The grid shows 176 random bytes. There is no stored schedule behind them, so nothing ' +
            'is marked as lost: there is nothing to have lost it from.',
      }),
      scrollRegion(
        'The decayed image, 176 bytes read back from memory',
        byteGrid({
          bytes: image,
          lostMask: hasTruth(state) ? damage.lostMask : null,
          wrongMask: hasTruth(state) ? damage.wrongWayMask : null,
          target: state.inspecting,
          noun: 'image',
          onPick: (index) => store.inspect(index === state.inspecting ? null : index),
        }),
        'grid-scroll',
      ),
      gridLegend(model.d1 > 0 || damage.wrongWayBits > 0),

      state.inspecting === null
        ? el('div', { class: 'card' }, [
            el('h4', { text: 'One byte at a time' }),
            el('p', { text: 'Select a byte above to see its eight bits and what became of each.' }),
          ])
        : el('div', { class: 'card' }, [
            el('h4', {
              text: `Byte ${state.inspecting} — stored ${
                hasTruth(state) ? state.schedule[state.inspecting].toString(16).padStart(2, '0') : '??'
              }, read back ${image[state.inspecting].toString(16).padStart(2, '0')}`,
            }),
            bitsView(
              image[state.inspecting],
              hasTruth(state) ? damage.lostMask[state.inspecting] : 0,
              hasTruth(state) ? damage.wrongWayMask[state.inspecting] : 0,
            ),
            el('p', {
              text:
                'A lost bit reads 0 where a 1 was stored. That is the whole of the damage, and it ' +
                'runs in one direction — which is what makes the repair below possible.',
            }),
          ]),

      fixedFacts
        ? el('div', { class: 'card' }, [
            el('h4', { text: 'This fixed image, by the numbers' }),
            el('p', {
              text:
                'Built from the FIPS 197 Appendix A.1 schedule: for byte i and bit b, a stored 1 ' +
                `is cleared when the first byte of SHA-256("decay" || i || b) is under ${fixedFacts.threshold}. ` +
                'Only ones are cleared, so this image has no wrong-way flips at all.',
            }),
            readout([
              ['Bits cleared', String(fixedFacts.clearedBits)],
              ['Image key bytes', el('span', { class: 'hex', text: toHex(image.subarray(0, 16)) })],
              ['SHA-256 of the image', el('span', { class: 'hex', text: sha256Hex(image) })],
              ['Key bits lost', String(fixedFacts.lostKeyBits)],
            ]),
          ])
        : null,

      el('div', { class: 'notice notice-scope' }, [
        el('p', {}, [
          el('strong', { text: 'Not a memory acquisition. ' }),
          document.createTextNode(
            'Nothing here reads your machine’s memory, and nothing could: this page decays a ' +
              'schedule it generated itself, in a tab. Acquiring a real image — the reboot, the ' +
              'cooled module, the tiny kernel — is in the paper and is not built here.',
          ),
        ]),
      ]),
    ]);
  };

  render(store.get());
  store.subscribe((state, changed) => {
    if (
      changed.has('image') ||
      changed.has('model') ||
      changed.has('key') ||
      changed.has('inspecting') ||
      changed.has('source') ||
      changed.has('damage')
    ) {
      render(state);
    }
  });
  void SCHEDULE_BYTES;
}
