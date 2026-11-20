// The Home screen's totals and the Friends page (2026-11-20): what is open
// across all groups, netted per person; and per friend, per group.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopApi, createUser, createGroup, addExpense } = require('./helpers');

before(setup);
after(stopApi);

// /dash/balance as { iso: { lent, owed } }, to the minor unit.
const totals = body => Object.fromEntries(body.currencies.map(c => [c.iso, { lent: Math.round(c.lent), owed: Math.round(c.owed) }]));

test('the Home total adds up the groups, netted per person', async () => {
    const [ann, bob, cas] = await Promise.all(['Ann', 'Bob', 'Cas'].map(createUser));
    const g1 = await createGroup([ann, bob, cas], { title: 'Flat' });
    const g2 = await createGroup([ann, bob], { title: 'Trip' });
    await addExpense(ann, g1, { amount: 3000, payer: ann, shares: { [bob.id]: 1000, [cas.id]: 1000 } }); // Bob, Cas owe Ann 10 each
    await addExpense(bob, g2, { amount: 800, payer: bob, shares: { [ann.id]: 400 } }); // Ann owes Bob 4
    await addExpense(cas, g1, { amount: 600, payer: cas, shares: { [ann.id]: 600 } }); // Ann owes Cas 6
    // Bob: 10 − 4 = 6 to Ann; Cas: 10 − 6 = 4 to Ann.
    assert.deepEqual(totals((await ann.api.get('/dash/balance')).body), { EUR: { lent: 1000, owed: 0 } });
    assert.deepEqual(totals((await bob.api.get('/dash/balance')).body), { EUR: { lent: 0, owed: 600 } });
});

test('the Friends page shows each friend per group', async () => {
    const [ann, bob] = await Promise.all(['Ann', 'Bob'].map(createUser));
    const g1 = await createGroup([ann, bob], { title: 'Alpha' });
    const g2 = await createGroup([ann, bob], { title: 'Beta' });
    await addExpense(ann, g1, { amount: 1000, payer: ann, shares: { [bob.id]: 500 } });
    await addExpense(bob, g2, { amount: 1000, payer: bob, shares: { [ann.id]: 200 } });
    const { body } = await ann.api.get('/dash/friends');
    const friend = body.friends.find(f => f.id === bob.id);
    assert.ok(friend, JSON.stringify(body));
    const byTitle = Object.fromEntries(friend.groups.map(g => [g.title, Object.fromEntries(g.members.map(m => [m.id, m.balance]))]));
    assert.deepEqual(byTitle.Alpha, { [ann.id]: 500, [bob.id]: -500 });
    assert.deepEqual(byTitle.Beta, { [ann.id]: -200, [bob.id]: 200 });
});

test('the Home total keeps each currency apart, never converted', async () => {
    const [ann, bob] = await Promise.all(['Ann', 'Bob'].map(createUser));
    const eur = await createGroup([ann, bob], { title: 'Home' });
    const twd = await createGroup([ann, bob], { title: 'Taiwan', currencyIso: 'TWD' });
    await addExpense(ann, eur, { amount: 2000, payer: ann, shares: { [bob.id]: 1000 } }); // €10
    await addExpense(ann, twd, { amount: 100000, payer: ann, shares: { [bob.id]: 50000 }, currencyIso: 'TWD' }); // NT$500
    const { body } = await ann.api.get('/dash/balance');
    assert.deepEqual(body.currencies.map(c => c.iso), ['TWD', 'EUR'], 'most money first');
    assert.deepEqual(totals(body), { EUR: { lent: 1000, owed: 0 }, TWD: { lent: 50000, owed: 0 } });
});

test('what I owe in one currency does not net against what is owed to me in another', async () => {
    const [ann, bob] = await Promise.all(['Ann', 'Bob'].map(createUser));
    const eur = await createGroup([ann, bob], { title: 'Home' });
    const twd = await createGroup([ann, bob], { title: 'Taiwan', currencyIso: 'TWD' });
    await addExpense(ann, eur, { amount: 2000, payer: ann, shares: { [bob.id]: 1000 } }); // Bob owes Ann €10
    await addExpense(bob, twd, { amount: 100000, payer: bob, shares: { [ann.id]: 50000 }, currencyIso: 'TWD' }); // Ann owes Bob NT$500
    assert.deepEqual(totals((await ann.api.get('/dash/balance')).body), { EUR: { lent: 1000, owed: 0 }, TWD: { lent: 0, owed: 50000 } });
    assert.deepEqual(totals((await bob.api.get('/dash/balance')).body), { EUR: { lent: 0, owed: 1000 }, TWD: { lent: 50000, owed: 0 } });
});

test('a foreign-currency expense counts in its group\'s currency', async () => {
    const [ann, bob] = await Promise.all(['Ann', 'Bob'].map(createUser));
    const eur = await createGroup([ann, bob]);
    await addExpense(ann, eur, { amount: 100000, payer: ann, shares: { [bob.id]: 50000 }, currencyIso: 'TWD' }); // NT$500 in a euro group = €14
    assert.deepEqual(totals((await ann.api.get('/dash/balance')).body), { EUR: { lent: 1400, owed: 0 } });
});

test('all settled: no currencies at all', async () => {
    const [ann, bob] = await Promise.all(['Ann', 'Bob'].map(createUser));
    const g = await createGroup([ann, bob]);
    await addExpense(ann, g, { amount: 2000, payer: ann, shares: { [bob.id]: 1000 } });
    await bob.api.post('/settlements', { groupId: g, amount: 1000, currencyIso: 'EUR', date: '2026-10-02', paidByUserId: bob.id, receivedByUserId: ann.id });
    assert.deepEqual((await ann.api.get('/dash/balance')).body.currencies, []);
});
