// Construye la extensión desempaquetada en dist/ (y opcionalmente un .zip
// listo para la Chrome Web Store).
//   node scripts/build.mjs          → dist/
//   node scripts/build.mjs --test   → dist/ + permiso para 127.0.0.1 (pruebas e2e)
//   node scripts/build.mjs --zip    → dist/ + buddy-extension-<versión>.zip
//
// Reutiliza el código de la app de escritorio (../desk-buddy) y el motor de
// avatares de ../character-studio, igual que el build del escritorio.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const deskBuddy = path.resolve(root, '..', 'desk-buddy')
const studio = path.resolve(root, '..', 'character-studio')
const dist = path.join(root, process.argv.includes('--zip') ? 'dist-store' : 'dist')
const generated = path.join(root, 'build')
const TEST = process.argv.includes('--test')
const ZIP = process.argv.includes('--zip')
// Versión para la Chrome Web Store: solo personajes originales (sin marcas de
// terceros: Kirby, Bitcoin, Solana, Claude, Robinhood, pump.fun, Grok).
const STORE = ZIP || process.argv.includes('--store')
// third-party brands and memecoin mascots: never in the Chrome Web Store build
const BRANDED = new Set(['kirby', 'bitcoin', 'solana', 'claude', 'hood', 'pumpy', 'grok-bot', 'doge', 'moo-deng', 'popcat'])
// the public repo ships original characters only: fall back to Miso when Kirby is not there
const HAS_KIRBY = existsSync(path.join(deskBuddy, 'assets', 'avatars', 'kirby.avatar.json'))
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

const TRADING_MATCHES = [
  '*://pump.fun/*',
  '*://*.pump.fun/*',
  '*://dexscreener.com/*',
  '*://*.dexscreener.com/*',
  '*://padre.gg/*',
  '*://fomo.family/*',
  '*://*.fomo.family/*',
  '*://*.padre.gg/*',
  '*://gmgn.ai/*',
  '*://*.gmgn.ai/*',
  '*://birdeye.so/*',
  '*://*.birdeye.so/*',
  '*://photon-sol.tinyastro.io/*',
  '*://axiom.trade/*',
  '*://*.axiom.trade/*',
  '*://neo.bullx.io/*',
  '*://bullx.io/*',
  '*://solscan.io/*',
  '*://*.dextools.io/*',
  '*://raydium.io/*',
  '*://jup.ag/*',
]
const SERVER = process.env.BUDDY_SERVER_URL ? `${new URL(process.env.BUDDY_SERVER_URL).origin}/*` : null
const API_HOSTS = [
  ...(SERVER ? [SERVER] : []),
  'https://api.dexscreener.com/*',
  'https://api.rugcheck.xyz/*',
  'https://api.gopluslabs.io/*',
  // ATH from historical candles (momentum alerts)
  'https://api.geckoterminal.com/*',
  // the tweet a coin is built on (X's public embed endpoint)
  'https://cdn.syndication.twimg.com/*',
  // your own Telegram bot (optional): watchlist alerts to your phone
  'https://api.telegram.org/*',
  // blockchain de Solana (lanzamiento on-chain): la RPC pública y Helius
  'https://api.mainnet-beta.solana.com/*',
  'https://*.helius-rpc.com/*',
]
const TEST_MATCHES = ['http://127.0.0.1/*', 'http://localhost/*']

