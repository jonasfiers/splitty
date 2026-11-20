// Deleting an account (2026-11-20; GDPR erasure, accountDeletion.js and the
// privacy page's promises): the account is anonymised at once and its
// sessions stop working; groups nobody else is in go with everything in them;
// shared groups keep their expenses (others' balances stay right) under
// "Deleted user"; its trip documents go. And it stays deleted after a
// database restore: the deletion list re-applies it when the API starts.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, stopApi, restartApi, createUser, createGroup, addExpense, balances, run, mailbox, deletionListFile, uploadDir, client } = require('./helpers');

before(() => setup({ deletion: true }));
after(stopApi);

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const remove = (who, confirmEmail = who.email) => who.api.del(`/users/${who.id}`, { confirmEmail });

test('deleting needs the account\'s own address typed out, and only your own account', async () => {
    const [ann, bob] = await Promise.all(['Ann', 'Bob'].map(createUser));
    assert.equal((await remove(ann, 'wrong@example.test')).status, 400);
    assert.equal((await ann.api.del(`/users/${bob.id}`, { confirmEmail: bob.email })).status, 403);
    assert.equal((await ann.api.get('/groups')).status, 200, 'nothing happened');
    assert.equal((await bob.api.get('/groups')).status, 200);
});

test('a deleted account is anonymised at once, its sessions end, and it is on the deletion list', async () => {
    const ann = await createUser('Ann');
    await run(`MATCH (u:User {id: $id}) SET u.pendingEmail = 'x@example.test', u.avatarEmoji = '🐱'
               CREATE (:Passkey {credentialId: 'pk-1'})-[:BELONGS_TO]->(u)
               CREATE (u)-[:HAS_SUBSCRIPTION]->(:PushSubscription {endpoint: 'https://push.example.test/1'})`, { id: ann.id });
    const res = await remove(ann);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.complete, true);
    assert.equal((await ann.api.get('/groups')).status, 401, 'the session ends immediately');
    const { records } = await run('MATCH (u:User {id: $id}) RETURN properties(u) AS p, COUNT { (u)<-[:BELONGS_TO]-() } AS passkeys, COUNT { (u)-[:HAS_SUBSCRIPTION]->() } AS subs', { id: ann.id });
    const props = records[0].get('p');
    assert.deepEqual(Object.keys(props).sort(), ['deleted', 'deletedAt', 'id', 'name'], `left: ${JSON.stringify(props)}`);
    assert.equal(props.name, 'Deleted user');
    assert.equal(Number(records[0].get('passkeys')), 0);
    assert.equal(Number(records[0].get('subs')), 0);
    assert.ok(fs.readFileSync(deletionListFile(), 'utf8').includes(ann.id));
    await mailbox.waitFor(ann.email, /Your Splitty account has been deleted/);
    assert.equal((await client(null).post('/auth/login', { email: ann.email, password: 'whatever it was' })).status, 401);
});

test('groups only they were in go with everything; shared groups keep the money right', async () => {
    const [ann, bob] = await Promise.all(['Ann', 'Bob'].map(createUser));
    const solo = await createGroup([ann], { title: 'Only Ann' });
    await addExpense(ann, solo, { amount: 500, payer: ann });
    const shared = await createGroup([ann, bob], { title: 'Shared' });
    const e = await addExpense(ann, shared, { amount: 3000, payer: ann, shares: { [bob.id]: 1500 } });
    assert.equal((await remove(ann)).status, 200);
    const { records } = await run('MATCH (g:Group {id: $solo}) RETURN g UNION ALL MATCH (x:Expense)-[:BALANCE_IN]->(:Group {id: $solo}) RETURN x AS g', { solo });
    assert.equal(records.length, 0, 'the solo group and its expenses are gone');
    assert.deepEqual(await balances(bob, shared), { [ann.id]: 1500, [bob.id]: -1500 }, 'Bob still owes what he owed');
    const one = await bob.api.get(`/expenses/${e.body.id}`);
    assert.equal(one.body.expense.paidByName, 'Deleted user');
    const members = await bob.api.get(`/groups/${shared}/members`);
    assert.ok(!JSON.stringify(members.body).includes(ann.email), 'no trace of the address');
});

test('their trip documents go, from the database and the disk', async () => {
    const [ann, bob] = await Promise.all(['Ann', 'Bob'].map(createUser));
    const g = await createGroup([ann, bob]);
    const trip = await ann.api.post('/trips', { groupId: g, title: 'Trip', startDate: '2026-12-01', endDate: '2026-12-05' });
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'passport.png');
    const up = await ann.api.post(`/trips/${trip.body.id}/documents`, form);
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const before = fs.readdirSync(uploadDir()).length;
    assert.equal((await remove(ann)).status, 200);
    const { records } = await run('MATCH (d:Document) RETURN count(d) AS n');
    assert.equal(Number(records[0].get('n')), 0);
    assert.equal(fs.readdirSync(uploadDir()).length, before - 1, 'the file is removed from disk');
    assert.equal((await bob.api.get(`/trips/${trip.body.id}`)).status, 200, 'the shared trip itself stays');
});

test('after a database restore brings the account back, starting the API deletes it again', async () => {
    const ann = await createUser('Ann');
    const bob = await createUser('Bob');
    const g = await createGroup([ann, bob]);
    await addExpense(ann, g, { amount: 1000, payer: ann, shares: { [bob.id]: 500 } });
    assert.equal((await remove(ann)).status, 200);
    // A restore from before the deletion: the account as it was.
    await run(`MATCH (u:User {id: $id}) REMOVE u.deleted, u.deletedAt SET u.name = 'Ann', u.email = $email, u.password = 'hash', u.emailVerified = true`, { id: ann.id, email: ann.email });
    await restartApi();
    const { records } = await run('MATCH (u:User {id: $id}) RETURN properties(u) AS p', { id: ann.id });
    assert.deepEqual(Object.keys(records[0].get('p')).sort(), ['deleted', 'deletedAt', 'id', 'name'], `after restart: ${JSON.stringify(records[0].get('p'))}`);
    assert.equal((await ann.api.get('/groups')).status, 401, 'old sessions still refused after the restart');
    assert.deepEqual(await balances(bob, g), { [ann.id]: 500, [bob.id]: -500 });
});

test('the deletion list folder missing (a lost mount) stops the API rather than serving restored accounts', async () => {
    const list = deletionListFile();
    const marker = path.join(path.dirname(list), '.splitty-deletion-list');
    const kept = fs.readFileSync(marker);
    fs.rmSync(marker);
    try {
        await assert.rejects(restartApi(), /API exited|deletion list|mount/i);
    } finally {
        fs.writeFileSync(marker, kept);
    }
    await restartApi();
});
