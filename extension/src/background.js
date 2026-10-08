// Service worker de la extensión: el "proceso principal" del buddy en Chrome.
// Modo INFORMATIVO (sin chat ni IA):
//   · escanea tokens (DexScreener + RugCheck/GoPlus, mismo código que la app de escritorio)
//   · lee el lanzamiento en la blockchain de Solana (bundle, snipers, dev) en segundo plano
//   · pide al servidor de Buddy la revisión de la web del proyecto (sin IA)
//   · pinta el semáforo en el ícono de la extensión para cada pestaña
import { scanToken, verdictFor, withLaunch } from '../../desk-buddy/src/main/token-scan.js'
import { withDumpRisk } from './edge.js'
import { fetchAth, fetchPulse } from '../../desk-buddy/src/main/momentum.js'
import { MAX_WATCH, addTarget, checkWatched, parseMc, telegramRequest, watchToken } from './watch.js'
import { dailySummary, dueForCheck, memoryRow, narrativeHeat, remember, settleOutcomes, signalTags, similarOutcomes, trendRow, walletRecord } from './memory.js'
import { loadConfig, publicConfig, saveConfig, toggleFavorite } from './config.js'

// Las pestañas no pueden leer el storage directamente.
chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {})

// ---------------------------------------------------------------------------
// Escaneo con caché (varias pestañas del mismo token no repiten llamadas)
// ---------------------------------------------------------------------------

const scanCache = new Map() // input -> { at, promise }
const feedCache = { at: 0, promise: null }

