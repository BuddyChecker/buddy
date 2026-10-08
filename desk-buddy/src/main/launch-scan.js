// Lectura on-chain del lanzamiento de un token de Solana (sin IA, sin API key):
//   · quién compró en el MISMO bloque que el creador (bundle / snipers)
//   · cuánto compró el dev al lanzar y cuánto tiene hoy (¿ya vendió?)
// Usa la RPC pública de Solana (o la que se configure, p. ej. Helius).
//
// Por qué funciona: en pump.fun el token se crea y el dev compra en la misma
// transacción; los "bundlers" meten sus compras en el mismo bloque (vía Jito)
// para quedarse con parte del suministro antes que nadie. Eso se ve en las
// primeras transacciones del token.

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com'
const MAX_PAGES = 25 // 25.000 transacciones: más que eso y el lanzamiento ya quedó muy atrás
const EARLY_TXS = 15
const PACE_MS = 110 // separación entre pedidos (límite de la RPC pública)

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// La RPC pública limita los pedidos (429): se espera y se reintenta.
const rpcCall = async (rpc, method, params, fetcher, attempt = 0) => {
  const response = await fetcher(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(20000),
  })
  if (response.status === 429 && attempt < 4) {
    await wait(1200 * (attempt + 1))
    return rpcCall(rpc, method, params, fetcher, attempt + 1)
  }
  if (!response.ok) throw new Error(`RPC responded ${response.status}`)
  const body = await response.json()
  if (body.error) throw new Error(body.error.message ?? 'RPC error')
  return body.result
}

// pump.fun: every coin has a bonding-curve account that stores its creator (bytes 49..81).
// Counting those accounts for a creator = how many pump.fun coins that wallet has made.
const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
const countPumpCoins = async (creator, { fetcher = fetch, rpc = SOLANA_RPC } = {}) => {
  if (!creator) return null
  const accounts = await rpcCall(
    rpc,
    'getProgramAccounts',
    [PUMP_PROGRAM, { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, filters: [{ memcmp: { offset: 49, bytes: creator } }] }],
    fetcher
  )
  return Array.isArray(accounts) ? accounts.length : null
}

// How a wallet behaves: a launch bot / service fires hundreds of txs per hour,
// a burner made for one coin has only a handful. One RPC call (last 1000 signatures).
const walletActivity = async (address, { fetcher = fetch, rpc = SOLANA_RPC } = {}) => {
  if (!address) return null
  const signatures = await rpcCall(rpc, 'getSignaturesForAddress', [address, { limit: 1000 }], fetcher)
  if (!Array.isArray(signatures)) return null
  const times = signatures.map(item => item.blockTime).filter(Number.isFinite)
  const hours = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 3600 : 0
  const txs = signatures.length
  const perHour = hours > 0 ? txs / hours : txs
  return { txs, hours, perHour, bot: txs >= 500 && perHour >= 25, fresh: txs < 20 }
}

const VERSION_ERROR = /Transaction version \((\d+)\)/

