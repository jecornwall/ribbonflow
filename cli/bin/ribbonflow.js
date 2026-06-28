#!/usr/bin/env node
// flow/cli/bin/ribbonflow.js
/**
 * ribbonflow — the flow-collection build CLI.
 *
 *   ribbonflow build <flowsDir> [--mode=bundle|gallery|both] [--out=<dir>]
 *
 * Defaults: --mode=both, --out=./dist-flows. Output lands under <out>/bundle
 * (the referenceable asset bundle) and <out>/gallery (the hostable static
 * gallery + its bundled renderer asset).
 *
 * Thin by design: parse argv, call buildCommand, print a summary. All logic
 * lives in the node-testable src/* modules.
 */
import process from 'node:process'
import path from 'node:path'
import { buildCommand } from '../src/build.js'

const USAGE = `ribbonflow — build a deployable flow collection

Usage:
  ribbonflow build <flowsDir> [--mode=bundle|gallery|both] [--out=<dir>]

Options:
  --mode   bundle | gallery | both   (default: both)
  --out    output directory          (default: ./dist-flows)

Output:
  <out>/bundle   pre-wired asset bundle (flows.js, index.js, README.md)
  <out>/gallery  static gallery (index.html, one page per flow, assets/ribbonflow.mjs)
`

function parseArgs(argv) {
  const args = { _: [], mode: 'both', out: './dist-flows' }
  for (const token of argv) {
    if (token === '-h' || token === '--help') {
      args.help = true
    } else if (token.startsWith('--mode=')) {
      args.mode = token.slice('--mode='.length)
    } else if (token.startsWith('--out=')) {
      args.out = token.slice('--out='.length)
    } else if (token.startsWith('--')) {
      throw new Error(`unknown option: ${token}`)
    } else {
      args._.push(token)
    }
  }
  return args
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n\n${USAGE}`)
    process.exit(2)
  }

  const [command, flowsDir] = args._

  if (args.help || !command) {
    process.stdout.write(USAGE)
    process.exit(command ? 0 : 1)
  }

  if (command !== 'build') {
    process.stderr.write(`error: unknown command "${command}"\n\n${USAGE}`)
    process.exit(2)
  }

  if (!flowsDir) {
    process.stderr.write(`error: missing <flowsDir>\n\n${USAGE}`)
    process.exit(2)
  }

  const outDir = path.resolve(args.out)
  try {
    const summary = await buildCommand({
      flowsDir: path.resolve(flowsDir),
      mode: args.mode,
      outDir,
    })

    process.stdout.write(
      `ribbonflow build · mode=${args.mode}\n` +
      `  flows:  ${summary.flowCount}\n` +
      `  errors: ${summary.errorCount}\n`,
    )
    for (const e of summary.errors) {
      process.stdout.write(`    ✗ ${e.key}: ${e.message}\n`)
    }
    if (summary.bundleDir) process.stdout.write(`  bundle:  ${summary.bundleDir}\n`)
    if (summary.galleryDir) process.stdout.write(`  gallery: ${summary.galleryDir}\n`)
    if (summary.rendererAsset) process.stdout.write(`  renderer: ${summary.rendererAsset}\n`)
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`)
    process.exit(1)
  }
}

main()
