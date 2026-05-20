import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The designer depends on @flow-designer/library as a pnpm WORKSPACE package
// (see M3 spec §2.1). Vite treats workspace-linked packages as source, so
// @vitejs/plugin-vue compiles the library's .vue files directly in this
// build — there is no pre-bundled artefact between the designer and the
// library. That is what makes "preview through the real library" true.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
    // The library is a sibling package inside the flow/ workspace; allow Vite
    // to serve its source files.
    fs: { allow: ['..'] },
  },
})
