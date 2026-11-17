/**
 * Real AES-128 key expansion (FIPS 197), hand-rolled so every byte of it is
 * inspectable. This is the teaching subject: the expanded key is the
 * error-correcting code the whole lab turns on, so it is not hidden in a
 * library.
 *
 * FIPS 197 numbers the 44 words of an AES-128 expansion w0 .. w43. This file
 * keeps that numbering and adds one extra view of the same bytes, because the
 * reconstruction needs it: a (position, round) view.
 *
 * Round key r is words 4r .. 4r+3, so each round key is a 4x4 byte square.
 * Write the four bytes at position p of round key r as
 *
 *     a[p][r] = w(4r + 0)[p]      b[p][r] = w(4r + 1)[p]
 *     c[p][r] = w(4r + 2)[p]      d[p][r] = w(4r + 3)[p]
 *
 * and the whole expansion is four interleaved chains, one per position p, with
 * exactly one coupling between them -- the key schedule core's rotation:
 *
 *     a[p][r] = a[p][r-1] ^ S(d[(p+1) % 4][r-1]) ^ (p === 0 ? rcon[r-1] : 0)
 *     b[p][r] = b[p][r-1] ^ a[p][r]
 *     c[p][r] = c[p][r-1] ^ b[p][r]
 *     d[p][r] = d[p][r-1] ^ c[p][r]
 *
 * That is the whole of FIPS 197 5.2 for a 128-bit key, rearranged. The three
 * lower lines say three bytes of every round key are a running XOR -- which is
 * the redundancy this lab exploits.
 */

/** Bytes in an AES-128 expanded key: 11 round keys of 16 bytes. */
export const SCHEDULE_BYTES = 176;

/** Bytes in an AES-128 key. */
export const KEY_BYTES = 16;

/** Round keys in an AES-128 expansion, counting the key itself as round key 0. */
export const ROUNDS = 11;

/**
 * The AES round constants, rcon[r-1] for round key r. Powers of x in
 * GF(2^8) = GF(2)[x]/(x^8 + x^4 + x^3 + x + 1).
 */
export const RCON: readonly number[] = buildRcon();

function buildRcon(): number[] {
  const out: number[] = [];
  let v = 1;
  for (let i = 0; i < 10; i++) {
    out.push(v);
    v = xtime(v);
  }
  return out;
}

/** Multiply by x in GF(2^8) with the AES reduction polynomial 0x11b. */
function xtime(v: number): number {
  const shifted = (v << 1) & 0xff;
  return v & 0x80 ? shifted ^ 0x1b : shifted;
}

/**
 * The AES S-box, generated rather than pasted: the multiplicative inverse in
 * GF(2^8) (0 maps to 0) followed by the FIPS 197 affine transform. Generating
 * it means a reader can see where it comes from, and the KAT in the tests
 * still pins every one of the 256 entries to the published table.
 */
export const SBOX: Uint8Array = buildSbox();
export const INV_SBOX: Uint8Array = buildInvSbox(SBOX);

function buildSbox(): Uint8Array {
  // Log/antilog tables over the generator 3, used only to invert.
  const antilog = new Uint8Array(256);
  const log = new Uint8Array(256);
  let v = 1;
  for (let i = 0; i < 255; i++) {
    antilog[i] = v;
    log[v] = i;
    v ^= xtime(v); // v *= 3
  }
  const inverse = (x: number): number => (x === 0 ? 0 : antilog[(255 - log[x]) % 255]);

  const sbox = new Uint8Array(256);
  for (let x = 0; x < 256; x++) {
    const inv = inverse(x);
    let acc = inv;
    let rot = inv;
    for (let i = 0; i < 4; i++) {
      rot = ((rot << 1) | (rot >> 7)) & 0xff;
      acc ^= rot;
    }
    sbox[x] = acc ^ 0x63;
  }
  return sbox;
}

function buildInvSbox(sbox: Uint8Array): Uint8Array {
  const inv = new Uint8Array(256);
  for (let x = 0; x < 256; x++) inv[sbox[x]] = x;
  return inv;
}

/* ------------------------------------------------------------------ *
 * The (position, round) view of the 176 schedule bytes.
 * ------------------------------------------------------------------ */

/** Index of a[p][r] = w(4r)[p] in the 176-byte schedule. */
export const aAt = (p: number, r: number): number => 16 * r + p;
/** Index of b[p][r] = w(4r+1)[p]. */
export const bAt = (p: number, r: number): number => 16 * r + 4 + p;
/** Index of c[p][r] = w(4r+2)[p]. */
export const cAt = (p: number, r: number): number => 16 * r + 8 + p;
/** Index of d[p][r] = w(4r+3)[p]. */
export const dAt = (p: number, r: number): number => 16 * r + 12 + p;

/** Index of byte `p` of word `n` (FIPS 197 numbering) in the 176-byte schedule. */
export const wordByteAt = (n: number, p: number): number => n * 4 + p;

/** The round key a schedule byte belongs to. */
export const roundOf = (index: number): number => (index / 16) | 0;

/**
 * Expand a 16-byte AES-128 key into its 176-byte key schedule.
 *
 * This is the FIPS 197 word recurrence, written over words so it reads like
 * the specification. The (position, round) relations documented above are the
 * same arithmetic seen sideways; `relationsHold` in the tests checks that.
 */
