// gen-seed.mjs — generate designer/public/seed.json from the curated examples.
// Run by the `build:site` script before `vite build`. Output is gitignored.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildSeedBlob } from '../src/seed/buildSeedBlob.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)) // designer/scripts → repo/
const examplesDir = path.join(repoRoot, 'examples')
const curated = JSON.parse(readFileSync(path.join(examplesDir, 'curated.json'), 'utf8'))

function loadSet(dir) {
  const meta = JSON.parse(readFileSync(path.join(examplesDir, dir, 'set.json'), 'utf8'))
  const flows = meta.flows.map(({ slug, title }) => ({
    slug,
    title,
    envelope: JSON.parse(readFileSync(path.join(examplesDir, dir, `${slug}.flow.json`), 'utf8')),
  }))
  return { id: meta.id, title: meta.title, transition: meta.transition, flows }
}

const blob = buildSeedBlob(curated.sets.map((s) => loadSet(s.dir)), new Date().toISOString())
const outDir = fileURLToPath(new URL('../public/', import.meta.url))
mkdirSync(outDir, { recursive: true })
writeFileSync(path.join(outDir, 'seed.json'), JSON.stringify(blob))
console.log(`gen-seed: wrote ${blob.sets.length} sets → designer/public/seed.json`)
