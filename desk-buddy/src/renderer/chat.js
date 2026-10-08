// Chat de vidrio: captura de pantalla, preguntas a la IA y escáner de tokens.
// Lo comparten la app de escritorio y la extensión de Chrome: todo lo que
// depende de la plataforma llega por ctx (api, root, onShot…).

const CAPTURE_CHIPS = [
  'Is this chart real or bundled?',
  'Was this website made with AI?',
  'Is the tech on this site real?',
  "Explain what I'm looking at",
]

const VERDICTS = {
  '🟢': { level: 'green', title: 'Low risk' },
  '🟡': { level: 'yellow', title: 'Caution' },
  '🔴': { level: 'red', title: 'High risk' },
  '⚪': { level: 'gray', title: "Can't tell" },
}

export const escapeHtml = text =>
  String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

const inline = text => escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')

/**
 * Respuesta de la IA → HTML: la primera línea con semáforo se vuelve una
 * insignia de veredicto, las viñetas una lista y "Para confirmar:" un recuadro.
 */
export const renderAnswer = (text, { streaming = false } = {}) => {
  const lines = text.replace(/\r/g, '').split('\n')
  let html = ''
  let list = []
  const flush = () => {
    if (list.length) html += `<ul class="answer-list">${list.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`
    list = []
  }
  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (!line) return flush()
    const verdict = index === 0 && Object.keys(VERDICTS).find(emoji => line.startsWith(emoji))
    if (verdict) {
      flush()
      const info = VERDICTS[verdict]
      const rest = line.slice(verdict.length).replace(/^[\s.:–—-]+/, '')
      html += `<div class="verdict ${info.level}"><i></i><div><strong>${info.title}</strong>${rest ? `<span>${inline(rest)}</span>` : ''}</div></div>`
      return
    }
    const bullet = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/)
    if (bullet) return list.push(bullet[1])
    const confirm = line.match(/^\**(?:Para confirmar|To confirm|How to confirm):?\**:?\s*(.*)$/i)
    if (confirm) {
      flush()
      html += `<div class="callout"><span class="callout-icon">🔎</span><div><strong>To confirm</strong><span>${inline(confirm[1])}</span></div></div>`
      return
    }
    flush()
    html += `<p>${inline(line)}</p>`
  })
  flush()
  return html + (streaming ? '<span class="caret"></span>' : '')
}

const money = value =>
  value == null
    ? '—'
    : value >= 1e9
      ? `$${(value / 1e9).toFixed(2)}B`
      : value >= 1e6
        ? `$${(value / 1e6).toFixed(2)}M`
        : value >= 1e3
          ? `$${(value / 1e3).toFixed(1)}k`
          : `$${Math.round(value)}`

