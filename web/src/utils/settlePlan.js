// Who pays whom to settle a group, from the members' net balances in the
// group (minor units; positive = gets money back, negative = owes).
//
// Greedy: the largest debt is paid to the largest credit, then the next, until
// everything is settled. That takes at most (members - 1) payments, nobody both
// pays and receives, and the same balances always give the same plan. It is
// the one place that decides "who settles with whom": the group page's Settle
// up and the Friends page both read it, so they can never disagree.
export function settlePlan(members) {
  const byAmount = (a, b) => b.amt - a.amt || String(a.id).localeCompare(String(b.id))
  const cents = m => Math.round(Number(m.balance) || 0)
  const creditors = members.filter(m => cents(m) > 0).map(m => ({ id: m.id, amt: cents(m) })).sort(byAmount)
  const debtors = members.filter(m => cents(m) < 0).map(m => ({ id: m.id, amt: -cents(m) })).sort(byAmount)
  const plan = []
  let i = 0, j = 0
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amt, creditors[j].amt)
    if (amount > 0) plan.push({ from: debtors[i].id, to: creditors[j].id, amount })
    debtors[i].amt -= amount
    creditors[j].amt -= amount
    if (debtors[i].amt === 0) i++
    if (creditors[j].amt === 0) j++
  }
  return plan
}

// What `other` and `me` settle in the plan: positive when they pay me,
// negative when I pay them, 0 when the plan has no payment between us.
export function between(plan, me, other) {
  let net = 0
  for (const p of plan) {
    if (p.from === other && p.to === me) net += p.amount
    else if (p.from === me && p.to === other) net -= p.amount
  }
  return net
}
