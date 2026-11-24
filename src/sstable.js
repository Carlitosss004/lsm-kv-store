'use strict';
const fs = require('fs');
const { BloomFilter } = require('./bloom');

const BLOCK_ENTRIES = 16;

/**
 * Immutable sorted table. File format: one JSON line per entry,
 * `{"k":key,"v":value}` or `{"k":key,"t":1}` for a tombstone.
 * An in-memory sparse index (byte offset every BLOCK_ENTRIES entries) and a
 * bloom filter are rebuilt when the table is opened.
 */
class SSTable {
  constructor(path) {
    this.path = path;
    this.index = []; // [{key, offset}]
    this.bloom = null;
    this.size = fs.statSync(path).size;
    this.count = 0;
    this._load();
  }

  static write(path, entries) {
    const tmp = path + '.tmp';
    const lines = [];
    for (const [k, v] of entries) lines.push(JSON.stringify(v === null ? { k, t: 1 } : { k, v }));
    fs.writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '');
    fs.renameSync(tmp, path); // atomic publish
    return new SSTable(path);
  }

  _load() {
    const text = fs.readFileSync(this.path, 'utf8');
    const keys = [];
    let offset = 0;
    for (const line of text.split('\n')) {
      if (!line) continue;
      const { k } = JSON.parse(line);
      if (keys.length % BLOCK_ENTRIES === 0) this.index.push({ key: k, offset });
      keys.push(k);
      offset += Buffer.byteLength(line) + 1;
    }
    this.count = keys.length;
    this.bloom = BloomFilter.forCapacity(keys.length);
    for (const k of keys) this.bloom.add(k);
  }

  _blockFor(key) {
    let lo = 0;
    let hi = this.index.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.index[mid].key <= key) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }

  _readRange(from, to) {
    const buf = Buffer.alloc(to - from);
    const fd = fs.openSync(this.path, 'r');
    try {
      fs.readSync(fd, buf, 0, buf.length, from);
    } finally {
      fs.closeSync(fd);
    }
    return buf.toString('utf8');
  }

  /** Returns undefined (absent), null (tombstone) or the value. */
  get(key) {
    if (!this.bloom.mightContain(key)) return undefined;
    const b = this._blockFor(key);
    if (b < 0) return undefined;
    const to = b + 1 < this.index.length ? this.index[b + 1].offset : this.size;
    for (const line of this._readRange(this.index[b].offset, to).split('\n')) {
      if (!line) continue;
      const e = JSON.parse(line);
      if (e.k === key) return e.t ? null : e.v;
      if (e.k > key) break;
    }
    return undefined;
  }

  *entries(start = null, end = null) {
    const b = start === null ? 0 : Math.max(0, this._blockFor(start));
    if (!this.index.length) return;
    for (const line of this._readRange(this.index[b].offset, this.size).split('\n')) {
      if (!line) continue;
      const e = JSON.parse(line);
      if (start !== null && e.k < start) continue;
      if (end !== null && e.k >= end) return;
      yield [e.k, e.t ? null : e.v];
    }
  }

  remove() {
    fs.unlinkSync(this.path);
  }
}

module.exports = { SSTable, BLOCK_ENTRIES };
