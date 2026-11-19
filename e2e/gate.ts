import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditControlNames, formatControlNameFailures } from './control-names';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';
import { assertThisLab } from './identity';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, and each one corrects something the gate
 * this replaces did:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The old spec pushed
 *     `animation:none!important; transition:none!important` through
 *     `addStyleTag`. That BYPASSES a lab's own
 *     `@media (prefers-reduced-motion: reduce)` block instead of exercising it,
 *     so the rendering a reduced-motion reader actually gets was never once the
 *     rendering that got scanned. Here the block that matters is the one on
 *     `.progress-fill`: the trials exhibit's bar is driven by a width
 *     transition, and the reduced-motion rule cancels the transition while
 *     LEAVING the width — because a reader with the preference set still has to
 *     be able to see how far a measurement got. This gate sets the preference
 *     through `emulateMedia`, asserts from inside the page that it took effect
 *     (`test.use({ reducedMotion })` silently does nothing on Playwright
 *     1.61.x), and injects nothing.
 *
 *  2. IT FORCED EVERY PANEL VISIBLE FROM SCRIPT. The old drive stripped every
 *     `[hidden]` attribute and set every `<details>.open` by JS before its only
 *     scan. Stripping `hidden` puts all seven tabpanels on screen AT ONCE — a
 *     rendering no reader can reach and axe then scans instead of the real one.
 *     This gate switches tabs by clicking them, which is the route a reader
 *     has, and scans each panel in its own states.
 *
 *  3. IT DROVE BLIND AND THEN THREW THE STATES AWAY. The old drive clicked
 *     every button whose label matched a regex, swallowed every failure with
 *     `.catch(() => {})`, waited a fixed 120ms per tab, and scanned ONCE at the
 *     end — so a click that silently did nothing looked identical to one that
 *     worked. This drive names every control it touches, asserts a real
 *     completion signal after each, and scans after every step, at both 1280
 *     and 380 px. Here the states that matter most are the ones only reachable
 *     by making the search FAIL: the random-bytes image, where the page must
 *     say no consistent key exists; and the retired verdict, where changing the
 *     decay has to withdraw a verdict rather than leave it standing.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. The surfaces that carry
 *     this lab's meaning — every `[data-verdict]` tone, the lost/wrong-way byte
 *     cells, the hero aside and the shared top bar's ink — are `color-mix()`
 *     fills axe files under `incomplete` rather than judging. So is an
 *     `aria-label` on a role-less element, and this page leans on getting that
 *     right: every byte cell in the grid is named only by `aria-label`.
 *
 *  5. IT HAD NO REFLOW, NON-TEXT-CONTRAST OR GENERATED-CONTENT ORACLE. The old
 *     spec hand-rolled one luminance check over two input selectors, reading
 *     the DECLARED `border-top-color` and `background-color` — blind to
 *     `color-mix()`, to composited backdrops, to every `.action`, `.tab-btn`
 *     and `.byte` control, and to all states past first paint. `nontext.ts`
 *     replaces it with a measured oracle over every control at every driven
 *     state, and `expectNoHorizontalOverflow` adds the 1.4.10 check axe has no
 *     rule for — which matters here because the schedule grid is 16 columns of
 *     bytes and lives in an `overflow-x: auto` region on purpose.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Two rAFs are not enough. A transition sampled mid-flight has a colour that
 * exists in no state of the page, and axe will happily report it: elsewhere in
 * this fleet that produced a phantom 2.00:1 failure on a button whose settled
 * ratio is 9:1. Transitions also drain in waves rather than in one batch, so a
 * poll for "nothing running right now" can exit through a gap between waves —
 * hence six consecutive quiet frames rather than one.
 *
 * Bounded three ways, because a gate that can hang is a gate nobody runs:
 * animations that never finish (`iterations: Infinity`) are excluded from the
 * quiescence test rather than waited on, a wall-clock budget inside the page
 * gives up and proceeds, and Playwright's own timeout is the backstop.
 *
 * Under the reduced motion this gate asserts, `style.css`'s reduced-motion
 * block cancels the progress bar's transition and the controls' hover
 * transitions, so `getAnimations()` is normally empty and this returns on the
 * sixth frame. It stays because the shared top bar's `.cl-btn` transitions are
 * declared OUTSIDE the lab's `@media` block, and because the trials exhibit
 * animates a width whenever a measurement is running.
 */