const getTransaction = async (rpc, signature, fetcher) => {
  try {
    return await rpcCall(rpc, 'getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }], fetcher)
  } catch (error) {
    // transacciones de versión nueva: se piden con la versión que la RPC indica
    const match = error.message.match(VERSION_ERROR)
    if (!match) throw error
    return rpcCall(rpc, 'getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: Number(match[1]) }], fetcher)
  }
}

const rawAmount = balance => Number(balance?.uiTokenAmount?.amount ?? 0)

/** Compras (aumentos de balance del token) de una transacción, por dueño. */
const buysIn = (tx, mint) => {
  const meta = tx?.meta
  if (!meta || meta.err) return []
  const pre = new Map((meta.preTokenBalances ?? []).filter(b => b.mint === mint).map(b => [b.accountIndex, rawAmount(b)]))
  return (meta.postTokenBalances ?? [])
    .filter(balance => balance.mint === mint && balance.owner)
    .map(balance => ({ owner: balance.owner, amount: rawAmount(balance) - (pre.get(balance.accountIndex) ?? 0) }))
    .filter(buy => buy.amount > 0)
}

const feePayer = tx => {
  const key = tx?.transaction?.message?.accountKeys?.[0]
  return typeof key === 'string' ? key : key?.pubkey ?? null
}

/**
 * supplyRaw: suministro total en unidades mínimas (de RugCheck o de la RPC).
 * Devuelve { status: 'ok' | 'too-many' | 'error', … }.
 */
const analyzeLaunch = async (mint, { fetcher = fetch, rpc = SOLANA_RPC, supplyRaw } = {}) => {
  const signatures = []
  let before
  let complete = false
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await rpcCall(rpc, 'getSignaturesForAddress', [mint, { limit: 1000, ...(before ? { before } : {}) }], fetcher)
    signatures.push(...batch)
    if (batch.length < 1000) {
      complete = true
      break
    }
    before = batch[batch.length - 1].signature
    await wait(PACE_MS)
  }
  if (!complete) return { status: 'too-many', transactions: signatures.length }
  // La RPC devuelve de la más nueva a la más vieja: al revés = orden cronológico.
  const chronological = signatures.filter(item => !item.err).reverse()
  if (!chronological.length) return { status: 'error', error: 'no transactions' }
  const launchSlot = chronological[0].slot
  const early = chronological.filter(item => item.slot <= launchSlot + 1).slice(0, EARLY_TXS)

  const transactions = []
  for (const item of early) {
    // de a una: la RPC pública limita los pedidos en lote
    const tx = await getTransaction(rpc, item.signature, fetcher)
    if (tx) transactions.push({ ...tx, slot: tx.slot ?? item.slot })
    await wait(PACE_MS)
  }
  const creator = feePayer(transactions[0])
  const supply = Number(supplyRaw) || 0
  const bought = new Map() // dueño → { amount, slot }
  for (const tx of transactions) {
    for (const buy of buysIn(tx, mint)) {
      // la cuenta de la curva/pool recibe casi todo el suministro al crearse: no es un comprador
      if (supply && buy.amount > supply * 0.5) continue
      const current = bought.get(buy.owner) ?? { amount: 0, slot: tx.slot }
      bought.set(buy.owner, { amount: current.amount + buy.amount, slot: Math.min(current.slot, tx.slot) })
    }
  }
  const sameBlock = [...bought].filter(([owner, buy]) => buy.slot === launchSlot && owner !== creator)
  const nextBlock = [...bought].filter(([owner, buy]) => buy.slot === launchSlot + 1 && owner !== creator)
  const share = list => (supply ? (list.reduce((sum, [, buy]) => sum + buy.amount, 0) / supply) * 100 : null)
  const devBuy = bought.get(creator)?.amount ?? 0
  return {
    status: 'ok',
    creator,
    launchSlot,
    launchTime: chronological[0].blockTime ?? null,
    transactions: signatures.length,
    sameBlockWallets: sameBlock.length,
    sameBlockPct: share(sameBlock),
    // who they are: crossed later with the current holders ("still holding")
    sameBlockOwners: sameBlock.map(([owner]) => owner),
    nextBlockOwners: nextBlock.map(([owner]) => owner),
    nextBlockWallets: nextBlock.length,
    nextBlockPct: share(nextBlock),
    devBuyPct: supply ? (devBuy / supply) * 100 : null,
  }
}

const pct = value => `${Number(value).toFixed(value < 10 ? 1 : 0)}%`

/** Launch, dev, insider and socials signals, in plain trader words. */
const launchFlags = ({ launch, dev, socials, insiders }) => {
  const flags = []
  if (launch?.status === 'ok') {
    const wallets = launch.sameBlockWallets
    const share = launch.sameBlockPct ?? 0
    if ((wallets >= 3 && share >= 5) || share >= 15) {
      flags.push({
        level: 'red',
        kind: 'launch',
        critical: share >= 20, // a bundle holding over 1/5 of supply is high risk on its own
        text:
          wallets === 1
            ? `1 wallet sniped ${pct(share)} in the launch block: sniper or dev bundle.`
            : `Bundled: ${wallets} wallets bought in the dev's launch block and took ${pct(share)}.`,
      })
    } else if (wallets >= 1) {
      flags.push({ level: 'yellow', kind: 'launch', text: `${wallets} wallet${wallets > 1 ? 's' : ''} bought alongside the dev in the launch block (${pct(share)}).` })
    } else {
      flags.push({ level: 'green', kind: 'launch', text: 'Clean launch: nobody else bought in the dev\'s block.' })
    }
    if (launch.nextBlockWallets >= 5 && (launch.nextBlockPct ?? 0) >= 10) {
      flags.push({ level: 'yellow', kind: 'launch', text: `${launch.nextBlockWallets} snipers in the next block hold ${pct(launch.nextBlockPct)}.` })
    }
  }
  if (dev && typeof dev.pct === 'number') {
    const bought = launch?.status === 'ok' ? (launch.devBuyPct ?? 0) : 0
    if (dev.pct >= 10) flags.push({ level: 'yellow', kind: 'dev', text: `Dev still holds ${pct(dev.pct)} of supply: could dump anytime.` })
    else if (bought >= 5 && dev.pct < bought * 0.2) {
      flags.push({ level: 'yellow', kind: 'dev', text: `Dev bought ${pct(bought)} at launch and already sold almost all of it (${pct(dev.pct)} left).` })
    } else if (dev.pct < 3) flags.push({ level: 'green', kind: 'dev', text: `Dev holds little (${pct(dev.pct)}).` })
  }
  if (insiders && insiders.wallets >= 5 && insiders.pct >= 5) {
    flags.push({ level: 'red', kind: 'insiders', text: `Insider cluster: ${insiders.wallets} linked wallets hold ${pct(insiders.pct)} of supply.` })
  }
  if (socials) {
    const count = socials.websites.length + socials.twitter.length + socials.telegram.length
    if (!count) flags.push({ level: 'yellow', kind: 'socials', text: 'No website or socials listed.' })
    else if (socials.twitter.length && socials.websites.length) flags.push({ level: 'green', kind: 'socials', text: 'Website and X listed.' })
  }
  return flags
}

/** Web y redes que el proyecto registró en DexScreener. */
const socialsFromPair = pair => {
  const info = pair?.info ?? {}
  const socials = info.socials ?? []
  const url = item => item.url ?? (item.handle ? `https://x.com/${item.handle}` : null)
  return {
    websites: (info.websites ?? []).map(item => item.url).filter(Boolean),
    twitter: socials.filter(item => /twitter|x/i.test(item.type ?? item.platform ?? '')).map(url).filter(Boolean),
    telegram: socials.filter(item => /telegram/i.test(item.type ?? item.platform ?? '')).map(url).filter(Boolean),
  }
}

// The token's own metadata (what the dev filled in on pump.fun & co): website, X, Telegram.
// DexScreener only lists socials for paid profiles; terminals read them from here.
const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/'
const metadataUrl = raw => {
  const text = String(raw ?? '').trim()
  if (text.startsWith('ipfs://')) return IPFS_GATEWAY + text.slice(7).replace(/^ipfs\//, '')
  let url
  try {
    url = new URL(text)
  } catch {
    return null
  }
  // only public https hosts: the URI is chosen by the dev, never let it point inside a network
  if (url.protocol !== 'https:' || /^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(url.hostname)) return null
  // ipfs.io moved to a service-worker-only gateway: same CID, another gateway
  if (url.hostname === 'ipfs.io' && url.pathname.startsWith('/ipfs/')) return IPFS_GATEWAY + url.pathname.slice(6)
  return url.href
}
const httpUrl = value => {
  try {
    const url = new URL(String(value).trim())
    return /^https?:$/.test(url.protocol) ? url.href : null
  } catch {
    return null
  }
}
const socialsFromMetadata = async (uri, { fetcher = fetch } = {}) => {
  const url = metadataUrl(uri)
  if (!url) return null
  const response = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) })
  if (!response.ok) return null
  const meta = await response.json()
  const extra = meta?.extensions ?? {}
  const pick = (...values) => values.find(value => typeof value === 'string' && value.trim()) ?? null
  const website = httpUrl(pick(meta?.website, extra.website))
  const xRaw = pick(meta?.twitter, meta?.x, extra.twitter, extra.x)
  const twitter = xRaw ? httpUrl(xRaw) ?? (/^@?\w{1,15}$/.test(xRaw) ? `https://x.com/${xRaw.replace(/^@/, '')}` : null) : null
  const telegram = httpUrl(pick(meta?.telegram, extra.telegram))
  return {
    websites: website ? [website] : [],
    twitter: twitter ? [twitter] : [],
    telegram: telegram ? [telegram] : [],
    launchpad: httpUrl(meta?.createdOn) ? new URL(meta.createdOn).hostname : null,
  }
}
// The tweet a memecoin is built on (its X link points to a post): read its text through
// X's public embed endpoint (the one tweet widgets use). Free, no key.
const tweetId = url => String(url ?? '').match(/(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d{5,25})/i)?.[1] ?? null
const embedToken = id => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')
const readTweet = async (url, { fetcher = fetch } = {}) => {
  const id = tweetId(url)
  if (!id) return null
  const response = await fetcher(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${embedToken(id)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  })
  if (!response.ok) return null
  const tweet = await response.json().catch(() => null)
  // only X saying so counts as "gone" (an empty answer is just unknown)
  if (tweet?.__typename === 'TweetTombstone') {
    const reason = String(tweet.tombstone?.text?.text ?? '').replace(/\s*Learn more\.?$/i, '').trim()
    return { url, gone: true, deleted: /deleted/i.test(reason), reason: reason || null }
  }
  if (!tweet?.text) return null
  const text = tweet.text.replace(/https:\/\/t\.co\/\w+/g, '').replace(/\s+/g, ' ').trim()
  return { url, gone: false, text, user: tweet.user?.screen_name ?? null, likes: tweet.favorite_count ?? null, createdAt: Date.parse(tweet.created_at) || null }
}

