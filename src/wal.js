'use strict';
const fs = require('fs');

/**
 * Write-ahead log: one JSON record per line. A torn final line (crash
 * mid-write) is ignored on replay.
 */
class WAL {
  constructor(path) {
    this.path = path;
    this.fd = fs.openSync(path, 'a');
  }

  append(record) {
    fs.writeSync(this.fd, JSON.stringify(record) + '\n');
  }

  static replay(path) {
    if (!fs.existsSync(path)) return [];
    const records = [];
    for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        break; // torn write: everything after is unreliable
      }
    }
    return records;
  }

  reset() {
    fs.closeSync(this.fd);
    fs.writeFileSync(this.path, '');
    this.fd = fs.openSync(this.path, 'a');
  }

  close() {
    fs.closeSync(this.fd);
  }
}

module.exports = { WAL };
