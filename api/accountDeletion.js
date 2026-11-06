// Account deletion (GDPR erasure) and the deletion list that keeps deleted
// accounts deleted across a database or container restore.
//
// Deleting an account:
//   1. appends "<userId>\t<ISO date>" to DELETION_LIST_FILE (fsynced) — if
//      that fails, nothing is deleted;
//   2. deletes the groups where the user is the only member, with their trips,
//      uploaded files, expenses and invite links;
//   3. anonymises the user: every property is replaced by
//      { id, name: 'Deleted user', deleted: true, deletedAt }, and their
//      passkeys, push subscriptions and tokens are deleted. Memberships of
//      shared groups, payments and shares stay, so the other members'
//      balances and history stay correct.
//
// The deletion list lives on the host's HDD, bind-mounted into the container,
// so no backup of the container or of Neo4j contains it: a restore brings
// back the old data but not an old list. At every API start, before it
// listens, reapplyDeletions() runs steps 2-3 again for every listed account
// that is not anonymised yet. QA reads production's list too, read-only
// (DELETION_LIST_READ_FILES), because its database is a copy of production.
//
// The list holds only internal user ids (random UUIDs), never names or
// addresses, and is kept indefinitely: an old backup could hold the account.

const fs = require('fs');
const path = require('path');
const driver = require('./neo4j');
const tripService = require('./tripService');
const uploadStore = require('./uploadStore');

const WRITE_FILE = process.env.DELETION_LIST_FILE || '';
const READ_FILES = (process.env.DELETION_LIST_READ_FILES || '')
    .split(',').map(s => s.trim()).filter(Boolean);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ids of deleted accounts, for the auth middleware: a JWT issued before the
// deletion must stop working at once, not when it expires.
const deletedIds = new Set();
const isDeleted = id => deletedIds.has(id);

const isConfigured = () => WRITE_FILE !== '';

// The folder holding a list must carry this marker, created on the host when
// the folder was set up. Without it the folder is not the host mount (e.g. a
// restore dropped the mount point and left the empty directory inside the
// container), and an empty list there would silently skip every re-deletion.
const MARKER = '.splitty-deletion-list';

function checkMount(file) {
    if (!fs.existsSync(path.join(path.dirname(file), MARKER))) {
        throw new Error(`${path.dirname(file)} has no ${MARKER}: the host mount for the deletion list is missing`);
    }
}

function readList(file) {
    checkMount(file);
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return []; // nothing deleted yet
        throw new Error(`Cannot read deletion list ${file}: ${err.message}`);
    }
    return text.split('\n')
        .map(line => line.split('\t')[0].trim())
        .filter(id => UUID.test(id));
}

function appendToList(userId) {
    if (!isConfigured()) throw new Error('DELETION_LIST_FILE is not set');
    checkMount(WRITE_FILE);
    // World-readable on purpose: it holds only random ids, and QA reads
    // production's list from another container (another uid).
    const fd = fs.openSync(WRITE_FILE, 'a', 0o644);
    try {
        fs.writeSync(fd, `${userId}\t${new Date().toISOString()}\n`);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}

// Groups whose only member is this user: nobody else loses anything when
// they go.
async function soloGroupIds(userId) {
    const { records } = await driver.executeQuery(
        `MATCH (u:User {id: $userId})-[:MEMBER_OF]->(g:Group)
         WHERE NOT EXISTS { MATCH (g)<-[:MEMBER_OF]-(o:User) WHERE o <> u }
         RETURN g.id AS id`,
        { userId }
    );
    return records.map(r => r.get('id'));
}

async function deleteSoloGroup(groupId, userId) {
    // Trips first, the way the group delete route does it, so their uploaded
    // files are removed from disk too.
    const storedNames = await tripService.deleteTripsOfGroup(groupId, userId);
    await driver.executeQuery(
        `MATCH (g:Group {id: $groupId})
         OPTIONAL MATCH (e:Expense)-[:BALANCE_IN]->(g)
         WITH g, collect(e) AS expenses
         FOREACH (e IN expenses | DETACH DELETE e)
         WITH g
         OPTIONAL MATCH (t:Token:Invite {groupId: $groupId})
         WITH g, collect(t) AS invites
         FOREACH (t IN invites | DETACH DELETE t)
         DETACH DELETE g`,
        { groupId }
    );
    await uploadStore.remove(storedNames);
}

async function anonymise(userId) {
    await driver.executeQuery(
        `MATCH (u:User {id: $userId})
         OPTIONAL MATCH (p:Passkey)-[:BELONGS_TO]->(u)
         WITH u, collect(p) AS passkeys
         OPTIONAL MATCH (u)-[:HAS_SUBSCRIPTION]->(s:PushSubscription)
         WITH u, passkeys, collect(s) AS subs
         OPTIONAL MATCH (t:Token {userId: $userId})
         WITH u, passkeys, subs, collect(t) AS tokens
         FOREACH (n IN passkeys + subs + tokens | DETACH DELETE n)
         SET u = { id: u.id, name: 'Deleted user', deleted: true, deletedAt: $now }`,
        { userId, now: new Date().toISOString() }
    );
}

async function erase(userId) {
    for (const groupId of await soloGroupIds(userId)) {
        await deleteSoloGroup(groupId, userId);
    }
    await anonymise(userId);
}

// The user-facing delete. Returns the address the account had, for the
// confirmation email, or null if there was no such (live) account.
async function deleteAccount(userId) {
    const { records } = await driver.executeQuery(
        'MATCH (u:User {id: $userId}) WHERE u.deleted IS NULL RETURN u.email AS email',
        { userId }
    );
    if (records.length === 0) return null;
    const email = records[0].get('email');

    appendToList(userId);       // first: if this fails, nothing is deleted
    deletedIds.add(userId);     // from now on, old tokens are refused
    await erase(userId);
    return { email };
}

// At startup, before listening. Throws (and the API must not start) if a list
// cannot be read: serving a restored database with deleted accounts back in
// it is worse than not serving.
async function reapplyDeletions() {
    const files = [...(WRITE_FILE ? [WRITE_FILE] : []), ...READ_FILES];
    const listed = new Set(files.flatMap(readList));

    const { records } = await driver.executeQuery(
        'MATCH (u:User) WHERE u.deleted = true RETURN u.id AS id'
    );
    for (const r of records) deletedIds.add(r.get('id'));
    for (const id of listed) deletedIds.add(id);

    let reapplied = 0;
    if (listed.size > 0) {
        const { records: live } = await driver.executeQuery(
            'MATCH (u:User) WHERE u.id IN $ids AND u.deleted IS NULL RETURN u.id AS id',
            { ids: [...listed] }
        );
        for (const r of live) {
            await erase(r.get('id'));
            reapplied++;
        }
    }
    console.log(`Deletion list: ${listed.size} listed, ${reapplied} re-applied` +
        (isConfigured() ? '' : ' (DELETION_LIST_FILE not set: account deletion disabled)'));
    return reapplied;
}

module.exports = { deleteAccount, reapplyDeletions, isDeleted, isConfigured };