/** DexScreener first; the token metadata fills whatever is missing. */
const mergeSocials = (base, meta) => {
  if (!meta) return base
  const from = base ?? { websites: [], twitter: [], telegram: [] }
  const merged = {
    websites: from.websites.length ? from.websites : meta.websites,
    twitter: from.twitter.length ? from.twitter : meta.twitter,
    telegram: from.telegram.length ? from.telegram : meta.telegram,
  }
  if (meta.launchpad) merged.launchpad = meta.launchpad
  return merged
}

/** Dev y redes de insiders a partir del reporte de RugCheck. */
const devFromReport = report => {
  const supply = Number(report?.token?.supply ?? 0)
  if (!report?.creator || !supply) return null
  // the dev's other launches (RugCheck): a serial launcher whose coins all died is a red flag
  // RugCheck sends null when it doesn't know the dev's other coins: that's "unknown", not zero
  const known = Array.isArray(report.creatorTokens)
  const others = (report.creatorTokens ?? []).filter(token => token?.mint && token.mint !== report.mint)
  const caps = others.map(token => Number(token.marketCap) || 0)
  return {
    creator: report.creator,
    pct: (Number(report.creatorBalance ?? 0) / supply) * 100,
    launches: known ? others.length : null,
    bestMarketCap: caps.length ? Math.max(...caps) : null,
    over100k: caps.filter(cap => cap >= 100_000).length,
    ruggedBefore: (report.risks ?? []).some(risk => /history of rug/i.test(risk.name ?? '')),
  }
}

