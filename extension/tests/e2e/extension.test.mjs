// Pruebas de punta a punta: Chromium real con la extensión cargada (modo informativo).
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { buddyOn, launch, startSite } from './helpers.mjs'

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const NETWORK = process.env.BUDDY_SKIP_NETWORK !== '1'
// the backend (buddy-server) is not part of this repo: its tests run only when it sits next to it
const SERVER = existsSync(new URL('../../../buddy-server/src/dev-server.mjs', import.meta.url))
let session
let site

before(async () => {
  site = await startSite()
  session = await launch()
})
after(async () => {
  await session?.close()
  site?.server.close()
})

const openPage = async pathname => {
  const page = await session.context.newPage()
  await page.goto(`${site.url}${pathname}`)
  return { page, buddy: await buddyOn(page) }
}

const dataIs = (page, key, value, timeout = 45000) =>
  page.waitForFunction(([k, v]) => document.querySelector('desk-buddy-root').dataset[k] === v, [key, value], { timeout })

test('aparece en una página de trading sin romperla', async () => {
  const { page, buddy } = await openPage('/site/pump.fun/board')
  assert.equal(await buddy.data('visible'), 'true')
  assert.ok(['kirby', 'miso'].includes(await buddy.data('avatar')))
  await page.click('#trade')
  assert.equal(await page.evaluate(() => window.bought), 1)
  // sin chat: las burbujas son Informe, Avatar, Favoritas y Ajustes
  await buddy.settle()
  await buddy.click(1)
  await dataIs(page, 'menu', 'true')
  const actions = await buddy.$('#orbit .orb').evaluateAll(orbs => orbs.map(orb => orb.dataset.action))
  assert.deepEqual(actions, ['report', 'avatar', 'favorites', 'settings', 'toys'])
  assert.equal(await buddy.$('#chat').count(), 0)
  // en una página sin token, el informe lo dice
  await buddy.$('.orb[data-action="report"]').click()
  await buddy.$('#panel-report .rep-empty').waitFor()
  assert.match(await buddy.$('#panel-report').innerText(), /No token on this page/)
  await page.close()
})

test('al entrar a un token arma el informe solo: semáforo, lo importante y datos', { skip: !NETWORK }, async () => {
  const { page, buddy } = await openPage(`/site/pump.fun/coin/${BONK}`)
  await page.waitForFunction(() => document.querySelector('desk-buddy-root').dataset.verdict !== '', null, { timeout: 45000 })
  assert.equal(await buddy.data('token'), BONK)
  const chip = buddy.$('#verdict-chip')
  await chip.waitFor()
  // one line at a time: the ticker + verdict comes around in the rotation
  await page.waitForFunction(() => /bonk/i.test(document.querySelector('desk-buddy-root').shadowRoot.querySelector('#verdict-chip').innerText), null, { timeout: 15000 })
  assert.equal(await chip.locator('.chip-line').count(), 1)
  const badge = await session.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: '*://127.0.0.1/*/pump.fun/*' })
    return chrome.action.getBadgeText({ tabId: tab.id })
  })
  assert.match(badge, /^[!?✓]$/)
  await chip.click()
  const report = buddy.$('#panel-report')
  await report.locator('.rep-verdict').waitFor()
  // quick card first: only what terminals don't show (no stats grid, no age noise)
  await report.locator('.edge-row').first().waitFor()
  let text = await report.innerText()
  assert.match(text, /\$Bonk/i)
  assert.match(text, /Vamp/)
  assert.match(text, /OG ✓|older lookalike|Unique ticker|No vamps/)
  assert.match(text, /Linked wallets/)
  assert.doesNotMatch(text, /Holders|Vol 24h|old: peak rug/)
  assert.ok((await report.locator('.edge-row').count()) >= 2) // only what we know for sure
  assert.equal(await report.locator('.rep-more').evaluate(el => el.open), false)
  // tapping a row opens the full report at that section
  await report.locator('.edge-row[data-target="vamp"]').click()
  assert.equal(await report.locator('.rep-more').evaluate(el => el.open), true)
  text = await report.innerText()
  assert.match(text, /Vamp check/)
  // BONK is years old: the launch block doesn't apply anymore
  assert.match(text, /Older than 3 days/)
  assert.match(text, /Website & socials/)
  assert.match(text, /Connected wallets/)
  assert.ok((await report.locator('.bubbles circle').count()) >= 5)
  assert.equal(await report.locator('.link-chip', { hasText: 'Bubblemaps' }).count(), 1)
  assert.ok((await report.locator('.flags li').count()) >= 5)
  await page.close()
})

