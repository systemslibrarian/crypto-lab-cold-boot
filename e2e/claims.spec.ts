import { expect, test, type Page } from '@playwright/test';

/**
 * The claims suite: does the page tell the truth?
 *
 * What separates a demo that is CORRECT from one that is TRUSTWORTHY. Three
 * rules shape every test here.
 *
 *  1. COMPARE TWO VALUES THE PAGE ITSELF PRINTED, rather than asserting
 *     against a hardcoded string. A test that re-derives the same expression
 *     the source uses will happily agree with a bug.
 *
 *  2. BUT INTERNAL CONSISTENCY IS NOT ENOUGH, because a page can be
 *     consistently wrong. So several of these RE-DERIVE the claim from the
 *     page's raw inputs by a different route than the source takes: the
 *     recovered key is re-expanded by the TEST'S OWN AES-128 key expansion,
 *     written here from FIPS 197 and sharing no code with `src/`, and checked
 *     against the image the page is showing. A mutation inside
 *     `src/cold/aes-schedule.ts` cannot hide from that.
 *
 *  3. COPY LIVES HERE, NOT IN `gate.ts`. A sentence this lab prints is a claim
 *     about this lab's wording, and when one changes the test that fails
 *     should be named for copy — not "Accessibility gate".
 */

/* ------------------------------------------------------------------ *
 * The test's OWN AES-128 key expansion, from FIPS 197. Deliberately a second
 * implementation: it shares no code with src/, so it is an independent oracle
 * rather than a second reading of the same expression.
 * ------------------------------------------------------------------ */

const SBOX = (() => {
  const xtime = (v: number): number => (((v << 1) & 0xff) ^ (v & 0x80 ? 0x1b : 0)) & 0xff;
  const pow = new Uint8Array(256);
  const log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    pow[i] = x;
    log[x] = i;
    x ^= xtime(x);
  }
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const inv = i === 0 ? 0 : pow[(255 - log[i]) % 255];
    let acc = inv;
    let rot = inv;
    for (let k = 0; k < 4; k++) {
      rot = ((rot << 1) | (rot >> 7)) & 0xff;
      acc ^= rot;
    }
    table[i] = acc ^ 0x63;
  }
  return table;
})();

const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

/** Expand a 16-byte key to 176 bytes, written from FIPS 197 5.2 for this file. */
function expandKeyIndependently(key: number[]): number[] {
  const w = key.slice();
  for (let n = 4; n < 44; n++) {
    const prev = w.slice((n - 1) * 4, n * 4);
    let t = prev;
    if (n % 4 === 0) {
      t = [SBOX[prev[1]] ^ RCON[n / 4 - 1], SBOX[prev[2]], SBOX[prev[3]], SBOX[prev[0]]];
    }
    for (let j = 0; j < 4; j++) w.push(w[(n - 4) * 4 + j] ^ t[j]);
  }
  return w;
}

const popcount = (v: number): number => {
  let n = 0;
  for (let b = 0; b < 8; b++) if ((v >> b) & 1) n++;
  return n;
};

const fromHex = (hex: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
};

/* ------------------------------------------------------------------ *
 * Reading the page.
 * ------------------------------------------------------------------ */

async function open(page: Page): Promise<void> {
  page.setDefaultTimeout(30_000);
  await page.goto('.');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
}

const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name });

async function openTab(page: Page, name: RegExp, panelId: string): Promise<void> {
  await tab(page, name).click();
  await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(panelId)).toBeVisible();
}

/** Read the 176 image bytes straight out of the rendered grid. */
async function readGrid(page: Page, panelId: string): Promise<number[]> {
  const cells = await page.locator(`${panelId} .byte`).all();
  expect(cells).toHaveLength(176);
  const bytes: number[] = [];
  for (const cell of cells) {
    const text = (await cell.textContent()) ?? '';
    const hex = text.trim().slice(0, 2);
    bytes.push(parseInt(hex, 16));
  }
  return bytes;
}

async function setDecay(page: Page, percent: number): Promise<void> {
  await page.locator('#decay-d0').fill(String(percent));
  await page.locator('#decay-d0').dispatchEvent('input');
  await expect(page.locator('#panel-decay .slider-value')).toContainText(`${percent}%`);
}

async function selectImage(page: Page, value: string): Promise<void> {
  await openTab(page, /Decay/, '#panel-decay');
  await page.locator('#decay-source').selectOption(value);
  await expect(page.locator('#decay-source')).toHaveValue(value);
}

