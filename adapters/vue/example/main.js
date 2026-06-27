import { createApp, h, shallowRef } from 'vue'
import { FlowEmbed } from '../src/index.js'
import { before, after } from '../../react/example/sampleFlow.js'

// shallowRef (not ref) keeps the identity of `before`/`after` as plain objects,
// so `flow.value === before` is a correct reference check. A deep ref() wraps
// the value in a reactive proxy, making `flow.value !== before` and breaking
// the toggle: the onClick ternary always lands on the falsy branch and Vue sees
// no change in _rawValue, so the child prop never updates.
createApp({
  setup() {
    const flow = shallowRef(before)
    return () => h('div', { style: 'width:80vw;height:60vh' }, [
      h('button', { id: 'swap', onClick: () => { flow.value = flow.value === before ? after : before } }, 'swap'),
      h(FlowEmbed, { flow: flow.value }),
    ])
  },
}).mount('#app')
