// Receipts on expenses (2026-11-21, receiptService.js): any member of the
// group adds, opens and removes them; nobody outside the group gets near
// them; they go, from the graph and the disk, with their expense or group;
// they stay when the uploader leaves; and they are in the uploader's export.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { unzipSync } = require('fflate');
const { setup, stopApi, createUser, createGroup, addExpense, run, uploadDir, BASE, DATES } = require('./helpers');


const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
const PDF = Buffer.from('%PDF-1.4\n%receipt\n');
const raw = url => fetch(BASE + url);

// The smallest JPEG start the server checks for, as a stand-in preview.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('thumbnail')]);

// Adds a receipt as `who` (with a preview when `thumb` is given); returns the response.
function addReceipt(who, expenseId, { bytes = PNG, type = 'image/png', name = 'bill.png', thumb } = {}) {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), name);
    if (thumb) form.append('thumbnail', new Blob([thumb], { type: 'image/jpeg' }), 'thumb.jpg');
    return who.api.post(`/expenses/${expenseId}/receipts`, form);
}
const receiptsOf = async (who, expenseId) => (await who.api.get(`/expenses/${expenseId}`)).body.expense.receipts;
const filesOnDisk = () => fs.readdirSync(uploadDir()).length;

let ann, bob, dan;
before(async () => {
    await setup({ deletion: true });
    [ann, bob, dan] = await Promise.all(['Ann', 'Bob', 'Dan'].map(createUser));
});
after(stopApi);

test('a member adds a receipt; every member sees and opens it; the file is exactly what was sent', async () => {
    const g = await createGroup([ann, bob]);
    const e = (await addExpense(ann, g, { amount: 3000, payer: ann, shares: { [bob.id]: 1500 } })).body.id;
    const up = await addReceipt(bob, e, { name: 'Dinner bill.png' });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.receipt.filename, 'Dinner bill.png');

    const [r] = await receiptsOf(ann, e);
    assert.equal(r.filename, 'Dinner bill.png');
    assert.equal(r.uploadedBy, 'Bob');
    assert.equal(r.size, PNG.length);
    assert.equal(r.storedName, undefined, 'the name on disk stays on the server');
    assert.match(r.url, /^\/trips\/files\/[0-9a-f-]+\?sig=/);
    const res = await raw(r.url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);

    const listed = await bob.api.get(`/expenses/${e}/receipts`);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.receipts.map(x => x.id), [r.id]);
});

test('someone outside the group can not list, add, open or remove receipts', async () => {
    const g = await createGroup([ann, bob]);
    const e = (await addExpense(ann, g, { amount: 1000, payer: ann, shares: { [bob.id]: 500 } })).body.id;
    await addReceipt(ann, e);
    const [r] = await receiptsOf(ann, e);
    const files = filesOnDisk();

    assert.equal((await dan.api.get(`/expenses/${e}/receipts`)).status, 404);
    assert.equal((await addReceipt(dan, e)).status, 404);
    assert.equal(filesOnDisk(), files, 'nothing written for a refused upload');
    assert.equal((await dan.api.del(`/expenses/receipts/${r.id}`)).status, 404);
    assert.equal((await receiptsOf(ann, e)).length, 1, 'still there');
    assert.equal((await raw(`/trips/files/${r.id}`)).status, 403, 'no link, no file');
});

test('only real PDFs and images, at most five per expense, and none on a settlement', async () => {
    const g = await createGroup([ann, bob]);
    const e = (await addExpense(ann, g, { amount: 1000, payer: ann, shares: { [bob.id]: 500 } })).body.id;
    const files = filesOnDisk();
    assert.equal((await addReceipt(ann, e, { bytes: Buffer.from('<script>alert(1)</script>'), type: 'image/png' })).status, 415, 'a PNG in name only');
    assert.equal((await addReceipt(ann, e, { bytes: Buffer.from('<html></html>'), type: 'text/html', name: 'x.html' })).status, 415);
    assert.equal((await addReceipt(ann, e, { bytes: Buffer.from('<svg/>'), type: 'image/svg+xml', name: 'x.svg' })).status, 415);
    assert.equal(filesOnDisk(), files);

    assert.equal((await addReceipt(ann, e, { bytes: PDF, type: 'application/pdf', name: 'bill.pdf' })).status, 201);
    for (let i = 0; i < 4; i++) assert.equal((await addReceipt(bob, e)).status, 201);
    const sixth = await addReceipt(ann, e);
    assert.equal(sixth.status, 400);
    assert.match(sixth.body.error, /at most 5/);
    assert.equal((await receiptsOf(ann, e)).length, 5);

    const s = await bob.api.post('/settlements', { groupId: g, amount: 500, currencyIso: 'EUR', date: DATES.d2, paidByUserId: bob.id, receivedByUserId: ann.id });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.equal((await addReceipt(ann, s.body.id ?? s.body.settlement?.id)).status, 404, 'settlements carry no receipts');
});

