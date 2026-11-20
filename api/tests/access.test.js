// Who may see and change what (2026-11-20). A group's expenses, balances and
// members are for its members only; someone outside gets nothing back and
// can change nothing, whichever route they try. Without a valid session,
// every protected route answers 401.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { setup, stopApi, createUser, createGroup, addExpense, balances, client, run, DATES } = require('./helpers');

let ann, bob, dan, g, expenseId, other;
before(async () => {
    await setup();
    [ann, bob, dan] = await Promise.all(['Ann', 'Bob', 'Dan'].map(createUser));
    g = await createGroup([ann, bob], { title: 'Private' });
    other = await createGroup([dan], { title: "Dan's" });
    const res = await addExpense(ann, g, { amount: 2000, payer: ann, shares: { [bob.id]: 1000 }, description: 'Secret dinner' });
    expenseId = res.body.id;
});
after(stopApi);

const unchanged = async () => {
    assert.deepEqual(await balances(ann, g), { [ann.id]: 1000, [bob.id]: -1000 }, 'the group must be untouched');
    const e = await ann.api.get(`/expenses/${expenseId}`);
    assert.equal(e.body.expense.description, 'Secret dinner');
    assert.equal(e.body.expense.amount, 2000);
};

// Nothing about the group in a response: no title, description or member.
const leaksNothing = (res, label) => {
    const text = JSON.stringify(res.body);
    for (const secret of ['Private', 'Secret dinner', ann.id, bob.id]) {
        assert.ok(!text.includes(secret), `${label} leaks "${secret}": ${res.status} ${text.slice(0, 200)}`);
    }
};

test('an outsider cannot read the group, its expenses, shares, history or members', async () => {
    const reads = [
        `/groups/${g}`, `/groups/${g}/expenses`, `/groups/${g}/members`, `/groups/${g}/category-totals`,
        `/groups/${g}/shared-groups/${ann.id}`, `/expenses/${expenseId}`, `/expenses/${expenseId}/history`,
        `/shares/expense/${expenseId}`, `/shares/expense/${expenseId}/excludePayer`, `/users/${ann.id}`, '/users', '/groups',
    ];
    for (const url of reads) {
        const res = await dan.api.get(url);
        assert.ok(res.status < 500, `${url} → ${res.status} ${JSON.stringify(res.body)}`);
        leaksNothing(res, url);
    }
});

test('an outsider cannot change the group or its expenses', async () => {
    const tries = [
        ['put', `/expenses/${expenseId}`, { groupId: g, description: 'Hacked', categoryId: 'cat-food', amount: 1, currencyIso: 'EUR', date: DATES.d1, paidByUserId: ann.id, shares: [] }],
        ['put', `/expenses/${expenseId}`, { groupId: other, description: 'Moved', categoryId: 'cat-food', amount: 2000, currencyIso: 'EUR', date: DATES.d1, paidByUserId: dan.id, shares: [] }],
        ['del', `/expenses/${expenseId}`],
        ['post', '/expenses', { groupId: g, description: 'Planted', categoryId: 'cat-food', amount: 5000, currencyIso: 'EUR', date: DATES.d1, paidByUserId: dan.id, shares: [{ userId: ann.id, amount: 5000 }] }],
        ['post', '/expenses', { groupId: g, description: 'Planted', categoryId: 'cat-food', amount: 5000, currencyIso: 'EUR', date: DATES.d1, paidByUserId: ann.id, shares: [{ userId: bob.id, amount: 5000 }] }],
        ['post', '/settlements', { groupId: g, amount: 1000, currencyIso: 'EUR', date: DATES.d1, paidByUserId: bob.id, receivedByUserId: ann.id }],
        ['post', '/settlements/transfer', { sourceGroupId: g, targetGroupId: other, targetUserId: ann.id }],
        ['post', `/groups/${g}/${dan.id}`],
        ['del', `/groups/${g}/${bob.id}`],
        ['put', `/groups/${g}`, { title: 'Renamed', currencyIso: 'USD', icon: 'x' }],
        ['post', '/shares', { expenseId, userId: bob.id, amount: 1 }],
        ['del', `/shares/expense/${expenseId}/user/${bob.id}`],
    ];
    for (const [method, url, body] of tries) {
        const res = await dan.api[method](url, body);
        assert.ok([400, 403, 404, 405, 409].includes(res.status), `${method} ${url} → ${res.status} ${JSON.stringify(res.body)}`);
    }
    await unchanged();
    const groups = await ann.api.get(`/groups/${g}`);
    assert.equal(groups.body.groups[0].title, 'Private');
    assert.equal(groups.body.groups[0].memberCount, 2);
});

