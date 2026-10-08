// Watchlist logic: MC targets, liquidity pulled, big moves, Telegram request shape.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addTarget, checkWatched, parseMc, telegramRequest, watchToken } from '../../src/watch.js'

test('parse MC targets the way traders type them', () => {
  assert.equal(parseMc('1m'), 1e6)
  assert.equal(parseMc('500K'), 500e3)
  assert.equal(parseMc('$1.5M'), 1.5e6)
  assert.equal(parseMc('250,000'), 250000)
  assert.equal(parseMc('soon'), null)
})

test('MC targets fire once, in the right direction', () => {
  let list = watchToken([], { address: 'A', chain: 'solana', symbol: 'PEPE', marketCap: 300e3, liquidityUsd: 40e3 }, 0)
  list = addTarget(list, 'A', 1e6, 300e3) // above: "up"
  list = addTarget(list, 'A', 100e3, 300e3) // below: "down"
  let { item, alerts } = checkWatched(list[0], { marketCap: 1.1e6, liquidityUsd: 60e3 }, 60e3)
  assert.deepEqual(alerts, ['$PEPE hit your $1.00M MC alert (now $1.10M)', '$PEPE pumping: +267% in a minute ($1.10M MC)'])
  ;({ alerts } = checkWatched(item, { marketCap: 1.2e6, liquidityUsd: 60e3 }, 120e3))
  assert.deepEqual(alerts, []) // already fired, small move
})

test('liquidity pulled, dumps, and a token that vanished', () => {
  const item = watchToken([], { address: 'A', symbol: 'X', marketCap: 500e3, liquidityUsd: 50e3 }, 0)[0]
  assert.deepEqual(checkWatched(item, { marketCap: 300e3, liquidityUsd: 5e3 }).alerts, ['$X: liquidity dropped 90% (now $5.0k)', '$X dumping: -40% in a minute ($300.0k MC)'])
  assert.deepEqual(checkWatched(item, null).alerts, ['$X: no pool left on DexScreener (rugged?)'])
})

test('Telegram request: your bot, your chat', () => {
  const request = telegramRequest({ botToken: '123:abc', chatId: '8750342969' }, 'hi')
  assert.equal(request.url, 'https://api.telegram.org/bot123:abc/sendMessage')
  assert.deepEqual(request.body, { chat_id: '8750342969', text: 'hi', disable_web_page_preview: true })
})
