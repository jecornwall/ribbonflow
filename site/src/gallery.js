// gallery.js — render one live flow card per curated set.
//
// Each card mounts its first state through the real ribbonflow renderer; the
// renderer's visibility gate pauses off-screen cards. Multi-state sets get a
// stepper that drives handle.update() — the library's headline before→after
// idiom, demonstrated by the site itself.
import { mountFlowAuto } from 'ribbonflow'

export function renderGallery(rootEl, sets) {
  for (const set of sets) {
    rootEl.appendChild(renderCard(set))
  }
}

function renderCard(set) {
  const card = el('article', 'card')

  const stage = el('div', 'card-stage')
  card.appendChild(stage)

  const body = el('div', 'card-body')
  const h3 = el('h3', 'card-title')
  h3.textContent = set.title
  const caption = el('p', 'card-caption')
  caption.textContent = set.caption
  body.append(h3, caption)

  const handle = mountFlowAuto(stage, set.states[0].envelope)
  let active = 0

  if (set.states.length > 1) {
    const stepper = el('div', 'card-stepper')
    const buttons = set.states.map((state, i) => {
      const b = el('button', 'step-btn')
      b.type = 'button'
      b.textContent = state.title
      if (i === 0) b.classList.add('is-active')
      b.addEventListener('click', () => {
        if (i === active) return
        active = i
        handle.update(set.states[i].envelope)
        buttons.forEach((btn, j) => btn.classList.toggle('is-active', j === i))
        openLink.href = `viewer.html?id=${set.id}__${set.states[i].slug}`
      })
      return b
    })
    stepper.append(...buttons)
    body.appendChild(stepper)
  }

  const openLink = el('a', 'card-open')
  openLink.href = `viewer.html?id=${set.id}__${set.states[active].slug}`
  openLink.textContent = 'Open ↗'
  body.appendChild(openLink)

  card.appendChild(body)
  return card
}

function el(tag, className) {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}
