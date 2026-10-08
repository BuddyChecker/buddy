// ¿Qué token está mirando el usuario? Se deduce de la URL de la página.
// Devuelve un texto que el escáner (parseTokenInput de desk-buddy) entiende:
// una dirección de token o un link de par de DexScreener. null si no hay token.

const SOL = '[1-9A-HJ-NP-Za-km-z]{32,44}'
const EVM = '0x[a-fA-F0-9]{40}'
const ADDRESS = `(${SOL}|${EVM})`

const GMGN_CHAINS = { sol: 'solana', eth: 'ethereum', base: 'base', bsc: 'bsc', tron: 'tron' }
const DEXTOOLS_CHAINS = { solana: 'solana', ether: 'ethereum', base: 'base', bnb: 'bsc', arbitrum: 'arbitrum' }

const pairLink = (chain, pair) => `https://dexscreener.com/${chain}/${pair}`

/** Sitios donde la extensión vive (también los usa el manifest). */
export const TRADING_SITES = [
  'pump.fun',
  'dexscreener.com',
  'gmgn.ai',
  'birdeye.so',
  'photon-sol.tinyastro.io',
  'axiom.trade',
  'neo.bullx.io',
  'bullx.io',
  'solscan.io',
  'dextools.io',
  'raydium.io',
  'jup.ag',
  'padre.gg',
  'fomo.family',
]

const RULES = [
  // pump.fun/coin/<mint>  ·  pump.fun/<mint>
  { host: /(^|\.)pump\.fun$/, path: new RegExp(`^/(?:coin/)?(${SOL})`), to: match => match[1] },
  // dexscreener.com/<chain>/<par o token>
  {
    host: /(^|\.)dexscreener\.com$/,
    path: /^\/([a-z0-9]+)\/([A-Za-z0-9]{32,66})/,
    to: match => pairLink(match[1], match[2]),
  },
  // gmgn.ai/<chain>/token/<addr>
  {
    host: /(^|\.)gmgn\.ai$/,
    path: new RegExp(`^/(sol|eth|base|bsc|tron)/token/(?:[A-Za-z0-9]+_)?${ADDRESS}`),
    to: match => (GMGN_CHAINS[match[1]] === 'solana' || match[2].startsWith('0x') ? match[2] : null),
  },
  // birdeye.so/token/<addr>
  { host: /(^|\.)birdeye\.so$/, path: new RegExp(`^/token/${ADDRESS}`), to: match => match[1] },
  // photon-sol.tinyastro.io/en/lp/<par>
  {
    host: /(^|\.)photon-sol\.tinyastro\.io$/,
    path: new RegExp(`^/[a-z]{2}/lp/(${SOL})`),
    to: match => pairLink('solana', match[1]),
  },
  // axiom.trade/meme/<par>
  { host: /(^|\.)axiom\.trade$/, path: new RegExp(`^/meme/(${SOL})`), to: match => pairLink('solana', match[1]) },
  // solscan.io/token/<mint>
  { host: /(^|\.)solscan\.io$/, path: new RegExp(`^/token/(${SOL})`), to: match => match[1] },
  // dextools.io/app/<lang>/<chain>/pair-explorer/<par>
  {
    host: /(^|\.)dextools\.io$/,
    path: /^\/app\/[a-z-]+\/([a-z]+)\/pair-explorer\/([A-Za-z0-9]{32,66})/,
    to: match => (DEXTOOLS_CHAINS[match[1]] ? pairLink(DEXTOOLS_CHAINS[match[1]], match[2]) : null),
  },
]

// BullX y Jupiter/Raydium ponen el token en la query (?address=… / ?outputMint=…)
const QUERY_KEYS = ['address', 'outputMint', 'outputCurrency', 'token', 'mint']

/**
 * url: la de la pestaña. En las pruebas, http://127.0.0.1:<puerto>/site/<dominio>/…
 * se trata como si fuera https://<dominio>/… (así no hace falta internet).
 */
export const detectToken = rawUrl => {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  const test = url.pathname.match(/^\/site\/([^/]+)(\/.*)?$/)
  if (test && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')) {
    url = new URL(`https://${test[1]}${test[2] ?? '/'}${url.search}`)
  }
  for (const rule of RULES) {
    if (!rule.host.test(url.hostname)) continue
    const match = url.pathname.match(rule.path)
    if (match) return rule.to(match)
  }
  if (TRADING_SITES.some(site => url.hostname === site || url.hostname.endsWith(`.${site}`))) {
    for (const key of QUERY_KEYS) {
      const value = url.searchParams.get(key)
      if (value && new RegExp(`^${ADDRESS}$`).test(value)) return value
    }
  }
  return anyAddress(url)
}

// Any other terminal (Padre, new ones…): take the last token/pair-looking address in the
// path. A Solana id goes through a DexScreener link, which accepts a pair OR a token CA.
const SEGMENT = new RegExp(`^${ADDRESS}$`)
const anyAddress = url => {
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return null
  const segments = url.pathname.split('/').filter(Boolean).reverse()
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) continue
    return segment.startsWith('0x') ? segment : pairLink('solana', segment)
  }
  return null
}

export const isTradingSite = rawUrl => {
  try {
    const { hostname } = new URL(rawUrl)
    return TRADING_SITES.some(site => hostname === site || hostname.endsWith(`.${site}`))
  } catch {
    return false
  }
}
