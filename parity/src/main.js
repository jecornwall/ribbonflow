import { createApp } from 'vue'
import ParityApp from './ParityApp.vue'
import { extractScene } from './diff/extractScene.js'

// Expose the geometric extractor so the Phase-2c Playwright capture can pull a
// normalized scene out of either renderer's painted SVG, in the browser's own
// DOM (the same pure function the node/linkedom unit tests pin).
window.__extractScene = (rootEl) => extractScene(rootEl)

createApp(ParityApp).mount('#app')
