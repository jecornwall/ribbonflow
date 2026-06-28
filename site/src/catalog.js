// catalog.js — build-time catalog of the curated flows.
//
// Vite eager-globs examples/curated.json (the allow-list + friendly copy),
// every set.json (slugs/titles/transition), and every *.flow.json envelope,
// and assembles them into the structure the gallery + viewer render.
import curated from '../../examples/curated.json'

const setMetas = import.meta.glob('../../examples/*/set.json', {
  eager: true,
  import: 'default',
})
const envelopes = import.meta.glob('../../examples/*/*.flow.json', {
  eager: true,
  import: 'default',
})

const setMetaFor = (dir) => setMetas[`../../examples/${dir}/set.json`]
const envelopeFor = (dir, slug) => envelopes[`../../examples/${dir}/${slug}.flow.json`]

function buildCatalog() {
  return curated.sets.map(({ dir, title, caption }) => {
    const meta = setMetaFor(dir)
    if (!meta) throw new Error(`curated set "${dir}" has no examples/${dir}/set.json`)
    const states = meta.flows.map(({ slug, title: stateTitle }) => {
      const envelope = envelopeFor(dir, slug)
      if (!envelope) throw new Error(`missing examples/${dir}/${slug}.flow.json`)
      return { slug, title: stateTitle, envelope }
    })
    return { id: dir, title, caption, transition: meta.transition || null, states }
  })
}

export const catalog = buildCatalog()

/** Look up one state by `"<dir>__<slug>"` (the viewer's ?id param). */
export function findFlow(id) {
  const sep = String(id || '').indexOf('__')
  if (sep < 0) return null
  const dir = id.slice(0, sep)
  const slug = id.slice(sep + 2)
  const set = catalog.find((s) => s.id === dir)
  return set?.states.find((st) => st.slug === slug) || null
}