export async function settle(page: Page, budgetMs = 4000): Promise<void> {
  await page.waitForFunction(
    (budget: number) => {
      const w = window as unknown as { __quietFrames?: number; __settleStart?: number };
      if (w.__settleStart === undefined) w.__settleStart = performance.now();
      const done = (): boolean => {
        w.__quietFrames = 0;
        w.__settleStart = undefined;
        return true;
      };
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        const timing = a.effect?.getComputedTiming?.();
        // An infinite decorative animation never drains; waiting on it hangs.
        return timing?.iterations !== Infinity;
      });
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      if (w.__quietFrames >= 6) return done();
      if (performance.now() - (w.__settleStart ?? 0) > budget) return done();
      return false;
    },
    budgetMs,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab
 * does not currently reveal anything through an animation — nothing starts at
 * `opacity: 0` — so the assertion is a guard rather than a live finding, and it
 * is the guard that makes that a measurement rather than a reading. The one
 * motion here is the trials progress bar's width, and `style.css` cancels its
 * transition while keeping the width.
 *
 * `aria-hidden` subtrees are excluded; what this lab hides is the decorative
 * damage glyphs beside their own words and the verdict marks beside their own
 * labels — see `contrast.ts`.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created. Every panel here renders synchronously at first activation, so a
 * renderer that throws leaves that tabpanel EMPTY — and an empty region is
 * exactly what a scan reports as perfectly accessible. Attach before `boot`,
 * assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark.
 *
 * The shared `.cl-topbar` carries an explicit `role="banner"`. This lab's own
 * hero is a `<div class="cl-hero">`, not a `<header>`, so nothing here implies
 * a second banner today — but the page DOES ship a `<footer>` and the shared
 * bar's `dedupeBanner()` exists because other labs in this fleet shipped a
 * second banner from exactly this part of the markup. Asserting the OUTCOME
 * rather than the markup is what catches that edit.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * List semantics survive their styling.
 *
 * This lab styles several lists `list-style: none` — the grid legend, the bits
 * view, the stat strips, the countermeasures list — and that declaration is
 * exactly what makes Safari and VoiceOver DROP a list's implicit role. Every
 * one of them therefore carries an explicit `role="list"` with `role="listitem"`
 * on its children, so here an explicit role on a list is the fix rather than
 * the defect. What is asserted is the SHAPE of that fix: any explicit role on a
 * `ul`/`ol` must be `list` (any other value orphans every `<li>` under it), and
 * a `role="list"` must never sit on an empty element, because axe applies
 * `aria-required-children` to the explicit role and fails it the day a list
 * renders with nothing in it. Roles are assigned in `dom.ts`'s element helper,
 * so ask the DOM rather than grepping the source.
 */
