// flow/parity/src/diff/extractScene.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { extractScene } from './extractScene.js'

// Parse an <svg>…</svg> string and return the root svg element.
function svg(markup) {
  const { document } = parseHTML(`<!doctype html><html><body>${markup}</body></html>`)
  return document.querySelector('svg')
}

const sortedByTag = (scene) => {
  const out = {}
  for (const [tag, keys] of Object.entries(scene.byTag)) out[tag] = [...keys].sort()
  return out
}

test('extractScene: reads viewBox and collects leaf shapes per tag', () => {
  const s = extractScene(
    svg(`<svg viewBox="0 0 1600 900" class="flow-graph">
      <g clip-path="url(#c)">
        <path d="M0 0 L10 10" fill="#e8d8b0"></path>
        <circle cx="5" cy="6" r="7" fill="#15171A"></circle>
        <line x1="1" y1="2" x2="1" y2="9" stroke="#555555" stroke-width="0.8"></line>
        <text x="10" y="20" text-anchor="middle" fill="#E2522B">review</text>
        <polygon points="0,0 1,0 1,1" fill="none" stroke="#15171A"></polygon>
      </g>
    </svg>`),
  )
  assert.equal(s.viewBox, '0 0 1600 900')
  assert.equal(s.byTag.path.length, 1)
  assert.equal(s.byTag.circle.length, 1)
  assert.equal(s.byTag.line.length, 1)
  assert.equal(s.byTag.text.length, 1)
  assert.equal(s.byTag.polygon.length, 1)
  // text content is part of the key
  assert.ok(s.byTag.text[0].includes('review'))
})

test('extractScene: EXCLUDES agents (data-agent-id) from both renderers', () => {
  const s = extractScene(
    svg(`<svg viewBox="0 0 100 100">
      <g class="flow-paint"><circle cx="1" cy="1" r="3" fill="#15171A"></circle></g>
      <g class="flow-agents">
        <circle cx="50" cy="50" r="3.5" fill="#F4F2ED" data-agent-id="7"></circle>
      </g>
    </svg>`),
  )
  assert.equal(s.byTag.circle.length, 1, 'only the junction disc, not the agent')
  assert.ok(!s.byTag.circle[0].includes('50'), 'the agent circle is excluded')
})

test('extractScene: EXCLUDES <defs> subtree (clip rects, filter/pattern internals)', () => {
  const s = extractScene(
    svg(`<svg viewBox="0 0 100 100">
      <defs>
        <clipPath id="c"><rect x="0" y="0" width="100" height="100"></rect></clipPath>
        <pattern id="h"><line x1="0" y1="0" x2="0" y2="6" stroke="#E2522B"></line></pattern>
      </defs>
      <g><rect x="2" y="3" width="200" height="14" fill="url(#h)" style="opacity:0.6"></rect></g>
    </svg>`),
  )
  assert.equal(s.byTag.rect.length, 1, 'only the painted hatch band, not the clip rect')
  assert.equal(s.byTag.line, undefined, 'pattern internals are not collected')
  assert.ok(s.byTag.rect[0].includes('0.6'), 'inline-style opacity is in the key')
})

// THE CENTERPIECE: the same flow rendered two structurally-different ways — the
// 3 known-inert deviations — extracts to the SAME scene.
test('extractScene: invariant to the 3 known deviations (wobble wrap / random ids / legend z-order)', () => {
  // "golden" (FlowGraph-style): ribbon wrapped in a wobble <g> with a RANDOM id,
  // legend polygon painted AFTER the agents group, random clip id.
  const golden = extractScene(
    svg(`<svg viewBox="0 0 1600 900">
      <defs><clipPath id="flow-clip-918273"><rect x="0" y="0" width="1600" height="900"></rect></clipPath></defs>
      <g clip-path="url(#flow-clip-918273)">
        <g filter="url(#flow-wobble-918273)">
          <path d="M0 0 L1600 0" fill="#e8d8b0"></path>
        </g>
        <g class="flow-agents"><circle cx="800" cy="450" r="3.5" fill="#F4F2ED" data-agent-id="1"></circle></g>
        <polygon points="40,833 160,821 160,849" fill="#15171A"></polygon>
      </g>
    </svg>`),
  )
  // "candidate" (mountFlow-style): ribbon wrapped in a DIFFERENT-id wobble <g>,
  // legend polygon painted BEFORE the agents group, different clip id.
  const candidate = extractScene(
    svg(`<svg viewBox="0 0 1600 900">
      <defs><clipPath id="flow-clip-0"><rect x="0" y="0" width="1600" height="900"></rect></clipPath></defs>
      <g clip-path="url(#flow-clip-0)">
        <g class="flow-paint" filter="url(#flow-wobble-0)">
          <path d="M0 0 L1600 0" fill="#e8d8b0"></path>
          <polygon points="40,833 160,821 160,849" fill="#15171A"></polygon>
        </g>
        <g class="flow-agents"><circle cx="800" cy="450" r="3.5" fill="#F4F2ED" data-agent-id="1"></circle></g>
      </g>
    </svg>`),
  )
  assert.deepEqual(sortedByTag(golden), sortedByTag(candidate))
  assert.equal(golden.viewBox, candidate.viewBox)
})