test('pegar otra dirección en el informe la revisa (sin chat)', { skip: !NETWORK }, async () => {
  const { page, buddy } = await openPage('/site/dexscreener.com/')
  await buddy.settle()
  await buddy.click(1)
  await buddy.$('.orb[data-action="report"]').click()
  await page.evaluate(() => {
    window.keys = []
  })
  await buddy.$('#panel-report .rep-input').fill(BONK)
  await buddy.$('#panel-report .rep-input').press('Enter')
  await buddy.$('#panel-report .rep-verdict').waitFor({ timeout: 45000 })
  assert.match(await buddy.$('#panel-report .rep-title').innerText(), /bonk/i)
  // lo que se escribe en el buddy no le llega a la página (atajos de trading)
  assert.deepEqual(await page.evaluate(() => window.keys), [])
  await page.close()
})

test('revisa la web del proyecto con el servidor de Buddy', { skip: !SERVER }, async () => {
  const { startDevServer } = await import('../../../buddy-server/src/dev-server.mjs')
  const server = await startDevServer(0)
  server.env.ALLOW_PRIVATE_URLS = '1'
  await session.worker.evaluate(async url => {
    const { config } = await chrome.storage.local.get('config')
    await chrome.storage.local.set({ config: { ...config, serverUrlOverride: url } })
  }, server.url)
  try {
    const result = await session.worker.evaluate(
      ([url, token]) => globalThis.__buddy.handlers['site-check']({ url, token }),
      [`${site.url}/site/landing.fun/`, BONK]
    )
    assert.equal(result.ok, true)
    assert.equal(result.status, 200)
    assert.equal(result.mentionsToken, false)
    assert.equal(result.title, '/site/landing.fun/')
  } finally {
    await session.worker.evaluate(async () => {
      const { config } = await chrome.storage.local.get('config')
      delete config.serverUrlOverride
      await chrome.storage.local.set({ config })
    })
    server.server.close()
  }
})

test('1 clic abre las burbujas; clics seguidos hacen animaciones', async () => {
  const { page, buddy } = await openPage('/site/gmgn.ai/')
  await buddy.settle()
  await buddy.click(1)
  await dataIs(page, 'menu', 'true')
  await buddy.click(1)
  await dataIs(page, 'menu', 'false')
  await page.waitForTimeout(500)
  const seen = new Set()
  await buddy.click(1)
  for (let index = 0; index < 5; index += 1) {
    await page.waitForTimeout(120)
    await buddy.click(1)
    await page.waitForTimeout(60)
    seen.add(await buddy.data('animation'))
  }
  assert.ok(seen.size >= 3, [...seen].join(','))
  assert.equal(await buddy.data('menu'), 'false')
  await page.close()
})

test('favoritas (máx. 3) y cambio de avatar se guardan para todas las pestañas', async () => {
  const { page, buddy } = await openPage('/site/birdeye.so/')
  await buddy.settle()
  await buddy.click(1)
  await buddy.$('.orb[data-action="favorites"]').click()
  for (const key of ['happy', 'dance', 'love', 'wink']) {
    await buddy.$(`#panel-favorites .fav-chip[data-key="${key}"]`).click()
    await page.waitForTimeout(150)
  }
  await page.waitForFunction(() => document.querySelector('desk-buddy-root').dataset.favorites.split(',').length === 3)
  assert.match(await buddy.$('#toast').innerText(), /Max 3/)
  await buddy.$('.orb[data-action="avatar"]').click()
  await buddy.$('#panel-avatar .avatar-tile[data-id="tako"]').click()
  await dataIs(page, 'avatar', 'tako')
  const other = await openPage('/site/pump.fun/board')
  assert.equal(await other.buddy.data('avatar'), 'tako')
  await other.page.close()
  await page.close()
})

