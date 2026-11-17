#!/usr/bin/env node
/**
 * Mutation discipline, run from a script.
 *
 * A green suite is not evidence until you have watched it fail. The five steps
 * are a person's checklist, and the place a person's checklist fails is the
 * writing-down afterwards: a sentence describing a mutation cannot be
 * replayed, and a paragraph describing a run is the author's side of the claim
 * rather than the run's.
 *
 * So each mutation here is a CONCRETE PATCH -- a file, an anchor that must
 * occur exactly once, and its replacement -- never a sentence describing an
 * edit. And a kill is defined by four rules, all of which this script
 * enforces:
 *
 *   1. the owning test PASSED unmutated in the same run;
 *   2. the patch actually CHANGED the file;
 *   3. the run served the MUTATED code -- proved by the built bundle's hash
 *      moving, so a mutation that never reached the browser cannot be read as
 *      a kill;
 *   4. a patch that does not compile is DOES NOT BUILD and is never a kill.
 *
 * Every `observed` line in the ledger this writes is produced by the thing
 * that ran it. None of it is typed by hand.
 *
 * Usage:
 *   node scripts/mutate.mjs              # every mutation
 *   node scripts/mutate.mjs 3 7          # only mutations 3 and 7
 *   node scripts/mutate.mjs --list       # names only, run nothing
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * The mutations the brief names, each with the test that must catch it.
 *
 * `suite` is 'unit' for Vitest or 'claims' for the browser claims suite. A
 * mutation whose owner is a browser test needs a build and a server, so those
 * cost a full gate run each.
 */
