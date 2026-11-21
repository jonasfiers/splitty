// File previews (2026-11-21, fileUpload.js): every uploaded file (trip item
// file, trip document, receipt) may come with a small JPEG preview, served
// under the file's own signed link at /thumb. A file without one gets one
// from the first phone that shows it, once, and only from someone who can see
// the file. Previews never outlive their file, and the names on disk never
// leave the server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setup, stopApi, createUser, createGroup, addExpense, uploadDir, BASE } = require('./helpers');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('preview')]);
const raw = url => fetch(BASE + url);
const filesOnDisk = () => (fs.existsSync(uploadDir()) ? fs.readdirSync(uploadDir()).length : 0);

function form({ file = PNG, name = 'ticket.png', thumb, fields = {} } = {}) {
    const f = new FormData();
    if (file) f.append('file', new Blob([file], { type: 'image/png' }), name);
    if (thumb) f.append('thumbnail', new Blob([thumb], { type: 'image/jpeg' }), 'thumbnail.jpg');
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    return f;
}

let ann, bob, dan, g, tripId, itemId;
before(async () => {
    await setup({ deletion: true });
    [ann, bob, dan] = await Promise.all(['Ann', 'Bob', 'Dan'].map(createUser));
    g = await createGroup([ann, bob]);
    tripId = (await ann.api.post('/trips', { groupId: g, title: 'Porto', startDate: '2026-12-01', endDate: '2026-12-05' })).body.id;
    itemId = (await ann.api.post(`/trips/${tripId}/items`, { kind: 'activity', title: 'Port cellar', start: '2026-12-02T15:00' })).body.id;
});
after(stopApi);

const attachmentsOf = async who => (await who.api.get(`/trips/items/${itemId}`)).body.item.attachments;
const documentsOf = async who => (await who.api.get(`/trips/${tripId}/documents`)).body.documents;

test('a trip file with a preview: listed with its preview link, both files gone when it is deleted', async () => {
    const files = filesOnDisk();
    const up = await ann.api.post(`/trips/items/${itemId}/attachments`, form({ name: 'cellar.png', thumb: JPEG }));
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(filesOnDisk(), files + 2);
    const a = (await attachmentsOf(bob)).find(x => x.filename === 'cellar.png');
    assert.match(a.thumbUrl, /\/thumb\?sig=/);
    assert.deepEqual(Buffer.from(await (await raw(a.thumbUrl)).arrayBuffer()), JPEG);
    const listing = JSON.stringify(await bob.api.get(`/trips/items/${itemId}`));
    assert.ok(!/storedName/i.test(listing), 'no names on disk in the listing');
    assert.equal((await ann.api.del(`/trips/attachments/${a.id}`)).status, 200);
    assert.equal(filesOnDisk(), files);
});

test('a document with a preview: only its owner sees either while it is private', async () => {
    const up = await bob.api.post(`/trips/${tripId}/documents`, form({ name: 'visa.png', thumb: JPEG }));
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const mine = (await documentsOf(bob)).find(d => d.filename === 'visa.png');
    assert.match(mine.thumbUrl, /\/thumb\?sig=/);
    assert.ok(!(await documentsOf(ann)).some(d => d.filename === 'visa.png'));
    assert.ok(!/storedName/i.test(JSON.stringify(await documentsOf(bob))));
});

test('a file without a preview gets one, once, from someone who can see it', async () => {
    const up = await ann.api.post(`/trips/items/${itemId}/attachments`, form({ name: 'old.png' }));
    assert.equal(up.status, 201);
    const a = (await attachmentsOf(ann)).find(x => x.filename === 'old.png');
    assert.equal(a.thumbUrl, null);
    const files = filesOnDisk();

    assert.equal((await dan.api.post(`/trips/files/${a.id}/thumb`, form({ file: null, thumb: JPEG }))).status, 404, 'an outsider can not');
    assert.equal((await bob.api.post(`/trips/files/${a.id}/thumb`, form({ file: null, thumb: Buffer.from('<svg/>') }))).status, 415, 'only a small JPEG');
    assert.equal((await bob.api.post(`/trips/files/${a.id}/thumb`, form({ file: null }))).status, 400, 'a preview has to be sent');
    assert.equal(filesOnDisk(), files, 'nothing kept from refused tries');

    assert.equal((await bob.api.post(`/trips/files/${a.id}/thumb`, form({ file: null, thumb: JPEG }))).status, 201, 'a fellow member can');
    assert.equal(filesOnDisk(), files + 1);
    const other = Buffer.concat([JPEG, Buffer.from('-swapped')]);
    assert.equal((await ann.api.post(`/trips/files/${a.id}/thumb`, form({ file: null, thumb: other }))).status, 409, 'never over an existing preview');
    assert.equal(filesOnDisk(), files + 1);
    const now = (await attachmentsOf(ann)).find(x => x.id === a.id);
    assert.deepEqual(Buffer.from(await (await raw(now.thumbUrl)).arrayBuffer()), JPEG, 'the first preview stays');
});

