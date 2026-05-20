<!--
  FlowAgent.vue — one agent rendered as a single SVG circle.

  Props:
    x, y     — position in viewBox units
    radius   — defaults to 3.5 (matches PARTICLE_RADIUS=3 in flowCurve.js, with
               half a unit of visual padding so the cream circle reads
               clearly at the rendered projection scale — spec §237 calls
               for "circles of radius 3, so they read clearly inside the
               ink ribbon"; r=3 is just below the legibility floor when
               the deck is scaled down for review captures, so we render
               at r=3.5 while keeping the physics radius at 3 unchanged)
    color    — defaults to '#F4F2ED' (cream, for contrast against ink ribbon)

  Stateless: the parent supplies position from the simulation.

  Implementation notes:
    - stroke="none" is set explicitly to defeat any global SVG-circle stroke
      that Tufte/Slidev theme CSS might inject.
    - shape-rendering="geometricPrecision" so anti-aliasing doesn't muddy
      the cream against ink at small radii.
-->
<template>
  <circle
    :cx="x"
    :cy="y"
    :r="radius"
    :fill="color"
    :data-agent-id="agentId"
    stroke="none"
    shape-rendering="geometricPrecision"
  />
</template>

<script setup>
// `agentId` is stamped onto the circle as `data-agent-id` — render-inert, but
// it lets a browser test follow an individual agent frame-to-frame (the
// bd ai-engineer-e0cj no-teleport verification). Optional, so any non-agent
// caller is unaffected.
defineProps({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  radius: { type: Number, default: 3.5 },
  color: { type: String, default: '#F4F2ED' },
  agentId: { type: [String, Number], default: undefined },
})
</script>