async function recover(page: Page): Promise<void> {
  await openTab(page, /Full Recovery/, '#panel-recover');
  await page.locator('#recover-run').click();
  await expect(page.locator('#panel-recover [data-verdict="recovered"], #panel-recover [data-verdict="no-consistent-key"]')).toHaveCount(1, { timeout: 180_000 });
}

/* ------------------------------------------------------------------ *
 * The headline claim, re-derived.
 * ------------------------------------------------------------------ */

test('the recovered key, re-expanded by THIS TEST, explains the image on screen', async ({
  page,
}) => {
  await open(page);
  await selectImage(page, 'fixed-heavy');
  await recover(page);

  await expect(page.locator('#panel-recover [data-verdict="recovered"]')).toHaveCount(1);
  const keyHex = ((await page.locator('[data-claim="recovered-key"]').textContent()) ?? '').trim();
  expect(keyHex).toMatch(/^[0-9a-f]{32}$/);

  // Re-expand with the test's own implementation and lay it against the image
  // the DECAY panel is rendering. Both values come off the page; the expansion
  // between them is this file's, not the source's.
  const schedule = expandKeyIndependently(fromHex(keyHex));
  expect(schedule).toHaveLength(176);
  const image = await readGrid(page, '#panel-decay');

  let wrongWay = 0;
  for (let i = 0; i < 176; i++) wrongWay += popcount(image[i] & ~schedule[i] & 0xff);
  expect(
    wrongWay,
    'every 1 bit in the image must be a 1 in the recovered key’s own expansion',
  ).toBe(0);
});

test('the lost-bit count on screen equals the count derived from the two grids', async ({
  page,
}) => {
  await open(page);
  await selectImage(page, 'fixed-light');

  // The schedule as rendered by exhibit 1, the image as rendered by exhibit 2.
  await openTab(page, /The Expanded Key/, '#panel-schedule');
  const schedule = await readGrid(page, '#panel-schedule');
  await openTab(page, /Decay/, '#panel-decay');
  const image = await readGrid(page, '#panel-decay');

  let lost = 0;
  let lostKey = 0;
  for (let i = 0; i < 176; i++) {
    const bits = popcount(schedule[i] & ~image[i] & 0xff);
    lost += bits;
    if (i < 16) lostKey += bits;
  }

  const strip = page.locator('#panel-decay .stat-strip');
  await expect(strip).toContainText(String(lost));
  await expect(strip).toContainText(String(lostKey));

  // And the schedule the page shows really is the expansion of the key it
  // shows -- checked by the test's own expansion, not the page's.
  const keyText = ((await page.locator('#panel-schedule .hex').first().textContent()) ?? '').trim();
  const keyHex = keyText.replace(/^Key on the page:\s*/, '');
  expect(keyHex).toMatch(/^[0-9a-f]{32}$/);
  expect(expandKeyIndependently(fromHex(keyHex))).toEqual(schedule);
});

test('the naive-search exponent equals the zero bits the test counts in the rendered image', async ({
  page,
}) => {
  await open(page);
  await selectImage(page, 'fixed-heavy');
  const image = await readGrid(page, '#panel-decay');

  let zeros = 0;
  for (let i = 0; i < 16; i++) zeros += 8 - popcount(image[i]);

  await openTab(page, /Naive Search/, '#panel-naive');
  const claim = page.locator('[data-claim="naive-count"]');
  await expect(claim).toContainText(`2^${zeros} candidate keys`);
  // Cross-check: the element also records the exponent as an attribute, and
  // the two surfaces must agree.
  await expect(claim).toHaveAttribute('data-zero-bits', String(zeros));
});

test('the stage counts are non-increasing and end at the number of keys shown', async ({ page }) => {
  await open(page);
  await selectImage(page, 'fixed-light');
  await recover(page);

  const rows = await page.locator('[data-claim="stage-table"] tbody tr').all();
  expect(rows).toHaveLength(4);
  for (const row of rows) {
    const cells = await row.locator('td').allTextContents();
    const numbers = cells.map((c) => Number(c.replace(/,/g, '')));
    expect(numbers).toHaveLength(4);
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i], `stage counts must not grow: ${numbers.join(' -> ')}`).toBeLessThanOrEqual(
        numbers[i - 1],
      );
    }
    expect(numbers[numbers.length - 1]).toBeGreaterThan(0);
  }

  // One key is reported, and exactly one key is shown.
  await expect(page.locator('#panel-recover .stat-strip')).toContainText('1');
  const keyHex = ((await page.locator('[data-claim="recovered-key"]').textContent()) ?? '').trim();
  expect(keyHex).toMatch(/^[0-9a-f]{32}$/);
});

