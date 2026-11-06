// The members of a group, with their balances, in one fixed order: the other
// members alphabetically, the signed-in user last. Used by every query that
// lists a group's members (Home cards, the group list, the group page, the
// member list), so ordering and fields cannot drift apart again.
//
// MEMBERS_OF_GROUP is a Cypher subquery: it needs `g` (the group) and the
// $userId parameter in scope, and yields `members` and `memberCount`.
// Members carry only what other members may see: no email, no account state.

const neo4j = require('neo4j-driver');

const MEMBERS_OF_GROUP = `
    CALL (g) {
        MATCH (g)<-[:MEMBER_OF]-(m:User)
        OPTIONAL MATCH (g)<-[:BALANCE_IN]-(e:Expense)
        OPTIONAL MATCH (e)-[o:OWED_BY]->(m)
        OPTIONAL MATCH (m)-[:PAID]->(e)-[p:OWED_BY]->(:User)
        WITH m, sum(p.amount * coalesce(e.rateSnapshot, 1)) - sum(o.amount * coalesce(e.rateSnapshot, 1)) AS balance
        ORDER BY m.id = $userId, toLower(m.name)
        RETURN collect({id: m.id, name: m.name, balance: balance, avatarColor: m.avatarColor, avatarEmoji: m.avatarEmoji}) AS members,
               count(m) AS memberCount
    }`;

// The `members` list of a record, as plain JSON.
const mapMembers = list => list.map(m => ({
    ...m,
    balance: Number(m.balance ?? 0),
    // Stored as a float by the app, but an integer must work too.
    avatarColor: m.avatarColor == null ? null : neo4j.integer.toNumber(m.avatarColor),
}));

module.exports = { MEMBERS_OF_GROUP, mapMembers };
