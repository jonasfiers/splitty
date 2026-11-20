// Expenses in another currency than the group's (2026-11-20). Each expense
// keeps the rate of its date (rateSnapshot, already scaled between the two
// currencies' minor units); balances are in the group currency's minor units.
// The rates here are the fixed made-up ones from helpers.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopApi, createUser, createGroup, addExpense, balances, DATES } = require('./helpers');

let ann, bob;
before(async () => {
    await setup();
    [ann, bob] = await Promise.all(['Ann', 'Bob'].map(createUser));
});
after(stopApi);

// Each converted share is rounded once (money.js shareInGroupCurrency), so
// balances are whole minor units: compared exactly.
const near = (actual, expected, label) => {
    for (const [id, v] of Object.entries(expected)) {
        assert.ok(Number.isInteger(actual[id]), `${label}: ${id} is ${actual[id]}, not a whole minor unit`);
        assert.equal(actual[id], v, `${label}: ${id}`);
    }
};

test('TWD in a euro group: converted at the rate of the date', async () => {
    const g = await createGroup([ann, bob]);
    const res = await addExpense(ann, g, { amount: 10000, payer: ann, shares: { [bob.id]: 5000 }, currencyIso: 'TWD' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    near(await balances(ann, g), { [ann.id]: 140, [bob.id]: -140 }, 'NT$50 × 0.028');
    const one = await ann.api.get(`/expenses/${res.body.id}`);
    assert.equal(one.body.expense.currencyIso, 'TWD');
    assert.equal(one.body.expense.groupCurrencyIso, 'EUR');
    assert.equal(one.body.expense.amount, 10000, 'the amount stays as entered');
    assert.equal(one.body.expense.amountBase, 280);
});

test('yen (no minor unit) in a euro group: ¥500 is €3.10', async () => {
    const g = await createGroup([ann, bob]);
    const res = await addExpense(ann, g, { amount: 1000, payer: ann, shares: { [bob.id]: 500 }, currencyIso: 'JPY' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    near(await balances(ann, g), { [ann.id]: 310, [bob.id]: -310 }, '¥500 × 0.0062');
});

test('mixed currencies add up, and still sum to zero', async () => {
    const g = await createGroup([ann, bob]);
    await addExpense(ann, g, { amount: 3000, payer: ann, shares: { [bob.id]: 1500 } }); // €15
    await addExpense(bob, g, { amount: 2000, payer: bob, shares: { [ann.id]: 1000 }, currencyIso: 'USD' }); // $10 = €9.20
    const b = await balances(ann, g);
    near(b, { [ann.id]: 1500 - 920, [bob.id]: 920 - 1500 }, '€15 − $10');
    assert.ok(Math.abs(b[ann.id] + b[bob.id]) < 1e-6);
});

test('editing the currency or date re-converts with that day\'s rate', async () => {
    const g = await createGroup([ann, bob]);
    const { body } = await addExpense(ann, g, { amount: 2000, payer: ann, shares: { [bob.id]: 1000 } });
    const res = await ann.api.put(`/expenses/${body.id}`, {
        groupId: g, description: 'x', categoryId: 'cat-food', amount: 2000, currencyIso: 'USD', date: DATES.d2,
        paidByUserId: ann.id, shares: [{ userId: bob.id, amount: 1000 }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    near(await balances(ann, g), { [ann.id]: 920, [bob.id]: -920 }, '$10 × 0.92');
});

test('a euro expense in a TWD group', async () => {
    const g = await createGroup([ann, bob], { currencyIso: 'TWD' });
    await addExpense(ann, g, { amount: 1000, payer: ann, shares: { [bob.id]: 1000 } }); // €10 → NT$357
    near(await balances(ann, g), { [ann.id]: 35700, [bob.id]: -35700 }, '€10 × 35.7');
});

test('an unknown currency is refused', async () => {
    const g = await createGroup([ann, bob]);
    const res = await addExpense(ann, g, { amount: 1000, payer: ann, shares: { [bob.id]: 500 }, currencyIso: 'XXX' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.error, /currency/i);
});

test('uneven shares in another currency: each share rounded once, balances whole cents adding up to zero', async () => {
    const cas = await createUser('Cas');
    const g = await createGroup([ann, bob, cas]);
    // NT$100, Bob NT$33.43 (93.604 cents), Cas NT$16.71 (46.788 cents)
    await addExpense(ann, g, { amount: 10000, payer: ann, shares: { [bob.id]: 3343, [cas.id]: 1671 }, currencyIso: 'TWD' });
    assert.deepEqual(await balances(ann, g), { [ann.id]: 141, [bob.id]: -94, [cas.id]: -47 });
});

test('after settling up as the app suggests, everyone can leave', async () => {
    const cas = await createUser('Cas');
    const g = await createGroup([ann, bob, cas]);
    await addExpense(ann, g, { amount: 10000, payer: ann, shares: { [bob.id]: 3343, [cas.id]: 1671 }, currencyIso: 'TWD' });
    const b = await balances(ann, g); // +141, −94, −47 (shares rounded once)
    // The app's plan (web/src/utils/settlePlan.js, greedy on the balances):
    // Ann is owed 141, Bob pays 94 and Cas 47. (Before shares were rounded
    // once, Ann showed 140, Cas could pay only 46 and was stuck a cent short.)
    const owedToAnn = Math.round(b[ann.id]);
    const bobPays = Math.min(-Math.round(b[bob.id]), owedToAnn);
    const casPays = Math.min(-Math.round(b[cas.id]), owedToAnn - bobPays);
    for (const [who, amount] of [[bob, bobPays], [cas, casPays]]) {
        await who.api.post('/settlements', { groupId: g, amount, currencyIso: 'EUR', date: DATES.d2, paidByUserId: who.id, receivedByUserId: ann.id });
    }
    for (const who of [bob, cas, ann]) {
        const res = await who.api.del(`/groups/${g}/${who.id}`);
        if (res.status !== 200) assert.fail(`${who.name} leaving → ${res.status} ${JSON.stringify(res.body)}; balances now ${JSON.stringify(await balances(ann, g))}`);
    }
});