test('extractScene: float-formatting differences canonicalise away', () => {
  const a = extractScene(svg(`<svg viewBox="0 0 10 10"><path d="M0.10000 0 L450.0001 6.0" fill="#ABC"></path></svg>`))
  const b = extractScene(svg(`<svg viewBox="0 0 10 10"><path d="M0.1 0 L450 6" fill="#aabbcc"></path></svg>`))
  assert.deepEqual(a.byTag.path, b.byTag.path)
})

test('extractScene: text-transform:none is equivalent to no text-transform (CSS default)', () => {
  // FlowGraph emits `text-transform: none`; mountFlow omits it — visually identical.
  const withNone = extractScene(svg(`<svg viewBox="0 0 10 10"><text x="1" y="2" style="text-transform: none">x</text></svg>`))
  const without = extractScene(svg(`<svg viewBox="0 0 10 10"><text x="1" y="2">x</text></svg>`))
  assert.deepEqual(withNone.byTag.text, without.byTag.text)
})

test('extractScene: opacity:1 is equivalent to no opacity (CSS default)', () => {
  const withOne = extractScene(svg(`<svg viewBox="0 0 10 10"><path d="M0 0" fill="#a" style="opacity:1"></path></svg>`))
  const without = extractScene(svg(`<svg viewBox="0 0 10 10"><path d="M0 0" fill="#a"></path></svg>`))
  assert.deepEqual(withOne.byTag.path, without.byTag.path)
  // a genuine non-default opacity still differs (not masked):
  const half = extractScene(svg(`<svg viewBox="0 0 10 10"><path d="M0 0" fill="#a" style="opacity:0.5"></path></svg>`))
  assert.notDeepEqual(half.byTag.path, without.byTag.path)
})

test('extractScene: url(#id) refs on a LEAF (clip-path/filter/mask) canonicalise the id but keep presence', () => {
  // A leaf carrying clip-path with a random id (FlowGraph) vs deterministic id
  // (mountFlow) must MATCH (deviation #2) — but clip present vs absent must DIFFER.
  const rnd = extractScene(svg(`<svg viewBox="0 0 10 10"><path d="M0 0" fill="#a" clip-path="url(#flow-clip-918273)"></path></svg>`))
  const det = extractScene(svg(`<svg viewBox="0 0 10 10"><path d="M0 0" fill="#a" clip-path="url(#flow-clip-0)"></path></svg>`))
  assert.deepEqual(rnd.byTag.path, det.byTag.path, 'random vs deterministic clip id matches')
  const none = extractScene(svg(`<svg viewBox="0 0 10 10"><path d="M0 0" fill="#a"></path></svg>`))
  assert.notDeepEqual(rnd.byTag.path, none.byTag.path, 'clip present vs absent is a real divergence')
  const filt = extractScene(svg(`<svg viewBox="0 0 10 10"><path d="M0 0" fill="#a" filter="url(#flow-wobble-7)"></path></svg>`))
  assert.notDeepEqual(filt.byTag.path, none.byTag.path, 'filter present vs absent surfaces')
})

test('extractScene: resolves INHERITED group opacity (leaf × ancestors)', () => {
  // FlowGraph dims ghost markers via a parent <g style="opacity:0.3">; mountFlow
  // bakes 0.3 into the leaf. Both paint at effective opacity 0.3 — identical.
  const grouped = extractScene(
    svg(`<svg viewBox="0 0 10 10"><g class="ghost-markers" style="opacity:0.3"><text x="1" y="2">x</text></g></svg>`),
  )
  const leaf = extractScene(svg(`<svg viewBox="0 0 10 10"><text x="1" y="2" style="opacity:0.3">x</text></svg>`))
  assert.deepEqual(grouped.byTag.text, leaf.byTag.text)
  // and the effective value is the product, not just the leaf's own:
  const nested = extractScene(
    svg(`<svg viewBox="0 0 10 10"><g style="opacity:0.5"><line x1="0" y1="0" x2="1" y2="1" style="opacity:0.5"></line></g></svg>`),
  )
  assert.ok(nested.byTag.line[0].includes('op=0.25'), '0.5 × 0.5 = 0.25')
})
