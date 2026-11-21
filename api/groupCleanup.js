// Groups are never deleted by hand (since 2026-11-17): members leave, and a
// group with no live member left is removed with everything in it. Nobody who
// can still see it loses anything, and nobody can erase what others owe them,
// because leaving (or being removed) needs a settled balance first.

const driver = require('./neo4j');
const { shareInGroupCurrency: share } = require('./money');
const uploadStore = require('./uploadStore');
const receiptService = require('./receiptService');

// A member's net balance in a group (minor units of the group's currency,
// positive = gets money back), computed like MEMBERS_OF_GROUP. Null when they
// are not a member.
async function memberBalance(groupId, memberId) {
    const { records } = await driver.executeQuery(
        `MATCH (g:Group {id: $groupId})<-[:MEMBER_OF]-(m:User {id: $memberId})
         CALL (g, m) {
             OPTIONAL MATCH (g)<-[:BALANCE_IN]-(e:Expense)-[o:OWED_BY]->(m)
             RETURN sum(${share('o', 'e')}) AS owed
         }
         CALL (g, m) {
             OPTIONAL MATCH (m)-[:PAID]->(e:Expense)-[:BALANCE_IN]->(g)
             OPTIONAL MATCH (e)-[p:OWED_BY]->(:User)
             RETURN sum(${share('p', 'e')}) AS lent
         }
         RETURN lent - owed AS balance`,
        { groupId, memberId }
    );
    return records.length ? Math.round(Number(records[0].get('balance'))) : null;
}

// Everything of the group goes: trips with their items, places, attachments,
// photo album and follow links, and documents (and those files on disk), expenses with their receipts, shares and
// history, invite links, deletion records, then the group. Needs no member,
// so it also works for a group nobody belongs to any more.
async function deleteGroupCompletely(groupId) {
    const { records } = await driver.executeQuery(
        `MATCH (g:Group {id: $groupId})
         OPTIONAL MATCH (t:Trip)-[:PLANNED_IN]->(g)
         OPTIONAL MATCH (a:Attachment)-[:ATTACHED_TO]->(:TripItem)-[:PART_OF]->(t)
         OPTIONAL MATCH (d:Document)-[:DOCUMENT_OF]->(t)
         RETURN [x IN collect(DISTINCT a.storedName) + collect(DISTINCT d.storedName) WHERE x IS NOT NULL] AS storedNames`,
        { groupId }
    );
    if (records.length === 0) return false;
    const storedNames = records[0].get('storedNames');
    await driver.executeQuery(
        `MATCH (g:Group {id: $groupId})
         OPTIONAL MATCH (t:Trip)-[:PLANNED_IN]->(g)
         OPTIONAL MATCH (i:TripItem)-[:PART_OF]->(t)
         OPTIONAL MATCH (a:Attachment)-[:ATTACHED_TO]->(i)
         OPTIONAL MATCH (d:Document)-[:DOCUMENT_OF]->(t)
         OPTIONAL MATCH (p:Place)-[:PLACE_OF]->(t)
         OPTIONAL MATCH (al:PhotoAlbum)-[:PHOTOS_OF]->(t)
         OPTIONAL MATCH (fl:FollowLink)-[:FOLLOWS]->(t)
         WITH g, collect(DISTINCT t) + collect(DISTINCT i) + collect(DISTINCT a) + collect(DISTINCT d) + collect(DISTINCT p) + collect(DISTINCT al) + collect(DISTINCT fl) AS tripNodes
         FOREACH (n IN tripNodes | DETACH DELETE n)
         WITH g
         OPTIONAL MATCH (e:Expense)-[:BALANCE_IN]->(g)
         WITH g, collect(e) AS expenses
         FOREACH (e IN expenses | DETACH DELETE e)
         WITH g
         OPTIONAL MATCH (inv:Token:Invite {groupId: $groupId})
         WITH g, collect(inv) AS invites
         FOREACH (x IN invites | DETACH DELETE x)
         WITH g
         OPTIONAL MATCH (del:Deletion)-[:IN_GROUP]->(g)
         WITH g, collect(del) AS deletions
         FOREACH (x IN deletions | DETACH DELETE x)
         DETACH DELETE g`,
        { groupId }
    );
    // After the graph: a file without a node is harmless, a node pointing at
    // a missing file is not.
    await uploadStore.remove(storedNames);
    await receiptService.removeOrphans();
    return true;
}

// Removes the group if no live member is left (none at all, or only deleted
// accounts). Returns whether it did.
async function removeIfAbandoned(groupId) {
    const { records } = await driver.executeQuery(
        `MATCH (g:Group {id: $groupId})
         WHERE NOT EXISTS { MATCH (g)<-[:MEMBER_OF]-(m:User) WHERE m.deleted IS NULL }
         RETURN g.id AS id`,
        { groupId }
    );
    if (records.length === 0) return false;
    return deleteGroupCompletely(groupId);
}

// Every group without a live member: the safety net for anything the leave
// route didn't catch (two last members leaving at once, older data, a restore).
async function removeAbandonedGroups() {
    const { records } = await driver.executeQuery(
        `MATCH (g:Group)
         WHERE NOT EXISTS { MATCH (g)<-[:MEMBER_OF]-(m:User) WHERE m.deleted IS NULL }
         RETURN g.id AS id`
    );
    let removed = 0;
    for (const r of records) if (await deleteGroupCompletely(r.get('id'))) removed++;
    return removed;
}

module.exports = { memberBalance, deleteGroupCompletely, removeIfAbandoned, removeAbandonedGroups };
