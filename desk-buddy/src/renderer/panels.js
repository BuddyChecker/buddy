// Paneles de vidrio que abren las burbujas: Avatar, Favoritas y Ajustes.
import { createAvatar } from '@bible-strong/avatar-web'
import { escapeHtml } from './chat.js'
import { playAnimationSound } from './sounds.js'

const MAX_FAVORITES = 3
const NOT_FAVORITABLE = new Set(['idle', 'waking', 'sleeping', 'typing', 'look-left', 'look-right', 'look-up', 'look-down'])

const el = (tag, className, html) => {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (html != null) element.innerHTML = html
  return element
}

const panelShell = (id, title, subtitle) => {
  const panel = el('section', `panel ${id}`)
  panel.id = `panel-${id}`
  panel.hidden = true
  panel.innerHTML = `
    <header class="panel-head">
      <div><strong>${title}</strong>${subtitle ? `<span class="panel-sub">${subtitle}</span>` : ''}</div>
      <button class="icon-btn panel-close" type="button" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </header>
    <div class="panel-body"></div>`
  return panel
}

// ---------------------------------------------------------------------------
// Atajos de teclado
// ---------------------------------------------------------------------------

const KEY_NAMES = { CommandOrControl: 'Ctrl', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Win', Space: 'Space', Up: '↑', Down: '↓', Left: '←', Right: '→' }
export const keycaps = accelerator => String(accelerator ?? '').split('+').filter(Boolean).map(part => KEY_NAMES[part] ?? part)

const CODE_KEYS = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete',
  Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`',
}

/** KeyboardEvent → acelerador de Electron (o null si todavía faltan teclas). */
export const acceleratorFrom = event => {
  const { code } = event
  let key = null
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5)
  else if (/^Numpad[0-9]$/.test(code)) key = `num${code.slice(6)}`
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code
  else if (CODE_KEYS[code]) key = CODE_KEYS[code]
  if (!key) return null
  const modifiers = []
  if (event.ctrlKey) modifiers.push('CommandOrControl')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Super')
  // Sin modificador solo se aceptan F1–F24 (si no, robaría teclas normales).
  if (!modifiers.length && !/^F\d+$/.test(key)) return null
  return [...modifiers, key].join('+')
}

// ---------------------------------------------------------------------------

export const createPanels = ctx => {
  const { api, state } = ctx
  const host = (ctx.root ?? document).querySelector('#panel-host')
  const definitions = new Map()

  const definitionFor = async id => {
    if (!definitions.has(id)) definitions.set(id, api.definition(id))
    return definitions.get(id)
  }

  // ------------------------------------------------------------- Avatar ---
  const avatarPanel = panelShell('avatar', 'Pick your buddy', 'Tap one to put it on your screen')
  host.append(avatarPanel)
  const avatarGrid = el('div', 'avatar-grid')
  avatarPanel.querySelector('.panel-body').append(avatarGrid)
  let avatarGridFor = ''
  const lookers = new Map() // botón → controlador del retrato

  // Mientras el panel está abierto, cada retrato mira hacia el cursor, esté
  // donde esté en la pantalla (la posición la da el proceso principal).
  let following = null
  const followCursor = async () => {
    if (avatarPanel.hidden) {
      following = null
      return
    }
    const cursor = await api.cursor().catch(() => null)
    if (cursor) {
      for (const [button, controller] of lookers) {
        if (!button.isConnected) {
          lookers.delete(button)
          continue
        }
        const rect = button.querySelector('.avatar-tile-preview').getBoundingClientRect()
        const dx = cursor.x - (window.screenX + rect.left + rect.width / 2)
        const dy = cursor.y - (window.screenY + rect.top + rect.height / 2)
        // se satura suave: a ~200 px ya mira casi del todo hacia ese lado
        controller.lookAt(dx / Math.hypot(dx, 140), -dy / Math.hypot(dy, 140))
      }
    }
    following = setTimeout(followCursor, 40)
  }

  const renderAvatarPanel = async () => {
    const avatars = state.avatars ?? []
    const key = avatars.map(item => item.id).join(',')
    if (key !== avatarGridFor) {
      avatarGridFor = key
      avatarGrid.replaceChildren()
      for (const avatar of avatars) {
        const button = el('button', 'avatar-tile')
        button.type = 'button'
        button.dataset.id = avatar.id
        const preview = el('span', 'avatar-tile-preview')
        button.append(preview, el('span', 'avatar-tile-name', escapeHtml(avatar.name)))
        if (avatar.fromStudio) button.append(el('span', 'avatar-tile-badge', '✏️'))
        button.addEventListener('click', async () => {
          if (avatar.id === state.entry.id) return
          ctx.uiSound('select')
          await api.saveSettings({ avatarId: avatar.id })
        })
        avatarGrid.append(button)
        definitionFor(avatar.id).then(({ definition }) => {
          let controller
          try {
            controller = createAvatar(preview, { definition, size: 46, autoplay: false, ariaLabel: avatar.name, maxFps: 24 })
          } catch {
            preview.textContent = '?'
            return
          }
          // Todos siguen al cursor con la mirada (ver followCursor); de entrada, de lado.
          controller.lookAt(0.75, 0.05)
          lookers.set(button, controller)
          button.addEventListener('mouseenter', () => controller.play('happy'))
          button.addEventListener('mouseleave', () => controller.setExpression('neutral'))
        })
      }
    }
    for (const tile of avatarGrid.children) tile.setAttribute('aria-pressed', String(tile.dataset.id === state.entry.id))
    if (!following) following = setTimeout(followCursor, 0)
  }

  // ---------------------------------------------------------- Favoritas ---
  const favoritesPanel = panelShell('favorites', 'Favorite animations', `Pick up to ${MAX_FAVORITES}: they show up more on rapid clicks`)
  host.append(favoritesPanel)
  const favBody = favoritesPanel.querySelector('.panel-body')

  const favorites = () => state.config.favorites[state.entry.id] ?? []

  const toggleFavorite = async key => {
    const result = await api.toggleFavorite(key)
    state.config = result.config
    if (!result.ok) {
      ctx.toast(`Max ${MAX_FAVORITES} favorites. Remove one to pick another.`)
      favBody.querySelector(`[data-key="${key}"]`)?.classList.add('shake')
      return
    }
    ctx.uiSound('toggle')
    renderFavoritesPanel()
    ctx.updateOrbit()
  }

  const renderFavoritesPanel = () => {
    const chosen = favorites()
    const labels = new Map(state.entry.animations.map(animation => [animation.key, animation.labelEn ?? animation.label]))
    favBody.replaceChildren()
    const slots = el('div', 'fav-slots')
    for (let index = 0; index < MAX_FAVORITES; index += 1) {
      const key = chosen[index]
      const slot = el('div', `fav-slot${key ? ' filled' : ''}`)
      if (key) {
        slot.innerHTML = `<span class="fav-star">★</span><span class="fav-name">${escapeHtml(labels.get(key) ?? key)}</span>`
        const play = el('button', 'fav-slot-play', '▶')
        play.type = 'button'
        play.title = 'Play'
        play.addEventListener('click', () => ctx.perform(key))
        const remove = el('button', 'fav-slot-remove', '×')
        remove.type = 'button'
        remove.title = 'Remove'
        remove.addEventListener('click', () => toggleFavorite(key))
        slot.append(play, remove)
      } else {
        slot.innerHTML = `<span class="fav-empty">Empty</span>`
      }
      slots.append(slot)
    }
    favBody.append(slots)
    const groups = new Map()
    for (const animation of state.entry.animations) {
      if (NOT_FAVORITABLE.has(animation.key)) continue
      const group = animation.groupEn ?? animation.group
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group).push(animation)
    }
    const full = chosen.length >= MAX_FAVORITES
    for (const [group, animations] of groups) {
      favBody.append(el('h4', 'group-title', escapeHtml(group)))
      const wrap = el('div', 'fav-chips')
      for (const animation of animations) {
        const on = chosen.includes(animation.key)
        const chip = el('button', `fav-chip${on ? ' on' : ''}${full && !on ? ' dim' : ''}`)
        chip.type = 'button'
        chip.dataset.key = animation.key
        chip.innerHTML = `${on ? '<span class="fav-star">★</span>' : ''}${escapeHtml(animation.labelEn ?? animation.label)}`
        chip.addEventListener('click', () => {
          ctx.perform(animation.key)
          toggleFavorite(animation.key)
        })
        chip.addEventListener('animationend', () => chip.classList.remove('shake'))
        wrap.append(chip)
      }
      favBody.append(wrap)
    }
  }

  // ------------------------------------------------------------ Ajustes ---
  const settingsPanel = panelShell('settings', 'Settings', null)
  host.append(settingsPanel)
  const setBody = settingsPanel.querySelector('.panel-body')

  const save = async patch => {
    state.config = await api.saveSettings(patch)
    renderSettingsPanel()
  }

  const toggleRow = (label, hint, checked, onChange) => {
    const row = el('label', 'set-row toggle-row')
    row.innerHTML = `<div class="set-text"><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</div>`
    const input = el('input')
    input.type = 'checkbox'
    input.className = 'switch'
    input.checked = checked
    input.addEventListener('change', () => {
      ctx.uiSound('toggle')
      onChange(input.checked)
    })
    row.append(input)
    return row
  }

  const sliderRow = (label, { min, max, step, value, format, onInput, onChange }) => {
    const row = el('div', 'set-row slider-row')
    const text = el('div', 'set-text', `<span>${label}</span>`)
    const output = el('output', 'set-value', format(value))
    const input = el('input')
    input.type = 'range'
    input.className = 'glass-range'
    Object.assign(input, { min, max, step, value })
    const fill = () => input.style.setProperty('--fill', `${((input.value - min) / (max - min)) * 100}%`)
    fill()
    input.addEventListener('input', () => {
      fill()
      output.textContent = format(Number(input.value))
      onInput?.(Number(input.value))
    })
    input.addEventListener('change', () => onChange(Number(input.value)))
    row.append(text, output, input)
    return row
  }

  let recording = null // { name, element }

  const shortcutRow = (name, label) => {
    const row = el('div', 'set-row shortcut-row')
    row.innerHTML = `<div class="set-text"><span>${label}</span></div>`
    const button = el('button', 'keycaps')
    button.type = 'button'
    button.dataset.shortcut = name
    const paint = () => {
      if (recording?.name === name) {
        button.classList.add('recording')
        button.innerHTML = '<span class="rec-dot"></span>Press the keys…'
      } else {
        button.classList.remove('recording')
        const keys = keycaps(state.config.shortcuts?.[name])
        button.innerHTML = keys.length ? keys.map(key => `<kbd>${escapeHtml(key)}</kbd>`).join('<em>+</em>') : '<span class="keycaps-empty">Set shortcut</span>'
      }
    }
    button.addEventListener('click', () => {
      recording = recording?.name === name ? null : { name, paint }
      renderSettingsPanel()
      button.focus()
    })
    paint()
    row.append(button)
    return row
  }

  document.addEventListener(
    'keydown',
    async event => {
      if (!recording) return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        recording = null
        renderSettingsPanel()
        return
      }
      if (event.key === 'Backspace') {
        const { name } = recording
        recording = null
        const result = await api.setShortcut(name, '')
        if (result.ok) state.config = result.config
        else ctx.toast(result.error)
        renderSettingsPanel()
        return
      }
      const accelerator = acceleratorFrom(event)
      if (!accelerator) return // falta la tecla principal: sigue escuchando
      const { name } = recording
      recording = null
      const result = await api.setShortcut(name, accelerator)
      if (result.ok) {
        state.config = result.config
        ctx.uiSound('select')
        ctx.toast(`Shortcut saved: ${keycaps(accelerator).join(' + ')}`)
      } else {
        ctx.toast(result.error)
      }
      renderSettingsPanel()
    },
    true
  )

  const section = (title, ...rows) => {
    const group = el('div', 'set-group')
    group.append(el('h4', 'group-title', title), ...rows.filter(Boolean))
    return group
  }

  const segmented = (label, options, value, onChange) => {
    const row = el('div', 'set-row seg-row')
    row.append(el('div', 'set-text', `<span>${label}</span>`))
    const seg = el('div', 'segmented')
    for (const [optionValue, optionLabel] of options) {
      const button = el('button', optionValue === value ? 'on' : '', optionLabel)
      button.type = 'button'
      button.addEventListener('click', () => {
        ctx.uiSound('toggle')
        onChange(optionValue)
      })
      seg.append(button)
    }
    row.append(seg)
    return row
  }

  const percent = value => `${Math.round(value * 100)}%`

  /** Secciones propias de la app de escritorio. */
  const desktopSections = ({ el, section, toggleRow, shortcutRow, save, config }) => {
    const more = el('button', 'glass-btn', 'More settings <small>AI · custom sounds</small>')
    more.type = 'button'
    more.addEventListener('click', () => api.openSettings())
    const hide = el('button', 'glass-btn', 'Hide')
    hide.type = 'button'
    hide.addEventListener('click', () => {
      ctx.closeAll()
      api.hide()
    })
    const quit = el('button', 'glass-btn danger', 'Quit')
    quit.type = 'button'
    quit.addEventListener('click', () => api.quit())
    return {
      before: [
        section(
          'Keyboard shortcuts',
          shortcutRow('toggle', 'Summon / hide your buddy'),
          shortcutRow('capture', 'Ask about your screen'),
          el('p', 'set-hint', 'Tap a shortcut and press the new combo. <b>Esc</b> cancels · <b>Backspace</b> restores the default.')
        ),
      ],
      after: [
        section(
          'System',
          toggleRow('Always on top', 'Stays above every window', config.alwaysOnTop, value => save({ alwaysOnTop: value })),
          toggleRow('Launch at startup', 'Shows up when your PC turns on', Boolean(config.launchAtLogin), value => save({ launchAtLogin: value }))
        ),
      ],
      actions: [more, hide, quit],
    }
  }

  const renderSettingsPanel = () => {
    const config = state.config
    const scroll = setBody.scrollTop
    // Cada plataforma agrega sus secciones (atajos, sistema, IA…) alrededor
    // de las comunes (sonido y avatar). Sin ctx.settingsSections: escritorio.
    const helpers = { el, section, toggleRow, sliderRow, segmented, shortcutRow, save, percent, config }
    const custom = ctx.settingsSections?.(helpers) ?? desktopSections(helpers)
    setBody.replaceChildren(
      ...custom.before,
      section(
        'Sound',
        sliderRow('Animation volume', {
          min: 0,
          max: 1,
          step: 0.05,
          value: config.animationVolume ?? 0.7,
          format: percent,
          onChange: value => {
            save({ animationVolume: value })
            playAnimationSound('happy', { ...config, animationVolume: value })
          },
        }),
        sliderRow('Click volume', {
          min: 0,
          max: 1,
          step: 0.05,
          value: config.clickVolume ?? 0.45,
          format: percent,
          onChange: value => {
            save({ clickVolume: value })
            ctx.tap({ ...config, clickVolume: value })
          },
        }),
        toggleRow('Sound on every animation', null, config.animationSounds !== false, value => save({ animationSounds: value })),
        toggleRow('Mute everything', null, Boolean(config.muted), value => save({ muted: value }))
      ),
      section(
        'Buddy',
        sliderRow('Size', {
          min: 120,
          max: 260,
          step: 10,
          value: config.size,
          format: value => `${value} px`,
          onChange: value => save({ size: value }),
        }),
        sliderRow('Favorites frequency', {
          min: 0,
          max: 1,
          step: 0.05,
          value: config.favoriteBias ?? 0.7,
          format: percent,
          onChange: value => save({ favoriteBias: value }),
        }),
        segmented(
          'Falls asleep after',
          [
            [1, '1 min'],
            [3, '3'],
            [5, '5'],
            [10, '10'],
            [100000, 'Never'],
          ],
          config.idleSleepMinutes,
          value => save({ idleSleepMinutes: value })
        )
      ),
      ...custom.after
    )
    const actions = el('div', 'set-actions')
    actions.append(...custom.actions)
    setBody.append(actions)
    setBody.scrollTop = scroll
  }

  // Cerrar desde el encabezado
  for (const panel of [avatarPanel, favoritesPanel, settingsPanel]) {
    panel.querySelector('.panel-close').addEventListener('click', () => ctx.closePanel())
  }

  return {
    panels: { avatar: avatarPanel, favorites: favoritesPanel, settings: settingsPanel },
    render: {
      avatar: renderAvatarPanel,
      favorites: renderFavoritesPanel,
      settings: () => {
        recording = null
        renderSettingsPanel()
      },
    },
    refresh: name => {
      if (name === 'avatar') renderAvatarPanel()
      if (name === 'favorites') renderFavoritesPanel()
      if (name === 'settings' && !recording) renderSettingsPanel()
    },
    isRecording: () => Boolean(recording),
  }
}
