import { createApp } from 'vue'
import App from './App.vue'
import { seedDesignerIfNeeded } from './seed/seedDesigner.js'

// Seed the localStorage store on the public site (no-op in dev/server builds),
// then mount. .finally so a seed failure never blocks the app.
seedDesignerIfNeeded()
  .catch(() => {})
  .finally(() => {
    createApp(App).mount('#app')
  })
