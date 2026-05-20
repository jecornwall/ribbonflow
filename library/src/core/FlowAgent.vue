<!--
  FlowAgent.vue — one agent rendered as a single SVG circle.

  Props:
    x, y     — position in viewBox units
    radius   — RENDER radius in viewBox units, defaults to 3.5 (= the small
               particle's render radius, RENDER_RADIUS_SMALL). The default
               matches PARTICLE_RADIUS=3 in flowCurve.js with half a unit of
               visual padding so the cream circle reads clearly at the
               rendered projection scale — r=3 is just below the legibility
               floor when the deck is scaled down for review captures, so we
               render at r=3.5 while keeping the physics radius at 3 unchanged.
               v1.3 L4: FlowGraph passes a per-agent render radius derived from
               the agent's size (agentRender.renderRadiusForAgent) — a LARGE
               particle renders at exactly 3× this (r=10.5). Same colour for
               both sizes; size alone carries the meaning (Jason, spec §4).
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