test('the slice stepper’s counts fall, and the enumerated count matches the zero bits on screen', async ({
  page,
}) => {
  await open(page);
  await selectImage(page, 'fixed-light');
  await openTab(page, /One Slice/, '#panel-slice');

  // Step through all five steps.
  for (let i = 0; i < 5; i++) await page.locator('#slice-run').click();

  const read = async (claim: string): Promise<number> => {
    const text = (await page.locator(`[data-claim="${claim}"]`).textContent()) ?? '';
    const match = text.replace(/,/g, '').match(/\d+/);
    expect(match, `${claim} must print a number`).not.toBeNull();
    return Number(match![0]);
  };

  const enumerated = await read('slice-enumerated');
  const rk1 = await read('slice-after-rk1');
  const rk2 = await read('slice-after-rk2');
  const rk3 = await read('slice-after-rk3');
  const final = await read('slice-final');

  expect(enumerated).toBeGreaterThan(rk1);
  expect(rk1).toBeGreaterThanOrEqual(rk2);
  expect(rk2).toBeGreaterThanOrEqual(rk3);
  expect(rk3).toBeGreaterThanOrEqual(final);
  expect(final).toBeGreaterThan(0);

  // Independent re-derivation: the enumerated count is 2^(zero bits in the
  // slice's four key bytes), and the panel's own table prints those zero-bit
  // counts per byte. Sum them and the exponent must match.
  const rows = await page.locator('#panel-slice table.data tbody tr').all();
  expect(rows.length).toBeGreaterThanOrEqual(7);
  let zeroBits = 0;
  for (const row of rows.slice(0, 4)) {
    const cells = await row.locator('td').allTextContents();
    zeroBits += Number(cells[2]);
  }
  expect(enumerated).toBe(2 ** zeroBits);
});

/* ------------------------------------------------------------------ *
 * Failure paths, and that the page names the actual cause.
 * ------------------------------------------------------------------ */

test('an image that is not a decayed schedule gets NO key and the page says why', async ({
  page,
}) => {
  await open(page);
  await selectImage(page, 'noise');
  await recover(page);

  await expect(page.locator('#panel-recover [data-verdict="no-consistent-key"]')).toHaveCount(1);
  await expect(page.locator('#panel-recover [data-verdict="recovered"]')).toHaveCount(0);
  // The page names the cause rather than merely reporting a failure.
  await expect(page.locator('#panel-recover [data-verdict]')).toContainText(
    'NO CONSISTENT KEY EXISTS UNDER THE MODEL',
  );
  await expect(page.locator('#panel-recover [data-verdict]')).toContainText(
    'not a decayed key schedule',
  );
  // And it must not show the recovered clause at all.
  await expect(page.locator('[data-claim="recovered-key"]')).toHaveCount(0);
  await expect(page.locator('[data-claim="negative-claim"]')).toHaveCount(0);
});

test('zero decay says nothing was lost', async ({ page }) => {
  await open(page);
  await openTab(page, /Decay/, '#panel-decay');
  await setDecay(page, 0);

  const schedulePanel = page.locator('#panel-schedule');
  await openTab(page, /The Expanded Key/, '#panel-schedule');
  const schedule = await readGrid(page, '#panel-schedule');
  await openTab(page, /Decay/, '#panel-decay');
  const image = await readGrid(page, '#panel-decay');
  expect(image).toEqual(schedule);
  await expect(page.locator('#panel-decay .stat-strip')).toContainText('0');
  void schedulePanel;
});

/* ------------------------------------------------------------------ *
 * Retirement, and the no-op guard.
 * ------------------------------------------------------------------ */

test('a verdict is RETIRED when the decay changes, and the page says it was', async ({ page }) => {
  await open(page);
  await selectImage(page, 'random');
  await setDecay(page, 10);
  await recover(page);
  await expect(page.locator('#panel-recover [data-verdict="recovered"]')).toHaveCount(1);

  await openTab(page, /Decay/, '#panel-decay');
  await setDecay(page, 20);
  await openTab(page, /Full Recovery/, '#panel-recover');

  // The stale verdict is gone...
  await expect(page.locator('#panel-recover [data-verdict="recovered"]')).toHaveCount(0);
  await expect(page.locator('[data-claim="recovered-key"]')).toHaveCount(0);
  // ...and the page says it was withdrawn rather than silently blanking.
  await expect(page.locator('#panel-recover [data-verdict]')).toContainText('VERDICT RETIRED');
});