// the project's website, read by buddy-server (no AI, cached 6 h on the server)
const siteCheck = async (url, token) => {
  const config = await loadConfig()
  if (!config.serverUrl) return null
  try {
    const response = await fetch(
      `${config.serverUrl.replace(/\/$/, '')}/v1/site?url=${encodeURIComponent(url)}${token ? `&token=${encodeURIComponent(token)}` : ''}`,
      { headers: { 'x-buddy-install': await installId() }, signal: AbortSignal.timeout(20000) }
    )
    return response.ok ? response.json() : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// The buddy's memory (chrome.storage.local, never leaves this PC)
// ---------------------------------------------------------------------------
const memoryStore = {
  get: async key => (await chrome.storage.local.get(key))[key],
  set: async (key, value) => chrome.storage.local.set({ [key]: value }),
}
// live numbers for up to 30 tokens per DexScreener call
const liveNumbers = async addresses => {
  const out = {}
  for (let i = 0; i < addresses.length; i += 30) {
    const batch = addresses.slice(i, i + 30)
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${batch.join(',')}`, { signal: AbortSignal.timeout(15000) })
      if (!response.ok) continue
      const { pairs = [] } = await response.json()
      for (const address of batch) {
        const mine = (pairs ?? []).filter(pair => pair.baseToken?.address === address)
        const best = mine.reduce((top, pair) => ((pair.liquidity?.usd ?? 0) > (top?.liquidity?.usd ?? -1) ? pair : top), null)
        out[address] = best ? { priceUsd: Number(best.priceUsd ?? 0), liquidityUsd: mine.reduce((sum, pair) => sum + (pair.liquidity?.usd ?? 0), 0) || null, marketCap: best.marketCap ?? best.fdv ?? null } : null
      }
    } catch {
      // try again on the next round
    }
  }
  return out
}
const checkOutcomes = async () => {
  const list = (await memoryStore.get('mem:snapshots')) ?? []
  const due = dueForCheck(list).map(item => item.address)
  if (!due.length) return 0
  return settleOutcomes(memoryStore, await liveNumbers(due))
}
// Learning in the background: a few fresh Solana launches every 15 min get a snapshot, so the
// memory has hundreds of outcomes in a couple of days instead of weeks. Light on the APIs.
const LEARN_PER_ROUND = 8
const learnRound = async () => {
  const config = await loadConfig()
  if (config.learn === false) return 0
  const known = new Set(((await memoryStore.get('mem:snapshots')) ?? []).map(item => item.address))
  const lists = await Promise.all(
    ['token-profiles/latest/v1', 'token-boosts/latest/v1'].map(path =>
      fetch(`https://api.dexscreener.com/${path}`, { signal: AbortSignal.timeout(15000) })
        .then(response => (response.ok ? response.json() : []))
        .catch(() => [])
    )
  )
  const fresh = [...new Set(lists.flat().filter(item => item?.chainId === 'solana').map(item => item.tokenAddress))].filter(address => address && !known.has(address))
  let learned = 0
  for (const address of fresh.slice(0, LEARN_PER_ROUND)) {
    try {
      const scan = await scanToken(address, { deep: false, vamps: false })
      if (await remember(memoryStore, scan)) learned += 1
    } catch {
      // skip this one
    }
  }
  return learned
}
// ---------------------------------------------------------------------------
// Watchlist: checked every minute from here, tab open or not. Alerts go to a Windows
// notification and, if you set it up in Options, to your own Telegram bot.
// ---------------------------------------------------------------------------
const notifyLog = [] // the last alerts sent (also what the e2e tests read)
const notify = async (title, message, url) => {
  const id = `buddy-${Date.now()}`
  notifyLog.unshift({ title, message, url, at: Date.now() })
  notifyLog.splice(20)
  chrome.notifications?.create(id, { type: 'basic', iconUrl: 'icons/128.png', title, message, priority: 2 })
  if (url) notifyLinks.set(id, url)
  const telegram = await memoryStore.get('telegram')
  if (telegram?.botToken && telegram?.chatId) {
    const request = telegramRequest(telegram, `${title}
${message}${url ? `
${url}` : ''}`)
    fetch(request.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request.body) }).catch(() => {})
  }
}
const notifyLinks = new Map()
chrome.notifications?.onClicked.addListener(id => {
  const url = notifyLinks.get(id)
  if (url) chrome.tabs.create({ url })
})
const checkWatchlist = async () => {
  const list = (await memoryStore.get('watchlist')) ?? []
  if (!list.length) return 0
  const live = await liveNumbers(list.map(item => item.address))
  let sent = 0
  const next = []
  for (const item of list) {
    if (!(item.address in live)) {
      next.push(item)
      continue
    }
    const { item: updated, alerts } = checkWatched(item, live[item.address])
    next.push(updated)
    for (const text of alerts) {
      await notify('Buddy · watchlist', text, `https://dexscreener.com/${item.chain ?? 'solana'}/${item.address}`)
      sent += 1
    }
  }
  await memoryStore.set('watchlist', next)
  return sent
}
chrome.alarms?.create('buddy-watch', { periodInMinutes: 1 })
// the day in one message, every night at 23:00 (your local time)
const nextNight = () => {
  const when = new Date()
  when.setHours(23, 0, 0, 0)
  if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1)
  return when.getTime()
}
chrome.alarms?.get('buddy-daily', existing => {
  if (!existing) chrome.alarms.create('buddy-daily', { when: nextNight(), periodInMinutes: 24 * 60 })
})
const sendDaily = async () => {
  const text = dailySummary((await memoryStore.get('mem:snapshots')) ?? [])
  if (text) await notify('Buddy · your day', text)
  return text
}
chrome.alarms?.create('buddy-outcomes', { periodInMinutes: 10 })
chrome.alarms?.create('buddy-learn', { periodInMinutes: 15, delayInMinutes: 1 })
chrome.alarms?.onAlarm.addListener(alarm => {
  if (alarm.name === 'buddy-outcomes') checkOutcomes()
  if (alarm.name === 'buddy-learn') learnRound()
  if (alarm.name === 'buddy-watch') checkWatchlist()
  if (alarm.name === 'buddy-daily') sendDaily()
})

// ATH per token: historical candles change slowly, and GeckoTerminal allows ~30 calls/min
const athCache = new Map() // address -> { at, promise }
const ATH_TTL = 10 * 60_000
const cachedAth = target => {
  const hit = athCache.get(target.address)
  if (hit && Date.now() - hit.at < ATH_TTL) return hit.promise
  const promise = fetchAth(target).catch(error => {
    athCache.delete(target.address)
    throw error
  })
  athCache.set(target.address, { at: Date.now(), promise })
  return promise
}
const SCAN_TTL = 60_000

