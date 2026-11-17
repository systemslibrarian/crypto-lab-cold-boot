/**
 * The page's shared state: one key, one error model, one image.
 *
 * Every exhibit reads from here and nothing writes to it except through
 * `update`. The generation counter is the point: a verdict computed against
 * generation 7 is stale the moment the key, the decay model or the image
 * changes, and a stale verdict has to be RETIRED rather than left sitting
 * there looking current. Re-selecting a value that is already set is a no-op
 * and must not retire a fresh verdict.
 */

import { KEY_BYTES, expandKey, toHex } from '../cold/aes-schedule';
import { cryptoRandom, damageBetween, decaySchedule, type DecayDamage } from '../cold/decay';
import {
  FIXED_IMAGE_FACTS,
  FIXED_IMAGE_HEAVY,
  FIXED_IMAGE_LIGHT,
  FIXTURE_KEY,
  FIXTURE_SCHEDULE,
} from '../cold/fixtures';
import type { ErrorModel } from '../cold/types';

/** Where the image on the page came from. */
export type ImageSource =
  /** A fresh key and a fresh decay draw from crypto.getRandomValues. */
  | 'random'
  /** The brief's check-B fixed image at T = 38. Deterministic, labelled. */
  | 'fixed-light'
  /** The brief's check-B fixed image at T = 77. Deterministic, labelled. */
  | 'fixed-heavy'
  /** 176 random bytes that are not a decayed schedule at all. */
  | 'noise';

export interface LabState {
  readonly key: Uint8Array;
  readonly schedule: Uint8Array;
  readonly image: Uint8Array;
  readonly model: ErrorModel;
  readonly damage: DecayDamage;
  readonly source: ImageSource;
  /** Bumped whenever anything above changes. Verdicts carry it. */
  readonly generation: number;
  /** Byte index the schedule exhibit is inspecting, or null. */
  readonly inspecting: number | null;
  /** Slice position the slice exhibit is stepping through. */
  readonly slice: number;
}

export type Listener = (state: LabState, changed: ReadonlySet<keyof LabState>) => void;

const random = cryptoRandom();

function freshKey(): Uint8Array {
  const key = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(key);
  return key;
}

function noiseImage(): Uint8Array {
  const image = new Uint8Array(176);
  crypto.getRandomValues(image);
  return image;
}

export class Store {
  private state: LabState;
  private listeners = new Set<Listener>();

  constructor(d0 = 0.15, d1 = 0) {
    const key = freshKey();
    const schedule = expandKey(key);
    const model = { d0, d1 };
    const image = decaySchedule(schedule, model, random);
    this.state = {
      key,
      schedule,
      image,
      model,
      damage: damageBetween(schedule, image),
      source: 'random',
      generation: 1,
      inspecting: null,
      slice: 0,
    };
  }

  get(): LabState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(changed: Set<keyof LabState>): void {
    for (const listener of this.listeners) listener(this.state, changed);
  }

  /**
   * Which changes retire a verdict?
   *
   * A verdict is a statement about an image under a model. The key, the model
   * and the image are all part of that statement; which byte the schedule
   * exhibit happens to be inspecting is not.
   */
  private static retires(changed: ReadonlySet<keyof LabState>): boolean {
    return changed.has('key') || changed.has('image') || changed.has('model');
  }

  /** Draw a brand-new key and a fresh decay draw at the current model. */
  newKey(): void {
    const key = freshKey();
    const schedule = expandKey(key);
    const image = decaySchedule(schedule, this.state.model, random);
    this.commit({ key, schedule, image, source: 'random' }, new Set(['key', 'schedule', 'image', 'source']));
  }

  /** Re-draw the decay at the current key and model. */
  redraw(): void {
    if (this.state.source !== 'random') {
      // A fixed image is fixed; redrawing means leaving it.
      this.setSource('random');
      return;
    }
    const image = decaySchedule(this.state.schedule, this.state.model, random);
    this.commit({ image }, new Set(['image']));
  }

