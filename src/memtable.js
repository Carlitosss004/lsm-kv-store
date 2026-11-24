'use strict';

/** In-memory sorted map. Values of `null` are tombstones. */
class MemTable {
  constructor() {
    this.keys = [];
    this.map = new Map();
  }

  get size() {
    return this.keys.length;
  }

  _lowerBound(key) {
    let lo = 0;
    let hi = this.keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.keys[mid] < key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  set(key, value) {
    if (!this.map.has(key)) this.keys.splice(this._lowerBound(key), 0, key);
    this.map.set(key, value);
  }

  has(key) {
    return this.map.has(key);
  }

  get(key) {
    return this.map.get(key);
  }

  *entries(start = null, end = null) {
    for (let i = start === null ? 0 : this._lowerBound(start); i < this.keys.length; i++) {
      const k = this.keys[i];
      if (end !== null && k >= end) return;
      yield [k, this.map.get(k)];
    }
  }
}

module.exports = { MemTable };
