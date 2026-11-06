// "Download all my data" (GDPR access and portability): one ZIP with
//   README.txt     what is in it
//   data.json      everything, structured: account, passkeys, groups and
//                  members, expenses with every share, trips with items,
//                  places and attachment details
//   expenses.csv   one row per expense, amounts in normal currency units
//   trips.csv      one row per trip item
//   files/         the files this user uploaded (others' uploads are listed
//                  in data.json, not included: they are their data)
//
// Scope: the user's own account, and the groups they are a member of (what
// they can see in the app anyway). Amounts are stored in minor units (cents)
// and converted here.

const fs = require('fs/promises');
const neo4j = require('neo4j-driver');
const { zipSync, strToU8 } = require('fflate');
const driver = require('./neo4j');
const uploadStore = require('./uploadStore');

const decimalsOf = iso => {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency: iso }).resolvedOptions().maximumFractionDigits; }
    catch { return 2; }
};
const major = (minor, iso) => (minor == null ? null : Number(minor) / 10 ** decimalsOf(iso));

// Neo4j values to plain JSON: Integers to numbers, temporal values to ISO strings.
function plain(v) {
    if (v == null) return v ?? null;
    if (neo4j.isInt(v)) return v.toNumber();
    if (Array.isArray(v)) return v.map(plain);
    if (typeof v === 'object') {
        if (typeof v.toString === 'function' && v.constructor && v.constructor !== Object && 'year' in v) return v.toString();
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
    }
    return v;
}
// Change records store amounts in minor units, like the rest of the graph.
const majorChanges = list => list.map(c => (c.field === 'amount' || c.field === 'share')
    ? { ...c, from: major(c.from, c.fromCurrency), to: major(c.to, c.toCurrency) }
    : c);
const rows = records => records.map(r => plain(r.toObject()));

async function q(cypher, params) {
    const { records } = await driver.executeQuery(cypher, params);
    return rows(records);
}

