// Settling up (2026-11-20): a settlement is an expense the debtor pays and the
// creditor "owes" in full, so it cancels the debt. It cannot be edited, only
// cancelled (deleted). A balance transfer moves what two people owe each other
// in one group into another group they share.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopApi, createUser, createGroup, addExpense, balances, DATES } = require('./helpers');

let ann, bob, cas;
before(async () => {
    await setup();
    [ann, bob, cas] = await Promise.all(['Ann', 'Bob', 'Cas'].map(createUser));
});
after(stopApi);

const settle = (as, groupId, { from, to, amount, currencyIso = 'EUR' }) => as.api.post('/settlements', {
    groupId, amount, currencyIso, date: DATES.d2, paidByUserId: from.id, receivedByUserId: to.id,
});

test('settling a debt brings both balances to zero', async () => {
    const g = await createGroup([ann, bob]);
    await addExpense(ann, g, { amount: 2000, payer: ann, shares: { [bob.id]: 1000 } });
    const res = await settle(bob, g, { from: bob, to: ann, amount: 1000 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(await balances(ann, g), { [ann.id]: 0, [bob.id]: 0 });
    const list = await ann.api.get(`/groups/${g}/expenses`);
    assert.equal(list.body.expenses.filter(e => e.isSettlement).length, 1);
});

test('a partial settlement leaves the rest owed', async () => {
    const g = await createGroup([ann, bob, cas]);
    await addExpense(ann, g, { amount: 3000, payer: ann, shares: { [bob.id]: 1000, [cas.id]: 1000 } });
    await settle(cas, g, { from: cas, to: ann, amount: 400 });
    assert.deepEqual(await balances(ann, g), { [ann.id]: 1600, [bob.id]: -1000, [cas.id]: -600 });
});

test('a settlement cannot be edited, only cancelled; cancelling brings the debt back', async () => {
    const g = await createGroup([ann, bob]);
    await addExpense(ann, g, { amount: 2000, payer: ann, shares: { [bob.id]: 1000 } });
    const { body } = await settle(bob, g, { from: bob, to: ann, amount: 1000 });
    const edit = await bob.api.put(`/expenses/${body.id}`, {
        groupId: g, description: 'x', categoryId: 'cat-food', amount: 1, currencyIso: 'EUR', date: DATES.d2, paidByUserId: bob.id, shares: [],
    });
    assert.equal(edit.status, 409, JSON.stringify(edit.body));
    assert.equal((await bob.api.del(`/expenses/${body.id}`)).status, 200);
    assert.deepEqual(await balances(ann, g), { [ann.id]: 1000, [bob.id]: -1000 });
});

test('a settlement is refused with someone outside the group or missing fields', async () => {
    const g = await createGroup([ann, bob]);
    const outsider = await settle(ann, g, { from: ann, to: cas, amount: 100 });
    assert.equal(outsider.status, 400, JSON.stringify(outsider.body));
    const missing = await ann.api.post('/settlements', { groupId: g, amount: 100, currencyIso: 'EUR' });
    assert.equal(missing.status, 400);
    assert.deepEqual(await balances(ann, g), { [ann.id]: 0, [bob.id]: 0 });
});

test('a balance transfer settles one group and carries the debt into the other', async () => {
    const trip = await createGroup([ann, bob], { title: 'Trip' });
    const home = await createGroup([ann, bob, cas], { title: 'Home' });
    await addExpense(ann, trip, { amount: 5000, payer: ann, shares: { [bob.id]: 2500 } });
    const res = await bob.api.post('/settlements/transfer', { sourceGroupId: trip, targetGroupId: home, targetUserId: ann.id });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(await balances(ann, trip), { [ann.id]: 0, [bob.id]: 0 });
    assert.deepEqual(await balances(ann, home), { [ann.id]: 2500, [bob.id]: -2500, [cas.id]: 0 });
    // Cancelling either half removes both.
    assert.equal((await ann.api.del(`/expenses/${res.body.transferId}`)).status, 200);
    assert.deepEqual(await balances(ann, trip), { [ann.id]: 2500, [bob.id]: -2500 });
    assert.deepEqual(await balances(ann, home), { [ann.id]: 0, [bob.id]: 0, [cas.id]: 0 });
    const nothing = await bob.api.post('/settlements/transfer', { sourceGroupId: home, targetGroupId: trip, targetUserId: ann.id });
    assert.equal(nothing.status, 400, 'nothing to transfer');
});

test('a balance transfer into a group in another currency converts the amount', async () => {
    const trip = await createGroup([ann, bob], { title: 'Taiwan', currencyIso: 'TWD' });
    const home = await createGroup([ann, bob], { title: 'Home', currencyIso: 'EUR' });
    await addExpense(ann, trip, { amount: 100000, payer: ann, shares: { [bob.id]: 50000 }, currencyIso: 'TWD' }); // NT$500 owed
    const res = await ann.api.post('/settlements/transfer', { sourceGroupId: trip, targetGroupId: home, targetUserId: bob.id });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(await balances(ann, trip), { [ann.id]: 0, [bob.id]: 0 });
    // NT$500 × 0.028 = €14.00
    assert.deepEqual(await balances(ann, home), { [ann.id]: 1400, [bob.id]: -1400 });
});

test('leaving a group needs a settled balance', async () => {
    const g = await createGroup([ann, bob, cas]);
    await addExpense(ann, g, { amount: 2000, payer: ann, shares: { [bob.id]: 1000 } });
    const refused = await bob.api.del(`/groups/${g}/${bob.id}`);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.code, 'BALANCE_OPEN');
    const pushed = await cas.api.del(`/groups/${g}/${ann.id}`);
    assert.equal(pushed.status, 409, 'nobody can remove someone who is owed money');
    await settle(bob, g, { from: bob, to: ann, amount: 1000 });
    const left = await bob.api.del(`/groups/${g}/${bob.id}`);
    assert.equal(left.status, 200, JSON.stringify(left.body));
    assert.equal(left.body.groupRemoved, false);
    assert.equal((await bob.api.get(`/groups/${g}`)).status, 404, 'gone from the group after leaving');
    assert.deepEqual(await balances(ann, g), { [ann.id]: 0, [cas.id]: 0 });
});

test('the last member leaving removes the group with everything in it', async () => {
    const g = await createGroup([ann]);
    await addExpense(ann, g, { amount: 500, payer: ann });
    const res = await ann.api.del(`/groups/${g}/${ann.id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.groupRemoved, true);
    const { run } = require('./helpers');
    const { records } = await run('MATCH (g:Group {id: $g}) RETURN g UNION ALL MATCH (e:Expense)-[:BALANCE_IN]->(:Group {id: $g}) RETURN e AS g', { g });
    assert.equal(records.length, 0);
});
