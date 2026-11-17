# Mutation ledger

Written by `scripts/mutate.mjs`. Every `observed` line below was produced by the run, not
typed. Re-run `npm run mutate` to regenerate it.

Run: 2026-11-17. Baseline bundle `85c2b4d7bc486dae`; restored bundle `85c2b4d7bc486dae`.
Result: **7 of 9 killed**.

A kill requires all four of: the owning test passed unmutated in the same run; the patch
changed the file; the built bundle hash moved, so the run served the mutated code; and the
patch compiled. A patch that does not compile is DOES NOT BUILD and is never a kill.

| # | Mutation | Suite | Owning test | Verdict | Observed |
|---|---|---|---|---|---|
| 1 | the S-box is omitted from the w4 relation | unit | check A: AES-128 key expansion (FIPS 197) | KILLED | KILLED; bundle 48c1369c6f802758 (moved); suite failed; owner named: true |
| 2 | rcon is applied to every byte position, not only position 0 | unit | check A: AES-128 key expansion (FIPS 197) | KILLED | KILLED; bundle 2840979a9b83cd16 (moved); suite failed; owner named: true |
| 3 | the slice uses w3[i] instead of w3[(i+1) mod 4] | unit | check D: the relations hold | FAILED ELSEWHERE | FAILED ELSEWHERE; bundle 0dfac5f497d70510 (moved); suite failed; owner named: false |
| 4 | the hard test compares for equality instead of superset | unit | check B: the two fixed images | KILLED | KILLED; bundle 3419c03da65cd648 (moved); suite failed; owner named: true |
| 5 | the hard test's direction is reversed -- the image must contain the candidate | unit | check B: the two fixed images | KILLED | KILLED; bundle 4b30b7e1b3a9a945 (moved); suite failed; owner named: true |
| 6 | the final check compares only the 16 key bytes instead of all 176 | unit | check G: fail-closed paths | KILLED | KILLED; bundle 814d185d2f262d39 (moved); suite failed; owner named: true |
| 7 | "recovered" is set whenever the search returns a key, without the full-schedule check | claims | NEGATIVE CLAIM BITE: random bytes must not show the recovered clause | SURVIVED | SURVIVED; bundle f72c4a60251d315f (moved); suite passed; owner named: false |
| 8 | decay is applied to zeros instead of ones | unit | the decay channel | KILLED | KILLED; bundle 60ed786f7fbdcab0 (moved); suite failed; owner named: true |
| 9 | the superset enumeration skips the candidate equal to the image byte itself | unit | per-byte candidates | KILLED | KILLED; bundle 14740ad450c90b85 (moved); suite failed; owner named: true |

## Surviving mutations

A surviving mutation is reported, not explained away.

- **3. the slice uses w3[i] instead of w3[(i+1) mod 4]** — FAILED ELSEWHERE; bundle 0dfac5f497d70510 (moved); suite failed; owner named: false
- **7. "recovered" is set whenever the search returns a key, without the full-schedule check** — SURVIVED; bundle f72c4a60251d315f (moved); suite passed; owner named: false

---

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