async function collect(userId) {
    const [account] = await q(
        `MATCH (u:User {id: $userId})
         RETURN u.id AS id, u.name AS name, u.email AS email, u.pendingEmail AS pendingEmail,
                u.emailVerified AS emailVerified, u.avatarColor AS avatarColor, u.avatarEmoji AS avatarEmoji,
                u.role AS role, u.password IS NOT NULL AS hasPassword,
                COUNT { (u)-[:HAS_SUBSCRIPTION]->(:PushSubscription) } AS notificationDevices`,
        { userId });
    if (!account) return null;

    const passkeys = await q(
        `MATCH (p:Passkey)-[:BELONGS_TO]->(:User {id: $userId})
         RETURN p.name AS name, p.createdAt AS createdAt, p.lastUsedAt AS lastUsedAt, p.credentialId AS credentialId`,
        { userId });

    const groups = await q(
        `MATCH (:User {id: $userId})-[:MEMBER_OF]->(g:Group)
         OPTIONAL MATCH (g)-[:EXPRESSED_IN]->(c:Currency)
         OPTIONAL MATCH (m:User)-[:MEMBER_OF]->(g)
         RETURN g.id AS id, g.title AS title, g.icon AS icon, c.iso AS currency,
                collect(DISTINCT {id: m.id, name: m.name}) AS members
         ORDER BY title`,
        { userId });

    const expenses = (await q(
        `MATCH (:User {id: $userId})-[:MEMBER_OF]->(g:Group)<-[:BALANCE_IN]-(e:Expense)
         OPTIONAL MATCH (e)<-[:PAID]-(payer:User)
         OPTIONAL MATCH (e)-[:IN_CATEGORY]->(cat:Category)
         OPTIONAL MATCH (e)-[:EXPRESSED_IN]->(cur:Currency)
         OPTIONAL MATCH (g)-[:EXPRESSED_IN]->(gc:Currency)
         OPTIONAL MATCH (e)-[o:OWED_BY]->(ou:User)
         WITH e, g, payer, cat, cur, gc, collect(CASE WHEN ou IS NULL THEN null ELSE {userId: ou.id, name: ou.name, amount: o.amount} END) AS owed
         RETURN e.id AS id, e.date AS date, e.description AS description, e.amount AS amount,
                e.amountBase AS amountBase, e.rateSnapshot AS rate, cur.iso AS currency, gc.iso AS groupCurrency,
                g.id AS groupId, g.title AS groupTitle, cat.name AS category,
                payer.id AS paidById, payer.name AS paidBy, owed,
                CASE WHEN e:Settlement THEN 'settlement' WHEN e:Transfer THEN 'transfer' ELSE 'expense' END AS kind,
                [(e)-[:PAYS_FOR]->(i:TripItem) | i.id] AS tripItemIds,
                [(e)-[h:CREATED_BY|UPDATED_BY]->(hu:User) | {action: type(h), on: h.on, by: hu.name, changes: h.changes}] AS history
         ORDER BY date DESC`,
        { userId })).map(e => {
        const owedTotal = e.owed.reduce((s, o) => s + Number(o.amount || 0), 0);
        const shares = e.owed.map(o => ({ userId: o.userId, name: o.name, amount: major(o.amount, e.currency) }));
        // The payer has no share of their own stored: theirs is the remainder.
        if (e.paidById && !e.owed.some(o => o.userId === e.paidById)) {
            shares.push({ userId: e.paidById, name: e.paidBy, amount: major(Number(e.amount || 0) - owedTotal, e.currency) });
        }
        const mine = shares.find(s => s.userId === userId)?.amount ?? 0;
        return {
            id: e.id, date: e.date, kind: e.kind, description: e.description,
            amount: major(e.amount, e.currency), currency: e.currency,
            amountInGroupCurrency: major(e.amountBase, e.groupCurrency), groupCurrency: e.groupCurrency,
            group: { id: e.groupId, title: e.groupTitle }, category: e.category ?? null,
            paidBy: e.paidById ? { id: e.paidById, name: e.paidBy } : null,
            shares, myShare: mine, tripItemIds: e.tripItemIds,
            history: e.history
                .map(h => ({ action: h.action === 'CREATED_BY' ? 'created' : 'edited', on: h.on, by: h.by, changes: h.changes ? majorChanges(JSON.parse(h.changes)) : undefined }))
                .sort((x, y) => String(x.on).localeCompare(String(y.on))),
        };
    });

    const trips = await q(
        `MATCH (:User {id: $userId})-[:MEMBER_OF]->(g:Group)<-[:PLANNED_IN]-(t:Trip)
         RETURN properties(t) AS trip, g.id AS groupId, g.title AS groupTitle
         ORDER BY trip.startDate`,
        { userId });

    const items = await q(
        `MATCH (:User {id: $userId})-[:MEMBER_OF]->(:Group)<-[:PLANNED_IN]-(t:Trip)<-[:PART_OF]-(i:TripItem)
         OPTIONAL MATCH (i)-[r:AT|DEPARTS_FROM|ARRIVES_AT]->(p:Place)
         WITH t, i, collect(CASE WHEN p IS NULL THEN null ELSE {role: type(r), place: properties(p)} END) AS places
         OPTIONAL MATCH (i)-[:CREATED_BY]->(c:User)
         RETURN t.id AS tripId, properties(i) AS item,
                [l IN labels(i) WHERE l <> 'TripItem'][0] AS kind,
                [(i)-[:EXPRESSED_IN]->(cur:Currency) | cur.iso][0] AS currency,
                places, c.name AS createdBy
         ORDER BY item.start`,
        { userId });

    const attachments = await q(
        `MATCH (:User {id: $userId})-[:MEMBER_OF]->(:Group)<-[:PLANNED_IN]-(t:Trip)<-[:PART_OF]-(i:TripItem)<-[:ATTACHED_TO]-(a:Attachment)
         OPTIONAL MATCH (a)-[up:UPLOADED_BY]->(u:User)
         RETURN a.id AS id, a.filename AS filename, a.mimeType AS mimeType, a.size AS size, a.storedName AS storedName,
                i.id AS itemId, t.id AS tripId, u.id AS uploadedById, u.name AS uploadedBy, up.on AS uploadedAt`,
        { userId });

    const placeRole = { AT: 'place', DEPARTS_FROM: 'from', ARRIVES_AT: 'to' };
    const tripList = trips.map(({ trip, groupId, groupTitle }) => ({
        ...trip,
        group: { id: groupId, title: groupTitle },
        items: items.filter(x => x.tripId === trip.id).map(x => ({
            ...x.item,
            kind: (x.kind || '').toLowerCase(),
            currency: x.currency ?? undefined,
            ...Object.fromEntries(x.places.map(p => [placeRole[p.role] || p.role, p.place])),
            createdBy: x.createdBy ?? null,
            attachments: attachments.filter(a => a.itemId === x.item.id).map(a => ({
                id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size,
                uploadedBy: a.uploadedBy ?? null, uploadedAt: a.uploadedAt ?? null,
                includedAs: a.uploadedById === userId ? fileName(a) : null,
            })),
        })),
    }));

    return { account, passkeys, groups, expenses, trips: tripList, ownFiles: attachments.filter(a => a.uploadedById === userId) };
}

