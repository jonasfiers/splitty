// Shared by the API tests (2026-11-20). Each test file gets a clean database
// and its own API process, and talks to it over HTTP like the app does.
//
// They run on CT116 against the tests' own Neo4j (scripts/test-api.sh), never
// against QA's or production's: assertTestDatabase() refuses any other port,
// and any database holding something without the test marker.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const neo4j = require('neo4j-driver');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');

const TEST_URI = 'bolt://127.0.0.1:7697';
const PORT = Number(process.env.TEST_API_PORT || 3099);
const BASE = `http://127.0.0.1:${PORT}`;
const API_DIR = path.join(__dirname, '..');

// Same values in every file, so a test can name them without looking up.
// `today`: balance transfers always use today's rate.
const DATES = { d1: '2026-10-01', d2: '2026-10-02', today: new Date().toISOString().slice(0, 10) };
const RATES = [
    // 1 TWD = 0.028 EUR, 1 JPY = 0.0062 EUR, 1 USD = 0.92 EUR (made up, fixed)
    { from: 'TWD', to: 'EUR', rate: 0.028 },
    { from: 'JPY', to: 'EUR', rate: 0.0062 },
    { from: 'USD', to: 'EUR', rate: 0.92 },
    { from: 'EUR', to: 'TWD', rate: 35.7 },
];

let driver;
function db() {
    if (process.env.NEO4J_URI !== TEST_URI) {
        throw new Error(`Refusing to run: NEO4J_URI is ${process.env.NEO4J_URI}, the tests only use ${TEST_URI}`);
    }
    driver ??= neo4j.driver(TEST_URI, neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD));
    return driver;
}
const run = (cypher, params = {}) => db().executeQuery(cypher, params);

// Empty, or marked as the tests' own: anything else stops everything.
async function assertTestDatabase() {
    const { records } = await run(
        'RETURN COUNT { (:SplittyTestDatabase) } AS marked, COUNT { () } AS nodes'
    );
    const marked = records[0].get('marked').toNumber();
    const nodes = records[0].get('nodes').toNumber();
    if (nodes > 0 && marked === 0) {
        throw new Error(`Refusing to wipe: the database at ${TEST_URI} holds ${nodes} nodes and no test marker`);
    }
}

// A clean database with what every test needs: currencies, categories and
// exchange rates (so no test ever asks the internet for one).
async function resetDatabase() {
    await assertTestDatabase();
    await run('MATCH (n) DETACH DELETE n'); // a few hundred nodes at most
    await run('CREATE (:SplittyTestDatabase {createdAt: datetime()})');
    await run(
        `UNWIND $currencies AS c CREATE (:Currency {iso: c.iso, label: c.label, symbol: c.symbol})`,
        { currencies: [
            { iso: 'EUR', label: 'Euro', symbol: '€' },
            { iso: 'TWD', label: 'New Taiwan dollar', symbol: 'NT$' },
            { iso: 'JPY', label: 'Japanese yen', symbol: '¥' },
            { iso: 'USD', label: 'US dollar', symbol: '$' },
        ] }
    );
    await run(
        `CREATE (food:Category {id: 'cat-food', name: 'Food', icon: 'utensils', colour: 'amber'})
         CREATE (:Category {id: 'cat-groceries', name: 'Groceries', icon: ''})-[:CHILD_OF]->(food)
         CREATE (:Category {id: 'cat-travel', name: 'Travel', icon: 'plane', colour: 'sky'})`
    );
    const rates = [];
    for (const date of new Set(Object.values(DATES))) for (const r of RATES) rates.push({ ...r, date });
    await run('UNWIND $rates AS r CREATE (:DailyRate {date: r.date, from: r.from, to: r.to, rate: r.rate})', { rates });
}

let secret;
// A verified user, made straight in the database, with a session token.
async function createUser(name) {
    const id = crypto.randomUUID();
    const email = `${name.toLowerCase()}-${id.slice(0, 8)}@example.test`;
    await run(
        `CREATE (:User {id: $id, name: $name, email: $email, password: 'not-a-hash', emailVerified: true})`,
        { id, name, email }
    );
    const token = jwt.sign({ id, email, name }, secret, { expiresIn: '1h' });
    return { id, name, email, token, api: client(token) };
}

