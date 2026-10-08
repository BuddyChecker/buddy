// Watchlist: tokens the buddy keeps an eye on even with no tab open (every minute, from the
// background). Your own market-cap alerts, liquidity pulled, big moves. Pure logic here; the
// background does the fetching and the notifying (Windows notification + optional Telegram).

export const MAX_WATCH = 30

/** "1m", "500k", "1.5M", "$250,000" → number (USD), or null. */
export const parseMc = text => {
  const match = String(text ?? '').replace(/[$,\s]/g, '').match(/^(\d+(?:\.\d+)?)([kmb])?$/i)
  if (!match) return null
  const value = Number(match[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[match[2]?.toLowerCase()] ?? 1)
  return value > 0 ? value : null
}

const usd = value =>
  value >= 1e9 ? `$${(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `$${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `$${(value / 1e3).toFixed(1)}k` : `$${Math.round(value)}`

/** Add (or update) a token on the watchlist. */
export const watchToken = (list, { address, chain, symbol, marketCap, liquidityUsd }, now = Date.now()) => {
  const others = list.filter(item => item.address !== address)
  const existing = list.find(item => item.address === address)
  return [{ ...(existing ?? {}), address, chain, symbol, addedAt: existing?.addedAt ?? now, last: existing?.last ?? { marketCap, liquidityUsd, at: now }, targets: existing?.targets ?? [] }, ...others].slice(0, MAX_WATCH)
}

/** A market-cap target: alert once when it's crossed (up if it's above now, down if below). */
export const addTarget = (list, address, mc, currentMc) =>
  list.map(item =>
    item.address === address ? { ...item, targets: [...(item.targets ?? []).filter(target => target.mc !== mc), { mc, direction: currentMc != null && mc < currentMc ? 'down' : 'up', done: false }] } : item
  )

/**
 * Compare a watched token with its live numbers. Returns { item (updated), alerts: [text] }.
 *   · your MC targets (once each)
 *   · liquidity pulled (-50% since the last check)
 *   · a big move since the last check (±30%)
 */
export const checkWatched = (item, live, now = Date.now()) => {
  const alerts = []
  const ticker = item.symbol ? `$${item.symbol}` : 'Your token'
  if (!live) return { item, alerts: [`${ticker}: no pool left on DexScreener (rugged?)`] }
  const next = { ...item, targets: (item.targets ?? []).map(target => ({ ...target })) }
  for (const target of next.targets) {
    if (target.done || live.marketCap == null) continue
    const crossed = target.direction === 'up' ? live.marketCap >= target.mc : live.marketCap <= target.mc
    if (crossed) {
      target.done = true
      alerts.push(`${ticker} hit your ${usd(target.mc)} MC alert (now ${usd(live.marketCap)})`)
    }
  }
  const last = item.last ?? {}
  if (last.liquidityUsd > 1000 && live.liquidityUsd != null && live.liquidityUsd < last.liquidityUsd * 0.5) {
    alerts.push(`${ticker}: liquidity dropped ${Math.round((1 - live.liquidityUsd / last.liquidityUsd) * 100)}% (now ${usd(live.liquidityUsd)})`)
  }
  if (last.marketCap > 0 && live.marketCap > 0) {
    const move = (live.marketCap / last.marketCap - 1) * 100
    if (move >= 30) alerts.push(`${ticker} pumping: +${Math.round(move)}% in a minute (${usd(live.marketCap)} MC)`)
    if (move <= -30) alerts.push(`${ticker} dumping: ${Math.round(move)}% in a minute (${usd(live.marketCap)} MC)`)
  }
  next.last = { marketCap: live.marketCap, liquidityUsd: live.liquidityUsd, at: now }
  return { item: next, alerts }
}

/** Telegram: the bot sends the alert to your chat (your own bot, created with @BotFather). */
export const telegramRequest = ({ botToken, chatId }, text) => ({
  url: `https://api.telegram.org/bot${botToken}/sendMessage`,
  body: { chat_id: chatId, text, disable_web_page_preview: true },
})