test('el ícono de la extensión lo esconde y lo vuelve a mostrar en ese sitio', async () => {
  const { page, buddy } = await openPage('/site/solscan.io/')
  const toggle = () =>
    session.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: '*://127.0.0.1/*/solscan.io/*' })
      await chrome.tabs.sendMessage(tab.id, { type: 'toggle' })
    })
  await toggle()
  await dataIs(page, 'visible', 'false')
  await toggle()
  await dataIs(page, 'visible', 'true')
  assert.equal(await buddy.data('visible'), 'true')
  await page.close()
})

test('opciones: vigilancia y RPC de Solana (solo Helius o la pública)', async () => {
  const page = await session.context.newPage()
  await page.goto(`chrome-extension://${session.extensionId}/options.html`)
  await page.waitForFunction(() => window.__optionsReady)
  await page.fill('#rpc-url', 'https://evil.example/rpc')
  await page.click('#rpc-form button[type="submit"]')
  await page.waitForFunction(() => /Helius/.test(document.querySelector('#rpc-status').textContent))
  await page.fill('#rpc-url', 'https://mainnet.helius-rpc.com/?api-key=demo')
  await page.click('#rpc-form button[type="submit"]')
  await page.waitForFunction(() => /helius-rpc\.com/.test(document.querySelector('#rpc-status').textContent))
  await page.uncheck('#watch')
  await page.waitForTimeout(200)
  const stored = await session.worker.evaluate(async () => (await chrome.storage.local.get('config')).config)
  assert.equal(stored.rpcUrl, 'https://mainnet.helius-rpc.com/?api-key=demo')
  assert.equal(stored.watch, false)
  // la RPC no se expone a las páginas
  const pub = await session.worker.evaluate(() => globalThis.__buddy.handlers['get-config']())
  assert.equal(pub.rpcUrl, undefined)
  await page.click('#rpc-clear')
  await page.check('#watch')
  await page.close()
})

test('own shortcuts: recorded in Settings, saved for good, work on the page', async () => {
  const { page, buddy } = await openPage('/site/gmgn.ai/')
  await buddy.settle()
  await buddy.click(1)
  await dataIs(page, 'menu', 'true')
  await buddy.$('.orb[data-action="settings"]').click()
  await dataIs(page, 'panel', 'settings')
  const key = buddy.$('.keycaps[data-shortcut="toggle"]')
  await key.waitFor()
  assert.match(await key.innerText(), /Set shortcut/)
  await key.click()
  assert.match(await key.innerText(), /Press the keys/)
  await page.keyboard.press('Control+Alt+KeyK')
  await page.waitForFunction(() => document.querySelector('desk-buddy-root').shadowRoot.querySelector('.keycaps[data-shortcut="toggle"]').innerText.includes('K'))
  const stored = await session.worker.evaluate(async () => (await chrome.storage.local.get('config')).config.shortcuts)
  assert.equal(stored.toggle, 'CommandOrControl+Alt+K')
  // a second action can't take the same combo
  await buddy.$('.keycaps[data-shortcut="report"]').click()
  await page.keyboard.press('Control+Alt+KeyK')
  await page.waitForFunction(() => /already uses/.test(document.querySelector('desk-buddy-root').shadowRoot.querySelector('#toast').textContent))
  await page.close()

  // a fresh page (and any other trading site) remembers it
  const other = await openPage('/site/axiom.trade/')
  await other.buddy.settle()
  await other.page.mouse.click(20, 20) // focus the page itself
  await other.page.keyboard.press('Control+Alt+KeyK')
  await dataIs(other.page, 'visible', 'false')
  await other.page.keyboard.press('Control+Alt+KeyK')
  await dataIs(other.page, 'visible', 'true')
  await other.page.close()
})