const manifest = {
  manifest_version: 3,
  name: TEST ? 'Buddy (test)' : 'Buddy: your anti-rug sidekick',
  short_name: 'Buddy',
  version: pkg.version,
  description:
    'A friendly sidekick that checks the memecoin you are viewing: launch bundles, linked wallets, copycat tokens and live risk alerts.',
  icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  action: { default_title: 'Buddy: show / hide', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
  background: { service_worker: 'background.js', type: 'module' },
  // alarms + unlimitedStorage: the buddy's memory checks outcomes in the background and keeps them on this PC
  permissions: ['storage', 'unlimitedStorage', 'alarms', 'notifications', 'activeTab', 'scripting', 'declarativeNetRequestWithHostAccess'],
  // La RPC pública de Solana rechaza pedidos con cabecera Origin de navegador:
  // esta regla la quita solo para esa dirección.
  declarative_net_request: { rule_resources: [{ id: 'solana-rpc', enabled: true, path: 'rules.json' }] },
  host_permissions: [...API_HOSTS, ...TRADING_MATCHES, ...(TEST ? TEST_MATCHES : [])],
  content_scripts: [{ matches: [...TRADING_MATCHES, ...(TEST ? TEST_MATCHES : [])], js: ['content.js'], run_at: 'document_idle' }],
  web_accessible_resources: [{ resources: ['avatars/*', 'sounds/*', 'sounds/ui/*'], matches: ['<all_urls>'] }],
  commands: {
    'toggle-buddy': { suggested_key: { default: 'Alt+Shift+B' }, description: 'Show / hide the buddy' },
    'show-report': { suggested_key: { default: 'Alt+Shift+R' }, description: 'Open the token report' },
  },
  options_page: 'options.html',
  minimum_chrome_version: '120',
}

// ajv pre-compilado (sin eval) — mismo truco que la app de escritorio
const compileValidator = async () => {
  const studioRequire = createRequire(path.join(studio, 'package.json'))
  const Ajv2020 = studioRequire('ajv/dist/2020.js').default
  const standaloneCode = studioRequire('ajv/dist/standalone').default
  const schema = JSON.parse(await readFile(path.join(studio, 'packages/avatar-core/src/avatarDefinition.schema.json'), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, code: { source: true, esm: true } })
  await mkdir(generated, { recursive: true })
  await writeFile(path.join(generated, 'avatar-validator.mjs'), standaloneCode(ajv, ajv.compile(schema)))
  await writeFile(
    path.join(generated, 'ajv-shim.mjs'),
    "import validate from './avatar-validator.mjs'\nexport default class PrecompiledAjv {\n  compile() {\n    return validate\n  }\n}\n"
  )
}

const aliasPlugin = {
  name: 'buddy-aliases',
  setup(pluginBuild) {
    const targets = {
      '@bible-strong/avatar-web': path.join(studio, 'packages/avatar-web/src/index.ts'),
      '@bible-strong/avatar-core': path.join(studio, 'packages/avatar-core/src/index.ts'),
      'ajv/dist/2020.js': path.join(generated, 'ajv-shim.mjs'),
    }
    pluginBuild.onResolve({ filter: /^(@bible-strong\/avatar-(web|core)|ajv\/dist\/2020\.js)$/ }, args => ({ path: targets[args.path] }))
  },
}

const bundle = (entry, format) =>
  build({
    entryPoints: [path.join(root, 'src', entry)],
    outfile: path.join(dist, entry),
    bundle: true,
    format,
    platform: 'browser',
    target: 'chrome120',
    legalComments: 'none',
    loader: { '.css': 'text', '.html': 'text' },
    plugins: [aliasPlugin],
    nodePaths: [path.join(studio, 'node_modules')],
    define: {
      __BUDDY_TEST__: String(TEST),
      __BUDDY_SERVER__: JSON.stringify(process.env.BUDDY_SERVER_URL ?? ''),
      __BUDDY_DEFAULT_AVATAR__: JSON.stringify(STORE || !HAS_KIRBY ? 'miso' : 'kirby'),
    },
    logLevel: 'warning',
  })

const icons = async () => {
  await mkdir(path.join(dist, 'icons'), { recursive: true })
  // Kero (the brand face): toolbar sizes edge to edge, store/menu sizes with Chrome's 16/128 margin
  for (const size of [16, 32, 48, 128]) {
    const source = path.join(root, 'assets', size <= 32 ? 'icon-small.png' : 'icon.png')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', source, '-vf', `scale=${size}:${size}:flags=lanczos`, path.join(dist, 'icons', `${size}.png`)])
  }
}

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await compileValidator()
await Promise.all([bundle('content.js', 'iife'), bundle('background.js', 'esm'), bundle('options.js', 'iife')])
await copyFile(path.join(root, 'src', 'options.html'), path.join(dist, 'options.html'))
await copyFile(path.join(root, 'src', 'rules.json'), path.join(dist, 'rules.json'))
await cp(path.join(deskBuddy, 'assets', 'avatars'), path.join(dist, 'avatars'), { recursive: true })
if (STORE) {
  const index = JSON.parse(await readFile(path.join(dist, 'avatars', 'index.json'), 'utf8'))
  for (const entry of index.filter(item => BRANDED.has(item.id))) await rm(path.join(dist, 'avatars', entry.file), { force: true })
  await writeFile(path.join(dist, 'avatars', 'index.json'), JSON.stringify(index.filter(item => !BRANDED.has(item.id)), null, 2))
}
for (const folder of ['', 'ui']) {
  await mkdir(path.join(dist, 'sounds', folder), { recursive: true })
  for (const file of await readdir(path.join(studio, 'public', 'sounds', folder))) {
    if (/\.(ogg|txt)$/.test(file)) await copyFile(path.join(studio, 'public', 'sounds', folder, file), path.join(dist, 'sounds', folder, file))
  }
}
await icons()
await writeFile(path.join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
if (ZIP) {
  const zip = path.join(root, `buddy-extension-${pkg.version}.zip`)
  await rm(zip, { force: true })
  // entries must use "/": PowerShell's Compress-Archive writes "\" on Windows and the store rejects it
  const py = [
    'import os, sys, zipfile',
    'src, out = sys.argv[1], sys.argv[2]',
    "with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:",
    '    for folder, _, files in os.walk(src):',
    '        for name in sorted(files):',
    '            full = os.path.join(folder, name)',
    "            z.write(full, os.path.relpath(full, src).replace(os.sep, '/'))",
  ].join('\n')
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', py, dist, zip])
  console.log(`zip: ${zip}`)
}
console.log(`extensión lista en ${dist}${TEST ? ' (modo pruebas)' : ''}${STORE ? ' (versión tienda: solo personajes originales)' : ''}`)
