// Abre un Chromium real con la extensión (build de pruebas) y un servidor local
// que imita páginas de trading: http://127.0.0.1:<puerto>/site/pump.fun/coin/<mint>
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DIST = path.join(ROOT, 'dist')
const CHART = readFileSync(path.resolve(ROOT, '..', 'desk-buddy', 'tests', 'fixtures', 'fake-screen.png'))

// Barra de arriba con aspecto de terminal de trading (no la ruta técnica).
const pretty = pathname => {
  const match = pathname.match(/^\/site\/([^/]+)(?:\/.*?([1-9A-HJ-NP-Za-km-z]{32,44}))?/)
  if (!match) return pathname
  const token = match[2] ? ` · <span style="color:#8b949e">${match[2].slice(0, 4)}…${match[2].slice(-4)}</span>` : ''
  return `<b style="color:#58a6ff">${match[1]}</b>${token}`
}

const PAGE = title => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{margin:0;background:#0d1117;color:#e6edf3;font:14px system-ui}header{padding:14px 20px;background:#161b22}
img{display:block;width:100%;max-width:1100px;margin:20px auto}#trade{position:fixed;left:20px;bottom:20px;padding:12px 18px;background:#2ea043;border:0;color:#fff;border-radius:8px}</style>
</head><body><header>${pretty(title)}</header><img src="/chart.png" alt="chart"><button id="trade">Buy</button>
<script>window.keys=[];document.addEventListener('keydown',e=>window.keys.push(e.key));
document.getElementById('trade').addEventListener('click',()=>{window.bought=(window.bought||0)+1})</script></body></html>`

export const startSite = () =>
  new Promise(resolve => {
    const server = http.createServer((request, response) => {
      if (request.url === '/chart.png') {
        response.writeHead(200, { 'content-type': 'image/png' })
        return response.end(CHART)
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(PAGE(decodeURIComponent(request.url)))
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }))
  })

export const launch = async () => {
  const userData = mkdtempSync(path.join(os.tmpdir(), 'buddy-ext-e2e-'))
  const context = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  })
  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent('serviceworker')
  const extensionId = new URL(worker.url()).host
  const close = async () => {
    await context.close().catch(() => {})
    rmSync(userData, { recursive: true, force: true })
  }
  return { context, worker, extensionId, close }
}

/** Espera a que el buddy de la página esté listo y devuelve helpers. */
export const buddyOn = async page => {
  const host = page.locator('desk-buddy-root')
  await host.waitFor({ state: 'attached' })
  await page.waitForFunction(() => document.querySelector('desk-buddy-root')?.dataset.ready === 'true')
  const data = key => page.evaluate(k => document.querySelector('desk-buddy-root').dataset[k], key)
  const center = async () => {
    const box = await page.locator('desk-buddy-root #squish svg').boundingBox()
    return { x: box.x + box.width / 2, y: box.y + box.height * 0.6 }
  }
  const click = async (count = 1, gap = 60) => {
    const { x, y } = await center()
    for (let index = 0; index < count; index += 1) {
      await page.mouse.click(x, y)
      if (index < count - 1) await page.waitForTimeout(gap)
    }
  }
  const settle = async () => {
    await page.waitForFunction(() => {
      const root = document.querySelector('desk-buddy-root')?.shadowRoot
      return root && !root.querySelector('#buddy').classList.contains('appearing')
    })
    await page.waitForTimeout(700)
  }
  return { host, data, center, click, settle, $: selector => page.locator(`desk-buddy-root ${selector}`) }
}