export async function assertListSemantics(page: Page): Promise<void> {
  const broken = await page.$$eval('ul[role], ol[role]', (els) =>
    els
      .filter((e) => e.getAttribute('role') !== 'list' || e.children.length === 0)
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] with ${e.children.length} children`
      )
  );
  expect(
    broken,
    'an explicit non-list role on a list deletes its semantics; an empty role="list" fails aria-required-children'
  ).toEqual([]);
}
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This lab is full of scrollers and they are the point: the 11x16 schedule
 * grid and every data table live in an `overflow-x: auto` region, because a
 * 16-column byte grid cannot reflow to 380px and a clipped table is worse than
 * a scrolled one. `dom.ts`'s `scrollRegion` gives each one `tabindex="0"`, a
 * `role="region"` and an `aria-label`, and this oracle is what proves it —
 * a scroller born without a keyboard route is invisible to axe, and it fails
 * on the Linux CI runner even where local Chromium passes.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Nothing may be focusable while it paints nothing (WCAG 2.4.3 / 2.4.7).
 *
 * `opacity: 0` with `pointer-events: none` is NOT hiding: the element keeps
 * `tabIndex: 0`, so a keyboard reader tabs to a control that is not on screen
 * and the focus ring lands nowhere. `display: none` and `visibility: hidden`
 * DO remove an element from the tab order, so those are skipped rather than
 * flagged — the failure is specifically the invisible-but-tabbable pair. The
 * `hidden` tabpanels here take the `display: none` route, which is why five
 * panels' worth of buttons are legitimately absent from the tab order.
 *
 * Off-screen-but-focusable is the WCAG-sanctioned skip-link idiom and is
 * deliberately not flagged: the shared skip link parks at `top:-3rem` with
 * full opacity and slides in on focus. The drive scans it focused.
 */
export async function expectNoInvisibleFocusTargets(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.tabIndex < 0) continue;
      // display:none / visibility:hidden already remove it from the tab order.
      if (!el.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        effective *= parseFloat(getComputedStyle(n).opacity);
      }
      const r = el.getBoundingClientRect();
      if (effective !== 0 && r.width > 0 && r.height > 0) continue;
      // Confirm it really is reachable rather than inferring it.
      const before = document.activeElement;
      el.focus();
      const took = document.activeElement === el;
      (before as HTMLElement | null)?.focus?.();
      if (took) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
            ` (opacity ${effective}, ${Math.round(r.width)}x${Math.round(r.height)})`
        );
      }
    }
    return Array.from(new Set(out));
  });
  expect(bad, `focusable elements that paint nothing in state: ${label}`).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run.
 * It is a debugging aid only: `A11Y_COLLECT` is never set in CI, and a run
 * with it set prints every finding as it happens and then fails at the end, so
 * a green collection run cannot be mistaken for a green gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function soft(fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    // Generous, not 900: a truncated oracle dump is how a second and third
    // finding in the same state get missed on a collection pass.
    record(String(e).slice(0, 6000));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no
 * text node.
 *
 * IT IS CALLED FROM `scan()`, deliberately and not by accident. Fleet-wide
 * this oracle had been called from inside a soft wrapper AFTER its
 * `if (!COLLECTING) return` guard — so in a strict run, which is every run in
 * CI and every run anyone reads as a pass, the guard returned first and
 * `nontext.ts` never executed at all. Thirteen repos certified themselves
 * clean on an oracle that had never looked. Calling it here means it runs at
 * every driven state, including `:hover`, and this repo's baseline was
 * captured by that live path.
 *
 * A check that merely logs is not a gate, so it ratchets: anything NOT in the
 * baseline fails, anything in the baseline that got WORSE fails, and anything
 * in the baseline that has been FIXED fails until its entry is deleted. That
 * last rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`);
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the
 * point — or the drive stopped reaching the state that shows it, which is a
 * coverage regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Nine assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically — which matters here because the surfaces carrying
 *    this lab's meaning are `color-mix()` fills axe cannot resolve: every
 *    `[data-verdict]` border tone, the lost and wrong-way byte cells, the
 *    negative-claim box, the hero aside and the shared bar's ink. Everything
 *    else in that bucket is a real result axe simply could not finish —
 *    including `aria-prohibited-attr`, which is where an `aria-label` on a
 *    role-less element hides. This page leans hard on getting that right:
 *    every one of the 176 byte cells in the schedule grid is a `<button>` named
 *    ONLY by `aria-label`, because its visible text is two hex digits and a
 *    glyph. Drop the role or the label and the grid becomes unreadable.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - the same walk over `aria-hidden` content with the exemption lifted —
 *    SC 1.4.3 is about what a reader SEES; see `contrast.ts` for what this
 *    lab hides and why it is measured anyway.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`. This is the only oracle that judges a
 *    control's boundary against the surface OUTSIDE it.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - no focusable element that paints nothing — WCAG 2.4.3/2.4.7.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads
  // exactly like a full A/AA pass. For scale, `withTags(TAGS)` selects 69 of
  // axe-core 4.12's 105 rule definitions; the chained form executes 4.
  //
  // The landmark four are still wanted because they are best-practice rather
  // than WCAG-tagged, so `withTags` alone does not reach them — and this page
  // has the shape they catch: a sticky `<header role="banner">` above a
  // `<div id="app">` holding an `<aside class="cl-hero-why">`, two `<nav>`s
  // (the shared actions and the tablist wrapper), one `<main>` and a footer.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  // The `incomplete` bucket is asserted, not skimmed. `aria-prohibited-attr`
  // and `aria-required-children` appear ONLY here — never in `violations` — so
  // a gate that ignores this bucket cannot see either. Only `color-contrast`
  // is allowed to remain, and only because the arithmetic walk below judges
  // those ratios for real; no other rule is filtered out.
  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  // axe's `label` rule accepts a bare `placeholder` as an accessible name, so a
  // deleted label can leave this gate green. See `control-names.ts`.
  const unnamed = formatControlNameFailures(await auditControlNames(page));
  softExpect(unnamed, `form controls named only by placeholder/title in state: ${label}`, []);

  // The aria-hidden walk, exemption lifted — axe skips this text entirely and
  // the default walk honours the same boundary, so this second call is the
  // ONLY thing that ever measures it. See `contrast.ts` for the inventory.
  const hiddenContrast = Array.from(
    new Set(
      formatContrastFailures(
        await auditContrast(page, '[aria-hidden="true"], [aria-hidden="true"] *', true)
      )
    )
  );
  softExpect(hiddenContrast, `measured aria-hidden contrast failures in state: ${label}`, []);

  await soft(() => expectNoNewNonTextFailures(page, label));
  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoInvisibleFocusTargets(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
}

/**
 * Load the page in the only theme it has, with reduced motion actually in
 * effect, and assert that the content every scan relies on is really there.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.x, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * ASSERTED from inside the page.
 *
 * Shared setup. Runs before EVERY test that imports it, so an assertion here
 * fails all of them at once, under whatever name those tests carry.
 *
 * SO THIS FUNCTION ASSERTS STRUCTURE AND NEVER PRODUCT COPY. On 2026-09-26
 * crypto-lab-mceliece-gate changed one textarea's default string; its gate.ts
 * still asserted the old sentence, boot() threw, both axe runs failed, the
 * build job failed, the deploy was skipped, and deploy-sync reported the lab
 * stale. The step that went red was called "Accessibility gate", and four of
 * its six a11y tests had passed. For three days the live site served security
 * claims that main had already corrected, and the one red thing in sight named
 * the wrong subject.
 *
 * Structure: the control exists, the arrival panel is the one that ships,
 * counts, `[hidden]` on the panels that are not active, a default matching a
 * SHAPE rather than a sentence. What a string SAYS belongs in
 * `e2e/claims.spec.ts`, where a failure names copy as the subject.
 */
export async function boot(page: Page): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  /* Not page.goto: a suite that navigates and starts asserting cannot
   * tell this lab's server from anyone else's. See e2e/identity.ts. */
  await assertThisLab(page, '.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect',
  ).toBe(true);

  // Dark is the only theme, pinned by the head's inline script before first
  // paint AND present as a literal on <html> so it holds with JS off.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await assertSingleBanner(page);
  await assertListSemantics(page);

  // ── The page really rendered ────────────────────────────────────────────
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('.tab-btn')).toHaveCount(7);

  // The shared skip link points at an id that exists. axe's skip-link rule is
  // best-practice, not WCAG-tagged, so `withTags` never runs it — a skip link
  // aimed at a missing element is exactly the kind of thing a green axe run
  // says nothing about.
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app');
  await expect(page.locator('#app')).toHaveCount(1);

  // Dark is the only theme, so the page must carry no theme control at all.
  // The shared CSS hides any lab toggle with `display:none !important`, which
  // would leave a dead-but-known element; asserting the count at zero catches
  // the day one is added without going through that list.
  await expect(
    page.locator('#theme-toggle, #themeToggle, .theme-toggle, .theme-toggle-btn, [data-theme-toggle]'),
  ).toHaveCount(0);

  // ── The arrival state ───────────────────────────────────────────────────
  // Every panel is rendered eagerly at mount here, unlike the lazy labs in
  // this fleet, because each one reads the same shared state and has to be
  // able to re-render when it changes. So the assertion is that the six
  // non-active panels are HIDDEN rather than empty — and `hidden` is the only
  // mechanism used, which is what the [hidden] probe in claims.spec.ts checks.
  await expect(page.locator('#panel-schedule')).toBeVisible();
  for (const id of ['decay', 'naive', 'slice', 'recover', 'trials', 'defends']) {
    await expect(page.locator(`#panel-${id}`)).toBeHidden();
  }
  await expect(page.locator('#tab-schedule')).toHaveAttribute('aria-selected', 'true');

  // The schedule grid arrives fully painted: 176 byte cells plus the key row's
  // own 16 are the same cells, so the count is exactly 176.
  await expect(page.locator('#panel-schedule .byte')).toHaveCount(176);

  // Nothing is selected for inspection on arrival.
  await expect(page.locator('#panel-schedule .byte[aria-pressed="true"]')).toHaveCount(0);

  // ── The shipped control defaults, as SHAPES ─────────────────────────────
  await page.getByRole('tab', { name: /Decay/ }).click();
  // A percentage, not a particular percentage.
  await expect(page.locator('#decay-d0')).toHaveValue(/^\d{1,2}$/);
  await expect(page.locator('#decay-d1')).toHaveValue(/^0(\.\d+)?$/);
  await expect(page.locator('#decay-source')).toHaveValue(/^[a-z-]+$/);
  await expect(page.locator('#panel-decay .byte')).toHaveCount(176);

  // The recovery exhibit arrives with a verdict marker present and idle — a
  // marker, not a wording.
  await page.getByRole('tab', { name: /Full Recovery/ }).click();
  await expect(page.locator('#panel-recover [data-verdict]')).toHaveCount(1);
  await expect(page.locator('#panel-recover [data-verdict="idle"]')).toHaveCount(1);
  await expect(page.locator('#panel-recover [data-claim="negative-claim"]')).toHaveCount(0);

  // No disclosure ships open.
  await expect(page.locator('details[open]')).toHaveCount(0);

  // Reload, so the drive starts where a READER starts rather than where these
  // assertions left off. Checking the shipped defaults meant clicking three
  // tabs, and that leaves focus on a tab button -- which moves Chromium's
  // sequential focus navigation starting point, so the drive's first step
  // (Tab reaches the skip link) would be testing the wrong thing and failing
  // for a reason that teaches nothing about the page.
  await page.goto('.');
  await expect(page.locator('#tab-schedule')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-schedule')).toBeVisible();

  await settle(page);
  await expectNotBlank(page, 'first paint');
}

