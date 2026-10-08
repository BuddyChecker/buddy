// Quick card rows: only what trading terminals don't show.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { edgeRows } from '../../src/edge.js'

const base = {
  flags: [],
  vamps: null,
  launch: null,
  dev: null,
  holderMap: null,
  socials: { websites: [], twitter: null },
}
const row = (rows, key) => rows.find(item => item.key === key)

test('a copy of a bigger coin is a red vamp row with the OG MC', () => {
  const scan = {
    ...base,
    vamps: { copies: 21, earlierCount: 3, bigger: { marketCap: 77_440_000 } },
    flags: [{ kind: 'vamp', level: 'red', text: 'VAMP: copy of $WOTF…' }],
  }
  const vamp = row(edgeRows({ scan }), 'vamp')
  assert.equal(vamp.level, 'red')
  assert.equal(vamp.value, 'COPY · OG at $77.4M')
})

test('dev wallets: who bought with the dev and how much they still hold', () => {
  const scan = {
    ...base,
    launch: { status: 'ok', creator: 'DEV', sameBlockWallets: 6, sameBlockPct: 46, sameBlockOwners: ['A', 'B', 'C', 'D', 'E', 'F'] },
    holderMap: { holders: [{ address: 'A', pct: 9 }, { address: 'C', pct: 6 }, { address: 'DEV', pct: 3 }, { address: 'Z', pct: 20 }], networks: [] },
  }
  const dev = row(edgeRows({ scan }), 'devWallets')
  assert.equal(dev.value, '6 bought with dev · 3 still hold 18%')
  assert.equal(dev.level, 'red')
  const clean = row(edgeRows({ scan: { ...scan, launch: { status: 'ok', creator: 'DEV', sameBlockWallets: 0 }, dev: { pct: 1 } } }), 'devWallets')
  assert.equal(clean.value, 'Clean launch · dev holds 1.0%')
  assert.equal(clean.level, 'green')
  assert.equal(row(edgeRows({ scan: { ...scan, launch: 'pending' } }), 'devWallets').value, 'Reading the launch…')
})

test('dev history: rugged before, serial launcher, first coin', () => {
  const rows = dev => edgeRows({ scan: { ...base, dev } })
  assert.equal(row(rows({ launches: 37, bestMarketCap: 3000, over100k: 0, ruggedBefore: true }), 'devHistory').value, 'Rugged before · 37 coins before')
  const serial = row(rows({ launches: 12, bestMarketCap: 8000, over100k: 0, ruggedBefore: false }), 'devHistory')
  assert.equal(serial.value, '12 coins before · best $8.0k')
  assert.equal(serial.level, 'red')
  assert.equal(row(rows({ launches: 0, ruggedBefore: false }), 'devHistory').value, 'First coin from this dev')
})

test('linked wallets, website and ATH lines', () => {
  const scan = {
    ...base,
    holderMap: { holders: [], networks: [{ wallets: 11, pct: 2.3, poolPct: 91 }] },
    socials: { websites: ['https://x.xyz'] },
  }
  const rows = edgeRows({
    scan,
    site: { ok: true, domainAgeDays: 3, builders: ['Framer'], mentionsToken: false },
    momentum: { ath: { price: 1 }, pulse: { priceUsd: 0.39, marketCap: 195_000 } },
  })
  assert.equal(row(rows, 'linked').value, '11 wallets · 2.3% (LP out)')
  assert.equal(row(rows, 'site').value, '3d old · Framer · no CA')
  assert.equal(row(rows, 'site').level, 'yellow')
  assert.equal(row(rows, 'ath').value, '$500k MC · now 61% below')
  assert.equal(row(edgeRows({ scan: base }), 'site').value, 'No website or socials')
})

test('chip facts: short lines, scary ones first, calm ones skipped', async () => {
  const { chipFacts } = await import('../../src/edge.js')
  const scan = {
    ...base,
    vamps: { copies: 21, earlierCount: 3, bigger: { marketCap: 77_440_000 } },
    flags: [{ kind: 'vamp', level: 'red', text: 'VAMP…' }],
    launch: { status: 'ok', creator: 'DEV', sameBlockWallets: 6, sameBlockPct: 46, sameBlockOwners: ['A', 'B'] },
    holderMap: { holders: [{ address: 'A', pct: 12 }], networks: [] },
    dev: { launches: 0, ruggedBefore: false },
  }
  const facts = chipFacts({ scan, momentum: { ath: { price: 1 }, pulse: { priceUsd: 0.39 } } })
  const texts = facts.map(fact => fact.text)
  assert.equal(texts[0], 'Vamp! OG at $77.4M')
  assert.ok(texts.includes('Dev bundle: 6 wallets · 1 still hold 12%'))
  assert.ok(texts.includes("Dev's first coin"))
  assert.ok(texts.includes('61% below its ATH'))
  assert.ok(!texts.some(text => /Linked wallets/.test(text))) // "No linked clusters" isn't news
})

