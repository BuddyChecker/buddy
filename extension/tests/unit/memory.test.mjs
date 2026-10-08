// The buddy's memory: snapshots → outcomes → "tokens like this ended…" and wallet records.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dueForCheck, memoryRow, outcomeOf, remember, settleOutcomes, signalTags, similarOutcomes, walletRecord } from '../../src/memory.js'

const HOUR = 3.6e6
const mapStore = () => {
  const data = new Map()
  return { get: async key => data.get(key), set: async (key, value) => void data.set(key, value), data }
}
const bundledScan = (address, extra = {}) => ({
  address,
  chain: 'solana',
  symbol: address.toUpperCase(),
  flags: [],
  socials: { websites: [], twitter: ['https://x.com/a'] },
  market: { priceUsd: 1, liquidityUsd: 20000, marketCap: 100000 },
  dev: { creator: `dev-${address}`, activity: { fresh: true } },
  launch: { status: 'ok', creator: `dev-${address}`, sameBlockWallets: 5, sameBlockOwners: [`b1-${address}`, 'SHARED'] },
  holderMap: { holders: [{ address: 'POOL', pct: 20, pool: true }, { address: `b1-${address}`, pct: 18 }], networks: [] },
  ...extra,
})

test('signal tags: the telling ones first', () => {
  assert.deepEqual(signalTags(bundledScan('a')), ['dump-high', 'dev-fresh', 'bundled'])
  assert.deepEqual(signalTags({ flags: [], socials: { websites: ['https://x.io'] }, holderMap: { holders: [{ address: 'P', pct: 70, pool: true }], networks: [] } }), ['clean'])
})

test('outcomes: rug, dump, moon, flat', () => {
  const then = { priceUsd: 1, liquidityUsd: 20000 }
  assert.equal(outcomeOf(then, { priceUsd: 0.5, liquidityUsd: 2000 }), 'rug') // LP pulled
  assert.equal(outcomeOf(then, { priceUsd: 0.05, liquidityUsd: 15000 }), 'rug')
  assert.equal(outcomeOf(then, { priceUsd: 0.3, liquidityUsd: 9000 }), 'dump')
  assert.equal(outcomeOf(then, { priceUsd: 2.4, liquidityUsd: 50000 }), 'moon')
  assert.equal(outcomeOf(then, { priceUsd: 1.1, liquidityUsd: 21000 }), 'flat')
  assert.equal(outcomeOf(then, null), 'rug') // no pool left at all
})

test('remember once per token; check 1h and 24h later; learn who rugged', async () => {
  const store = mapStore()
  const t0 = 1_000_000
  await remember(store, bundledScan('a'), t0)
  assert.equal(await remember(store, bundledScan('a'), t0 + 10), null) // same token: kept once
  await remember(store, bundledScan('b'), t0)
  assert.equal(dueForCheck(await store.get('mem:snapshots'), t0 + HOUR / 2).length, 0)
  assert.equal(dueForCheck(await store.get('mem:snapshots'), t0 + HOUR).length, 2)
  // an hour later: "a" rugged, "b" did 3x
  await settleOutcomes(store, { a: { priceUsd: 0.02, liquidityUsd: 100 }, b: { priceUsd: 3, liquidityUsd: 60000 } }, t0 + HOUR)
  const list = await store.get('mem:snapshots')
  assert.equal(list.find(item => item.address === 'a').outcome1h, 'rug')
  assert.equal(list.find(item => item.address === 'b').outcome1h, 'moon')
  const wallets = await store.get('mem:wallets')
  assert.equal(wallets['dev-a'].dev, 1)
  assert.equal(wallets.SHARED.bundle, 1) // a bundle wallet from the rug
  assert.equal(wallets['dev-b'], undefined)
})

test('a new token by a known rugger, or with bundle wallets from past rugs', () => {
  const wallets = { 'dev-x': { dev: 2, bundle: 0, tokens: ['t1', 't2'], lastSymbol: 'RUGME' }, SHARED: { dev: 0, bundle: 3, tokens: ['t1', 't2', 't3'] } }
  const byDev = walletRecord(wallets, { dev: { creator: 'dev-x' }, launch: { status: 'ok', sameBlockOwners: [] } })
  assert.equal(memoryRow({ record: byDev }).value, 'This dev was behind 2 rugs you saw ($RUGME)')
  const byBundle = walletRecord(wallets, { dev: { creator: 'new' }, launch: { status: 'ok', sameBlockOwners: ['SHARED', 'fresh'] } })
  const row = memoryRow({ record: byBundle })
  assert.equal(row.value, '1 bundle wallet was in rugs you saw')
  assert.equal(row.level, 'red')
})

test('"tokens like this": needs 5+ settled, says how they ended', () => {
  const past = (outcome, tags) => ({ address: Math.random().toString(36), tags, outcome1h: outcome })
  const list = [
    ...Array.from({ length: 7 }, () => past('rug', ['dump-high', 'dev-fresh', 'bundled'])),
    ...Array.from({ length: 3 }, () => past('moon', ['dump-high', 'dev-fresh'])),
    past('rug', ['clean']),
  ]
  const stats = similarOutcomes(list, ['dump-high', 'dev-fresh', 'bundled'])
  assert.equal(stats.n, 10)
  assert.equal(stats.rug, 7)
  assert.equal(memoryRow({ stats }).value, '70% of 10 like this (big dump risk + fresh dev wallet) rugged or dumped')
  assert.equal(memoryRow({ stats: similarOutcomes(list.slice(0, 3), ['dump-high', 'dev-fresh']) }), null) // too few to say
})

test('hot narrative: the same word across several fresh launches', async () => {
  const { narrativeHeat, trendRow, themeWords } = await import('../../src/memory.js')
  assert.deepEqual(themeWords({ name: 'Cat on Solana', symbol: 'CATSOL' }), ['cat', 'catsol'])
  const now = 10 * HOUR
  const list = [
    ...['Cat King', 'Space Cat', 'Cat Wif Hat', 'Lazy Cat'].map((name, i) => ({ at: now - i * 10 * 60e3, words: themeWords({ name, symbol: 'X' }) })),
    { at: now - 5 * HOUR, words: ['cat'] }, // too old
  ]
  const row = trendRow({ name: 'Cat Army', symbol: 'CARMY' }, narrativeHeat(list, now))
  assert.equal(row.value, 'Hot: "cat" (3 other launches in 2h)') // 4 cats in 2h, minus the scanned one... counted as "others" = 4 - 1
  assert.equal(trendRow({ name: 'Dog Army', symbol: 'DOGA' }, narrativeHeat(list, now)), null)
})

test('daily summary: what happened today and whether the red flags were right', async () => {
  const { dailySummary } = await import('../../src/memory.js')
  const now = 30 * HOUR
  const item = (tags, outcome, hoursAgo = 3) => ({ at: now - hoursAgo * HOUR, tags, outcome1h: outcome })
  const list = [item(['dump-high'], 'rug'), item(['bundled'], 'dump'), item(['bundled'], 'moon'), item(['clean'], 'flat'), item(['clean'], null), item(['clean'], 'rug', 30)]
  assert.equal(dailySummary(list, now), 'Saw 5 tokens today (4 with a result).\nRugged 1 · dumped 1 · 2x+ 1 · flat 1.\nRed flags were right 2/3 times (67%).')
  assert.equal(dailySummary([], now), null)
})
