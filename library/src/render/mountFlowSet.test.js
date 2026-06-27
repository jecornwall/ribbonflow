// flow/library/src/render/mountFlowSet.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { mountFlowSet } from './mountFlowSet.js'
import { mountFlow } from './mountFlow.js'
import { serializeFlowSet } from '../format/flowSet.js'
import { makeFakeScheduler, makeFakeIntersection } from '../../test/support/fakeEnv.js'

function host() {
  const { document } = parseHTML('<!doctype html><html><body><div id="host"></div></body></html>')
  return { document, el: document.getElementById('host') }
}

// A minimal, normalize-able single flow tagged so a slot's mounted state is
// identifiable by node id after normalizeFlowSet clones + normalizes it.
function stateFlow(tag) {
  return {
    viewBox: { w: 1600, h: 900 },
    entryId: `entry-${tag}`,
    spawnRate: 1,
    initialAgents: 4,
    nodes: [
      { id: `entry-${tag}`, x: 200, y: 450, label: tag, capacity: 1, latency: 0.6, successors: [`sink-${tag}`] },
      { id: `sink-${tag}`, x: 1200, y: 450, label: 'end', capacity: 1, latency: 0.6, successors: [] },
    ],
  }
}

// A raw flow-set object: ordered { key, flow } states + optional meta.
function rawSet(tags, meta = {}) {
  return {
    states: tags.map((t, i) => ({ key: `state-${i}`, flow: stateFlow(t) })),
    ...meta,
  }
}

// True when a nested renderer was (re)mounted onto the state tagged `tag`.
function mountedOn(inst, tag) {
  return !!(inst && inst.flow && inst.flow.nodes &&
    inst.flow.nodes.some((n) => n.id === `entry-${tag}`))
}

function opacityOf(el) {
  const m = (el.getAttribute('style') || '').match(/opacity:\s*([0-9.]+)/)
  return m ? parseFloat(m[1]) : null
}

function zIndexOf(el) {
  const m = (el.getAttribute('style') || '').match(/z-index:\s*([0-9.]+)/)
  return m ? parseInt(m[1], 10) : null
}

// A spy nested-renderer factory: records every (el, flow) it is handed, every
// update(), and destroy(). Lets the outer crossfade timeline be unit-tested
// without driving three concurrent fake observers.
function spyFactory() {
  const instances = []
  const fn = (el, flow, opts) => {
    const inst = {
      el, flow, opts, updates: [], destroyed: false,
      update(f) { inst.flow = f; inst.updates.push(f) },
      destroy() { inst.destroyed = true },
    }
    instances.push(inst)
    return inst
  }
  fn.instances = instances
  return fn
}

// Unit opts: spy factory + fake outer scheduler + fake IntersectionObserver
// (NOT intersecting until setIntersecting(true), so nothing runs at mount).
function unitOpts(h, extra = {}) {
  const sched = makeFakeScheduler()
  const inter = makeFakeIntersection()
  const mf = spyFactory()
  return {
    sched, inter, mf,
    value: {
      document: h.document,
      mountFlow: mf,
      raf: sched.raf, caf: sched.caf,
      IntersectionObserver: inter.IntersectionObserver,
      visibilityDocument: inter.document,
      ...extra,
    },
  }
}

// Integration opts: the REAL nested single-flow mountFlow, no injected
// IntersectionObserver (everything assumes-visible and runs on one shared
// fake scheduler). Exercises the genuine slot composition under linkedom.
function integrationOpts(h, extra = {}) {
  const sched = makeFakeScheduler()
  return {
    sched,
    value: {
      document: h.document,
      mountFlow, // the real Phase-2a single-flow renderer
      raf: sched.raf, caf: sched.caf,
      ...extra,
    },
  }
}

// ── Task 1: detection / resolve / scaffold / initial styling / destroy ────────

test('mountFlowSet: resolves a raw flow-set into a player with two crossfade slots', () => {
  const h = host()
  const { value, mf } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b']), value)
  const root = h.el.querySelector('.flow-set-player')
  assert.ok(root, 'a flow-set-player root was mounted')
  assert.equal(root.querySelectorAll('.fsp-slot').length, 2, 'exactly two crossfade slots')
  assert.equal(mf.instances.length, 2, 'one nested renderer per slot')
  handle.destroy()
})

