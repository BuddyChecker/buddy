// "Report" panel: everything the buddy knows about the token on the page, no chat.
// It builds itself as soon as you open a token and fills in as data arrives
// (on-chain launch read and website check land a few seconds later).
import { escapeHtml } from '../../desk-buddy/src/renderer/chat.js'
import { volumePace } from '../../desk-buddy/src/main/momentum.js'
import { ICONS, edgeRows, readLine } from './edge.js'
import { headline, topFlags } from './site-flags.js'

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
const pct = value => (value == null ? '—' : `${Number(value).toFixed(value < 10 ? 1 : 0)}%`)
const age = hours => (hours == null ? '—' : hours < 1 ? `${Math.max(1, Math.round(hours * 60))}m` : hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`)
const count = value => (value == null ? '—' : Number(value).toLocaleString('en'))
const shortAddress = address => (address ? `${address.slice(0, 4)}…${address.slice(-4)}` : '—')
const RISK = { alto: 'High risk', medio: 'Caution', bajo: 'Low risk' }

const flagList = flags => `<ul class="flags">${flags.map(flag => `<li class="${flag.level}"><i></i><span>${escapeHtml(flag.text)}</span></li>`).join('')}</ul>`

const launchHtml = scan => {
  const launch = scan.launch
  if (scan.chain !== 'solana') return ''
  let body
  if (!launch) body = '<p class="muted">Older than 3 days: the launch block doesn\'t tell much anymore.</p>'
  else if (launch.status === 'pending') body = '<p class="muted"><span class="spinner"></span>Reading the launch on-chain…</p>'
  else if (launch.status === 'too-many') body = `<p class="muted">Too many txs (${count(launch.transactions)}+) to rebuild the launch.</p>`
  else if (launch.status !== 'ok') body = '<p class="muted">Couldn\'t read the launch right now (RPC is busy). Will retry later.</p>'
  else {
    const bundle = launch.sameBlockWallets
    const level = (bundle >= 3 && (launch.sameBlockPct ?? 0) >= 5) || (launch.sameBlockPct ?? 0) >= 15 ? 'red' : bundle ? 'yellow' : 'green'
    body = `<div class="kv">
        <div class="${level}"><span>Bundlers (dev's block)</span><b>${bundle} wallet${bundle === 1 ? '' : 's'} · ${pct(launch.sameBlockPct)}</b></div>
        <div><span>Snipers (next block)</span><b>${launch.nextBlockWallets} · ${pct(launch.nextBlockPct)}</b></div>
        <div><span>Dev bought at launch</span><b>${pct(launch.devBuyPct)}</b></div>
        <div><span>Dev holds now</span><b>${pct(scan.dev?.pct)}</b></div>
      </div>
      <p class="muted small">Dev: ${escapeHtml(shortAddress(launch.creator))} · ${count(launch.transactions)} txs checked</p>`
  }
  return `<section class="rep-section" data-section="launch"><h4>${ICONS.launch}Launch</h4>${body}</section>`
}

/** Mini bubblemap: top holders as bubbles (insiders red, pools blue). */
const bubbleSvg = holders => {
  const width = 360
  const height = 150
  const items = holders
    .filter(holder => holder.pct > 0)
    .slice(0, 20)
    .map(holder => ({ ...holder, r: Math.max(5, Math.min(46, Math.sqrt(holder.pct) * 11)) }))
  // simple packing: place bubbles left to right in rows, biggest first
  const placed = []
  const collides = (x, y, r) => placed.some(other => Math.hypot(other.x - x, other.y - y) < other.r + r + 2)
  for (const item of items) {
    let done = false
    for (let radius = 0; radius < 180 && !done; radius += 4) {
      for (let angle = 0; angle < Math.PI * 2 && !done; angle += 0.35) {
        const x = width / 2 + Math.cos(angle) * radius * 1.7
        const y = height / 2 + Math.sin(angle) * radius * 0.8
        if (x - item.r < 2 || x + item.r > width - 2 || y - item.r < 2 || y + item.r > height - 2) continue
        if (!collides(x, y, item.r)) {
          placed.push({ ...item, x, y })
          done = true
        }
      }
    }
  }
  const fill = holder => (holder.pool ? 'rgba(122,162,255,0.55)' : holder.insider ? 'rgba(255,107,122,0.75)' : 'rgba(255,255,255,0.22)')
  const stroke = holder => (holder.pool ? '#9fb7ff' : holder.insider ? '#ff8e9a' : 'rgba(255,255,255,0.45)')
  return `<svg class="bubbles" viewBox="0 0 ${width} ${height}" role="img" aria-label="Top holders bubblemap">${placed
    .map(
      holder =>
        `<circle cx="${holder.x.toFixed(1)}" cy="${holder.y.toFixed(1)}" r="${holder.r.toFixed(1)}" fill="${fill(holder)}" stroke="${stroke(holder)}"><title>${escapeHtml(shortAddress(holder.address))} · ${pct(holder.pct)}${holder.pool ? ' · pool' : holder.insider ? ' · insider' : ''}</title></circle>${
          holder.r >= 16 ? `<text x="${holder.x.toFixed(1)}" y="${(holder.y + 4).toFixed(1)}" text-anchor="middle">${pct(holder.pct)}</text>` : ''
        }`
    )
    .join('')}</svg>`
}

const bubblesHtml = scan => {
  const map = scan.holderMap
  if (!map?.holders?.length) return ''
  const insiders = map.holders.filter(holder => holder.insider)
  const insiderPct = insiders.reduce((sum, holder) => sum + holder.pct, 0)
  const clusters = map.networks?.length
    ? `<ul class="flags">${map.networks
        .slice(0, 3)
        .map(network => `<li class="${(network.pct ?? 0) >= 5 ? 'red' : 'yellow'}"><i></i><span>Cluster of ${network.wallets} linked wallets${network.pct != null ? ` holding ${pct(network.pct)}` : ''}${network.type ? ` (linked by ${escapeHtml(network.type)})` : ''}${network.poolPct >= 1 ? `, LP pool (${pct(network.poolPct)}) left out` : ''}.</span></li>`)
        .join('')}</ul>`
    : ''
  const link = scan.chain === 'solana' ? `<button type="button" class="link-chip" data-url="https://app.bubblemaps.io/sol/token/${escapeHtml(scan.address)}">Open Bubblemaps ↗</button>` : ''
  return `<section class="rep-section" data-section="bubbles"><h4>${ICONS.linked}Connected wallets</h4>
    ${bubbleSvg(map.holders)}
    <p class="legend"><span class="dot insider"></span>insiders (${insiders.length} · ${pct(insiderPct)}) <span class="dot pool"></span>pools/LP <span class="dot holder"></span>holders</p>
    ${clusters}${link ? `<div class="chips-row">${link}</div>` : ''}
  </section>`
}

const vampsHtml = (scan, twins) => {
  const vamps = scan.vamps
  if (!vamps) return ''
  const flags = scan.flags.filter(flag => flag.kind === 'vamp' || flag.kind === 'identity')
  // a narrative race: what each twin's page says it is (model, launch post)
  const twinRows = (twins ?? [])
    .map(
      twin =>
        `<button type="button" class="vamp-row twin-row" data-url="${escapeHtml(twin.url ?? '')}"><b>${escapeHtml(shortAddress(twin.address))}</b><span>${escapeHtml(twin.model ?? (twin.reachable ? 'no model named' : 'no page'))}</span><span>${money(twin.marketCap)} MC</span>${
          twin.pitch ? `<span class="twin-pitch">“${escapeHtml(twin.pitch)}”</span>` : ''
        }</button>`
    )
    .join('')
  const rows = vamps.top
    .slice(0, 3)
    .map(
      token =>
        `<button type="button" class="vamp-row" data-url="${escapeHtml(token.url ?? '')}"><b>$${escapeHtml(token.symbol ?? '?')}</b><span>${escapeHtml(shortAddress(token.address))}</span><span>${money(token.marketCap)} MC</span><span>${Number.isFinite(token.createdAt) ? age((Date.now() - token.createdAt) / 3.6e6) : '—'}</span></button>`
    )
    .join('')
  return `<section class="rep-section" data-section="vamp"><h4>${ICONS.vamp}Vamp check</h4>${flagList(flags)}
    <p class="muted small">${vamps.copies} same-ticker token${vamps.copies === 1 ? '' : 's'} on this chain · ${vamps.otherChains} on other chains</p>
    ${rows ? `<div class="vamp-list">${rows}</div>` : ''}
    ${twinRows ? `<p class="muted small">What the twins say they are</p><div class="vamp-list">${twinRows}</div>` : ''}</section>`
}

const socialsHtml = (scan, site) => {
  const socials = scan.socials
  if (!socials) return ''
  const link = (url, label) => `<button type="button" class="link-chip" data-url="${escapeHtml(url)}">${label}</button>`
  const chips = [
    ...socials.websites.slice(0, 2).map(url => link(url, escapeHtml(new URL(url).hostname.replace(/^www\./, '')))),
    ...socials.twitter.slice(0, 1).map(url => link(url, 'X')),
    ...socials.telegram.slice(0, 1).map(url => link(url, 'Telegram')),
  ]
  let siteLine = ''
  if (site === 'pending') siteLine = '<p class="muted"><span class="spinner"></span>Checking the project website…</p>'
  else if (site?.flags?.length) siteLine = flagList(site.flags)
  return `<section class="rep-section" data-section="site"><h4>${ICONS.site}Website & socials</h4>${
    chips.length ? `<div class="chips-row">${chips.join('')}</div>` : '<p class="muted">No website or socials listed.</p>'
  }${siteLine}</section>`
}

// ATH, where the price sits against it, and the volume pace (live, every 20 s)
const momentumHtml = momentum => {
  if (!momentum?.pulse) return ''
  const { ath, pulse, recent = [] } = momentum
  const mcPerPrice = pulse.marketCap && pulse.priceUsd ? pulse.marketCap / pulse.priceUsd : null
  const athMc = ath && mcPerPrice ? ath.price * mcPerPrice : null
  const gap = ath ? (pulse.priceUsd / ath.price - 1) * 100 : null
  const pace = volumePace(pulse)
  const gapLevel = gap == null ? '' : gap >= -5 ? 'green' : gap <= -60 ? 'red' : 'yellow'
  return `<section class="rep-section" data-section="momentum"><h4>${ICONS.ath}Momentum</h4>
    <div class="kv">
      <div class="${gapLevel}"><span>ATH${athMc ? ' (MC)' : ''}</span><b>${ath ? money(athMc ?? ath.price) : '—'}</b></div>
      <div class="${gapLevel}"><span>From ATH</span><b>${gap == null ? '—' : gap >= 0 ? 'AT ATH' : `${gap.toFixed(0)}%`}</b></div>
      <div class="${pace >= 3 ? 'green' : ''}"><span>Vol 5m (vs usual)</span><b>${money(pulse.volume?.m5)}${pace ? ` · ${pace.toFixed(1)}x` : ''}</b></div>
    </div>
    ${recent.length ? `<ul class="flags">${recent.map(alert => `<li class="green"><i></i><span>${escapeHtml(alert.text)}</span></li>`).join('')}</ul>` : '<p class="muted small">Live: checks price and volume every 20 s while this tab is open.</p>'}
  </section>`
}

export const createReport = ctx => {
  const { root } = ctx
  const panel = document.createElement('section')
  panel.className = 'panel report'
  panel.id = 'panel-report'
  panel.hidden = true
  panel.innerHTML = `
    <header class="panel-head">
      <div><strong class="rep-title">Report</strong><span class="panel-sub rep-sub">Open a token and I'll tell you what I see</span></div>
      <button class="icon-btn panel-close" type="button" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </header>
    <div class="panel-body rep-body"></div>
    <form class="rep-form" autocomplete="off">
      <input class="rep-input" placeholder="Another token? Paste a CA or link" />
      <button class="send-btn" type="submit" aria-label="Check"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
    </form>`
  root.querySelector('#panel-host').append(panel)
  const body = panel.querySelector('.rep-body')
  panel.querySelector('.panel-close').addEventListener('click', () => ctx.closePanel())
  panel.querySelector('.rep-form').addEventListener('submit', event => {
    event.preventDefault()
    const input = panel.querySelector('.rep-input')
    if (input.value.trim()) ctx.scanManual(input.value.trim())
    input.value = ''
  })
  body.addEventListener('click', event => {
    const target = event.target.closest('[data-url]')
    if (target?.dataset.url) ctx.api.openUrl(target.dataset.url)
  })

  let current = { scan: null, site: null, updatedAt: 0 }
  let moreOpen = false // the full report stays open/closed across live refreshes
  // watchlist: the star + your MC alert (the background checks them every minute, tab open or not)
  const watchUi = async () => {
    const scan = current.scan
    const button = body.querySelector('.watch-btn')
    if (!button || !scan?.address) return
    const state = await ctx.api.watchState(scan.address)
    button.setAttribute('aria-pressed', String(Boolean(state?.watched)))
    button.querySelector('span').textContent = state?.watched ? 'Watching' : 'Watch'
    const note = body.querySelector('.watch-note')
    const targets = state?.targets ?? []
    note.hidden = !state?.watched
    note.textContent = state?.watched ? `Checked every minute, even with this tab closed.${targets.length ? ` Alerts at ${targets.map(target => `$${target.mc >= 1e6 ? `${target.mc / 1e6}M` : `${target.mc / 1e3}k`}`).join(', ')} MC.` : ''}` : ''
  }
  body.addEventListener('click', async event => {
    const button = event.target.closest('.watch-btn')
    if (!button || !current.scan?.address) return
    await ctx.api.watch(current.scan, button.getAttribute('aria-pressed') !== 'true')
    watchUi()
  })
  body.addEventListener('click', event => {
    if (event.target.closest('.ask-ai-btn')) ctx.api.askAi()
  })
  body.addEventListener('submit', async event => {
    if (!event.target.closest('.mc-form')) return
    event.preventDefault()
    const input = event.target.querySelector('.mc-input')
    const result = await ctx.api.watchTarget(current.scan, input.value)
    if (!result?.ok) return ctx.toast?.(result?.error ?? "Couldn't set that alert.")
    input.value = ''
    watchUi()
  })
  body.addEventListener('toggle', event => {
    if (event.target.classList?.contains('rep-more')) moreOpen = event.target.open
  }, true)
  // a quick-card row opens the full report right at its section
  body.addEventListener('click', event => {
    const row = event.target.closest('.edge-row[data-target]')
    if (!row) return
    const more = body.querySelector('.rep-more')
    more.open = moreOpen = true
    body.querySelector(`[data-section="${row.dataset.target}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })

  const render = () => {
    const { scan, site, momentum, memory, trend, holding, brain, twins } = current
    if (!scan) {
      panel.querySelector('.rep-title').textContent = 'Report'
      panel.querySelector('.rep-sub').textContent = "Open a token and I'll tell you what I see"
      body.innerHTML = `<div class="rep-empty"><p>No token on this page.</p><p class="muted">Open one on pump.fun, DexScreener, GMGN, Photon, Axiom or Birdeye… or paste a CA below.</p></div>`
      return
    }
    if (scan.loading) {
      body.innerHTML = `<div class="rep-empty"><p><span class="spinner"></span>Checking ${escapeHtml(scan.input ?? 'the token')}…</p></div>`
      return
    }
    if (scan.error) {
      body.innerHTML = `<div class="rep-empty"><p>${escapeHtml(scan.error)}</p></div>`
      return
    }
    const market = scan.market
    panel.querySelector('.rep-title').textContent = scan.symbol ? `$${scan.symbol}` : 'Token'
    panel.querySelector('.rep-sub').textContent = `${scan.name ?? ''} · ${scan.chain} · CA ${shortAddress(scan.address)}`
    const flags = [...scan.flags, ...(site && site !== 'pending' ? site.flags ?? [] : [])]
    body.innerHTML = `
      <div class="rep-verdict verdict-${scan.verdict}">
        <span class="risk ${scan.verdict}"><i></i>${RISK[scan.verdict] ?? 'Checking'}</span>
        <p>${escapeHtml(brain?.line || readLine({ scan, site, momentum, memory, trend, holding, twins }) || headline(scan.verdict))}</p>
        ${brain?.line ? `<span class="brain-tag" title="Claude, paid from the buddy's own fuel">${ICONS.brain}AI read</span>` : brain?.hungry ? '<span class="brain-tag hungry" title="Out of fuel until the next fee claim">Buddy is hungry: rules only</span>' : brain?.error ? '<span class="brain-tag hungry">The AI is not available right now</span>' : ''}
      </div>
      <div class="edge">${edgeRows({ scan, site, momentum, memory, trend, holding, twins })
        .map(
          row =>
            `<button type="button" class="edge-row ${row.level}"${row.target ? ` data-target="${row.target}"` : ''}><span class="edge-icon">${ICONS[row.key] ?? ''}</span><span class="edge-label">${escapeHtml(row.label)}</span><b>${escapeHtml(row.value)}</b></button>`
        )
        .join('')}</div>
      <div class="rep-watch">
        <button type="button" class="watch-btn" aria-pressed="false">${ICONS.watch}<span>Watch</span></button>
        ${brain?.line || brain?.hungry ? '' : `<button type="button" class="ask-ai-btn"${brain?.loading ? ' disabled' : ''} title="Claude reads the narrative and the signals (paid from the buddy's own fuel)">${ICONS.brain}<span>${brain?.loading ? 'Thinking…' : 'Ask AI'}</span></button>`}
        <form class="mc-form" autocomplete="off"><input class="mc-input" placeholder="Alert at MC (1M, 500k…)" /><button type="submit">Set</button></form>
      </div>
      <p class="watch-note muted small" hidden></p>
      <details class="rep-more"${moreOpen ? ' open' : ''}><summary>Full report</summary>
      <section class="rep-section"><h4>${ICONS.signals}Other signals</h4>${flagList(topFlags(flags))}</section>
      ${momentumHtml(momentum)}
      ${launchHtml(scan)}
      ${bubblesHtml(scan)}
      ${vampsHtml(scan, twins)}
      ${socialsHtml(scan, site)}
      <details class="rep-all"><summary>All signals (${flags.length})</summary>${flagList(flags)}</details>
      </details>
      <div class="scan-foot">
        <span><span class="live-dot"></span>Watching · data from ${scan.sources.map(escapeHtml).join(', ')}</span>
        ${market?.url ? `<button type="button" class="link-btn" data-url="${escapeHtml(market.url)}">DexScreener ↗</button>` : ''}
      </div>
      <p class="muted small rep-disclaimer">Not financial advice. Signals from public data, DYOR.</p>`
    watchUi()
  }

  render()
  return {
    panel,
    set(next) {
      current = { ...current, ...next, updatedAt: Date.now() }
      if (!panel.hidden) render()
    },
    get: () => current,
    render,
  }
}
