// tripService.js
//
// Holiday planning on top of a group. A Trip is planned in a Group; its items
// (Transport, Stay, Activity) all carry the :TripItem label so the timeline,
// attachments and the expense link each need one query instead of three.
//
// Nothing derived is stored: the timeline is the items ordered by `start`, the
// map is the trip's Place nodes, and what was actually paid for an item is the
// sum of the Expense nodes that point at it with PAYS_FOR.
const neo4j = require('neo4j-driver');
const driver = require('./neo4j');

const KIND_LABELS = { transport: 'Transport', stay: 'Stay', activity: 'Activity' };
const TRANSPORT_MODES = ['flight', 'train', 'car', 'bus', 'ferry', 'other'];

const num = v => (neo4j.isInt(v) ? v.toNumber() : v);

const kindOf = labels => Object.keys(KIND_LABELS).find(k => labels.includes(KIND_LABELS[k]));

// Every read and write goes through the group: a user reaches a trip only by
// being a member of the group it is planned in.
const TRIP_ACCESS = '(:User {id: $userId})-[:MEMBER_OF]->(g:Group)<-[:PLANNED_IN]-(t:Trip {id: $tripId})';
const ITEM_ACCESS = '(:User {id: $userId})-[:MEMBER_OF]->(g:Group)<-[:PLANNED_IN]-(t:Trip)<-[:PART_OF]-(i:TripItem {id: $itemId})';

// A Place nobody points at any more has no reason to stay on the map.
const DELETE_ORPHAN_PLACES =
    `MATCH (p:Place)-[:PLACE_OF]->(:Trip {id: $tripId})
     WHERE NOT (p)<-[:AT|DEPARTS_FROM|ARRIVES_AT]-()
     DETACH DELETE p`;

const placeProps = p => ({
    id: p.id,
    name: p.name,
    address: p.address ?? '',
    lat: p.lat ?? null,
    lon: p.lon ?? null,
});

// A place slot on an item is either {id} (an existing place of this trip),
// {name, address, lat, lon} (a new one, created with the item) or empty.
async function resolvePlace(tx, tripId, ref) {
    if (!ref) return null;
    if (ref.id) {
        const { records } = await tx.run(
            'MATCH (p:Place {id: $id})-[:PLACE_OF]->(:Trip {id: $tripId}) RETURN p.id AS id',
            { id: ref.id, tripId }
        );
        if (records.length === 0) throw new Error('Place does not belong to this trip');
        return ref.id;
    }
    if (!ref.name) return null;
    const { records } = await tx.run(
        `MATCH (t:Trip {id: $tripId})
         CREATE (p:Place {id: randomUUID(), name: $name, address: $address, lat: $lat, lon: $lon})-[:PLACE_OF]->(t)
         RETURN p.id AS id`,
        { tripId, name: ref.name, address: ref.address ?? '', lat: ref.lat ?? null, lon: ref.lon ?? null }
    );
    return records[0].get('id');
}

async function attachPlacesAndCurrency(tx, tripId, itemId, kind, data) {
    const slots = kind === 'transport'
        ? [['DEPARTS_FROM', data.from], ['ARRIVES_AT', data.to]]
        : [['AT', data.place]];
    for (const [rel, ref] of slots) {
        const placeId = await resolvePlace(tx, tripId, ref);
        if (!placeId) continue;
        await tx.run(
            `MATCH (i:TripItem {id: $itemId}), (p:Place {id: $placeId}) CREATE (i)-[:${rel}]->(p)`,
            { itemId, placeId }
        );
    }
    if (data.price != null && data.currencyIso) {
        await tx.run(
            'MATCH (i:TripItem {id: $itemId}), (c:Currency {iso: $iso}) CREATE (i)-[:EXPRESSED_IN]->(c)',
            { itemId, iso: data.currencyIso }
        );
    }
}

