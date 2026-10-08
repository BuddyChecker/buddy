// El buddy dentro de la página: pump.fun, DexScreener, GMGN, Photon, Axiom…
// Vive en un Shadow DOM cerrado (la web no lo rompe ni él a la web) y reusa
// los paneles y los sonidos de la app de escritorio. Es INFORMATIVO: no hay
// chat; apenas entras a un token te arma el informe solo.
//   · al abrir un token → escaneo al instante + lanzamiento on-chain + web del
//     proyecto, semáforo encima del buddy y en el ícono, y vigilancia en vivo
//   · 1 clic → burbujas (Informe, Avatar, Favoritas, Ajustes)
//   · clics seguidos → animación con sonido
//   · arrastrar → lo mueves por la página (recuerda el lugar en cada sitio)
import { createAvatar } from '@bible-strong/avatar-web'
import { verdictFor } from '../../desk-buddy/src/main/token-scan.js'
import { momentumAlerts } from '../../desk-buddy/src/main/momentum.js'
import { acceleratorFrom, createPanels } from '../../desk-buddy/src/renderer/panels.js'
import { playAnimationSound, playSound, playTap, playUiSound, setSoundBase } from '../../desk-buddy/src/renderer/sounds.js'
import buddyHtml from '../../desk-buddy/src/renderer/buddy.html'
import buddyCss from '../../desk-buddy/src/renderer/buddy.css'
import extensionCss from './content.css'
import { detectToken } from './detect.js'
import { createReport } from './report.js'
import { createToys } from '../../desk-buddy/src/renderer/toys.js'
import { ICONS, chipFacts, isPlatformLink } from './edge.js'
import { escapeHtml } from '../../desk-buddy/src/renderer/chat.js'
import { liveAlerts, siteFlags } from './site-flags.js'
import { twinFacts, twinTargets } from './twins.js'

const FPS = { active: 30, idle: 12, sleeping: 6 }

