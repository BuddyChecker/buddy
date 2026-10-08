// Narrative races: which twins to read, and what the buddy says is different between them.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { modelVersion, twinFacts, twinTargets, twinsRead } from '../../src/twins.js'

const ME = 'GHzQdieBdcRk8HtgRVXpG22aThLtbXMygKy6P6awxUzc'
const NEW = '3e9y1rYs3aFFX8pSgvjGAq8sB3T5iaVxVbXa1YAg5Ee1'
const BIG = '4Bm9R9S9NwcGce9sZshsi19ZcnwTjbfhqpZVTdSuL4P5'
const race = {
  count: 18,
  spanMs: 45 * 60e3,
  rank: 9,
  isFirst: true,
  first: { address: ME, marketCap: 5_000 },
  leader: { address: BIG, marketCap: 1_400_000, site: null },
  hottest: { address: NEW, marketCap: 146_000, site: null },
  runners: [{ address: BIG, marketCap: 1_400_000 }, { address: NEW, marketCap: 146_000 }],
}
const scan = (extra = {}) => ({
  address: ME,
  market: { marketCap: 5_000 },
  socials: { websites: [`https://www.agencypad.fun/coin/${ME}`] },
  vamps: { race },
  flags: [],
  ...extra,
})

test('reads the biggest and the hottest twins, on the same launchpad page pattern', () => {
  const targets = twinTargets(scan())
  assert.deepEqual(
    targets.map(target => [target.address, target.url]),
    [
      [BIG, `https://www.agencypad.fun/coin/${BIG}`],
      [NEW, `https://www.agencypad.fun/coin/${NEW}`],
    ]
  )
  assert.deepEqual(twinTargets({ vamps: {} }), [])
})

test('model versions compare only inside the same family', () => {
  assert.deepEqual(modelVersion('GPT-6.1'), { family: 'gpt', version: 6.1 })
  assert.deepEqual(modelVersion('Claude-Opus-4.6'), { family: 'claude-opus', version: 4.6 })
})

test('same idea, older model: the money picking the newer one is said out loud', () => {
  const twins = [{ address: NEW, marketCap: 146_000, model: 'GPT-6.1' }, { address: BIG, marketCap: 1_400_000, model: null }]
  const read = twinsRead(scan(), { tech: { model: 'GPT-5.5' } }, twins)
  assert.equal(read.level, 'red')
  assert.equal(read.value, 'GPT-5.5 here · GPT-6.1 on 3e9y…5Ee1')
  assert.match(read.text, /^Same idea, older model: this one runs GPT-5\.5, CA 3e9y…5Ee1 runs GPT-6\.1 \(\$146\.0k MC\)\. It already has more money than this one \(\$5\.0k\)\.$/)
  // only when the newer one IS the leader: "the money is picking the newer model"
  const led = twinsRead({ ...scan(), vamps: { race: { ...race, leader: { address: NEW, marketCap: 146_000 } } } }, { tech: { model: 'GPT-5.5' } }, twins)
  assert.match(led.text, /The money is picking the newer model\.$/)
  // seen from the newer one: green
  const newer = twinsRead({ ...scan(), address: NEW, market: { marketCap: 146_000 } }, { tech: { model: 'GPT-6.1' } }, [{ address: ME, marketCap: 5_000, model: 'GPT-5.5' }])
  assert.equal(newer.level, 'green')
  assert.match(newer.text, /Newest model in the race: this one runs GPT-6\.1; CA GHzQ…xUzc runs GPT-5\.5/)
})

test('a borrowed page beats everything else', () => {
  const flags = [{ kind: 'identity', level: 'red', other: ME, text: 'Borrowed identity: …' }]
  const read = twinsRead({ ...scan(), address: BIG, flags }, null, [])
  assert.equal(read.level, 'red')
  assert.equal(read.value, "Website is CA GHzQ…xUzc's page")
})

test('the AI gets the race and what every twin says it is', () => {
  const facts = twinFacts(scan(), { tech: { model: 'GPT-5.5' }, pitch: 'PLEASE READ' }, [{ address: NEW, marketCap: 146_000, model: 'GPT-6.1', pitch: 'gpt 5.5 is not solving anything' }])
  assert.match(facts, /^18 coins with this name launched within 45 minutes; this one is #9 by MC \(\$5\.0k\), and it launched first\./)
  assert.match(facts, /This one: model GPT-5\.5; launch post "PLEASE READ"/)
  // a launchpad's generic home text (same on 2+ twins) is dropped
  const generic = twinFacts(scan(), null, [{ address: BIG, marketCap: 1, description: 'Every coin gets a mind' }, { address: NEW, marketCap: 1, description: 'Every coin gets a mind' }])
  assert.doesNotMatch(generic, /Every coin/)
  assert.match(facts, /Twin 3e9y…5Ee1 \(\$146\.0k MC\): model GPT-6\.1; launch post "gpt 5\.5 is not solving anything"/)
})