const itemProps = (kind, data) => ({
    title: data.title,
    start: data.start,
    end: data.end ?? null,
    confirmationRef: data.confirmationRef ?? '',
    url: data.url ?? '',
    notes: data.notes ?? '',
    price: data.price ?? null,
    ...(kind === 'transport' ? {
        mode: data.mode,
        carrier: data.carrier ?? '',
        number: data.number ?? '',
    } : {}),
});

const tripService = {
    KIND_LABELS,
    TRANSPORT_MODES,

    // CREATE
    createTrip: async (groupId, userId, { title, icon, startDate, endDate, notes }) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH (u:User {id: $userId})-[:MEMBER_OF]->(g:Group {id: $groupId})
                 CREATE (t:Trip {id: randomUUID(), title: $title, icon: $icon, startDate: $startDate, endDate: $endDate, notes: $notes})-[:PLANNED_IN]->(g)
                 CREATE (t)-[:CREATED_BY {on: datetime()}]->(u)
                 RETURN t.id AS id`,
                { groupId, userId, title, icon: icon ?? '', startDate, endDate, notes: notes ?? '' }
            );
            if (records.length === 0) return { success: false, message: 'Group not found or access denied' };
            return { success: true, id: records[0].get('id') };
        } catch (err) {
            throw new Error(`Failed to create trip: ${err.message}`);
        }
    },

    // READ ALL (optionally for one group)
    getTrips: async (userId, groupId = null) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH (:User {id: $userId})-[:MEMBER_OF]->(g:Group)<-[:PLANNED_IN]-(t:Trip)
                 WHERE $groupId IS NULL OR g.id = $groupId
                 RETURN t, g.id AS groupId, g.title AS groupTitle, g.icon AS groupIcon,
                        COUNT { (:TripItem)-[:PART_OF]->(t) } AS itemCount
                 ORDER BY t.startDate, t.title`,
                { userId, groupId }
            );
            return {
                success: true,
                trips: records.map(r => ({
                    ...r.get('t').properties,
                    groupId: r.get('groupId'),
                    groupTitle: r.get('groupTitle'),
                    groupIcon: r.get('groupIcon'),
                    itemCount: num(r.get('itemCount')),
                })),
            };
        } catch (err) {
            throw new Error(`Failed to get trips: ${err.message}`);
        }
    },

    // READ ONE, with everything the timeline and the map need
    getTripById: async (tripId, userId) => {
        try {
            const { records: tripRecords } = await driver.executeQuery(
                `MATCH ${TRIP_ACCESS}
                 OPTIONAL MATCH (g)-[:EXPRESSED_IN]->(c:Currency)
                 RETURN t, g.id AS groupId, g.title AS groupTitle, g.icon AS groupIcon, c.iso AS groupIso`,
                { tripId, userId }
            );
            if (tripRecords.length === 0) return { success: false, message: 'Trip not found or access denied' };
            const tr = tripRecords[0];

            const { records: itemRecords } = await driver.executeQuery(
                `MATCH (i:TripItem)-[:PART_OF]->(:Trip {id: $tripId})
                 OPTIONAL MATCH (i)-[:EXPRESSED_IN]->(c:Currency)
                 OPTIONAL MATCH (i)-[:AT]->(p:Place)
                 OPTIONAL MATCH (i)-[:DEPARTS_FROM]->(f:Place)
                 OPTIONAL MATCH (i)-[:ARRIVES_AT]->(a:Place)
                 RETURN i, labels(i) AS labels, c.iso AS currencyIso,
                        p.id AS placeId, f.id AS fromPlaceId, a.id AS toPlaceId,
                        COUNT { (:Attachment)-[:ATTACHED_TO]->(i) } AS attachmentCount,
                        [(e:Expense)-[:PAYS_FOR]->(i) | e.amountBase] AS paidAmounts
                 ORDER BY i.start, i.title`,
                { tripId }
            );

            const { records: placeRecords } = await driver.executeQuery(
                'MATCH (p:Place)-[:PLACE_OF]->(:Trip {id: $tripId}) RETURN p ORDER BY p.name',
                { tripId }
            );

            return {
                success: true,
                trip: {
                    ...tr.get('t').properties,
                    groupId: tr.get('groupId'),
                    groupTitle: tr.get('groupTitle'),
                    groupIcon: tr.get('groupIcon'),
                    groupIso: tr.get('groupIso'),
                },
                items: itemRecords.map(r => {
                    const paidAmounts = r.get('paidAmounts');
                    return {
                        ...r.get('i').properties,
                        kind: kindOf(r.get('labels')),
                        currencyIso: r.get('currencyIso'),
                        placeId: r.get('placeId'),
                        fromPlaceId: r.get('fromPlaceId'),
                        toPlaceId: r.get('toPlaceId'),
                        attachmentCount: num(r.get('attachmentCount')),
                        expenseCount: paidAmounts.length,
                        // In the group's currency, like every balance in the app.
                        paidBase: paidAmounts.reduce((sum, a) => sum + Number(num(a) ?? 0), 0),
                    };
                }),
                places: placeRecords.map(r => placeProps(r.get('p').properties)),
            };
        } catch (err) {
            throw new Error(`Failed to get trip: ${err.message}`);
        }
    },

    // UPDATE
    updateTrip: async (tripId, userId, { title, icon, startDate, endDate, notes }) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH ${TRIP_ACCESS}
                 SET t.title = $title, t.icon = $icon, t.startDate = $startDate, t.endDate = $endDate, t.notes = $notes
                 RETURN t.id AS id`,
                { tripId, userId, title, icon: icon ?? '', startDate, endDate, notes: notes ?? '' }
            );
            if (records.length === 0) return { success: false, message: 'Trip not found or access denied' };
            return { success: true, message: 'Trip updated successfully' };
        } catch (err) {
            throw new Error(`Failed to update trip: ${err.message}`);
        }
    },

    // DELETE — takes the items, places and attachments with it, leaves the
    // expenses in the group. Returns the stored file names so the caller can
    // remove them from disk once the graph no longer references them.
    deleteTrip: async (tripId, userId) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH ${TRIP_ACCESS}
                 OPTIONAL MATCH (a:Attachment)-[:ATTACHED_TO]->(:TripItem)-[:PART_OF]->(t)
                 WITH t, collect(a) AS attachments, collect(a.storedName) AS storedNames
                 OPTIONAL MATCH (i:TripItem)-[:PART_OF]->(t)
                 WITH t, attachments, storedNames, collect(i) AS items
                 OPTIONAL MATCH (p:Place)-[:PLACE_OF]->(t)
                 WITH t, attachments, storedNames, items, collect(p) AS places
                 FOREACH (n IN attachments + items + places | DETACH DELETE n)
                 DETACH DELETE t
                 RETURN storedNames`,
                { tripId, userId }
            );
            if (records.length === 0) return { success: false, message: 'Trip not found or access denied' };
            return { success: true, message: 'Trip deleted successfully', storedNames: records[0].get('storedNames') };
        } catch (err) {
            throw new Error(`Failed to delete trip: ${err.message}`);
        }
    },

    // Called before a group is deleted, so its trips do not outlive it.
    deleteTripsOfGroup: async (groupId, userId) => {
        const { records } = await driver.executeQuery(
            'MATCH (:User {id: $userId})-[:MEMBER_OF]->(:Group {id: $groupId})<-[:PLANNED_IN]-(t:Trip) RETURN t.id AS id',
            { groupId, userId }
        );
        const storedNames = [];
        for (const r of records) {
            const result = await tripService.deleteTrip(r.get('id'), userId);
            if (result.success) storedNames.push(...result.storedNames);
        }
        return storedNames;
    },

    // CREATE ITEM
    createItem: async (tripId, userId, kind, data) => {
        const session = driver.session();
        try {
            return await session.executeWrite(async tx => {
                const { records } = await tx.run(
                    `MATCH ${TRIP_ACCESS}
                     MATCH (u:User {id: $userId})
                     CREATE (i:TripItem:${KIND_LABELS[kind]} {id: randomUUID()})-[:PART_OF]->(t)
                     CREATE (i)-[:CREATED_BY {on: datetime()}]->(u)
                     SET i += $props
                     RETURN i.id AS id`,
                    { tripId, userId, props: itemProps(kind, data) }
                );
                if (records.length === 0) return { success: false, message: 'Trip not found or access denied' };
                const itemId = records[0].get('id');
                await attachPlacesAndCurrency(tx, tripId, itemId, kind, data);
                return { success: true, id: itemId };
            });
        } catch (err) {
            throw new Error(`Failed to create trip item: ${err.message}`);
        } finally {
            await session.close();
        }
    },

    // READ ITEM, with its places, attachments and the expenses that paid for it
    getItemById: async (itemId, userId) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH ${ITEM_ACCESS}
                 OPTIONAL MATCH (g)-[:EXPRESSED_IN]->(gc:Currency)
                 OPTIONAL MATCH (i)-[:EXPRESSED_IN]->(c:Currency)
                 OPTIONAL MATCH (i)-[:AT]->(p:Place)
                 OPTIONAL MATCH (i)-[:DEPARTS_FROM]->(f:Place)
                 OPTIONAL MATCH (i)-[:ARRIVES_AT]->(a:Place)
                 RETURN i, labels(i) AS labels, c.iso AS currencyIso, p, f, a,
                        t.id AS tripId, t.title AS tripTitle, g.id AS groupId, gc.iso AS groupIso,
                        [(att:Attachment)-[:ATTACHED_TO]->(i) | att] AS attachments,
                        [(payer:User)-[:PAID]->(e:Expense)-[:PAYS_FOR]->(i) |
                            {expense: e, paidByName: payer.name, currencyIso: [(e)-[:EXPRESSED_IN]->(ec:Currency) | ec.iso][0]}] AS expenses`,
                { itemId, userId }
            );
            if (records.length === 0) return { success: false, message: 'Trip item not found or access denied' };
            const r = records[0];
            const place = n => (n ? placeProps(n.properties) : null);
            return {
                success: true,
                item: {
                    ...r.get('i').properties,
                    kind: kindOf(r.get('labels')),
                    currencyIso: r.get('currencyIso'),
                    place: place(r.get('p')),
                    from: place(r.get('f')),
                    to: place(r.get('a')),
                    tripId: r.get('tripId'),
                    tripTitle: r.get('tripTitle'),
                    groupId: r.get('groupId'),
                    groupIso: r.get('groupIso'),
                    attachments: r.get('attachments')
                        .map(a => ({ ...a.properties, size: num(a.properties.size) }))
                        .sort((a, b) => a.filename.localeCompare(b.filename)),
                    expenses: r.get('expenses')
                        .map(x => ({
                            id: x.expense.properties.id,
                            description: x.expense.properties.description,
                            amount: num(x.expense.properties.amount),
                            amountBase: num(x.expense.properties.amountBase),
                            date: x.expense.properties.date,
                            currencyIso: x.currencyIso,
                            paidByName: x.paidByName,
                        }))
                        .sort((a, b) => String(a.date).localeCompare(String(b.date))),
                },
            };
        } catch (err) {
            throw new Error(`Failed to get trip item: ${err.message}`);
        }
    },

    // UPDATE ITEM — the kind is fixed at creation; places and currency are
    // re-pointed, and any place left without an item is removed.
    updateItem: async (itemId, userId, data) => {
        const session = driver.session();
        try {
            return await session.executeWrite(async tx => {
                const { records } = await tx.run(
                    `MATCH ${ITEM_ACCESS} RETURN labels(i) AS labels, t.id AS tripId`,
                    { itemId, userId }
                );
                if (records.length === 0) return { success: false, message: 'Trip item not found or access denied' };
                const kind = kindOf(records[0].get('labels'));
                const tripId = records[0].get('tripId');

                await tx.run(
                    `MATCH (i:TripItem {id: $itemId})
                     OPTIONAL MATCH (i)-[r:AT|DEPARTS_FROM|ARRIVES_AT|EXPRESSED_IN]->()
                     DELETE r
                     WITH DISTINCT i
                     SET i += $props`,
                    { itemId, props: itemProps(kind, data) }
                );
                await attachPlacesAndCurrency(tx, tripId, itemId, kind, data);
                await tx.run(DELETE_ORPHAN_PLACES, { tripId });
                return { success: true, message: 'Trip item updated successfully' };
            });
        } catch (err) {
            throw new Error(`Failed to update trip item: ${err.message}`);
        } finally {
            await session.close();
        }
    },

    // RESCHEDULE — only the start and end, from dragging a bar on the timeline.
    rescheduleItem: async (itemId, userId, { start, end }) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH ${ITEM_ACCESS}
                 SET i.start = $start, i.end = $end
                 RETURN i.id AS id`,
                { itemId, userId, start, end: end ?? null }
            );
            return records.length
                ? { success: true }
                : { success: false, message: 'Trip item not found or access denied' };
        } catch (err) {
            throw new Error(`Failed to reschedule trip item: ${err.message}`);
        }
    },

    // DELETE ITEM — its attachments go with it, its expenses stay in the group.
    deleteItem: async (itemId, userId) => {
        const session = driver.session();
        try {
            return await session.executeWrite(async tx => {
                const { records } = await tx.run(
                    `MATCH ${ITEM_ACCESS}
                     OPTIONAL MATCH (a:Attachment)-[:ATTACHED_TO]->(i)
                     WITH t.id AS tripId, i, collect(a) AS attachments, collect(a.storedName) AS storedNames
                     FOREACH (a IN attachments | DETACH DELETE a)
                     DETACH DELETE i
                     RETURN tripId, storedNames`,
                    { itemId, userId }
                );
                if (records.length === 0) return { success: false, message: 'Trip item not found or access denied' };
                await tx.run(DELETE_ORPHAN_PLACES, { tripId: records[0].get('tripId') });
                return { success: true, message: 'Trip item deleted successfully', storedNames: records[0].get('storedNames') };
            });
        } catch (err) {
            throw new Error(`Failed to delete trip item: ${err.message}`);
        } finally {
            await session.close();
        }
    },

    // UPDATE PLACE — one correction reaches every item at that place.
    updatePlace: async (placeId, userId, { name, address, lat, lon }) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH (:User {id: $userId})-[:MEMBER_OF]->(:Group)<-[:PLANNED_IN]-(:Trip)<-[:PLACE_OF]-(p:Place {id: $placeId})
                 SET p.name = $name, p.address = $address, p.lat = $lat, p.lon = $lon
                 RETURN p.id AS id`,
                { placeId, userId, name, address: address ?? '', lat: lat ?? null, lon: lon ?? null }
            );
            if (records.length === 0) return { success: false, message: 'Place not found or access denied' };
            return { success: true, message: 'Place updated successfully' };
        } catch (err) {
            throw new Error(`Failed to update place: ${err.message}`);
        }
    },

    // LINK EXPENSE — only an expense of the same group can pay for an item.
    linkExpense: async (itemId, expenseId, userId) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH ${ITEM_ACCESS}
                 MATCH (e:Expense {id: $expenseId})-[:BALANCE_IN]->(g)
                 MERGE (e)-[:PAYS_FOR]->(i)
                 RETURN e.id AS id`,
                { itemId, expenseId, userId }
            );
            if (records.length === 0) return { success: false, message: 'Trip item or expense not found, or not in the same group' };
            return { success: true, message: 'Expense linked successfully' };
        } catch (err) {
            throw new Error(`Failed to link expense: ${err.message}`);
        }
    },

    unlinkExpense: async (itemId, expenseId, userId) => {
        try {
            const { summary } = await driver.executeQuery(
                `MATCH ${ITEM_ACCESS}
                 MATCH (:Expense {id: $expenseId})-[r:PAYS_FOR]->(i)
                 DELETE r`,
                { itemId, expenseId, userId }
            );
            if (summary.counters.updates().relationshipsDeleted === 0) return { success: false, message: 'Link not found or access denied' };
            return { success: true, message: 'Expense unlinked successfully' };
        } catch (err) {
            throw new Error(`Failed to unlink expense: ${err.message}`);
        }
    },

    // The trip item an expense pays for, if any (shown on the expense page).
    getItemForExpense: async (expenseId, userId) => {
        const { records } = await driver.executeQuery(
            `MATCH (:User {id: $userId})-[:MEMBER_OF]->(:Group)<-[:BALANCE_IN]-(:Expense {id: $expenseId})-[:PAYS_FOR]->(i:TripItem)-[:PART_OF]->(t:Trip)
             RETURN i.id AS id, i.title AS title, t.id AS tripId, t.title AS tripTitle
             LIMIT 1`,
            { expenseId, userId }
        );
        if (records.length === 0) return null;
        const r = records[0];
        return { id: r.get('id'), title: r.get('title'), tripId: r.get('tripId'), tripTitle: r.get('tripTitle') };
    },

    // ATTACHMENTS — the file lives on disk under `storedName`; the graph only
    // holds what is needed to find it and serve it back.
    createAttachment: async (itemId, userId, { filename, mimeType, size, storedName }) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH ${ITEM_ACCESS}
                 MATCH (u:User {id: $userId})
                 CREATE (a:Attachment {id: randomUUID(), filename: $filename, mimeType: $mimeType, size: $size, storedName: $storedName})-[:ATTACHED_TO]->(i)
                 CREATE (a)-[:UPLOADED_BY {on: datetime()}]->(u)
                 RETURN a.id AS id`,
                { itemId, userId, filename, mimeType, size: neo4j.int(size), storedName }
            );
            if (records.length === 0) return { success: false, message: 'Trip item not found or access denied' };
            return { success: true, id: records[0].get('id') };
        } catch (err) {
            throw new Error(`Failed to create attachment: ${err.message}`);
        }
    },

    countAttachments: async (itemId) => {
        const { records } = await driver.executeQuery(
            'MATCH (a:Attachment)-[:ATTACHED_TO]->(:TripItem {id: $itemId}) RETURN count(a) AS n',
            { itemId }
        );
        return num(records[0].get('n'));
    },

    // No user here on purpose: the download route authorises with a signed,
    // short-lived link instead of the bearer token (see routes/trips.js).
    getAttachmentById: async (id) => {
        const { records } = await driver.executeQuery(
            'MATCH (a:Attachment {id: $id}) RETURN a', { id }
        );
        return records.length ? records[0].get('a').properties : null;
    },

    deleteAttachment: async (id, userId) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH (:User {id: $userId})-[:MEMBER_OF]->(:Group)<-[:PLANNED_IN]-(:Trip)<-[:PART_OF]-(:TripItem)<-[:ATTACHED_TO]-(a:Attachment {id: $id})
                 WITH a, a.storedName AS storedName
                 DETACH DELETE a
                 RETURN storedName`,
                { id, userId }
            );
            if (records.length === 0) return { success: false, message: 'Attachment not found or access denied' };
            return { success: true, message: 'Attachment deleted successfully', storedNames: [records[0].get('storedName')] };
        } catch (err) {
            throw new Error(`Failed to delete attachment: ${err.message}`);
        }
    },
};

module.exports = tripService;
