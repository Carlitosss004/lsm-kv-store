'use strict';

/**
 * K-way merge of sorted [key, value] iterables. `sources` are ordered newest
 * first; when several sources hold the same key the newest wins.
 */
function* mergeSources(sources) {
  const its = sources.map((s) => s[Symbol.iterator]());
  const heads = its.map((it) => it.next());
  for (;;) {
    let min = null;
    for (const h of heads) if (!h.done && (min === null || h.value[0] < min)) min = h.value[0];
    if (min === null) return;
    let chosen;
    let have = false;
    for (let i = 0; i < heads.length; i++) {
      if (!heads[i].done && heads[i].value[0] === min) {
        if (!have) {
          chosen = heads[i].value;
          have = true;
        }
        heads[i] = its[i].next();
      }
    }
    yield chosen;
  }
}

module.exports = { mergeSources };
