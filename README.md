# Cold Boot

**Decayed memory · AES key schedule as an error-correcting code · key recovery**

Browser-based cold-boot key recovery — a real AES-128 key schedule decayed bit by bit towards a
ground state the way memory fades after power loss, then the key rebuilt from the damaged image by
using the schedule's own redundancy, at 15% and 30% decay, beside the naive search that the same
damage makes hopeless.

**[Live demo](https://systemslibrarian.github.io/crypto-lab-cold-boot/)**

---

## What It Is

An interactive demonstration of the AES key-recovery algorithm from J. Alex Halderman, Seth D.
Schoen, Nadia Heninger, William Clarkson, William Paul, Joseph A. Calandrino, Ariel J. Feldman,
Jacob Appelbaum and Edward W. Felten, *Lest We Remember: Cold Boot Attacks on Encryption Keys*,
17th USENIX Security Symposium, 2008 — sections 5.1 (the error model) and 5.2 (reconstructing AES
keys). The key expansion is AES-128 exactly as FIPS 197 specifies it.

**The problem.** A machine that has an encrypted disk mounted is holding the key in DRAM, and DRAM
does not forget the instant it loses power. An attacker who reboots the machine into their own
minimal kernel, or pulls the memory module and reads it elsewhere, gets a copy of what was in
memory — damaged, but a copy. The damage is what this lab is about.

**The security model.** The attacker has one damaged image of memory and nothing else. No plaintext,
no ciphertext, no decryption oracle, no knowledge of how many bits decayed. What they do have is the
*expanded* key: software keeps the 176-byte AES-128 key schedule in memory, because recomputing it
for every disk block would be slower. That expansion is a long, redundant encoding of a short
secret, and the attack is a decoding problem — find the valid key schedule closest to the damaged
image, under a channel that flips bits mostly in one direction.

**What is real.** The key expansion is real AES-128, generated from the GF(2⁸) inverse and the FIPS
197 affine transform rather than pasted as a table, and checked two ways: all 44 words of FIPS 197
Appendix A.1, and — independently — by building the AES cipher out of that expansion and matching
both the FIPS 197 Appendix C.1 vector and the platform's own AES over random keys. The decay draws
come from `crypto.getRandomValues`. The reconstruction is a real depth-first search over the image
the page is holding; there is no canned verdict anywhere in this lab. SHA-256 is this repo's own
implementation, checked against the FIPS 180-4 vectors and against WebCrypto.

**What is a model.** The decay. Each stored 1 bit is given a probability `d0` of having fallen to 0
and each stored 0 a much smaller probability `d1` of having flipped the other way, with **one ground
state, 0, for every bit**. Real memory has regions with either ground state, which is why the
paper's algorithms take the ground state of each cell as an input. The decay slider is a dial on
that model and **not a clock**: it says nothing about how long real memory holds data.

**What it does NOT prove.** That any particular system is vulnerable today. That the times here are
typical of anything. That a damaged memory image is safe — which is the point, and the lab's
negative claim says so on screen.

**Not production software — a teaching demo. Nothing here reads real memory, and nothing could: the
page decays a key schedule it generated itself, in a tab.**

---

## Exhibits

1. **The expanded key.** The 176-byte schedule as an 11 × 16 grid. Select any byte and the page
   shows which bytes determine it, prints the relation, and computes both sides so you can compare
   them rather than take them on faith. Key bytes are determined by nothing — they are the secret.
2. **Decay.** A decay control from 0 to 40%, a wrong-way rate of 0 or 0.1%, and the image: which
   bits were lost, marked with a text glyph as well as a colour. Two fixed images, built by a
   published deterministic rule, are available for reproducing the numbers below. An image of 176
   random bytes is available too, because the most important thing a verdict can do is not appear.
3. **Naive search.** The zero bits in the image's key bytes, and the number of keys that leaves —
   exact, in BigInt, beside the paper's own 256-bit example.
4. **One slice.** Step through a single slice of the search: the four key bytes enumerated, the hard
   test applied to round key 1, then the chain carried into round keys 2 and 3. This is the exhibit
   the lab exists for — the counts fall from hundreds of thousands to about one.
5. **Full recovery.** The whole reconstruction in a worker: survivors per stage, the recovered key,
   the full-schedule check, the measured time, and the wrong-way budget ladder when one is needed.
6. **Many keys.** Recovery rate and time distribution over N freshly drawn keys at the chosen decay,
   measured in your browser, beside the reference figures measured for the brief.
7. **What defends.** The paper's own countermeasures section, with its own limits — including the one
   this lab is about: precomputing the key schedule is a performance decision with a security cost.

---

## When to Use It

Use it to teach why redundancy in stored key material is an attacker's asset, to show a decoding
problem that needs no ciphertext at all, or to make the case for clearing key material and for
powering a laptop down rather than suspending it.

**Do NOT read the decay slider as a statement about how long real memory holds data.** It is a model
parameter. The physical measurements — remanence times, the effect of cooling, the behaviour of
particular DRAM technologies — are the paper's, in its section 3, and this lab reproduces none of
them. Cite the paper for those, and for nothing more than it says.

**Do NOT use this as a claim about any current system.** The products the paper tested, it tested in
2008.

**Do NOT treat this as an implementation to copy.** The search here is written to be read.

---

## Live Demo

<https://systemslibrarian.github.io/crypto-lab-cold-boot/>

Move the decay slider and watch the image come apart. Then run exhibit 4 one step at a time to see
why the damage does not matter, and exhibit 5 to watch the key come back out of it.

---

## What Can Go Wrong

A cipher's expanded key is a long, highly redundant encoding of a short secret. When stored bits
fail mostly in one direction, that redundancy lets an attacker correct the errors **and certify the
answer** with no plaintext or ciphertext at all — so "the memory image was damaged" is not a
defence.

The certification is the part that surprises people. There is no decryption step anywhere in this
attack. A candidate key is accepted because its own expansion, computed forward, could have decayed
into the 176 bytes in front of you; at these decay rates exactly one key in practice can. Across
every measurement below — 1,650 keys — a key was never once certified that was not the right one.

---

## Real-World Usage

Everything in this section is what the 2008 paper reports, dated as such. This lab makes no claim
about any current system.

- The paper's authors recovered keys from **BitLocker, TrueCrypt (4.3a and 5.0a), FileVault,
  dm-crypt** and **Loop-AES** as those products stood in 2008. In their tests the AES keys for
  dm-crypt and TrueCrypt were found with no bit errors at all.
- **Every disk-encryption system they studied precomputed a key schedule and kept it in memory for
  as long as the disk was mounted.** That is the decision this lab measures the cost of.
- **Loop-AES's countermeasure made things worse.** It kept each key schedule twice, once inverted,
  swapping them periodically so every cell spent equal time at 0 and 1. The paper notes that this
  does not prevent the attack, makes Loop-AES keys *easier to identify*, and hands the attacker a
  second redundant copy to correct errors with.
- **A TPM does not help.** Deployed TPMs of the time gated whether a key was released into RAM; the
  paper's sentence is the one to remember — a TPM can prevent a key from being loaded into memory,
  but it cannot prevent it from being captured once it is there.
- The authors' own conclusion: they know of **no simple remedy** that would eliminate these risks.

For where any specific system stands today, check that system today.

---

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-cold-boot.git
cd crypto-lab-cold-boot
npm install
npm run dev
```

Other scripts:

```bash
npm test             # the unit and correctness suite
npm run build        # typecheck, then the production bundle
npm run test:a11y    # the axe WCAG A/AA gate against the production build
npm run test:claims  # the claims suite: does the page tell the truth?
npm run mutate       # the mutation ledger -- see Build & Verify
node scripts/run-measure.mjs   # re-measure the recovery rates and times
```

---

## Related Demos

- [AES Anatomy](https://systemslibrarian.github.io/crypto-lab-aes-anatomy/) — builds the AES data
  path and its key expansion, then attacks it with a fault. The schedule this lab decays is the one
  that lab constructs.
- [Sector Vault](https://systemslibrarian.github.io/crypto-lab-sector-vault/) — disk encryption,
  which is where the keys this attack recovers are being used.
- [Timing Side Channel](https://systemslibrarian.github.io/crypto-lab-timing-sidechannel/) — another
  attack that reads a secret out of a physical property of the machine rather than the ciphertext.
- [Power Trace](https://systemslibrarian.github.io/crypto-lab-power-trace/) — recovering an AES key
  from power consumption, for contrast: a side channel you have to observe live, where this one is a
  snapshot you can take away.
- [Masked Core](https://systemslibrarian.github.io/crypto-lab-masked-core/) — the defensive side of
  side-channel work.

---

## Build & Verify

**137 unit tests** (`npm test`), plus **2 accessibility tests** and **18 claims tests** in the
browser gate.

**Known-answer tests.**

| Vector | Where | Value |
|---|---|---|
| FIPS 197 Appendix A.1 | `src/cold/aes-schedule.test.ts` | all 44 words of the expansion of `2b7e151628aed2a6abf7158809cf4f3c`, incl. w4 = `a0fafe17`, w43 = `b6630ca6` |
| FIPS 197 Appendix C.1 | `src/cold/aes-cipher.test.ts` | the cipher built from that expansion encrypts `00112233445566778899aabbccddeeff` under `000102030405060708090a0b0c0d0e0f` to `69c4e0d86a7b0430d8cdb78070b4c55a` |
| Platform AES | `src/cold/aes-cipher.test.ts` | the same cipher agrees with WebCrypto over 64 random keys and blocks |
| FIPS 180-4 | `src/cold/sha256.test.ts` | the empty string, `abc`, and the 56-byte vector; plus agreement with WebCrypto across block boundaries |
| Schedule fingerprint | `src/cold/reconstruct.test.ts` | SHA-256 of the 176 A.1 schedule bytes = `2604b57171cdcd0f2e68a831e2354a9f0030a055491f01f7c62392d16e908e9c`; 720 one bits |

The A.1 word table and the cipher KAT pin each other on purpose. A table asserted on its own is a
regression baseline — a test agreeing with the code it tests. Driving the AES cipher from that same
expansion and matching both the published vector and the platform's AES is what makes it an
independent check: a single wrong byte anywhere in the 176 changes the ciphertext.

**The two fixed images.** Built from the A.1 schedule by a deterministic rule — for byte `i` and bit
`b`, clear a stored 1 when the first byte of SHA-256(`"decay"` ‖ `i` ‖ `b`) is below the threshold —
so a test and a labelled control on the page hold the same damaged image and get the same answer
twice. Both are recovered from the image alone.

| Threshold | Bits cleared | Image key bytes | SHA-256 of the image | Key bits lost | Zero bits in the key bytes |
|---|---|---|---|---|---|
| T = 38 (14.8%) | 96 | `207c0516288a92a6abb6158809494f2c` | `df2813a71468a70b33575a4ce30fe1152ce757d8d460bd192f672a801c0f9806` | 14 | 77 |
| T = 77 (30.1%) | 217 | `207c0506208292a0a286158009094f2c` | `6e7a2943b7b85d3a2b4344407e936be11ee065e858465ce122428b4e90966bd1` | 25 | 88 |

**Naive-search counts**, exact in BigInt: 2⁷⁷ and 2⁸⁸ supersets of the two images' key bytes; and if
the number of lost bits were somehow known, still C(77, 14) = 2⁴⁹·⁶ and C(88, 25) = 2⁷²·⁴. The
paper's 256-bit example is C(140, 12) = 2⁵⁶·⁰² exactly, which is the "more than 2⁵⁶" it states.

**The accessibility gate.** `npm run build && npm run test:a11y` must pass with zero violations.
The gate drives the lab through every exhibit and every failure state — including the random-bytes
refusal and the retired verdict — and scans each at 1280 px and 380 px. It asserts more than axe's
`violations` array: axe's `incomplete` bucket, arithmetic contrast over every text node including
`aria-hidden` ones, non-text contrast ratcheted against a baseline that is currently **empty**,
keyboard reachability of every scroll region, reflow at phone width, and that nothing focusable
paints nothing.

**The mutation ledger.** `npm run mutate` applies each mutation as a concrete patch, confirms the
build still succeeds and the bundle hash moved, and confirms the owning test fails. A mutation that
does not compile is recorded as DOES NOT BUILD and is never counted as a kill. See
`scripts/mutate.mjs` for the patches and `MUTATIONS.md` for the ledger it writes.

---

## Performance

Measured on the author's machine (Apple silicon, Node 26) with `node scripts/run-measure.mjs`. Keys
and decay draws come from `crypto.getRandomValues`, so every run is a fresh measurement.

| Decay | Keys recovered | Wrong keys | Mean | Median | 99th | Max |
|---|---|---|---|---|---|---|
| d0 = 0.15, d1 = 0 | 1000 / 1000 | 0 | 6.1 ms | 1.0 ms | 64 ms | 742 ms |
| d0 = 0.30, d1 = 0 | 500 / 500 | 0 | 83 ms | 18 ms | 1.4 s | 3.4 s |
| d0 = 0.15, d1 = 0.001, budget ≤ 3 | 150 / 150 | 0 | 107 ms | 3.8 ms | 3.2 s | 5.3 s |

Median survivors per slice: **512** after round key 1 and **16** after round key 2 at 15% decay;
**5,120** and **256** at 30%. That collapse is the whole attack, and the distribution has a long
tail — an unlucky image leaves far more candidates than a median one, which is why the maximum is
the number worth reading rather than the mean.

With `d1 = 0.001` about half the images carry at least one wrong-way flip, and the hard test rejects
the true key outright when they do; the measured rate for the hard test alone on those images is
roughly half. A budget of wrong-way bits is then raised until a key passes the full-schedule test.
An image carrying **four or more** wrong-way flips cannot be explained within a budget of three — not
by this implementation but by the certificate itself — and at `d1 = 0.001` that is about 0.6% of
images. The lab reports those as "not recovered within the budget", which is what they are.

The reference figures measured for the brief, on a different machine, are printed beside these in
exhibit 6: mean 0.54 ms at 15% and 16 ms at 30% for the one-way cases. This build is consistently
around 5× slower per key while producing the same survivor counts, so read the shape rather than the
milliseconds. The paper's own figures — keys at 15% in a fraction of a second, about half of keys at
30% within 30 seconds — are for its implementation in its mixed-ground-state setting and are not
directly comparable to either column.

---

## Credit

J. Alex Halderman, Seth D. Schoen, Nadia Heninger, William Clarkson, William Paul, Joseph A.
Calandrino, Ariel J. Feldman, Jacob Appelbaum, Edward W. Felten. *Lest We Remember: Cold Boot
Attacks on Encryption Keys.* 17th USENIX Security Symposium, 2008.
[Publisher's page](https://www.usenix.org/conference/17th-usenix-security-symposium/lest-we-remember-cold-boot-attacks-encryption-keys)

The key expansion follows [FIPS 197](https://csrc.nist.gov/pubs/fips/197/final); SHA-256 follows
[FIPS 180-4](https://csrc.nist.gov/pubs/fips/180-4/upd1/final).

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