test('NO-OP GUARD: re-selecting the same values does not retire a fresh verdict', async ({
  page,
}) => {
  await open(page);
  await selectImage(page, 'fixed-light');
  await recover(page);
  await expect(page.locator('#panel-recover [data-verdict="recovered"]')).toHaveCount(1);
  const keyBefore = await page.locator('[data-claim="recovered-key"]').textContent();

  // Re-select the image that is already selected, and re-set the slider to the
  // value it already holds. Neither is a change, so neither may retire.
  await openTab(page, /Decay/, '#panel-decay');
  const current = await page.locator('#decay-d0').inputValue();
  await page.locator('#decay-source').selectOption('fixed-light');
  await page.locator('#decay-d0').fill(current);
  await page.locator('#decay-d0').dispatchEvent('input');
  await page.locator('#decay-d1').selectOption('0');

  await openTab(page, /Full Recovery/, '#panel-recover');
  await expect(page.locator('#panel-recover [data-verdict="recovered"]')).toHaveCount(1);
  await expect(page.locator('[data-claim="recovered-key"]')).toHaveText(keyBefore ?? '');
});

/* ------------------------------------------------------------------ *
 * The [hidden] probe.
 * ------------------------------------------------------------------ */

test('[hidden] PROBE: a hidden panel is really hidden, not merely believed to be', async ({
  page,
}) => {
  await open(page);
  // A class rule that sets `display` outranks the user agent's `[hidden]`
  // rule, so an element can carry the attribute, be believed hidden by the
  // code, and paint anyway. Ask the rendering, not the attribute.
  const leaking = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[hidden]'))
      .filter((el) => el.checkVisibility({ checkVisibilityCSS: true }))
      .map((el) => `${el.tagName.toLowerCase()}#${el.id}`),
  );
  expect(leaking, 'elements carrying [hidden] that still paint').toEqual([]);

  // And the attribute is really the mechanism: six panels carry it on arrival.
  const hiddenPanels = await page.locator('.panel[hidden]').count();
  expect(hiddenPanels).toBe(6);
});

/* ------------------------------------------------------------------ *
 * The honesty copy. These are the sentences the lab must keep saying.
 * ------------------------------------------------------------------ */

test('the decay control is labelled a model, not a measurement', async ({ page }) => {
  await open(page);
  await openTab(page, /Decay/, '#panel-decay');
  const notice = page.locator('#panel-decay .notice-model');
  await expect(notice).toContainText('This slider is a model, not a clock.');
  await expect(notice).toContainText('not a measurement');
  await expect(notice).toContainText('ONE ground state');
});

test('the page scopes itself: AES-128 only, not production, nothing reads real memory', async ({
  page,
}) => {
  await open(page);
  await expect(page.locator('#panel-schedule .notice-scope')).toContainText('AES-128 only');
  await expect(page.locator('#panel-schedule .notice-scope')).toContainText(
    'Not production software',
  );
  await expect(page.locator('#panel-schedule .notice-scope')).toContainText(
    'nothing here reads real memory',
  );
  await openTab(page, /Decay/, '#panel-decay');
  await expect(page.locator('#panel-decay .notice-scope')).toContainText('Not a memory acquisition');
});

test('the countermeasures panel is dated to its source and claims nothing current', async ({
  page,
}) => {
  await open(page);
  await openTab(page, /What Defends/, '#panel-defends');
  await expect(page.locator('#panel-defends .notice-scope')).toContainText('2008 paper');
  await expect(page.locator('#panel-defends .notice-scope')).toContainText(
    'not a statement about any current operating system',
  );
});

/* ------------------------------------------------------------------ *
 * THE NEGATIVE CLAIM (template section 4.1d).
 *
 * Three assertions, against the brief's named evidence fixture: exhibit 5 on
 * the T = 77 fixed image.
 *
 *  1. Reach the fixture through the UI.
 *  2. Every verdict the page renders in that state reports SUCCESS. If any
 *     check failed, the fixture would be demonstrating the mechanism working
 *     rather than its limit.
 *  3. The limitation is ON SCREEN in that state -- visible, not in the README
 *     and not behind a disclosure.
 * ------------------------------------------------------------------ */

const NEGATIVE_CLAIM =
  'This image has lost bits in the key itself, and a direct search for them is out of reach. ' +
  'That says nothing about whether the key is safe: the rest of the schedule pinned it down, ' +
  'with no plaintext or ciphertext.';

