/**
 * rng.js — small, optional seedable PRNG for reproducible simulations.
 *
 * `createFlowSimulation` uses `Math.random()` at two timing-sensitive sites
 * (spawnPosition lateral jitter, revise-probability draw). Unseeded that is
 * fine for production playback, but it makes probabilistic engine tests
 * non-reproducible — the realised rejection/split frequencies drift run to
 * run.
 *
 * Threading an optional `{ seed }` through `createFlowSimulation` swaps
 * `Math.random` for a deterministic generator so timing-sensitive tests can
 * assert bit-exactly. Default (no seed) keeps `Math.random` — production
 * behaviour is byte-identical and nothing changes for the deck.
 *
 * mulberry32: a well-known 32-bit PRNG — tiny, fast, no dependencies, good
 * enough statistical quality for jitter/probability draws (not for crypto).
 */

/**
 * Build a deterministic [0, 1) generator seeded from `seed`.
 * @param {number} seed — any integer; coerced to uint32.
 * @returns {() => number} a function returning a float in [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Resolve a random source for the simulation.
 * @param {number|undefined|null} seed — if a number, returns a seeded
 *   mulberry32 generator; otherwise returns `Math.random` unchanged.
 * @returns {() => number}
 */
export function resolveRng(seed) {
  return typeof seed === 'number' ? mulberry32(seed) : Math.random
}
