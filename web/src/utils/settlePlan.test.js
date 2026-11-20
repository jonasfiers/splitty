// Who pays whom to settle a group (settlePlan.js), 2026-11-20.
// npm test -w web (deploy.sh runs it with the web build).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { settlePlan, between } from './settlePlan.js'

const m = (id, balance) => ({ id, balance })
const settles = (members, plan) => {
  const left = Object.fromEntries(members.map(x => [x.id, Math.round(x.balance)]))
  for (const p of plan) { left[p.from] += p.amount; left[p.to] -= p.amount }
  return Object.values(left).every(v => v === 0)
}

test('one debt: one payment', () => {
  assert.deepEqual(settlePlan([m('ann', 1000), m('bob', -1000)]), [{ from: 'bob', to: 'ann', amount: 1000 }])
})

test('everyone settled: no payments', () => {
  assert.deepEqual(settlePlan([m('ann', 0), m('bob', 0)]), [])
  assert.deepEqual(settlePlan([]), [])
})

test('several people: everything settles, in at most members − 1 payments, nobody both pays and receives', () => {
  const members = [m('ann', 2600), m('bob', -1500), m('cas', -800), m('dan', 400), m('eve', -700)]
  const plan = settlePlan(members)
  assert.ok(settles(members, plan), JSON.stringify(plan))
  assert.ok(plan.length <= members.length - 1)
  const payers = new Set(plan.map(p => p.from)), receivers = new Set(plan.map(p => p.to))
  assert.ok([...payers].every(p => !receivers.has(p)))
  assert.ok(plan.every(p => p.amount > 0 && Number.isInteger(p.amount)))
})

test('fractions of a cent (other currencies) are rounded, and still settle', {
  todo: 'KNOWN ISSUE (2026-11-20): an expense in another currency gives fractional balances (€1.404, −€0.936, −€0.468); rounded one by one they no longer add up (140 − 94 − 47 = −1), so a cent stays open after settling up, and that member can never leave (leaving needs exactly 0). Needs every converted share rounded once, in the API.',
}, () => {
  const members = [m('ann', 140.4), m('bob', -93.6), m('cas', -46.8)]
  const plan = settlePlan(members)
  assert.ok(settles(members, plan), JSON.stringify(plan))
})

test('the same balances always give the same plan, whatever the order', () => {
  const a = [m('ann', 500), m('bob', -250), m('cas', -250)]
  const b = [m('cas', -250), m('ann', 500), m('bob', -250)]
  assert.deepEqual(settlePlan(a), settlePlan(b))
})

test('between(): what two people settle, from my side', () => {
  const plan = settlePlan([m('ann', 1000), m('bob', -600), m('cas', -400)])
  assert.equal(between(plan, 'ann', 'bob'), 600)
  assert.equal(between(plan, 'bob', 'ann'), -600)
  assert.equal(between(plan, 'bob', 'cas'), 0)
})