test("someone else's private document gets no preview from a fellow member", async () => {
    await bob.api.post(`/trips/${tripId}/documents`, form({ name: 'passport.png' }));
    const doc = (await documentsOf(bob)).find(d => d.filename === 'passport.png');
    assert.equal((await ann.api.post(`/trips/files/${doc.id}/thumb`, form({ file: null, thumb: JPEG }))).status, 404);
    assert.equal((await bob.api.post(`/trips/files/${doc.id}/thumb`, form({ file: null, thumb: JPEG }))).status, 201, 'its owner can');
});

test('a receipt without a preview gets one the same way', async () => {
    const e = (await addExpense(ann, g, { amount: 1000, payer: ann, shares: { [bob.id]: 500 } })).body.id;
    const up = await ann.api.post(`/expenses/${e}/receipts`, form({ name: 'bill.png' }));
    assert.equal(up.status, 201);
    const id = up.body.receipt.id;
    assert.equal((await dan.api.post(`/trips/files/${id}/thumb`, form({ file: null, thumb: JPEG }))).status, 404);
    assert.equal((await bob.api.post(`/trips/files/${id}/thumb`, form({ file: null, thumb: JPEG }))).status, 201);
    const [r] = (await ann.api.get(`/expenses/${e}`)).body.expense.receipts;
    assert.match(r.thumbUrl, /\/thumb\?sig=/);
});

test('deleting an item, a trip, or the account takes the previews with the files', async () => {
    const t2 = (await ann.api.post('/trips', { groupId: g, title: 'Braga', startDate: '2026-12-10', endDate: '2026-12-11' })).body.id;
    const i2 = (await ann.api.post(`/trips/${t2}/items`, { kind: 'activity', title: 'Cathedral', start: '2026-12-10T10:00' })).body.id;
    const i3 = (await ann.api.post(`/trips/${t2}/items`, { kind: 'activity', title: 'Garden', start: '2026-12-10T14:00' })).body.id;
    const start = filesOnDisk();
    await ann.api.post(`/trips/items/${i2}/attachments`, form({ thumb: JPEG }));
    await ann.api.post(`/trips/items/${i3}/attachments`, form({ thumb: JPEG }));
    await ann.api.post(`/trips/${t2}/documents`, form({ thumb: JPEG, fields: { shared: 'true' } }));
    assert.equal(filesOnDisk(), start + 6);
    assert.equal((await ann.api.del(`/trips/items/${i2}`)).status, 200);
    assert.equal(filesOnDisk(), start + 4, 'the item: its file and preview');
    assert.equal((await ann.api.del(`/trips/${t2}`)).status, 200);
    assert.equal(filesOnDisk(), start, 'the trip: everything in it');

    const [cas] = await Promise.all(['Cas'].map(createUser));
    const g2 = await createGroup([cas, ann]);
    const t3 = (await cas.api.post('/trips', { groupId: g2, title: 'Faro', startDate: '2026-12-20', endDate: '2026-12-21' })).body.id;
    await cas.api.post(`/trips/${t3}/documents`, form({ thumb: JPEG, fields: { shared: 'true' } }));
    assert.equal(filesOnDisk(), start + 2);
    assert.equal((await cas.api.del(`/users/${cas.id}`, { confirmEmail: cas.email })).status, 200);
    assert.equal(filesOnDisk(), start, 'account deletion: their documents and previews');
});
