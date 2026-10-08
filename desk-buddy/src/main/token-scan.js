// Token scanner: figures out what the user pasted, pulls real data from public
// sources (no API key) and computes risk signals with fixed, explainable rules.
//
// Sources:
//  - DexScreener (market + search, any chain)  https://docs.dexscreener.com
//  - RugCheck (security, Solana)               https://api.rugcheck.xyz
//  - GoPlus (security, EVM)                    https://docs.gopluslabs.io
//  - Solana RPC (launch, see launch-scan.js)

const { readTweet, tweetId, walletActivity, countPumpCoins, analyzeLaunch, launchFlags, socialsFromPair, socialsFromMetadata, mergeSocials, devFromReport, insidersFromReport, networkHoldings, isPoolHolder } = require('./launch-scan')
const { findVamps, vampFlags, identityFlags } = require('./vamps')

const SOLANA_ADDRESS = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/
const EVM_ADDRESS = /\b0x[a-fA-F0-9]{40}\b/
const GOPLUS_CHAIN = { ethereum: 1, bsc: 56, base: 8453, arbitrum: 42161, polygon: 137, avalanche: 43114 }

/** Pulls {chain, address, pairAddress} out of what the user pasted, or null. */
const parseTokenInput = raw => {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const dex = text.match(/dexscreener\.com\/([a-z0-9]+)\/([A-Za-z0-9]+)/i)
  if (dex) return { chain: dex[1].toLowerCase(), pairAddress: dex[2] }
  const solanaLink = text.match(
    /(?:pump\.fun\/(?:coin\/)?|birdeye\.so\/token\/|solscan\.io\/token\/|gmgn\.ai\/sol\/token\/)([1-9A-HJ-NP-Za-km-z]{32,44})/
  )
  if (solanaLink) return { chain: 'solana', address: solanaLink[1] }
  const evm = text.match(EVM_ADDRESS)
  if (evm) return { chain: null, address: evm[0] } // DexScreener resolves the chain
  const solana = text.match(SOLANA_ADDRESS)
  if (solana) return { chain: 'solana', address: solana[0] }
  return null
}

