// The buddy's memory: it learns from what happened to the tokens it has seen.
//
// 1. Every scanned token leaves a snapshot: its price/liquidity then, and the signals it had
//    (big dump risk, dev bundle, bot dev, deleted tweet, vamp…).
// 2. An hour later (and a day later) the background checks what happened: rug, dump, moon, flat.
// 3. When you open a new token, the buddy looks for past tokens with the same signals and says
//    how they ended ("Seen 14 like this: 9 rugged within 1h").
// 4. It also remembers wallets: devs and bundle wallets that were in rugs it saw.
//
// Pure functions + a tiny key/value store interface ({ get(key), set(key, value) }), so it's
// tested in node and backed by chrome.storage.local in the extension. Nothing leaves the PC.

import { dumpImpact, poolShare, riskyHolding } from './edge.js'

export const MAX_SNAPSHOTS = 3000
const HOUR = 3.6e6

/** The signals that matter for "how did tokens like this end?" (most telling first). */
export const signalTags = scan => {
  const tags = []
  const risky = riskyHolding(scan)
  const impact = risky ? dumpImpact(risky.pct, poolShare(scan)) : null
  if (impact != null && impact >= 50) tags.push('dump-high')
  else if (impact != null && impact >= 20) tags.push('dump-mid')
  if (scan.flags?.some(flag => flag.kind === 'vamp' && flag.level === 'red')) tags.push('vamp')
  if (scan.dev?.ruggedBefore) tags.push('dev-rugged')
  if (scan.dev?.activity?.bot) tags.push('dev-bot')
  else if (scan.dev?.activity?.fresh) tags.push('dev-fresh')
  if (scan.launch?.status === 'ok' && scan.launch.sameBlockWallets >= 3) tags.push('bundled')
  if (scan.narrative?.gone) tags.push('tweet-gone')
  const cluster = scan.holderMap?.networks?.reduce((best, item) => Math.max(best, item.pct ?? 0), 0) ?? 0
  if (cluster >= 5) tags.push('linked')
  if (!scan.socials?.websites?.length && !scan.socials?.twitter?.length) tags.push('no-socials')
  if (!tags.length) tags.push('clean')
  return tags
}

// Narratives: the words in names/tickers that keep coming back across different launches.
const STOP = new Set(['the', 'and', 'for', 'coin', 'token', 'sol', 'solana', 'pump', 'fun', 'official', 'inu', 'meme', 'with', 'from', 'this', 'that', 'you', 'your', 'are', 'not', 'new', 'just'])
export const themeWords = scan =>
  [...new Set(`${scan.name ?? ''} ${scan.symbol ?? ''}`.toLowerCase().split(/[^a-z]+/).filter(word => word.length >= 3 && !STOP.has(word)))].slice(0, 6)

/** word → number of different tokens using it, among launches seen in the last 2 hours. */
export const narrativeHeat = (list, now = Date.now(), windowMs = 2 * HOUR) => {
  const heat = new Map()
  for (const item of list) {
    if (now - item.at > windowMs) continue
    for (const word of item.words ?? []) heat.set(word, (heat.get(word) ?? 0) + 1)
  }
  return heat
}

/** Is this token riding a narrative that's hot right now? (3+ other launches with the same word) */
export const trendRow = (scan, heat) => {
  let best = null
  for (const word of themeWords(scan)) {
    const count = (heat.get(word) ?? 0) - 1 // not counting itself
    if (count >= 3 && (!best || count > best.count)) best = { word, count }
  }
  if (!best) return null
  return {
    key: 'trend',
    label: 'Narrative',
    value: `Hot: "${best.word}" (${best.count} other launches in 2h)`,
    chip: `Hot narrative: "${best.word}" (${best.count} launches in 2h)`,
    level: 'info',
  }
}

/** Snapshot of a token right now (what we compare against later). */
export const snapshotOf = (scan, now = Date.now()) => ({
  address: scan.address,
  chain: scan.chain,
  symbol: scan.symbol ?? null,
  at: now,
  priceUsd: scan.market?.priceUsd ?? null,
  liquidityUsd: scan.market?.liquidityUsd ?? null,
  marketCap: scan.market?.marketCap ?? null,
  ageHours: scan.market?.ageHours ?? null,
  tags: signalTags(scan),
  words: themeWords(scan),
  dev: scan.dev?.creator ?? null,
  bundle: scan.launch?.status === 'ok' ? (scan.launch.sameBlockOwners ?? []).slice(0, 20) : [],
  outcome1h: null,
  outcome24h: null,
})