test('same ticker, different projects: no vamps, said plainly', () => {
  const vamp = edgeRows({ scan: { ...base, vamps: { copies: 0, earlierCount: 0, tickerOnly: 4 } } }).find(item => item.key === 'vamp')
  assert.equal(vamp.value, 'No vamps · 4 other projects share the ticker')
  assert.equal(vamp.level, 'green')
})

test('a "website" that is just the launchpad page of the token says so', () => {
  const scan = { ...base, address: 'MINT123', socials: { websites: ['https://worldwideweb.stream/coin/MINT123'], twitter: ['https://x.com/a'], telegram: [], launchpad: 'worldwideweb.stream' } }
  const site = edgeRows({ scan, site: 'pending' }).find(item => item.key === 'site')
  assert.equal(site.value, 'Launchpad page only (worldwideweb.stream)')
  assert.equal(site.level, 'yellow')
})

test('ATH lines in market cap terms: the old high, or NEW ATH', async () => {
  const { chipFacts } = await import('../../src/edge.js')
  const below = chipFacts({ scan: base, momentum: { ath: { price: 1 }, pulse: { priceUsd: 0.39, marketCap: 195_000 } } })
  assert.equal(below.find(fact => fact.key === 'ath').text, 'ATH was $500k MC · now 61% below')
  const at = chipFacts({ scan: base, momentum: { ath: { price: 1 }, pulse: { priceUsd: 1.2, marketCap: 1_200_000 } } })
  assert.equal(at.find(fact => fact.key === 'ath').text, 'NEW ATH! $1.2M MC')
})

test('links to big platforms are not a website; old domains in years', () => {
  const xOnly = { ...base, socials: { websites: ['https://x.com/search?q=kimchi'], twitter: [], telegram: [] } }
  assert.equal(edgeRows({ scan: xOnly }).find(item => item.key === 'site').value, 'No real site (links to x.com)')
  const real = { ...base, socials: { websites: ['https://coolcoin.io'], twitter: [], telegram: [] } }
  assert.equal(edgeRows({ scan: real, site: { ok: true, domainAgeDays: 800, mentionsToken: true } }).find(item => item.key === 'site').value, '2y old')
})

test('dev history: first coin of the creator, but deployed by another wallet', async () => {
  const { chipFacts } = await import('../../src/edge.js')
  const scan = { ...base, dev: { creator: 'CREATOR', launches: 0, ruggedBefore: false }, launch: { status: 'ok', creator: 'DEPLOYER', sameBlockWallets: 0 } }
  const row = edgeRows({ scan }).find(item => item.key === 'devHistory')
  assert.equal(row.value, 'First coin from this dev · deployed by another wallet')
  assert.equal(row.level, 'yellow')
  assert.ok(chipFacts({ scan }).some(fact => fact.text === "Dev's 1st coin, deployed by another wallet"))
  // unknown history (RugCheck null and no on-chain count): no claim at all
  assert.equal(edgeRows({ scan: { ...base, dev: { creator: 'C', launches: null } } }).find(item => item.key === 'devHistory'), undefined)
})

test('dev wallets that already sold say "all sold" (dust ignored)', () => {
  const scan = {
    ...base,
    launch: { status: 'ok', creator: 'DEV', sameBlockWallets: 4, sameBlockPct: 12, sameBlockOwners: ['A', 'B', 'C', 'D'] },
    holderMap: { holders: [{ address: 'A', pct: 0.001 }, { address: 'B', pct: 0 }, { address: 'DEV', pct: 0.01 }], networks: [] },
  }
  assert.equal(edgeRows({ scan }).find(item => item.key === 'devWallets').value, '4 bought with dev · all sold')
})