export const createChat = ctx => {
  const { api, state } = ctx
  const $ = selector => (ctx.root ?? document).querySelector(selector)
  const texts = {
    captured: "Got your screen 📸 What do you want to know? You can also paste a CA.",
    shotLabel: 'Your screen',
    ...ctx.texts,
  }
  const panel = $('#chat')
  const thread = $('#thread')
  const chips = $('#chips')
  const form = $('#ask-form')
  const input = $('#ask-input')
  const sendButton = $('#ask-send')
  const status = $('#chat-status')

  const setStatus = (text, mode = 'idle') => {
    status.dataset.mode = mode
    status.querySelector('span').textContent = text
  }

  const scrollDown = () => {
    thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' })
  }

  const row = (role, content) => {
    const element = document.createElement('div')
    element.className = `msg ${role}`
    if (content instanceof Node) element.append(content)
    else if (content != null) element.textContent = content
    thread.append(element)
    scrollDown()
    return element
  }

  const setChips = labels => {
    chips.replaceChildren(
      ...labels.map(label => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'chip'
        button.textContent = label
        button.addEventListener('click', () => submit(label))
        return button
      })
    )
  }
  chips.addEventListener(
    'wheel',
    event => {
      if (!event.deltaY) return
      event.preventDefault()
      chips.scrollLeft += event.deltaY
    },
    { passive: false }
  )

  // textarea que crece hasta 4 líneas; Enter envía, Shift+Enter salta de línea
  const autosize = () => {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 96)}px`
  }
  input.addEventListener('input', autosize)
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      form.requestSubmit()
    }
  })

  const shotCard = shot => {
    const card = document.createElement('figure')
    card.className = 'shot'
    const image = new Image()
    image.src = shot.dataUrl
    image.alt = 'Screenshot of your screen'
    const caption = document.createElement('figcaption')
    const time = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
    caption.innerHTML = `<span>📸 ${escapeHtml(texts.shotLabel)} · ${time}</span><span class="shot-size">${shot.width}×${shot.height}</span>`
    card.append(image, caption)
    card.addEventListener('click', () => {
      card.classList.toggle('expanded')
      ctx.uiSound('select')
    })
    return card
  }

  const typing = () => {
    const dots = document.createElement('span')
    dots.className = 'typing'
    dots.innerHTML = '<i></i><i></i><i></i>'
    return dots
  }

  const copyButton = getText => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'copy-btn'
    button.textContent = 'Copy'
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(getText())
        button.textContent = 'Copied!'
        setTimeout(() => {
          button.textContent = 'Copy'
        }, 1400)
      } catch {
        button.textContent = "Couldn't copy"
      }
    })
    return button
  }

  const renderScan = scan => {
    const market = scan.market
    const age =
      market?.ageHours == null
        ? '—'
        : market.ageHours < 48
          ? `${Math.round(market.ageHours)} h`
          : `${Math.round(market.ageHours / 24)} d`
    const card = document.createElement('div')
    card.className = `scan verdict-${scan.verdict}`
    const reds = scan.flags.filter(flag => flag.level === 'red').length
    const yellows = scan.flags.filter(flag => flag.level === 'yellow').length
    const greens = scan.flags.filter(flag => flag.level === 'green').length
    card.innerHTML = `
      <div class="scan-head">
        <div class="scan-token">
          <strong>${escapeHtml(scan.symbol ? `$${scan.symbol}` : 'Token')}</strong>
          <span>${escapeHtml(scan.name ?? '')}</span>
        </div>
        <span class="chain">${escapeHtml(scan.chain)}</span>
        <span class="risk ${scan.verdict}"><i></i>${{ alto: 'High risk', medio: 'Caution', bajo: 'Low risk' }[scan.verdict] ?? scan.verdict}</span>
      </div>
      <div class="scan-meter" aria-hidden="true">
        <span class="red" style="flex:${reds || 0.001}"></span>
        <span class="yellow" style="flex:${yellows || 0.001}"></span>
        <span class="green" style="flex:${greens || 0.001}"></span>
      </div>
      <div class="scan-stats">
        <div><span>Liquidity${market?.pools > 1 ? ` · ${market.pools} pools` : ''}</span><b>${money(market?.liquidityUsd)}</b></div>
        <div><span>FDV</span><b>${money(market?.fdv)}</b></div>
        <div><span>Age</span><b>${age}</b></div>
        <div><span>Vol 24h</span><b>${money(market?.volume24h)}</b></div>
        <div><span>Buys 24h</span><b>${market?.buys24h ?? '—'}</b></div>
        <div><span>Sells 24h</span><b>${market?.sells24h ?? '—'}</b></div>
      </div>
      <ul class="flags">${scan.flags.map(flag => `<li class="${flag.level}"><i></i><span>${escapeHtml(flag.text)}</span></li>`).join('')}</ul>
      <div class="scan-foot">
        <span>Real data: ${scan.sources.map(escapeHtml).join(' · ')}${scan.errors.length ? ` · ⚠ ${escapeHtml(scan.errors.join(' | '))}` : ''}</span>
        ${market?.url ? '<button type="button" class="link-btn">DexScreener ↗</button>' : ''}
      </div>`
    card.querySelector('.link-btn')?.addEventListener('click', () => api.openUrl(market.url))
    row('buddy card', card)
  }

  const reactTo = text => {
    const first = text.trim().slice(0, 4)
    if (first.includes('🔴')) ctx.perform(ctx.has('scared') ? 'scared' : 'error', 3500)
    else if (first.includes('🟡')) ctx.perform(ctx.has('suspicious') ? 'suspicious' : 'confused', 3500)
    else if (first.includes('🟢')) ctx.perform('happy', 3000)
    else if (first.includes('⚪')) ctx.perform('confused', 3000)
    else ctx.backToIdle()
  }

  let requestCounter = 0
  const askAi = async (question, { scan = null } = {}) => {
    const requestId = `r${Date.now()}-${++requestCounter}`
    const message = row('buddy')
    const body = document.createElement('div')
    body.className = 'answer'
    body.append(typing())
    message.append(body)
    let text = ''
    const stopListening = api.onDelta(payload => {
      if (payload.requestId !== requestId) return
      text += payload.text
      body.innerHTML = renderAnswer(text, { streaming: true })
      scrollDown()
    })
    ctx.setThinking(true)
    setStatus('Thinking…', 'busy')
    try {
      const result = await api.ask({ requestId, question, useCapture: state.hasCapture, scan })
      if (result.ok) {
        const final = result.text || text
        body.innerHTML = renderAnswer(final)
        message.append(copyButton(() => final))
        ctx.sound('answer')
        reactTo(final)
        setStatus('Ready to help')
      } else {
        message.classList.add('error')
        body.textContent = result.error
        if (/API key|Ajustes/.test(result.error)) {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'chip'
          button.textContent = 'Open AI settings'
          button.addEventListener('click', () => api.openSettings())
          message.append(button)
        }
        ctx.perform('confused', 2500)
        setStatus('Something went wrong', 'error')
      }
    } finally {
      stopListening()
      ctx.setThinking(false)
      scrollDown()
    }
  }

  const submit = async rawText => {
    const text = String(rawText ?? '').trim()
    if (!text || state.busy) return
    ctx.touch()
    state.busy = true
    sendButton.disabled = true
    input.value = ''
    autosize()
    row('user', text)
    try {
      if (await api.looksLikeToken(text)) {
        ctx.setThinking(true)
        setStatus('Scanning the token…', 'busy')
        ctx.play('searching') || ctx.play('thinking')
        const result = await api.scan(text)
        ctx.setThinking(false)
        if (!result.ok) {
          row('buddy error', result.error)
          ctx.perform('confused', 2500)
          setStatus("Couldn't scan it", 'error')
          return
        }
        state.lastScan = result.scan
        renderScan(result.scan)
        setChips(['Explain it simply', 'Looks bundled?', 'What should I check before buying?'])
        if (state.config.hasApiKey) {
          await askAi('Explain simply whether this token has risk signals, using the scan facts.', {
            scan: result.scan,
          })
        } else {
          row('buddy', ctx.texts?.noKey ?? 'These signals come from real data. Add your API key (Settings → More settings) and I\'ll explain them in plain words too.')
          reactTo(result.scan.verdict === 'alto' ? '🔴' : result.scan.verdict === 'medio' ? '🟡' : '🟢')
          setStatus('Ready to help')
        }
      } else {
        await askAi(text, { scan: state.lastScan })
      }
    } finally {
      state.busy = false
      sendButton.disabled = false
      input.focus()
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault()
    submit(input.value)
  })

  const reset = () => {
    thread.replaceChildren()
    chips.replaceChildren()
    state.hasCapture = false
    state.lastScan = null
  }

  const open = () => {
    $('#chat-name').textContent = state.entry.name
    ctx.miniAvatar($('#chat-avatar'), 30)
    ctx.showPanel('chat')
    setTimeout(() => input.focus(), 60)
  }

  const startCapture = async () => {
    if (state.capturing) return
    state.capturing = true
    ctx.touch()
    ctx.sound('capture')
    ctx.play('curious') || ctx.play('look-up')
    try {
      const shot = await api.capture()
      ctx.onShot?.(shot)
      reset()
      state.hasCapture = true
      row('shot-row', shotCard(shot))
      row('buddy', texts.captured)
      setChips(CAPTURE_CHIPS)
      setStatus('Looking at your screen')
      open()
    } catch (error) {
      open()
      const message = row('buddy error', error.needsPermission ? error.message : `Couldn't capture the screen: ${error.message}`)
      const action = ctx.captureErrorAction?.(error)
      if (action) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'chip'
        button.textContent = action.label
        button.addEventListener('click', action.onClick)
        message.append(button)
      }
    } finally {
      state.capturing = false
      ctx.backToIdle(1500)
    }
  }

  const startScanMode = () => {
    ctx.touch()
    reset()
    row('buddy', 'Paste a CA or a DexScreener / pump.fun link and I\'ll check it with real data 🔎')
    setStatus('Ready to scan')
    input.placeholder = 'CA or token link (Solana, ETH, Base, BSC…)'
    open()
  }

  const onClose = () => {
    reset()
    api.discardCapture()
    input.placeholder = 'Ask me anything or paste a CA…'
    setStatus('Ready to help')
  }

  $('#chat-close').addEventListener('click', () => ctx.closePanel())
  $('#chat-recapture').addEventListener('click', () => startCapture())

  /** Muestra un escaneo ya hecho (p. ej. el automático de la página abierta). */
  const showScan = (scan, { intro } = {}) => {
    reset()
    if (intro) row('buddy', intro)
    state.lastScan = scan
    renderScan(scan)
    setChips(['Explain it simply', 'Looks bundled?', 'What should I check before buying?'])
    setStatus('Ready to help')
    open()
  }

  return { panel, startCapture, startScanMode, showScan, onClose, submit, renderAnswer }
}
