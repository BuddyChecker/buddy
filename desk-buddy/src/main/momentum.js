// Momentum: all-time high (ATH) and volume pace, for live alerts while a token is open.
// ATH comes from GeckoTerminal candles (free, no key) across the token's pools, so a
// pump.fun coin keeps the high it made on the bonding curve before migrating.
// Live numbers come from one DexScreener request ("pulse").

const GECKO = 'https://api.geckoterminal.com/api/v2'
const GECKO_NETWORK = { solana: 'solana', ethereum: 'eth', base: 'base', bsc: 'bsc', arbitrum: 'arbitrum', polygon: 'polygon_pos', avalanche: 'avax' }
const HOUR = 3.6e6

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const getJson = async (url, fetcher, retries = 1) => {
  const response = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
  // GeckoTerminal's free tier allows ~30 calls/min: on 429 wait a moment and try once more
  if (response.status === 429 && retries > 0) {
    await sleep(2500)
    return getJson(url, fetcher, retries - 1)
  }
  if (!response.ok) throw new Error(`${new URL(url).host} responded ${response.status}`)
  return response.json()
}

/** Candle size that covers the whole life of the pool in ≤ 1000 candles. */
const timeframeFor = ageHours => {
  if (!Number.isFinite(ageHours) || ageHours > 41 * 24) return { timeframe: 'day', aggregate: 1 }
  if (ageHours > 10 * 24) return { timeframe: 'hour', aggregate: 1 }
  if (ageHours > 15) return { timeframe: 'minute', aggregate: 15 }
  return { timeframe: 'minute', aggregate: 1 }
}

/**
 * Highest price in a list of GeckoTerminal candles [time, open, high, low, close, volume].
 * Glitch candles (a single absurd wick, or a close far above everything else) are ignored.
 */
const athFromCandles = candles => {
  const rows = (candles ?? []).filter(row => Array.isArray(row) && row.slice(1, 5).every(Number.isFinite))
  if (!rows.length) return null
  const closes = rows.map(row => row[4]).sort((a, b) => a - b)
  const median = closes[Math.floor(closes.length / 2)]
  let best = null
  for (const [time, open, high, , close] of rows) {
    const body = Math.max(open, close)
    if (median > 0 && body > median * 50) continue // whole candle off the charts: bad data
    const price = Math.min(high, body * 3) // wick capped at 3x the candle body
    if (!best || price > best.price) best = { price, at: time * 1000 }
  }
  return best
}

/**
 * ATH of a token across its pools (top 2 by liquidity, plus any pump.fun curve pool).
 * Returns { price, at, pools } or null.
 */
const fetchAth = async ({ chain, address }, { fetcher = fetch } = {}) => {
  const network = GECKO_NETWORK[chain]
  if (!network || !address) return null
  const list = await getJson(`${GECKO}/networks/${network}/tokens/${address}/pools?page=1`, fetcher)
  const pools = (list.data ?? []).map(pool => ({
    address: pool.attributes?.address,
    dex: pool.relationships?.dex?.data?.id ?? '',
    createdAt: Date.parse(pool.attributes?.pool_created_at ?? '') || null,
    liquidity: Number(pool.attributes?.reserve_in_usd ?? 0),
    // the pool must price OUR token (base), not the other side
    base: String(pool.relationships?.base_token?.data?.id ?? '').endsWith(address),
  }))
  const chosen = [
    ...pools.filter(pool => pool.base).sort((a, b) => b.liquidity - a.liquidity).slice(0, 2),
    ...pools.filter(pool => pool.base && /pump/.test(pool.dex)),
  ].filter((pool, index, all) => pool.address && all.findIndex(other => other.address === pool.address) === index)
  if (!chosen.length) return null
  let best = null
  for (const pool of chosen) {
    const ageHours = pool.createdAt ? (Date.now() - pool.createdAt) / HOUR : null
    const { timeframe, aggregate } = timeframeFor(ageHours)
    try {
      const data = await getJson(
        `${GECKO}/networks/${network}/pools/${pool.address}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=1000&currency=usd&token=base`,
        fetcher
      )
      const high = athFromCandles(data.data?.attributes?.ohlcv_list)
      if (high && (!best || high.price > best.price)) best = high
    } catch {
      // one pool failing doesn't sink the others
    }
  }
  return best ? { ...best, pools: chosen.length } : null
}

