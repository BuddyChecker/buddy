// VAMP checker: copycat tokens ("vamps") that reuse the same ticker or name.
// Uses DexScreener search (free, no key). The OG is the first one launched on
// the same chain; a vamp is a later copy — often launched to farm the hype.

const HOUR = 3.6e6
const TWIN_MS = 24 * HOUR
const FRESH_MS = 7 * 24 * HOUR
// a bigger earlier token only counts as "the OG you're copying" if it's alive
const LIVE_MC = 10_000

const TWIN_MIN_MC = 2_000
// a narrative race: 3+ coins with the same name launched within a few hours of each other
const RACE_MS = 6 * HOUR
const RACE_MIN = 3
// DexScreener lists some tokens with absurd MC and no liquidity (broken supply):
// they don't count as "the OG". Small coins (pump.fun curve, no LP yet) always count.
const credible = token => token.marketCap < 100_000 || (token.liquidity ?? 0) * 200 > token.marketCap

// How alike two names are (Dice coefficient on letter pairs): 1 = same, 0 = nothing in common.
// "World Oil Trust Fund" vs "World Oil Trusf Fund (WOTF)" ≈ 0.9; "Cato" vs "Catoshi Nakamoto" ≈ 0.3.
const nameLike = (a, b) => {
  const clean = value => String(value ?? '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]/g, '')
  const x = clean(a)
  const y = clean(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const pairs = value => {
    const out = new Map()
    for (let i = 0; i < value.length - 1; i += 1) out.set(value.slice(i, i + 2), (out.get(value.slice(i, i + 2)) ?? 0) + 1)
    return out
  }
  const px = pairs(x)
  const py = pairs(y)
  let shared = 0
  for (const [pair, count] of px) shared += Math.min(count, py.get(pair) ?? 0)
  const total = Math.max(1, x.length - 1 + y.length - 1)
  return (2 * shared) / total
}
const LOOKALIKE = 0.7

const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

const fetchSearch = async (query, fetcher) => {
  const response = await fetcher(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error(`api.dexscreener.com responded ${response.status}`)
  return (await response.json()).pairs ?? []
}

/**
 * target: { chain, address, symbol, name, createdAt (ms), marketCap }
 * Returns null when there's nothing to compare.
 */
const findVamps = async (target, { fetcher = fetch } = {}) => {
  const symbol = normalize(target.symbol)
  const name = normalize(target.name)
  if (!symbol && !name) return null
  const queries = [...new Set([target.symbol, target.name].filter(Boolean))].slice(0, 2)
  const results = await Promise.all(queries.map(query => fetchSearch(query, fetcher).catch(() => [])))
  const tokens = new Map()
  for (const pair of results.flat()) {
    const base = pair.baseToken ?? {}
    if (!base.address) continue
    const sameTicker = symbol && normalize(base.symbol) === symbol
    const sameName = name && normalize(base.name) === name
    if (!sameTicker && !sameName) continue
    // a vamp copies the ticker AND the name (often with a typo). Same ticker with a
    // different name is just another project: counted apart, never called a vamp.
    const lookalike = sameName || nameLike(base.name, target.name) >= LOOKALIKE
    const key = `${pair.chainId}:${base.address.toLowerCase()}`
    const current = tokens.get(key) ?? {
      chain: pair.chainId,
      address: base.address,
      symbol: base.symbol,
      name: base.name,
      createdAt: Infinity,
      marketCap: 0,
      liquidity: null,
      volumeH1: 0,
      site: null,
      x: null,
      url: pair.url,
      sameTicker,
      sameName,
      lookalike,
    }
    current.createdAt = Math.min(current.createdAt, pair.pairCreatedAt ?? Infinity)
    current.marketCap = Math.max(current.marketCap, pair.marketCap ?? pair.fdv ?? 0)
    if (pair.liquidity?.usd != null) current.liquidity = (current.liquidity ?? 0) + pair.liquidity.usd
    current.volumeH1 += Number(pair.volume?.h1) || 0
    current.site ??= pair.info?.websites?.[0]?.url ?? null
    current.x ??= pair.info?.socials?.find(item => item.type === 'twitter')?.url ?? null
    tokens.set(key, current)
  }
  const self = `${target.chain}:${String(target.address).toLowerCase()}`
  tokens.delete(self)
  const found = [...tokens.values()]
  // without a name to compare, fall back to the ticker alone
  const all = name ? found.filter(token => token.lookalike) : found
  const sameChain = all.filter(token => token.chain === target.chain)
  const tickerOnly = name ? found.filter(token => !token.lookalike && token.chain === target.chain).length : 0
  const me = { address: target.address, createdAt: target.createdAt ?? Infinity, marketCap: target.marketCap ?? 0 }
  const earliest = [me, ...sameChain].reduce((best, token) => (token.createdAt < best.createdAt ? token : best), me)
  const biggest = [me, ...sameChain].reduce((best, token) => (token.marketCap > best.marketCap ? token : best), me)
  // the ones launched before this token: the only ones it could be copying
  const earlier = sameChain.filter(token => token.createdAt < me.createdAt)
  const bigger = earlier.filter(credible).reduce((best, token) => (token.marketCap > (best?.marketCap ?? -1) ? token : best), null)
  // twin launch: another same-ticker token a few hours before (who's the real one?)
  const twin = earlier
    .filter(token => me.createdAt - token.createdAt <= TWIN_MS && credible(token) && token.marketCap >= Math.max(TWIN_MIN_MC, me.marketCap * 0.25)).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  // the race: same-name coins launched within a few hours of this one (this one included)
  const runners = Number.isFinite(me.createdAt) ? [me, ...sameChain.filter(token => credible(token) && Math.abs(token.createdAt - me.createdAt) <= RACE_MS)] : []
  const race =
    runners.length >= RACE_MIN
      ? {
          count: runners.length,
          spanMs: Math.max(...runners.map(token => token.createdAt)) - Math.min(...runners.map(token => token.createdAt)),
          first: runners.reduce((best, token) => (token.createdAt < best.createdAt ? token : best)),
          leader: runners.reduce((best, token) => (token.marketCap > best.marketCap ? token : best)),
          hottest: runners.reduce((best, token) => ((token.volumeH1 ?? 0) > (best.volumeH1 ?? 0) ? token : best)),
          isFirst: runners.every(token => token === me || token.createdAt >= me.createdAt),
          isLeader: runners.every(token => token === me || token.marketCap <= me.marketCap),
          rank: [...runners].sort((a, b) => b.marketCap - a.marketCap).indexOf(me) + 1,
          runners: [...runners].filter(token => token !== me).sort((a, b) => b.marketCap - a.marketCap).slice(0, 6),
        }
      : null
  return {
    copies: sameChain.length,
    otherChains: all.length - sameChain.length,
    tickerOnly,
    earlierCount: earlier.length,
    isEarliest: earliest === me,
    isBiggest: biggest === me,
    og: earliest === me ? null : earliest,
    leader: biggest === me ? null : biggest,
    bigger,
    twin,
    race,
    top: [...sameChain].sort((a, b) => b.marketCap - a.marketCap).slice(0, 5),
  }
}

const usd = value =>
  value >= 1e9 ? `$${(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `$${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `$${(value / 1e3).toFixed(1)}k` : `$${Math.round(value)}`
const ago = ms => {
  const hours = ms / 3.6e6
  return hours < 1 ? `${Math.max(1, Math.round(hours * 60))}m` : hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`
}
const short = address => `${address.slice(0, 4)}…${address.slice(-4)}`

const vampFlags = (vamps, { symbol, createdAt, marketCap } = {}) => {
  if (!vamps) return []
  const ticker = symbol ? `$${symbol}` : 'this ticker'
  const mine = marketCap ?? 0
  const since = token => (Number.isFinite(token?.createdAt) && Number.isFinite(createdAt) ? Math.max(0, createdAt - token.createdAt) : null)
  const when = token => (since(token) >= 60 * 1000 ? ` launched ${ago(since(token))} earlier` : ' launched first')
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
  const race = vamps.race
  if (race) {
    const span = ago(Math.max(60e3, race.spanMs))
    const leader = race.leader
    const lead = leader && !race.isLeader ? leader : null
    const after = token => (Number.isFinite(token?.createdAt) && Number.isFinite(createdAt) ? token.createdAt - createdAt : 0)
    // the original idea, but the money went to a twin launched after it
    if (lead && after(lead) > 0 && lead.marketCap >= Math.max(mine * 5, LIVE_MC)) {
      return [
        {
          level: 'red',
          kind: 'vamp',
          race: true,
          critical: lead.marketCap >= mine * 10,
          text: `Lost the race: ${race.count} ${ticker} launched in ${span}. This one came ${race.isFirst ? 'first' : 'earlier'}, but the money moved to CA ${short(lead.address)}, launched ${ago(after(lead))} later, at ${usd(lead.marketCap)} MC vs ${usd(mine)} here.`,
        },
      ]
    }
    if (lead) {
      return [
        {
          level: 'yellow',
          kind: 'vamp',
          race: true,
          text: `Narrative race: ${race.count} ${ticker} launched in ${span}. The biggest is CA ${short(lead.address)} at ${usd(lead.marketCap)} MC${after(lead) < 0 ? ` (launched ${ago(-after(lead))} earlier)` : ''}; this one is #${race.rank} at ${usd(mine)}. Check what each one does differently.`,
        },
      ]
    }
    const first = race.first && race.first.address !== undefined && !race.isFirst ? race.first : null
    return [
      {
        level: 'green',
        kind: 'vamp',
          race: true,
        text: `Leading the race: ${race.count} ${ticker} launched in ${span}, and this one has the most money (${usd(mine)} MC).${first ? ` The first one (CA ${short(first.address)}) sits at ${usd(first.marketCap)}.` : ''}`,
      },
    ]
  }
  if (!vamps.earlierCount) {
    return [
      vamps.copies > 0
        ? { level: 'green', kind: 'vamp', text: `OG ${ticker}: first on this chain, ${plural(vamps.copies, 'vamp')} copy it.` }
        : { level: 'green', kind: 'vamp', text: vamps.tickerOnly ? `No vamps. ${plural(vamps.tickerOnly, 'other project')} use${vamps.tickerOnly === 1 ? 's' : ''} ${ticker} with a different name.` : `No vamps: no other token uses ${ticker} on this chain.` },
    ]
  }
  const bigger = vamps.bigger
  // a live, clearly bigger token with the same ticker came first: this one is the copy
  if (bigger && bigger.marketCap >= Math.max(mine * 3, LIVE_MC)) {
    const fresh = since(bigger) != null && since(bigger) <= FRESH_MS
    return [
      {
        level: 'red',
        kind: 'vamp',
        // riding a fresh runner (or a big name) is the classic vamp: high risk on its own
        critical: bigger.marketCap >= mine * 5 && (fresh || bigger.marketCap >= 1e6),
        text: `VAMP: copy of ${ticker}. The OG (CA ${short(bigger.address)})${when(bigger)} and sits at ${usd(bigger.marketCap)} MC${mine ? ` vs ${usd(mine)} here` : ''}.`,
      },
    ]
  }
  if (vamps.twin) {
    return [
      {
        level: 'yellow',
        kind: 'vamp',
        text: `Twin launch: another ${ticker} (CA ${short(vamps.twin.address)})${when(vamps.twin)}${vamps.twin.marketCap ? ` at ${usd(vamps.twin.marketCap)} MC` : ''}. Make sure you're on the right CA.`,
      },
    ]
  }
  // only old, smaller coins used the ticker before: reuse, not a copy of a live coin
  return [
    {
      level: 'green',
      kind: 'vamp',
      text: `${plural(vamps.earlierCount, `older lookalike`)} of ${ticker} exist${vamps.earlierCount === 1 ? 's' : ''}, all dead or smaller. Not copying a live coin.`,
    },
  ]
}

// A coin whose website is ANOTHER coin's page (a launchpad page carries the CA in its URL):
// it borrows that coin's identity. Seen live: the biggest $Collatz linked the first one's page.
const CA_IN_URL = /[1-9A-HJ-NP-Za-km-z]{32,44}/g
const identityFlags = (address, socials, vamps) => {
  const mine = String(address ?? '')
  if (!mine) return []
  for (const url of socials?.websites ?? []) {
    const other = (String(url).match(CA_IN_URL) ?? []).find(ca => ca !== mine)
    if (!other || String(url).includes(mine)) continue
    const known = [vamps?.race?.first, ...(vamps?.race?.runners ?? []), ...(vamps?.top ?? [])].filter(Boolean).find(token => token.address === other)
    return [
      {
        level: 'red',
        kind: 'identity',
        other,
        text: `Borrowed identity: its website is the page of another coin (CA ${short(other)}${known ? `, ${usd(known.marketCap)} MC` : ''}). That project's page, agent or team is not this coin's.`,
      },
    ]
  }
  return []
}

module.exports = { findVamps, vampFlags, identityFlags, normalize, nameLike }