  /** Change the decay model. A no-op when the values already match. */
  setModel(next: Partial<ErrorModel>): void {
    const model = { ...this.state.model, ...next };
    if (model.d0 === this.state.model.d0 && model.d1 === this.state.model.d1) return;
    if (this.state.source === 'random') {
      const image = decaySchedule(this.state.schedule, model, random);
      this.commit({ model, image }, new Set(['model', 'image']));
    } else {
      // The fixed images were built by their own rule; the model still governs
      // how the search reads them.
      this.commit({ model }, new Set(['model']));
    }
  }

  /** Switch the image source. A no-op when it is already selected. */
  setSource(source: ImageSource): void {
    if (source === this.state.source) return;
    if (source === 'random') {
      const key = freshKey();
      const schedule = expandKey(key);
      const image = decaySchedule(schedule, this.state.model, random);
      this.commit({ key, schedule, image, source }, new Set(['key', 'schedule', 'image', 'source']));
      return;
    }
    if (source === 'noise') {
      // There is no key behind noise. Keep the previous key out of the way by
      // keeping it, and let the exhibits say the image is not a schedule.
      this.commit({ image: noiseImage(), source }, new Set(['image', 'source']));
      return;
    }
    const image = source === 'fixed-light' ? FIXED_IMAGE_LIGHT : FIXED_IMAGE_HEAVY;
    const facts = FIXED_IMAGE_FACTS[source === 'fixed-light' ? 'light' : 'heavy'];
    this.commit(
      {
        key: FIXTURE_KEY,
        schedule: FIXTURE_SCHEDULE,
        image: Uint8Array.from(image),
        source,
        // The fixed images clear ones only, so d1 is 0 by construction. d0 is
        // set to what the rule produced, ROUNDED TO THE SLIDER'S OWN GRID of
        // whole percent: the rule's exact rate is threshold/256, which is
        // 14.84% for T = 38, and storing that unrounded makes the control lie.
        // The slider would read "15%" while the model held 0.1484, so
        // re-setting the slider to the value it already displays would count
        // as a change and retire a fresh verdict. The exact rule and its
        // threshold are printed on the fixed-image card, which is where that
        // precision belongs; d0 is not used by the search at all, only shown.
        model: { d0: Math.round((facts.threshold / 256) * 100) / 100, d1: 0 },
      },
      new Set(['key', 'schedule', 'image', 'source', 'model']),
    );
  }

  /** Inspect one schedule byte, or clear the selection. Never retires. */
  inspect(index: number | null): void {
    if (index === this.state.inspecting) return;
    this.state = { ...this.state, inspecting: index };
    this.emit(new Set(['inspecting']));
  }

  /** Choose which slice the slice exhibit steps through. Never retires. */
  setSlice(slice: number): void {
    if (slice === this.state.slice) return;
    this.state = { ...this.state, slice };
    this.emit(new Set(['slice']));
  }

  private commit(
    patch: Partial<Omit<LabState, 'generation' | 'damage'>>,
    changed: Set<keyof LabState>,
  ): void {
    const next = { ...this.state, ...patch } as LabState;
    const damage = damageBetween(next.schedule, next.image);
    this.state = {
      ...next,
      damage,
      generation: Store.retires(changed) ? this.state.generation + 1 : this.state.generation,
    };
    changed.add('damage');
    if (Store.retires(changed)) changed.add('generation');
    this.emit(changed);
  }
}

/** Does the page actually know the key behind the image on screen? */
export function hasTruth(state: LabState): boolean {
  return state.source !== 'noise';
}

/** A short human label for the current image source. */
export function sourceLabel(state: LabState): string {
  switch (state.source) {
    case 'random':
      return 'fresh random key, fresh decay draw';
    case 'fixed-light':
      return `fixed image ${FIXED_IMAGE_FACTS.light.label}`;
    case 'fixed-heavy':
      return `fixed image ${FIXED_IMAGE_FACTS.heavy.label}`;
    case 'noise':
      return '176 random bytes (not a decayed schedule)';
  }
}

/** The key as hex, or a statement that there is no key to show. */
export function keyHex(state: LabState): string {
  return hasTruth(state) ? toHex(state.key) : 'no key — this image is random bytes';
}
