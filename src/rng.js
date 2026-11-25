// Seeded RNG (mulberry32). Same seed => same world, which is what keeps saves small.
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    normal: () => {
      let u = 0, v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    // weighted pick: items [{w, ...}] or parallel weights array
    weighted: (items, weights) => {
      const ws = weights || items.map((i) => i.w);
      let total = 0;
      for (const w of ws) total += Math.max(0, w);
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= Math.max(0, ws[i]);
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    },
    seedChild: (label) => makeRng(hashString(String(a) + ':' + label)),
    state: () => a,
  };
  return rng;
}
