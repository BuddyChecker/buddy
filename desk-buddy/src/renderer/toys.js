// Toys: pick a bat, a hammer, a sword… and hit the buddy with your mouse. Anti-stress for
// the trader while the candle does nothing. The faster you swing, the harder the hit:
// light hits squash it, hard ones knock it around, the sword splits it in two, and when its
// health runs out it's knocked out for a few seconds, then gets back up.
//
// Cartoon by default (stars, comic words). "Splats" turns on red cartoon splats.
//
// createToys(ctx) → { toggle(), arm(id), disarm(), get active() }
// ctx: { root, stage, buddyEl, squishEl, perform, has, onChange?(active) }

const svg = body => `<svg viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`

export const TOYS = {
  hand: {
    name: 'Slap',
    word: ['SLAP', 'SMACK'],
    power: 0.6,
    art: svg('<path d="M22 58c-8-4-12-12-12-20V22c0-2.5 2-4 4-4s4 1.5 4 4v8V12c0-2.5 2-4 4-4s4 1.5 4 4v16V8c0-2.5 2-4 4-4s4 1.5 4 4v20V12c0-2.5 2-4 4-4s4 1.5 4 4v26c0 10-6 20-18 20z" fill="#ffd2b0" stroke="#7a4a2a" stroke-width="2.5" stroke-linejoin="round"/>'),
  },
  pan: {
    name: 'Pan',
    word: ['CLANG', 'BONG'],
    power: 1,
    art: svg('<circle cx="24" cy="24" r="17" fill="#3b3f4a" stroke="#1d2027" stroke-width="3"/><circle cx="24" cy="24" r="11" fill="#525866"/><path d="M36 36l20 20" stroke="#7a4a2a" stroke-width="7" stroke-linecap="round"/>'),
  },
  bat: {
    name: 'Bat',
    word: ['BONK', 'WHACK', 'POW'],
    power: 1.4,
    art: svg('<path d="M10 54l6 4 34-40c4-5 4-10 1-13s-8-3-13 1L10 54z" fill="#d9a066" stroke="#7a4a2a" stroke-width="2.5" stroke-linejoin="round"/><path d="M9 53l-4 5 4 3 5-4" fill="#3a2a1a"/>'),
  },
  hammer: {
    name: 'Hammer',
    word: ['BAM', 'KABOOM', 'THUD'],
    power: 1.6,
    art: svg('<path d="M30 30l22 26" stroke="#7a4a2a" stroke-width="7" stroke-linecap="round"/><rect x="8" y="10" width="34" height="18" rx="4" transform="rotate(40 25 19)" fill="#8b93a7" stroke="#3a3f4b" stroke-width="3"/>'),
  },
  sword: {
    name: 'Sword',
    word: ['SLASH', 'SHING'],
    power: 1.2,
    slices: true,
    art: svg('<path d="M50 6L22 34l8 8L58 14l1-9z" fill="#dfe6f2" stroke="#6b7487" stroke-width="2.5" stroke-linejoin="round"/><path d="M14 36l14 14" stroke="#c9a227" stroke-width="5" stroke-linecap="round"/><path d="M20 44l-12 12" stroke="#5a3a22" stroke-width="6" stroke-linecap="round"/>'),
  },
}

const MAX_HP = 100
const KO_MS = 4200

