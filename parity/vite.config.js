import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// M5 parity harness (bd ai-engineer-h6sn). A throwaway Vite app that imports
// the deck's REAL flow definitions (deck/flows/*.js) and renders them through
// the NEW @flow-designer/library — so the M5 swap can be validated visually
// against the current deck rendering. It only ever READS deck files; it never
// edits them (the M5 ownership boundary holds — the swap itself is a separate,
// supervised dispatch).
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5180,
    // Root is flow/parity; '../..' reaches the repo root so Vite may serve
    // deck/flows/*.js as source modules.
    fs: { allow: ['../..'] },
  },
})
