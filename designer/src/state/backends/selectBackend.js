/**
 * selectBackend.js — choose the persistence backend from a literal build flag
 * (bd ai-engineer-zr7k §7.2, CONFIRMED with Jason 2026-06-28).
 *
 * localStorage is ALWAYS the default; the server/file backend is opt-in ONLY
 * when `VITE_FLOW_BACKEND === 'server'`. There is NO runtime capability probe —
 * selection is a synchronous flag read settled before the first refreshIndex,
 * so flowStore needs no async-ready dance. The `dev` npm script sets the flag
 * (so the maintainer's directory authoring + every existing Playwright spec
 * keep the server backend); a plain `vite build` ships the localStorage static
 * app.
 *
 * Pure + injectable (env + the two factories) so it is unit-testable headless.
 *
 * @param {{ env?: object, makeServer: () => object, makeLocal: () => object }} args
 * @returns {{ backend: object, kind: 'server'|'local' }}
 */
export function selectBackend({ env, makeServer, makeLocal }) {
  if (env && env.VITE_FLOW_BACKEND === 'server') {
    return { backend: makeServer(), kind: 'server' }
  }
  return { backend: makeLocal(), kind: 'local' }
}