test('mountFlowSet: resolves a flow-set ENVELOPE the same as a raw set', () => {
  const h = host()
  const { value } = unitOpts(h)
  const envelope = serializeFlowSet(rawSet(['a', 'b'])) // canonical JSON envelope string
  const handle = mountFlowSet(h.el, envelope, value)
  assert.equal(h.el.querySelectorAll('.fsp-slot').length, 2)
  handle.destroy()
})

test('mountFlowSet: both slots start mounted on state 0', () => {
  const h = host()
  const { value, mf } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b']), value)
  for (const inst of mf.instances) {
    assert.ok(mountedOn(inst, 'a'), 'slot mounted on state 0 (tag "a")')
  }
  handle.destroy()
})

test('mountFlowSet: requires an injected opts.mountFlow factory', () => {
  const h = host()
  const { value } = unitOpts(h)
  delete value.mountFlow
  assert.throws(() => mountFlowSet(h.el, rawSet(['a', 'b']), value), /mountFlow/i)
})

test('mountFlowSet: initial styling — root relative, active slot opaque, hidden slot transparent', () => {
  const h = host()
  const { value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b']), value)
  const root = h.el.querySelector('.flow-set-player')
  assert.match(root.getAttribute('style') || '', /position:\s*relative/)
  const slots = [...h.el.querySelectorAll('.fsp-slot')]
  assert.equal(opacityOf(slots[0]), 1, 'active slot (0) fully opaque')
  assert.equal(opacityOf(slots[1]), 0, 'hidden slot (1) transparent')
  handle.destroy()
})

test('mountFlowSet: destroy tears down both nested renderers and removes the root', () => {
  const h = host()
  const { value, mf } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b']), value)
  handle.destroy()
  assert.ok(mf.instances.length === 2 && mf.instances.every((i) => i.destroyed), 'both nested renderers destroyed')
  assert.equal(h.el.querySelector('.flow-set-player'), null, 'root removed from host')
})

// ── Task 2: gated rAF timeline — hold→transition→hold, loop / non-loop, gate ──

// A short timeline so a handful of 16ms ticks crosses each phase.
const FAST = { transition: { holdMs: 30, durationMs: 30, easing: 'linear' } }

test('mountFlowSet: on show, autoplay starts and an outer frame is scheduled', () => {
  const h = host()
  const { sched, inter, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b'], FAST), value)
  assert.equal(handle.playing, false, 'idle until visible')
  assert.equal(sched.pendingCount(), 0, 'no outer frame before show')
  inter.setIntersecting(true)
  assert.ok(handle.playing, 'autoplay started on show')
  assert.equal(handle.currentIndex, 0, 'starts at state 0')
  assert.ok(sched.pendingCount() > 0, 'outer timeline frame scheduled on show')
  handle.destroy()
})

test('mountFlowSet: auto-advances hold → transition → hold across states', () => {
  const h = host()
  const { sched, inter, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b', 'c'], { ...FAST, loop: false }), value)
  inter.setIntersecting(true)
  assert.equal(handle.currentIndex, 0)
  let guard = 0
  while (handle.currentIndex === 0 && guard++ < 80) sched.tick(16)
  assert.equal(handle.currentIndex, 1, 'advanced 0 → 1')
  guard = 0
  while (handle.currentIndex === 1 && guard++ < 80) sched.tick(16)
  assert.equal(handle.currentIndex, 2, 'advanced 1 → 2')
  handle.destroy()
})

test('mountFlowSet: a non-looping set stops on the last state', () => {
  const h = host()
  const { sched, inter, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b'], { ...FAST, loop: false }), value)
  inter.setIntersecting(true)
  for (let i = 0; i < 40; i++) sched.tick(16)
  assert.equal(handle.currentIndex, 1, 'rests on the last state')
  assert.equal(handle.playing, false, 'playback stopped at the end of a non-looping set')
  handle.destroy()
})

test('mountFlowSet: a looping set wraps from the last state back to the first', () => {
  const h = host()
  const { sched, inter, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b'], { ...FAST, loop: true }), value)
  inter.setIntersecting(true)
  let guard = 0
  while (handle.currentIndex === 0 && guard++ < 80) sched.tick(16)
  assert.equal(handle.currentIndex, 1, 'advanced to the last state')
  guard = 0
  while (handle.currentIndex === 1 && guard++ < 80) sched.tick(16)
  assert.equal(handle.currentIndex, 0, 'looped back to the first state')
  assert.ok(handle.playing, 'still playing after the loop')
  handle.destroy()
})

test('mountFlowSet: a transition remounts ONLY the hidden slot (visible slot never remounts)', () => {
  const h = host()
  const { sched, inter, mf, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b'], { ...FAST, loop: false }), value)
  inter.setIntersecting(true)
  const [s0, s1] = mf.instances // s0 = active slot (active=0), s1 = hidden slot
  const outgoingRemountsAtStart = s0.updates.length
  // Tick until the hidden slot is remounted onto state 1 — i.e. the transition begins.
  let guard = 0
  while (!mountedOn(s1, 'b') && guard++ < 80) sched.tick(16)
  assert.ok(mountedOn(s1, 'b'), 'incoming (hidden) slot remounted onto state 1')
  assert.equal(
    s0.updates.length,
    outgoingRemountsAtStart,
    'outgoing visible slot was NOT remounted during the transition',
  )
  handle.destroy()
})

test('mountFlowSet: visibility gate resets to state 0 on show and stops on hide (pile-up fix)', () => {
  const h = host()
  const { sched, inter, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b'], { ...FAST, loop: true }), value)
  inter.setIntersecting(true)
  let guard = 0
  while (handle.currentIndex === 0 && guard++ < 80) sched.tick(16)
  assert.equal(handle.currentIndex, 1, 'advanced to state 1 while visible')
  inter.setIntersecting(false) // hide → stopLoop
  assert.equal(handle.playing, false, 'stopped on hide')
  assert.equal(sched.pendingCount(), 0, 'no outer frame scheduled while hidden')
  inter.setIntersecting(true) // re-show → startFresh
  assert.equal(handle.currentIndex, 0, 're-show reset the timeline to state 0 (pile-up fix)')
  assert.ok(handle.playing, 're-show restarted playback')
  handle.destroy()
})

test('mountFlowSet: destroy cancels the outer timeline frame (no leak)', () => {
  const h = host()
  const { sched, inter, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b'], FAST), value)
  inter.setIntersecting(true)
  sched.tick(16)
  assert.ok(sched.pendingCount() > 0, 'timeline frame scheduled while visible')
  handle.destroy()
  assert.equal(sched.pendingCount(), 0, 'destroy cancelled the outer timeline frame')
  sched.tick(16)
  assert.equal(sched.pendingCount(), 0, 'and no frame re-armed after destroy')
})

// ── Task 3: manual controls — play/pause/toggle/next/prev/jumpTo + getters ────

// holdMs huge so auto-advance never fires — manual controls drive the timeline.
const HOLD_PAUSED = { transition: { holdMs: 10_000_000, durationMs: 30, easing: 'linear' } }

test('mountFlowSet: pause/play/toggle flip the playing flag', () => {
  const h = host()
  const { inter, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b'], HOLD_PAUSED), value)
  inter.setIntersecting(true)
  assert.equal(handle.playing, true, 'autoplay on show')
  handle.pause()
  assert.equal(handle.playing, false, 'pause stops playback')
  handle.play()
  assert.equal(handle.playing, true, 'play resumes')
  handle.toggle()
  assert.equal(handle.playing, false, 'toggle off')
  handle.toggle()
  assert.equal(handle.playing, true, 'toggle on')
  handle.destroy()
})

test('mountFlowSet: next() crossfades to the following state, prev() back', () => {
  const h = host()
  const { sched, inter, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b', 'c'], HOLD_PAUSED), value)
  inter.setIntersecting(true)
  assert.equal(handle.currentIndex, 0)
  handle.next()
  let guard = 0
  while (handle.currentIndex === 0 && guard++ < 80) sched.tick(16)
  assert.equal(handle.currentIndex, 1, 'next() advanced 0 → 1')
  handle.prev()
  guard = 0
  while (handle.currentIndex === 1 && guard++ < 80) sched.tick(16)
  assert.equal(handle.currentIndex, 0, 'prev() retreated 1 → 0')
  handle.destroy()
})

test('mountFlowSet: next() is ignored mid-transition (only fires from hold)', () => {
  const h = host()
  const { sched, inter, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b', 'c'], HOLD_PAUSED), value)
  inter.setIntersecting(true)
  handle.next() // begin 0 → 1
  sched.tick(16) // enter the transition (not yet finished)
  handle.next() // no-op mid-transition
  let guard = 0
  while (handle.currentIndex === 0 && guard++ < 80) sched.tick(16)
  assert.equal(handle.currentIndex, 1, 'only the first next() took effect (landed on 1, not 2)')
  handle.destroy()
})

test('mountFlowSet: jumpTo() hard-cuts the active slot to a non-adjacent state', () => {
  const h = host()
  const { inter, mf, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b', 'c'], HOLD_PAUSED), value)
  inter.setIntersecting(true)
  const activeRenderer = mf.instances[0] // active = slot 0 after a fresh show
  handle.jumpTo(2)
  assert.equal(handle.currentIndex, 2, 'jumped straight to state 2 (no crossfade)')
  assert.ok(mountedOn(activeRenderer, 'c'), 'active slot remounted onto state 2')
  handle.destroy()
})

test('mountFlowSet: jumpTo() ignores out-of-range indices', () => {
  const h = host()
  const { inter, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b'], HOLD_PAUSED), value)
  inter.setIntersecting(true)
  handle.jumpTo(5)
  assert.equal(handle.currentIndex, 0, 'out-of-range jump is a no-op')
  handle.jumpTo(-1)
  assert.equal(handle.currentIndex, 0, 'negative jump is a no-op')
  handle.destroy()
})

// ── Task 4: crossfade opacity easing + zIndex swap ────────────────────────────

// 64ms duration + easeInOut so the eased shape is measurable at a 25% sample.
const EASE = { transition: { holdMs: 10_000_000, durationMs: 64, easing: 'easeInOut' } }

test('mountFlowSet: the incoming slot opacity eases in during a transition', () => {
  const h = host()
  const { sched, inter, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b'], EASE), value)
  inter.setIntersecting(true)
  const slots = [...h.el.querySelectorAll('.fsp-slot')]
  handle.next() // begin 0 → 1 (incoming = slot 1)
  sched.tick(16) // elapsed 0 (first frame dt = 0)
  sched.tick(16) // elapsed 16 = 25% of 64ms
  const incoming = opacityOf(slots[1])
  // easeInOut(0.25) = 0.0625 — well below a linear ramp's 0.25. Proves the
  // easing FUNCTION is applied, not a bare linear fade.
  assert.ok(incoming > 0 && incoming < 0.2, `incoming opacity eased in (got ${incoming})`)
  assert.equal(opacityOf(slots[0]), 1, 'outgoing (active) slot stays fully opaque under the crossfade')
  handle.destroy()
})

test('mountFlowSet: after a transition completes, active flips, zIndex swaps, incoming settles opaque', () => {
  const h = host()
  const { sched, inter, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b'], EASE), value)
  inter.setIntersecting(true)
  const slots = [...h.el.querySelectorAll('.fsp-slot')]
  // Before: slot 0 active (z 1, opaque), slot 1 hidden (z 2, transparent — on top to fade in).
  assert.equal(zIndexOf(slots[0]), 1)
  assert.equal(zIndexOf(slots[1]), 2)
  handle.next()
  let guard = 0
  while (handle.currentIndex === 0 && guard++ < 80) sched.tick(16)
  assert.equal(handle.currentIndex, 1, 'transition completed')
  assert.equal(opacityOf(slots[1]), 1, 'incoming slot settled fully opaque')
  assert.equal(opacityOf(slots[0]), 0, 'outgoing slot is now hidden')
  assert.equal(zIndexOf(slots[1]), 1, 'new active slot dropped to z 1')
  assert.equal(zIndexOf(slots[0]), 2, 'old active slot rose to z 2')
  handle.destroy()
})

// ── Task 5: update(nextSet) + transparent single-flow regression (integration) ─

test('mountFlowSet: update(nextSet) re-resolves and resets onto the new set, reusing both slots', () => {
  const h = host()
  const { sched, inter, mf, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b'], FAST), value)
  inter.setIntersecting(true)
  let guard = 0
  while (handle.currentIndex === 0 && guard++ < 80) sched.tick(16)
  assert.equal(handle.currentIndex, 1, 'advanced off state 0 before the swap')

  handle.update(rawSet(['x', 'y', 'z'], FAST))
  assert.equal(handle.currentIndex, 0, 'reset to the new set state 0')
  assert.equal(mf.instances.length, 2, 'no new slots created — both nested renderers reused')
  assert.equal(h.el.querySelectorAll('.fsp-slot').length, 2, 'still exactly two slot hosts')
  for (const inst of mf.instances) {
    assert.ok(mountedOn(inst, 'x'), 'both slots remounted onto the new set state 0')
  }
  handle.destroy()
})

test('mountFlowSet: end-to-end — real nested renderers paint two slot svgs and crossfade', () => {
  const h = host()
  const { sched, value } = integrationOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b'], EASE), value)
  const slots = [...h.el.querySelectorAll('.fsp-slot')]
  assert.equal(slots.length, 2)
  for (const slot of slots) {
    assert.equal(
      slot.querySelectorAll('svg.flow-graph').length,
      1,
      'each slot holds exactly one nested flow svg',
    )
  }
  handle.next() // begin a crossfade through the real nested renderers
  for (let i = 0; i < 3; i++) sched.tick(16)
  const incoming = opacityOf(slots[1])
  assert.ok(incoming > 0, `real crossfade ramped the incoming slot (got ${incoming})`)
  handle.destroy()
  assert.equal(h.el.querySelector('.flow-set-player'), null, 'clean teardown removes the player')
})

test('mountFlowSet: update keeps exactly one nested svg per slot under real renderers (no leak)', () => {
  const h = host()
  const { sched, value } = integrationOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b'], EASE), value)
  for (let i = 0; i < 4; i++) sched.tick(16)
  handle.update(rawSet(['x', 'y', 'z'], EASE))
  const slots = [...h.el.querySelectorAll('.fsp-slot')]
  assert.equal(slots.length, 2, 'still exactly two slots after update')
  for (const slot of slots) {
    assert.equal(slot.querySelectorAll('svg.flow-graph').length, 1, 'one nested svg per slot after update')
  }
  assert.equal(handle.currentIndex, 0, 'update reset to the new set state 0')
  handle.destroy()
})

// ── Hardening: clean errors at the two opaque-crash gaps ──────────────────────

test('mountFlowSet: update() rejects a single flow with a clean mode-lock error', () => {
  const h = host()
  const { inter, value } = unitOpts(h)
  const handle = mountFlowSet(h.el, rawSet(['a', 'b']), value)
  inter.setIntersecting(true)
  assert.throws(
    () => handle.update(stateFlow('solo')), // a single flow, not a flow-set
    /re-mount to switch modes/i,
    'a single flow cannot be swapped into a flow-set handle',
  )
  // A rejected update must not corrupt the player — it keeps playing the old set.
  assert.equal(handle.currentIndex, 0, 'handle still valid after a rejected update')
  handle.destroy()
})

test('mountFlowSet: a 0-state flow-set throws a clear error at mount (not an opaque TypeError)', () => {
  const h = host()
  const { value } = unitOpts(h)
  assert.throws(
    () => mountFlowSet(h.el, { states: [] }, value),
    /no states/i,
    'an empty flow-set is rejected with a clear message, not states[0] undefined',
  )
})
