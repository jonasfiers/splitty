// The Home screen's totals and the Friends page (2026-11-20): what is open
// across all groups, netted per person; and per friend, per group.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopApi, createUser, createGroup, addExpense } = require('./helpers');

before(setup);
after(stopApi);

test('the Home total adds up the groups, netted per person', async () => {
    const [ann, bob, cas] = await Promise.all(['Ann', 'Bob', 'Cas'].map(createUser));
    const g1 = await createGroup([ann, bob, cas], { title: 'Flat' });
    const g2 = await createGroup([ann, bob], { title: 'Trip' });
    await addExpense(ann, g1, { amount: 3000, payer: ann, shares: { [bob.id]: 1000, [cas.id]: 1000 } }); // Bob, Cas owe Ann 10 each
    await addExpense(bob, g2, { amount: 800, payer: bob, shares: { [ann.id]: 400 } }); // Ann owes Bob 4
    await addExpense(cas, g1, { amount: 600, payer: cas, shares: { [ann.id]: 600 } }); // Ann owes Cas 6
    const ann$ = (await ann.api.get('/dash/balance')).body;
    // Bob: 10 − 4 = 6 to Ann; Cas: 10 − 6 = 4 to Ann.
    assert.equal(ann$.balanceLent, 1000);
    assert.equal(ann$.balanceOwed, 0);
    const bob$ = (await bob.api.get('/dash/balance')).body;
    assert.equal(bob$.balanceOwed, 600);
    assert.equal(bob$.balanceLent, 0);
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

test('the Home total with groups in different currencies', {
    todo: 'KNOWN ISSUE (2026-11-20): /dash/balance adds each group\'s minor units as they are (NT$500 counts as 50000, i.e. "€500"); the app shows the sum as euros. No live group uses another currency yet.',
}, async () => {
    const [ann, bob] = await Promise.all(['Ann', 'Bob'].map(createUser));
    const eur = await createGroup([ann, bob], { title: 'Home' });
    const twd = await createGroup([ann, bob], { title: 'Taiwan', currencyIso: 'TWD' });
    await addExpense(ann, eur, { amount: 2000, payer: ann, shares: { [bob.id]: 1000 } }); // €10
    await addExpense(ann, twd, { amount: 100000, payer: ann, shares: { [bob.id]: 50000 }, currencyIso: 'TWD' }); // NT$500 ≈ €14
    const { body } = await ann.api.get('/dash/balance');
    assert.ok(Math.abs(body.balanceLent - 2400) < 50, `expected about €24.00 owed to Ann, got ${body.balanceLent} minor units`);
});