test('momentum: new ATH and volume spike show up as alerts and in the report', { skip: !NETWORK }, async () => {
  // fake live numbers: price above the ATH, volume 5x the hourly pace
  await session.worker.evaluate(() => {
    const { handlers } = globalThis.__buddy
    globalThis.__realMomentum ??= { ath: handlers.ath, pulse: handlers.pulse }
    handlers.ath = async () => ({ ok: true, ath: { price: 1, at: 0, pools: 2 } })
    handlers.pulse = async () => ({ ok: true, pulse: { at: Date.now(), priceUsd: 1.2, marketCap: 1.2e6, volume: { m5: 10000, h1: 24000, h6: 50000 } } })
  })
  try {
    const { page, buddy } = await openPage(`/site/pump.fun/coin/${BONK}`)
    await page.waitForFunction(
      () => /NEW ATH!/.test(document.querySelector('desk-buddy-root').shadowRoot.querySelector('#verdict-chip').textContent),
      null,
      { timeout: 45000 }
    )
    await page.keyboard.press('Alt+Shift+R').catch(() => {})
    await session.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: '*://127.0.0.1/*/pump.fun/*' })
      await chrome.tabs.sendMessage(tab.id, { type: 'command', command: 'report' })
    })
    // the quick card says it in one line; tapping it opens the Momentum section
    const athRow = buddy.$('#panel-report .edge-row[data-target="momentum"]')
    await athRow.waitFor()
    assert.match(await athRow.innerText(), /NEW ATH · \$1\.2M MC/)
    await athRow.click()
    await page.waitForFunction(() => /Momentum/.test(document.querySelector('desk-buddy-root').shadowRoot.querySelector('#panel-report').innerText))
    const text = await buddy.$('#panel-report').innerText()
    assert.match(text, /AT ATH/)
    assert.match(text, /NEW ATH! \$Bonk at \$1\.20M MC/i)
    assert.match(text, /Volume 5\.0x: \$10\.0k in 5 min/)
    assert.doesNotMatch(text, /traded in the last hour/)
    await page.close()
  } finally {
    await session.worker.evaluate(() => Object.assign(globalThis.__buddy.handlers, globalThis.__realMomentum))
  }
})

test('famous tweet: a yellow bubble above the avatar, the moment it arrives', { skip: !SERVER }, async () => {
  const { startDevServer } = await import('../../../buddy-server/src/dev-server.mjs')
  const server = await startDevServer(0)
  await session.worker.evaluate(async url => {
    const { config } = await chrome.storage.local.get('config')
    await chrome.storage.local.set({ config: { ...config, serverUrlOverride: url, famous: true } })
  }, server.url)
  try {
    const { page, buddy } = await openPage('/site/pump.fun/board') // no token on this page: the bubble still shows
    await buddy.settle()
    const push = tweet =>
      fetch(`${server.url}/v1/admin/feed`, { method: 'POST', headers: { authorization: 'Bearer dev', 'content-type': 'application/json' }, body: JSON.stringify(tweet) })
    await push({ id: String(Date.now()), text: 'The future currency of Earth $DOGE', createdAt: new Date().toUTCString(), author: { userName: 'elonmusk', name: 'Elon Musk' } })
    await page.waitForFunction(
      () => {
        const toast = document.querySelector('desk-buddy-root').shadowRoot.querySelector('#toast')
        return toast && !toast.hidden && /Elon Musk: "The future currency of Earth \$DOGE" · \$DOGE/.test(toast.textContent) && toast.classList.contains('famous')
      },
      null,
      { timeout: 15000 }
    )
    // it sits right above the avatar, with a yellow background
    const box = await page.evaluate(() => {
      const root = document.querySelector('desk-buddy-root').shadowRoot
      const toast = root.querySelector('#toast').getBoundingClientRect()
      const avatar = root.querySelector('#squish').getBoundingClientRect()
      return { gap: avatar.top - toast.bottom, bg: getComputedStyle(root.querySelector('#toast')).backgroundColor }
    })
    assert.ok(box.gap > -20 && box.gap < 40, `gap ${box.gap}`) // the avatar box has some transparent padding on top
    await page.waitForTimeout(900)
    assert.equal(box.bg, 'rgb(255, 216, 77)')
    await page.close()
  } finally {
    server.server.close()
  }
})

