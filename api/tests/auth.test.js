// Accounts and sessions (2026-11-20): signing up, verifying, signing in,
// resetting and changing a password, changing the email address. Mail is
// read from the tests' own mail catcher (mailbox.js), as a user would.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { setup, stopApi, client, run, mailbox, testSecret } = require('./helpers');

before(setup);
after(stopApi);

let n = 0;
const address = name => `${name}-${Date.now()}-${++n}@example.test`;
const PASSWORD = 'correct horse battery';

// Signs up and verifies through the mailed link; returns { email, token, api }.
async function signUp(name) {
    const email = address(name);
    const anon = client(null);
    const res = await anon.post('/auth/register', { name, email, password: PASSWORD });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const mail = await mailbox.waitFor(email, /Verify your Splitty email/);
    const verified = await anon.get(`/auth/verify-email?token=${mailbox.tokenIn(mail, 'verify-email')}`);
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    const login = await anon.post('/auth/login', { email, password: PASSWORD });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    return { email, token: login.body.token, api: client(login.body.token) };
}

test('sign up, verify through the mailed link, sign in', async () => {
    const email = address('Ann');
    const anon = client(null);
    assert.equal((await anon.post('/auth/register', { name: 'Ann', email, password: PASSWORD })).status, 201);
    const early = await anon.post('/auth/login', { email, password: PASSWORD });
    assert.equal(early.status, 403, 'no sign-in before the address is verified');
    assert.equal(early.body.code, 'EMAIL_NOT_VERIFIED');
    const mail = await mailbox.waitFor(email, /Verify your Splitty email/);
    const token = mailbox.tokenIn(mail, 'verify-email');
    assert.equal((await anon.get(`/auth/verify-email?token=${token}`)).status, 200);
    assert.equal((await anon.get(`/auth/verify-email?token=${token}`)).status, 400, 'a verification link works once');
    const login = await anon.post('/auth/login', { email: email.toUpperCase(), password: PASSWORD });
    assert.equal(login.status, 200, 'addresses are case-insensitive');
    assert.equal((await client(login.body.token).get('/groups')).status, 200);
});

test('signing up with an address that has an account says nothing, changes nothing, and tells the owner', async () => {
    const ann = await signUp('Ann');
    const sent = mailbox.to(ann.email).length;
    const again = await client(null).post('/auth/register', { name: 'Mallory', email: ann.email, password: 'another password!' });
    assert.equal(again.status, 201, 'the same answer as a new sign-up');
    assert.deepEqual(again.body, { success: true, verificationPending: true });
    await mailbox.waitFor(ann.email, /^Your Splitty account$/, sent);
    const { records } = await run('MATCH (u:User {email: $e}) RETURN u.name AS name', { e: ann.email.toLowerCase() });
    assert.deepEqual(records.map(r => r.get('name')), ['Ann'], 'still one account, unchanged');
    assert.equal((await client(null).post('/auth/login', { email: ann.email, password: 'another password!' })).status, 401);
    assert.equal((await client(null).post('/auth/login', { email: ann.email, password: PASSWORD })).status, 200);
});

test('a wrong password and an unknown address get the same answer', async () => {
    const ann = await signUp('Ann');
    const wrong = await client(null).post('/auth/login', { email: ann.email, password: 'not my password' });
    const unknown = await client(null).post('/auth/login', { email: address('nobody'), password: 'not my password' });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong, unknown);
});

test('sign-up refuses a short password, a bad address and a missing name', async () => {
    const anon = client(null);
    for (const body of [
        { name: 'Ann', email: address('a'), password: 'short' },
        { name: 'Ann', email: 'not-an-address', password: PASSWORD },
        { name: '', email: address('a'), password: PASSWORD },
        { name: 'Ann', email: address('a'), password: 'x'.repeat(129) },
    ]) {
        const res = await anon.post('/auth/register', body);
        assert.equal(res.status, 400, JSON.stringify(body));
    }
});

test('password reset: an unknown address gets the same answer and no mail', async () => {
    const email = address('nobody');
    const res = await client(null).post('/auth/forgot-password', { email });
    assert.equal(res.status, 200);
    await new Promise(r => setTimeout(r, 500));
    assert.equal(mailbox.to(email).length, 0);
});

