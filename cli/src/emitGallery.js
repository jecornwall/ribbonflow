// flow/cli/src/emitGallery.js
/**
 * emitGallery.js — the hostable STATIC GALLERY emitter (spec §"deployable flow
 * collection" → static gallery).
 *
 * Pure: takes the in-memory collection and returns a path → string map; writes
 * nothing. The renderer asset itself (assets/ribbonflow.mjs) is NOT produced
 * here — it is a bundled binary the orchestrator (build.js) writes.
 *
 * Layout — every page sits at the gallery ROOT so each imports the SAME
 * `./assets/ribbonflow.mjs` with no relative-depth math. A nested key's slashes
 * are flattened to `__` for the filename (`n11/before` → `n11__before.html`);
 * the original key stays the visible title.
 *
 *   index.html         — landing page listing/linking every flow (sorted by key).
 *   <flat-key>.html    — one standalone, chrome-less, full-viewport, iframe-
 *                        embeddable page per flow. Inlines its normalized flow
 *                        as <script type="application/json" id="flow-data">, then
 *                        a module script imports { mountFlowAuto } from the
 *                        renderer asset, parses the JSON, and mounts it full-bleed.
 *                        "Each flow playable at its own URL."
 */

/** Flatten a flow key to a safe, depth-free filename stem. */
export function flattenKey(key) {
  return String(key).replace(/\//g, '__')
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * @param {{ flows: Record<string, { key:string, title:string, isSet:boolean, flow:object }> }} collection
 * @param {object} [opts]
 * @param {string} [opts.rendererAsset='./assets/ribbonflow.mjs']
 * @param {string} [opts.title='Flow gallery']
 * @returns {{ files: Record<string, string> }}
 */
export function emitGallery(collection, {
  rendererAsset = './assets/ribbonflow.mjs',
  title = 'Flow gallery',
} = {}) {
  const entries = Object.values(collection.flows)
  const files = {}

  files['index.html'] = indexHtml(entries, title)
  for (const entry of entries) {
    files[`${flattenKey(entry.key)}.html`] = flowPage(entry, rendererAsset)
  }

  return { files }
}

function indexHtml(entries, title) {
  const items = entries
    .map((e) => {
      const href = `./${flattenKey(e.key)}.html`
      const badge = e.isSet ? '<span class="badge">set</span>' : ''
      return `      <li>
        <a href="${escapeHtml(href)}">
          <span class="key">${escapeHtml(e.key)}</span>
          <span class="title">${escapeHtml(e.title)}</span>
          ${badge}
        </a>
      </li>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 2.5rem clamp(1rem, 5vw, 4rem);
      font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      background: #F4F2ED; color: #1b1b1a;
    }
    h1 { font-size: 1.5rem; font-weight: 650; letter-spacing: -0.01em; margin: 0 0 0.25rem; }
    p.sub { margin: 0 0 2rem; opacity: 0.6; }
    ul { list-style: none; margin: 0; padding: 0;
      display: grid; gap: 0.75rem;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr)); }
    a { display: flex; align-items: baseline; gap: 0.6rem;
      text-decoration: none; color: inherit;
      padding: 0.9rem 1.1rem; border: 1px solid rgba(0,0,0,0.12);
      border-radius: 0.6rem; background: #fff;
      transition: border-color 0.15s ease, transform 0.15s ease; }
    a:hover { border-color: rgba(0,0,0,0.4); transform: translateY(-1px); }
    .key { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.85rem; }
    .title { opacity: 0.55; font-size: 0.85rem; }
    .badge { margin-left: auto; font-size: 0.7rem; text-transform: uppercase;
      letter-spacing: 0.04em; opacity: 0.7;
      border: 1px solid currentColor; border-radius: 0.3rem; padding: 0.05rem 0.4rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="sub">${entries.length} flow${entries.length === 1 ? '' : 's'} — each playable at its own URL.</p>
  <ul>
${items}
  </ul>
</body>
</html>
`
}

function flowPage(entry, rendererAsset) {
  const json = JSON.stringify(entry.flow, null, 2)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(entry.key)}</title>
  <style>
    html, body { margin: 0; height: 100%; background: #F4F2ED; }
    #stage { position: fixed; inset: 0; }
    #stage svg { width: 100%; height: 100%; display: block; }
  </style>
</head>
<body>
  <div id="stage"></div>
  <script type="application/json" id="flow-data">
${json}
  </script>
  <script type="module">
    import { mountFlowAuto } from '${rendererAsset}'
    const flow = JSON.parse(document.getElementById('flow-data').textContent)
    mountFlowAuto(document.getElementById('stage'), flow)
  </script>
</body>
</html>
`
}