/** The live numbers of a token from DexScreener (best pool by liquidity). */
const fetchPulse = async ({ chain, address }, { fetcher = fetch } = {}) => {
  const data = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${address}`, fetcher)
  const pairs = (data.pairs ?? []).filter(pair => !chain || pair.chainId === chain)
  const pair = pairs.reduce((best, item) => ((item.liquidity?.usd ?? 0) > (best?.liquidity?.usd ?? -1) ? item : best), null)
  if (!pair) return null
  const sum = pick => pairs.reduce((total, item) => total + (Number(pick(item)) || 0), 0)
  const oldest = Math.min(...pairs.map(item => item.pairCreatedAt ?? Infinity))
  return {
    at: Date.now(),
    createdAt: Number.isFinite(oldest) ? oldest : null,
    priceUsd: Number(pair.priceUsd ?? 0),
    marketCap: pair.marketCap ?? pair.fdv ?? null,
    volume: { m5: sum(item => item.volume?.m5), h1: sum(item => item.volume?.h1), h6: sum(item => item.volume?.h6) },
    buysM5: sum(item => item.txns?.m5?.buys),
    sellsM5: sum(item => item.txns?.m5?.sells),
    // price moves of the main pool (for dips) and total liquidity (to tell a dip from a rug)
    priceChange: { m5: Number(pair.priceChange?.m5 ?? 0), h1: Number(pair.priceChange?.h1 ?? 0) },
    liquidityUsd: sum(item => item.liquidity?.usd),
    // still on the pump.fun curve (no other pool yet): where it is on the curve, from its SOL price
    curve: pairs.every(item => item.dexId === 'pumpfun') ? curveProgress(Number(pairs[0].priceNative)) : null,
  }
}

const usd = value =>
  value >= 1e9 ? `$${(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `$${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `$${(value / 1e3).toFixed(1)}k` : `$${Math.round(value)}`

const COOLDOWN = { ath: 2 * 60e3, near: 10 * 60e3, volume: 5 * 60e3, dip: 10 * 60e3, sellers: 10 * 60e3, buyers: 10 * 60e3, migrate: 5 * 60e3 }

// Fresh memecoins always trade a lot: everything looks like a spike in their first minutes.
const QUIET_FIRST_MIN = 15

/**
 * How the last 5 min compare with the usual 5 min of the last hour.
 * A coin younger than 1h only has that many minutes of history, so the "usual"
 * pace is its volume divided by its real age, not by 60 min.
 * null when it's too young (or there's no data) to tell.
 */
const volumePace = (pulse, now = Date.now()) => {
  const volume = pulse?.volume
  if (!volume?.h1) return null
  const ageMin = pulse.createdAt ? (now - pulse.createdAt) / 60e3 : Infinity
  if (ageMin < QUIET_FIRST_MIN) return null
  const windows = Math.min(ageMin, 60) / 5 // 5-min windows in the last hour (or since launch)
  const usual = volume.h1 / windows
  return usual > 0 ? volume.m5 / usual : null
}

/**
 * Compares the live pulse with the ATH and returns the alerts worth showing now.
 * memory keeps cooldowns between calls: { [kind]: lastTime, athAlerted: price }.
 * Returns { alerts: [{ kind, text }], ath } (ath goes up when it's broken).
 */
const momentumAlerts = ({ pulse, ath, symbol, memory = {}, now = Date.now() }) => {
  const alerts = []
  const ticker = symbol ? `$${symbol}` : 'This token'
  let nextAth = ath
  const ready = kind => memory[kind] == null || now - memory[kind] >= COOLDOWN[kind]
  const mcAt = price => (pulse?.marketCap && pulse.priceUsd ? (pulse.marketCap / pulse.priceUsd) * price : null)

  if (pulse?.priceUsd > 0 && ath?.price > 0) {
    if (pulse.priceUsd > ath.price) {
      // a new high: say it once, then again only if it runs another 5%
      const lastAlerted = memory.athAlerted ?? ath.price
      if (memory.athAlerted == null || pulse.priceUsd >= lastAlerted * 1.05) {
        if (ready('ath')) {
          alerts.push({ kind: 'ath', text: pulse.marketCap ? `NEW ATH! ${ticker} at ${usd(pulse.marketCap)} MC` : `NEW ATH! ${ticker}` })
          memory.ath = now
          memory.athAlerted = pulse.priceUsd
          memory.near = now // right after a new high, "close to the ATH" is just noise
        }
      }
      nextAth = { ...ath, price: pulse.priceUsd, at: now }
    } else {
      const gap = (1 - pulse.priceUsd / ath.price) * 100
      // 2-8% under the high: worth a heads-up. Closer than that it's simply at the ATH.
      if (gap > 2 && gap <= 8 && ready('near')) {
        const athMc = mcAt(ath.price)
        alerts.push({ kind: 'near', text: `${Math.round(gap)}% under its ATH${athMc ? ` (${usd(athMc)} MC)` : ''}` })
        memory.near = now
      }
    }
  }

  // only the 5-min spike: hourly comparisons always fire on fresh coins
  const pace = volumePace(pulse, now)
  if (pace != null && pulse.volume.m5 >= 2000 && pace >= 3 && ready('volume')) {
    alerts.push({ kind: 'volume', text: `Volume ${pace.toFixed(1)}x: ${usd(pulse.volume.m5)} in 5 min` })
    memory.volume = now
  }
  const dip = bigDip({ pulse, memory, now, pace })
  if (dip && ready('dip')) {
    // say it again only if it digs another 15% deeper
    if (memory.dipAlerted == null || dip.drop >= memory.dipAlerted + 15) {
      alerts.push({ kind: 'dip', text: `BIG DIP -${dip.drop.toFixed(0)}% · volume still in (${usd(pulse.volume.m5)}/5m)` })
      memory.dip = now
      memory.dipAlerted = dip.drop
    }
  }
  // who's winning the last minutes: 3 readings in a row clearly one-sided, with real volume
  // the live read can come every 2 s; one flow sample per ~20 s keeps "3 readings" meaning a minute
  if (memory.flowAt == null || now - memory.flowAt >= 18e3) {
    memory.flowAt = now
    memory.flow = [...(memory.flow ?? []), { buys: pulse?.buysM5 ?? 0, sells: pulse?.sellsM5 ?? 0, volume: pulse?.volume?.m5 ?? 0 }].slice(-3)
  }
  if (memory.flow.length === 3 && memory.flow.every(item => item.volume >= 3000)) {
    const buys = memory.flow.reduce((sum, item) => sum + item.buys, 0)
    const sells = memory.flow.reduce((sum, item) => sum + item.sells, 0)
    if (sells >= buys * 1.8 && sells >= 30 && ready('sellers')) {
      alerts.push({ kind: 'sellers', text: `Sellers taking over: ${(sells / Math.max(1, buys)).toFixed(1)}x more sells than buys` })
      memory.sellers = now
    } else if (buys >= sells * 1.8 && buys >= 30 && ready('buyers')) {
      alerts.push({ kind: 'buyers', text: `Buyers taking over: ${(buys / Math.max(1, sells)).toFixed(1)}x more buys than sells` })
      memory.buyers = now
    }
  }

  // pump.fun curve: how fast it's filling, and when it migrates at this pace
  const curve = curveEta(pulse?.curve, memory, now)
  if (curve?.etaMin != null && curve.progress >= 80 && curve.etaMin <= 10 && ready('migrate')) {
    alerts.push({ kind: 'migrate', text: `Migrating soon: ${Math.floor(curve.progress)}% of the curve, ~${Math.max(1, Math.round(curve.etaMin))} min at this pace` })
    memory.migrate = now
  }
  return { alerts, ath: nextAth, curve }
}

// pump.fun bonding curve (constant product, 30 virtual SOL × 1,073M virtual tokens, 793.1M sold
// on the curve, 1B supply). From the price in SOL: market cap in SOL = 32,190,000 / T², T being
// the virtual tokens left (in millions). It starts at ~28 SOL MC and migrates at ~411 SOL MC.
const curveProgress = priceNative => {
  if (!(priceNative > 0)) return null
  const mcSol = priceNative * 1e9
  const left = Math.sqrt((30 * 1073 * 1000) / mcSol)
  return Math.min(100, Math.max(0, ((1073 - left) / 793.1) * 100))
}

/** Progress now, and minutes to 100% at the pace of the last few minutes (null if not filling). */
const curveEta = (progress, memory, now) => {
  if (progress == null) return null
  memory.curvePoints = [...(memory.curvePoints ?? []).filter(point => now - point.at <= 10 * 60e3), { at: now, progress }]
  const first = memory.curvePoints[0]
  const span = (now - first.at) / 60e3
  const gained = progress - first.progress
  const etaMin = span >= 0.6 && gained > 0.5 ? (100 - progress) / (gained / span) : null
  return { progress, etaMin }
}

const DIP_MIN = 25 // % below the recent high
const HOUR_MS = 60 * 60e3

/**
 * A big dip that still has volume and buyers (not a dead coin bleeding out, not a rug).
 * The recent high is the highest price seen in the last hour: our own pulses every 20 s,
 * plus where the price was 1h ago (from DexScreener's 1h change) for the first minutes.
 * Returns { drop, high } or null.
 */
const bigDip = ({ pulse, memory, now, pace }) => {
  if (!(pulse?.priceUsd > 0)) return null
  memory.prices = (memory.prices ?? []).filter(item => now - item.at <= HOUR_MS)
  memory.prices.push({ at: now, price: pulse.priceUsd })
  memory.liquidityStart ??= pulse.liquidityUsd ?? null
  const h1 = pulse.priceChange?.h1
  const hourAgo = Number.isFinite(h1) && h1 > -100 ? pulse.priceUsd / (1 + h1 / 100) : 0
  const high = Math.max(hourAgo, ...memory.prices.map(item => item.price))
  const drop = (1 - pulse.priceUsd / high) * 100
  if (drop < DIP_MIN) return null
  // volume still there: real money in the last 5 min, at least half the usual pace
  if (!(pulse.volume?.m5 >= 2000) || pace == null || pace < 0.5) return null
  // and people are buying it, not only dumping
  const buys = pulse.buysM5 ?? 0
  const total = buys + (pulse.sellsM5 ?? 0)
  if (total < 20 || buys / total < 0.35) return null
  // liquidity pulled = a rug, not a dip (the live watch shouts about that one)
  if (memory.liquidityStart > 0 && pulse.liquidityUsd < memory.liquidityStart * 0.6) return null
  return { drop, high }
}

module.exports = { curveProgress, fetchAth, fetchPulse, momentumAlerts, volumePace, bigDip, athFromCandles, timeframeFor, GECKO_NETWORK }
