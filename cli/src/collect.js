// flow/cli/src/collect.js
/**
 * collect.js — discover the *.flow.json files under a flows directory.
 *
 * The first stage of the shared build front-end (spec §1/§2 of
 * docs/superpowers/specs/2026-06-20-ribbonflow-open-source-design.md): walk a
 * directory tree, find every `*.flow.json`, and key each by its path relative to
 * the root (posix slashes, `.flow.json` suffix dropped) so a nested set like
 * `n11-build-and-test/before.flow.json` keys as `n11-build-and-test/before`.
 *
 * Reading is fs-injectable (the `readdir` option) so the walk is node-testable
 * without a real tree; the default is node's promise fs.
 */
import { readdir as fsReaddir } from 'node:fs/promises'
import path from 'node:path'

const FLOW_SUFFIX = '.flow.json'

/**
 * Recursively collect every `*.flow.json` under `dir`.
 *
 * @param {string} dir — the flows root directory (absolute or cwd-relative).
 * @param {object} [opts]
 * @param {(dir: string, opts: object) => Promise<import('node:fs').Dirent[]>} [opts.readdir]
 *   — fs.readdir override (must accept `{ withFileTypes: true }`).
 * @returns {Promise<Array<{ key: string, file: string }>>} sorted by `key`.
 */
export async function collectFlows(dir, { readdir = fsReaddir } = {}) {
  const out = []

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && entry.name.endsWith(FLOW_SUFFIX)) {
        const rel = path.relative(dir, full)
        const key = rel
          .split(path.sep)
          .join('/')
          .slice(0, -FLOW_SUFFIX.length)
        out.push({ key, file: full })
      }
    }
  }

  await walk(dir)
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return out
}