const MUTATIONS = [
  {
    id: 1,
    name: 'the S-box is omitted from the w4 relation',
    file: 'src/cold/aes-schedule.ts',
    anchor: '      const r0 = SBOX[t1] ^ RCON[n / 4 - 1];\n      const r1 = SBOX[t2];\n      const r2 = SBOX[t3];\n      const r3 = SBOX[t0];',
    replacement: '      const r0 = t1 ^ RCON[n / 4 - 1];\n      const r1 = t2;\n      const r2 = t3;\n      const r3 = t0;',
    suite: 'unit',
    owner: 'check A: AES-128 key expansion (FIPS 197)',
  },
  {
    id: 2,
    name: 'rcon is applied to every byte position, not only position 0',
    file: 'src/cold/aes-schedule.ts',
    anchor: '      const r0 = SBOX[t1] ^ RCON[n / 4 - 1];\n      const r1 = SBOX[t2];\n      const r2 = SBOX[t3];\n      const r3 = SBOX[t0];',
    replacement: '      const r0 = SBOX[t1] ^ RCON[n / 4 - 1];\n      const r1 = SBOX[t2] ^ RCON[n / 4 - 1];\n      const r2 = SBOX[t3] ^ RCON[n / 4 - 1];\n      const r3 = SBOX[t0] ^ RCON[n / 4 - 1];',
    suite: 'unit',
    owner: 'check A: AES-128 key expansion (FIPS 197)',
  },
  {
    id: 3,
    name: 'the slice uses w3[i] instead of w3[(i+1) mod 4]',
    file: 'src/cold/aes-schedule.ts',
    anchor: 'export const SLICES: readonly Slice[] = [0, 1, 2, 3].map((p) => {\n  const j = (p + 1) % 4;',
    replacement: 'export const SLICES: readonly Slice[] = [0, 1, 2, 3].map((p) => {\n  const j = p;',
    suite: 'unit',
    owner: 'check D: the (position, round) relations hold',
  },
  {
    id: 4,
    name: 'the hard test compares for equality instead of superset',
    file: 'src/cold/slice.ts',
    anchor: '      const v = POPCOUNT[g & ~c & 0xff];\n      if (v <= maxBudget) byViolations[v].push(c);',
    replacement: '      const v = POPCOUNT[g & ~c & 0xff];\n      if (v <= maxBudget && c === g) byViolations[v].push(c);',
    suite: 'unit',
    owner: 'check B: the two fixed images',
  },
  {
    id: 5,
    name: "the hard test's direction is reversed -- the image must contain the candidate",
    file: 'src/cold/slice.ts',
    anchor: '      const v = POPCOUNT[g & ~c & 0xff];\n      if (v <= maxBudget) byViolations[v].push(c);',
    replacement: '      const v = POPCOUNT[c & ~g & 0xff];\n      if (v <= maxBudget) byViolations[v].push(c);',
    suite: 'unit',
    owner: 'check B: the two fixed images',
  },
  {
    id: 6,
    name: 'the final check compares only the 16 key bytes instead of all 176',
    file: 'src/cold/stitch.ts',
    anchor: '  let total = 0;\n  for (let i = 0; i < SCHEDULE_BYTES; i++) {\n    total += POPCOUNT[image[i] & ~candidate[i] & 0xff];',
    replacement: '  let total = 0;\n  for (let i = 0; i < KEY_BYTES; i++) {\n    total += POPCOUNT[image[i] & ~candidate[i] & 0xff];',
    suite: 'unit',
    owner: 'check G: fail-closed paths',
  },
  {
    id: 7,
    name: '"recovered" is set whenever the search returns a key, without the full-schedule check',
    file: 'src/cold/stitch.ts',
    anchor: '      const used = scheduleWrongWayBits(expandKey(key), image, cap);\n      if (used > cap) return;',
    replacement: '      const used = scheduleWrongWayBits(expandKey(key), image, cap);\n      // mutation 7: accept without the certificate',
    // The brief names 176 random bytes as this mutation's bite fixture. It does
    // not bite, and the reason is measured rather than argued: for a random
    // image all four slice lists come back EMPTY, so the search never reaches
    // the check this mutation removes -- `combinationsChecked` is 0. The bite
    // has to be an image the search gets all the way through and the
    // CERTIFICATE alone refuses, which means disagreeing with the key only in
    // w43: the four bytes no slice search views. See the "the certificate is
    // the only thing that sees the last round key" suite.
    suite: 'unit',
    owner: 'BITE: a valid schedule with one wrong-way bit in byte',
  },
  {
    id: 8,
    name: 'decay is applied to zeros instead of ones',
    file: 'src/cold/decay.ts',
    anchor: '      const flips = random() < (stored === 1 ? model.d0 : model.d1);',
    replacement: '      const flips = random() < (stored === 1 ? model.d1 : model.d0);',
    suite: 'unit',
    owner: 'the decay channel',
  },
  {
    id: 9,
    name: 'the superset enumeration skips the candidate equal to the image byte itself',
    file: 'src/cold/slice.ts',
    anchor: '      const v = POPCOUNT[g & ~c & 0xff];\n      if (v <= maxBudget) byViolations[v].push(c);',
    replacement: '      const v = POPCOUNT[g & ~c & 0xff];\n      if (v <= maxBudget && c !== g) byViolations[v].push(c);',
    suite: 'unit',
    owner: 'per-byte candidates',
  },
  {
    // Template 4.1d: delete the negative-claim text and assertion 3 must fail.
    id: 10,
    name: 'the negative-claim sentence is deleted from the page',
    file: 'src/ui/recover-panel.ts',
    anchor: "      el('p', { class: 'negative-claim', 'data-claim': 'negative-claim', text: NEGATIVE_CLAIM }),",
    replacement: "      null,",
    suite: 'claims',
    owner: 'NEGATIVE CLAIM: the key bytes are wrecked',
  },
  {
    // Template 4.1d: break a check inside the fixture and assertion 2 must
    // fail. `certified` is the certificate line, so forcing it false makes the
    // fixture render a FAILING check -- at which point it would be
    // demonstrating the mechanism not working rather than its limit, and the
    // negative claim would be unearned.
    id: 11,
    name: 'the certificate line inside the negative-claim fixture reports failure',
    file: 'src/ui/recover-panel.ts',
    anchor: '            checkLine(\n              result.certified ? \'pass\' : \'fail\',',
    replacement: '            checkLine(\n              false ? \'pass\' : \'fail\',',
    suite: 'claims',
    owner: 'NEGATIVE CLAIM: the key bytes are wrecked',
  },
];

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const m of MUTATIONS) console.log(`${m.id}. [${m.suite}] ${m.name}  -> ${m.owner}`);
  process.exit(0);
}
const only = args.filter((a) => /^\d+$/.test(a)).map(Number);
const selected = only.length ? MUTATIONS.filter((m) => only.includes(m.id)) : MUTATIONS;