const fetchJson = async (url, fetcher = fetch) => {
  const response = await fetcher(url, {
    headers: { accept: 'application/json', 'user-agent': 'desk-buddy/0.1' },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`${new URL(url).host} responded ${response.status}`)
  return response.json()
}

const bestPair = pairs =>
  (pairs ?? []).reduce(
    (best, pair) => ((pair?.liquidity?.usd ?? 0) > (best?.liquidity?.usd ?? -1) ? pair : best),
    null
  )

const pct = value => `${Number(value).toFixed(value < 10 ? 1 : 0)}%`
const usd = value =>
  value >= 1e9
    ? `$${(value / 1e9).toFixed(2)}B`
    : value >= 1e6
      ? `$${(value / 1e6).toFixed(2)}M`
      : value >= 1e3
        ? `$${(value / 1e3).toFixed(1)}k`
        : `$${Math.round(value)}`

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

const marketFlags = market => {
  const flags = []
  if (!market) {
    flags.push({ level: 'red', text: 'No liquidity pool indexed yet: almost nobody can buy or sell it.' })
    return flags
  }
  // Only what needs reading between the lines. Age, curve status, liquidity and the 24h move
  // are on every terminal's screen already (and every memecoin is young and volatile).
  const { liquidityUsd, volume24h, fdv, buys24h, sells24h } = market
  if (!market.bondingCurve && liquidityUsd > 0 && volume24h / liquidityUsd > 50) {
    flags.push({ level: 'yellow', text: `24h volume is ${Math.round(volume24h / liquidityUsd)}× liquidity: possible wash trading (bots trading with themselves).` })
  }
  if (!market.bondingCurve && liquidityUsd > 0 && fdv / liquidityUsd > 100) {
    flags.push({ level: 'yellow', text: `FDV (${usd(fdv)}) is way out of line with liquidity (${usd(liquidityUsd)}).` })
  }
  const total = (buys24h ?? 0) + (sells24h ?? 0)
  if (total > 40 && sells24h / total < 0.08) {
    flags.push({ level: 'yellow', text: 'Almost no sells vs buys: classic honeypot or fake volume.' })
  }
  return flags
}

const solanaFlags = report => {
  const flags = []
  if (!report) return flags
  if (report.rugged) flags.push({ level: 'red', text: 'RugCheck marks it as RUGGED (LP already pulled).' })
  if (report.mintAuthority) flags.push({ level: 'red', text: 'Mint authority is ON: the dev can mint more and dilute you.' })
  else flags.push({ level: 'green', text: 'Mint authority revoked (no more can be printed).' })
  if (report.freezeAuthority) flags.push({ level: 'red', text: 'Freeze authority is ON: they can freeze wallets and block sells.' })
  else flags.push({ level: 'green', text: 'Freeze authority revoked.' })

  // Concentration without known pools/AMMs (that liquidity isn't one person).
  const holders = (report.topHolders ?? []).filter(holder => !isPoolHolder(report.knownAccounts ?? {})(holder))
  const top10 = holders.slice(0, 10).reduce((sum, holder) => sum + (holder.pct ?? 0), 0)
  if (top10 > 50) flags.push({ level: 'red', text: `Top 10 holders own ${pct(top10)} of supply.` })
  else if (top10 > 30) flags.push({ level: 'yellow', text: `Top 10 holders own ${pct(top10)}.` })
  else if (holders.length) flags.push({ level: 'green', text: `Well distributed: top 10 own ${pct(top10)}.` })

  const insiderPct = holders.filter(holder => holder.insider).reduce((sum, holder) => sum + (holder.pct ?? 0), 0)
  if (insiderPct > 10) {
    flags.push({ level: 'red', text: `Linked insider wallets hold ${pct(insiderPct)}: strong bundle signal.` })
  } else if ((report.graphInsidersDetected ?? 0) > 0) {
    flags.push({ level: 'yellow', text: `RugCheck found ${report.graphInsidersDetected} linked wallets (coordinated buys / possible bundle).` })
  }
  if (typeof report.lpLockedPct === 'number') {
    if (report.lpLockedPct < 50) flags.push({ level: 'yellow', text: `Only ${pct(report.lpLockedPct)} of LP is locked.` })
    else flags.push({ level: 'green', text: `LP ${pct(report.lpLockedPct)} locked or burned.` })
  }
  // RugCheck's generic notes that any memecoin trips (and the terminal shows anyway)
  const OBVIOUS = /low liquidity|lp providers|low amount of holders/i
  for (const risk of (report.risks ?? []).filter(item => !OBVIOUS.test(item.name ?? ''))) {
    if (risk.level === 'danger') flags.push({ level: 'red', text: `RugCheck: ${risk.name}${risk.description ? `: ${risk.description}` : ''}` })
    else if (risk.level === 'warn') flags.push({ level: 'yellow', text: `RugCheck: ${risk.name}${risk.description ? `: ${risk.description}` : ''}` })
  }
  return flags
}

const evmFlags = security => {
  const flags = []
  if (!security) return flags
  const on = value => value === '1' || value === 1 || value === true
  if (on(security.is_honeypot)) flags.push({ level: 'red', text: 'HONEYPOT (GoPlus): you can buy but you can\'t sell.' })
  const sellTax = Number(security.sell_tax ?? 0) * 100
  const buyTax = Number(security.buy_tax ?? 0) * 100
  if (sellTax > 10) flags.push({ level: 'red', text: `Sell tax ${pct(sellTax)}.` })
  else if (sellTax > 5) flags.push({ level: 'yellow', text: `Sell tax ${pct(sellTax)}.` })
  if (buyTax > 10) flags.push({ level: 'yellow', text: `Buy tax ${pct(buyTax)}.` })
  if (on(security.cannot_sell_all)) flags.push({ level: 'red', text: 'You can\'t sell your full balance.' })
  if (on(security.is_mintable)) flags.push({ level: 'red', text: 'Mintable contract: they can print more tokens.' })
  if (on(security.hidden_owner)) flags.push({ level: 'red', text: 'Hidden owner.' })
  if (on(security.can_take_back_ownership)) flags.push({ level: 'red', text: 'Owner can take back ownership.' })
  if (on(security.owner_change_balance)) flags.push({ level: 'red', text: 'Owner can change balances.' })
  if (on(security.is_blacklisted)) flags.push({ level: 'yellow', text: 'Has a wallet blacklist.' })
  if (on(security.trading_cooldown)) flags.push({ level: 'yellow', text: 'Trading cooldown between txs.' })
  if (security.is_open_source === '0') flags.push({ level: 'yellow', text: 'Contract source not verified.' })
  else if (security.is_open_source === '1') flags.push({ level: 'green', text: 'Verified contract (public source).' })
  if (on(security.is_proxy)) flags.push({ level: 'yellow', text: 'Proxy contract: the logic can be swapped.' })
  const owner = String(security.owner_address ?? '')
  if (owner && !/^0x0+$/.test(owner) && owner !== '0x000000000000000000000000000000000000dead') {
    flags.push({ level: 'yellow', text: 'Ownership not renounced.' })
  }
  const holders = security.holders ?? []
  const top10 = holders
    .filter(holder => !on(holder.is_contract))
    .slice(0, 10)
    .reduce((sum, holder) => sum + Number(holder.percent ?? 0) * 100, 0)
  if (top10 > 50) flags.push({ level: 'red', text: `Top 10 holders own ${pct(top10)}.` })
  else if (top10 > 30) flags.push({ level: 'yellow', text: `Top 10 holders own ${pct(top10)}.` })
  return flags
}

const verdictFor = flags => {
  const reds = flags.filter(flag => flag.level === 'red').length
  const yellows = flags.filter(flag => flag.level === 'yellow').length
  // Some signals are bad enough on their own (honeypot, rug, big bundle, vamp).
  if (reds >= 2 || flags.some(flag => flag.critical || /HONEYPOT|RUGGED/.test(flag.text))) return 'alto'
  if (reds === 1 || yellows >= 3) return 'medio'
  return 'bajo'
}

/** Top holders for the mini bubblemap (Solana, via RugCheck). */
const holderMapFromReport = report => {
  if (!report?.topHolders?.length) return null
  const pool = isPoolHolder(report.knownAccounts ?? {})
  // clusters without the LP pool; the ones that were only the pool drop out
  const networks = networkHoldings(report).filter(network => network.wallets > 0 && network.pct >= 0.1)
  return {
    holders: report.topHolders.slice(0, 20).map(holder => ({
      address: holder.owner ?? holder.address,
      pct: holder.pct ?? 0,
      insider: Boolean(holder.insider),
      pool: pool(holder),
    })),
    networks,
  }
}

/**
 * Scans a token. `fetcher` can be swapped in tests.
 * Always returns an object; each source's errors end up in `errors`.
 */
const scanToken = async (input, { fetcher = fetch, deep = true, rpc, vamps: checkVamps = true } = {}) => {
  const parsed = parseTokenInput(input)
  if (!parsed) throw new Error('Couldn\'t find a token address or a DexScreener / pump.fun link in what you pasted.')
  const errors = []
  let { chain, address } = parsed

  let pairs = []
  try {
    if (parsed.pairAddress) {
      const data = await fetchJson(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${parsed.pairAddress}`, fetcher)
      pairs = data.pairs ?? (data.pair ? [data.pair] : [])
      address = pairs[0]?.baseToken?.address ?? null
      // dexscreener.com/<chain>/<id> also works with the token's CA instead of a pair
      if (!address) {
        const byToken = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${parsed.pairAddress}`, fetcher)
        pairs = byToken.pairs ?? []
        if (pairs.length) address = parsed.pairAddress
      }
    } else {
      const data = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${address}`, fetcher)
      pairs = data.pairs ?? []
    }
  } catch (error) {
    errors.push(`DexScreener: ${error.message}`)
  }
  if (!address) throw new Error('Couldn\'t identify the token behind that pair.')
  const pair = bestPair(chain ? pairs.filter(item => item.chainId === chain) : pairs) ?? bestPair(pairs)
  if (!chain) chain = pair?.chainId ?? 'ethereum'

  // A token usually has several pools: liquidity, volume and txs are summed
  // across every pool on that chain where the token is the base asset.
  const sameToken = pairs.filter(
    item => item.chainId === chain && String(item.baseToken?.address ?? '').toLowerCase() === address.toLowerCase()
  )
  const pools = sameToken.length ? sameToken : pair ? [pair] : []
  const sum = pick => pools.reduce((total, item) => total + (Number(pick(item)) || 0), 0)
  const oldest = Math.min(...pools.map(item => item.pairCreatedAt ?? Infinity))
  const market = pair
    ? {
        dex: pair.dexId,
        priceUsd: Number(pair.priceUsd ?? 0),
        liquidityUsd: sum(item => item.liquidity?.usd),
        topPoolLiquidityUsd: pair.liquidity?.usd ?? 0,
        fdv: pair.fdv ?? pair.marketCap ?? 0,
        marketCap: pair.marketCap ?? null,
        volume24h: sum(item => item.volume?.h24),
        priceChange24h: pair.priceChange?.h24 ?? 0,
        buys24h: sum(item => item.txns?.h24?.buys),
        sells24h: sum(item => item.txns?.h24?.sells),
        ageHours: Number.isFinite(oldest) ? (Date.now() - oldest) / 3.6e6 : null,
        createdAt: Number.isFinite(oldest) ? oldest : null,
        url: pair.url,
        pools: pools.length,
        // pump.fun before migrating: DexScreener reports no liquidity (no pool yet)
        bondingCurve: pair.dexId === 'pumpfun' && !pair.liquidity?.usd,
      }
    : null
  const token = pair?.baseToken ?? {}

  const securityJob = (async () => {
    if (chain === 'solana') {
      try {
        const [report, summary] = await Promise.all([
          fetchJson(`https://api.rugcheck.xyz/v1/tokens/${address}/report`, fetcher),
          fetchJson(`https://api.rugcheck.xyz/v1/tokens/${address}/report/summary`, fetcher).catch(() => null),
        ])
        return { ...report, lpLockedPct: summary?.lpLockedPct ?? null, scoreNormalised: summary?.score_normalised ?? null }
      } catch (error) {
        errors.push(`RugCheck: ${error.message}`)
      }
    } else if (GOPLUS_CHAIN[chain]) {
      try {
        const data = await fetchJson(`https://api.gopluslabs.io/api/v1/token_security/${GOPLUS_CHAIN[chain]}?contract_addresses=${address}`, fetcher)
        return Object.values(data.result ?? {})[0] ?? null
      } catch (error) {
        errors.push(`GoPlus: ${error.message}`)
      }
    }
    return null
  })()
  const vampJob =
    checkVamps && (token.symbol || token.name)
      ? findVamps({ chain, address, symbol: token.symbol, name: token.name, createdAt: market?.createdAt, marketCap: market?.marketCap ?? market?.fdv }, { fetcher }).catch(error => {
          errors.push(`Vamp check: ${error.message}`)
          return null
        })
      : Promise.resolve(null)
  const [security, vamps] = await Promise.all([securityJob, vampJob])

  // On-chain launch read (Solana, recent tokens only: on an old token the
  // launch block doesn't tell you much anymore).
  let launch = null
  if (deep === true && chain === 'solana' && (market?.ageHours ?? 0) < 72) {
    try {
      launch = await analyzeLaunch(address, { fetcher, rpc, supplyRaw: security?.token?.supply })
    } catch (error) {
      errors.push(`Blockchain: ${error.message}`)
    }
  }
  const dev = chain === 'solana' ? devFromReport(security) : null
  // RugCheck didn't know the dev's other coins: count the creator's pump.fun coins on-chain
  if (dev) {
    const [count, activity] = await Promise.all([
      dev.launches == null ? countPumpCoins(dev.creator, { fetcher, rpc }).catch(() => null) : null,
      walletActivity(dev.creator, { fetcher, rpc }).catch(() => null),
    ])
    dev.activity = activity
    // 0 bonding curves means this coin didn't come through pump.fun's curve under this
    // wallet (PumpSwap direct, another launchpad…): unknown, NOT "first coin".
    // With 1+, this coin is one of them when it's a pump.fun coin.
    if (dev.launches == null && count > 0) {
      const pumpCoin = address.endsWith('pump') || /^pump/.test(market?.dex ?? '')
      dev.launches = pumpCoin ? count - 1 : count
      dev.source = 'pump.fun on-chain'
    }
  }
  const insiders = chain === 'solana' ? insidersFromReport(security) : null
  let socials = pair ? socialsFromPair(pair) : null
  // missing website/X/Telegram? the token's own metadata usually has them (terminals read them there)
  const metadataUri = chain === 'solana' ? security?.tokenMeta?.uri : null
  if (metadataUri && (!socials || !socials.websites.length || !socials.twitter.length)) {
    socials = mergeSocials(socials, await socialsFromMetadata(metadataUri, { fetcher }).catch(() => null))
  }

  // the post the coin is about (its X link is a tweet): what it says, or that it's gone
  const tweetUrl = socials?.twitter?.find(url => tweetId(url))
  const narrative = tweetUrl ? await readTweet(tweetUrl, { fetcher }).catch(() => null) : null

  const flags = [
    ...marketFlags(market),
    ...(chain === 'solana' ? solanaFlags(security) : evmFlags(security)),
    ...vampFlags(vamps, { symbol: token.symbol, createdAt: market?.createdAt, marketCap: market?.marketCap ?? market?.fdv }),
    ...identityFlags(address, socials, vamps),
    ...launchFlags({ launch, dev, socials, insiders }),
  ]
  // With deep: 'later' the launch is read afterwards (withLaunch) and the
  // report shows right away.
  const launchPending = deep === 'later' && chain === 'solana' && (market?.ageHours ?? 0) < 72
  return {
    chain,
    address,
    name: token.name ?? security?.tokenMeta?.name ?? security?.token_name ?? null,
    symbol: token.symbol ?? security?.tokenMeta?.symbol ?? security?.token_symbol ?? null,
    market,
    holders: chain === 'solana' ? (security?.totalHolders ?? null) : Number(security?.holder_count ?? 0) || null,
    launch: launchPending ? { status: 'pending' } : launch,
    supplyRaw: chain === 'solana' ? (security?.token?.supply ?? null) : null,
    dev,
    insiders,
    holderMap: chain === 'solana' ? holderMapFromReport(security) : null,
    narrative,
    // what the dev says the coin is (the description typed at launch)
    about: chain === 'solana' ? String(security?.fileMeta?.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 400) || null : null,
    vamps,
    socials,
    flags,
    verdict: verdictFor(flags),
    errors,
    sources: [
      'DexScreener',
      ...(chain === 'solana' ? ['RugCheck'] : GOPLUS_CHAIN[chain] ? ['GoPlus'] : []),
      ...(launch?.status === 'ok' ? ['Solana RPC'] : []),
    ],
  }
}