// ── The drive ───────────────────────────────────────────────────────────────

/** Switch to a tab by clicking it, and prove the switch happened. */
async function openTab(page: Page, name: RegExp, panelId: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(panelId)).toBeVisible();
  await expect(page.locator(panelId)).not.toBeEmpty();
}

/** Set the decay slider to a whole percentage and wait for the page to follow. */
async function setDecay(page: Page, percent: number): Promise<void> {
  await page.locator('#decay-d0').fill(String(percent));
  await page.locator('#decay-d0').dispatchEvent('input');
  await expect(page.locator('#panel-decay .slider-value')).toContainText(`${percent}%`);
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Five things shape this drive:
 *
 *  - THE ARRIVAL STATE IS SCANNED FIRST, exactly as a reader gets it: the
 *    schedule grid painted, six panels hidden, nothing selected, no verdict.
 *
 *  - EVERY EXHIBIT IS DRIVEN THROUGH ITS REAL CONTROLS. Tabs are clicked, the
 *    slider is dragged, the slice stepper is stepped. Nothing is revealed from
 *    script, because a state reached from script is a state no reader can get
 *    to and axe will happily scan it instead of the real one.
 *
 *  - EVERY FAILURE AND REFUSAL STATE. The states this lab most needs scanned
 *    are the ones where the attack does NOT work: the random-bytes image,
 *    where the page must say no consistent key exists; the retired verdict,
 *    where changing the decay withdraws a standing verdict; and zero decay,
 *    where nothing was lost at all. None of these is reachable without
 *    deliberately steering the page into them.
 *
 *  - HOVER IS A STATE, AND IT PERSISTS AFTER A CLICK. `:hover` stays on the
 *    element under the pointer after `page.click()` resolves, so it is the
 *    state a reader occupies the instant after pressing a button — and
 *    `.tab-btn:hover`, `.action:hover` and `.byte:hover` all repaint. Scanned
 *    explicitly.
 *
 *  - NO FIXED TIMEOUTS. Every wait is on a real DOM completion signal: a
 *    verdict marker appearing, a step counter, `aria-selected`, `aria-pressed`.
 */
export async function driveAllStates(page: Page, label: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${label} / ${s}`);

  await scanAt('arrival: the schedule grid, six panels hidden, nothing inspected');

  // ── The shared skip link, focused ───────────────────────────────────────
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('the shared skip link focused, slid in from top:-3rem');

  // ── Exhibit 1: the expanded key ─────────────────────────────────────────
  // A key byte: determined by nothing, which is its own branch in the panel.
  await page.locator('#panel-schedule .byte[data-index="0"]').click();
  await expect(page.locator('#panel-schedule .byte[data-index="0"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await scanAt('schedule: a KEY byte inspected — determined by nothing');

  // A byte of round key 1 reached through the key-schedule core: an S-box
  // input and a round constant, with its inputs outlined in the grid.
  await page.locator('#panel-schedule .byte[data-index="16"]').click();
  await expect(page.locator('#panel-schedule .byte.is-input')).not.toHaveCount(0);
  await expect(page.locator('#panel-schedule .bits li')).toHaveCount(8);
  await scanAt('schedule: a core byte inspected — S-box input and round constant outlined');

  // A byte that is a plain running XOR, which is the other relation branch.
  await page.locator('#panel-schedule .byte[data-index="20"]').click();
  await expect(page.locator('#panel-schedule .byte.is-input')).not.toHaveCount(0);
  await scanAt('schedule: a running-XOR byte inspected');

  // Hover persists on the cell just clicked.
  await page.locator('#panel-schedule .byte[data-index="21"]').hover();
  await scanAt('schedule: a byte cell hovered');

  // ── Exhibit 2: decay ────────────────────────────────────────────────────
  await openTab(page, /Decay/, '#panel-decay');
  await scanAt('decay: arrival at the default decay');

  await setDecay(page, 0);
  await expect(page.locator('#panel-decay .stat-strip')).toContainText('0');
  await scanAt('decay: ZERO decay — the image is the schedule and nothing was lost');

  await setDecay(page, 30);
  await scanAt('decay: 30 per cent — the heaviest the exhibits are measured at');

  await setDecay(page, 40);
  await scanAt('decay: 40 per cent — the top of the control');

  // The wrong-way rate, which turns the hard test into a ranked search and
  // adds a third glyph to the grid legend.
  await page.locator('#decay-d1').selectOption('0.001');
  await expect(page.locator('#panel-decay .legend')).toContainText('wrong way');
  await scanAt('decay: wrong-way flips enabled — the third damage glyph appears');

  // A byte inspected in the image, which is the bits view in its damaged form.
  await page.locator('#panel-decay .byte[data-index="40"]').click();
  await expect(page.locator('#panel-decay .bits li')).toHaveCount(8);
  await scanAt('decay: one image byte inspected, bit by bit');

  // The two fixed images, each with its own numbers card.
  await page.locator('#decay-source').selectOption('fixed-heavy');
  await expect(page.locator('#panel-decay')).toContainText('SHA-256');
  await scanAt('decay: the T = 77 fixed image, with its published fingerprints');

  await page.locator('#decay-source').selectOption('fixed-light');
  await scanAt('decay: the T = 38 fixed image');

  // Random bytes: no key behind them, so the panel takes its no-truth branch.
  await page.locator('#decay-source').selectOption('noise');
  await expect(page.locator('#panel-decay')).toContainText('random bytes');
  await scanAt('decay: 176 random bytes — no stored schedule to have lost anything');

  await page.locator('#decay-source').selectOption('random');
  await setDecay(page, 15);
  await page.locator('#decay-d1').selectOption('0');

  // ── Exhibit 3: the naive search ─────────────────────────────────────────
  await openTab(page, /Naive Search/, '#panel-naive');
  await expect(page.locator('#panel-naive [data-claim="naive-count"]')).toContainText('2^');
  await scanAt('naive: the superset count for the current image');

  // The same exhibit with no key behind the image, which drops the
  // known-loss-count row to a dash.
  await openTab(page, /Decay/, '#panel-decay');
  await page.locator('#decay-source').selectOption('noise');
  await openTab(page, /Naive Search/, '#panel-naive');
  await scanAt('naive: the count for an image with no key behind it');

  await openTab(page, /Decay/, '#panel-decay');
  await page.locator('#decay-source').selectOption('random');

  // ── Exhibit 4: one slice, stepped ───────────────────────────────────────
  await openTab(page, /One Slice/, '#panel-slice');
  await scanAt('slice: nothing run yet');

  await page.locator('#slice-run').click();
  await expect(page.locator('#panel-slice [data-claim="slice-enumerated"]')).toBeVisible();
  await scanAt('slice: step 1 — the four key bytes enumerated');

  await page.locator('#slice-run').click();
  await expect(page.locator('#panel-slice [data-claim="slice-after-rk1"]')).toBeVisible();
  await scanAt('slice: step 2 — the hard test on round key 1');

  await page.locator('#slice-run').click();
  await expect(page.locator('#panel-slice [data-claim="slice-after-rk2"]')).toBeVisible();
  await scanAt('slice: step 3 — the chain carried to round key 2');

  await page.locator('#slice-run').click();
  await page.locator('#slice-run').click();
  await expect(page.locator('#panel-slice [data-claim="slice-final"]')).toBeVisible();
  await expect(page.locator('#slice-run')).toBeDisabled();
  await scanAt('slice: every step revealed and the stepper exhausted');

  // Changing the slice resets the stepper, which is its own rendering.
  await page.locator('#slice-pick').selectOption('2');
  await expect(page.locator('#panel-slice [data-claim="slice-final"]')).toHaveCount(0);
  await scanAt('slice: a different slice selected, the stepper reset');

  // ── Exhibit 5: full recovery ────────────────────────────────────────────
  await openTab(page, /Full Recovery/, '#panel-recover');
  await expect(page.locator('#panel-recover [data-verdict="idle"]')).toHaveCount(1);
  await scanAt('recover: idle, nothing run');

  await page.locator('#recover-run').click();
  await expect(page.locator('#panel-recover [data-verdict="recovered"]')).toHaveCount(1);
  await expect(page.locator('#panel-recover [data-claim="recovered-key"]')).toBeVisible();
  await expect(page.locator('#panel-recover [data-claim="stage-table"]')).toBeVisible();
  await scanAt('recover: THE ALARM — a key rebuilt from the damaged image alone');

  // Hover persists on the button just pressed.
  await page.locator('#recover-run').hover();
  await scanAt('recover: the run button hovered after a recovery');

  // Retirement: changing the decay has to WITHDRAW the verdict, not leave it
  // standing. This is the state the claims suite asserts the wording of.
  await openTab(page, /Decay/, '#panel-decay');
  await setDecay(page, 25);
  await openTab(page, /Full Recovery/, '#panel-recover');
  await expect(page.locator('#panel-recover [data-verdict="idle"]')).toHaveCount(1);
  await expect(page.locator('#panel-recover [data-claim="recovered-key"]')).toHaveCount(0);
  await scanAt('recover: the verdict RETIRED after the decay changed');

  // The refusal branch: an image that is not a decayed schedule at all. The
  // page must say no consistent key exists, and must not report a recovery.
  await openTab(page, /Decay/, '#panel-decay');
  await page.locator('#decay-source').selectOption('noise');
  await openTab(page, /Full Recovery/, '#panel-recover');
  await page.locator('#recover-run').click();
  await expect(page.locator('#panel-recover [data-verdict="no-consistent-key"]')).toHaveCount(1);
  await expect(page.locator('#panel-recover [data-claim="recovered-key"]')).toHaveCount(0);
  await scanAt('recover: 176 random bytes — no consistent key exists, and none is claimed');

  // The negative-claim evidence fixture: the T = 77 fixed image, where the key
  // bytes are visibly wrecked and the key comes back anyway.
  await openTab(page, /Decay/, '#panel-decay');
  await page.locator('#decay-source').selectOption('fixed-heavy');
  await openTab(page, /Full Recovery/, '#panel-recover');
  await page.locator('#recover-run').click();
  await expect(page.locator('#panel-recover [data-verdict="recovered"]')).toHaveCount(1);
  await expect(page.locator('#panel-recover [data-claim="negative-claim"]')).toBeVisible();
  await scanAt('recover: the negative-claim fixture — 25 key bits lost and the key recovered');

  // ── Exhibit 6: many keys ────────────────────────────────────────────────
  await openTab(page, /Many Keys/, '#panel-trials');
  await scanAt('trials: nothing measured yet');

  await page.locator('#trials-count').selectOption('20');
  await page.locator('#trials-run').click();
  // A real completion signal: the measured table fills in a recovered count.
  await expect(page.locator('#panel-trials [data-claim="trials-measured"]')).toContainText(
    'Recovered',
    { timeout: 120_000 },
  );
  await expect(page.locator('#trials-run')).toBeEnabled({ timeout: 120_000 });
  await scanAt('trials: twenty keys measured in this browser, beside the reference figures');

  // ── Exhibit 7: what defends ─────────────────────────────────────────────
  await openTab(page, /What Defends/, '#panel-defends');
  await scanAt('defends: the paper countermeasures, with their limits');

  // ── Keyboard operation of the tablist ───────────────────────────────────
  await page.getByRole('tab', { name: /What Defends/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /The Expanded Key/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await scanAt('tablist: ArrowRight wrapped round to the first tab, focused');

  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /What Defends/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await scanAt('tablist: End jumped to the last tab, focused');

  // ── A scroll region focused, which is the keyboard route into the grid ──
  await openTab(page, /The Expanded Key/, '#panel-schedule');
  await page.locator('#panel-schedule .grid-scroll').first().focus();
  await scanAt('schedule: the grid scroll region focused — the keyboard route into it');
}