export function expandKey(key: Uint8Array): Uint8Array {
  if (key.length !== KEY_BYTES) {
    throw new RangeError(`AES-128 key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
  const w = new Uint8Array(SCHEDULE_BYTES);
  w.set(key);
  for (let n = 4; n < 44; n++) {
    const out = n * 4;
    const prev = (n - 1) * 4;
    const four = (n - 4) * 4;
    let t0 = w[prev];
    let t1 = w[prev + 1];
    let t2 = w[prev + 2];
    let t3 = w[prev + 3];
    if (n % 4 === 0) {
      // RotWord then SubWord then XOR rcon: byte j of the result is
      // S(t[(j+1) % 4]), which is where the (p+1) % 4 in the relations
      // above comes from.
      const r0 = SBOX[t1] ^ RCON[n / 4 - 1];
      const r1 = SBOX[t2];
      const r2 = SBOX[t3];
      const r3 = SBOX[t0];
      t0 = r0;
      t1 = r1;
      t2 = r2;
      t3 = r3;
    }
    w[out] = w[four] ^ t0;
    w[out + 1] = w[four + 1] ^ t1;
    w[out + 2] = w[four + 2] ^ t2;
    w[out + 3] = w[four + 3] ^ t3;
  }
  return w;
}

/**
 * The seven-byte slice of FIPS 197's redundancy that the attack is built on.
 *
 * Slice `p` holds four key bytes -- a[p][0], b[p][0], c[p][0] and d[j][0]
 * where j = (p+1) % 4 -- and the three bytes of round key 1 those four
 * determine: a[p][1], b[p][1], c[p][1]. Seven stored bytes, four unknowns.
 *
 * d[p][1] is deliberately NOT in the slice: it needs d[p][0], which belongs to
 * slice (p+3) % 4. That one missing byte is why the four slices have to be
 * stitched rather than solved separately.
 */
export interface Slice {
  /** Position 0..3. */
  readonly p: number;
  /** The neighbouring position whose d-chain this slice reads: (p+1) % 4. */
  readonly j: number;
  /** Schedule indices of the four key bytes this slice determines. */
  readonly keyBytes: readonly [number, number, number, number];
  /** Schedule indices of the three round-key-1 bytes they derive. */
  readonly derived: readonly [number, number, number];
}

/** The four slices, in position order. */
export const SLICES: readonly Slice[] = [0, 1, 2, 3].map((p) => {
  const j = (p + 1) % 4;
  return {
    p,
    j,
    keyBytes: [aAt(p, 0), bAt(p, 0), cAt(p, 0), dAt(j, 0)] as const,
    derived: [aAt(p, 1), bAt(p, 1), cAt(p, 1)] as const,
  };
});

/**
 * Which stored bytes determine the byte at `index`?
 *
 * Answers the page's "which bytes determine this one?" control. Key bytes
 * (round key 0) are determined by nothing -- they are the secret.
 */
export function determinedBy(index: number): { inputs: number[]; subByte: number | null; rcon: number } {
  if (index < 0 || index >= SCHEDULE_BYTES) throw new RangeError(`byte index out of range: ${index}`);
  const r = roundOf(index);
  if (r === 0) return { inputs: [], subByte: null, rcon: 0 };
  const p = index % 4;
  const column = ((index % 16) / 4) | 0; // 0 = a, 1 = b, 2 = c, 3 = d
  if (column === 0) {
    return { inputs: [aAt(p, r - 1)], subByte: dAt((p + 1) % 4, r - 1), rcon: p === 0 ? RCON[r - 1] : 0 };
  }
  const prevSame = [aAt(p, r), bAt(p, r), cAt(p, r)][column - 1];
  const prevRound = [aAt(p, r - 1), bAt(p, r - 1), cAt(p, r - 1), dAt(p, r - 1)][column];
  return { inputs: [prevRound, prevSame], subByte: null, rcon: 0 };
}

/**
 * Recompute one schedule byte from the bytes that determine it. Used by the
 * tests to check the (position, round) relations against `expandKey`, and by
 * the page to show a relation being evaluated rather than asserted.
 */
export function recomputeByte(schedule: Uint8Array, index: number): number {
  const { inputs, subByte, rcon } = determinedBy(index);
  if (inputs.length === 0) return schedule[index];
  let acc = rcon;
  for (const i of inputs) acc ^= schedule[i];
  if (subByte !== null) acc ^= SBOX[schedule[subByte]];
  return acc & 0xff;
}

/** Hex for a byte range, lower case, no separators. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Parse lower- or upper-case hex into bytes. Throws on anything else. */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().replace(/\s+/g, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new SyntaxError('expected an even-length string of hex digits');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Population count per byte value, used everywhere a bit is counted. */
export const POPCOUNT: Uint8Array = (() => {
  const t = new Uint8Array(256);
  for (let i = 1; i < 256; i++) t[i] = (i & 1) + t[i >> 1];
  return t;
})();

/** Number of one bits in a byte array. */
export function countOnes(bytes: Uint8Array): number {
  let n = 0;
  for (const b of bytes) n += POPCOUNT[b];
  return n;
}

/** Number of zero bits in a byte array. */
export function countZeros(bytes: Uint8Array): number {
  return bytes.length * 8 - countOnes(bytes);
}
