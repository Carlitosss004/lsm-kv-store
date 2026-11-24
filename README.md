# LSM KV Store

A small, dependency-free log-structured merge-tree key-value store in plain JavaScript. It has a write-ahead log, a sorted memtable, immutable SSTables with sparse indexes and bloom filters, tombstone deletes, k-way merged range scans and compaction.

It's the storage design behind LevelDB, RocksDB and Cassandra, cut down to about 400 lines you can read in one sitting.

## Usage

Requires Node 18+. There are no dependencies.

```js
const { LSMStore } = require('./src');
const db = new LSMStore('./data', { memtableLimit: 1000, compactionThreshold: 4 });
db.put('user:1', { name: 'Ada' });
db.get('user:1');                  // { name: 'Ada' }
db.delete('user:1');
for (const [k, v] of db.scan('user:', 'user;')) { /* ordered range scan */ }
db.close();
```

Run the demo with `npm run demo`. Real output:

```
get user:0005  -> {"id":5,"score":"updated"}
get user:0010  -> undefined (deleted)
scan [user:0020, user:0026):
   user:0021 {"id":21,"score":46}
   user:0022 {"id":22,"score":53}
   user:0023 {"id":23,"score":60}
   user:0024 {"id":24,"score":67}
   user:0025 {"id":25,"score":74}
stats          -> {"flushes":11,"compactions":3} tables on disk: 2
after reopen   -> {"id":5,"score":"updated"} live keys: 900
```

## Tests

```
npm test
```

They cover the bloom filter's false-positive rate, SSTable block lookups, WAL torn-write recovery, tombstones across tables, compaction, and a randomized comparison against a `Map`, including reopening the store.

## Design

- `wal.js`: every write is appended to the log before the memtable. A torn last line is ignored on replay.
- `memtable.js`: a sorted key array plus a Map. `null` marks a tombstone.
- `sstable.js`: JSON-lines files written to a temp file and renamed into place. A sparse index with one entry per 16 keys sends a lookup to a single block, and a bloom filter skips tables that can't hold the key.
- `merge.js`: a k-way merge where the newest source wins for duplicate keys. Scans and compaction both use it.
- `lsm.js`: reads check the memtable and then tables from newest to oldest. A full memtable flushes to a table and resets the WAL. When the table count reaches the threshold, a full compaction merges everything and drops shadowed versions and tombstones.

Limits: single process, no checksums, no fsync, and compaction is one full merge instead of leveled.


---
<sub>Part of my daily project series, built autonomously with Ponos and Claude Code.</sub>