test('dev wallet that is a bot, or a fresh burner, with unknown history', async () => {
  const { chipFacts } = await import('../../src/edge.js')
  const bot = { ...base, dev: { creator: 'BOT', launches: null, activity: { txs: 1000, hours: 2.3, perHour: 437, bot: true, fresh: false } } }
  const botRow = edgeRows({ scan: bot }).find(item => item.key === 'devHistory')
  assert.equal(botRow.value, 'Bot / launch service wallet')
  assert.ok(chipFacts({ scan: bot }).some(fact => fact.text === 'Dev wallet is a bot'))
  const fresh = { ...base, dev: { creator: 'NEW', launches: null, activity: { txs: 6, hours: 0.7, perHour: 8, bot: false, fresh: true } } }
  assert.equal(edgeRows({ scan: fresh }).find(item => item.key === 'devHistory').value, 'Fresh wallet')
  // nothing known and a normal wallet: no line at all (never "first coin" by default)
  const plain = { ...base, dev: { creator: 'X', launches: null, activity: { txs: 300, hours: 900, perHour: 0.3, bot: false, fresh: false } } }
  assert.equal(edgeRows({ scan: plain }).find(item => item.key === 'devHistory'), undefined)
})

test('dump risk: what the bundle + dev hold, and the price hit if they sell into the pool', async () => {
  const { dumpImpact, readLine } = await import('../../src/edge.js')
  // pool holds 20% of supply, insiders 18%: (20/38)^2 = 0.277 → ≈-72%
  assert.equal(Math.round(dumpImpact(18, 20)), 72)
  const scan = {
    ...base,
    launch: { status: 'ok', creator: 'DEV', sameBlockWallets: 5, sameBlockPct: 30, sameBlockOwners: ['A', 'B', 'C'] },
    holderMap: { holders: [{ address: 'POOL', pct: 20, pool: true }, { address: 'A', pct: 10 }, { address: 'B', pct: 5 }, { address: 'DEV', pct: 3 }], networks: [{ wallets: 4, pct: 8 }] },
  }
  const row = edgeRows({ scan }).find(item => item.key === 'dump')
  assert.equal(row.value, 'Bundle + dev hold 18% · sell = ≈-72%')
  assert.equal(row.level, 'red')
  assert.equal(edgeRows({ scan })[0].key, 'dump') // the first thing you see
  assert.equal(readLine({ scan }).split('.')[0], 'Bundle + dev still hold 18%: if they sell, price ≈-72%')
  // a clean token says why it's clean
  const clean = { ...base, socials: { websites: ['https://coolcoin.io'], twitter: [], telegram: [] }, launch: { status: 'ok', creator: 'DEV', sameBlockWallets: 0 }, holderMap: { holders: [{ address: 'POOL', pct: 60, pool: true }], networks: [] } }
  assert.equal(readLine({ scan: clean, site: { ok: true, domainAgeDays: 400, mentionsToken: true } }), 'Clean read: no dev bundle, no big clusters, little dump risk. Still a memecoin.')
})

test('live: insider wallets selling right now', async () => {
  const { liveAlerts } = await import('../../src/site-flags.js')
  const launch = { status: 'ok', creator: 'DEV', sameBlockWallets: 3, sameBlockOwners: ['A', 'B'] }
  const scan = holders => ({ ...base, verdict: 'medio', market: { liquidityUsd: 50000 }, dev: { pct: 0 }, launch, holderMap: { holders, networks: [] } })
  const before = scan([{ address: 'POOL', pct: 30, pool: true }, { address: 'A', pct: 10 }, { address: 'B', pct: 6 }])
  const after = scan([{ address: 'POOL', pct: 38, pool: true }, { address: 'A', pct: 2 }, { address: 'B', pct: 6 }])
  assert.deepEqual(liveAlerts(before, after), ['Bundle wallets just sold 8.0% of supply (8.0% left).'])
})

test('the read does not say the same thing twice', async () => {
  const { readLine } = await import('../../src/edge.js')
  const scan = {
    ...base,
    dev: { creator: 'DEV', launches: 0, activity: { txs: 6, fresh: true } },
    launch: { status: 'ok', creator: 'DEV', sameBlockWallets: 6, sameBlockPct: 30, sameBlockOwners: ['A'] },
    holderMap: { holders: [{ address: 'POOL', pct: 20, pool: true }, { address: 'A', pct: 15 }], networks: [] },
  }
  const read = readLine({ scan })
  assert.match(read, /^Bundle wallets still hold 15%: if they sell, price ≈-67%./)
  assert.doesNotMatch(read, /Dev bundle at launch/)
  assert.match(read, /fresh wallet/)
})