test('toys: pick a hammer, hit the buddy, knock it out, put it away', async () => {
  const { page, buddy } = await openPage('/site/gmgn.ai/')
  await buddy.settle()
  await buddy.click(1)
  await dataIs(page, 'menu', 'true')
  await buddy.$('.orb[data-action="toys"]').click()
  const bar = buddy.$('.toy-bar')
  await bar.waitFor()
  await buddy.$('.toy-pick[data-toy="hammer"]').click()
  assert.equal(await buddy.$('.toy-pick.on').getAttribute('data-toy'), 'hammer')
  const box = await buddy.$('#squish').boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const swing = async () => {
    // a fast swing into the buddy, then the hit
    await page.mouse.move(cx - 260, cy - 120)
    await page.mouse.move(cx, cy, { steps: 2 })
    await page.mouse.down()
    await page.mouse.up()
  }
  await swing()
  // a comic word flies off and the buddy gets knocked
  await page.waitForFunction(() => document.querySelector('desk-buddy-root').shadowRoot.querySelector('.toy-word'))
  const hpAfterOne = await page.evaluate(() => parseFloat(document.querySelector('desk-buddy-root').shadowRoot.querySelector('.toy-hp i').style.width))
  assert.ok(hpAfterOne < 100, `hp ${hpAfterOne}`)
  assert.equal(await buddy.data('menu'), 'false') // a hit is not a click: the menu stays closed
  // keep hitting until it's knocked out
  for (let i = 0; i < 12; i += 1) {
    const ko = await page.evaluate(() => document.querySelector('desk-buddy-root').shadowRoot.querySelector('#buddy').classList.contains('toy-ko'))
    if (ko) break
    await swing()
    await page.waitForTimeout(120)
  }
  await page.waitForFunction(() => document.querySelector('desk-buddy-root').shadowRoot.querySelector('#buddy').classList.contains('toy-ko'))
  // Esc puts the toy away
  await page.keyboard.press('Escape')
  await bar.waitFor({ state: 'hidden' })
  await page.close()
})

test('buddy memory: snapshots, outcomes checked in the background, devs remembered', { skip: !NETWORK }, async () => {
  const result = await session.worker.evaluate(async bonk => {
    const { handlers, checkOutcomes, memoryStore } = globalThis.__buddy
    await memoryStore.set('mem:snapshots', [])
    await memoryStore.set('mem:wallets', { 'dev-known-rugger': { dev: 2, bundle: 0, tokens: ['x', 'y'], lastSymbol: 'RUGME' } })
    // a token we saw 2h ago (BONK, real), priced at half of today: it should settle as "moon"
    const live = (await (await fetch(`https://api.dexscreener.com/latest/dex/tokens/${bonk}`)).json()).pairs[0]
    await memoryStore.set('mem:snapshots', [{ address: bonk, chain: 'solana', symbol: 'Bonk', at: Date.now() - 2 * 3.6e6, priceUsd: Number(live.priceUsd) / 3, liquidityUsd: 1000, tags: ['clean'], bundle: [], outcome1h: null, outcome24h: null }])
    const settled = await checkOutcomes()
    const after = (await memoryStore.get('mem:snapshots'))[0]
    // a new token from the known rugger
    const memory = await handlers.memory({ scan: { address: 'NEW', chain: 'solana', symbol: 'NEW', flags: [], market: { priceUsd: 1, liquidityUsd: 5000 }, dev: { creator: 'dev-known-rugger' }, socials: { websites: [], twitter: [] } }, save: true })
    const saved = (await memoryStore.get('mem:snapshots')).some(item => item.address === 'NEW')
    return { settled, outcome: after.outcome1h, row: memory.row, saved }
  }, BONK)
  assert.equal(result.settled, 1)
  assert.equal(result.outcome, 'moon')
  assert.equal(result.row.value, 'This dev was behind 2 rugs you saw ($RUGME)')
  assert.equal(result.saved, true)
})

test('buddy memory: learns from fresh launches in the background', { skip: !NETWORK }, async () => {
  const learned = await session.worker.evaluate(async () => {
    const { learnRound, memoryStore } = globalThis.__buddy
    await memoryStore.set('mem:snapshots', [])
    const count = await learnRound()
    const list = await memoryStore.get('mem:snapshots')
    return { count, tags: list[0]?.tags ?? null, priced: list.every(item => item.priceUsd > 0 || item.priceUsd === null) }
  })
  assert.ok(learned.count >= 1, `learned ${learned.count}`)
  assert.ok(Array.isArray(learned.tags) && learned.tags.length >= 1)
})

