// seedDesigner.js — one-time localStorage seed for the public site.
//
// Gated by VITE_DESIGNER_SEED (set only by the `build:site` script) so normal
// dev/build never seeds. Idempotent: writes only when the store key is unset,
// so a returning visitor's edits are never overwritten. The seed blob is
// fetched at runtime from <base>seed.json (emitted from designer/public/).
import { STORE_KEY } from '../state/backends/localStorageBackend.js'

export async function seedDesignerIfNeeded({
  env = import.meta.env,
  storage = globalThis.localStorage,
  base = import.meta.env.BASE_URL,
  fetchFn = (...a) => globalThis.fetch(...a),
} = {}) {
  if (!env.VITE_DESIGNER_SEED) return false
  if (storage.getItem(STORE_KEY)) return false
  try {
    const res = await fetchFn(`${base}seed.json`)
    if (!res.ok) return false
    storage.setItem(STORE_KEY, await res.text())
    return true
  } catch {
    return false
  }
}