/**
 * What happened between then and now. Pump.fun coins on the curve have no liquidity number,
 * so price carries the call there.
 *   rug  : liquidity pulled (-80%) or price -90%
 *   dump : price -60% or worse
 *   moon : price 2x or more
 *   flat : anything else
 */
export const outcomeOf = (snapshot, live) => {
  if (!live) return 'rug' // no pool left on DexScreener at all
  const price = snapshot.priceUsd > 0 && live.priceUsd > 0 ? live.priceUsd / snapshot.priceUsd : null
  const liquidity = snapshot.liquidityUsd > 0 && live.liquidityUsd != null ? live.liquidityUsd / snapshot.liquidityUsd : null
  if ((liquidity != null && liquidity < 0.2) || (price != null && price < 0.1)) return 'rug'
  if (price != null && price < 0.4) return 'dump'
  if (price != null && price >= 2) return 'moon'
  return 'flat'
}

/** Keep one snapshot per token (the first time we saw it), newest first, capped. */
export const remember = async (store, scan, now = Date.now()) => {
  if (!scan?.address || !scan.market) return null
  const list = (await store.get('mem:snapshots')) ?? []
  if (list.some(item => item.address === scan.address)) return null
  const snapshot = snapshotOf(scan, now)
  list.unshift(snapshot)
  await store.set('mem:snapshots', list.slice(0, MAX_SNAPSHOTS))
  return snapshot
}

/** Snapshots that are due for a check (1h and 24h after they were taken). */
export const dueForCheck = (list, now = Date.now()) =>
  list.filter(item => (item.outcome1h == null && now - item.at >= HOUR) || (item.outcome24h == null && now - item.at >= 24 * HOUR))

/**
 * Write outcomes for the due snapshots, given live numbers by address, and update the
 * wallet memory (devs and bundle wallets that ended in a rug).
 */
export const settleOutcomes = async (store, liveByAddress, now = Date.now()) => {
  const list = (await store.get('mem:snapshots')) ?? []
  const wallets = (await store.get('mem:wallets')) ?? {}
  let settled = 0
  for (const item of dueForCheck(list, now)) {
    if (!(item.address in liveByAddress)) continue
    const outcome = outcomeOf(item, liveByAddress[item.address])
    if (item.outcome1h == null) item.outcome1h = outcome
    else item.outcome24h = outcome
    settled += 1
    if (outcome === 'rug') {
      // remember who was behind it
      const mark = (wallet, role) => {
        if (!wallet) return
        const entry = (wallets[wallet] ??= { dev: 0, bundle: 0, tokens: [] })
        if (entry.tokens.includes(item.address)) return
        entry[role] += 1
        entry.tokens = [item.address, ...entry.tokens].slice(0, 10)
        entry.lastSymbol = item.symbol
        entry.lastAt = now
      }
      mark(item.dev, 'dev')
      for (const wallet of item.bundle) mark(wallet, 'bundle')
    }
  }
  await store.set('mem:snapshots', list)
  await store.set('mem:wallets', wallets)
  return settled
}

/**
 * How past tokens with the same main signals ended. A past token counts as "like this"
 * when it shares the current token's two most telling tags.
 */
export const similarOutcomes = (list, tags, { exclude } = {}) => {
  const key = tags.slice(0, 2)
  const alike = list.filter(item => item.address !== exclude && item.outcome1h && key.every(tag => item.tags.includes(tag)))
  const count = outcome => alike.filter(item => (item.outcome24h ?? item.outcome1h) === outcome).length
  return { n: alike.length, rug: count('rug'), dump: count('dump'), moon: count('moon'), flat: count('flat'), key }
}