/** Compact facts, for the AI (desktop app). */
const factsForAi = scan => ({
  chain: scan.chain,
  address: scan.address,
  name: scan.name,
  symbol: scan.symbol,
  market: scan.market,
  verdict_by_rules: scan.verdict,
  flags: scan.flags,
  data_errors: scan.errors,
})

/**
 * Second step of the progressive scan: adds the on-chain launch read to an
 * existing scan and recomputes signals and verdict.
 */
const withLaunch = async (scan, { fetcher = fetch, rpc, known } = {}) => {
  if (scan.launch?.status !== 'pending') return scan
  let launch = known ?? null // a launch never changes: reuse one already read
  const errors = [...scan.errors]
  try {
    launch ??= await analyzeLaunch(scan.address, { fetcher, rpc, supplyRaw: scan.supplyRaw })
  } catch (error) {
    launch = { status: 'error', error: error.message }
    errors.push(`Blockchain: ${error.message}`)
  }
  // Dev signals depend on how much the dev bought at launch: redo them.
  const flags = [...scan.flags.filter(flag => flag.kind !== 'dev'), ...launchFlags({ launch, dev: scan.dev })]
  return {
    ...scan,
    launch,
    flags,
    verdict: verdictFor(flags),
    errors,
    sources: launch.status === 'ok' ? [...scan.sources, 'Solana RPC'] : scan.sources,
  }
}

module.exports = { parseTokenInput, scanToken, withLaunch, factsForAi, marketFlags, solanaFlags, evmFlags, verdictFor }