test('ATH: within 2% it is AT the ATH, never "1% below"', async () => {
  const { chipFacts } = await import('../../src/edge.js')
  const at = edgeRows({ scan: base, momentum: { ath: { price: 1 }, pulse: { priceUsd: 0.99, marketCap: 990_000 } } }).find(item => item.key === 'ath')
  assert.equal(at.value, 'At ATH · $990k MC')
  assert.doesNotMatch(JSON.stringify(chipFacts({ scan: base, momentum: { ath: { price: 1 }, pulse: { priceUsd: 0.985, marketCap: 985_000 } } })), /1% below|<1%/)
})

test('About: the dev description, the tweet, or the website, in a few words', async () => {
  const { chipFacts, readLine } = await import('../../src/edge.js')
  const about = scan => edgeRows({ scan: { ...base, name: 'Lucy', symbol: 'LUCY', ...scan }, site: scan.site }).find(item => item.key === 'about')
  assert.equal(about({ about: 'Justice for Lucy Craig. The cat that ran the internet and more and more words here' }).value, 'Justice for Lucy Craig.')
  assert.equal(about({ about: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen' }).value, 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen…')
  assert.equal(about({ narrative: { gone: false, user: 'AFpost', text: 'Lucy Craig deserves justice' } }).value, '@AFpost: Lucy Craig deserves justice')
  assert.equal(about({ about: 'LUCY' }), undefined) // just the ticker: says nothing
  const deleted = about({ narrative: { gone: true, deleted: true } })
  assert.equal(deleted.value, 'Its tweet was deleted by the author')
  assert.equal(deleted.level, 'yellow')
  // in the chip it comes right after the verdict
  const facts = chipFacts({ scan: { ...base, about: 'A dog that saves the trenches' } })
  assert.equal(facts[0].text, 'A dog that saves the trenches')
  assert.match(readLine({ scan: { ...base, narrative: { gone: true, deleted: true } } }), /Its tweet was deleted by the author/)
})

test('pump.fun curve row: how full and when it migrates', () => {
  const row = edgeRows({ scan: base, momentum: { curve: { progress: 86.4, etaMin: 6.2 } } }).find(item => item.key === 'curve')
  assert.equal(row.value, '86% of the curve · migrates in ~6 min')
  assert.equal(row.level, 'green')
  assert.equal(edgeRows({ scan: base, momentum: { curve: { progress: 100 } } }).find(item => item.key === 'curve'), undefined)
})

test('your position: how much you hold of this token, at the live price', () => {
  const row = edgeRows({ scan: { ...base, market: { priceUsd: 0.0002 } }, momentum: { pulse: { priceUsd: 0.0003 } }, holding: { amount: 1_200_000 } })[0]
  assert.equal(row.key, 'you')
  assert.equal(row.value, 'You hold 1.20M ($360)')
  assert.equal(edgeRows({ scan: base, holding: { amount: 0 } }).find(item => item.key === 'you'), undefined)
})

test('a red dump risk turns the risk light to HIGH (buddy, icon and report agree)', async () => {
  const { withDumpRisk } = await import('../../src/edge.js')
  const verdictFor = flags => (flags.some(flag => flag.critical) ? 'alto' : flags.some(flag => flag.level === 'yellow') ? 'medio' : 'bajo')
  const scan = {
    ...base,
    verdict: 'medio',
    launch: { status: 'ok', creator: 'DEV', sameBlockWallets: 6, sameBlockOwners: ['A'] },
    holderMap: { holders: [{ address: 'POOL', pct: 25, pool: true }, { address: 'A', pct: 50 }], networks: [] },
  }
  const out = withDumpRisk(scan, verdictFor)
  assert.equal(out.verdict, 'alto')
  assert.equal(out.flags[0].kind, 'dump')
  assert.match(out.flags[0].text, /if they sell, price ≈-89%/)
  // calling it again doesn't stack flags
  assert.equal(withDumpRisk(out, verdictFor).flags.filter(flag => flag.kind === 'dump').length, 1)
})

test('About from a tweet reads clean (no links, leading mentions or trailing hashtags)', () => {
  const about = edgeRows({ scan: { ...base, name: 'Lucy', symbol: 'LUCY', narrative: { gone: false, user: 'AFpost', text: '@someone @other Justice for Lucy Craig https://t.co/abc #lucy #justice' } } }).find(item => item.key === 'about')
  assert.equal(about.value, '@AFpost: Justice for Lucy Craig')
})
