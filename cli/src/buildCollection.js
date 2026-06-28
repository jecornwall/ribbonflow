// flow/cli/src/buildCollection.js
/**
 * buildCollection.js — the SHARED validate/normalize/migrate front-end.
 *
 * This is the core of the CLI's design (spec §1/§2): one front-end runs every
 * collected `*.flow.json` through the library's format layer — migrate forward,
 * normalize defaults, validate — and produces a keyed in-memory collection. The
 * two emitters (bundle, gallery) are pure functions of THIS collection; they
 * never re-read or re-parse a flow.
 *
 * A flow that fails to parse or validate is RECORDED in `errors` and SKIPPED —
 * the whole build never throws on one bad flow.
 *
 * Format access goes through the library's public faces (charter §Architecture):
 *   - slide face (@flow-designer/library): normalizeFlowInput, deserializeFlowSet,
 *     isFlowSetEnvelope.
 *   - designer face (/internals): isFlowSet, normalizeFlowSet, validateFlowSet,
 *     validateFlow. The CLI is a tool that manipulates the format, so it is
 *     allowed the broad face — exactly as the designer is.
 */
import { normalizeFlowInput } from '@flow-designer/library'
import {
  isFlowSet,
  normalizeFlowSet,
  deserializeFlowSet,
  validateFlowSet,
  validateFlow,
} from '@flow-designer/library/internals'
import { readFile as fsReadFile } from 'node:fs/promises'
import { collectFlows } from './collect.js'

/**
 * Turn a flow key into a human-readable title fallback.
 * `n11-build-and-test/before` → `N11 Build And Test Before`.
 * @param {string} key
 * @returns {string}
 */
export function humanizeKey(key) {
  return String(key)
    .split(/[/\-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Build the in-memory flow collection from a flows directory.
 *
 * @param {string} dir — the flows root.
 * @param {object} [opts]
 * @param {(file: string, enc: string) => Promise<string>} [opts.readFile] — fs override.
 * @param {(dir: string, opts: object) => Promise<any[]>} [opts.readdir] — fs override (to collect).
 * @returns {Promise<{
 *   flows: Record<string, { key: string, title: string, isSet: boolean, flow: object }>,
 *   errors: Array<{ key: string, message: string }>,
 * }>}
 */
export async function buildCollection(dir, { readFile = fsReadFile, readdir } = {}) {
  const collected = await collectFlows(dir, readdir ? { readdir } : undefined)
  const flows = {}
  const errors = []

  for (const { key, file } of collected) {
    try {
      const raw = await readFile(file, 'utf8')
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        throw new Error(`invalid JSON — ${err.message}`)
      }

      if (isFlowSet(parsed)) {
        // flow-set (envelope or raw): deserialize → normalize → validate.
        const set = normalizeFlowSet(deserializeFlowSet(parsed))
        const { ok, errors: vErrors } = validateFlowSet(set)
        if (!ok) {
          errors.push({ key, message: `flow-set invalid: ${vErrors.join('; ')}` })
          continue
        }
        flows[key] = {
          key,
          title: typeof set.title === 'string' && set.title ? set.title : humanizeKey(key),
          isSet: true,
          flow: set,
        }
      } else {
        // single flow (envelope or bare): migrate + normalize → validate.
        const flow = normalizeFlowInput(parsed)
        const { ok, errors: vErrors } = validateFlow(flow)
        if (!ok) {
          errors.push({ key, message: `flow invalid: ${vErrors.join('; ')}` })
          continue
        }
        flows[key] = {
          key,
          title: typeof flow.title === 'string' && flow.title ? flow.title : humanizeKey(key),
          isSet: false,
          flow,
        }
      }
    } catch (err) {
      errors.push({ key, message: err.message })
    }
  }

  return { flows, errors }
}
