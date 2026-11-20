// Trips belong to a group (2026-11-20): only its members see them, their
// items and documents, or can change them.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopApi, createUser, createGroup } = require('./helpers');

let ann, bob, dan, g, tripId, itemId;
before(async () => {
    await setup();
    [ann, bob, dan] = await Promise.all(['Ann', 'Bob', 'Dan'].map(createUser));
    g = await createGroup([ann, bob], { title: 'Travellers' });
    const trip = await ann.api.post('/trips', { groupId: g, title: 'Secret trip', startDate: '2026-12-01', endDate: '2026-12-10' });
    assert.equal(trip.status, 201, JSON.stringify(trip.body));
    tripId = trip.body.id;
    const item = await ann.api.post(`/trips/${tripId}/items`, { kind: 'activity', title: 'Hidden museum', start: '2026-12-02T10:00', confirmationRef: 'ABC123' });
    assert.equal(item.status, 201, JSON.stringify(item.body));
    itemId = item.body.id;
});
after(stopApi);

test('members see the trip and its items', async () => {
    const res = await bob.api.get(`/trips/${tripId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.trip.title, 'Secret trip');
    assert.ok(res.body.items.some(i => i.title === 'Hidden museum'));
    const list = await bob.api.get('/trips');
    assert.ok(list.body.trips.some(t => t.id === tripId));
});

test('an outsider sees none of it', async () => {
    for (const url of [`/trips/${tripId}`, `/trips/items/${itemId}`, `/trips/${tripId}/documents`, `/trips/${tripId}/follow-links`, '/trips', `/trips?groupId=${g}`]) {
        const res = await dan.api.get(url);
        assert.ok(res.status < 500, `${url} → ${res.status}`);
        const text = JSON.stringify(res.body);
        for (const secret of ['Secret trip', 'Hidden museum', 'ABC123']) assert.ok(!text.includes(secret), `${url} leaks "${secret}"`);
    }
});

test('an outsider cannot change, add to or delete the trip', async () => {
    const tries = [
        ['put', `/trips/${tripId}`, { title: 'Hacked', startDate: '2026-12-01', endDate: '2026-12-10' }],
        ['post', `/trips/${tripId}/items`, { kind: 'activity', title: 'Planted', start: '2026-12-03T10:00' }],
        ['put', `/trips/items/${itemId}`, { kind: 'activity', title: 'Hacked', start: '2026-12-02T10:00' }],
        ['del', `/trips/items/${itemId}`],
        ['post', `/trips/items/${itemId}/tickets`, { tickets: [{ code: 'X', format: 'qr' }] }],
        ['del', `/trips/${tripId}`],
        ['post', '/trips', { groupId: g, title: 'Planted trip', startDate: '2026-12-01', endDate: '2026-12-02' }],
    ];
    for (const [method, url, body] of tries) {
        const res = await dan.api[method](url, body);
        assert.ok([400, 403, 404].includes(res.status), `${method} ${url} → ${res.status} ${JSON.stringify(res.body)}`);
    }
    const res = await ann.api.get(`/trips/${tripId}`);
    assert.equal(res.body.trip.title, 'Secret trip');
    assert.deepEqual(res.body.items.map(i => i.title), ['Hidden museum']);
    assert.equal((await ann.api.get('/trips')).body.trips.length, 1);
});