test('watchlist: your MC alert fires from the background as a notification', { skip: !NETWORK }, async () => {
  const result = await session.worker.evaluate(async bonk => {
    const { handlers, checkWatchlist, memoryStore } = globalThis.__buddy
    await memoryStore.set('watchlist', [])
    const token = { address: bonk, chain: 'solana', symbol: 'Bonk' } // no MC known: a target counts as "up"
    await handlers.watch({ token, on: true })
    const target = await handlers['watch-target']({ token, text: '1k' }) // BONK is way above $1k
    const bad = await handlers['watch-target']({ token, text: 'soon' })
    const state = await handlers['watch-state']({ address: bonk })
    const sent = await checkWatchlist()
    const notes = globalThis.__buddy.notifyLog.filter(note => /hit your \$1\.0k MC alert/.test(note.message))
    const after = await handlers['watch-state']({ address: bonk })
    return { target: target.mc, bad: bad.error, watched: state.watched, sent, notes: notes.length, pending: after.targets.length }
  }, BONK)
  assert.equal(result.target, 1000)
  assert.equal(result.bad, 'Type a market cap like 1M or 500k.')
  assert.equal(result.watched, true)
  assert.ok(result.sent >= 1)
  assert.ok(result.notes >= 1)
  assert.equal(result.pending, 0) // fired once, done
})

test('your wallet (read-only): options validate it, the background reads your balance', { skip: !NETWORK }, async () => {
  const page = await session.context.newPage()
  await page.goto(`chrome-extension://${session.extensionId}/options.html`)
  await page.waitForFunction(() => window.__optionsReady)
  await page.fill('#wallet', 'not-a-wallet')
  await page.click('#wallet-form button[type="submit"]')
  await page.waitForFunction(() => /doesn't look like a Solana address/.test(document.querySelector('#wallet-status').textContent))
  // a real BONK holder (from RugCheck's top holders)
  const report = await (await fetch(`https://api.rugcheck.xyz/v1/tokens/${BONK}/report`)).json()
  const holder = report.topHolders.find(item => item.owner && !report.knownAccounts?.[item.owner])?.owner
  await page.fill('#wallet', holder)
  await page.click('#wallet-form button[type="submit"]')
  await page.waitForFunction(() => /Reading balances of/.test(document.querySelector('#wallet-status').textContent))
  const result = await session.worker.evaluate(mint => globalThis.__buddy.handlers.holding({ mint }), BONK)
  assert.equal(result.ok, true)
  assert.ok(result.amount > 0, `amount ${result.amount}`)
  await page.click('#wallet-clear')
  await page.close()
})

test('the AI read only runs when you tap "Ask AI" (free sources first, to save fuel)', { skip: !NETWORK }, async () => {
  await session.worker.evaluate(() => {
    globalThis.__aiCalls = 0
    const { handlers } = globalThis.__buddy
    globalThis.__realExplain ??= handlers.explain
    handlers.explain = async () => {
      globalThis.__aiCalls += 1
      return { ok: true, line: 'The original Solana dog coin; deep liquidity, no dev bundle to worry about.', hungry: false }
    }
  })
  try {
    const { page, buddy } = await openPage(`/site/pump.fun/coin/${BONK}`)
    await page.waitForFunction(() => document.querySelector('desk-buddy-root').dataset.verdict !== '', null, { timeout: 45000 })
    await session.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: '*://127.0.0.1/*/pump.fun/*' })
      await chrome.tabs.sendMessage(tab.id, { type: 'command', command: 'report' })
    })
    const ask = buddy.$('#panel-report .ask-ai-btn')
    await ask.waitFor()
    await page.waitForTimeout(3000) // the launch read and the site check finish: still no AI call
    assert.equal(await session.worker.evaluate(() => globalThis.__aiCalls), 0)
    await ask.click()
    await page.waitForFunction(() => /original Solana dog coin/.test(document.querySelector('desk-buddy-root').shadowRoot.querySelector('#panel-report').innerText))
    assert.equal(await session.worker.evaluate(() => globalThis.__aiCalls), 1)
    assert.equal(await buddy.$('#panel-report .brain-tag').count(), 1)
    await page.close()
  } finally {
    await session.worker.evaluate(() => {
      globalThis.__buddy.handlers.explain = globalThis.__realExplain
    })
  }
})
