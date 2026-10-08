// "Edge": the few things trading terminals DON'T show you, one short line each.
// Axiom/GMGN/Padre already show top 10, dev holding, snipers, bundles %, mint/freeze…
// so the quick card only carries what's ours: vamp, the dev's wallets still inside,
// the dev's track record, linked wallets (LP out), the website and the ATH.

import { twinsRead } from './twins.js'

// Thin line icons (currentColor), instead of emojis.
const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
export const ICONS = {
  vamp: svg('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>'),
  devWallets: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.5 14.2c2.3.2 4 1.7 4.5 4.3"/>'),
  devHistory: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/><path d="M12 8v4.5l3 1.8"/>'),
  linked: svg('<circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="6" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M8.3 10.8l7.4-3.6M8.3 13.2l7.4 3.6"/>'),
  site: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.5 5.4 3.5 8.5s-1.1 5.9-3.5 8.5c-2.4-2.6-3.5-5.4-3.5-8.5s1.1-5.9 3.5-8.5z"/>'),
  ath: svg('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
  launch: svg('<path d="M5 19l4-1 10-10a2.8 2.8 0 0 0-4-4L5 14l-1 4z"/><path d="M13.5 5.5l4 4"/>'),
  signals: svg('<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>'),
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z"/></svg>',
  memory: svg('<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3h1V4z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3h-1V4z"/>'),
  trend: svg('<path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.5.6-2.6 1.4-3.4.2 1.4 1 2.2 1.9 2.4C10.7 8 11 5.5 12 3z"/><path d="M9 18.5h6"/>'),
  watch: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
  you: svg('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.7-3.8 3.4-6 7-6s6.3 2.2 7 6"/>'),
  dump: svg('<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>'),
  brain: svg('<path d="M9.5 4a3 3 0 0 0-3 3v.3A3 3 0 0 0 5 12a3 3 0 0 0 1.5 4.7V17a3 3 0 0 0 6 0V4.6A3 3 0 0 0 9.5 4z"/><path d="M14.5 4a3 3 0 0 1 3 3v.3A3 3 0 0 1 19 12a3 3 0 0 1-1.5 4.7V17a3 3 0 0 1-6 0"/>'),
  twins: svg('<path d="M12 4v16M5 20h14"/><path d="M4 8h16"/><path d="M4 8l-2.5 6a3 3 0 0 0 5 0L4 8zM20 8l-2.5 6a3 3 0 0 0 5 0L20 8z"/>'),
  about: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="0.6" fill="currentColor"/>'),
}

// Links that are not a project website: big platforms (x.com, t.me, youtube…), link pages, launchpads.
const PLATFORMS = /(^|\.)(x\.com|twitter\.com|t\.me|telegram\.me|youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|reddit\.com|discord\.(gg|com)|linktr\.ee|github\.com|medium\.com|docs\.google\.com|google\.com|pump\.fun|dexscreener\.com|wikipedia\.org)$/i
export const isPlatformLink = url => {
  try {
    return PLATFORMS.test(new URL(url).hostname)
  } catch {
    return false
  }
}
const hostOf = url => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const money = value =>
  value == null || !Number.isFinite(value)
    ? '—'
    : value >= 1e9
      ? `$${(value / 1e9).toFixed(1)}B`
      : value >= 1e6
        ? `$${(value / 1e6).toFixed(1)}M`
        : value >= 1e3
          ? `$${(value / 1e3).toFixed(value >= 1e5 ? 0 : 1)}k`
          : `$${Math.round(value)}`
const pct = value => (value == null ? '—' : `${Number(value).toFixed(value < 10 ? 1 : 0)}%`)

// ---------------------------------------------------------------------------------
// Dump risk: how much of the supply sits with wallets that can dump on you (the dev's
// bundle still holding, the dev, the biggest insider cluster) and what selling it into
// the pool would do to the price. Same math as the AMM: selling D tokens into a pool
// holding X tokens leaves the price at (X / (X + D))^2.
// ---------------------------------------------------------------------------------
export const riskyHolding = scan => {
  const holders = scan.holderMap?.holders ?? []
  const launch = scan.launch?.status === 'ok' ? scan.launch : null
  const owners = new Set(launch?.sameBlockOwners ?? [])
  const bundle = holders.filter(holder => owners.has(holder.address) && holder.pct >= 0.05).reduce((sum, holder) => sum + holder.pct, 0)
  const devHolder = holders.find(holder => holder.address === scan.dev?.creator || holder.address === launch?.creator)
  const dev = devHolder?.pct ?? (scan.dev?.pct >= 0.05 ? scan.dev.pct : 0)
  const networks = scan.holderMap?.networks ?? []
  const cluster = networks.reduce((best, item) => Math.max(best, item.pct ?? 0), 0)
  // the cluster can include the bundle and the dev: take the bigger picture, never add both
  const insiders = bundle + dev
  if (!holders.length && !networks.length) return null
  const pct = Math.max(insiders, cluster)
  const who = pct === 0 ? 'Insiders' : insiders >= cluster ? (bundle && dev ? 'Bundle + dev' : bundle ? 'Bundle wallets' : 'Dev') : 'Linked wallets'
  return { pct, who, bundle, dev, cluster }
}
export const poolShare = scan => (scan.holderMap?.holders ?? []).filter(holder => holder.pool).reduce((sum, holder) => sum + holder.pct, 0)
export const dumpImpact = (risky, pool) => (pool > 0 && risky > 0 ? (1 - (pool / (pool + risky)) ** 2) * 100 : null)

/**
 * The dump risk as a signal of the scan itself, so the risk light (buddy, icon, report) reflects
 * it: a sell by the bundle/dev/cluster that would cut the price by half or more is high risk.
 */
export const withDumpRisk = (scan, verdictFor) => {
  const flags = (scan.flags ?? []).filter(flag => flag.kind !== 'dump')
  const risky = riskyHolding(scan)
  const impact = risky && risky.pct >= 1 ? dumpImpact(risky.pct, poolShare(scan)) : null
  if (impact != null && impact >= 20) {
    flags.unshift({
      level: impact >= 50 ? 'red' : 'yellow',
      kind: 'dump',
      critical: impact >= 50,
      text: `${risky.who} hold ${pct(risky.pct)}: if they sell, price ≈-${impact.toFixed(0)}%.`,
    })
  }
  return { ...scan, flags, verdict: verdictFor(flags) }
}

const dumpRow = scan => {
  const risky = riskyHolding(scan)
  if (!risky) return null
  const pool = poolShare(scan)
  if (risky.pct < 1) return { key: 'dump', label: 'Dump risk', value: 'Insiders hold under 1%', level: 'green', target: 'bubbles' }
  const impact = dumpImpact(risky.pct, pool)
  if (impact == null) return null
  const level = impact >= 50 ? 'red' : impact >= 20 ? 'yellow' : 'green'
  return {
    key: 'dump',
    label: 'Dump risk',
    value: `${risky.who} hold ${pct(risky.pct)} · sell = ≈-${impact.toFixed(0)}%`,
    chip: `If ${risky.who.toLowerCase()} sell: ≈-${impact.toFixed(0)}%`,
    level,
    target: risky.who === 'Linked wallets' ? 'bubbles' : 'launch',
    impact,
    risky,
  }
}

// "About": what the coin is, in a few words. The dev's own description first, then the
// tweet it's built on, then what its real website says. A deleted tweet is news.
const shorten = (text, words = 14) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  const first = clean.split(/(?<=[.!?])\s/)[0]
  const list = first.split(' ')
  return list.length > words ? `${list.slice(0, words).join(' ')}…` : first
}
// tweets read better without links, leading @mentions and trailing #hashtags
const cleanTweet = text =>
  String(text ?? '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^(@\w+\s+)+/, '')
    .replace(/(\s#\w+)+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
const sameAsName = (text, scan) => {
  const norm = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const t = norm(text)
  return !t || t === norm(scan.name) || t === norm(scan.symbol) || t.length < 6
}
const aboutRow = (scan, site) => {
  const tweet = scan.narrative
  if (tweet?.gone) {
    const value = tweet.deleted ? 'Its tweet was deleted by the author' : 'Its tweet is gone'
    return { key: 'about', label: 'About', value, chip: value, level: 'yellow', target: 'site' }
  }
  const realSite = site && site !== 'pending' && site.ok !== false
  const candidates = [
    scan.about,
    tweet?.text ? `${tweet.user ? `@${tweet.user}: ` : ''}${cleanTweet(tweet.text)}` : null,
    realSite ? site.description : null,
    realSite ? site.heading : null,
    realSite ? site.title : null,
  ]
  const text = candidates.find(item => item && !sameAsName(item, scan))
  if (!text) return null
  const value = shorten(text)
  return { key: 'about', label: 'About', value, chip: value, level: 'info', target: 'site' }
}

const vampRow = scan => {
  const vamps = scan.vamps
  if (!vamps) return null
  const flag = scan.flags.find(item => item.kind === 'vamp')
  const og = vamps.bigger ?? vamps.og
  const race = flag?.race ? vamps.race : null
  if (race) {
    const lead = race.leader
    const value =
      flag.level === 'red'
        ? `Lost the race · money on ${lead.address.slice(0, 4)}… (${money(lead.marketCap)})`
        : flag.level === 'yellow'
          ? `Race: #${race.rank} of ${race.count} · top ${money(lead.marketCap)}`
          : `Leading ${race.count} same-name coins`
    return { key: 'vamp', label: 'Vamp', value, level: flag.level, target: 'vamp', race: true }
  }
  if (flag?.level === 'red') {
    return { key: 'vamp', label: 'Vamp', value: `COPY · OG at ${money(og?.marketCap)}`, level: 'red', target: 'vamp' }
  }
  if (flag && /Twin launch/.test(flag.text)) {
    return { key: 'vamp', label: 'Vamp', value: 'Twin launch · check the CA', level: 'yellow', target: 'vamp' }
  }
  if (!vamps.earlierCount) {
    return {
      key: 'vamp',
      label: 'Vamp',
      value: vamps.copies
        ? `OG ✓ · ${vamps.copies} cop${vamps.copies === 1 ? 'y' : 'ies'}`
        : vamps.tickerOnly
          ? `No vamps · ${vamps.tickerOnly} other project${vamps.tickerOnly === 1 ? '' : 's'} share the ticker`
          : 'Unique ticker',
      level: 'green',
      target: 'vamp',
    }
  }
  return { key: 'vamp', label: 'Vamp', value: 'Only old lookalikes, all dead', level: 'green', target: 'vamp' }
}

/** What separates this coin from its same-name twins (model, borrowed page). */
const twinsRow = (scan, site, twins) => {
  if (!scan.vamps?.race) return null
  if (!twins) return { key: 'twins', label: "What's different", value: 'Reading the twins…', level: 'muted', target: 'vamp' }
  const read = twinsRead(scan, site, twins)
  return read ? { key: 'twins', label: "What's different", value: read.value, level: read.level, chip: read.chip, text: read.text, target: 'vamp' } : null
}

/** Wallets that bought with the dev at launch, and how much they (and the dev) still hold now. */
const devWalletsRow = scan => {
  const launch = scan.launch
  if (launch === 'pending' || launch?.status === 'pending') {
    return { key: 'devWallets', label: 'Dev wallets', value: 'Reading the launch…', level: 'muted' }
  }
  if (!launch || launch.status !== 'ok') return null
  const owners = new Set([...(launch.sameBlockOwners ?? []), launch.creator].filter(Boolean))
  const holders = scan.holderMap?.holders ?? []
  // dust doesn't count as "still holding"
  const inside = holders.filter(holder => owners.has(holder.address) && holder.pct >= 0.05)
  const stillPct = inside.reduce((sum, holder) => sum + holder.pct, 0)
  const bought = launch.sameBlockWallets ?? 0
  if (!bought) {
    const devPct = scan.dev?.pct
    return { key: 'devWallets', label: 'Dev wallets', value: `Clean launch${devPct != null ? ` · dev holds ${pct(devPct)}` : ''}`, level: 'green', target: 'launch' }
  }
  // the launch read is recent enough to know the wallets: say how many are still inside
  const still = !launch.sameBlockOwners ? `took ${pct(launch.sameBlockPct)}` : inside.length ? `${inside.length} still hold ${pct(stillPct)}` : 'all sold'
  const level = stillPct >= 10 || (!launch.sameBlockOwners && launch.sameBlockPct >= 20) ? 'red' : stillPct >= 3 || bought >= 3 ? 'yellow' : 'green'
  return { key: 'devWallets', label: 'Dev wallets', value: `${bought} bought with dev · ${still}`, level, target: 'launch' }
}

const devHistoryRow = scan => {
  const dev = scan.dev
  if (!dev) return null
  const row = (value, level, chip) => ({ key: 'devHistory', label: 'Dev history', value, level, chip })
  const n = dev.launches
  const coins = count => `${count} coin${count === 1 ? '' : 's'}`
  if (dev.ruggedBefore) return row(n ? `Rugged before · ${coins(n)} before` : 'Rugged before', 'red', 'Dev rugged before')
  // a launch bot / service wallet: terminals show its thousands of coins as "dev tokens"
  const activity = dev.activity
  if (activity?.bot) {
    return row('Bot / launch service wallet', 'yellow', 'Dev wallet is a bot')
  }
  // the coin was created by one wallet but deployed (signed and paid) by another
  const viaOther = scan.launch?.status === 'ok' && scan.launch.creator && dev.creator && scan.launch.creator !== dev.creator
  const extras = [activity?.fresh ? 'fresh wallet' : null, viaOther ? 'deployed by another wallet' : null].filter(Boolean)
  const tail = extras.length ? ` · ${extras.join(' · ')}` : ''
  if (n == null) {
    // history unknown: only say what we know for sure (a burner wallet is worth saying)
    return activity?.fresh ? row(`Fresh wallet${viaOther ? ' · deployed by another wallet' : ''}`, 'yellow', 'Fresh dev wallet') : null
  }
  if (n === 0) return row(`First coin from this dev${tail}`, extras.length ? 'yellow' : 'green', extras.length ? `Dev's 1st coin, ${extras[0]}` : "Dev's first coin")
  const serial = n >= 5 && !dev.over100k
  return row(`${coins(n)} before · best ${money(dev.bestMarketCap)}`, serial ? 'red' : dev.over100k ? 'green' : 'yellow', `Dev: ${coins(n)} before, best ${money(dev.bestMarketCap)}`)
}

const linkedRow = scan => {
  const networks = scan.holderMap?.networks
  if (!scan.holderMap) return null
  if (!networks?.length) return { key: 'linked', label: 'Linked wallets', value: 'No linked clusters', level: 'green', target: 'bubbles' }
  const biggest = networks.reduce((best, item) => ((item.pct ?? 0) > (best.pct ?? 0) ? item : best))
  const level = (biggest.pct ?? 0) >= 10 ? 'red' : (biggest.pct ?? 0) >= 3 ? 'yellow' : 'green'
  return {
    key: 'linked',
    label: 'Linked wallets',
    value: `${biggest.wallets} wallets · ${pct(biggest.pct)}${biggest.poolPct >= 1 ? ' (LP out)' : ''}`,
    level,
    target: 'bubbles',
  }
}

const siteRow = (scan, site) => {
  const websites = scan.socials?.websites ?? []
  if (!websites.length) return { key: 'site', label: 'Website', value: scan.socials?.twitter ? 'None (X only)' : 'No website or socials', level: 'yellow', target: 'site' }
  // only links to big platforms (an X search, a TikTok…): there's no project website
  const own = websites.filter(url => !isPlatformLink(url))
  if (!own.length) {
    return { key: 'site', label: 'Website', value: `No real site (links to ${hostOf(websites[0])})`, level: 'yellow', target: 'site' }
  }
  // the "website" is just the token's page on the launchpad (…/coin/<CA>): not a project site
  const first = own[0]
  let host = ''
  try {
    host = new URL(first).hostname.replace(/^www\./, '')
  } catch {}
  if ((scan.address && first.includes(scan.address)) || (host && host === scan.socials?.launchpad)) {
    return { key: 'site', label: 'Website', value: `Launchpad page only (${host})`, level: 'yellow', target: 'site' }
  }
  if (site === 'pending' || site === undefined) return { key: 'site', label: 'Website', value: 'Checking…', level: 'muted', target: 'site' }
  if (!site) return null
  if (site.ok === false) return { key: 'site', label: 'Website', value: 'Down', level: 'red', target: 'site' }
  const parts = []
  if (Number.isFinite(site.domainAgeDays)) parts.push(site.domainAgeDays === 0 ? 'Registered today' : site.domainAgeDays < 60 ? `${site.domainAgeDays}d old` : site.domainAgeDays < 730 ? `${Math.floor(site.domainAgeDays / 30)}mo old` : `${Math.floor(site.domainAgeDays / 365)}y old`)
  if (site.builders?.length) parts.push(site.builders[0])
  if (site.mentionsToken === false) parts.push('no CA')
  const fresh = Number.isFinite(site.domainAgeDays) && site.domainAgeDays < 14
  return {
    key: 'site',
    label: 'Website',
    value: parts.join(' · ') || 'Checked',
    level: fresh || site.mentionsToken === false ? 'yellow' : 'green',
    target: 'site',
  }
}

const athRow = momentum => {
  if (!momentum?.pulse || !momentum.ath) return null
  const { pulse, ath } = momentum
  const gap = (pulse.priceUsd / ath.price - 1) * 100
  // the ATH in market cap terms (what traders talk in): same supply, so MC scales with price
  const mcPerPrice = pulse.marketCap && pulse.priceUsd ? pulse.marketCap / pulse.priceUsd : null
  const athMc = mcPerPrice ? ath.price * mcPerPrice : null
  if (gap >= 0) {
    return { key: 'ath', label: 'ATH', value: `NEW ATH · ${money(pulse.marketCap)} MC`, chip: `NEW ATH! ${money(pulse.marketCap)} MC`, level: 'green', target: 'momentum' }
  }
  // within 2% of the high it IS at the high: "1% below" is just noise
  if (gap > -2) {
    return { key: 'ath', label: 'ATH', value: `At ATH · ${money(pulse.marketCap)} MC`, chip: `At its ATH: ${money(pulse.marketCap)} MC`, level: 'green', target: 'momentum' }
  }
  const below = Math.abs(gap).toFixed(0)
  return {
    key: 'ath',
    label: 'ATH',
    value: athMc ? `${money(athMc)} MC · now ${below}% below` : `${below}% below ATH`,
    chip: athMc ? `ATH was ${money(athMc)} MC · now ${below}% below` : `${below}% below its ATH`,
    level: gap >= -10 ? 'green' : gap <= -70 ? 'red' : 'yellow',
    target: 'momentum',
  }
}

// pump.fun curve: how full, and when it migrates at the current pace
const curveRow = momentum => {
  const curve = momentum?.curve
  if (!curve || curve.progress >= 100) return null
  const eta = curve.etaMin != null && curve.etaMin <= 120 ? Math.max(1, Math.round(curve.etaMin)) : null
  const value = `${Math.floor(curve.progress)}% of the curve${eta ? ` · migrates in ~${eta} min` : ''}`
  return { key: 'curve', label: 'pump.fun curve', value, chip: eta ? `Migrates in ~${eta} min (${Math.floor(curve.progress)}% of the curve)` : null, level: eta && eta <= 10 ? 'green' : 'info', target: 'momentum' }
}

// your position in this token (read-only balance from your wallet, if you added it)
const amountText = value => (value >= 1e9 ? `${(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : `${Math.round(value)}`)
const youRow = (scan, momentum, holding) => {
  if (!(holding?.amount > 0)) return null
  const price = momentum?.pulse?.priceUsd ?? scan.market?.priceUsd ?? 0
  const value = holding.amount * price
  return { key: 'you', label: 'You', value: `You hold ${amountText(holding.amount)} (${money(value)})`, level: 'info' }
}

/** The quick-card rows for a scan (null rows are skipped). */
export const edgeRows = ({ scan, site, momentum, memory, trend, holding, twins }) =>
  [youRow(scan, momentum, holding), aboutRow(scan, site), memory ?? null, trend ?? null, dumpRow(scan), vampRow(scan), twinsRow(scan, site, twins), devWalletsRow(scan), devHistoryRow(scan), linkedRow(scan), siteRow(scan, site), athRow(momentum), curveRow(momentum)].filter(Boolean)

/**
 * Short lines for the chip above the buddy (they rotate every few seconds).
 * Only what's worth saying out loud: a calm "unique ticker" or "no clusters" isn't news.
 */
export const chipFacts = ({ scan, site, momentum, memory, trend, holding, brain, twins }) => {
  const rows = edgeRows({ scan, site, momentum, memory, trend, holding, twins }).filter(row => row.level !== 'muted')
  const facts = []
  for (const row of rows) {
    if (row.key === 'memory' || row.key === 'trend') {
      if (row.chip) facts.push({ ...row, text: row.chip })
    } else if (row.key === 'dump') {
      if (row.level !== 'green') facts.push({ ...row, text: row.chip })
    } else if (row.key === 'vamp' && row.race) {
      facts.push({ ...row, text: row.value })
    } else if (row.key === 'twins') {
      if (row.chip) facts.push({ ...row, text: row.chip })
    } else if (row.key === 'vamp') {
      if (row.level === 'red') facts.push({ ...row, text: `Vamp! ${row.value.replace('COPY · ', '')}` })
      else if (row.level === 'yellow') facts.push({ ...row, text: 'Twin launch: check the CA' })
      else if (scan.vamps?.copies && !scan.vamps.earlierCount) facts.push({ ...row, text: `OG · ${scan.vamps.copies} vamp${scan.vamps.copies === 1 ? '' : 's'} copy it` })
    } else if (row.key === 'devWallets') {
      facts.push({ ...row, text: row.value.startsWith('Clean') ? 'Clean launch, no dev bundle' : `Dev bundle: ${row.value.replace(' bought with dev', ' wallets')}` })
    } else if (row.key === 'devHistory') {
      facts.push({ ...row, text: row.chip })
    } else if (row.key === 'linked') {
      if (row.level !== 'green') facts.push({ ...row, text: `Linked wallets: ${row.value}` })
    } else if (row.key === 'site') {
      if (row.level !== 'green') facts.push({ ...row, text: `Site: ${row.value}` })
    } else if (row.key === 'curve') {
      if (row.chip) facts.push({ ...row, text: row.chip })
    } else if (row.key === 'ath') {
      facts.push({ ...row, text: row.chip })
    }
  }
  // what it is first (context), then the scary ones
  const rank = { red: 0, yellow: 1, green: 2 }
  const about = rows.find(row => row.key === 'about')
  const sorted = facts.sort((a, b) => rank[a.level] - rank[b.level])
  // the AI read (when the buddy can afford to think) goes first: it's the best one-liner
  const ai = brain?.line ? [{ key: 'brain', level: 'info', text: brain.line }] : []
  return [...ai, ...(about ? [{ ...about, text: about.chip }] : []), ...sorted]
}

/**
 * "The read": one specific sentence instead of a generic headline. The most serious
 * thing first, then the next one if it's also serious; a clean token says why it's clean.
 */
export const readLine = ({ scan, site, momentum, memory, trend, holding, twins }) => {
  const rows = edgeRows({ scan, site, momentum, memory, trend, holding, twins }).filter(row => row.level !== 'muted')
  const say = {
    dump: row => `${row.risky.who} still hold ${pct(row.risky.pct)}: if they sell, price ≈-${row.impact.toFixed(0)}%.`,
    twins: row => row.text,
    vamp: row => (row.race ? `${scan.flags.find(flag => flag.race)?.text.split('. ').slice(0, 2).join('. ').replace(/\.$/, '')}.` : row.level === 'red' ? `It's a copy: the OG ${row.value.replace('COPY · OG at ', 'sits at ')}.` : 'Another coin with the same name launched hours ago: check the CA.'),
    devWallets: row => `Dev bundle at launch: ${row.value.replace(' bought with dev', ' wallets')}.`,
    devHistory: row => `${row.value}.`,
    linked: row => `Linked wallets: ${row.value}.`,
    site: row => `Website: ${row.value}.`,
    ath: row => `ATH: ${row.value}.`,
    memory: row => `${row.value}.`,
  }
  const rank = { red: 0, yellow: 1 }
  // the dump line already covers the bundle / the cluster it's about: don't say it twice
  const dump = rows.find(row => row.key === 'dump' && row.level in rank)
  const covered = new Set(dump ? (dump.risky.who === 'Linked wallets' ? ['linked'] : ['devWallets']) : [])
  const serious = rows.filter(row => row.level in rank && !covered.has(row.key)).sort((a, b) => rank[a.level] - rank[b.level])
  if (serious.length) return serious.slice(0, 2).map(row => say[row.key]?.(row) ?? `${row.label}: ${row.value}.`).join(' ')
  const good = []
  if (rows.some(row => row.key === 'devWallets' && row.value.startsWith('Clean'))) good.push('no dev bundle')
  if (rows.some(row => row.key === 'linked' && row.level === 'green')) good.push('no big clusters')
  if (rows.some(row => row.key === 'dump' && row.level === 'green')) good.push('little dump risk')
  return good.length ? `Clean read: ${good.join(', ')}. Still a memecoin.` : null
}