// The live pulse is read every ~2 s per open token tab. DexScreener allows ~300 calls/min, so
// tabs on the same coin share one call (1.5 s cache), and if it ever rate-limits us we keep
// answering with the last good reading instead of going blind.
const pulseCache = new Map() // address -> { at, promise, last }
const PULSE_TTL = 1500
const cachedPulse = target => {
  const hit = pulseCache.get(target.address)
  if (hit && Date.now() - hit.at < PULSE_TTL) return hit.promise
  const promise = fetchPulse(target)
    .then(pulse => {
      pulseCache.set(target.address, { ...pulseCache.get(target.address), last: pulse })
      return pulse
    })
    .catch(error => {
      const last = pulseCache.get(target.address)?.last
      if (last) return last
      throw error
    })
  pulseCache.set(target.address, { at: Date.now(), promise, last: hit?.last })
  if (pulseCache.size > 50) pulseCache.delete(pulseCache.keys().next().value)
  return promise
}

const cachedScan = (input, { fresh = false } = {}) => {
  const hit = scanCache.get(input)
  if (!fresh && hit && Date.now() - hit.at < SCAN_TTL) return hit.promise
  const promise = scanToken(input, { deep: 'later' }).catch(error => {
    scanCache.delete(input)
    throw error
  })
  scanCache.set(input, { at: Date.now(), promise })
  return promise
}

// El lanzamiento de un token no cambia nunca: se guarda para siempre (máx. 300).
const LAUNCH_KEY = 'launchCache'
const launchMemory = new Map()
const launchCache = {
  async get(address) {
    if (launchMemory.has(address)) return launchMemory.get(address)
    const stored = (await chrome.storage.local.get(LAUNCH_KEY))[LAUNCH_KEY] ?? {}
    return stored[address] ?? null
  },
  async set(address, launch) {
    launchMemory.set(address, launch)
    const stored = (await chrome.storage.local.get(LAUNCH_KEY))[LAUNCH_KEY] ?? {}
    stored[address] = launch
    const keys = Object.keys(stored)
    for (const key of keys.slice(0, Math.max(0, keys.length - 300))) delete stored[key]
    await chrome.storage.local.set({ [LAUNCH_KEY]: stored })
  },
}
const launchJobs = new Map() // address -> promesa (dos pestañas no repiten el trabajo)

const BADGE = {
  alto: { text: '!', color: '#e5484d' },
  medio: { text: '?', color: '#f5a524' },
  bajo: { text: '✓', color: '#2fbf71' },
}

const setBadge = (tabId, verdict) => {
  const badge = BADGE[verdict]
  chrome.action.setBadgeText({ tabId, text: badge?.text ?? '' }).catch(() => {})
  if (badge) chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color }).catch(() => {})
}

/** Identificador anónimo de esta instalación (para el servidor). */
const installId = async () => {
  const config = await loadConfig()
  if (config.installId) return config.installId
  const id = crypto.randomUUID()
  await saveConfig({ installId: id })
  return id
}

// ---------------------------------------------------------------------------
// Mensajes de las pestañas
// ---------------------------------------------------------------------------

const broadcastConfig = async () => {
  const config = publicConfig(await loadConfig())
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'config', config }).catch(() => {})
}

