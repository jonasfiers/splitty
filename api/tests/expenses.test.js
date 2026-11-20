// Expenses and the balances they make (2026-11-20). Amounts are minor units
// (cents); each expense stores the others' shares, the payer's own share is
// what is left. A member's balance = what others owe them − what they owe.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopApi, createUser, createGroup, addExpense, balances } = require('./helpers');

let ann, bob, cas, dan;
before(async () => {
    await setup();
    [ann, bob, cas, dan] = await Promise.all(['Ann', 'Bob', 'Cas', 'Dan'].map(createUser));
});
after(stopApi);

const sum = o => Object.values(o).reduce((t, v) => t + v, 0);

test('an equal three-way split', async () => {
    const g = await createGroup([ann, bob, cas]);
    const res = await addExpense(ann, g, { amount: 3000, payer: ann, shares: { [bob.id]: 1000, [cas.id]: 1000 } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const b = await balances(ann, g);
    assert.deepEqual(b, { [ann.id]: 2000, [bob.id]: -1000, [cas.id]: -1000 });
    assert.equal(sum(b), 0);
});

test('an uneven split: the payer keeps the rest, someone left out owes nothing', async () => {
    const g = await createGroup([ann, bob, cas]);
    await addExpense(bob, g, { amount: 1000, payer: ann, shares: { [bob.id]: 700 } });
    assert.deepEqual(await balances(ann, g), { [ann.id]: 700, [bob.id]: -700, [cas.id]: 0 });
});

test('balances add up over several expenses and payers', async () => {
    const g = await createGroup([ann, bob, cas]);
    await addExpense(ann, g, { amount: 3000, payer: ann, shares: { [bob.id]: 1000, [cas.id]: 1000 } });
    await addExpense(bob, g, { amount: 1200, payer: bob, shares: { [ann.id]: 400, [cas.id]: 400 } });
    await addExpense(cas, g, { amount: 999, payer: cas, shares: { [ann.id]: 333, [bob.id]: 333 } });
    const b = await balances(bob, g);
    assert.deepEqual(b, { [ann.id]: 2000 - 400 - 333, [bob.id]: 800 - 1000 - 333, [cas.id]: 666 - 1000 - 400 });
    assert.equal(sum(b), 0);
});

test("the payer's own entry in the shares is ignored", async () => {
    const g = await createGroup([ann, bob]);
    const res = await addExpense(ann, g, { amount: 1000, payer: ann, shares: { [ann.id]: 500, [bob.id]: 500 } });
    assert.equal(res.status, 201);
    assert.deepEqual(await balances(ann, g), { [ann.id]: 500, [bob.id]: -500 });
});

test('refused, and nothing written: shares over the total, a non-member, twice the same person, no category, an outside payer', async () => {
    const g = await createGroup([ann, bob, cas]);
    const cases = [
        [{ amount: 1000, payer: ann, shares: { [bob.id]: 600, [cas.id]: 600 } }, /more than the total/],
        [{ amount: 1000, payer: ann, shares: { [dan.id]: 500 } }, /member of the group/],
        [{ amount: 1000, payer: ann, shares: { [bob.id]: 300 }, categoryId: 'no-such-category' }, /category/i],
        [{ amount: 1000, payer: dan, shares: { [bob.id]: 300 } }, /payer must be a member/],
    ];
    for (const [expense, message] of cases) {
        const res = await addExpense(ann, g, expense);
        assert.equal(res.status, 400, `${JSON.stringify(expense)} → ${res.status} ${JSON.stringify(res.body)}`);
        assert.match(res.body.error, message);
    }
    const twice = await ann.api.post('/expenses', {
        groupId: g, description: 'x', categoryId: 'cat-groceries', amount: 1000, currencyIso: 'EUR', date: '2026-10-01',
        paidByUserId: ann.id, shares: [{ userId: bob.id, amount: 100 }, { userId: bob.id, amount: 200 }],
    });
    assert.equal(twice.status, 400);
    assert.match(twice.body.error, /twice/);
    const list = await ann.api.get(`/groups/${g}/expenses`);
    assert.equal(list.body.expenses.length, 0);
    assert.deepEqual(await balances(ann, g), { [ann.id]: 0, [bob.id]: 0, [cas.id]: 0 });
});

test('editing the amount and shares moves the balances, and is in the history', async () => {
    const g = await createGroup([ann, bob, cas]);
    const { body } = await addExpense(ann, g, { amount: 3000, payer: ann, shares: { [bob.id]: 1000, [cas.id]: 1000 } });
    const res = await bob.api.put(`/expenses/${body.id}`, {
        groupId: g, description: 'Dinner', categoryId: 'cat-food', amount: 4500, currencyIso: 'EUR', date: '2026-10-02',
        paidByUserId: ann.id, shares: [{ userId: bob.id, amount: 1500 }, { userId: cas.id, amount: 2000 }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.changed, true);
    assert.deepEqual(await balances(cas, g), { [ann.id]: 3500, [bob.id]: -1500, [cas.id]: -2000 });
    const one = await cas.api.get(`/expenses/${body.id}`);
    assert.equal(one.body.expense.amount, 4500);
    assert.equal(one.body.expense.description, 'Dinner');
    const shares = await cas.api.get(`/shares/expense/${body.id}`);
    assert.equal(shares.status, 200);
    const history = await cas.api.get(`/expenses/${body.id}/history`);
    assert.equal(history.status, 200);
    assert.ok(history.body.history.length >= 2, `history: ${JSON.stringify(history.body)}`);
});

test('changing who paid (shares sent along) moves the balance to the new payer', async () => {
    const g = await createGroup([ann, bob, cas]);
    const { body } = await addExpense(ann, g, { amount: 3000, payer: ann, shares: { [bob.id]: 1000, [cas.id]: 1000 } });
    const res = await ann.api.put(`/expenses/${body.id}`, {
        groupId: g, description: 'Test expense', categoryId: 'cat-groceries', amount: 3000, currencyIso: 'EUR', date: '2026-10-01',
        paidByUserId: bob.id, shares: [{ userId: ann.id, amount: 1000 }, { userId: cas.id, amount: 1000 }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await balances(ann, g), { [ann.id]: -1000, [bob.id]: 2000, [cas.id]: -1000 });
});

test('changing who paid without sending shares: the new payer never owes themselves', async () => {
    const g = await createGroup([ann, bob, cas]);
    const { body } = await addExpense(ann, g, { amount: 3000, payer: ann, shares: { [bob.id]: 1000, [cas.id]: 1000 } });
    const res = await ann.api.put(`/expenses/${body.id}`, {
        groupId: g, description: 'Test expense', categoryId: 'cat-groceries', amount: 3000, currencyIso: 'EUR', date: '2026-10-01',
        paidByUserId: bob.id,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const b = await balances(ann, g);
    assert.equal(sum(b), 0, `balances must add up to zero: ${JSON.stringify(b)}`);
    // Bob's own share became his remainder; Cas still owes hers, now to Bob.
    assert.deepEqual(b, { [ann.id]: 0, [bob.id]: 1000, [cas.id]: -1000 });
});

test('deleting an expense takes it out of the balances', async () => {
    const g = await createGroup([ann, bob]);
    const keep = await addExpense(ann, g, { amount: 1000, payer: ann, shares: { [bob.id]: 500 } });
    const gone = await addExpense(bob, g, { amount: 2000, payer: bob, shares: { [ann.id]: 2000 } });
    assert.equal((await bob.api.del(`/expenses/${gone.body.id}`)).status, 200);
    assert.deepEqual(await balances(ann, g), { [ann.id]: 500, [bob.id]: -500 });
    assert.equal((await ann.api.get(`/expenses/${gone.body.id}`)).body.success, false);
    assert.equal((await ann.api.get(`/expenses/${keep.body.id}`)).body.success, true);
    assert.equal((await bob.api.del(`/expenses/${gone.body.id}`)).status, 404, 'deleting twice');
});

test("the group's expense list shows each one with my share", async () => {
    const g = await createGroup([ann, bob, cas]);
    await addExpense(ann, g, { amount: 3000, payer: ann, shares: { [bob.id]: 1000, [cas.id]: 1000 }, description: 'Groceries' });
    await addExpense(ann, g, { amount: 800, payer: ann, shares: { [cas.id]: 800 }, description: 'Taxi' });
    const { status, body } = await bob.api.get(`/groups/${g}/expenses`);
    assert.equal(status, 200);
    const byName = Object.fromEntries(body.expenses.map(e => [e.description, e]));
    assert.equal(byName.Groceries.shareAmount, 1000);
    assert.equal(byName.Taxi.shareAmount, null);
    assert.equal(byName.Groceries.paidByUserId, ann.id);
    const filtered = await bob.api.get(`/groups/${g}/expenses?keyword=tax`);
    assert.deepEqual(filtered.body.expenses.map(e => e.description), ['Taxi']);
});
