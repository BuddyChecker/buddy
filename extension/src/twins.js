// Narrative races: several coins with the same name launched within hours. Calls alone miss
// WHY the money picks one: same idea, a newer model, a real page vs a borrowed one. The buddy
// reads each twin's page (buddy-server /v1/site) and says what's different. Pure functions.

const short = address => `${address.slice(0, 4)}…${address.slice(-4)}`
const money = value => (value >= 1e6 ? `$${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `$${(value / 1e3).toFixed(1)}k` : `$${Math.round(value ?? 0)}`)

/** The twins worth reading (biggest first, max 3) and the page to read for each. */
const CA_IN_URL = /[1-9A-HJ-NP-Za-km-z]{32,44}/
export const twinTargets = (scan, max = 5) => {
  const race = scan?.vamps?.race
  if (!race) return []
  // launchpad pages carry the CA in the URL: same launchpad, the twin's CA (works from a borrowed page too)
  const page = scan.socials?.websites?.find(url => CA_IN_URL.test(url))
  const pageOf = token => token.site ?? (page ? page.replace(page.match(CA_IN_URL)[0], token.address) : null)
  const seen = new Set()
  return [race.leader, race.hottest, race.first, ...(race.runners ?? [])]
    .filter(token => token?.address && token.address !== scan.address && !seen.has(token.address) && seen.add(token.address))
    .slice(0, max)
    .map(token => ({ address: token.address, marketCap: token.marketCap, createdAt: token.createdAt, url: pageOf(token) }))
}

/** "GPT-6.1" → { family: 'gpt', version: 6.1 } (only same-family models compare). */
export const modelVersion = name => {
  const match = String(name ?? '').match(/^(.*?)-?(\d+(?:\.\d+)?)$/)
  return match ? { family: match[1].toLowerCase().replace(/-$/, ''), version: Number(match[2]) } : null
}
const newer = (a, b) => {
  const x = modelVersion(a)
  const y = modelVersion(b)
  return x && y && x.family === y.family ? Math.sign(x.version - y.version) : 0
}

/** What separates this coin from its twins: model, borrowed page. null when nothing to say. */
export const twinsRead = (scan, site, twins) => {
  if (!scan?.vamps?.race || !Array.isArray(twins)) return null
  const borrowed = scan.flags?.find(flag => flag.kind === 'identity')
  // a borrowed page describes the other coin, not this one
  const mine = site && site !== 'pending' && !borrowed ? site.tech?.model ?? null : null
  const read = twins.filter(twin => twin.model)
  const myMc = scan.market?.marketCap ?? 0
  // a twin on a newer version of the same model: the classic reason the money moved
  const ahead = mine ? read.filter(twin => newer(twin.model, mine) > 0).sort((a, b) => b.marketCap - a.marketCap)[0] : null
  const behind = mine ? read.filter(twin => newer(twin.model, mine) < 0) : []
  if (borrowed) {
    return {
      level: 'red',
      value: `Website is CA ${short(borrowed.other)}'s page`,
      chip: 'Borrowed identity: its site is another coin',
      text: borrowed.text,
    }
  }
  if (ahead) {
    const winning = ahead.marketCap > myMc
    const leads = scan.vamps.race.leader?.address === ahead.address
    return {
      level: winning ? 'red' : 'yellow',
      value: `${mine} here · ${ahead.model} on ${short(ahead.address)}`,
      chip: `Older model: twin runs ${ahead.model}`,
      text: `Same idea, older model: this one runs ${mine}, CA ${short(ahead.address)} runs ${ahead.model} (${money(ahead.marketCap)} MC).${leads ? ' The money is picking the newer model.' : winning ? ` It already has more money than this one (${money(myMc)}).` : ''}`,
    }
  }
  if (mine && behind.length) {
    return {
      level: 'green',
      value: `Newest model of the race · ${mine}`,
      chip: `Newest model in the race: ${mine}`,
      text: `Newest model in the race: this one runs ${mine}; ${behind.map(twin => `CA ${short(twin.address)} runs ${twin.model}`).join(', ')}.`,
    }
  }
  const models = [mine ? `${mine} here` : null, ...read.slice(0, 2).map(twin => `${twin.model} on ${short(twin.address)}`)].filter(Boolean)
  if (models.length) return { level: 'muted', value: models.join(' · '), text: `Models: ${models.join(', ')}.` }
  return null
}

/** One line for the AI: the race and what each twin says it is. */
export const twinFacts = (scan, site, twins) => {
  const race = scan?.vamps?.race
  if (!race) return null
  const borrowed = scan.flags?.find(flag => flag.kind === 'identity')
  const mine = site && site !== 'pending' && !borrowed ? site : null
  // the same text on 2+ twins is the launchpad talking (its home page), not the project
  const seen = new Map()
  for (const twin of twins ?? []) if (twin.description) seen.set(twin.description, (seen.get(twin.description) ?? 0) + 1)
  const own = text => (text && (seen.get(text) ?? 0) < 2 ? text : null)
  const describe = (label, info) =>
    `${label}: ${[info.model ? `model ${info.model}` : null, info.pitch ? `launch post "${info.pitch}"` : null, info.description ? `page says "${info.description}"` : null].filter(Boolean).join('; ') || 'no page read'}`
  return [
    `${race.count} coins with this name launched within ${Math.max(1, Math.round(race.spanMs / 60e3))} minutes; this one is #${race.rank} by MC (${money(scan.market?.marketCap)}), ${race.isFirst ? 'and it launched first' : 'not the first'}.`,
    borrowed ? `This one: its website is the page of another coin (CA ${short(borrowed.other)}), it has no page of its own.` : describe('This one', { model: mine?.tech?.model, pitch: mine?.pitch, description: mine?.description }),
    ...(twins ?? []).map(twin => describe(`Twin ${short(twin.address)} (${money(twin.marketCap)} MC)`, { ...twin, description: own(twin.description) })),
  ].join(' ')
}