test('a member cannot put a debt on someone outside the group, or bypass the share checks', async () => {
    const outsider = await ann.api.post('/shares', { expenseId, userId: dan.id, amount: 500 });
    assert.ok(outsider.status >= 400 && outsider.status < 500, `share for an outsider → ${outsider.status} ${JSON.stringify(outsider.body)}`);
    const self = await ann.api.post('/shares', { expenseId, userId: ann.id, amount: 500 });
    assert.ok(self.status >= 400 && self.status < 500, `share for the payer → ${self.status}`);
    const huge = await ann.api.post('/shares', { expenseId, userId: bob.id, amount: 999999 });
    assert.ok(huge.status >= 400 && huge.status < 500, `share over the total → ${huge.status}`);
    const { records } = await run('MATCH (:Expense {id: $expenseId})-[o:OWED_BY]->(u:User) RETURN u.id AS u, o.amount AS a', { expenseId });
    assert.deepEqual(records.map(r => [r.get('u'), Number(r.get('a'))]), [[bob.id, 1000]]);
    const dash = await dan.api.get('/dash/balance');
    assert.deepEqual(dash.body.currencies, [], 'Dan owes nothing');
    await unchanged();
});

test("an outsider's dashboard holds nothing from the group", async () => {
    for (const url of ['/dash/balance', '/dash/groups', '/dash/activity', '/dash/friends', '/dash/recent-spend', '/dash/insights']) {
        const res = await dan.api.get(url);
        assert.equal(res.status, 200, `${url} → ${res.status} ${JSON.stringify(res.body)}`);
        leaksNothing(res, url);
    }
});

test('a member who left loses access', async () => {
    const h = await createGroup([ann, bob], { title: 'Short stay' });
    const e = await addExpense(ann, h, { amount: 400, payer: ann, shares: { [bob.id]: 200 } });
    await bob.api.post('/settlements', { groupId: h, amount: 200, currencyIso: 'EUR', date: DATES.d1, paidByUserId: bob.id, receivedByUserId: ann.id });
    assert.equal((await bob.api.del(`/groups/${h}/${bob.id}`)).status, 200);
    assert.equal((await bob.api.get(`/groups/${h}`)).status, 404);
    assert.equal((await bob.api.get(`/expenses/${e.body.id}`)).body.success, false);
    const edit = await bob.api.del(`/expenses/${e.body.id}`);
    assert.equal(edit.status, 404);
});

test('without a valid session every protected route answers 401', async () => {
    const anonymous = client(null);
    const wrongKey = client(jwt.sign({ id: ann.id, email: ann.email, name: 'Ann' }, 'not-the-secret'));
    const urls = ['/groups', `/groups/${g}`, `/expenses/${expenseId}`, '/dash/balance', '/users', '/trips', `/shares/expense/${expenseId}`];
    for (const c of [anonymous, wrongKey]) {
        for (const url of urls) {
            const res = await c.get(url);
            assert.equal(res.status, 401, `${url} → ${res.status}`);
        }
        assert.equal((await c.post('/expenses', { groupId: g })).status, 401);
    }
});

test('a session from before a password change no longer works', async () => {
    // Set before Eve's first request: the API caches a session state for 60 s.
    const eve = await createUser('Eve');
    await run('MATCH (u:User {id: $id}) SET u.sessionsValidFrom = $t', { id: eve.id, t: Math.floor(Date.now() / 1000) + 5 });
    assert.equal((await eve.api.get('/groups')).status, 401);
});

test('a token for an account that does not exist answers 401', async () => {
    const eve = await createUser('Zed');
    await run('MATCH (u:User {id: $id}) DETACH DELETE u', { id: eve.id });
    assert.equal((await eve.api.get('/groups')).status, 401);
});
