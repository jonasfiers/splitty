// receiptService.js
//
// Receipts on expenses (2026-11-21): photos or PDFs of the bill, so anyone in
// the group can later check what an amount was for. The file lives on disk
// under `storedName` (uploadStore.js); the graph holds
//
//   (:Receipt {id, filename, mimeType, size, storedName, thumbStoredName?})-[:RECEIPT_OF]->(:Expense)
//   (:Receipt)-[:UPLOADED_BY {on}]->(:User)
//
// thumbStoredName: a small JPEG preview (~20 KB) the app makes on the phone
// and sends with the photo, so the expense page shows tiles without
// downloading every full receipt. Optional: PDFs and older receipts have none.
//
// Every member of the expense's group sees, adds and removes them, as with
// trip item files. Settlements and transfers have none. A receipt belongs to
// the group's records: it stays when its uploader leaves or deletes their
// account, and goes with the expense or the group.
const neo4j = require('neo4j-driver');
const driver = require('./neo4j');
const uploadStore = require('./uploadStore');

const MAX_PER_EXPENSE = 5;

// The expense, if this user may see it (a member of its group) and it can
// carry receipts (an ordinary expense, not a settlement or transfer).
const EXPENSE_FOR_MEMBER = `
    MATCH (u:User {id: $userId})-[:MEMBER_OF]->(:Group)<-[:BALANCE_IN]-(e:Expense {id: $expenseId})
    WHERE NOT e:Settlement AND NOT e:Transfer`;

const num = v => (neo4j.isInt(v) ? v.toNumber() : v);

const receiptService = {
    MAX_PER_EXPENSE,

    // The expense's receipts, oldest first, or null when the user may not see it.
    list: async (expenseId, userId) => {
        const { records } = await driver.executeQuery(
            `${EXPENSE_FOR_MEMBER}
             OPTIONAL MATCH (r:Receipt)-[:RECEIPT_OF]->(e)
             OPTIONAL MATCH (r)-[up:UPLOADED_BY]->(by:User)
             WITH e, r, up, by ORDER BY up.on
             // Grouped by e: no expense (not a member) means no row at all.
             WITH e, collect(CASE WHEN r IS NULL THEN null ELSE
                 {id: r.id, filename: r.filename, mimeType: r.mimeType, size: r.size, hasThumb: r.thumbStoredName IS NOT NULL, uploadedBy: by.name, uploadedOn: toString(up.on)} END) AS all
             RETURN [x IN all WHERE x IS NOT NULL] AS receipts`,
            { expenseId, userId }
        );
        if (!records.length) return null;
        return records[0].get('receipts').map(r => ({ ...r, size: num(r.size) }));
    },

    // { success, receipt } or { success: false, status, message }.
    create: async (expenseId, userId, { filename, mimeType, size, storedName, thumbStoredName = null }) => {
        const { records } = await driver.executeQuery(
            `${EXPENSE_FOR_MEMBER}
             WITH u, e, COUNT { (:Receipt)-[:RECEIPT_OF]->(e) } AS n
             WHERE n < $max
             CREATE (r:Receipt {id: randomUUID(), filename: $filename, mimeType: $mimeType, size: $size, storedName: $storedName, thumbStoredName: $thumbStoredName})-[:RECEIPT_OF]->(e)
             CREATE (r)-[:UPLOADED_BY {on: datetime()}]->(u)
             RETURN r.id AS id`,
            { expenseId, userId, filename, mimeType, size: neo4j.int(size), storedName, thumbStoredName, max: neo4j.int(MAX_PER_EXPENSE) }
        );
        if (records.length) return { success: true, receipt: { id: records[0].get('id'), filename, mimeType, size, hasThumb: !!thumbStoredName } };
        // Not created: no such expense for this user, or it is full.
        return (await receiptService.list(expenseId, userId))
            ? { success: false, status: 400, message: `An expense can have at most ${MAX_PER_EXPENSE} receipts.` }
            : { success: false, status: 404, message: 'Expense not found' };
    },

    // Removes it if the user is in its group; returns the stored names (the
    // file and its preview) to delete from disk, empty when nothing was removed.
    remove: async (receiptId, userId) => {
        const { records } = await driver.executeQuery(
            `MATCH (:User {id: $userId})-[:MEMBER_OF]->(:Group)<-[:BALANCE_IN]-(:Expense)<-[:RECEIPT_OF]-(r:Receipt {id: $receiptId})
             WITH r, [x IN [r.storedName, r.thumbStoredName] WHERE x IS NOT NULL] AS storedNames
             DETACH DELETE r
             RETURN storedNames`,
            { receiptId, userId }
        );
        return records.flatMap(r => r.get('storedNames'));
    },

    // Receipts whose expense is gone (deleted on its own or with its group):
    // removed from the graph and from disk. Run after anything that deletes
    // expenses; harmless at any other time.
    removeOrphans: async () => {
        const { records } = await driver.executeQuery(
            `MATCH (r:Receipt) WHERE NOT (r)-[:RECEIPT_OF]->(:Expense)
             WITH r, [x IN [r.storedName, r.thumbStoredName] WHERE x IS NOT NULL] AS storedNames
             DETACH DELETE r
             RETURN storedNames`
        );
        await uploadStore.remove(records.flatMap(r => r.get('storedNames')));
        return records.length;
    },
};

module.exports = receiptService;
