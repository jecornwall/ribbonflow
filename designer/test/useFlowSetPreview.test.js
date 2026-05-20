/**
 * useFlowSetPreview.test.js — unit tests for the flow-set transition
 * persistence path (bd ai-engineer-7gea).
 *
 * useFlowSetPreview.js is a Vue + library-coupled module singleton — its
 * `internals` barrel pulls in renderer .vue files, so the module itself is
 * not loadable under plain `node --test` (the same reason flowMutations.test.js
 * gives for keeping round-trip coverage in Playwright). The persistence path
 * is therefore extracted into transitionSaver.js — a Vue-free, library-free
 * unit — and exercised here directly: a mock saveSetMeta, deterministic fake
 * timers, and assertions on the debounced payload.
 *
 * What the Vue watcher in useFlowSetPreview.js contributes (the justLoaded
 * guard, the setMeta.id null-check) is glue over this saver; their integration
 * is covered by the designer's Playwright set-preview drive.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import {
  createTransitionSaver,
  TRANSITION_SAVE_DEBOUNCE_MS,
} from '../src/state/transitionSaver.js'

/** A saveSetMeta test double — records every (setId, meta) call. */
function makeSaveSetMeta() {
  const calls = []
  const fn = (setId, meta) => { calls.push({ setId, meta }) }
  fn.calls = calls
  return fn
}

test('a scheduled save fires saveSetMeta once, after the debounce window', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const saveSetMeta = makeSaveSetMeta()
    const saver = createTransitionSaver(saveSetMeta)

    saver.schedule('set-a', { durationMs: 800, easing: 'ease-in-out' })
    // Nothing persists before the window elapses.
    mock.timers.tick(TRANSITION_SAVE_DEBOUNCE_MS - 1)
    assert.equal(saveSetMeta.calls.length, 0, 'save must not fire early')
    assert.equal(saver.pending(), true, 'a save is pending inside the window')

    mock.timers.tick(1)
    assert.equal(saveSetMeta.calls.length, 1, 'save fires exactly once')
    assert.equal(saver.pending(), false, 'no save pending after it fires')
  } finally {
    mock.timers.reset()
  }
})

test('the debounce payload is { transition } carrying the scheduled value', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const saveSetMeta = makeSaveSetMeta()
    const saver = createTransitionSaver(saveSetMeta)

    saver.schedule('set-xyz', { durationMs: 1200, easing: 'linear', holdMs: 300 })
    mock.timers.tick(TRANSITION_SAVE_DEBOUNCE_MS)

    assert.equal(saveSetMeta.calls.length, 1)
    const { setId, meta } = saveSetMeta.calls[0]
    assert.equal(setId, 'set-xyz', 'setId is forwarded unchanged')
    assert.deepEqual(meta, {
      transition: { durationMs: 1200, easing: 'linear', holdMs: 300 },
    }, 'payload is { transition } wrapping the scheduled object')
  } finally {
    mock.timers.reset()
  }
})

test('rapid schedules within the window coalesce into one save with the last value', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const saveSetMeta = makeSaveSetMeta()
    const saver = createTransitionSaver(saveSetMeta)

    // A burst of slider ticks — each restarts the debounce window.
    saver.schedule('set-1', { durationMs: 400, easing: 'linear' })
    mock.timers.tick(200)
    saver.schedule('set-1', { durationMs: 500, easing: 'linear' })
    mock.timers.tick(200)
    saver.schedule('set-1', { durationMs: 900, easing: 'ease-out' })
    // Only 400 ms have passed since the last schedule — no save yet.
    mock.timers.tick(TRANSITION_SAVE_DEBOUNCE_MS - 1)
    assert.equal(saveSetMeta.calls.length, 0, 'burst is still debouncing')

    mock.timers.tick(1)
    assert.equal(saveSetMeta.calls.length, 1, 'the burst collapses to one save')
    assert.deepEqual(saveSetMeta.calls[0].meta, {
      transition: { durationMs: 900, easing: 'ease-out' },
    }, 'the last scheduled value wins')
  } finally {
    mock.timers.reset()
  }
})

test('the payload is snapshotted — mutating the transition after schedule does not leak', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const saveSetMeta = makeSaveSetMeta()
    const saver = createTransitionSaver(saveSetMeta)

    // The set-preview controls mutate the live transition object in place.
    const liveTransition = { durationMs: 600, easing: 'linear' }
    saver.schedule('set-9', liveTransition)
    // ...the user keeps dragging after the schedule landed.
    liveTransition.durationMs = 5000
    liveTransition.easing = 'ease-in'

    mock.timers.tick(TRANSITION_SAVE_DEBOUNCE_MS)
    assert.deepEqual(saveSetMeta.calls[0].meta, {
      transition: { durationMs: 600, easing: 'linear' },
    }, 'the saved value is the snapshot taken at schedule time')
  } finally {
    mock.timers.reset()
  }
})

test('cancel() drops a pending save', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const saveSetMeta = makeSaveSetMeta()
    const saver = createTransitionSaver(saveSetMeta)

    saver.schedule('set-c', { durationMs: 700, easing: 'linear' })
    assert.equal(saver.pending(), true)
    saver.cancel()
    assert.equal(saver.pending(), false, 'cancel clears the pending flag')

    mock.timers.tick(TRANSITION_SAVE_DEBOUNCE_MS * 2)
    assert.equal(saveSetMeta.calls.length, 0, 'a cancelled save never fires')
  } finally {
    mock.timers.reset()
  }
})

test('a custom delay overrides the default debounce window', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const saveSetMeta = makeSaveSetMeta()
    const saver = createTransitionSaver(saveSetMeta, { delay: 50 })

    saver.schedule('set-d', { durationMs: 300, easing: 'linear' })
    mock.timers.tick(49)
    assert.equal(saveSetMeta.calls.length, 0)
    mock.timers.tick(1)
    assert.equal(saveSetMeta.calls.length, 1, 'fires at the custom delay')
  } finally {
    mock.timers.reset()
  }
})