export const createToys = ctx => {
  const { root, stage, buddyEl, squishEl } = ctx
  let current = null // toy id
  let hp = MAX_HP
  let knockedOut = false
  let splats = false
  let lastHits = []
  const pointer = { x: 0, y: 0, t: 0, speed: 0 }

  // ---------- UI: the toy bar (pick a toy, health, splats), the toy cursor, the FX layer ----------
  const bar = document.createElement('div')
  bar.className = 'toy-bar glass'
  bar.hidden = true
  bar.innerHTML = `
    <div class="toy-picks">${Object.entries(TOYS)
      .map(([id, toy]) => `<button type="button" class="toy-pick" data-toy="${id}" title="${toy.name}">${toy.art}</button>`)
      .join('')}</div>
    <div class="toy-hp" aria-label="Buddy health"><i></i></div>
    <div class="toy-actions">
      <button type="button" class="toy-splats" aria-pressed="false" title="Red cartoon splats">Splats</button>
      <button type="button" class="toy-close" title="Put the toy away (Esc)">Done</button>
    </div>`
  stage.append(bar)
  const cursor = document.createElement('div')
  cursor.className = 'toy-cursor'
  cursor.hidden = true
  root.append(cursor)
  const fx = document.createElement('div')
  fx.className = 'toy-fx'
  root.append(fx)

  const renderHp = () => {
    const fill = bar.querySelector('.toy-hp i')
    fill.style.width = `${Math.max(0, hp)}%`
    fill.className = hp > 60 ? 'ok' : hp > 25 ? 'hurt' : 'low'
  }

  const arm = id => {
    if (!TOYS[id]) return
    current = id
    bar.hidden = false
    cursor.hidden = false
    cursor.innerHTML = TOYS[id].art
    for (const pick of bar.querySelectorAll('.toy-pick')) pick.classList.toggle('on', pick.dataset.toy === id)
    stage.classList.add('toys-on')
    renderHp()
    ctx.onChange?.(true)
  }
  const disarm = () => {
    current = null
    bar.hidden = true
    cursor.hidden = true
    stage.classList.remove('toys-on')
    ctx.onChange?.(false)
  }

  bar.addEventListener('click', event => {
    const pick = event.target.closest('.toy-pick')
    if (pick) return arm(pick.dataset.toy)
    if (event.target.closest('.toy-close')) return disarm()
    const toggle = event.target.closest('.toy-splats')
    if (toggle) {
      splats = !splats
      toggle.setAttribute('aria-pressed', String(splats))
    }
  })

  // ---------- sound: a short synthesized thump (always inside a click, so audio is allowed) ----------
  let audio = null
  const thump = (force, metallic) => {
    try {
      audio ??= new AudioContext()
      const now = audio.currentTime
      const out = audio.createGain()
      out.gain.setValueAtTime(Math.min(0.9, 0.25 + force * 0.25), now)
      out.gain.exponentialRampToValueAtTime(0.001, now + 0.35)
      out.connect(audio.destination)
      const tone = audio.createOscillator()
      tone.type = metallic ? 'square' : 'sine'
      tone.frequency.setValueAtTime(metallic ? 620 : 160, now)
      tone.frequency.exponentialRampToValueAtTime(metallic ? 300 : 55, now + 0.3)
      tone.connect(out)
      tone.start(now)
      tone.stop(now + 0.35)
      const noise = audio.createBuffer(1, audio.sampleRate * 0.12, audio.sampleRate)
      const data = noise.getChannelData(0)
      for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
      const burst = audio.createBufferSource()
      burst.buffer = noise
      burst.connect(out)
      burst.start(now)
    } catch {
      // no audio: the hit still shows
    }
  }

  // ---------- effects ----------
  const particles = (x, y, force) => {
    const count = Math.round(6 + force * 6)
    for (let i = 0; i < count; i += 1) {
      const bit = document.createElement('i')
      const angle = Math.random() * Math.PI * 2
      const distance = 30 + Math.random() * 60 * force
      bit.className = splats && Math.random() < 0.7 ? 'splat' : 'star'
      bit.style.left = `${x}px`
      bit.style.top = `${y}px`
      bit.style.setProperty('--dx', `${Math.cos(angle) * distance}px`)
      bit.style.setProperty('--dy', `${Math.sin(angle) * distance}px`)
      bit.style.setProperty('--size', `${6 + Math.random() * 8 * force}px`)
      fx.append(bit)
      setTimeout(() => bit.remove(), 900)
    }
  }
  const comicWord = (x, y, toy, force) => {
    const word = document.createElement('b')
    word.className = 'toy-word'
    word.textContent = `${toy.word[Math.floor(Math.random() * toy.word.length)]}${force > 1.8 ? '!!' : '!'}`
    word.style.left = `${x}px`
    word.style.top = `${y - 30}px`
    word.style.setProperty('--tilt', `${(Math.random() - 0.5) * 30}deg`)
    word.style.fontSize = `${18 + force * 8}px`
    fx.append(word)
    setTimeout(() => word.remove(), 900)
  }
  // the sword: two halves slide apart along the cut, then snap back together
  const slice = () => {
    const halves = document.createElement('div')
    halves.className = 'toy-split'
    const angle = -20 + Math.random() * 40
    halves.style.setProperty('--cut', `${angle}deg`)
    halves.innerHTML = `<div class="half a">${squishEl.innerHTML}</div><div class="half b">${squishEl.innerHTML}</div>`
    squishEl.parentElement.append(halves)
    squishEl.style.visibility = 'hidden'
    setTimeout(() => {
      halves.remove()
      squishEl.style.visibility = ''
    }, 1100)
  }
  const knockOut = () => {
    knockedOut = true
    ctx.perform(ctx.has('knocked-out') ? 'knocked-out' : 'dizzy', KO_MS)
    buddyEl.classList.add('toy-ko')
    setTimeout(() => {
      buddyEl.classList.remove('toy-ko')
      knockedOut = false
      hp = MAX_HP
      renderHp()
      ctx.perform(ctx.has('waking') ? 'waking' : 'happy', 1600)
    }, KO_MS)
  }

  const hit = (x, y) => {
    const toy = TOYS[current]
    // force: how fast the mouse was moving (px per ms), weighted by the toy
    const force = Math.min(3, Math.max(0.35, pointer.speed / 1.4)) * toy.power
    const now = Date.now()
    lastHits = [...lastHits.filter(time => now - time < 2000), now]
    hp -= Math.round(6 + force * 10)
    renderHp()
    thump(force, current === 'pan' || current === 'sword')
    particles(x, y, force)
    comicWord(x, y, toy, force)
    buddyEl.classList.remove('toy-hit', 'toy-hit-hard')
    void buddyEl.offsetWidth
    buddyEl.classList.add(force > 1.4 ? 'toy-hit-hard' : 'toy-hit')
    buddyEl.style.setProperty('--knock', `${(x < buddyEl.getBoundingClientRect().left + buddyEl.offsetWidth / 2 ? 1 : -1) * Math.min(40, 10 + force * 12)}px`)
    if (toy.slices && force > 0.9) slice()
    if (hp <= 0) return knockOut()
    const combo = lastHits.length >= 4
    const reaction = force > 1.8 || combo ? ['angry', 'scared', 'dizzy'] : force > 1 ? ['surprised', 'shocked', 'nervous'] : ['surprised', 'silly', 'shy']
    const key = reaction.find(name => ctx.has(name)) ?? 'surprised'
    ctx.perform(key, 1400)
  }

  // ---------- input: the toy follows the mouse; a click on the buddy is a hit ----------
  window.addEventListener(
    'pointermove',
    event => {
      if (!current) return
      const now = performance.now()
      const dt = Math.max(1, now - pointer.t)
      const instant = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) / dt
      pointer.speed = pointer.speed * 0.6 + instant * 0.4 // smoothed swing speed
      pointer.x = event.clientX
      pointer.y = event.clientY
      pointer.t = now
      cursor.style.transform = `translate(${event.clientX - 8}px, ${event.clientY - 40}px)`
    },
    { capture: true, passive: true }
  )
  window.addEventListener(
    'pointerdown',
    event => {
      if (!current) return
      cursor.classList.remove('swing')
      void cursor.offsetWidth
      cursor.classList.add('swing')
      const box = squishEl.getBoundingClientRect()
      const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom
      if (!inside) return
      // a hit, not a click: the buddy's own click/drag handlers don't see it
      event.preventDefault()
      event.stopPropagation()
      if (!knockedOut) hit(event.clientX, event.clientY)
    },
    true
  )
  // the release and the click of a hit must not reach the buddy either (no menu, no drag)
  for (const type of ['pointerup', 'click', 'dblclick']) {
    window.addEventListener(
      type,
      event => {
        if (!current) return
        const box = squishEl.getBoundingClientRect()
        if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) {
          event.preventDefault()
          event.stopPropagation()
        }
      },
      true
    )
  }
  // capture phase: the buddy stops keys from reaching the page (trading hotkeys), Esc included
  window.addEventListener(
    'keydown',
    event => {
      if (current && event.key === 'Escape') disarm()
    },
    true
  )

  return {
    arm,
    disarm,
    toggle: () => (current ? disarm() : arm('bat')),
    get active() {
      return Boolean(current)
    },
    get hp() {
      return hp
    },
  }
}