test('password reset signs out every device; the link works once; older links stop working', async () => {
    const ann = await signUp('Ann');
    const otherDevice = (await client(null).post('/auth/login', { email: ann.email, password: PASSWORD })).body.token;
    const anon = client(null);
    let sent = mailbox.to(ann.email).length;
    await anon.post('/auth/forgot-password', { email: ann.email });
    const first = mailbox.tokenIn(await mailbox.waitFor(ann.email, /Reset your Splitty password/, sent), 'reset-password');
    sent = mailbox.to(ann.email).length;
    await anon.post('/auth/forgot-password', { email: ann.email });
    const second = mailbox.tokenIn(await mailbox.waitFor(ann.email, /Reset your Splitty password/, sent), 'reset-password');
    assert.notEqual(first, second);
    assert.equal((await anon.post('/auth/reset-password', { token: first, password: 'new password 1' })).status, 400, 'an older link stops working once a newer one is sent');

    await new Promise(r => setTimeout(r, 1100)); // sessions are cut off by the second
    const reset = await anon.post('/auth/reset-password', { token: second, password: 'new password 2' });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal((await anon.post('/auth/reset-password', { token: second, password: 'new password 3' })).status, 400, 'used once');
    assert.equal((await ann.api.get('/groups')).status, 401, 'this device is signed out');
    assert.equal((await client(otherDevice).get('/groups')).status, 401, 'and every other one');
    assert.equal((await anon.post('/auth/login', { email: ann.email, password: PASSWORD })).status, 401, 'the old password is gone');
    const login = await anon.post('/auth/login', { email: ann.email, password: 'new password 2' });
    assert.equal(login.status, 200);
    assert.equal((await client(login.body.token).get('/groups')).status, 200);
});

test('an expired or made-up reset link is refused', async () => {
    const ann = await signUp('Ann');
    const sent = mailbox.to(ann.email).length;
    await client(null).post('/auth/forgot-password', { email: ann.email });
    const token = mailbox.tokenIn(await mailbox.waitFor(ann.email, /Reset your Splitty password/, sent), 'reset-password');
    await run('MATCH (t:Token:Password {token: $token}) SET t.expiresAt = datetime() - duration("PT1M")', { token });
    assert.equal((await client(null).post('/auth/reset-password', { token, password: 'new password!' })).status, 400);
    assert.equal((await client(null).post('/auth/reset-password', { token: 'a'.repeat(64), password: 'new password!' })).status, 400);
    assert.equal((await client(null).post('/auth/login', { email: ann.email, password: PASSWORD })).status, 200, 'the password is unchanged');
});

test('changing the password needs the current one, and signs out the other devices', async () => {
    const ann = await signUp('Ann');
    const otherDevice = (await client(null).post('/auth/login', { email: ann.email, password: PASSWORD })).body.token;
    const wrong = await ann.api.post('/auth/change-password', { currentPassword: 'not it', newPassword: 'brand new password' });
    assert.equal(wrong.status, 401);
    await new Promise(r => setTimeout(r, 1100));
    const res = await ann.api.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'brand new password' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await client(res.body.token).get('/groups')).status, 200, 'this device carries on with its new session');
    assert.equal((await client(otherDevice).get('/groups')).status, 401, 'other devices are signed out');
});

test('a new email address only counts once confirmed from that address, and can not take someone else\'s', async () => {
    const ann = await signUp('Ann');
    const bob = await signUp('Bob');
    const taken = await ann.api.put(`/users/${(await ann.api.get('/dash/profile')).body.profile.id}`, { email: bob.email });
    assert.equal(taken.status, 400, 'an address in use by another account');
    const annId = (await ann.api.get('/dash/profile')).body.profile.id;
    const fresh = address('ann-new');
    const res = await ann.api.put(`/users/${annId}`, { email: fresh });
    assert.equal(res.status, 200);
    assert.equal(res.body.emailChangePending, true);
    assert.equal((await client(null).post('/auth/login', { email: fresh, password: PASSWORD })).status, 401, 'not yet');
    const mail = await mailbox.waitFor(fresh, /Confirm your new Splitty email/);
    const done = await client(null).get(`/auth/verify-email-change?token=${mailbox.tokenIn(mail, 'verify-email-change')}`);
    assert.equal(done.status, 200);
    assert.equal((await client(null).post('/auth/login', { email: fresh, password: PASSWORD })).status, 200);
    assert.equal((await client(null).post('/auth/login', { email: ann.email, password: PASSWORD })).status, 401, 'the old address no longer signs in');
    const other = await bob.api.put(`/users/${annId}`, { name: 'Hacked' });
    assert.equal(other.status, 403, "nobody edits someone else's profile");
});

test('sessions: a forged, expired or unsigned token is refused', async () => {
    const ann = await signUp('Ann');
    const { id } = jwt.decode(ann.token);
    const forged = jwt.sign({ id, email: ann.email }, 'guessed-secret');
    const expired = jwt.sign({ id, email: ann.email, exp: Math.floor(Date.now() / 1000) - 60 }, testSecret());
    const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ id, email: ann.email })).toString('base64url')}.`;
    for (const token of [forged, expired, unsigned, 'garbage']) {
        assert.equal((await client(token).get('/groups')).status, 401, token.slice(0, 30));
    }
});

test('sign-in attempts are limited per address', async () => {
    const ip = '10.250.250.250';
    const anon = client(null, { ip });
    const statuses = [];
    for (let i = 0; i < 32; i++) statuses.push((await anon.post('/auth/login', { email: address('x'), password: 'guess' })).status);
    assert.equal(statuses[0], 401);
    assert.equal(statuses[31], 429, `statuses: ${statuses.join(',')}`);
    assert.equal((await client(null).post('/auth/login', { email: address('x'), password: 'guess' })).status, 401, 'another address is not affected');
});
