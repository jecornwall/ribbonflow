// flow/library/src/render/visibilityWiring.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { observeVisibility } from './visibilityWiring.js'
import { makeFakeIntersection } from '../../test/support/fakeEnv.js'

test('observeVisibility: fires onShow on rising edge, onHide on falling edge, once each', () => {
  const env = makeFakeIntersection()
  let shows = 0, hides = 0
  const handle = observeVisibility({}, { onShow: () => shows++, onHide: () => hides++ }, env)

  env.setIntersecting(true)   // visible → show
  assert.deepEqual([shows, hides], [1, 0])
  env.setIntersecting(true)   // no edge → no extra fire
  assert.deepEqual([shows, hides], [1, 0])
  env.setHidden(true)         // tab backgrounded → hide
  assert.deepEqual([shows, hides], [1, 1])
  env.setHidden(false)        // tab foregrounded + still intersecting → show
  assert.deepEqual([shows, hides], [2, 1])
  env.setIntersecting(false)  // off-screen → hide
  assert.deepEqual([shows, hides], [2, 2])

  handle.disconnect()
})

test('observeVisibility: disconnect detaches the observer + listener', () => {
  const env = makeFakeIntersection()
  let shows = 0
  const handle = observeVisibility({}, { onShow: () => shows++, onHide: () => {} }, env)
  handle.disconnect()
  assert.equal(env.hasObserver(), false)
  env.setIntersecting(true)   // no observer → no fire
  assert.equal(shows, 0)
})

test('observeVisibility: no IntersectionObserver in env → assume visible, fire onShow once', () => {
  let shows = 0
  const handle = observeVisibility({}, { onShow: () => shows++, onHide: () => {} }, { IntersectionObserver: undefined, document: undefined })
  assert.equal(shows, 1)
  handle.disconnect()
})

test('observeVisibility: null el with a valid IO → fallback, fire onShow once', () => {
  const env = makeFakeIntersection()
  let shows = 0
  observeVisibility(null, { onShow: () => shows++ }, env)
  assert.equal(shows, 1)
  assert.equal(env.hasObserver(), false) // never constructed an observer
})
