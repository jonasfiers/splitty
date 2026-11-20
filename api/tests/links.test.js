// Links that work without signing in (2026-11-20): group invites, signed
// attachment links and follow-my-trip links. Each must give exactly what it
// is for and nothing more, and can not be guessed, forged, reused or kept
// working once revoked.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { setup, stopApi, createUser, createGroup, client, run, testSecret, BASE } = require('./helpers');

let ann, bob, cas, dan, g, tripId, itemId;
before(async () => {
    await setup();
    [ann, bob, cas, dan] = await Promise.all(['Ann', 'Bob', 'Cas', 'Dan'].map(createUser));
    g = await createGroup([ann, bob], { title: 'Travellers' });
    const start = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const trip = await ann.api.post('/trips', { groupId: g, title: 'Lisbon', startDate: start, endDate: end, notes: 'SECRET-TRIP-NOTE' });
    tripId = trip.body.id;
    const item = await ann.api.post(`/trips/${tripId}/items`, {
        kind: 'activity', title: 'Tile museum', start: `${start}T10:00`, confirmationRef: 'SECRET-REF-123',
        notes: 'SECRET-ITEM-NOTE', tickets: [{ code: 'SECRET-TICKET-CODE', format: 'qr', name: 'Ann' }],
    });
    assert.equal(item.status, 201, JSON.stringify(item.body));
    itemId = item.body.id;
});
after(stopApi);

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
const raw = (url, headers = {}) => fetch(BASE + url, { headers });

// ── Invites ──

test('an invite: only members make one; it shows only the group\'s name; it works once', async () => {
    assert.equal((await dan.api.post(`/invites/groups/${g}`)).status, 403, 'an outsider can not invite');
    const { body } = await ann.api.post(`/invites/groups/${g}`);
    assert.match(body.token, /^[0-9a-f]{64}$/);
    const info = await client(null).get(`/invites/${body.token}`);
    assert.equal(info.status, 200);
    assert.deepEqual(Object.keys(info.body.group).sort(), ['icon', 'id', 'title']);
    assert.ok(!JSON.stringify(info.body).includes(ann.email) && !JSON.stringify(info.body).includes(ann.id), 'no members in it');
    assert.equal((await client(null).post(`/invites/${body.token}/redeem`)).status, 401, 'joining needs an account');
    assert.equal((await cas.api.post(`/invites/${body.token}/redeem`)).status, 200);
    assert.equal((await cas.api.get(`/groups/${g}`)).status, 200, 'Cas is in');
    assert.equal((await dan.api.post(`/invites/${body.token}/redeem`)).status, 404, 'used up');
    assert.equal((await dan.api.get(`/groups/${g}`)).status, 404);
});

test('an expired or made-up invite gets nothing', async () => {
    const { body } = await ann.api.post(`/invites/groups/${g}`);
    await run('MATCH (t:Token:Invite {token: $token}) SET t.expiresAt = datetime() - duration("PT1M")', { token: body.token });
    assert.equal((await client(null).get(`/invites/${body.token}`)).status, 404);
    assert.equal((await dan.api.post(`/invites/${body.token}/redeem`)).status, 404);
    for (const token of ['0'.repeat(64), 'abc', "x' OR 1=1 --"]) {
        assert.equal((await dan.api.post(`/invites/${encodeURIComponent(token)}/redeem`)).status, 404, token);
    }
    assert.equal((await dan.api.get(`/groups/${g}`)).status, 404);
});

// ── Signed attachment links ──

// Uploads a file to the item; returns that attachment (with its signed url).
async function attach() {
    const known = new Set(((await ann.api.get(`/trips/items/${itemId}`)).body.item.attachments || []).map(a => a.id));
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'ticket.png');
    const up = await ann.api.post(`/trips/items/${itemId}/attachments`, form);
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const fresh = (await ann.api.get(`/trips/items/${itemId}`)).body.item.attachments.filter(a => !known.has(a.id));
    assert.equal(fresh.length, 1);
    return fresh[0];
}

