'use strict';
const fs = require('fs');
const path = require('path');
const { MemTable } = require('./memtable');
const { WAL } = require('./wal');
const { SSTable } = require('./sstable');
const { mergeSources } = require('./merge');

/**
 * A small LSM-tree key-value store.
 * Writes go to the WAL then the memtable; a full memtable is flushed to an
 * immutable SSTable; too many tables are compacted into one.
 */
class LSMStore {
  constructor(dir, { memtableLimit = 1000, compactionThreshold = 4 } = {}) {
    this.dir = dir;
    this.memtableLimit = memtableLimit;
    this.compactionThreshold = compactionThreshold;
    this.stats = { flushes: 0, compactions: 0 };
    this.closed = false;
    fs.mkdirSync(dir, { recursive: true });

    this.tables = []; // oldest first
    let maxId = 0;
    for (const f of fs.readdirSync(dir).sort()) {
      if (f.endsWith('.tmp')) fs.unlinkSync(path.join(dir, f));
      const m = /^(\d+)\.sst$/.exec(f);
      if (m) {
        maxId = Math.max(maxId, Number(m[1]));
        this.tables.push(new SSTable(path.join(dir, f)));
      }
    }
    this.nextId = maxId + 1;

    this.mem = new MemTable();
    const walPath = path.join(dir, 'wal.log');
    for (const r of WAL.replay(walPath)) this.mem.set(r.k, r.t ? null : r.v);
    this.wal = new WAL(walPath);
  }

  _check(key) {
    if (this.closed) throw new Error('store is closed');
    if (typeof key !== 'string' || key === '') throw new TypeError('key must be a non-empty string');
  }

  put(key, value) {
    this._check(key);
    if (value === undefined || value === null) throw new TypeError('value must not be null/undefined; use delete()');
    this.wal.append({ k: key, v: value });
    this.mem.set(key, value);
    this._maybeFlush();
  }

  delete(key) {
    this._check(key);
    this.wal.append({ k: key, t: 1 });
    this.mem.set(key, null);
    this._maybeFlush();
  }

  get(key) {
    this._check(key);
    if (this.mem.has(key)) return this.mem.get(key) ?? undefined;
    for (let i = this.tables.length - 1; i >= 0; i--) {
      const v = this.tables[i].get(key);
      if (v !== undefined) return v ?? undefined;
    }
    return undefined;
  }

  /** Live entries with start <= key < end, in key order. */
  *scan(start = null, end = null) {
    if (this.closed) throw new Error('store is closed');
    const sources = [this.mem.entries(start, end)];
    for (let i = this.tables.length - 1; i >= 0; i--) sources.push(this.tables[i].entries(start, end));
    for (const [k, v] of mergeSources(sources)) if (v !== null) yield [k, v];
  }

  _maybeFlush() {
    if (this.mem.size >= this.memtableLimit) this.flush();
  }

  flush() {
    if (this.mem.size === 0) return;
    const file = path.join(this.dir, String(this.nextId++).padStart(8, '0') + '.sst');
    this.tables.push(SSTable.write(file, this.mem.entries()));
    this.mem = new MemTable();
    this.wal.reset();
    this.stats.flushes++;
    if (this.tables.length >= this.compactionThreshold) this.compact();
  }

  /** Merge every table into one, dropping shadowed versions and tombstones. */
  compact() {
    if (this.tables.length < 2) return;
    const sources = [...this.tables].reverse().map((t) => t.entries());
    const live = (function* () {
      for (const e of mergeSources(sources)) if (e[1] !== null) yield e;
    })();
    const file = path.join(this.dir, String(this.nextId++).padStart(8, '0') + '.sst');
    const merged = SSTable.write(file, live);
    const old = this.tables;
    this.tables = [merged];
    for (const t of old) t.remove();
    this.stats.compactions++;
  }

  close() {
    if (this.closed) return;
    this.wal.close();
    this.closed = true;
  }
}

module.exports = { LSMStore };