const safe = s => String(s || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120);
const fileName = a => `files/${a.id.slice(0, 8)}-${safe(a.filename)}`;

const csvCell = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header, list) => [header, ...list].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

function expensesCsv(expenses) {
    return csv(
        ['Date', 'Kind', 'Description', 'Amount', 'Currency', 'Amount in group currency', 'Group currency', 'Group', 'Category', 'Paid by', 'My share'],
        expenses.map(e => [e.date, e.kind, e.description, e.amount, e.currency, e.amountInGroupCurrency, e.groupCurrency,
            e.group.title, e.category, e.paidBy?.name, e.myShare]));
}

function tripsCsv(trips) {
    const list = [];
    for (const t of trips) for (const i of t.items) {
        list.push([t.title, t.group.title, i.kind, i.mode, i.title, i.start, i.end,
            i.from?.name, i.to?.name, i.place?.name, i.carrier, i.number, i.confirmationRef, i.url, i.notes]);
    }
    return csv(['Trip', 'Group', 'Kind', 'Mode', 'Title', 'Start', 'End', 'From', 'To', 'Place', 'Carrier', 'Number', 'Booking reference', 'Link', 'Notes'], list);
}

const README = generated => `Your Splitty data, exported ${generated}.

data.json     Everything Splitty holds that you can see: your account, passkeys,
              your groups and their members, every expense with its shares,
              and your trips with their items, places and attachments.
expenses.csv  One row per expense in your groups (amounts in normal units,
              e.g. 12.50; "My share" is your part of it).
trips.csv     One row per trip item.
files/        The files you uploaded to trips. Files other people uploaded are
              listed in data.json but not included.

Not included: your password (Splitty only stores a one-way hash of it) and the
private part of your passkeys (it never leaves your device).

Questions: hello@jonasfiers.eu
`;

async function buildZip(userId) {
    const data = await collect(userId);
    if (!data) return null;
    const generated = new Date().toISOString();
    const { ownFiles, ...exported } = data;

    const entries = {
        'README.txt': strToU8(README(generated)),
        'data.json': strToU8(JSON.stringify({ generated, ...exported }, null, 2)),
        'expenses.csv': strToU8(expensesCsv(data.expenses)),
        'trips.csv': strToU8(tripsCsv(data.trips)),
    };
    const missing = [];
    for (const a of ownFiles) {
        try {
            entries[fileName(a)] = [new Uint8Array(await fs.readFile(uploadStore.filePath(a.storedName))), { level: 0 }];
        } catch {
            missing.push(a.filename);
        }
    }
    if (missing.length) entries['files/MISSING.txt'] = strToU8(`These uploads could not be read and are not included:\n${missing.join('\n')}\n`);
    return Buffer.from(zipSync(entries, { level: 6 }));
}

module.exports = { buildZip, collect };