/** Known pools / AMMs / lockers: that liquidity isn't one person. */
const isPoolHolder = known => holder => {
  const tag = known[holder.owner] ?? known[holder.address]
  return Boolean(tag && /amm|pool|lp|locker|market|burn|curve/i.test(`${tag.type ?? ''} ${tag.name ?? ''}`))
}

/**
 * RugCheck's insider networks sometimes include the LP pool (a wallet that sent
 * tokens to the pool gets "linked" to it). The pool isn't an insider: take it out.
 */
const networkHoldings = report => {
  const supply = Number(report?.token?.supply ?? 0)
  const networks = report?.insiderNetworks ?? []
  if (!supply || !networks.length) return []
  const pools = (report.topHolders ?? [])
    .filter(isPoolHolder(report.knownAccounts ?? {}))
    .map(holder => holder.pct ?? 0)
    .filter(value => value >= 1)
    .sort((a, b) => b - a)
  return networks.map(network => {
    let pct = ((network.currentHolding ?? 0) / supply) * 100
    let wallets = network.activeAccounts ?? network.size ?? 0
    let pool = 0
    for (const value of pools) {
      if (pct >= value - 0.05) {
        pct -= value
        pool += value
        wallets -= 1
      }
    }
    return { wallets: Math.max(0, wallets), pct: Math.max(0, pct), poolPct: pool, type: network.type ?? null }
  })
}

const insidersFromReport = report => {
  const networks = networkHoldings(report)
  if (!networks.length) return null
  const biggest = networks.reduce((best, item) => (item.pct > best.pct ? item : best))
  return { wallets: biggest.wallets, pct: biggest.pct, networks: networks.length }
}

module.exports = { readTweet, tweetId, walletActivity, countPumpCoins, analyzeLaunch, launchFlags, socialsFromPair, socialsFromMetadata, mergeSocials, metadataUrl, devFromReport, insidersFromReport, networkHoldings, isPoolHolder, SOLANA_RPC }
