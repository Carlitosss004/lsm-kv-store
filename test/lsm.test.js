'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LSMStore, BloomFilter, SSTable, MemTable, WAL, mergeSources } = require('../src');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lsm-test-'));

test('bloom filter has no false negatives and a low false-positive rate', () => {
  const b = BloomFilter.forCapacity(1000, 0.01);
  for (let i = 0; i < 1000; i++) b.add('k' + i);
  for (let i = 0; i < 1000; i++) assert.ok(b.mightContain('k' + i));
  let fp = 0;
  for (let i = 0; i < 5000; i++) if (b.mightContain('x' + i)) fp++;
  assert.ok(fp / 5000 < 0.03, `fp rate ${fp / 5000}`);
});

test('memtable keeps keys sorted and supports ranges', () => {
  const m = new MemTable();
  for (const k of ['d', 'a', 'c', 'b', 'a']) m.set(k, k.toUpperCase());
  assert.deepStrictEqual([...m.entries()].map((e) => e[0]), ['a', 'b', 'c', 'd']);
  assert.deepStrictEqual([...m.entries('b', 'd')].map((e) => e[0]), ['b', 'c']);
});

test('mergeSources prefers the newest source', () => {
  const out = [...mergeSources([[['a', 1], ['c', 3]], [['a', 0], ['b', 2]]])];
  assert.deepStrictEqual(out, [['a', 1], ['b', 2], ['c', 3]]);
});

test('sstable point lookups across blocks, tombstones and ranges', () => {
  const dir = tmp();
  const entries = [];
  for (let i = 0; i < 100; i++) entries.push([String(i).padStart(3, '0'), i % 7 === 0 ? null : 'v' + i]);
  const t = SSTable.write(path.join(dir, '1.sst'), entries);
  assert.strictEqual(t.get('050'), 'v50');
  assert.strictEqual(t.get('048'), 'v48');
  assert.strictEqual(t.get('048x'), undefined);
  assert.strictEqual(t.get('007'), null);
  assert.strictEqual(t.get('zzz'), undefined);
  assert.strictEqual(t.get('   '), undefined);
  assert.deepStrictEqual([...t.entries('033', '036')].map((e) => e[0]), ['033', '034', '035']);
});

test('wal replay ignores a torn final record', () => {
  const dir = tmp();
  const p = path.join(dir, 'w.log');
  const w = new WAL(p);
  w.append({ k: 'a', v: 1 });
  w.close();
  fs.appendFileSync(p, '{"k":"b","v"');
  assert.deepStrictEqual(WAL.replay(p), [{ k: 'a', v: 1 }]);
});

test('put/get/delete with flushes and compaction', () => {
  const db = new LSMStore(tmp(), { memtableLimit: 10, compactionThreshold: 3 });
  for (let i = 0; i < 100; i++) db.put('k' + i, i);
  db.delete('k5');
  db.put('k6', 'new');
  assert.strictEqual(db.get('k5'), undefined);
  assert.strictEqual(db.get('k6'), 'new');
  assert.strictEqual(db.get('k99'), 99);
  assert.strictEqual(db.get('nope'), undefined);
  assert.ok(db.stats.flushes >= 9);
  assert.ok(db.stats.compactions >= 1);
  assert.ok(db.tables.length < 3);
  db.close();
});

test('tombstones shadow older tables and survive scan', () => {
  const db = new LSMStore(tmp(), { memtableLimit: 2, compactionThreshold: 100 });
  db.put('a', 1); db.put('b', 2); // flush
  db.delete('a'); db.put('c', 3); // flush
  assert.strictEqual(db.get('a'), undefined);
  assert.deepStrictEqual([...db.scan()], [['b', 2], ['c', 3]]);
  db.compact();
  assert.deepStrictEqual([...db.scan()], [['b', 2], ['c', 3]]);
  assert.strictEqual(db.tables.length, 1);
  db.close();
});

test('recovers unflushed writes from the WAL after a crash', () => {
  const dir = tmp();
  const db = new LSMStore(dir, { memtableLimit: 1000 });
  db.put('x', { n: 1 });
  db.put('y', 2);
  db.delete('y');
  db.close(); // never flushed
  const again = new LSMStore(dir);
  assert.deepStrictEqual(again.get('x'), { n: 1 });
  assert.strictEqual(again.get('y'), undefined);
  again.close();
});

test('matches a Map under random operations, including after reopen', () => {
  const dir = tmp();
  let db = new LSMStore(dir, { memtableLimit: 7, compactionThreshold: 3 });
  const model = new Map();
  let seed = 42;
  const rnd = (n) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % n);
  for (let i = 0; i < 2000; i++) {
    const k = 'key' + rnd(60);
    if (rnd(4) === 0) { db.delete(k); model.delete(k); }
    else { db.put(k, i); model.set(k, i); }
    if (i % 500 === 499) { db.close(); db = new LSMStore(dir, { memtableLimit: 7, compactionThreshold: 3 }); }
  }
  for (let i = 0; i < 60; i++) assert.strictEqual(db.get('key' + i), model.get('key' + i));
  assert.deepStrictEqual([...db.scan()], [...model].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  db.close();
});

test('input validation and closed store', () => {
  const db = new LSMStore(tmp());
  assert.throws(() => db.put('', 1), TypeError);
  assert.throws(() => db.put('a', null), TypeError);
  assert.throws(() => db.get(5), TypeError);
  db.close();
  assert.throws(() => db.get('a'), /closed/);
});
