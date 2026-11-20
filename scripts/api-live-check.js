#!/usr/bin/env node
// After an API deploy (2026-11-20): is the live API answering correctly, not
// just running? Shipped to CT104 by deploy.sh and run there as the service
// user with the service's environment (/etc/splitty-api.env):
//
//   node api-live-check.js <app dir>
//
// 1. Signs a 60-second session for one existing group member and calls the
//    main read routes on 127.0.0.1:3000: each must answer 200 with the
//    expected shape. Read only: nothing is created or changed.
// 2. Checks, straight in the database (read-only session), that every group's
//    balances still add up to zero.
// Prints status codes and counts only, never names, emails or amounts.
// Exit 1 when a route fails (deploy.sh then rolls back); a group that doesn't
// add up is only a warning, so an old data problem never undoes a deploy.
const path = require('path');
const app = process.argv[2] || '/opt/splitty-api-node24';
const neo4j = require(path.join(app, 'node_modules/neo4j-driver'));
const jwt = require(path.join(app, 'node_modules/jsonwebtoken'));

const BASE = 'http://127.0.0.1:3000';
const ROUTES = [
    ['/groups', b => Array.isArray(b.groups) && b.groups.every(g => Array.isArray(g.members))],
    ['/dash/balance', b => Array.isArray(b.currencies) && b.currencies.every(c => typeof c.iso === 'string' && Number.isFinite(c.lent) && Number.isFinite(c.owed))],
    ['/dash/groups', b => Array.isArray(b.groups)],
    ['/dash/friends', b => Array.isArray(b.friends)],
    ['/dash/activity', b => Array.isArray(b.activities)],
    ['/trips', b => Array.isArray(b.trips)],
    ['/currencies', b => Array.isArray(b.currencies) && b.currencies.length > 0],
    ['/categories', b => Array.isArray(b.categories)],
];

(async () => {
    const driver = neo4j.driver(process.env.NEO4J_URI || 'bolt://localhost:7687',
        neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD));
    const session = driver.session({ defaultAccessMode: neo4j.session.READ });
    let failed = 0;
    try {
        // The live member in the most groups: the widest view of the data.
        const { records: who } = await session.run(
            `MATCH (u:User)-[:MEMBER_OF]->(g:Group) WHERE u.deleted IS NULL
             RETURN u.id AS id, u.email AS email, count(g) AS groups ORDER BY groups DESC LIMIT 1`
        );
        if (!who.length) { console.log('no group members yet: route checks skipped'); }
        else {
            const token = jwt.sign({ id: who[0].get('id'), email: who[0].get('email') }, process.env.JWT_SECRET, { expiresIn: '60s' });
            for (const [url, shapeOk] of ROUTES) {
                let status = 0, ok = false;
                try {
                    const res = await fetch(BASE + url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
                    status = res.status;
                    ok = status === 200 && shapeOk(await res.json());
                } catch { /* counted below */ }
                console.log(`${ok ? 'ok  ' : 'FAIL'} GET ${url} → ${status}${status === 200 && !ok ? ' (unexpected shape)' : ''}`);
                if (!ok) failed++;
            }
        }

        // Same balance as the group page (groupMembers.js MEMBERS_OF_GROUP).
        const { records } = await session.run(
            `MATCH (g:Group)
             CALL (g) {
                 MATCH (g)<-[:MEMBER_OF]-(m:User)
                 OPTIONAL MATCH (g)<-[:BALANCE_IN]-(e:Expense)
                 OPTIONAL MATCH (e)-[o:OWED_BY]->(m)
                 OPTIONAL MATCH (m)-[:PAID]->(e)-[p:OWED_BY]->(:User)
                 WITH m, sum(p.amount * coalesce(e.rateSnapshot, 1)) - sum(o.amount * coalesce(e.rateSnapshot, 1)) AS b
                 RETURN sum(b) AS total
             }
             RETURN count(g) AS groups, sum(CASE WHEN abs(total) >= 1 THEN 1 ELSE 0 END) AS off`
        );
        const groups = records[0].get('groups').toNumber();
        const off = Number(records[0].get('off'));
        console.log(off === 0
            ? `ok   balances add up to zero in all ${groups} groups`
            : `WARN balances do not add up in ${off} of ${groups} groups (data, not this deploy: look into it)`);
    } finally {
        await session.close();
        await driver.close();
    }
    process.exit(failed ? 1 : 0);
})().catch(err => { console.log(`FAIL ${err.message}`); process.exit(1); });
