import assert from 'node:assert/strict'
import { test } from 'node:test'
import { headline, liveAlerts, siteFlags, topFlags } from '../../src/site-flags.js'

test('señales de la web del proyecto', () => {
  const text = siteFlags({ status: 200, domainAgeDays: 0, builders: ['Framer'], placeholders: true, words: 40, mentionsToken: false, https: true })
    .map(flag => `${flag.level}:${flag.text}`)
    .join('\n')
  assert.match(text, /yellow:Website domain registered today/)
  assert.match(text, /yellow:Website built with Framer/)
  assert.match(text, /yellow:Website has placeholder text/)
  assert.match(text, /yellow:Website is almost empty/)
  assert.match(text, /yellow:Website doesn.t show this CA/)
  const old = siteFlags({ status: 200, domainAgeDays: 1381, builders: [], words: 500, mentionsToken: true, https: true })
  assert.deepEqual(old.map(flag => flag.level), ['green', 'green'])
  assert.deepEqual(siteFlags({ unreachable: true }), [{ level: 'red', kind: 'site', text: 'Project website is down.' }])
  assert.deepEqual(siteFlags(null), [])
})

test('orden y frase principal', () => {
  const flags = [{ level: 'green', text: 'g' }, { level: 'red', text: 'r' }, { level: 'yellow', text: 'y' }]
  assert.deepEqual(topFlags(flags).map(flag => flag.text), ['r', 'y', 'g'])
  assert.match(headline('alto'), /red flags/)
})

test('vigilancia en vivo: caída de liquidez, dev que vende y riesgo que sube', () => {
  const before = { verdict: 'medio', market: { liquidityUsd: 10000 }, dev: { pct: 8 } }
  const after = { verdict: 'alto', market: { liquidityUsd: 4000 }, dev: { pct: 0.2 } }
  const alerts = liveAlerts(before, after)
  assert.equal(alerts.length, 3)
  assert.match(alerts[0], /Liquidity dropped 60%/)
  assert.match(alerts[1], /Dev just sold/)
  assert.deepEqual(liveAlerts(before, { ...before }), [])
  const curve = liveAlerts({ verdict: 'medio', market: { bondingCurve: true, marketCap: 20000 } }, { verdict: 'medio', market: { bondingCurve: true, marketCap: 9000 } })
  assert.match(curve[0], /MC dropped 55%/)
})