const handlers = {
  async 'get-config'() {
    return publicConfig(await loadConfig())
  },
  async 'save-config'({ patch }) {
    const allowed = [
      'avatarId', 'size', 'favoriteBias', 'animationVolume', 'clickVolume', 'volume', 'muted', 'animationSounds',
      'idleSleepMinutes', 'autoScan', 'watch', 'autoOpenHighRisk', 'momentum', 'famous', 'learn', 'positions', 'hiddenSites', 'shortcuts',
    ]
    const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([key]) => allowed.includes(key)))
    await saveConfig(clean)
    await broadcastConfig()
    return publicConfig(await loadConfig())
  },
  async ath({ chain, address }) {
    try {
      return { ok: true, ath: await cachedAth({ chain, address }) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  },
  async pulse({ chain, address }) {
    try {
      return { ok: true, pulse: await cachedPulse({ chain, address }) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  },
  // remember a fully read token, and tell what the memory knows about it
  async memory({ scan, save }) {
    if (!scan?.address) return { ok: false }
    if (save) await remember(memoryStore, scan)
    const list = (await memoryStore.get('mem:snapshots')) ?? []
    const wallets = (await memoryStore.get('mem:wallets')) ?? {}
    const stats = similarOutcomes(list, signalTags(scan), { exclude: scan.address })
    const row = memoryRow({ stats, record: walletRecord(wallets, scan) })
    const trend = trendRow(scan, narrativeHeat(list))
    return { ok: true, row, trend, seen: list.length, settled: list.filter(item => item.outcome1h).length }
  },
  async watch({ token, on }) {
    let list = (await memoryStore.get('watchlist')) ?? []
    if (on) list = watchToken(list, token)
    else list = list.filter(item => item.address !== token.address)
    await memoryStore.set('watchlist', list)
    return { ok: true, watched: on, count: list.length, max: MAX_WATCH }
  },
  async 'watch-target'({ token, text }) {
    const mc = parseMc(text)
    if (!mc) return { ok: false, error: 'Type a market cap like 1M or 500k.' }
    let list = (await memoryStore.get('watchlist')) ?? []
    if (!list.some(item => item.address === token.address)) list = watchToken(list, token)
    list = addTarget(list, token.address, mc, token.marketCap)
    await memoryStore.set('watchlist', list)
    return { ok: true, mc, item: list.find(item => item.address === token.address) }
  },
  async 'watch-state'({ address }) {
    const item = ((await memoryStore.get('watchlist')) ?? []).find(entry => entry.address === address)
    return { ok: true, watched: Boolean(item), targets: (item?.targets ?? []).filter(target => !target.done) }
  },
  // your balance of a token (read-only, from the chain): only if you added your wallet in Options
  async holding({ mint }) {
    const { wallet } = await chrome.storage.local.get('wallet')
    if (!wallet || !mint) return { ok: false }
    const config = await loadConfig()
    try {
      const response = await fetch(config.rpcUrl || 'https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [wallet, { mint }, { encoding: 'jsonParsed' }] }),
        signal: AbortSignal.timeout(10000),
      })
      const body = await response.json()
      const accounts = body.result?.value ?? []
      const amount = accounts.reduce((sum, account) => sum + (account.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0)
      return { ok: true, amount }
    } catch {
      return { ok: false }
    }
  },
  async telegram({ botToken, chatId, test }) {
    if (botToken !== undefined) await memoryStore.set('telegram', botToken ? { botToken: String(botToken).trim(), chatId: String(chatId ?? '').trim() } : null)
    const saved = await memoryStore.get('telegram')
    if (test && saved?.botToken) {
      const request = telegramRequest(saved, 'Buddy is connected. Watchlist alerts will land here.')
      const response = await fetch(request.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request.body) }).catch(() => null)
      return { ok: Boolean(response?.ok), configured: true }
    }
    return { ok: true, configured: Boolean(saved?.botToken) }
  },
  async 'toggle-favorite'({ avatarId, key }) {
    const result = await toggleFavorite(avatarId, key)
    await broadcastConfig()
    return { ok: result.ok, config: publicConfig(result.config) }
  },
  async scan({ input, auto, fresh }, sender) {
    try {
      let scan = await cachedScan(input, { fresh })
      // si el lanzamiento ya se leyó antes, viene incluido desde el principio
      if (scan.launch?.status === 'pending') {
        const known = await launchCache.get(scan.address)
        if (known) scan = await withLaunch(scan, { known })
      }
      scan = withDumpRisk(scan, verdictFor)
      if (sender.tab?.id !== undefined && auto) setBadge(sender.tab.id, scan.verdict)
      return { ok: true, scan }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  },
  async launch({ scan }, sender) {
    if (scan?.launch?.status !== 'pending') return { scan }
    const config = await loadConfig()
    let job = launchJobs.get(scan.address)
    if (!job) {
      job = (async () => withLaunch(scan, { rpc: config.rpcUrl || undefined, known: await launchCache.get(scan.address) }))().finally(() =>
        launchJobs.delete(scan.address)
      )
      launchJobs.set(scan.address, job)
    }
    const full = withDumpRisk(await job, verdictFor)
    if (full.launch?.status === 'ok' || full.launch?.status === 'too-many') await launchCache.set(scan.address, full.launch)
    if (sender.tab?.id !== undefined) setBadge(sender.tab.id, full.verdict)
    return { scan: full }
  },
  // the buddy's brain (server, Claude Haiku): one line per token, cached for everyone, paid from its fuel
  async explain({ facts }) {
    const config = await loadConfig()
    if (!config.serverUrl || !facts?.address) return { ok: false }
    try {
      const response = await fetch(`${config.serverUrl.replace(/\/$/, '')}/v1/explain`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-buddy-install': await installId() },
        body: JSON.stringify(facts),
        signal: AbortSignal.timeout(25000),
      })
      if (!response.ok) return { ok: false }
      const body = await response.json()
      return { ok: true, line: body.line ?? null, hungry: Boolean(body.hungry) }
    } catch {
      return { ok: false }
    }
  },
  'site-check': ({ url, token }) => siteCheck(url, token),
  // narrative race: read each twin's page (model, launch post) to say what's different
  async twins({ targets }) {
    const list = (Array.isArray(targets) ? targets : []).slice(0, 5).filter(target => target?.url && target.address)
    const read = await Promise.all(list.map(target => siteCheck(target.url, target.address)))
    return list.map((target, index) => {
      // a launchpad answers an unknown CA with its home page: not this twin's page
      const site = read[index]?.mentionsToken === false ? null : read[index]
      return {
        address: target.address,
        marketCap: target.marketCap,
        url: target.url,
        model: site?.tech?.model ?? null,
        pitch: site?.pitch ?? null,
        description: site?.description ?? null,
        reachable: Boolean(site && !site.unreachable && !(site.status >= 400)),
      }
    })
  },
  // famous tweets: every open trading tab asks every few seconds; one server call per 2.5 s serves them all
  async feed({ since }) {
    const config = await loadConfig()
    if (!config.serverUrl) return { ok: false, error: 'No server.' }
    const now = Date.now()
    if (!feedCache.promise || now - feedCache.at > 2500) {
      feedCache.at = now
      feedCache.promise = fetch(`${config.serverUrl.replace(/\/$/, '')}/v1/feed?since=${now - 5 * 60_000}`, {
        headers: { 'x-buddy-install': await installId() },
        signal: AbortSignal.timeout(8000),
      })
        .then(response => (response.ok ? response.json() : { tweets: [], live: false }))
        .catch(() => ({ tweets: [], live: false }))
    }
    const body = await feedCache.promise
    return { ok: true, live: body.live, tweets: (body.tweets ?? []).filter(tweet => tweet.receivedAt > (Number(since) || 0)) }
  },
  async 'clear-badge'(_message, sender) {
    if (sender.tab?.id !== undefined) setBadge(sender.tab.id, null)
    return true
  },
  async 'open-options'({ hash }) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${hash ? `#${hash}` : ''}`) })
    return true
  },
  async 'open-shortcuts'() {
    await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
    return true
  },
  async shortcuts() {
    const commands = await chrome.commands.getAll()
    return Object.fromEntries(commands.map(command => [command.name, command.shortcut || '']))
  },
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type]
  if (!handler) return false
  handler(message, sender)
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, error: error.message }))
  return true // respuesta asíncrona
})

// ---------------------------------------------------------------------------
// Ícono y atajos
// ---------------------------------------------------------------------------

// Pages Chrome never lets extensions touch (chrome://, the Web Store, other extensions, PDFs…).
const RESTRICTED = /^(chrome|edge|brave|about|view-source|devtools|chrome-extension|chrome-search):|^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i

const sendToTab = async (tab, message) => {
  // tab.url can be missing on sites we have no host access to: still try (activeTab allows it)
  if (!tab?.id || (tab.url && RESTRICTED.test(tab.url))) return
  try {
    await chrome.tabs.sendMessage(tab.id, message)
  } catch {
    // La página no tiene al buddy (no es un sitio de trading): se inyecta.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
      await new Promise(resolve => setTimeout(resolve, 150))
      await chrome.tabs.sendMessage(tab.id, message)
    } catch {
      // a page that can't host the buddy (file://, PDF viewer…): nothing to do
    }
  }
}

chrome.action.onClicked.addListener(tab => sendToTab(tab, { type: 'toggle' }))

chrome.commands.onCommand.addListener(async (command, tab) => {
  const target = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  if (!target) return
  if (command === 'toggle-buddy') sendToTab(target, { type: 'toggle' })
  if (command === 'show-report') sendToTab(target, { type: 'command', command: 'report' })
})

// Para las pruebas e2e.
globalThis.__buddy = { handlers, loadConfig, saveConfig, launchCache, checkOutcomes, learnRound, checkWatchlist, sendDaily, notifyLog, memoryStore }