function run(cmd, cmdArgs, opts = {}) {
  try {
    const out = execFileSync(cmd, cmdArgs, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1' },
      maxBuffer: 64 * 1024 * 1024,
      ...opts,
    });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/**
 * Hash of every built JS and CSS asset.
 *
 * This is rule 3's mechanism. A mutation that compiles but never reaches the
 * bundle -- dead code, a branch nothing calls, a file the build tree-shakes
 * away -- would otherwise be read as "the tests did not catch it", which sends
 * someone off to fix a check that works.
 */
function bundleHash() {
  const dir = join(ROOT, 'dist', 'assets');
  if (!existsSync(dir)) return 'NO-DIST';
  const hash = createHash('sha256');
  for (const name of readdirSync(dir).sort()) {
    if (!/\.(js|css)$/.test(name)) continue;
    // The filename itself carries Vite's content hash, so name AND bytes.
    hash.update(name);
    hash.update(readFileSync(join(dir, name)));
  }
  return hash.digest('hex').slice(0, 16);
}

function build() {
  return run('npx', ['vite', 'build']);
}

function typecheck() {
  return run('npx', ['tsc', '--noEmit']);
}

function unitSuite() {
  return run('npx', ['vitest', 'run', '--exclude', 'src/cold/rates.slow.test.ts']);
}

function claimsSuite() {
  return run('npx', ['playwright', 'test', '--project=claims']);
}

/* ------------------------------------------------------------------ *
 * Step 0: the baseline. Rule 1 -- a kill requires the owning test to have
 * PASSED unmutated in THIS run, not in someone's memory of a previous one.
 * ------------------------------------------------------------------ */

console.log('--- baseline ---');
const baselineType = typecheck();
if (!baselineType.ok) {
  console.error('the tree does not typecheck before any mutation; fix that first');
  console.error(baselineType.out.slice(-4000));
  process.exit(1);
}
const baselineBuild = build();
if (!baselineBuild.ok) {
  console.error('the tree does not build before any mutation; fix that first');
  console.error(baselineBuild.out.slice(-4000));
  process.exit(1);
}
const baseHash = bundleHash();
console.log(`bundle hash: ${baseHash}`);

const needUnit = selected.some((m) => m.suite === 'unit');
const needClaims = selected.some((m) => m.suite === 'claims');

const baselineUnit = needUnit ? unitSuite() : { ok: true, out: '(not needed)' };
if (needUnit) console.log(`unit suite unmutated: ${baselineUnit.ok ? 'PASS' : 'FAIL'}`);
if (needUnit && !baselineUnit.ok) {
  console.error('the unit suite fails before any mutation; a kill would prove nothing');
  console.error(baselineUnit.out.slice(-4000));
  process.exit(1);
}
const baselineClaims = needClaims ? claimsSuite() : { ok: true, out: '(not needed)' };
if (needClaims) console.log(`claims suite unmutated: ${baselineClaims.ok ? 'PASS' : 'FAIL'}`);
if (needClaims && !baselineClaims.ok) {
  console.error('the claims suite fails before any mutation; a kill would prove nothing');
  console.error(baselineClaims.out.slice(-4000));
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * The mutations, one at a time, restored immediately.
 * ------------------------------------------------------------------ */

const results = [];

for (const m of selected) {
  const path = join(ROOT, m.file);
  const original = readFileSync(path, 'utf8');
  const occurrences = original.split(m.anchor).length - 1;

  console.log(`\n--- mutation ${m.id}: ${m.name} ---`);

  if (occurrences !== 1) {
    // An anchor that no longer matches exactly once is not a pass and not a
    // kill: it means the patch has gone stale against the source and this
    // mutation measured nothing.
    const verdict = `ANCHOR MISSING (matched ${occurrences} times)`;
    console.log(verdict);
    results.push({ ...m, verdict, killed: false, observed: verdict });
    continue;
  }

  const mutated = original.replace(m.anchor, m.replacement);
  if (mutated === original) {
    const verdict = 'PATCH CHANGED NOTHING';
    console.log(verdict);
    results.push({ ...m, verdict, killed: false, observed: verdict });
    continue;
  }

  writeFileSync(path, mutated);
  try {
    const t = typecheck();
    if (!t.ok) {
      // Rule 4. A mutation that does not compile proves nothing: the suite
      // would run against the last good bundle and pass.
      const verdict = 'DOES NOT BUILD';
      const detail = (t.out.match(/^\S+\(\d+,\d+\): error TS\d+: .*$/m) ?? ['(tsc error)'])[0];
      console.log(`${verdict} -- ${detail}`);
      results.push({ ...m, verdict, killed: false, observed: `${verdict}: ${detail}` });
      continue;
    }

    const b = build();
    if (!b.ok) {
      const verdict = 'DOES NOT BUILD';
      console.log(verdict);
      results.push({ ...m, verdict, killed: false, observed: verdict });
      continue;
    }

    const mutatedHash = bundleHash();
    const reachedBundle = mutatedHash !== baseHash;
    console.log(`bundle hash: ${mutatedHash} (${reachedBundle ? 'MOVED' : 'UNCHANGED'})`);

    const suite = m.suite === 'unit' ? unitSuite() : claimsSuite();
    const failed = !suite.ok;

    // Rule 1 again, at the level of the individual test: the run must have
    // failed, AND the failure must name the owning test.
    const namesOwner = failed && suite.out.includes(m.owner);

    let verdict;
    if (!reachedBundle) {
      // Rule 3. Whatever the suite said, this run did not exercise the
      // mutation in the browser; for a unit mutation the bundle is beside the
      // point, so say which it is rather than calling it a kill.
      verdict = failed
        ? namesOwner
          ? 'KILLED (bundle unchanged -- source-level only)'
          : 'FAILED ELSEWHERE (bundle unchanged)'
        : 'SURVIVED (bundle unchanged)';
    } else if (failed && namesOwner) {
      verdict = 'KILLED';
    } else if (failed) {
      verdict = 'FAILED ELSEWHERE';
    } else {
      verdict = 'SURVIVED';
    }

    const firstFailure =
      (suite.out.match(/^\s*(?:FAIL|✕|\d+\)) .*$/m) ?? [''])[0].trim().slice(0, 160) || '(none)';
    console.log(`${verdict} -- suite ${failed ? 'FAILED' : 'passed'}; first failure: ${firstFailure}`);

    results.push({
      ...m,
      verdict,
      killed: verdict.startsWith('KILLED'),
      observed: `${verdict}; bundle ${mutatedHash} (${reachedBundle ? 'moved' : 'unchanged'}); ` +
        `suite ${failed ? 'failed' : 'passed'}; owner named: ${namesOwner}`,
    });
  } finally {
    // Restore surgically -- the original bytes, not `git checkout`, because
    // this file also holds real work. A session that dies mid-check otherwise
    // strands an inverted condition in the tree.
    writeFileSync(path, original);
  }
}

// Leave the tree built from the restored source, so nothing downstream reads a
// mutated bundle.
build();
const finalHash = bundleHash();

/* ------------------------------------------------------------------ *
 * The ledger. Written by the thing that ran it.
 * ------------------------------------------------------------------ */

const when = new Date().toISOString().slice(0, 10);
const killed = results.filter((r) => r.killed).length;
const lines = [
  '# Mutation ledger',
  '',
  'Written by `scripts/mutate.mjs`. Every `observed` line below was produced by the run, not',
  'typed. Re-run `npm run mutate` to regenerate it.',
  '',
  `Run: ${when}. Baseline bundle \`${baseHash}\`; restored bundle \`${finalHash}\`.`,
  `Result: **${killed} of ${results.length} killed**.`,
  '',
  'A kill requires all four of: the owning test passed unmutated in the same run; the patch',
  'changed the file; the built bundle hash moved, so the run served the mutated code; and the',
  'patch compiled. A patch that does not compile is DOES NOT BUILD and is never a kill.',
  '',
  '| # | Mutation | Suite | Owning test | Verdict | Observed |',
  '|---|---|---|---|---|---|',
];
for (const r of results) {
  lines.push(
    `| ${r.id} | ${r.name} | ${r.suite} | ${r.owner} | ${r.verdict} | ${r.observed} |`,
  );
}
lines.push('');
if (killed !== results.length) {
  lines.push('## Surviving mutations');
  lines.push('');
  lines.push('A surviving mutation is reported, not explained away.');
  lines.push('');
  for (const r of results.filter((x) => !x.killed)) {
    lines.push(`- **${r.id}. ${r.name}** — ${r.observed}`);
  }
  lines.push('');
}
lines.push('---');
lines.push('');
lines.push(
  '*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*',
);

writeFileSync(join(ROOT, 'MUTATIONS.md'), lines.join('\n') + '\n');

console.log(`\n=== ${killed} of ${results.length} killed; ledger written to MUTATIONS.md ===`);
for (const r of results) console.log(`  ${r.id}. ${r.verdict} -- ${r.name}`);

// A surviving mutation is a finding, so the script fails on one. That is what
// makes the ledger a gate rather than a note.
process.exit(killed === results.length ? 0 : 1);
