# Build brief — crypto-lab-cold-boot

Written 15 November 2026. Paste this whole file to the coding agent, or save it as `brief.md`
in the new repo. It is self-contained apart from `_MASTER-TEMPLATE.md`, which must be in the
repo root (or readable at `audits/_MASTER-TEMPLATE.md` in the crypto-lab catalog repo).

The source paper is on the owner's machine at
`~/Downloads/crypto-lab-brief-sources/crypto-lab-cold-boot/`. Read it there; do not search
the web for copies, do not copy the PDF into the repo, do not commit it.

---

## KICKOFF (read this first)

Build a new Crypto Lab browser demo (Vite + TypeScript, static site, no backend) in the
repository **`crypto-lab-cold-boot`**.

Read `_MASTER-TEMPLATE.md` in full and treat it as the BINDING spec for build, teaching,
look, accessibility, README and deploy. If `audits/kickoff.md` has been given to you, it
governs how you work inside this repo. This brief supplies only the demo-specific facts and
the acceptance checks. Where the template and this brief disagree on build/teach/look/a11y,
the template wins. Where this brief states cryptographic facts, check them against the cited
primary source and by computation; if you find one wrong, do not silently deviate: write
"Brief said X; that is wrong because Y (source or computation)" in your report and build the
correct thing.

Build to every standard in the template, in its order: §1 Build, §3 Look, §2 Teach,
§4 Accessibility (including §4.1a setup rules, §4.1b claims suite, §4.1c mutation
discipline run from a script, §4.1d negative claim), §5 README, §6 Deploy with §6.1 and §6.2.

Hard rules (from the template; repeated because they are the ones that get broken):
real computation only, never a canned or simulated verdict; honest scoping in the page and
the README; do NOT weaken a gate to get a green run; if something cannot pass honestly,
leave it failing and say so. Do not touch the shared catalog files. Copy the top bar from an
existing lab. Copy the accessibility gate and `claims.spec.ts` shape from
`crypto-lab-schnorr-forge` and rewrite every lab-specific passage.

When done, report: one-line summary with the test count; the mutation ledger (each mutation,
killed or not); the recovery rates and times your build measures (FACTS 6) beside the
brief's; confirmation that grouping / auto-merge / PR gate / workflow_dispatch are all
present; and the card metadata listed at the end of this brief.

---

## NEW DEMO BRIEF