const main = async () => {
  if (window.__deskBuddyLoaded) return
  window.__deskBuddyLoaded = true

  const HOST = location.hostname
  const asset = path => chrome.runtime.getURL(path)
  setSoundBase(asset(''))

  // ------------------------------------------------------------------ DOM
  const hostEl = document.createElement('desk-buddy-root')
  hostEl.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646;'
  // Cerrado en producción (la página no puede meterse); abierto en las pruebas.
  const root = hostEl.attachShadow({ mode: __BUDDY_TEST__ ? 'open' : 'closed' })
  const style = document.createElement('style')
  style.textContent = buddyCss.replaceAll(':root', ':host') + extensionCss
  const stage = document.createElement('div')
  stage.id = 'stage'
  const template = new DOMParser().parseFromString(buddyHtml, 'text/html')
  template.querySelectorAll('script').forEach(script => script.remove())
  // Sin chat: la primera burbuja pasa a ser el Informe del token.
  template.querySelector('#chat')?.remove()
  const reportOrb = template.querySelector('.orb[data-action="chat"]')
  reportOrb.dataset.action = 'report'
  reportOrb.setAttribute('aria-label', 'Token report')
  reportOrb.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M7 3.5h7.5L19 8v12.5H7z"/><path d="M14 3.5V8h5M10 12h6M10 15.5h6M10 19h3.5"/></svg><span class="orb-label">Report</span>'
  stage.append(...template.body.childNodes)
  const chip = document.createElement('button')
  chip.id = 'verdict-chip'
  chip.type = 'button'
  chip.hidden = true
  stage.append(chip)
  root.append(style, stage)
  // Lo que escribas en el buddy no le llega a la página: varias webs de
  // trading tienen atajos de teclado para comprar y vender.
  for (const type of ['keydown', 'keyup', 'keypress', 'input']) {
    root.addEventListener(type, event => event.stopPropagation())
  }
  document.documentElement.append(hostEl)

  const $ = selector => root.querySelector(selector)
  const buddyEl = $('#buddy')
  const squishEl = $('#squish')
  const orbit = $('#orbit')
  const toastEl = $('#toast')

  // ------------------------------------------------------------- mensajes
  const send = message => chrome.runtime.sendMessage(message)

  const state = {
    config: await send({ type: 'get-config' }),
    entry: null,
    definition: null,
    avatars: [],
    avatar: null,
    lastAnimation: null,
    returnTimer: null,
    clickTimer: null,
    lastClickAt: 0,
    hasCapture: false,
    lastScan: null,
    busy: false,
    sleeping: false,
    lastInteraction: Date.now(),
    menuOpen: false,
    panel: null,
    visible: false,
    pageToken: null,
    pageScan: null,
  }
  // Pruebas e2e: el estado se refleja en atributos del host (la página los puede leer).
  if (__BUDDY_TEST__) {
    setInterval(() => {
      Object.assign(hostEl.dataset, {
        ready: String(Boolean(state.avatar)),
        visible: String(state.visible),
        menu: String(state.menuOpen),
        panel: state.panel ?? '',
        avatar: state.entry?.id ?? '',
        animation: state.lastAnimation ?? '',
        token: state.pageToken ?? '',
        verdict: state.pageScan?.verdict ?? '',
        busy: String(state.busy),
        favorites: (state.config.favorites?.[state.entry?.id] ?? []).join(','),
        launch: state.pageScan?.launch?.status ?? '',
        site: report.get().site === 'pending' ? 'pending' : report.get().site ? 'done' : '',
      })
    }, 50)
  }

  const index = await (await fetch(asset('avatars/index.json'))).json()
  state.avatars = index.map(({ id, name, colors }) => ({ id, name, colors, fromStudio: false }))
  const definitions = new Map()
  const definitionFor = async id => {
    const entry = index.find(item => item.id === id) ?? index[0]
    if (!definitions.has(entry.id)) definitions.set(entry.id, fetch(asset(`avatars/${entry.file}`)).then(r => r.json()))
    return { entry, definition: await definitions.get(entry.id) }
  }

  // Última posición del mouse (en coordenadas de pantalla, como la app de escritorio).
  const cursor = { x: 0, y: 0 }
  document.addEventListener(
    'mousemove',
    event => {
      cursor.x = event.clientX + window.screenX
      cursor.y = event.clientY + window.screenY
    },
    { passive: true }
  )

  // The buddy's brain (Claude) costs fuel: it never runs on its own. The free sources (dev
  // description, website, tweet) cover "what is this" for most tokens; the trader taps
  // "Ask AI" when they want the deeper read. One answer per token is cached for everyone.
  const askAi = async () => {
    const read = state.pageScan
    if (!read?.address) return null
    const { site, twins } = report.get()
    report.set({ brain: { loading: true } })
    const result = await send({
      type: 'explain',
      facts: {
        address: read.address,
        symbol: read.symbol,
        name: read.name,
        about: read.about,
        tweet: read.narrative?.text,
        tweetDeleted: Boolean(read.narrative?.gone),
        site: site && site !== 'pending' ? site.description || site.title : null,
        signals: read.flags.filter(flag => flag.level !== 'green').slice(0, 6).map(flag => flag.text).join(' | '),
        race: twinFacts(read, site, twins),
      },
    })
    if (state.pageScan?.address !== read.address) return null
    report.set({ brain: result?.ok ? { line: result.line, hungry: result.hungry } : { error: true } })
    return result
  }

  const api = {
    askAi: () => askAi(),
    // watchlist: checked every minute by the background, tab open or not
    watch: (scan, on) => send({ type: 'watch', on, token: { address: scan.address, chain: scan.chain, symbol: scan.symbol, marketCap: scan.market?.marketCap, liquidityUsd: scan.market?.liquidityUsd } }),
    watchTarget: (scan, text) =>
      send({ type: 'watch-target', text, token: { address: scan.address, chain: scan.chain, symbol: scan.symbol, marketCap: scan.market?.marketCap, liquidityUsd: scan.market?.liquidityUsd } }),
    watchState: address => send({ type: 'watch-state', address }),
    // the visitor's own shortcuts, checked against each other and against the Chrome ones
    setShortcut: async (name, accelerator) => {
      const current = state.config.shortcuts ?? {}
      if (accelerator) {
        if (Object.entries(current).some(([other, value]) => other !== name && value === accelerator)) {
          return { ok: false, error: 'Another buddy action already uses that shortcut.' }
        }
        const chromeOnes = Object.values(await send({ type: 'shortcuts' })).map(value => String(value).replace(/\s/g, ''))
        if (chromeOnes.includes(accelerator.replace('CommandOrControl', 'Ctrl'))) {
          return { ok: false, error: 'That combo is already a Chrome shortcut for Buddy.' }
        }
      }
      const config = await send({ type: 'save-config', patch: { shortcuts: { ...current, [name]: accelerator } } })
      state.config = config
      return { ok: true, config }
    },
    definition: async id => definitionFor(id),
    toggleFavorite: key => send({ type: 'toggle-favorite', avatarId: state.entry.id, key }),
    saveSettings: async patch => {
      const config = await send({ type: 'save-config', patch })
      if (patch.avatarId) await setAvatar(patch.avatarId)
      return config
    },
    cursor: async () => cursor,
    openSettings: hash => send({ type: 'open-options', hash }),
    openUrl: url => window.open(url, '_blank', 'noopener'),
    sound: async () => null,
  }

  // ------------------------------------------------------ avatar y animación
  const NOT_RANDOM = new Set(['idle', 'waking', 'sleeping', 'typing', 'look-left', 'look-right', 'look-up', 'look-down'])
  const ORBIT_ANGLES = { report: 168, avatar: 131, favorites: 93, settings: 50, toys: 10 }
  const LOOP_ANIMATION_MS = 4800
  const CLICK_WINDOW_MS = 280
  const CHAIN_MS = 450

  const has = key => state.entry.animations.some(animation => animation.key === key)
  const play = key => {
    if (!state.avatar || !has(key)) return false
    clearTimeout(state.returnTimer)
    state.avatar.play(key)
    state.lastAnimation = key
    return true
  }
  const backToIdle = (delay = 0) => {
    clearTimeout(state.returnTimer)
    state.returnTimer = setTimeout(() => {
      if (!state.busy) state.avatar?.play('idle')
    }, delay)
  }
  const soundIdFor = key => {
    const own = state.entry?.sounds
    return own && key in own ? own[key] : key
  }
  const perform = (key, holdMs = LOOP_ANIMATION_MS, { silent = false } = {}) => {
    if (!play(key)) return
    if (!silent) playAnimationSound(soundIdFor(key), state.config)
    const animation = state.entry.animations.find(item => item.key === key)
    if (!animation?.once) backToIdle(holdMs)
  }
  const sound = event => playSound(event, state.config, api.sound)
  const uiSound = name => playUiSound(name, state.config)
  const tap = (config = state.config) => playTap(config)

  const miniAvatar = (target, size) => {
    if (!target || !state.definition) return
    target.__mini?.destroy()
    target.replaceChildren()
    try {
      target.__mini = createAvatar(target, { definition: state.definition, size, autoplay: false, ariaLabel: state.entry.name })
    } catch {
      target.__mini = null
    }
  }

  const applyPosition = () => {
    const position = state.config.positions?.[HOST] ?? { right: 12, bottom: 4 }
    stage.style.right = `${position.right}px`
    stage.style.bottom = `${position.bottom}px`
    stage.style.setProperty('--buddy-size', `${state.config.size}px`)
  }

  const mountAvatar = () => {
    stage.style.setProperty('--buddy-size', `${state.config.size}px`)
    const holder = document.createElement('div')
    const avatar = createAvatar(holder, {
      definition: state.definition,
      defaultAnimation: 'idle',
      size: state.config.size,
      ariaLabel: state.entry.name,
      onAnimationEnd: () => backToIdle(700),
      // lives on top of heavy trading pages: never render at full screen rate
      maxFps: FPS.active,
    })
    state.avatar?.destroy()
    squishEl.replaceChildren(...holder.childNodes)
    state.avatar = avatar
    miniAvatar($('#orb-avatar-preview'), 26)
    layoutOrbit()
  }

  const appear = () => {
    touch()
    stage.style.setProperty('--poof', state.entry?.colors?.body ?? '#ffffff')
    buddyEl.classList.remove('appearing', 'released')
    void buddyEl.offsetWidth
    buddyEl.classList.add('appearing')
    sound('appear')
    setTimeout(() => perform(has('celebrate') ? 'celebrate' : 'happy', 1800, { silent: true }), 380)
  }
  buddyEl.addEventListener('animationend', event => {
    if (event.animationName === 'appear') buddyEl.classList.remove('appearing')
  })

  const setAvatar = async id => {
    const { entry, definition } = await definitionFor(id)
    state.entry = entry
    state.definition = definition
    mountAvatar()
    appear()
    updateOrbit()
  }

  // -------------------------------------------------------------- sueño
  const touch = () => {
    state.lastInteraction = Date.now()
    if (state.sleeping) {
      state.sleeping = false
      perform('waking', 1200)
    }
  }
  // frame rate follows attention: smooth while you use it, a trickle while it just sits there
  const pace = () => {
    const idleFor = Date.now() - state.lastInteraction
    const fps = !state.visible
      ? 1
      : state.menuOpen || state.panel || state.busy || idleFor < 15000
        ? FPS.active
        : state.sleeping
          ? FPS.sleeping
          : FPS.idle
    if (fps !== state.fps) {
      state.fps = fps
      state.avatar?.setMaxFps(fps)
    }
  }
  setInterval(pace, 1000)
  setInterval(() => {
    const idleFor = Date.now() - state.lastInteraction
    if (state.visible && !state.sleeping && !state.busy && !state.menuOpen && !state.panel && idleFor > state.config.idleSleepMinutes * 60000) {
      state.sleeping = true
      play('sleeping')
    }
  }, 10000)

  // -------------------------------------------------------------- aviso
  let toastTimer = null
  const toast = (text, ms = 2600) => {
    toastEl.textContent = text
    toastEl.hidden = false
    toastEl.classList.remove('leaving')
    stage.classList.add('toasting') // same spot as the chip, right above the avatar
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      toastEl.classList.add('leaving')
      setTimeout(() => {
        toastEl.hidden = true
        stage.classList.remove('toasting')
      }, 250)
    }, ms)
  }

  // ------------------------------------------------ apretar, arrastrar, clics
  const drag = { pressed: false, active: false, startX: 0, startY: 0, right: 0, bottom: 0 }

  buddyEl.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    touch()
    buddyEl.setPointerCapture(event.pointerId)
    const position = state.config.positions?.[HOST] ?? { right: 12, bottom: 4 }
    Object.assign(drag, { pressed: true, active: false, startX: event.clientX, startY: event.clientY, ...position })
    buddyEl.classList.remove('released')
    buddyEl.classList.add('pressed')
    tap()
  })
  buddyEl.addEventListener('pointermove', event => {
    if (!drag.pressed) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.active && Math.hypot(dx, dy) > 6) {
      drag.active = true
      buddyEl.classList.remove('pressed')
      buddyEl.classList.add('dragging')
      closeMenu({ silent: true })
      play('surprised') || play('excited')
    }
    if (drag.active) {
      const size = state.config.size
      const right = Math.min(Math.max(drag.right - dx, -stage.offsetWidth / 2 + size / 2), window.innerWidth - stage.offsetWidth / 2 - size / 2)
      const bottom = Math.min(Math.max(drag.bottom - dy, -4), window.innerHeight - size - 8)
      stage.style.right = `${right}px`
      stage.style.bottom = `${bottom}px`
    }
  })
  const release = event => {
    if (!drag.pressed) return
    drag.pressed = false
    buddyEl.releasePointerCapture?.(event.pointerId)
    buddyEl.classList.remove('pressed', 'dragging')
    void buddyEl.offsetWidth
    buddyEl.classList.add('released')
    if (drag.active) {
      drag.active = false
      const positions = { ...(state.config.positions ?? {}), [HOST]: { right: parseFloat(stage.style.right), bottom: parseFloat(stage.style.bottom) } }
      state.config = { ...state.config, positions }
      send({ type: 'save-config', patch: { positions } })
      perform(has('happy') ? 'happy' : 'idle', 1800, { silent: true })
      return
    }
    onClick()
  }
  buddyEl.addEventListener('pointerup', release)
  buddyEl.addEventListener('pointercancel', release)

  const onClick = () => {
    const now = Date.now()
    const chained = now - state.lastClickAt < CHAIN_MS
    state.lastClickAt = now
    if (chained) {
      clearTimeout(state.clickTimer)
      state.clickTimer = null
      if (state.menuOpen && !state.panel) closeMenu({ silent: true })
      const key = pickAnimation()
      perform(key)
      if (!soundIdFor(key) || state.config.animationSounds === false) sound('double')
      return
    }
    state.clickTimer = setTimeout(() => {
      state.clickTimer = null
      if (state.menuOpen) closeAll()
      else openMenu()
    }, CLICK_WINDOW_MS)
  }

  const pickAnimation = () => {
    const pool = state.entry.animations.map(item => item.key).filter(key => !NOT_RANDOM.has(key))
    const favorites = (state.config.favorites[state.entry.id] ?? []).filter(key => pool.includes(key))
    const source = favorites.length && Math.random() < state.config.favoriteBias ? favorites : pool
    const options = source.length > 1 ? source.filter(key => key !== state.lastAnimation) : source
    return options[Math.floor(Math.random() * options.length)]
  }

  // ------------------------------------------------------------ burbujas
  // Toys: a 5th bubble (bat, hammer, sword… hit the buddy)
  const toysOrb = document.createElement('button')
  toysOrb.className = 'orb'
  toysOrb.type = 'button'
  toysOrb.dataset.action = 'toys'
  toysOrb.setAttribute('aria-label', 'Toys')
  toysOrb.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14.5 4.5l5 5-3 3-5-5zM12.5 9.5L4 18l2 2 8.5-8.5"/></svg><span class="orb-label">Toys</span>'
  orbit.append(toysOrb)
  let toys = null
  const orbs = [...orbit.querySelectorAll('.orb')]
  const layoutOrbit = () => {
    const size = state.config?.size ?? 170
    const box = buddyEl.getBoundingClientRect()
    const stageBox = stage.getBoundingClientRect()
    const cx = box.left - stageBox.left + box.width / 2
    const cy = box.top - stageBox.top + box.height * 0.55
    const radius = size * 0.47 + 32 // smaller orbs sit closer
    for (const orb of orbs) {
      const angle = (ORBIT_ANGLES[orb.dataset.action] * Math.PI) / 180
      orb.style.left = `${cx + Math.cos(angle) * radius}px`
      orb.style.top = `${cy - Math.sin(angle) * radius}px`
      orb.style.setProperty('--from-x', `${-Math.cos(angle) * radius}px`)
      orb.style.setProperty('--from-y', `${Math.sin(angle) * radius}px`)
    }
    stage.style.setProperty('--panel-bottom', `${stageBox.height - (cy - radius) + 34}px`)
  }
  const updateOrbit = () => {
    const count = (state.config.favorites[state.entry.id] ?? []).length
    $('#orb-fav-count').textContent = String(count)
    $('#orb-fav-count').hidden = !count
    for (const orb of orbs) orb.setAttribute('aria-pressed', String(orb.dataset.action === state.panel))
  }
  const openMenu = () => {
    layoutOrbit()
    updateOrbit()
    chip.hidden = true
    orbit.hidden = false
    orbit.classList.remove('closing')
    orbs.forEach((orb, i) => orb.style.setProperty('--delay', `${i * 45}ms`))
    state.menuOpen = true
    uiSound('menu-open')
  }
  const closeMenu = ({ silent = false } = {}) => {
    if (!state.menuOpen) return
    state.menuOpen = false
    orbit.classList.add('closing')
    if (!silent) uiSound('menu-close')
    setTimeout(() => {
      if (!state.menuOpen) orbit.hidden = true
      renderChip()
    }, 220)
  }
  orbit.addEventListener('click', event => {
    const orb = event.target.closest('.orb')
    if (!orb) return
    touch()
    const action = orb.dataset.action
    if (action === 'toys') {
      closeMenu({ silent: true })
      uiSound('select')
      return toys?.toggle()
    }
    if (state.panel === action) return closePanel()
    uiSound('select')
    showPanel(action)
  })

  // -------------------------------------------------------------- paneles
  const settingsSections = ({ el, section, toggleRow, shortcutRow }) => {
    const shortcutsRow = el('div', 'set-row')
    shortcutsRow.innerHTML = '<div class="set-text"><span>Chrome shortcuts</span><small class="shortcut-list">…</small></div>'
    const change = el('button', 'glass-btn', 'Change')
    change.type = 'button'
    change.style.flex = '0 0 auto'
    change.addEventListener('click', () => send({ type: 'open-shortcuts' }))
    shortcutsRow.append(change)
    send({ type: 'shortcuts' }).then(shortcuts => {
      const list = shortcutsRow.querySelector('.shortcut-list')
      if (list) list.textContent = `Show/hide: ${shortcuts['toggle-buddy'] || '—'} · Report: ${shortcuts['show-report'] || '—'}`
    })
    const hideHere = el('button', 'glass-btn', `Hide on ${HOST.replace(/^www\./, '')}`)
    hideHere.type = 'button'
    hideHere.addEventListener('click', () => hideOnSite())
    const options = el('button', 'glass-btn', 'Options')
    options.type = 'button'
    options.addEventListener('click', () => api.openSettings())
    return {
      before: [
        section(
          'Report',
          toggleRow('Auto-check when you open a token', 'Traffic light on the icon + buddy heads-up', state.config.autoScan !== false, value =>
            api.saveSettings({ autoScan: value })
          ),
          toggleRow('Watch while the page is open', 'Alerts you if liquidity drops or the dev sells', state.config.watch !== false, value =>
            api.saveSettings({ watch: value })
          ),
          toggleRow('Open the report on high risk', null, state.config.autoOpenHighRisk !== false, value =>
            api.saveSettings({ autoOpenHighRisk: value })
          ),
          toggleRow('Momentum alerts', 'New ATH, close to ATH, volume spikes', state.config.momentum !== false, value =>
            api.saveSettings({ momentum: value })
          ),
          toggleRow('Famous tweets', 'Elon, CZ, Trump… the second they post', state.config.famous !== false, value =>
            api.saveSettings({ famous: value })
          ),
          toggleRow('Learn in the background', 'Watches fresh launches to know how tokens like this end (stays on this PC)', state.config.learn !== false, value =>
            api.saveSettings({ learn: value })
          )
        ),
      ],
      after: [
        section(
          'Shortcuts',
          shortcutRow('toggle', 'Show / hide your buddy'),
          shortcutRow('report', 'Open the token report'),
          el('p', 'set-hint', 'Tap one and press your combo (with Ctrl, Alt or Shift, or an F key). <b>Esc</b> cancels · <b>Backspace</b> clears. Saved for good, on every trading site.'),
          shortcutsRow
        ),
      ],
      actions: [options, hideHere],
    }
  }

  const ctx = {
    api,
    state,
    root,
    platform: 'extension',
    perform,
    play,
    has,
    backToIdle,
    sound,
    uiSound,
    tap,
    touch,
    toast,
    setThinking: value => buddyEl.classList.toggle('thinking', value),
    miniAvatar,
    updateOrbit,
    settingsSections,
    scanManual: input => inspect(input, { manual: true }),
    showPanel: name => showPanel(name),
    closePanel: () => closePanel(),
    closeAll: () => closeAll(),
  }

  const report = createReport(ctx)
  const panels = createPanels(ctx)
  const allPanels = { report: report.panel, ...panels.panels }
  // Vidrio nativo: en una página el navegador sí desenfoca lo que hay detrás.
  for (const element of [...orbs, toastEl, chip, ...Object.values(allPanels)]) {
    element.classList.add('glass', 'native-glass')
    const layers = document.createElement('div')
    layers.className = 'glass-layers'
    layers.innerHTML = '<div class="glass-tint"></div><div class="glass-shine"></div>'
    element.prepend(layers)
  }

  const showPanel = name => {
    if (state.panel && state.panel !== name) hidePanel(state.panel)
    const panel = allPanels[name]
    if (name === 'report') report.render()
    else panels.render[name]()
    state.panel = name
    panel.hidden = false
    panel.classList.remove('leaving')
    if (!state.menuOpen) openMenu()
    updateOrbit()
  }
  const hidePanel = name => {
    const panel = allPanels[name]
    if (!panel || panel.hidden) return
    panel.classList.add('leaving')
    setTimeout(() => {
      if (state.panel !== name) panel.hidden = true
    }, 180)
  }
  const closePanel = () => {
    if (!state.panel) return
    const name = state.panel
    state.panel = null
    hidePanel(name)
    updateOrbit()
    if (!state.busy) backToIdle()
  }
  const closeAll = () => {
    closePanel()
    closeMenu()
  }
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    if (state.panel) closePanel()
    else closeMenu()
  })

  // ------------------------------------------- token de la página abierta
  const VERDICT_TEXT = { alto: 'high risk', medio: 'caution', bajo: 'low risk' }
  const renderChip = () => {
    const scan = state.pageScan
    if (!scan || state.menuOpen || !state.visible || toys?.active) {
      chip.hidden = true
      return
    }
    chip.dataset.verdict = scan.verdict
    // built once; later updates (launch read, site check) must not wipe a live alert
    if (!chip.querySelector('.chip-line')) {
      chip.innerHTML = `<div class="glass-layers"><div class="glass-tint"></div><div class="glass-shine"></div></div><div class="chip-line"></div>`
    }
    chip.hidden = false
    rotateFact(true)
  }

  // One line at a time: "$TICKER · Caution", then each thing that matters on this token
  // (vamps, the dev's wallets inside, the dev's track record, the ATH…), then around again.
  let factIndex = 0
  let alertUntil = 0
  const rotateFact = (restart = false) => {
    const line = chip.querySelector('.chip-line')
    const scan = state.pageScan
    if (!line || chip.hidden || !scan || Date.now() < alertUntil) return
    chip.classList.remove('famous')
    delete chip.dataset.url
    const { site, momentum, memory, trend, holding, brain, twins } = report.get()
    const items = [{ key: 'verdict' }, ...chipFacts({ scan, site, momentum, memory, trend, holding, brain, twins })]
    if (restart) factIndex = 0
    const item = items[factIndex % items.length]
    factIndex += 1
    line.className = `chip-line ${item.key === 'verdict' ? 'is-verdict' : `fact ${item.level}`}`
    line.innerHTML =
      item.key === 'verdict'
        ? `<i></i><b>${scan.symbol ? `$${escapeHtml(scan.symbol)}` : 'Token'}</b><span>${VERDICT_TEXT[scan.verdict]}</span>`
        : `${ICONS[item.key] ?? ''}<em>${escapeHtml(item.text)}</em>`
  }
  setInterval(() => {
    if (!document.hidden) rotateFact()
  }, 3500)
  // Live alerts (NEW ATH, volume, liquidity drop, dev sold) jump straight into the chip,
  // right above the avatar, stay a few seconds highlighted, then the rotation goes on.
  const chipAlert = (text, level = 'yellow', icon = 'signals') => {
    const line = chip.querySelector('.chip-line')
    if (!line || chip.hidden) return toast(text)
    alertUntil = Date.now() + 7000
    chip.classList.remove('famous')
    delete chip.dataset.url
    line.className = `chip-line fact alert ${level}`
    line.innerHTML = `${ICONS[icon] ?? ''}<em>${escapeHtml(text)}</em>`
    chip.classList.remove('ping')
    void chip.offsetWidth
    chip.classList.add('ping')
  }
  chip.addEventListener('click', () => {
    uiSound('select')
    // a famous tweet on screen: the chip opens the tweet
    if (chip.dataset.url && Date.now() < alertUntil) return api.openUrl(chip.dataset.url)
    showPanel('report')
  })

  // ------------------------------------------------ famous tweets (yellow bubble)
  // Every few seconds (only the tab you're looking at) the buddy asks the Buddy server
  // for new tweets from the famous accounts it watches; it announces them right away.
  const shortText = (text, words) => {
    const list = String(text ?? '').split(' ')
    return list.length > words ? `${list.slice(0, words).join(' ')}…` : text
  }
  const famousLine = tweet => {
    const { cashtags = [], cas = [] } = tweet.mentions ?? {}
    const here = state.pageScan?.address
    const tag = here && cas.includes(here) ? ' · mentions THIS token!' : cashtags.length ? ` · $${cashtags.slice(0, 2).join(' $')}` : cas.length ? ' · drops a CA' : ''
    return `${tweet.name ?? `@${tweet.user}`}: "${shortText(tweet.text, 9)}"${tag}`
  }
  const famousAlert = tweet => {
    const text = famousLine(tweet)
    if (state.visible) perform(has('surprised') ? 'surprised' : 'excited', 3500)
    sound('answer')
    const line = chip.querySelector('.chip-line')
    if (!line || chip.hidden) {
      toast(text, 12_000)
      toastEl.classList.add('famous')
      toastEl.onclick = () => api.openUrl(tweet.url)
      setTimeout(() => {
        toastEl.classList.remove('famous')
        toastEl.onclick = null
      }, 12_300)
      return
    }
    alertUntil = Date.now() + 12_000
    chip.dataset.url = tweet.url
    chip.classList.add('famous')
    line.className = 'chip-line fact alert famous'
    line.innerHTML = `${ICONS.x}<em>${escapeHtml(text)}</em>`
    chip.classList.remove('ping')
    void chip.offsetWidth
    chip.classList.add('ping')
    setTimeout(() => {
      if (Date.now() >= alertUntil) {
        chip.classList.remove('famous')
        delete chip.dataset.url
        rotateFact()
      }
    }, 12_100)
  }
  let feedSince = Date.now() - 15_000 // a tweet from a few seconds before you opened the page still counts
  const shownTweets = new Set()
  const pollFeed = async () => {
    if (document.hidden || state.config.famous === false) return
    const result = await send({ type: 'feed', since: feedSince })
    if (!result?.ok) return
    const fresh = (result.tweets ?? []).filter(tweet => !shownTweets.has(tweet.id)).sort((a, b) => a.receivedAt - b.receivedAt)
    for (const tweet of fresh) {
      shownTweets.add(tweet.id)
      feedSince = Math.max(feedSince, tweet.receivedAt)
    }
    // one at a time: the newest wins (a burst of 5 tweets shouldn't spam the chip)
    if (fresh.length) famousAlert(fresh[fresh.length - 1])
  }
  setInterval(pollFeed, __BUDDY_TEST__ ? 1000 : 4000)

  // Informe progresivo: datos de mercado y seguridad al instante; el
  // lanzamiento on-chain y la web del proyecto llegan después.
  const REACTION = { alto: 'scared', medio: 'suspicious', bajo: 'happy' }
  let inspecting = 0
  let watchTimer = null

  const withSite = (scan, site) => {
    if (!site || site === 'pending' || !site.flags?.length) return scan
    return { ...scan, verdict: verdictFor([...scan.flags, ...site.flags]) }
  }

  const publish = ({ scan, site, react = false }) => {
    const shown = withSite(scan, site)
    state.pageScan = shown
    report.set({ scan: shown, site })
    renderChip()
    if (react) {
      state.verdictReacted = shown.address + shown.verdict
      if (state.visible) perform(REACTION[shown.verdict] ?? 'curious', 3200)
    }
  }

  const inspect = async (input, { manual = false } = {}) => {
    const run = ++inspecting
    const stale = () => run !== inspecting
    report.set({ scan: { loading: true, input }, site: null, momentum: null, memory: null, trend: null, holding: null, brain: null, twins: null })
    if (manual) showPanel('report')
    const result = await send({ type: 'scan', input, auto: !manual })
    if (stale()) return
    if (!result?.ok) {
      report.set({ scan: { error: result?.error ?? "Couldn't check that token." }, site: null })
      return
    }
    let scan = result.scan
    // only a real project site is worth checking (an x.com search link is not)
    const website = scan.socials?.websites?.find(url => !isPlatformLink(url))
    let site = website ? 'pending' : null
    publish({ scan, site, react: true })
    if (!manual && scan.verdict === 'alto' && state.config.autoOpenHighRisk !== false && state.visible) showPanel('report')
    // ATH and volume right away: don't wait for the (slow) on-chain launch read
    startMomentum(scan, run)
    refreshHolding(scan, run)

    const launchJob =
      scan.launch?.status === 'pending'
        ? send({ type: 'launch', scan }).then(next => {
            if (stale() || !next?.scan) return
            scan = next.scan
            publish({ scan, site })
          })
        : Promise.resolve()
    const siteJob = website
      ? send({ type: 'site-check', url: website, token: scan.address }).then(checked => {
          if (stale()) return
          site = checked ? { ...checked, flags: siteFlags(checked) } : null
          publish({ scan, site })
        })
      : Promise.resolve()
    // narrative race: read what each twin is (model, launch post) to say why the money picks one
    const targets = twinTargets(scan)
    const twinsJob = targets.length
      ? send({ type: 'twins', targets }).then(twins => {
          if (stale() || !Array.isArray(twins)) return
          report.set({ twins })
          renderChip()
        })
      : Promise.resolve()
    await Promise.all([launchJob, siteJob, twinsJob])
    if (stale()) return
    // the buddy's memory: keep this token's snapshot, and say how tokens like it ended
    send({ type: 'memory', scan: state.pageScan, save: !manual }).then(result => {
      if (!stale() && result?.ok) report.set({ memory: result.row, trend: result.trend })
    })
    const before = state.pageScan
    if (!manual && before && state.verdictReacted !== before.address + before.verdict) {
      state.verdictReacted = before.address + before.verdict
      if (state.visible) perform(REACTION[before.verdict] ?? 'curious', 3200)
    }
    if (!manual) startWatch(input, run)
  }

  // Live read: every 2 s (only the tab you're looking at) checks price, volume and liquidity:
  // a new ATH, a volume spike, a big dip, or liquidity being pulled, close to real time.
  // Memecoins move in seconds; the background shares one call per coin across tabs.
  // your position (read-only balance from the chain, if you added your wallet in Options)
  const refreshHolding = async (scan, run) => {
    const result = await send({ type: 'holding', mint: scan.address })
    if (run !== inspecting || !result?.ok) return
    report.set({ holding: { amount: result.amount } })
  }
  const inPosition = () => (report.get().holding?.amount ?? 0) > 0
  const personal = text => (inPosition() ? `You're in · ${text}` : text)

  let momentumTimer = null
  const MOMENTUM_REACTION = { ath: 'celebrate', near: 'excited', volume: 'amazed', dip: 'shocked', sellers: 'nervous', buyers: 'happy', migrate: 'excited' }
  const ALERT_STYLE = { ath: ['green', 'ath'], near: ['green', 'ath'], volume: ['yellow', 'signals'], dip: ['yellow', 'signals'], sellers: ['red', 'signals'], buyers: ['green', 'ath'], migrate: ['green', 'launch'] }
  const startMomentum = (scan, run) => {
    clearInterval(momentumTimer)
    if (state.config.momentum === false || !scan?.address) return
    const target = { chain: scan.chain, address: scan.address }
    const memory = {}
    const recent = []
    let ath = null
    let athTriedAt = 0
    let holdingAt = 0
    let busy = false
    let liquidityStart = null
    let pulled = false
    const tick = async () => {
      if (run !== inspecting) return clearInterval(momentumTimer)
      if (document.hidden && !__BUDDY_TEST__) return
      if (busy) return // a slow answer never stacks reads
      busy = true
      try {
        await read()
      } finally {
        busy = false
      }
    }
    const read = async () => {
      if (!ath && Date.now() - athTriedAt > 60_000) {
        athTriedAt = Date.now()
        const result = await send({ type: 'ath', ...target })
        if (result?.ok && result.ath) ath = result.ath
      }
      const result = await send({ type: 'pulse', ...target })
      if (run !== inspecting || !result?.ok || !result.pulse) return
      if (Date.now() - holdingAt > 30_000) {
        holdingAt = Date.now()
        refreshHolding(scan, run) // your balance: every 30 s is plenty
      }
      // liquidity pulled (or MC collapsing on the curve): said within seconds, once
      const pulse = result.pulse
      const value = scan.market?.bondingCurve ? pulse.marketCap : pulse.liquidityUsd
      liquidityStart ??= value > 0 ? value : null
      if (!pulled && liquidityStart && value > 0 && value < liquidityStart * 0.7) {
        pulled = true
        state.liquidityAlerted = scan.address
        const drop = Math.round((1 - value / liquidityStart) * 100)
        chipAlert(personal(scan.market?.bondingCurve ? `MC dropped ${drop}% since you opened the page.` : `Liquidity dropped ${drop}% since you opened the page.`), 'red', 'signals')
        if (state.visible) perform('scared', 3500)
        sound('capture')
      }
      const { alerts, ath: next, curve } = momentumAlerts({ pulse: result.pulse, ath, symbol: scan.symbol, memory })
      ath = next
      for (const alert of alerts) recent.unshift({ ...alert, at: Date.now() })
      recent.splice(3)
      report.set({ momentum: { ath, pulse: result.pulse, recent: [...recent], curve } })
      if (alerts.length && state.config.momentum !== false) {
        const top = alerts[0]
        // the alerts that can hurt you get a "You're in" when you hold the token
        const hurts = ['dip', 'sellers'].includes(top.kind)
        chipAlert(hurts ? personal(top.text) : top.text, ...(ALERT_STYLE[top.kind] ?? ['yellow', 'signals']))
        if (state.visible) perform(MOMENTUM_REACTION[alerts[0].kind] ?? 'excited', 3500)
        sound('answer')
      }
    }
    tick()
    momentumTimer = setInterval(tick, __BUDDY_TEST__ ? 1500 : 2_000)
  }

  // Live watch, the deep part: every 20 s a fresh scan (holders, dev wallet, bundle) to catch
  // the dev or the bundle selling. Liquidity is already watched every 2 s by the live read.
  const startWatch = (input, run) => {
    clearInterval(watchTimer)
    if (state.config.watch === false) return
    const baseline = state.pageScan
    watchTimer = setInterval(async () => {
      if (run !== inspecting) return clearInterval(watchTimer)
      // only the tab you're looking at keeps watching (background tabs stay quiet)
      if (document.hidden && !__BUDDY_TEST__) return
      const result = await send({ type: 'scan', input, auto: true, fresh: true })
      if (run !== inspecting || !result?.ok) return
      const current = { ...result.scan, launch: state.pageScan?.launch, flags: result.scan.flags }
      // the 2 s read already said the liquidity one
      const alerts = liveAlerts(baseline, current).filter(text => !(state.liquidityAlerted === baseline.address && /dropped \d+% since you opened/.test(text)))
      if (alerts.length) {
        chipAlert(personal(alerts[0]), 'red', 'signals')
        perform('scared', 3500)
        sound('capture')
        publish({ scan: current, site: report.get().site })
      }
    }, __BUDDY_TEST__ ? 1500 : 20_000)
  }

  const checkPage = async () => {
    const token = detectToken(location.href)
    if (token === state.pageToken) return
    state.pageToken = token
    state.pageScan = null
    clearInterval(watchTimer)
    clearInterval(momentumTimer)
    renderChip()
    if (!token) {
      inspecting += 1
      report.set({ scan: null, site: null })
      send({ type: 'clear-badge' })
      return
    }
    if (state.config.autoScan === false) return
    inspect(token)
  }

  // --------------------------------------------------- mostrar / esconder
  const show = async ({ remember = false } = {}) => {
    if (remember && state.config.hiddenSites?.includes(HOST)) {
      state.config = await send({ type: 'save-config', patch: { hiddenSites: state.config.hiddenSites.filter(site => site !== HOST) } })
    }
    hostEl.style.display = ''
    state.visible = true
    applyPosition()
    layoutOrbit()
    appear()
    renderChip()
  }
  const hide = () => {
    closeAll()
    hostEl.style.display = 'none'
    state.visible = false
  }
  const hideOnSite = async () => {
    hide()
    state.config = await send({ type: 'save-config', patch: { hiddenSites: [...new Set([...(state.config.hiddenSites ?? []), HOST])] } })
    // aviso nativo corto: cómo volver a verlo
    console.info('[Buddy] Hidden on this site. Click the extension icon to bring it back.')
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'config') {
      const sizeChanged = message.config.size !== state.config.size
      state.config = message.config
      if (sizeChanged) mountAvatar()
      applyPosition()
      updateOrbit()
      if (state.panel && state.panel !== 'report') panels.refresh(state.panel)
    }
    if (message.type === 'toggle') actions.toggle()
    if (message.type === 'command' && message.command === 'report') actions.report()
  })

  const actions = {
    toggle: () => (state.visible ? hideOnSite() : show({ remember: true })),
    report: () => {
      if (!state.visible) show({ remember: true })
      showPanel('report')
    },
  }
  // own shortcuts: only with a modifier or an F key (acceleratorFrom), so normal typing is never caught
  window.addEventListener(
    'keydown',
    event => {
      if (event.repeat || root.querySelector('.keycaps.recording')) return
      const accelerator = acceleratorFrom(event)
      if (!accelerator) return
      const shortcuts = state.config.shortcuts ?? {}
      const action = Object.keys(actions).find(name => shortcuts[name] === accelerator)
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      touch()
      actions[action]()
    },
    true
  )

  toys = createToys({
    root,
    stage,
    buddyEl,
    squishEl,
    perform,
    has,
    onChange: active => {
      if (active) closePanel?.()
      renderChip()
    },
  })

  // ------------------------------------------------------------- arranque
  const { entry, definition } = await definitionFor(state.config.avatarId)
  state.entry = entry
  state.definition = definition
  hostEl.style.display = 'none'
  mountAvatar()
  const hiddenHere = state.config.hiddenSites?.includes(HOST)
  if (!hiddenHere) show()
  // cambios de página sin recargar (las webs de trading son SPA)
  checkPage()
  let lastUrl = location.href
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      checkPage()
    }
  }, 700)
  window.addEventListener('resize', () => {
    applyPosition()
    layoutOrbit()
  })
  window.__deskBuddyReady = true
}

main()