/** What the wallet memory knows about this token's dev and bundle wallets. */
export const walletRecord = (wallets, scan) => {
  const dev = scan.dev?.creator ? wallets[scan.dev.creator] : null
  const owners = scan.launch?.status === 'ok' ? scan.launch.sameBlockOwners ?? [] : []
  const bundleInRugs = owners.filter(wallet => wallets[wallet]?.bundle || wallets[wallet]?.dev)
  return {
    devRugs: dev ? dev.dev + dev.bundle : 0,
    devLastSymbol: dev?.lastSymbol ?? null,
    bundleWalletsInRugs: bundleInRugs.length,
    bundleRugs: bundleInRugs.reduce((sum, wallet) => sum + wallets[wallet].tokens.length, 0),
  }
}

const TAG_WORDS = {
  'dump-high': 'big dump risk',
  'dump-mid': 'dump risk',
  vamp: 'vamp',
  'dev-rugged': 'dev with rugs',
  'dev-bot': 'bot dev',
  'dev-fresh': 'fresh dev wallet',
  bundled: 'dev bundle',
  'tweet-gone': 'deleted tweet',
  linked: 'linked wallets',
  'no-socials': 'no socials',
  clean: 'clean read',
}

/** The quick-card row for the memory (null until there's enough history to say something). */
export const memoryRow = ({ stats, record }) => {
  if (record?.devRugs) {
    return {
      key: 'memory',
      label: 'Buddy memory',
      value: `This dev was behind ${record.devRugs} rug${record.devRugs === 1 ? '' : 's'} you saw${record.devLastSymbol ? ` ($${record.devLastSymbol})` : ''}`,
      chip: `Dev already rugged $${record.devLastSymbol ?? 'a coin'} you saw`,
      level: 'red',
    }
  }
  if (record?.bundleWalletsInRugs) {
    return {
      key: 'memory',
      label: 'Buddy memory',
      value: `${record.bundleWalletsInRugs} bundle wallet${record.bundleWalletsInRugs === 1 ? ' was' : 's were'} in rugs you saw`,
      chip: `Bundle wallets from past rugs (${record.bundleWalletsInRugs})`,
      level: 'red',
    }
  }
  if (!stats || stats.n < 5) return null
  const pct = value => Math.round((value / stats.n) * 100)
  const bad = stats.rug + stats.dump
  const words = stats.key.map(tag => TAG_WORDS[tag] ?? tag).join(' + ')
  if (bad / stats.n >= 0.5) {
    return { key: 'memory', label: 'Buddy memory', value: `${pct(bad)}% of ${stats.n} like this (${words}) rugged or dumped`, chip: `${pct(bad)}% like this rugged or dumped`, level: 'red' }
  }
  if (stats.moon / stats.n >= 0.3) {
    return { key: 'memory', label: 'Buddy memory', value: `${pct(stats.moon)}% of ${stats.n} like this (${words}) did 2x+`, chip: `${pct(stats.moon)}% like this did 2x+`, level: 'green' }
  }
  return { key: 'memory', label: 'Buddy memory', value: `${stats.n} like this (${words}): mixed results`, chip: null, level: 'yellow' }
}

/**
 * The day in one message: what the buddy saw in the last 24h and how it ended, and whether
 * its red flags were right (tokens with a big dump risk / bundle / rugger dev that rugged).
 */
export const dailySummary = (list, now = Date.now()) => {
  const day = list.filter(item => now - item.at <= 24 * HOUR)
  const settled = day.filter(item => item.outcome1h)
  if (!day.length) return null
  const end = item => item.outcome24h ?? item.outcome1h
  const count = outcome => settled.filter(item => end(item) === outcome).length
  const flagged = settled.filter(item => item.tags.some(tag => ['dump-high', 'bundled', 'dev-rugged', 'vamp', 'tweet-gone'].includes(tag)))
  const flaggedBad = flagged.filter(item => ['rug', 'dump'].includes(end(item))).length
  const lines = [
    `Saw ${day.length} token${day.length === 1 ? '' : 's'} today (${settled.length} with a result).`,
    settled.length ? `Rugged ${count('rug')} · dumped ${count('dump')} · 2x+ ${count('moon')} · flat ${count('flat')}.` : null,
    flagged.length ? `Red flags were right ${flaggedBad}/${flagged.length} times (${Math.round((flaggedBad / flagged.length) * 100)}%).` : null,
  ]
  return lines.filter(Boolean).join('\n')
}
