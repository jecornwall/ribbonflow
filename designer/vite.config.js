import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { flowStorePlugin } from './server/flowStorePlugin.js'

// The designer depends on @ribbonflow/core as a pnpm WORKSPACE package
// (see M3 spec §2.1). Vite treats workspace-linked packages as source, so
// @vitejs/plugin-vue compiles the library's .vue files directly in this
// build — there is no pre-bundled artefact between the designer and the
// library. That is what makes "preview through the real library" true.
// flowStorePlugin adds the directory-of-files persistence layer: a dev-server
// REST API backed by flow/flows/ on disk (see
// docs/superpowers/specs/2026-05-20-flow-persistence-design.md). Dev-only —
// the designer is an authoring tool run on `vite dev`.
export default defineConfig({
  base: process.env.DESIGNER_BASE || '/',
  plugins: [vue(), flowStorePlugin()],
  server: {
    port: 5174,
    // The library is a sibling package inside the flow/ workspace; allow Vite
    // to serve its source files.
    fs: { allow: ['..'] },
  },
})