test('NEGATIVE CLAIM: the key bytes are wrecked, the search is out of reach, and the key comes back anyway', async ({
  page,
}) => {
  await open(page);

  // 1. Reach the fixture: the T = 77 image, driven through the real control.
  await selectImage(page, 'fixed-heavy');

  // The naive count reads 2^88 and the key bytes differ from the true key in
  // 25 bits -- the brief's two independently derived figures for this image.
  await openTab(page, /Naive Search/, '#panel-naive');
  await expect(page.locator('[data-claim="naive-count"]')).toContainText('2^88 candidate keys');
  await openTab(page, /Decay/, '#panel-decay');
  await expect(page.locator('#panel-decay .stat-strip')).toContainText('25');

  await recover(page);

  // 2. EVERYTHING IS GREEN. Asserted against the rendered verdicts, not a flag
  //    this test set: the verdict marker, the certificate line and the
  //    truth line all have to report success.
  await expect(page.locator('#panel-recover [data-verdict="recovered"]')).toHaveCount(1);
  await expect(page.locator('#panel-recover .check-fail')).toHaveCount(0);
  const passes = page.locator('#panel-recover .check-pass');
  await expect(passes).toHaveCount(2);
  await expect(passes.first()).toContainText('explains all 176 bytes of the image');
  await expect(passes.nth(1)).toContainText('it is the key this page was holding');

  // The headline says both halves at once: the damage AND the recovery.
  const headline = page.locator('[data-claim="recovered-headline"]');
  await expect(headline).toContainText('25 KEY BITS LOST');
  await expect(headline).toContainText('AND THE KEY WAS RECOVERED FROM THE IMAGE ALONE');

  // 3. THE LIMITATION IS ON SCREEN, in that state, visible.
  const claim = page.locator('[data-claim="negative-claim"]');
  await expect(claim).toBeVisible();
  await expect(claim).toHaveText(NEGATIVE_CLAIM);
  // Not behind a disclosure: no ancestor <details> and nothing [hidden].
  expect(
    await claim.evaluate((el) => !!el.closest('details') || !!el.closest('[hidden]')),
  ).toBe(false);

  // And the stage counts and the full-schedule check are visible in the same
  // state, which is what makes the claim a result rather than a disclaimer.
  await expect(page.locator('[data-claim="stage-table"]')).toBeVisible();
  await expect(page.locator('#panel-recover .stat-strip')).toContainText('Full expansions checked');
});

test('NEGATIVE CLAIM BITE: random bytes must not show the recovered clause', async ({ page }) => {
  // The bite fixture the brief names for mutation 7: 176 random bytes as the
  // image. A build that set "recovered" whenever the search returned any key,
  // without the full-schedule check, fails here.
  await open(page);
  await selectImage(page, 'noise');
  await recover(page);

  await expect(page.locator('#panel-recover [data-verdict="no-consistent-key"]')).toHaveCount(1);
  await expect(page.locator('[data-claim="recovered-headline"]')).toHaveCount(0);
  await expect(page.locator('[data-claim="negative-claim"]')).toHaveCount(0);
  await expect(page.locator('[data-claim="recovered-key"]')).toHaveCount(0);
});

test('NEGATIVE CLAIM BITE: the claim text is tied to the fixture, not printed everywhere', async ({
  page,
}) => {
  // If the sentence were static page furniture it would prove nothing. It must
  // be absent until the fixture is reached.
  await open(page);
  await expect(page.locator('[data-claim="negative-claim"]')).toHaveCount(0);
  await selectImage(page, 'fixed-heavy');
  await expect(page.locator('[data-claim="negative-claim"]')).toHaveCount(0);
  await recover(page);
  await expect(page.locator('[data-claim="negative-claim"]')).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * The reference figures are labelled as someone else's measurement.
 * ------------------------------------------------------------------ */

test('the measured figures and the brief’s figures are kept apart and both labelled', async ({
  page,
}) => {
  await open(page);
  await openTab(page, /Many Keys/, '#panel-trials');

  await expect(page.locator('[data-claim="trials-measured"] caption')).toContainText(
    'Measured in this browser',
  );
  const reference = page.locator('#panel-trials table.data').nth(1);
  await expect(reference.locator('caption')).toContainText('on their own machines');
  await expect(reference.locator('caption')).toContainText('read the shape rather than the milliseconds');
  await expect(page.locator('#panel-trials .notice-scope')).toContainText(
    'not claimed as typical of any machine',
  );
});
