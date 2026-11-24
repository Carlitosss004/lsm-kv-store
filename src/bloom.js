'use strict';

function fnv1a(str, seed) {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (const byte of Buffer.from(str, 'utf8')) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Bloom filter using double hashing (Kirsch-Mitzenmacher). */
class BloomFilter {
  constructor(bits, hashes, bytes) {
    this.bits = bits;
    this.hashes = hashes;
    this.bytes = bytes || new Uint8Array(Math.ceil(bits / 8));
  }

  /** Size a filter for `n` items at false-positive rate `p`. */
  static forCapacity(n, p = 0.01) {
    const items = Math.max(1, n);
    const bits = Math.max(8, Math.ceil((-items * Math.log(p)) / Math.LN2 ** 2));
    const hashes = Math.max(1, Math.round((bits / items) * Math.LN2));
    return new BloomFilter(bits, hashes);
  }

  _positions(key) {
    const h1 = fnv1a(key, 0);
    const h2 = fnv1a(key, 0x9747b28c) | 1;
    const out = [];
    for (let i = 0; i < this.hashes; i++) out.push(((h1 + Math.imul(i, h2)) >>> 0) % this.bits);
    return out;
  }

  add(key) {
    for (const p of this._positions(key)) this.bytes[p >> 3] |= 1 << (p & 7);
  }

  mightContain(key) {
    return this._positions(key).every((p) => (this.bytes[p >> 3] & (1 << (p & 7))) !== 0);
  }
}

module.exports = { BloomFilter };