// fetch, as the app calls the API. Answers { status, body }.
function client(token) {
    const call = async (method, url, body) => {
        const res = await fetch(BASE + url, {
            method,
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        return { status: res.status, body: parsed };
    };
    return {
        get: url => call('GET', url),
        post: (url, body) => call('POST', url, body ?? {}),
        put: (url, body) => call('PUT', url, body ?? {}),
        del: url => call('DELETE', url),
    };
}

let proc;
let workDir;
// The API itself, from this checkout, against the test database.
async function startApi() {
    secret = crypto.randomBytes(32).toString('hex');
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splitty-api-test-'));
    const vapid = webpush.generateVAPIDKeys();
    const output = [];
    proc = spawn(process.execPath, ['index.js'], {
        cwd: API_DIR,
        env: {
            PATH: process.env.PATH,
            NODE_ENV: 'test',
            PORT: String(PORT),
            NEO4J_URI: TEST_URI,
            NEO4J_USER: process.env.NEO4J_USER || 'neo4j',
            NEO4J_PASSWORD: process.env.NEO4J_PASSWORD,
            JWT_SECRET: secret,
            VAPID_EMAIL: 'mailto:tests@example.test',
            VAPID_PUBLIC_KEY: vapid.publicKey,
            VAPID_PRIVATE_KEY: vapid.privateKey,
            // QA's mail sink on CT116: accepts everything, delivers nothing.
            SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525', SMTP_USER: 'tests@example.test', SMTP_PASS: 'x',
            APP_URL: 'http://localhost', RP_ORIGIN: 'http://localhost', RP_ID: 'localhost',
            UPLOAD_DIR: path.join(workDir, 'uploads'), UPLOAD_MIN_FREE_MB: '1',
            // No DELETION_LIST_FILE: it must sit on a host mount, so account
            // deletion is off in the tests (the API says so and starts).
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', d => output.push(String(d)));
    proc.stderr.on('data', d => output.push(String(d)));
    for (let i = 0; i < 100; i++) {
        if (proc.exitCode !== null) throw new Error(`API exited (${proc.exitCode}):\n${output.join('')}`);
        try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* not yet */ }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`API did not answer /health:\n${output.join('')}`);
}

async function stopApi() {
    if (proc && proc.exitCode === null) {
        proc.kill('SIGTERM');
        await new Promise(r => proc.once('exit', r));
    }
    await driver?.close();
    driver = undefined;
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
}

// Before/after each test file: clean database, fresh API.
async function setup() {
    await resetDatabase();
    await startApi();
}

// A group of `users` (the first creates it, the rest are added).
async function createGroup(users, { title = 'Test group', currencyIso = 'EUR' } = {}) {
    const [owner, ...rest] = users;
    const res = await owner.api.post('/groups', { title, currencyIso, icon: 'home' });
    if (res.status !== 201) throw new Error(`create group: ${res.status} ${JSON.stringify(res.body)}`);
    const id = res.body.id;
    for (const u of rest) {
        const add = await owner.api.post(`/groups/${id}/${u.id}`);
        if (add.status !== 200) throw new Error(`add member: ${add.status} ${JSON.stringify(add.body)}`);
    }
    return id;
}

// An expense paid by `payer`; `shares` = { userId: amount } for the others.
async function addExpense(as, groupId, { amount, payer, shares = {}, currencyIso = 'EUR', description = 'Test expense', date = DATES.d1, categoryId = 'cat-groceries' }) {
    return as.api.post('/expenses', {
        groupId, description, categoryId, amount, currencyIso, date,
        paidByUserId: payer.id,
        shares: Object.entries(shares).map(([userId, a]) => ({ userId, amount: a })),
    });
}

// Each member's balance in the group, as the group page shows it: { userId: minor units }.
async function balances(as, groupId) {
    const res = await as.api.get(`/groups/${groupId}`);
    if (res.status !== 200) throw new Error(`get group: ${res.status} ${JSON.stringify(res.body)}`);
    return Object.fromEntries(res.body.groups[0].members.map(m => [m.id, m.balance]));
}

module.exports = { setup, stopApi, createUser, createGroup, addExpense, balances, client, run, DATES, RATES };