test('any member removes a receipt: gone from the expense, the disk and its link', async () => {
    const g = await createGroup([ann, bob]);
    const e = (await addExpense(ann, g, { amount: 1000, payer: ann, shares: { [bob.id]: 500 } })).body.id;
    await addReceipt(ann, e);
    const [r] = await receiptsOf(ann, e);
    const files = filesOnDisk();
    assert.equal((await bob.api.del(`/expenses/receipts/${r.id}`)).status, 200);
    assert.deepEqual(await receiptsOf(ann, e), []);
    assert.equal(filesOnDisk(), files - 1);
    assert.equal((await raw(r.url)).status, 404, 'its link opens nothing');
    assert.equal((await bob.api.del(`/expenses/receipts/${r.id}`)).status, 404, 'once');
});

test('deleting the expense takes its receipts with it', async () => {
    const g = await createGroup([ann, bob]);
    const e = (await addExpense(ann, g, { amount: 1000, payer: ann, shares: { [bob.id]: 500 } })).body.id;
    await addReceipt(ann, e);
    await addReceipt(bob, e, { bytes: PDF, type: 'application/pdf', name: 'bill.pdf' });
    const files = filesOnDisk();
    assert.equal((await ann.api.del(`/expenses/${e}`)).status, 200);
    const { records } = await run('MATCH (r:Receipt) WHERE NOT (r)-[:RECEIPT_OF]->() RETURN count(r) AS n');
    assert.equal(Number(records[0].get('n')), 0, 'no receipt left without its expense');
    assert.equal(filesOnDisk(), files - 2);
});

