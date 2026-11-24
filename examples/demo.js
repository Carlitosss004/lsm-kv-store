'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LSMStore } = require('../src');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsm-demo-'));
const db = new LSMStore(dir, { memtableLimit: 100, compactionThreshold: 4 });

for (let i = 0; i < 1000; i++) db.put(`user:${String(i).padStart(4, '0')}`, { id: i, score: i * 7 % 101 });
for (let i = 0; i < 1000; i += 10) db.delete(`user:${String(i).padStart(4, '0')}`);
db.put('user:0005', { id: 5, score: 'updated' });

console.log('get user:0005  ->', JSON.stringify(db.get('user:0005')));
console.log('get user:0010  ->', db.get('user:0010'), '(deleted)');
console.log('scan [user:0020, user:0026):');
for (const [k, v] of db.scan('user:0020', 'user:0026')) console.log('  ', k, JSON.stringify(v));
console.log('stats          ->', JSON.stringify(db.stats), 'tables on disk:', db.tables.length);
db.close();

const reopened = new LSMStore(dir);
console.log('after reopen   ->', JSON.stringify(reopened.get('user:0005')), 'live keys:', [...reopened.scan()].length);
reopened.close();
fs.rmSync(dir, { recursive: true });
