/**
 * visibilityGate.test.js — pure visibility-gate logic (bd ai-engineer-f6pc).
 *
 * Written test-FIRST. The bug: every <FlowEmbed> flow simulation starts a RAF
 * loop at deck-load and runs in the background on every slide; over a 20-minute
 * talk the later slides' constraints show a piled-up backlog instead of a fresh
 * animation. The fix gates simulation start on slide visibility — a flow runs
 * only while its embed is BOTH on-screen and the browser tab is foregrounded,
 * and re-enters from a clean state every time the slide is opened.
 *
 * The Vue/IntersectionObserver wiring lives in useVisibilityGate.js and is
 * verified in a browser (Playwright). The DECISION logic — when is a flow
 * "running-eligible", and on which raw-input transitions do we fire the
 * show/hide side effects — is pure and unit-tested here, matching the
 * library's pure-logic testing register (flowCurve / useFlowSimulation).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveVisible, createVisibilityGate } from './visibilityGate.js'

// ── resolveVisible: the running-eligibility truth table ───────────────────────

test('resolveVisible — running-eligible only when on-screen AND tab foregrounded', () => {
  assert.equal(resolveVisible({ intersecting: true, documentHidden: false }), true)
  assert.equal(resolveVisible({ intersecting: false, documentHidden: false }), false)
  // Tab backgrounded masks an on-screen embed — a hidden tab must not simulate.
  assert.equal(resolveVisible({ intersecting: true, documentHidden: true }), false)
  assert.equal(resolveVisible({ intersecting: false, documentHidden: true }), false)
})

test('resolveVisible — coerces missing / undefined inputs to false', () => {
  assert.equal(resolveVisible({}), false)
  assert.equal(resolveVisible({ intersecting: true }), true) // documentHidden undefined → not hidden
  assert.equal(resolveVisible({ intersecting: undefined, documentHidden: undefined }), false)
})

// ── createVisibilityGate: edge-triggered show/hide transitions ────────────────

test('gate — first update into the visible state reports a "show" edge', () => {
  const gate = createVisibilityGate()
  assert.equal(gate.visible, false)
  assert.equal(gate.update({ intersecting: true, documentHidden: false }), 'show')
  assert.equal(gate.visible, true)
})

test('gate — staying visible across updates reports no further edge', () => {
  const gate = createVisibilityGate()
  assert.equal(gate.update({ intersecting: true, documentHidden: false }), 'show')
  assert.equal(gate.update({ intersecting: true, documentHidden: false }), null)
  assert.equal(gate.update({ intersecting: true, documentHidden: false }), null)
})

test('gate — leaving the visible state reports exactly one "hide" edge', () => {
  const gate = createVisibilityGate()
  gate.update({ intersecting: true, documentHidden: false })
  assert.equal(gate.update({ intersecting: false, documentHidden: false }), 'hide')
  assert.equal(gate.visible, false)
  assert.equal(gate.update({ intersecting: false, documentHidden: false }), null)
})

test('gate — backgrounding the tab while on-screen reports a "hide" edge', () => {
  const gate = createVisibilityGate()
  gate.update({ intersecting: true, documentHidden: false })
  assert.equal(gate.update({ intersecting: true, documentHidden: true }), 'hide')
  // Foregrounding again while still on-screen reports "show".
  assert.equal(gate.update({ intersecting: true, documentHidden: false }), 'show')
})

test('gate — a full slide-visit cycle replays show → hide → show', () => {
  const gate = createVisibilityGate()
  const edges = []
  for (const inputs of [
    { intersecting: false, documentHidden: false }, // mounted off-slide
    { intersecting: true, documentHidden: false },  // slide opened
    { intersecting: true, documentHidden: false },  // still here
    { intersecting: false, documentHidden: false }, // slide left
    { intersecting: true, documentHidden: false },  // slide re-opened
  ]) {
    const edge = gate.update(inputs)
    if (edge) edges.push(edge)
  }
  assert.deepEqual(edges, ['show', 'hide', 'show'])
})

test('gate — initialVisible:true suppresses a redundant first "show"', () => {
  const gate = createVisibilityGate({ initialVisible: true })
  assert.equal(gate.visible, true)
  assert.equal(gate.update({ intersecting: true, documentHidden: false }), null)
  assert.equal(gate.update({ intersecting: false, documentHidden: false }), 'hide')
})
