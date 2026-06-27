import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { FlowEmbed } from '../src/index.js'
import { before, after } from './sampleFlow.js'

function App() {
  const [flow, setFlow] = useState(before)
  return (
    <div style={{ width: '80vw', height: '60vh' }}>
      <button id="swap" onClick={() => setFlow(f => (f === before ? after : before))}>swap</button>
      <FlowEmbed flow={flow} />
    </div>
  )
}
createRoot(document.getElementById('app')).render(<App />)
