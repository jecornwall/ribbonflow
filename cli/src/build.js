// flow/cli/src/build.js
/**
 * build.js — the thin orchestrator behind `ribbonflow build`.
 *
 * collect → buildCollection → emit (bundle and/or gallery) → write everything
 * under outDir. For gallery (or both), it ALSO bundles the vanilla renderer to
 * `<outDir>/gallery/assets/ribbonflow.mjs` — a self-contained ESM the gallery
 * pages import. The render face (@flow-designer/library/render) is vue-free and
 * .vue-free, so esbuild bundles it to ESM with zero bare imports; we assert that.
 *
 * Output layout (under outDir):
 *   bundle/  flows.js · index.js · README.md
 *   gallery/ index.html · <flat-key>.html… · assets/ribbonflow.mjs
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as esbuild } from 'esbuild'
import { buildCollection } from './buildCollection.js'
import { emitBundle } from './emitBundle.js'
import { emitGallery } from './emitGallery.js'

const RENDERER_ASSET_REL = './assets/ribbonflow.mjs'
// A bare (non-relative, non-absolute) module specifier in a `from "…"` clause.
const BARE_IMPORT = /\bfrom\s*["'][^."'/][^"']*["']/

/**
 * Resolve the library's vanilla render entry. Prefers the package export map via
 * import.meta.resolve; falls back to the in-repo relative path.
 * @returns {string} an absolute filesystem path
 */
function resolveRenderEntry() {
  try {
    return fileURLToPath(import.meta.resolve('@flow-designer/library/render'))
  } catch {
    return fileURLToPath(new URL('../../library/src/render/index.js', import.meta.url))
  }
}

async function writeFiles(dir, files) {
  await mkdir(dir, { recursive: true })
  const written = []
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, contents, 'utf8')
    written.push(full)
  }
  return written
}

/**
 * Bundle the vanilla renderer to a self-contained ESM asset.
 * @param {string} outfile — absolute path of the .mjs to write.
 * @returns {Promise<string>} the outfile path.
 */
async function bundleRenderer(outfile) {
  const entry = resolveRenderEntry()
  await mkdir(path.dirname(outfile), { recursive: true })
  await esbuild({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile,
  })
  const code = await readFile(outfile, 'utf8')
  if (BARE_IMPORT.test(code)) {
    throw new Error(
      `renderer bundle ${outfile} contains a bare import — the render face is ` +
      `expected to bundle to a self-contained ESM with zero external imports`,
    )
  }
  return outfile
}

/**
 * Run the flow-collection build.
 *
 * @param {object} args
 * @param {string} args.flowsDir — the flows root.
 * @param {'bundle'|'gallery'|'both'} [args.mode='both']
 * @param {string} args.outDir — output root.
 * @returns {Promise<{
 *   flowCount: number, errorCount: number,
 *   errors: Array<{ key:string, message:string }>,
 *   outDir: string, bundleDir?: string, galleryDir?: string,
 *   rendererAsset?: string, written: string[],
 * }>}
 */
export async function buildCommand({ flowsDir, mode = 'both', outDir }) {
  if (!flowsDir) throw new Error('buildCommand: flowsDir is required')
  if (!outDir) throw new Error('buildCommand: outDir is required')
  if (!['bundle', 'gallery', 'both'].includes(mode)) {
    throw new Error(`buildCommand: unknown mode "${mode}" (expected bundle|gallery|both)`)
  }

  const collection = await buildCollection(flowsDir)
  const wantBundle = mode === 'bundle' || mode === 'both'
  const wantGallery = mode === 'gallery' || mode === 'both'

  const summary = {
    flowCount: Object.keys(collection.flows).length,
    errorCount: collection.errors.length,
    errors: collection.errors,
    outDir,
    written: [],
  }

  if (wantBundle) {
    const { files } = emitBundle(collection)
    const dir = path.join(outDir, 'bundle')
    summary.bundleDir = dir
    summary.written.push(...(await writeFiles(dir, files)))
  }

  if (wantGallery) {
    const { files } = emitGallery(collection, { rendererAsset: RENDERER_ASSET_REL })
    const dir = path.join(outDir, 'gallery')
    summary.galleryDir = dir
    summary.written.push(...(await writeFiles(dir, files)))
    const asset = await bundleRenderer(path.join(dir, 'assets', 'ribbonflow.mjs'))
    summary.rendererAsset = asset
    summary.written.push(asset)
  }

  return summary
}
