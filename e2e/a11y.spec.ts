import { expect, test } from '@playwright/test';
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches: the arrival state with the
 * schedule grid painted and six panels hidden; the shared skip link focused; a
 * key byte, a key-schedule-core byte and a running-XOR byte each inspected
 * with their inputs outlined; the decay control at 0, 15, 30 and 40 per cent;
 * the wrong-way rate on, which adds a third damage glyph; both fixed images
 * with their published fingerprints; an image of random bytes, which has no
 * key behind it; the slice stepper through all five of its steps and then
 * reset; a recovery, its ALARM verdict and its negative claim; the same
 * verdict RETIRED after the decay changed; the random-bytes refusal, where no
 * consistent key exists and none is claimed; twenty keys measured; the
 * countermeasures panel; the tablist driven by ArrowRight and End; three hover
 * states; and a scroll region focused. Every one of those states is scanned,
 * at desktop and phone width.
 *
 * See `gate.ts` for why nothing is injected into the page, why no panel is
 * revealed from script, why the lab's defaults are asserted rather than
 * assumed, and why `violations` is not the whole oracle.
 *
 * Dark is the only theme this lab has, so there is one theme loop rather than
 * two — `index.html` pins it before first paint and the page ships no toggle.
 */
test('no WCAG A/AA violations', async ({ page }) => {
  test.setTimeout(1_800_000);
  const errors = watchPageErrors(page);
  await boot(page);
  await driveAllStates(page, 'dark');
  expect(errors, errors.join('\n')).toEqual([]);
  expectBaselineNotStale();
  reportCollected();
});

test('no WCAG A/AA violations at 380px', async ({ page }) => {
  test.setTimeout(1_800_000);
  const errors = watchPageErrors(page);
  await page.setViewportSize(NARROW);
  await boot(page);
  await driveAllStates(page, 'dark @380px');
  expect(errors, errors.join('\n')).toEqual([]);
  expectBaselineNotStale();
  reportCollected();
});
