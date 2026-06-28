import { mountFlowAuto } from 'ribbonflow'
import { findFlow } from './catalog.js'

const id = new URLSearchParams(location.search).get('id')
const found = id && findFlow(id)
const stage = document.getElementById('stage')

if (found) {
  document.title = `${found.title} · ribbonflow`
  mountFlowAuto(stage, found.envelope)
} else {
  stage.innerHTML = '<p class="miss">Flow not found. <a href="./">Back to the gallery</a>.</p>'
}
