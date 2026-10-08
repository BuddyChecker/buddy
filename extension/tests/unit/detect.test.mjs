import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectToken, isTradingSite } from '../../src/detect.js'

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const PAIR = '5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9'
const PEPE = '0x6982508145454Ce325dDbE47a25d4ec3d2311933'

test('detecta el token en cada sitio de trading', () => {
  assert.equal(detectToken(`https://pump.fun/coin/${BONK}`), BONK)
  assert.equal(detectToken(`https://pump.fun/${BONK}?ref=x`), BONK)
  assert.equal(detectToken(`https://dexscreener.com/solana/${PAIR}`), `https://dexscreener.com/solana/${PAIR}`)
  assert.equal(detectToken(`https://dexscreener.com/ethereum/${PEPE}`), `https://dexscreener.com/ethereum/${PEPE}`)
  assert.equal(detectToken(`https://gmgn.ai/sol/token/${BONK}`), BONK)
  assert.equal(detectToken(`https://gmgn.ai/sol/token/abc123_${BONK}`), BONK)
  assert.equal(detectToken(`https://gmgn.ai/eth/token/${PEPE}`), PEPE)
  assert.equal(detectToken(`https://birdeye.so/token/${BONK}?chain=solana`), BONK)
  assert.equal(detectToken(`https://photon-sol.tinyastro.io/en/lp/${PAIR}?handle=1`), `https://dexscreener.com/solana/${PAIR}`)
  assert.equal(detectToken(`https://axiom.trade/meme/${PAIR}`), `https://dexscreener.com/solana/${PAIR}`)
  assert.equal(detectToken(`https://solscan.io/token/${BONK}`), BONK)
  assert.equal(
    detectToken(`https://www.dextools.io/app/en/solana/pair-explorer/${PAIR}`),
    `https://dexscreener.com/solana/${PAIR}`
  )
  assert.equal(detectToken(`https://neo.bullx.io/terminal?chainId=1399811149&address=${BONK}`), BONK)
  assert.equal(detectToken(`https://jup.ag/swap/SOL-BONK?outputMint=${BONK}`), BONK)
})

test('no inventa tokens', () => {
  assert.equal(detectToken('https://pump.fun/board'), null)
  assert.equal(detectToken('https://dexscreener.com/'), null)
  assert.equal(detectToken(`https://example.com/coin/${BONK}`), `https://dexscreener.com/solana/${BONK}`) // any site: address in the path
  assert.equal(detectToken(`https://example.com/?address=${BONK}`), null)
  assert.equal(detectToken('no es una url'), null)
})

test('modo prueba: /site/<dominio>/ en localhost', () => {
  assert.equal(detectToken(`http://127.0.0.1:5555/site/pump.fun/coin/${BONK}`), BONK)
  assert.equal(detectToken(`http://127.0.0.1:5555/coin/${BONK}`), null)
})

test('isTradingSite', () => {
  assert.equal(isTradingSite('https://www.dexscreener.com/x'), true)
  assert.equal(isTradingSite('https://neo.bullx.io/terminal'), true)
  assert.equal(isTradingSite('https://google.com'), false)
})

test('Padre and any other terminal: the address in the URL is the token', () => {
  assert.equal(detectToken(`https://trade.padre.gg/trade/solana/${PAIR}`), `https://dexscreener.com/solana/${PAIR}`)
  assert.equal(isTradingSite('https://trade.padre.gg/trade/solana/x'), true)
  assert.equal(detectToken(`https://some-new-terminal.xyz/token/${BONK}?ref=abc`), `https://dexscreener.com/solana/${BONK}`)
  assert.equal(detectToken(`https://some-new-terminal.xyz/t/${PEPE}`), PEPE)
  assert.equal(detectToken('https://some-new-terminal.xyz/about'), null)
})

test('Fomo is a trading site too', () => {
  assert.equal(isTradingSite('https://fomo.family/token/x'), true)
  assert.equal(detectToken(`https://fomo.family/tokens/solana/${BONK}`), `https://dexscreener.com/solana/${BONK}`)
})