test('the last member leaving removes the group with its receipts', async () => {
    const g = await createGroup([ann]);
    const e = (await addExpense(ann, g, { amount: 500, payer: ann })).body.id;
    await addReceipt(ann, e);
    const files = filesOnDisk();
    const res = await ann.api.del(`/groups/${g}/${ann.id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.groupRemoved, true);
    const { records } = await run('MATCH (r:Receipt) RETURN count(r) AS n');
    const left = Number(records[0].get('n'));
    assert.equal(filesOnDisk(), files - 1);
    assert.ok(!(await run('MATCH (r:Receipt) WHERE NOT (r)-[:RECEIPT_OF]->() RETURN r')).records.length, `${left} receipts left, none orphaned`);
});

test("a receipt stays with the group when its uploader deletes their account", async () => {
    const [cas, eve] = await Promise.all(['Cas', 'Eve'].map(createUser));
    const g = await createGroup([cas, eve]);
    const e = (await addExpense(eve, g, { amount: 1000, payer: eve, shares: { [cas.id]: 500 } })).body.id;
    await addReceipt(cas, e);
    assert.equal((await cas.api.del(`/users/${cas.id}`, { confirmEmail: cas.email })).status, 200);
    const [r] = await receiptsOf(eve, e);
    assert.equal(r.uploadedBy, 'Deleted user');
    assert.equal((await raw(r.url)).status, 200);
});

test('the export holds the receipts on your expenses, and the files you added', async () => {
    const g = await createGroup([ann, bob]);
    const e = (await addExpense(ann, g, { amount: 1000, payer: ann, shares: { [bob.id]: 500 }, description: 'Export me' })).body.id;
    await addReceipt(ann, e, { name: 'mine.png' });
    await addReceipt(bob, e, { bytes: PDF, type: 'application/pdf', name: 'bobs.pdf' });
    const res = await fetch(`${BASE}/dash/export`, { headers: { Authorization: `Bearer ${ann.token}`, 'X-Forwarded-For': '10.9.9.9' } });
    assert.equal(res.status, 200);
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const data = JSON.parse(Buffer.from(zip['data.json']).toString('utf8'));
    const exp = data.expenses.find(x => x.id === e);
    assert.deepEqual(exp.receipts.map(r => r.filename).sort(), ['bobs.pdf', 'mine.png']);
    const mine = exp.receipts.find(r => r.filename === 'mine.png');
    assert.ok(mine.includedAs && zip[mine.includedAs], 'your own file is in the zip');
    assert.deepEqual(Buffer.from(zip[mine.includedAs]), PNG);
    assert.equal(exp.receipts.find(r => r.filename === 'bobs.pdf').includedAs, null, "someone else's is listed, not included");
});

test('a photo can come with a small preview: served on its own link, gone with the receipt', async () => {
    const g = await createGroup([ann, bob]);
    const e = (await addExpense(ann, g, { amount: 1000, payer: ann, shares: { [bob.id]: 500 } })).body.id;
    const files = filesOnDisk();
    const up = await addReceipt(ann, e, { thumb: JPEG });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(filesOnDisk(), files + 2, 'the photo and its preview');
    const [r] = await receiptsOf(bob, e);
    assert.match(r.thumbUrl, /^\/trips\/files\/[0-9a-f-]+\/thumb\?sig=/);
    const thumb = await raw(r.thumbUrl);
    assert.equal(thumb.status, 200);
    assert.equal(thumb.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await thumb.arrayBuffer()), JPEG);
    assert.deepEqual(Buffer.from(await (await raw(r.url)).arrayBuffer()), PNG, 'the link without /thumb is the receipt itself');
    assert.equal((await raw(`/trips/files/${r.id}/thumb`)).status, 403, 'a preview needs the signature too');

    const withoutThumb = await addReceipt(ann, e);
    const plain = (await receiptsOf(ann, e)).find(x => x.id === withoutThumb.body.receipt.id);
    assert.equal(plain.thumbUrl, null, 'no preview sent, none offered');
    assert.equal((await raw(plain.url.replace('?', '/thumb?'))).status, 404);

    assert.equal((await bob.api.del(`/expenses/receipts/${r.id}`)).status, 200);
    assert.equal(filesOnDisk(), files + 1, 'both files of the removed receipt are gone');
    assert.equal((await ann.api.del(`/expenses/${e}`)).status, 200);
    assert.equal(filesOnDisk(), files, 'and the rest with the expense');
});

test('a preview that is not a small JPEG is refused, and nothing is kept', async () => {
    const g = await createGroup([ann, bob]);
    const e = (await addExpense(ann, g, { amount: 1000, payer: ann, shares: { [bob.id]: 500 } })).body.id;
    const files = filesOnDisk();
    assert.equal((await addReceipt(ann, e, { thumb: Buffer.from('<svg onload=alert(1)>') })).status, 415);
    assert.equal((await addReceipt(ann, e, { thumb: Buffer.concat([JPEG, Buffer.alloc(300 * 1024)]) })).status, 415, 'too big to be a preview');
    assert.equal(filesOnDisk(), files);
    assert.deepEqual(await receiptsOf(ann, e), []);
});

test('receipts show in the Activity feed: added and removed, for the group only, linked to their expense', async () => {
    const g = await createGroup([ann, bob]);
    const e = (await addExpense(ann, g, { amount: 2000, payer: ann, shares: { [bob.id]: 1000 }, description: 'Night market' })).body.id;
    const r = (await addReceipt(bob, e, { name: 'stall.png' })).body.receipt;
    const rows = async who => (await who.api.get('/dash/activity')).body.activities.filter(a => a.kind === 'receipt' && a.groupId === g);

    const [added] = await rows(ann);
    assert.ok(added, 'a member sees the receipt being added');
    assert.equal(added.action, 'UPLOADED_BY');
    assert.equal(added.userName, 'Bob');
    assert.equal(added.expenseId, e);
    assert.equal(added.description, 'Night market', 'the expense is the subject');
    assert.equal(added.filename, 'stall.png');
    assert.equal(added.amount, undefined, 'no amount: the row is not a new expense');
    assert.deepEqual(await rows(dan), [], 'someone outside the group sees nothing');

    assert.equal((await ann.api.del(`/expenses/receipts/${r.id}`)).status, 200);
    const after = await rows(bob);
    assert.equal(after.length, 1, 'the upload row goes with the receipt; a removal row takes its place');
    assert.equal(after[0].action, 'DELETED_BY');
    assert.equal(after[0].userName, 'Ann');
    assert.equal(after[0].description, 'Night market');
    assert.equal(after[0].filename, 'stall.png');

    await addReceipt(bob, e);
    assert.equal((await ann.api.del(`/expenses/${e}`)).status, 200);
    const gone = (await bob.api.get('/dash/activity')).body.activities.filter(a => a.groupId === g);
    assert.equal(gone.filter(a => a.kind === 'receipt' && a.action === 'UPLOADED_BY').length, 0, 'receipts deleted with their expense leave no upload rows');
    assert.equal(gone.filter(a => a.kind === 'receipt' && a.action === 'DELETED_BY').length, 1, 'and no extra removal rows: the expense deletion covers them');
});
