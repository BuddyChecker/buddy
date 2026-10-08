import { riskyHolding } from './edge.js'
// Signals about the project website (buddy-server /v1/site result), in plain
// trader words. Pure functions: tested without network.

export const siteFlags = site => {
  if (!site) return []
  const flags = []
  if (site.unreachable || (site.status && site.status >= 400)) {
    flags.push({ level: 'red', kind: 'site', text: 'Project website is down.' })
    return flags
  }
  if (typeof site.domainAgeDays === 'number') {
    if (site.domainAgeDays <= 7) {
      flags.push({
        level: 'yellow',
        kind: 'site',
        text: site.domainAgeDays === 0 ? 'Website domain registered today.' : `Website domain registered ${site.domainAgeDays} day${site.domainAgeDays === 1 ? '' : 's'} ago.`,
      })
    } else if (site.domainAgeDays >= 180) {
      flags.push({ level: 'green', kind: 'site', text: `Website domain is over ${Math.floor(site.domainAgeDays / 30)} months old.` })
    }
  }
  if (site.builders?.length) flags.push({ level: 'yellow', kind: 'site', text: `Website built with ${site.builders.join(' / ')} (quick template).` })
  if (site.placeholders) flags.push({ level: 'yellow', kind: 'site', text: 'Website has placeholder text (lorem ipsum & co).' })
  if (typeof site.words === 'number' && site.words < 80) flags.push({ level: 'yellow', kind: 'site', text: 'Website is almost empty.' })
  if (site.mentionsToken === false) flags.push({ level: 'yellow', kind: 'site', text: "Website doesn't show this CA." })
  if (site.mentionsToken === true) flags.push({ level: 'green', kind: 'site', text: 'Website shows the same CA.' })
  if (site.https === false) flags.push({ level: 'yellow', kind: 'site', text: 'Website has no HTTPS.' })
  return flags
}

/** Headline for the report, by verdict. */
export const headline = verdict =>
  ({
    alto: 'Careful, multiple red flags on this token.',
    medio: 'Some things to check before you ape.',
    bajo: 'No major red flags (nothing is 100% safe).',
  })[verdict] ?? 'Checking…'

const ORDER = { red: 0, yellow: 1, green: 2 }

/** Most important signals first: red, yellow, then green. */
export const topFlags = (flags, count = 5) => [...flags].sort((a, b) => ORDER[a.level] - ORDER[b.level]).slice(0, count)

/** Did something bad happen since the last look? (live watch) */
export const liveAlerts = (before, after) => {
  if (!before || !after) return []
  const alerts = []
  const value = scan => (scan.market?.bondingCurve ? scan.market?.marketCap : scan.market?.liquidityUsd) ?? 0
  const was = value(before)
  const now = value(after)
  if (was > 0 && now < was * 0.7) {
    const drop = Math.round((1 - now / was) * 100)
    alerts.push(before.market?.bondingCurve ? `MC dropped ${drop}% since you opened the page.` : `Liquidity dropped ${drop}% since you opened the page.`)
  }
  const devBefore = before.dev?.pct ?? 0
  const devNow = after.dev?.pct ?? 0
  if (devBefore >= 1 && devNow < devBefore * 0.5) alerts.push(`Dev just sold (had ${devBefore.toFixed(1)}%, now ${devNow.toFixed(1)}%).`)
  // the wallets that can dump (bundle, dev, insider cluster) selling right now
  const riskyBefore = riskyHolding(before)
  const riskyNow = riskyHolding(after)
  if (riskyBefore && riskyNow && riskyBefore.pct - riskyNow.pct >= 3) {
    alerts.push(`${riskyBefore.who} just sold ${(riskyBefore.pct - riskyNow.pct).toFixed(1)}% of supply (${riskyNow.pct.toFixed(1)}% left).`)
  }
  if (before.verdict !== 'alto' && after.verdict === 'alto') alerts.push('Risk just went HIGH.')
  return alerts
}
