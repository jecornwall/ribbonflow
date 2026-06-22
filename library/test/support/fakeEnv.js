// flow/library/test/support/fakeEnv.js
/**
 * fakeEnv.js — deterministic browser-env fakes for headless renderer tests.
 * NOT a *.test.js file, so the node --test glob ignores it; tests import it.
 */

/** A controllable requestAnimationFrame/cancelAnimationFrame/now scheduler. */
export function makeFakeScheduler() {
  let nextId = 1
  let t = 0
  const pending = new Map() // id → callback
  return {
    now: () => t,
    raf: (cb) => { const id = nextId++; pending.set(id, cb); return id },
    caf: (id) => { pending.delete(id) },
    /** Advance time by dtMs and run exactly the frames currently scheduled. */
    tick(dtMs = 16) {
      t += dtMs
      // Snapshot + clear BEFORE running, so a callback that re-schedules via raf()
      // runs on the NEXT tick, not this one (no re-entrant infinite loop).
      const due = [...pending.entries()]
      pending.clear()
      for (const [, cb] of due) cb(t)
    },
    pendingCount: () => pending.size,
  }
}

/**
 * A fake IntersectionObserver + a document stub with a settable hidden flag and
 * a working addEventListener/removeEventListener for 'visibilitychange'.
 */
export function makeFakeIntersection() {
  let observerCb = null
  const listeners = new Set()
  const doc = {
    hidden: false,
    addEventListener: (type, fn) => { if (type === 'visibilitychange') listeners.add(fn) },
    removeEventListener: (type, fn) => { if (type === 'visibilitychange') listeners.delete(fn) },
  }
  class FakeIO {
    constructor(cb) { observerCb = cb; this.observing = [] }
    observe(el) { this.observing.push(el) }
    disconnect() { observerCb = null }
  }
  return {
    IntersectionObserver: FakeIO,
    document: doc,
    /** Simulate the embed entering/leaving the viewport. */
    setIntersecting(v) { observerCb?.([{ isIntersecting: v }]) },
    /** Simulate the tab being backgrounded/foregrounded. */
    setHidden(v) { doc.hidden = v; listeners.forEach((fn) => fn()) },
    hasObserver: () => observerCb !== null,
  }
}