- Repo name:         crypto-lab-cold-boot
- Short name (H1):   Cold Boot
- Subtitle:          Decayed memory · AES key schedule as an error-correcting code · key recovery
- One-liner:         Browser-based cold-boot key recovery — a real AES-128 key schedule decayed bit by bit towards a ground state the way memory fades after power loss, then the key rebuilt from the damaged image by using the schedule's own redundancy, at 15% and 30% decay, beside the naive search that the same damage makes hopeless
- Concept to teach:  A cipher's expanded key is a long, highly redundant encoding of a short secret. When stored bits fail mostly in one direction, that redundancy lets an attacker correct the errors and certify the answer with no plaintext or ciphertext at all, so "the memory image was damaged" is not a defence.
- Primitives/spec:   J. A. Halderman, S. D. Schoen, N. Heninger, W. Clarkson, W. Paul, J. A. Calandrino, A. J. Feldman, J. Appelbaum, E. W. Felten, "Lest We Remember: Cold Boot Attacks on Encryption Keys" (USENIX Security 2008), sections 5.1 and 5.2 (confirm the author list and venue on the paper's title page). AES-128 key expansion (FIPS 197).
- Accent (--accent): #e6c229   (not used by any of the 203 labs whose accent is recorded in the 12 November 2026 snapshot; confirm against the live catalog and against neighbouring cards)
- Favicon emoji:     🧊
- In scope:          see SCOPE below
- Non-goals:         see SCOPE below

GitHub "About" line: use the one-liner above.

---

## PRE-FLIGHT (verify, do not assume)

1. Confirm the repository name is free under `systemslibrarian` and no catalog card is titled
   "Cold Boot".
2. In the catalog repo, search `CATALOG.md` and the lab READMEs for `cold boot`, `cold-boot`,
   `remanence`, `memory decay`, `key schedule reconstruction`. What the brief author found
   (12 November 2026 snapshot): no lab mentions cold-boot attacks. If one does, STOP and
   report. Link the AES internals lab (it has the real key schedule), the disk-encryption
   lab and the side-channel labs you actually find under Related Demos.
3. Playwright port: ask the catalog tool (`node tools/port-sync.js` in the catalog repo). If you
   cannot reach the catalog repo, stop and ask the owner for a port. Never 4173.

---

## SOURCES AND WHAT EACH IS FOR

- **The 2008 paper** (in the sources folder). Read by the brief author and two helpers:
  section 1, parts of section 3 (decay), section 5.1 (the error model), section 5.2 (AES
  key reconstruction), the openings of 5.3 and 5.4. Its physical measurements (how fast
  real memory decays, at what temperature) are the paper's; this lab does NOT reproduce
  them and must not present its decay slider as a measurement.
- Later work on the same idea (RSA keys with erasures and errors, other ciphers' schedules)
  is in the owner's library and was not used. See EXTENSION SEAMS.

---

## FACTS (write tests from these, not from your code)

1. **Error model** (section 5.1). Each memory cell has a ground state. After power loss a
   cell holding the opposite value flips to the ground state with some probability d0 that
   grows with time; a flip away from the ground state is rare (the paper takes about 0.1%).
   This lab uses one ground state, 0, for every bit: a stored 1 becomes 0 with probability
   d0; a stored 0 becomes 1 with probability d1 (0 or 0.001). Real memory has regions with
   either ground state; say so.
2. **Why naive search fails** (section 5.2, opening). With 10% of the ones decayed, a
   256-bit key is expected to be about 12 bits away from its image, and there are more than
   2^56 ways to choose which. (Exact: C(140, 12) = 2^56.02 for 12 flips among 140 zeros.)
3. **The redundancy.** AES-128 expands 16 key bytes to 176. With round-key words w0 … w3 and
   w4 … w7, for byte position i: w4[i] = w0[i] ⊕ S(w3[(i+1) mod 4]) ⊕ rcon (rcon only for
   i = 0), w5[i] = w1[i] ⊕ w4[i], w6[i] = w2[i] ⊕ w5[i], w7[i] = w3[i] ⊕ w6[i]. So the four
   key bytes w0[i], w1[i], w2[i], w3[(i+1) mod 4] determine three bytes of the next round
   key: a seven-byte "slice" that depends on only four key bytes. The same relations chain
   through all ten round keys.
4. **Reconstruction** (section 5.2). For each slice, enumerate candidate values of its four
   key bytes in order of likelihood given the image, keep those whose derived bytes are
   consistent with the image, combine the slices, expand each surviving key fully and
   compare all 176 bytes with the image under the error model. In the pure one-way case
   (d1 = 0) "consistent" is a hard test: every true byte must contain every 1 bit of its
   image byte. With d1 > 0, allow a small number of wrong-way bits and raise that budget
   until a key passes the full-schedule test.
5. **No ciphertext needed.** The 176-byte comparison certifies the key.
6. **What two helpers measured** (15 November 2026; each recovered key compared with the
   true key; no wrong key was ever accepted):

   | Decay | Language | Keys recovered | Time per key |
   |---|---|---|---|
   | d0 = 0.15, d1 = 0 | JavaScript (Node) | 1000 / 1000 | mean 0.54 ms, 99th percentile 5.1 ms, max 67 ms |
   | d0 = 0.30, d1 = 0 | JavaScript (Node) | 500 / 500 | mean 16 ms, 99th percentile 147 ms, max 2.1 s |
   | d0 = 0.15, d1 = 0.001 | JavaScript (Node) | 200 / 200 with budget up to 3 | mean 16 ms, max 0.87 s |
   | d0 = 0.30, d1 = 0.001 | JavaScript (Node) | 200 / 200 with budget up to 3 | mean 0.82 s, 99th percentile 12 s, max 63 s |

   With d1 = 0.001 the hard test alone recovers only about half the keys (100 and 105 of
   200), because about half the images carry at least one wrong-way flip. Survivor counts at
   d0 = 0.15: median 512 candidates per seven-byte slice, median 16 after the second round
   key, one full key at the end; at d0 = 0.30: median 8,192 per slice, one full key at the
   end. An implementation that joins slices on only the four w7 bytes and expands every
   combination faces millions of candidates (median 2^26.7 at 15%); carrying the chain
   through later round keys inside each slice search is what makes it fast. The paper's own
   figures (keys at 15% in a fraction of a second; about half of keys at 30% within 30
   seconds) are for its implementation and its mixed-ground-state setting, and are not
   directly comparable.

---

## SCOPE

In scope, as exhibits in this order:

1. **The expanded key.** A key and its 176-byte schedule, with the relations of FACTS 3
   highlighted on demand ("which bytes determine this one?").
2. **Decay.** A decay control (0 to 40%), the wrong-way rate (0 or 0.1%), and the image:
   which bits were lost. Clearly labelled as a model.
3. **Naive search.** Count the zero bits in the image's 16 key bytes and the number of
   candidate keys that leaves; show why it is out of reach.
4. **One slice.** Step through a single slice: candidates enumerated, the hard test applied,
   survivors after one, two and three round keys.
5. **Full recovery.** Run the reconstruction in a worker; show survivors per stage, the
   recovered key, the full-schedule check, and the time.
6. **Many keys.** Recovery rate and time distribution over N random keys at the chosen
   decay, beside the table of FACTS 6.
7. **What defends.** One text panel, sourced from the paper's section on countermeasures
   (read it first): what it recommends and what it says does not help.

Non-goals (say so on the page and in the README): acquiring memory from a real machine;
decay physics; AES-192 and AES-256 schedules; DES, tweak keys and RSA private keys (all in
the paper; named, not built); any claim about a current operating system or disk-encryption
product.

---

## SECURITY / CORRECTNESS INVARIANTS

1. The key expansion is real AES-128 and passes FIPS 197 Appendix A.1 before anything else
   runs.
2. The reconstruction code receives the 176-byte image and the error-model parameters only
   (enforce by function signature; a test calls it with nothing else in scope).
3. "Recovered" is shown only when the returned key, re-expanded, is consistent with the
   whole image under the model AND, in the demo, equals the true key held by the page. The
   two conditions are reported separately so a learner sees that the first needs no secret.
4. Keys and decay draws come from `crypto.getRandomValues`; the fixed images of check B are
   used only in tests and behind a clearly labelled control.
5. The worker is cancellable and has a time budget; hitting it is reported as "not recovered
   within the budget", never as failure of the method.
6. Rates and times are measured, with N shown.

---

## ARCHITECTURE

Pure modules, no DOM: `aes-schedule.ts` (S-box, expansion), `decay.ts`, `slice.ts` (candidate
enumeration and the chained consistency test), `stitch.ts`, `reconstruct.ts`, `trials.ts`
(worker). Typed arrays throughout. The search is depth-first over supersets of each image
byte; do not materialise all candidates of a slice at 30% decay (millions).

---

## UI AND VISUAL SEMANTICS

Follow §3. The schedule as an 11 × 16 grid of bytes with row and column headers; lost bits
marked by a text glyph as well as colour; a "bits view" for one byte at a time. Stage
counts as a table. Times in milliseconds with the browser and machine not claimed as
typical.

---

## EDGE CASES (each fails closed and teaches via its message)

- Decay 0: the image is the schedule; recovery is immediate; the page says nothing was lost.
- Decay so high that the time budget is hit: "not recovered within the budget".
- An image that is not a decayed AES-128 schedule at all (random 176 bytes): no key is
  returned; the page says no consistent key exists under the model.
- Image length not 176 bytes: refused.
- Wrong-way flips present but budget 0: the hard test fails; the page explains why and
  offers the ranked search.

---

## EXTENSION SEAMS (shape now, do not build)

A `Schedule` interface (relations between stored bytes) so AES-256, DES or an RSA private-key
record could be added; a `GroundState` map for mixed ground states. Name both on the page as
"not built here".

---

## ACCEPTANCE CHECKS — expected outcomes, derived independently of any implementation

**A. Key expansion.** FIPS 197 Appendix A.1: key `2b7e151628aed2a6abf7158809cf4f3c`;
w4 = `a0fafe17`, w43 = `b6630ca6`; take the full table from FIPS 197 and test every word.
SHA-256 of the 176 schedule bytes = `2604b57171cdcd0f2e68a831e2354a9f0030a055491f01f7c62392d16e908e9c`
(brief author's computation). The schedule contains 720 one bits.

**B. Two fixed images** (built by the brief author from the schedule of check A with a
deterministic rule, and recovered with a helper's implementation). Rule: for byte index i
(0 … 175) and bit b (0 = least significant), if the bit is 1 and the first byte of
SHA-256(ASCII "decay" ‖ byte i ‖ byte b) is less than T, clear it.
- T = 38 (14.8%): 96 bits cleared; image key bytes `207c0516288a92a6abb6158809494f2c`;
  SHA-256 of the image `df2813a71468a70b33575a4ce30fe1152ce757d8d460bd192f672a801c0f9806`;
  14 of the key's bits are lost; the image's key bytes contain 77 zero bits.
- T = 77 (30.1%): 217 bits cleared; image key bytes `207c0506208292a0a286158009094f2c`;
  SHA-256 of the image `6e7a2943b7b85d3a2b4344407e936be11ee065e858465ce122428b4e90966bd1`;
  25 key bits lost; 88 zero bits in the key bytes.
Required: from each image alone the reconstruction returns `2b7e151628aed2a6abf7158809cf4f3c`.

**C. Naive counts.** For the two images the exhibit shows 2^77 and 2^88 superset candidates
for the 16 key bytes, and C(77, 14) = 2^49.6, C(88, 25) = 2^72.4 if the number of lost bits
were known. C(140, 12) = 2^56.02 for the paper's 256-bit example. Computed with BigInt.

**D. Relations.** For 1,000 random keys: every relation of FACTS 3 holds on the real
schedule; a slice's four key bytes reproduce its three derived bytes.

**E. Rates** (slow tests, tagged). d1 = 0: at d0 = 0.15, 200 of 200 random keys recovered,
each within 1 s; at d0 = 0.30, at least 198 of 200 within 5 s each and all 200 within the
budget. d1 = 0.001, d0 = 0.15, budget up to 3: 100 of 100. No wrong key ever returned (the
test holds the true keys).

**F. Mutations that must be killed (§4.1c, run from a script, each a concrete patch).**
(1) S-box omitted from the w4 relation; (2) rcon applied to every byte position; (3) the
slice uses w3[i] instead of w3[(i+1) mod 4]; (4) the hard test compares for equality instead
of superset (nothing is recovered from check B's images); (5) the hard test's direction
reversed (image must contain candidate); (6) the final check compares only the 16 key
bytes instead of all 176 (any superset of the image's key bytes then passes); (7) "recovered" set when the search returns any key, without the full-schedule
check (killed by the random-image edge case); (8) decay applied to zeros instead of ones;
(9) the superset enumeration skips the candidate equal to the image byte itself. A surviving
mutation is reported, not explained away.

**G. Fail-closed paths, each a NAMED test:** every item under EDGE CASES; invariants 2
and 3.

**H. Claims suite (§4.1b).** At minimum: the recovered key on screen, expanded by the
test's own key expansion, is a superset-consistent match for the image on screen; the count
of lost bits shown equals the test's count from the rendered schedule and image; the stage
counts shown are non-increasing after the first round key and end at the number of keys
shown; the naive-search exponent equals the number of zero bits the test counts in the
rendered image key bytes; stale verdicts are retired when the key, decay or image changes;
the no-op guard; the `[hidden]` probe.

---

## NEGATIVE CLAIM (§4.1d)

Claim, scoped to the image on the page: **"This image has lost bits in the key itself, and
a direct search for them is out of reach. That says nothing about whether the key is safe:
the rest of the schedule pinned it down, with no plaintext or ciphertext."**

Evidence fixture: exhibit 5 on the T = 77 image of check B. The naive count reads 2^88, the
key bytes differ from the true key in 25 bits, and the verdict reads
`25 KEY BITS LOST — AND THE KEY WAS RECOVERED FROM THE IMAGE ALONE`, with the negative-claim
sentence, the stage counts and the full-schedule check visible in that state.

Bite fixture for mutation (7): 176 random bytes as the "image". The page must say that no
consistent key exists and must not show the "recovered" clause. The three assertions and two
bite tests are as §4.1d specifies.

---

## README NOTES

Follow §5. "What It Is" names the attack, the error model as a model, AES-128 only, the
method, and "not production software — a teaching demo; nothing here reads real memory".
"When to Use It" must include a "do NOT": do not read the decay slider as a statement about
how long real memory holds data; cite the paper for that and for nothing more than it says.
"What Can Go Wrong" is the concept line. "Real-World Usage": only what the paper or another
primary source states about affected systems, with dates; it is a 2008 result, so say what
you can source about today and no more. "Build & Verify" states the test count, the FIPS 197
vector, the two fixed images with their SHA-256 values, the measured rates with N, and the
a11y gate. Credit the paper by title and authors, linking the publisher's page; no links to
PDF copies elsewhere.

---

## CARD METADATA TO REPORT BACK (for the catalog session; do not edit the catalog yourself)

Title: Cold Boot. Subtitle as above. Suggested categories: ATTACKS, SIDE CHANNELS or the
nearest existing category (confirm against the catalog's CATEGORIES). Suggested level:
intermediate. Chips: only what the source implements (AES-128 key expansion, one-way decay
model, key-schedule reconstruction). Accent #e6c229.

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