test('an attachment link opens the file without signing in, and only that file', async () => {
    const a = await attach();
    assert.match(a.url, /^\/trips\/files\/[0-9a-f-]+\?sig=/);
    const res = await raw(a.url);
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
    const b = await attach();
    assert.notEqual(a.id, b.id);
    const sigOfA = new URL(a.url, BASE).searchParams.get('sig');
    assert.equal((await raw(`/trips/files/${b.id}?sig=${sigOfA}`)).status, 403, "a's link does not open b");
    assert.equal((await raw(`/trips/files/${a.id}`)).status, 403, 'no signature');
    assert.equal((await raw(`/trips/files/${a.id}?sig=${sigOfA.slice(0, -2)}xx`)).status, 403, 'tampered');
});

test('attachment links can not be forged from a session, outlive their 5 minutes, or be used as a session', async () => {
    const a = await attach();
    const sig = new URL(a.url, BASE).searchParams.get('sig');
    assert.equal((await raw(`/trips/files/${a.id}?sig=${ann.token}`)).status, 403, 'a session token is not a file link');
    const withMainKey = jwt.sign({ att: a.id }, testSecret(), { expiresIn: '5m' });
    assert.equal((await raw(`/trips/files/${a.id}?sig=${withMainKey}`)).status, 403, 'signed with the session key: refused');
    const expired = jwt.sign({ att: a.id, exp: Math.floor(Date.now() / 1000) - 10 }, `${testSecret()}:trip-attachment`);
    assert.equal((await raw(`/trips/files/${a.id}?sig=${expired}`)).status, 403, 'expired');
    assert.equal((await client(sig).get('/groups')).status, 401, 'a file link is not a session');
    assert.equal((await dan.api.get(`/trips/items/${itemId}`)).status, 404, 'outsiders never get a link');
    assert.equal((await ann.api.del(`/trips/attachments/${a.id}`)).status, 200);
    assert.equal((await raw(a.url)).status, 404, 'a deleted file is gone, link or not');
});

test("a private trip document is only listed (and linked) for its owner", async () => {
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'passport.png');
    const up = await ann.api.post(`/trips/${tripId}/documents`, form);
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const mine = await ann.api.get(`/trips/${tripId}/documents`);
    assert.ok(mine.body.documents.some(d => d.filename === 'passport.png' && d.url));
    const bobs = await bob.api.get(`/trips/${tripId}/documents`);
    assert.ok(!JSON.stringify(bobs.body).includes('passport.png'), 'a fellow member does not see it');
    assert.equal((await dan.api.get(`/trips/${tripId}/documents`)).status, 404);
});

// ── Follow-my-trip links ──

test('a follow link shows the plan so far and nothing private', async () => {
    assert.equal((await dan.api.post(`/trips/${tripId}/follow-links`, {})).status, 404, 'outsiders can not make one');
    const made = await ann.api.post(`/trips/${tripId}/follow-links`, { photos: false });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const { token } = made.body.link;
    const view = await client(null).get(`/follow/${token}`);
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.equal(view.body.trip.title, 'Lisbon');
    assert.ok(view.body.items.some(i => i.title === 'Tile museum'));
    const text = JSON.stringify(view.body);
    for (const secret of ['SECRET-TRIP-NOTE', 'SECRET-REF-123', 'SECRET-ITEM-NOTE', 'SECRET-TICKET-CODE', ann.email, bob.email, ann.id, bob.id, g, 'attachment', 'expense']) {
        assert.ok(!text.includes(secret), `the public view leaks "${secret}"`);
    }
    assert.equal((await client(null).get(`/follow/${token}/meta`)).status, 200);
    assert.equal((await dan.api.get(`/trips/${tripId}/follow-links`)).status, 404, 'outsiders can not list them');
});

test('a revoked follow link stops at once; made-up ones never work', async () => {
    const { body } = await ann.api.post(`/trips/${tripId}/follow-links`, { photos: false });
    const { token } = body.link;
    assert.equal((await client(null).get(`/follow/${token}`)).status, 200);
    assert.equal((await dan.api.del(`/trips/${tripId}/follow-links/${token}`)).status, 404, 'outsiders can not revoke');
    assert.equal((await bob.api.del(`/trips/${tripId}/follow-links/${token}`)).status, 200, 'any member can');
    assert.equal((await client(null).get(`/follow/${token}`)).status, 404, 'gone immediately, not after a cache');
    for (const fake of [token.replace(/.$/, c => (c === 'a' ? 'b' : 'a')), 'abc', '../../etc/passwd']) {
        assert.equal((await client(null).get(`/follow/${encodeURIComponent(fake)}`)).status, 404, fake);
    }
});
