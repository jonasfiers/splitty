// crudService.js
const crypto = require('crypto');
const neo4j = require('neo4j-driver');
const driver = require('./neo4j');
const pushService = require('./pushService');
const rateService = require('./rateService');

const getDecimals = iso =>
    new Intl.NumberFormat('en', { style: 'currency', currency: iso }).resolvedOptions().maximumFractionDigits;

const formatAmount = (amount, iso) => {
    const decimals = getDecimals(iso)
    return new Intl.NumberFormat('en', { style: 'currency', currency: iso }).format(amount / 10 ** decimals)
}

const userServiceNeo4j = {
    // CREATE
    createUser: async (name, email, password) => {
        try {
            const {records} = await driver.executeQuery(
                'CREATE (u:User {id: randomUUID(), name: $name, email: $email, password: $password, emailVerified: false}) ' +
                'RETURN u.id as id;', {name, email, password});
            return { success: true, id: records[0].get('id')};
        }
        catch (err) {
            throw new Error(`Failed to create user: ${err.message}`);
        }
    },

    // READ ALL (co-members only)
    getAllUsers: async (requesterId) => {
        try {
            const {records} = await driver.executeQuery(
                `MATCH (:User {id: $requesterId})-[:MEMBER_OF]->(g:Group)<-[:MEMBER_OF]-(u:User)
                WHERE u.id <> $requesterId
                RETURN DISTINCT u`,
                {requesterId}
            )
            return {success: true, users: records.map(record => { const { password, email, ...u } = record.get('u').properties; return u; })};
        }
        catch (err) {
            throw new Error(`Failed to get users: ${err.message}`);
        }
    },

    // READ ONE (co-members only)
    getUserById: async (id, requesterId) => {
        try {
            const {records} = await driver.executeQuery(
                `MATCH (:User {id: $requesterId})-[:MEMBER_OF]->(g:Group)<-[:MEMBER_OF]-(u:User {id: $id})
                RETURN DISTINCT u`,
                {id, requesterId}
            )
            if (records.length === 0) return { success: false, message: 'User not found' };
            const { password, ...user } = records[0].get('u').properties;
            return {success:true, user};
        }
        catch (err) {
            throw new Error(`Failed to get user: ${err.message}`);
        }
    },

    getUserByEmail: async (email) => {
        try {
            const {records} = await driver.executeQuery(
                'MATCH (u:User) WHERE u.email = $email RETURN u',
                {email}
            )
            if (records.length === 0) return { success: false, message: 'User not found' };
            return records[0].get('u').properties;
        }
        catch (err) {
            throw new Error(`Failed to get user: ${err.message}`);
        }
    },

    updateUserName: async (id, name) => {
        try {
            await driver.executeQuery(
                'MATCH (u:User {id: $id}) SET u.name = $name',
                { id, name }
            );
            return { success: true };
        } catch (err) {
            throw new Error(`Failed to update user: ${err.message}`);
        }
    },

    updateAvatarPrefs: async (id, avatarColor, avatarEmoji) => {
        try {
            await driver.executeQuery(
                'MATCH (u:User {id: $id}) SET u.avatarColor = $avatarColor, u.avatarEmoji = $avatarEmoji',
                { id, avatarColor: avatarColor ?? null, avatarEmoji: avatarEmoji ?? null }
            );
            return { success: true };
        } catch (err) {
            throw new Error(`Failed to update avatar prefs: ${err.message}`);
        }
    },

    setPendingEmail: async (id, pendingEmail) => {
        try {
            await driver.executeQuery(
                'MATCH (u:User {id: $id}) SET u.pendingEmail = $pendingEmail',
                { id, pendingEmail }
            );
            return { success: true };
        } catch (err) {
            throw new Error(`Failed to set pending email: ${err.message}`);
        }
    },

    applyPendingEmail: async (id) => {
        try {
            await driver.executeQuery(
                'MATCH (u:User {id: $id}) WHERE u.pendingEmail IS NOT NULL SET u.email = u.pendingEmail REMOVE u.pendingEmail',
                { id }
            );
            return { success: true };
        } catch (err) {
            throw new Error(`Failed to apply pending email: ${err.message}`);
        }
    },

    // UPDATE
    updateUser: async (id, name, email) => {
        try {
            const {summary} = await driver.executeQuery(
                'MATCH (u:User) WHERE u.id = $id ' +
                'SET u.name = $name ' +
                'SET u.email = $email ' +
                'RETURN u',
                {id, name, email}
            )
            if(summary.counters.containsUpdates()) {
                return { success: true, message: 'User updated successfully' };
            }
            return { success: false, message: 'User not found' };

        }
        catch (err) {
            throw new Error(`Failed to update user: ${err.message}`);
        }
    },

    getUserByIdDirect: async (id) => {
        try {
            const { records } = await driver.executeQuery(
                'MATCH (u:User {id: $id}) RETURN u',
                { id }
            );
            if (records.length === 0) return { success: false };
            const { password, ...user } = records[0].get('u').properties;
            return { success: true, user };
        } catch (err) {
            throw new Error(`Failed to get user: ${err.message}`);
        }
    },

    verifyEmail: async (userId) => {
        try {
            await driver.executeQuery(
                'MATCH (u:User {id: $userId}) SET u.emailVerified = true',
                { userId }
            );
            return { success: true };
        } catch (err) {
            throw new Error(`Failed to verify email: ${err.message}`);
        }
    },

    // SET PASSWORD (used by password reset flow)
    setPassword: async (userId, hashedPassword) => {
        try {
            await driver.executeQuery(
                'MATCH (u:User {id: $userId}) SET u.password = $hashedPassword',
                { userId, hashedPassword }
            );
            return { success: true };
        } catch (err) {
            throw new Error(`Failed to set password: ${err.message}`);
        }
    },

    // DELETE
    deleteUser: async (id) => {
        try {
            const {summary} = await driver.executeQuery(
                'MATCH (u:User) WHERE u.id = $id DETACH DELETE u;',
                {id}
            )
            if (summary.counters.updates().nodesDeleted === 0) return { success: false, message: 'User not found' };
            return { success: true, message: 'User deleted successfully' };
        }
        catch (err) {
            throw new Error(`Failed to delete user: ${err.message}`);
        }
    }
};

const currencyServiceNeo4j = {

    // CREATE
    createCurrency: async (iso, label, symbol, amountOfDecimals) => {
        try {
            const {records} = await driver.executeQuery(
                'CREATE (c:Currency {iso: $iso}) RETURN c.iso as iso',
                {iso, label, symbol, amountOfDecimals})
            return {success: true, iso: records[0].get('iso')};
        }
        catch (err) {
            throw new Error(`Failed to create currency: ${err.message}`);
        }
    },

    // READ ALL
    getAllCurrencies: async () => {
        try {
            const {records} = await driver.executeQuery(
                'MATCH (c:Currency) RETURN c'
            )
            return {success: true, currencies: records.map(record => record.get('c').properties)};
        }
        catch (err) {
            throw new Error(`Failed to get currencies: ${err.message}`);
        }
    },

    // READ ONE
    getCurrencyByIso: async (iso) => {
        try {
            const {records} = await driver.executeQuery(
                'MATCH (c:Currency) WHERE c.iso = $iso RETURN c',
                {iso}
            )
            return {success:true, currency: records.map(record => record.get('c').properties)};
        }
        catch (err) {
            throw new Error(`Failed to get currency: ${err.message}`);
        }
    },


    // DELETE
    deleteCurrency: async (iso) => {
        try {
            const {summary} = await driver.executeQuery(
                'MATCH (c:Currency) WHERE c.iso = $iso DETACH DELETE c', {iso}
            )
            if (summary.counters.containsUpdates()) {
                return { success: true, message: 'Currency deleted successfully' };
            }
            return { success: false, message: 'Could not find currency' };
        }
        catch (err) {
            throw new Error(`Failed to delete currency: ${err.message}`);
        }
    }
};

const categoryServiceNeo4j = {
    // CREATE
    createCategory: async (name, parentId, icon = '') => {
        try {
            if (parentId !== '') {
                const {records} = await driver.executeQuery(
                    `MATCH (p:Category) WHERE p.id = $parentId 
                    CREATE (c:Category ) 
                    SET
                    c.id = randomUUID(),
                    c.name = $name,
                    c.icon = $icon
                    CREATE (c)-[:CHILD_OF]->(p)
                    RETURN c.id AS id`,
                    {name, parentId, icon})
                return {success: true, id: records[0].get('id')}
            }
            else {
                const {records} = await driver.executeQuery(
                    'CREATE (c:Category {id: randomUUID(), name: $name, icon: $icon}) ' +
                    'RETURN c.id AS id',
                    {name,icon})
                return {success: true, id: records[0].get('id')}
            }
        }
        catch (err) {
            throw new Error(`Failed to create category: ${err.message}`);
        }
    },

    // READ ALL
    getAllCategories: async (groupId = null) => {
        try {
            const {records} = await driver.executeQuery(
                `MATCH (c:Category)
            OPTIONAL MATCH (c)-[:CHILD_OF]->(directParent:Category)
            OPTIONAL MATCH path = (c)-[:CHILD_OF*]->(root:Category)
            WHERE NOT (root)-[:CHILD_OF]->(:Category)
            OPTIONAL MATCH ancestorPath = (c)-[:CHILD_OF*0..]->(ancestor:Category)
            WHERE ancestor.icon <> ""
            WITH c, directParent, path, ancestor, length(ancestorPath) AS distance
            ORDER BY c.id, distance
            WITH c, directParent, path, collect(ancestor)[0] AS nearestAncestor
            WITH c, directParent, nearestAncestor,
                CASE WHEN path IS NULL THEN [c.name]
            ELSE [node IN reverse(nodes(path)) | node.name] END AS nameList
            OPTIONAL MATCH (e:Expense)-[:IN_CATEGORY]->(c)
            WHERE (e)-[:BALANCE_IN]->(:Group {id: $groupId})
            WITH c, directParent, nearestAncestor, nameList, count(e) AS usageCount
            RETURN c,
                apoc.text.join(nameList, " - ") AS fullName,
                coalesce(nearestAncestor.icon, "") AS icon,
                directParent.id AS parentId,
                usageCount
            ORDER BY usageCount DESC, fullName`,
                { groupId }
            )
            return { success: true, categories: records.map(record => ({
                    ...record.get('c').properties,
                    full_name: record.get('fullName'),
                    icon: record.get('icon'),
                    parentId: record.get('parentId'),
                }))};
        }
        catch (err) {
            throw new Error(`Failed to get categories: ${err.message}`);
        }
    },

    // READ CHILDREN
    getChildCategories: async (parentId) => {
        try {
            const {records} = await driver.executeQuery(
                'MATCH (p:Category)<-[:CHILD_OF*]-(c:Category) ' +
                'WHERE p.id = $parentId ' +
                'RETURN c ORDER BY c.full_name', {parentId}
            )
            return {success: true, categories: records.map(record => record.get('c').properties)};
        }
        catch (err) {
            throw new Error(`Failed to get Child Categories: ${err.message}`);
        }
    },

    // READ ONE
    getCategoryById: async (id) => {
        try {
            const {records} = await driver.executeQuery(
                `MATCH (c:Category {id : $id})
            OPTIONAL MATCH path = (c)-[:CHILD_OF*]->(root:Category)
            WHERE NOT (root)-[:CHILD_OF]->(:Category)
            OPTIONAL MATCH ancestorPath = (c)-[:CHILD_OF*0..]->(ancestor:Category)
            WHERE ancestor.icon <> ""
            WITH c, path, ancestor, length(ancestorPath) AS distance
            ORDER BY c.id, distance
            WITH c, path, collect(ancestor)[0] AS nearestAncestor
            WITH c, nearestAncestor,
                CASE WHEN path IS NULL THEN [c.name]
            ELSE [node IN reverse(nodes(path)) | node.name] END AS nameList
            RETURN c,
                apoc.text.join(nameList, " - ") AS fullName,
                coalesce(nearestAncestor.icon, "") AS icon
            ORDER BY fullName`, {id}
            )
            if (records.length === 0) {
                return {success: false, message: 'Category not found'};
            }
            return { success: true, categories: records.map(record => ({
                    ...record.get('c').properties,
                    full_name: record.get('fullName'),
                    icon: record.get('icon'),
                }))};
        }
        catch (err) {
            throw new Error(`Failed to get Categories: ${err.message}`);
        }
    },

    // UPDATE
    updateCategory: async (id, name, parentId, icon) => {
        try {
            const {summary} = await driver.executeQuery(
                `MATCH (c:Category) WHERE c.id = $id
            OPTIONAL MATCH (c)-[r:CHILD_OF]->(:Category)
            DELETE r
            WITH c
            SET c.name = $name,
                c.icon = $icon
            WITH c
            OPTIONAL MATCH (p:Category {id: $parentId})
            WHERE $parentId <> ""
            FOREACH (_ IN CASE WHEN p IS NOT NULL THEN [1] ELSE [] END |
            CREATE (c)-[:CHILD_OF]->(p)
        )`,
                {id, name, parentId, icon}
            )
            if (summary.counters.containsUpdates()) {
                return { success: true, message: 'Category updated successfully' };
            }
            return { success: false, message: 'Category not found' };
        }
        catch (err) {
            throw new Error(`Failed to update category: ${err.message}`);
        }
    },

    // DELETE
    deleteCategory: async (id) => {
        try {
            // Step 1: Reattach children and delete
            const { summary } = await driver.executeQuery(
                'MATCH (c:Category) WHERE c.id = $id ' +
                'OPTIONAL MATCH (c)-[:CHILD_OF]->(parent:Category) ' +
                'OPTIONAL MATCH (child:Category)-[:CHILD_OF]->(c) ' +
                'WITH c, parent, collect(child) AS children ' +
                'FOREACH (_ IN CASE WHEN parent IS NOT NULL THEN [1] ELSE [] END | ' +
                '  FOREACH (ch IN children | ' +
                '    MERGE (ch)-[:CHILD_OF]->(parent))) ' +
                'DETACH DELETE c',
                { id }
            );
            if (summary.counters.updates().nodesDeleted === 0) {
                return { success: false, message: 'Category not found' };
            }
            return { success: true, message: 'Category deleted successfully' };
        } catch (err) {
            throw new Error(`Failed to delete category: ${err.message}`);
        }
    }
};

const groupServiceNeo4j = {
    // CREATE
    createGroup: async (title, currencyIso, userId, icon) => {
        try {
            const { records } = await driver.executeQuery(
                'CREATE (g:Group{id: randomUUID(), title: $title, icon: $icon}) ' +
                'WITH g ' +
                'MATCH (c:Currency) WHERE c.iso = $currencyIso ' +
                'MERGE (g)-[:EXPRESSED_IN]->(c) ' +
                'WITH g ' +
                'MATCH (u:User) WHERE u.id = $userId ' +
                'MERGE (u)-[:MEMBER_OF]->(g) ' +
                'RETURN g.id as id',
                {title, icon, currencyIso, userId},
            )
            return { success: true, id: records[0].get('id')};
        }
        catch (err) {
            throw new Error(`Failed to create group: ${err.message}`);
        }
    },

    // READ ALL
    getAllGroups: async (userId) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH (g:Group)<-[:MEMBER_OF]-(u:User {id: $userId})
                OPTIONAL MATCH (g)-[:EXPRESSED_IN]->(c:Currency)
                WITH g, u, c
                MATCH (g)<-[:MEMBER_OF]-(m:User)
                OPTIONAL MATCH (g)<-[:BALANCE_IN]-(e:Expense)
                OPTIONAL MATCH (e)-[o:OWED_BY]->(m)
                OPTIONAL MATCH (m)-[:PAID]->(e)-[p:OWED_BY]->(:User)
                WITH g, u, c, m, sum(p.amount * coalesce(e.rateSnapshot, 1)) - sum(o.amount * coalesce(e.rateSnapshot, 1)) AS memberBalance
                WITH g, u, c, collect({id: m.id, name: m.name, balance: memberBalance, avatarColor: m.avatarColor, avatarEmoji: m.avatarEmoji}) AS members, count(m) AS memberCount
                RETURN g, members, memberCount, c.iso AS iso, c.symbol AS symbol`,
                {userId}
            )
            return {
                success: true,
                groups: records.map(record => ({
                    ...record.get('g').properties,
                    members: record.get('members').map(m => ({ ...m, balance: Number(m.balance ?? 0) })),
                    memberCount: record.get('memberCount').toNumber(),
                    iso: record.get('iso'),
                    symbol: record.get('symbol'),
                }))
            };
        }
        catch (err) {
            throw new Error(`Failed to get groups: ${err.message}`);
        }
    },

    // READ ONE
    getGroupById: async (id, userId) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH (g:Group)<-[:MEMBER_OF]-(:User {id: $userId})
                WHERE g.id = $id
                OPTIONAL MATCH (g)-[:EXPRESSED_IN]->(c:Currency)
                OPTIONAL MATCH (g)<-[:MEMBER_OF]-(m:User)
                OPTIONAL MATCH (g)<-[:BALANCE_IN]-(e:Expense)
                OPTIONAL MATCH (e)-[o:OWED_BY]->(m)
                OPTIONAL MATCH (m)-[:PAID]->(e)-[p:OWED_BY]->(:User)
                WITH g, c, m, sum(p.amount * coalesce(e.rateSnapshot, 1)) - sum(o.amount * coalesce(e.rateSnapshot, 1)) AS memberBalance
                WITH g, c, collect({id: m.id, name: m.name, balance: memberBalance, avatarColor: m.avatarColor, avatarEmoji: m.avatarEmoji}) AS members, count(m) AS memberCount
                RETURN g, members, memberCount, c.iso AS iso`,
                {id, userId}
            )
            if (records.length === 0) return { success: false, message: 'Group not found' };
            return {
                success: true,
                groups: records.map(record => ({
                    ...record.get('g').properties,
                    members: record.get('members').map(m => ({ ...m, balance: Number(m.balance ?? 0) })),
                    memberCount: record.get('memberCount').toNumber(),
                    iso: record.get('iso'),
                }))
            };
        }
        catch (err) {
            throw new Error(`Failed to get group: ${err.message}`);
        }
    },

    // UPDATE
    updateGroup: async (id, userId, title, currencyIso, icon) => {
        try {
            const { summary } = await driver.executeQuery(
                'MATCH (u:User {id: $userId})-[:MEMBER_OF]->(g:Group {id: $id}) ' +
                'MATCH (g)-[r:EXPRESSED_IN]->(:Currency) ' +
                'MATCH (tc:Currency) WHERE tc.iso = $currencyIso ' +
                'SET g.title = $title, ' +
                '    g.icon = $icon ' +
                'DELETE r ' +
                'MERGE (g)-[:EXPRESSED_IN]->(tc)',
                {id, userId, currencyIso, title, icon}
            )
            if (summary.counters.updates().propertiesSet > 0) {
                return { success: true, message: 'Group updated successfully' };
            }
            return { success: false, message: 'Group not found or access denied' };
        }
        catch (err) {
            throw new Error(`Failed to update group: ${err.message}`);
        }
    },

    // DELETE
    deleteGroup: async (id, userId) => {
        try {
            const { summary } = await driver.executeQuery(
                'MATCH (u:User {id: $userId})-[:MEMBER_OF]->(g:Group {id: $id}) ' +
                'DETACH DELETE g', 
                {id, userId}
            )
            if (summary.counters.updates().nodesDeleted === 1) {
                return { success: true, message: 'Group deleted successfully'};
            }
            return { success: false, message: 'Group not found or access denied' };
        }
        catch (err) {
            throw new Error(`Failed to delete group: ${err.message}`);
        }
    },

    // CREATE GROUP USER
    createGroupUser: async (groupId, userId, currUserId) => {
        try {
            const { summary } = await driver.executeQuery(
                'MATCH (g:Group {id: $groupId})<-[:MEMBER_OF]-(cu:User {id: $currUserId}) ' +
                'MATCH (u:User {id: $userId}) ' +
                'MERGE (g)<-[:MEMBER_OF]-(u)',
                { groupId, userId, currUserId }
            );
            if (summary.counters.updates().relationshipsCreated === 1) {
                return { success: true, message: 'User added to group successfully' };
            }
            return { success: false, message: 'Could not add user to group (already a member or access denied)' };
        } catch (err) {
            throw new Error(`Failed to add user to group: ${err.message}`);
        }
    },

    // GET GROUP MEMBERS
    getGroupMembers: async (groupId, userId) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH (u:User {id: $userId})-[:MEMBER_OF]->(g:Group {id: $groupId})
                MATCH (g)<-[:MEMBER_OF]-(m:User)
                OPTIONAL MATCH (g)<-[:BALANCE_IN]-(e:Expense)
                OPTIONAL MATCH (e)-[o:OWED_BY]->(m)
                OPTIONAL MATCH (m)-[:PAID]->(e)-[p:OWED_BY]->(:User)
                WITH g, m, sum(p.amount * coalesce(e.rateSnapshot, 1)) - sum(o.amount * coalesce(e.rateSnapshot, 1)) AS balance
                RETURN m, balance`,
                { groupId, userId }
            )
            return {
                success: true,
                members: records.map(r => {
                    const { password, email, ...u } = r.get('m').properties;
                    return { ...u, balance: Number(r.get('balance') ?? 0) };
                })
            };
        }
        catch (err) {
            throw new Error(`Failed to get group members: ${err.message}`);
        }
    },

    // GET SHARED GROUPS + BILATERAL BALANCE (for balance transfer UI)
    getSharedGroupsAndBalance: async (sourceGroupId, targetUserId, currUserId) => {
        try {
            const { records: groupRecords } = await driver.executeQuery(
                `MATCH (cu:User {id: $currUserId})-[:MEMBER_OF]->(g:Group)<-[:MEMBER_OF]-(tu:User {id: $targetUserId})
                WHERE g.id <> $sourceGroupId
                OPTIONAL MATCH (g)-[:EXPRESSED_IN]->(c:Currency)
                RETURN g.id AS id, g.title AS title, g.icon AS icon, c.iso AS iso`,
                { currUserId, targetUserId, sourceGroupId }
            );
            const groups = groupRecords.map(r => ({
                id: r.get('id'),
                title: r.get('title'),
                icon: r.get('icon'),
                iso: r.get('iso'),
            }));

            const { records: balRecords } = await driver.executeQuery(
                `MATCH (cu:User {id: $currUserId})-[:MEMBER_OF]->(sg:Group {id: $sourceGroupId})<-[:MEMBER_OF]-(tu:User {id: $targetUserId})
                OPTIONAL MATCH (cu)-[:PAID]->(e1:Expense)-[o1:OWED_BY]->(tu)
                WHERE (e1)-[:BALANCE_IN]->(sg)
                WITH cu, tu, sg, sum(coalesce(o1.amount, 0) * coalesce(e1.rateSnapshot, 1)) AS lent
                OPTIONAL MATCH (tu)-[:PAID]->(e2:Expense)-[o2:OWED_BY]->(cu)
                WHERE (e2)-[:BALANCE_IN]->(sg)
                WITH lent, sum(coalesce(o2.amount, 0) * coalesce(e2.rateSnapshot, 1)) AS owed
                RETURN lent - owed AS bilateralBalance`,
                { currUserId, targetUserId, sourceGroupId }
            );
            const bilateralBalance = Number(balRecords[0]?.get('bilateralBalance') ?? 0);

            return { success: true, groups, bilateralBalance };
        } catch (err) {
            throw new Error(`Failed to get shared groups: ${err.message}`);
        }
    },

    // DELETE GROUP USER
    deleteGroupUser: async (groupId, userId, currUserId) => {
        try {
            const { summary } = await driver.executeQuery(
                'MATCH (cu:User {id: $currUserId})-[:MEMBER_OF]->(g:Group {id: $groupId}) ' +
                'MATCH (g)<-[r:MEMBER_OF]-(u:User {id: $userId}) ' +
                'DELETE r',
                { groupId, userId, currUserId }
            )
            if (summary.counters.updates().relationshipsDeleted === 1) {
                return {success: true, message: 'User removed from this group'};
            }
            return { success: false, message: 'Could not remove user from group (not a member or access denied)' };
        }
        catch (err) {
            throw new Error(`Failed to remove user from group: ${err.message}`);
        }
    }
};

const expenseService = {
    // CREATE EXPENSE
    createExpense: async (groupId, description, categoryId, amount, currencyIso, date, paidByUserId, currUserId) => {
        try {
            // Check membership first
            const { records: memberRecords } = await driver.executeQuery(
                'MATCH (u:User {id: $currUserId})-[:MEMBER_OF]->(g:Group {id: $groupId}) RETURN g',
                { currUserId, groupId }
            );
            if (memberRecords.length === 0) throw new Error('Access denied: You are not a member of this group');

            const { records: groupRecords } = await driver.executeQuery(
                'MATCH (g:Group {id: $groupId})-[:EXPRESSED_IN]->(c:Currency) RETURN c.iso AS iso',
                { groupId }
            );
            const groupIso = groupRecords[0]?.get('iso') ?? currencyIso;
            const rawRate = await rateService.getRateForDate(currencyIso, groupIso, date);
            const rate = rawRate * (10 ** getDecimals(groupIso)) / (10 ** getDecimals(currencyIso));
            const amountBase = Math.round(amount * rate);

            const { records } = await driver.executeQuery(
                `CREATE (e:Expense {id: randomUUID(), description: $description, amount: $amount, amountBase: $amountBase, rateSnapshot: $rate, date: $date})
                WITH e
                MATCH (c:Category) WHERE c.id = $categoryId
                CREATE (e)-[:IN_CATEGORY]->(c)
                WITH e, c
                MATCH (cur:Currency) WHERE cur.iso = $currencyIso
                CREATE (e)-[:EXPRESSED_IN]->(cur)
                WITH e, c, cur
                MATCH (u:User) WHERE u.id = $paidByUserId
                CREATE (u)-[:PAID]->(e)
                WITH e, c, cur
                MATCH (g:Group) WHERE g.id = $groupId
                CREATE (e)-[:BALANCE_IN]->(g)
                WITH e, c, cur, g
                MATCH (cu:User) WHERE cu.id = $currUserId
                CREATE (e)-[:CREATED_BY {on: datetime()}]->(cu)
                WITH e, c, g, cu
                OPTIONAL MATCH (r:DailyRate {date: $date, from: $currencyIso, to: $groupIso})
                FOREACH (_ IN CASE WHEN r IS NOT NULL THEN [1] ELSE [] END |
                  CREATE (e)-[:USED_RATE]->(r)
                )
                RETURN e.id AS id, c.icon AS categoryIcon, cu.name AS creatorName, g.title AS groupName`,
                {description, amount, amountBase, rate, date, categoryId, currencyIso, groupIso, paidByUserId, groupId, currUserId},
            )
            const expenseId = records[0].get('id')
            const categoryIcon = records[0].get('categoryIcon')
            const creatorName = records[0].get('creatorName')
            const groupName = records[0].get('groupName')
            pushService.notifyGroupMembers(groupId, currUserId, {
                title: `${creatorName} added "${description}"`,
                body: `${formatAmount(amount, currencyIso)} · ${groupName}`,
                icon: categoryIcon || null,
                url: `/groups/${groupId}/expenses/${expenseId}`
            })
            return {success: true, id: expenseId};
        }
        catch (err) {
            throw new Error(`Failed to create expense: ${err.message}`);
        }
    },

    // CREATE SETTLEMENT
    createSettlement: async (groupId, amount, currencyIso, date, paidByUserId, receivedByUserId, currUserId) => {
        try {
            // Check membership first
            const { records: memberRecords } = await driver.executeQuery(
                'MATCH (u:User {id: $currUserId})-[:MEMBER_OF]->(g:Group {id: $groupId}) RETURN g',
                { currUserId, groupId }
            );
            if (memberRecords.length === 0) throw new Error('Access denied: You are not a member of this group');

            const { records: groupRecords } = await driver.executeQuery(
                'MATCH (g:Group {id: $groupId})-[:EXPRESSED_IN]->(c:Currency) RETURN c.iso AS iso',
                { groupId }
            );
            const groupIso = groupRecords[0]?.get('iso') ?? currencyIso;
            const rawRate = await rateService.getRateForDate(currencyIso, groupIso, date);
            const rate = rawRate * (10 ** getDecimals(groupIso)) / (10 ** getDecimals(currencyIso));
            const amountBase = Math.round(amount * rate);

            const { records } = await driver.executeQuery(
                `CREATE (e:Expense {
                    id: randomUUID(), 
                    description: 'Settlement', 
                    amount: $amount, 
                    amountBase: $amountBase, 
                    rateSnapshot: $rate, 
                    date: $date,
                    isSettlement: true
                })
                WITH e
                MATCH (cur:Currency) WHERE cur.iso = $currencyIso
                CREATE (e)-[:EXPRESSED_IN]->(cur)
                WITH e, cur
                MATCH (u:User) WHERE u.id = $paidByUserId
                CREATE (u)-[:PAID]->(e)
                WITH e, cur
                MATCH (g:Group) WHERE g.id = $groupId
                CREATE (e)-[:BALANCE_IN]->(g)
                WITH e, cur, g
                MATCH (receiver:User) WHERE receiver.id = $receivedByUserId
                CREATE (e)-[:OWED_BY {amount: $amount}]->(receiver)
                WITH e, cur, g
                MATCH (cu:User) WHERE cu.id = $currUserId
                CREATE (e)-[:CREATED_BY {on: datetime()}]->(cu)
                RETURN e.id AS id, cu.name AS creatorName, g.title AS groupName`,
                {amount, amountBase, rate, date, currencyIso, groupIso, paidByUserId, receivedByUserId, groupId, currUserId},
            )
            const expenseId = records[0].get('id')
            const creatorName = records[0].get('creatorName')
            const groupName = records[0].get('groupName')

            pushService.notifyGroupMembers(groupId, currUserId, {
                title: `${creatorName} recorded a settlement`,
                body: `${formatAmount(amount, currencyIso)} · ${groupName}`,
                url: `/groups/${groupId}`
            })
            return {success: true, id: expenseId};
        }
        catch (err) {
            throw new Error(`Failed to create settlement: ${err.message}`);
        }
    },

    // CREATE BALANCE TRANSFER
    createBalanceTransfer: async (sourceGroupId, targetGroupId, targetUserId, currUserId) => {
        try {
            const { records: setupRecords } = await driver.executeQuery(
                `MATCH (cu:User {id: $currUserId})-[:MEMBER_OF]->(sg:Group {id: $sourceGroupId})<-[:MEMBER_OF]-(tu:User {id: $targetUserId})
                MATCH (cu)-[:MEMBER_OF]->(tg:Group {id: $targetGroupId})<-[:MEMBER_OF]-(tu)
                MATCH (sg)-[:EXPRESSED_IN]->(sc:Currency)
                MATCH (tg)-[:EXPRESSED_IN]->(tc:Currency)
                RETURN sc.iso AS sourceIso, tc.iso AS targetIso, sg.title AS sourceTitle, tg.title AS targetTitle, cu.name AS cuName`,
                { currUserId, targetUserId, sourceGroupId, targetGroupId }
            );
            if (setupRecords.length === 0) throw new Error('Access denied or groups not found');

            const sourceIso = setupRecords[0].get('sourceIso');
            const targetIso = setupRecords[0].get('targetIso');
            const sourceTitle = setupRecords[0].get('sourceTitle');
            const targetTitle = setupRecords[0].get('targetTitle');
            const cuName = setupRecords[0].get('cuName');

            const { records: balRecords } = await driver.executeQuery(
                `MATCH (cu:User {id: $currUserId})-[:MEMBER_OF]->(sg:Group {id: $sourceGroupId})<-[:MEMBER_OF]-(tu:User {id: $targetUserId})
                OPTIONAL MATCH (cu)-[:PAID]->(e1:Expense)-[o1:OWED_BY]->(tu)
                WHERE (e1)-[:BALANCE_IN]->(sg)
                WITH cu, tu, sg, sum(coalesce(o1.amount, 0) * coalesce(e1.rateSnapshot, 1)) AS lent
                OPTIONAL MATCH (tu)-[:PAID]->(e2:Expense)-[o2:OWED_BY]->(cu)
                WHERE (e2)-[:BALANCE_IN]->(sg)
                WITH lent, sum(coalesce(o2.amount, 0) * coalesce(e2.rateSnapshot, 1)) AS owed
                RETURN lent - owed AS bilateralBalance`,
                { currUserId, targetUserId, sourceGroupId }
            );
            const bilateralBalance = Number(balRecords[0]?.get('bilateralBalance') ?? 0);
            if (bilateralBalance === 0) return { success: false, message: 'No balance to transfer' };

            const amount = Math.abs(bilateralBalance);
            const creditorId = bilateralBalance > 0 ? currUserId : targetUserId;
            const debtorId   = bilateralBalance > 0 ? targetUserId : currUserId;

            const today = new Date().toISOString().slice(0, 10);
            const rawRate = await rateService.getRateForDate(sourceIso, targetIso, today);
            const conversionRate = rawRate * (10 ** getDecimals(targetIso)) / (10 ** getDecimals(sourceIso));
            const transferAmount = Math.round(amount * conversionRate);

            const session = driver.session();
            let settlementId, transferId;
            try {
                ({ settlementId, transferId } = await session.executeWrite(async tx => {
                    const sRes = await tx.run(
                        `CREATE (s:Expense {
                            id: randomUUID(),
                            description: $settlementDescription,
                            amount: $amount,
                            amountBase: $amount,
                            rateSnapshot: 1.0,
                            date: $date,
                            isTransfer: true
                        })
                        WITH s
                        MATCH (payer:User {id: $debtorId})
                        CREATE (payer)-[:PAID]->(s)
                        WITH s
                        MATCH (receiver:User {id: $creditorId})
                        CREATE (s)-[:OWED_BY {amount: $amount}]->(receiver)
                        WITH s
                        MATCH (sg:Group {id: $sourceGroupId})
                        CREATE (s)-[:BALANCE_IN]->(sg)
                        WITH s
                        MATCH (cur:Currency {iso: $sourceIso})
                        CREATE (s)-[:EXPRESSED_IN]->(cur)
                        WITH s
                        MATCH (cu:User {id: $currUserId})
                        CREATE (s)-[:CREATED_BY {on: datetime()}]->(cu)
                        RETURN s.id AS id`,
                        { amount, date: today, debtorId, creditorId, sourceGroupId, sourceIso, currUserId, settlementDescription: `Balance transfer to ${targetTitle}` }
                    );
                    const sid = sRes.records[0].get('id');

                    const tRes = await tx.run(
                        `CREATE (t:Expense {
                            id: randomUUID(),
                            description: $description,
                            amount: $transferAmount,
                            amountBase: $transferAmount,
                            rateSnapshot: 1.0,
                            date: $date,
                            isTransfer: true
                        })
                        WITH t
                        MATCH (creditor:User {id: $creditorId})
                        CREATE (creditor)-[:PAID]->(t)
                        WITH t
                        MATCH (debtor:User {id: $debtorId})
                        CREATE (t)-[:OWED_BY {amount: $transferAmount}]->(debtor)
                        WITH t
                        MATCH (tg:Group {id: $targetGroupId})
                        CREATE (t)-[:BALANCE_IN]->(tg)
                        WITH t
                        MATCH (cur:Currency {iso: $targetIso})
                        CREATE (t)-[:EXPRESSED_IN]->(cur)
                        WITH t
                        MATCH (cu:User {id: $currUserId})
                        CREATE (t)-[:CREATED_BY {on: datetime()}]->(cu)
                        RETURN t.id AS id`,
                        { transferAmount, date: today, creditorId, debtorId, targetGroupId, targetIso, currUserId, description: `Balance transfer from ${sourceTitle}` }
                    );
                    const tid = tRes.records[0].get('id');

                    await tx.run(
                        `MATCH (s:Expense {id: $sid}), (t:Expense {id: $tid})
                        CREATE (s)-[:TRANSFER_PAIR]->(t)`,
                        { sid, tid }
                    );

                    return { settlementId: sid, transferId: tid };
                }));
            } finally {
                await session.close();
            }

            pushService.notifyGroupMembers(sourceGroupId, currUserId, {
                title: `${cuName} transferred a balance`,
                body: `${formatAmount(amount, sourceIso)} settled · ${sourceTitle}`,
                url: `/groups/${sourceGroupId}`
            });
            pushService.notifyGroupMembers(targetGroupId, currUserId, {
                title: `${cuName} transferred a balance`,
                body: `${formatAmount(transferAmount, targetIso)} added · ${targetTitle}`,
                url: `/groups/${targetGroupId}`
            });

            return { success: true, settlementId, transferId };
        } catch (err) {
            throw new Error(`Failed to create balance transfer: ${err.message}`);
        }
    },

    // GET EXPENSES BY GROUP
    getExpensesByGroupId: async (groupId, userId, skip = 0, limit = 25, filters = {}) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH (u:User {id: $userId})-[:MEMBER_OF]->(g:Group {id: $groupId})
                MATCH (e:Expense)-[:BALANCE_IN]->(g)
                OPTIONAL MATCH (e)<-[:PAID]-(uPayer:User)
                OPTIONAL MATCH (e)-[:IN_CATEGORY]->(c:Category)
                OPTIONAL MATCH (e)-[:EXPRESSED_IN]->(cur:Currency)
                OPTIONAL MATCH (e)-[o:OWED_BY]->(uSelf:User {id: $userId})
                WITH e, uPayer, c, cur, o
                WHERE ($keyword IS NULL OR toLower(e.description) CONTAINS toLower($keyword))
                  AND ($categoryId IS NULL OR c.id = $categoryId)
                  AND ($paidByUserId IS NULL OR uPayer.id = $paidByUserId)
                  AND ($startDate IS NULL OR e.date >= $startDate)
                  AND ($endDate IS NULL OR e.date <= $endDate)
                OPTIONAL MATCH iconPath = (c)-[:CHILD_OF*0..]->(iconAncestor:Category)
                WHERE iconAncestor.icon <> ""
                WITH e, uPayer, c, cur, o, iconAncestor, length(iconPath) AS iconDist
                ORDER BY iconDist
                WITH e, uPayer, c, cur, o, collect(iconAncestor)[0] AS nearestIcon
                RETURN e,
                    uPayer.id AS paidByUserId,
                    uPayer.name AS paidByName,
                    coalesce(nearestIcon.icon, '') AS categoryIcon,
                    c.id AS categoryId,
                    cur.iso AS currencyIso,
                    o.amount AS shareAmount
                ORDER BY e.date DESC
                SKIP $skip LIMIT $limit`,
                {
                    groupId, userId,
                    skip: neo4j.int(skip), limit: neo4j.int(limit),
                    keyword:      filters.keyword      ?? null,
                    categoryId:   filters.categoryId   ?? null,
                    paidByUserId: filters.paidByUserId ?? null,
                    startDate:    filters.startDate    ?? null,
                    endDate:      filters.endDate      ?? null,
                }
            )
            const expenses = records.map(record => ({
                ...record.get('e').properties,
                paidByUserId: record.get('paidByUserId'),
                paidByName:   record.get('paidByName'),
                categoryIcon: record.get('categoryIcon'),
                categoryId:   record.get('categoryId'),
                currencyIso:  record.get('currencyIso'),
                shareAmount:  record.get('shareAmount'),
            }))
            return { success: true, expenses, hasMore: expenses.length === limit };
        }
        catch (err) {
            throw new Error(`Failed to get expenses: ${err.message}`);
        }
    },

    // GET CATEGORY TOTALS FOR GROUP
    getGroupCategoryTotals: async (groupId, userId) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH (u:User {id: $userId})-[:MEMBER_OF]->(g:Group {id: $groupId})
                MATCH (e:Expense)-[:BALANCE_IN]->(g)
                WHERE NOT coalesce(e.isSettlement, false) AND NOT coalesce(e.isTransfer, false)
                OPTIONAL MATCH (e)-[:IN_CATEGORY]->(c:Category)
                OPTIONAL MATCH iconPath = (c)-[:CHILD_OF*0..]->(iconAncestor:Category)
                WHERE iconAncestor.icon <> ""
                WITH c, e, iconAncestor, length(iconPath) AS iconDist
                ORDER BY iconDist
                WITH c, e, collect(iconAncestor)[0] AS nearestIcon
                OPTIONAL MATCH path = (c)-[:CHILD_OF*]->(root:Category)
                WHERE NOT (root)-[:CHILD_OF]->(:Category)
                WITH c, nearestIcon, sum(e.amountBase) AS total,
                    CASE WHEN c IS NULL THEN 'Uncategorized'
                         WHEN path IS NULL THEN c.name
                         ELSE apoc.text.join([node IN reverse(nodes(path)) | node.name], ' - ')
                    END AS categoryName
                RETURN c.id AS categoryId, categoryName, coalesce(nearestIcon.icon, '') AS icon, total
                ORDER BY total DESC`,
                { groupId, userId }
            )
            return {
                success: true,
                categories: records.map(r => ({
                    categoryId: r.get('categoryId'),
                    name: r.get('categoryName'),
                    icon: r.get('icon'),
                    total: r.get('total'),
                }))
            }
        } catch (err) {
            throw new Error(`Failed to get category totals: ${err.message}`)
        }
    },

    // GET EXPENSE BY ID
    getExpensesById: async (id, userId) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH (e:Expense {id: $id})-[:BALANCE_IN]->(g:Group)<-[:MEMBER_OF]-(:User {id: $userId})
                OPTIONAL MATCH (e)<-[:PAID]-(u:User)
                OPTIONAL MATCH (e)-[:IN_CATEGORY]->(c:Category)
                OPTIONAL MATCH (e)-[:EXPRESSED_IN]->(cur:Currency)
                OPTIONAL MATCH (g)-[:EXPRESSED_IN]->(gc:Currency)
                OPTIONAL MATCH path = (c)-[:CHILD_OF*]->(root:Category)
                WHERE NOT (root)-[:CHILD_OF]->(:Category)
                WITH e, u, c, cur, gc,
                    CASE WHEN c IS NULL THEN null
                         WHEN path IS NULL THEN c.name
                         ELSE apoc.text.join([node IN reverse(nodes(path)) | node.name], ' - ')
                    END AS categoryName
                OPTIONAL MATCH iconPath = (c)-[:CHILD_OF*0..]->(iconAncestor:Category)
                WHERE iconAncestor.icon <> ""
                WITH e, u, c, cur, gc, categoryName, iconAncestor, length(iconPath) AS iconDist
                ORDER BY iconDist
                WITH e, u, c, cur, gc, categoryName, collect(iconAncestor)[0] AS nearestIcon
                RETURN e, u.id AS paidByUserId, u.name AS paidByName, c.id AS categoryId,
                       coalesce(nearestIcon.icon, '') AS categoryIcon, categoryName, cur.iso AS currencyIso,
                       gc.iso AS groupCurrencyIso`,
                {id, userId}
            )
            if (records.length === 0) { return { success: false, message: 'Expense not found or access denied.' };}
            const record = records[0];
            return {
                success: true,
                expense: {
                    ...record.get('e').properties,
                    paidByUserId:    record.get('paidByUserId'),
                    paidByName:      record.get('paidByName'),
                    categoryId:      record.get('categoryId'),
                    categoryIcon:    record.get('categoryIcon'),
                    categoryName:    record.get('categoryName'),
                    currencyIso:     record.get('currencyIso'),
                    groupCurrencyIso: record.get('groupCurrencyIso'),
                }
            };
        }
        catch (err) {
            throw new Error(`Failed to get expense: ${err.message}`);
        }
    },

    // UPDATE
    updateExpense: async (id, groupId, description, categoryId, amount, currencyIso, date, paidByUserId, currUserId) => {
        try {
            // Check membership first
            const { records: memberRecords } = await driver.executeQuery(
                'MATCH (u:User {id: $currUserId})-[:MEMBER_OF]->(g:Group {id: $groupId}) RETURN g',
                { currUserId, groupId }
            );
            if (memberRecords.length === 0) throw new Error('Access denied: You are not a member of this group');

            const { records: groupRecords } = await driver.executeQuery(
                'MATCH (g:Group {id: $groupId})-[:EXPRESSED_IN]->(c:Currency) RETURN c.iso AS iso',
                { groupId }
            );
            const groupIso = groupRecords[0]?.get('iso') ?? currencyIso;
            const rawRate = await rateService.getRateForDate(currencyIso, groupIso, date);
            const rateSnapshot = rawRate * (10 ** getDecimals(groupIso)) / (10 ** getDecimals(currencyIso));
            const amountBase = Math.round(amount * rateSnapshot);

            const { records, summary } = await driver.executeQuery(
                `MATCH (e:Expense {id: $id})-[:BALANCE_IN]->(g:Group {id: $groupId})
                SET e.description = $description, e.amount = $amount, e.amountBase = $amountBase, e.rateSnapshot = $rateSnapshot, e.date = $date
                WITH e, g
                MATCH (c:Category) WHERE c.id = $categoryId
                MATCH (cur:Currency) WHERE cur.iso = $currencyIso
                MATCH (u:User) WHERE u.id = $paidByUserId
                MATCH (cu:User) WHERE cu.id = $currUserId
                OPTIONAL MATCH (:User)-[rp:PAID]->(e)
                OPTIONAL MATCH (e)-[oldRate:USED_RATE]->(:DailyRate)
                OPTIONAL MATCH (e)-[oldCat:IN_CATEGORY]->(:Category)
                DELETE rp, oldRate, oldCat
                WITH e, c, g, cur, u, cu
                MERGE (e)-[:IN_CATEGORY]->(c)
                MERGE (u)-[:PAID]->(e)
                MERGE (e)-[:EXPRESSED_IN]->(cur)
                CREATE (e)-[:UPDATED_BY{on: datetime()}]->(cu)
                WITH e, c, g, cu
                OPTIONAL MATCH (r:DailyRate {date: $date, from: $currencyIso, to: $groupIso})
                FOREACH (_ IN CASE WHEN r IS NOT NULL THEN [1] ELSE [] END |
                  CREATE (e)-[:USED_RATE]->(r)
                )
                RETURN c.icon AS categoryIcon, cu.name AS creatorName, g.title AS groupName`,
                {id, description, amount, amountBase, rateSnapshot, date, categoryId, groupId, groupIso, currencyIso, paidByUserId, currUserId},
            )
            if (summary.counters.containsUpdates()) {
                const categoryIcon = records[0]?.get('categoryIcon')
                const creatorName = records[0]?.get('creatorName')
                const groupName = records[0]?.get('groupName')
                pushService.notifyGroupMembers(groupId, currUserId, {
                    title: `${creatorName} updated "${description}"`,
                    body: `${formatAmount(amount, currencyIso)} · ${groupName}`,
                    icon: categoryIcon || null,
                    url: `/groups/${groupId}/expenses/${id}`
                })
                return {success: true, message: 'Expense has been successfully updated'};
            }
                return {success: false, message: 'Expense not found or access denied' };
        }
        catch (err) {
            throw new Error(`Failed to update expense: ${err.message}`);
        }
    },

    // DELETE
    deleteExpenseById: async (id, currUserId) => {
        try {
            const { records: infoRecords } = await driver.executeQuery(
                `MATCH (e:Expense {id: $id})-[:BALANCE_IN]->(g:Group)<-[:MEMBER_OF]-(deleter:User {id: $currUserId})
                 OPTIONAL MATCH (e)-[:IN_CATEGORY]->(c:Category)
                 OPTIONAL MATCH (e)-[:EXPRESSED_IN]->(cur:Currency)
                 RETURN e.description AS description, e.amount AS amount, cur.iso AS currencyIso, c.icon AS categoryIcon, g.id AS groupId, g.title AS groupName, deleter.name AS deleterName`,
                { id, currUserId }
            )
            if (infoRecords.length === 0) return { success: false, message: 'Expense not found or access denied' }
            const info = infoRecords[0]

            const { summary } = await driver.executeQuery(
                'MATCH (e:Expense {id: $id})' +
                'OPTIONAL MATCH (e)-[:TRANSFER_PAIR]-(t) DETACH DELETE e, t', { id }
            )
            if (summary.counters.updates().nodesDeleted > 0) {
                if (info) {
                    const delAmount = info.get('amount')
                    const delIso = info.get('currencyIso')
                    const formattedDelete = delAmount != null && delIso
                        ? `${formatAmount(Number(delAmount), delIso)} · `
                        : ''
                    pushService.notifyGroupMembers(info.get('groupId'), currUserId, {
                        title: `${info.get('deleterName')} deleted "${info.get('description')}"`,
                        body: `${formattedDelete}${info.get('groupName')}`,
                        icon: info.get('categoryIcon') || null,
                        url: `/groups/${info.get('groupId')}`
                    })
                }
                return { success: true, message: 'Expense has been successfully deleted' }
            }
            return { success: false, message: 'Expense not found' }
        }
        catch (err) {
            throw new Error(`Failed to delete expense: ${err.message}`)
        }
    }
};

const shareService = {

    createShare: async (expenseId, userId, amount, currUserId) => {
        try {
            const { summary } = await driver.executeQuery(
                `MATCH (cu:User {id: $currUserId})-[:MEMBER_OF]->(g:Group)<-[:BALANCE_IN]-(e:Expense {id: $expenseId})
                MATCH (u:User {id: $userId})
                MERGE (u)<-[:OWED_BY {amount: $amount}]-(e)`,
                {userId, expenseId, amount, currUserId }
            );
            if (summary.counters.updates().relationshipsCreated >= 1 || summary.counters.updates().propertiesSet >= 1) {
                return { success: true, message: 'Share created/updated successfully' };
            }
            return { success: false, message: 'Could not create share (access denied or objects not found)' };
        } catch (err) {
            throw new Error(`Failed to create share: ${err.message}`);
        }
    },

    // READ SHARES
    getShares: async (expenseId, excludePayer, currUserId) => {
        try{
            const { records } = await driver.executeQuery(
                `MATCH (uSelf:User {id: $currUserId})-[:MEMBER_OF]->(g:Group)<-[:BALANCE_IN]-(e:Expense {id: $expenseId})
                OPTIONAL MATCH (e)-[r:OWED_BY]->(ou:User)
                WITH e, [s IN collect({userId: ou.id, amount: r.amount}) WHERE s.userId IS NOT NULL] AS shares, sum(r.amount) AS totalOwed
                MATCH (pu)-[:PAID]->(e)
                RETURN shares, pu.id AS payerId, e.amount - totalOwed AS remainder`,
                { expenseId, currUserId }
            )
            if (!records[0]) return { success: false, message: 'Expense not found or access denied' };
            const record = records[0];
            const shares = record.get('shares');
            if (excludePayer === false) {
                shares.push({ userId: record.get('payerId'), amount: record.get('remainder') });
            }
            return {success: true, shares};
        }
        catch (err) {
            throw new Error(`Failed to get shares: ${err.message}`);
        }
    },

    // DELETE SHARE
    deleteShare: async (expenseId, userId, currUserId) => {
        try {
            const { summary } = await driver.executeQuery(
                'MATCH (cu:User {id: $currUserId})-[:MEMBER_OF]->(g:Group)<-[:BALANCE_IN]-(e:Expense {id: $expenseId}) ' +
                'MATCH (e)-[r:OWED_BY]->(u:User {id: $userId}) ' +
                'DELETE r',
                { expenseId, userId, currUserId }
            );
            if (summary.counters.updates().relationshipsDeleted >= 1) {
                return { success: true, message: 'Share deleted successfully' };
            }
            return { success: false, message: 'Share not found or access denied' };
        }
        catch (err) {
            throw new Error(`Failed to delete share: ${err.message}`);
        }
    }
}

const passkeyService = {
    createPasskey: async (userId, credentialId, publicKey, counter, transports) => {
        try {
            await driver.executeQuery(
                'MATCH (u:User {id: $userId}) ' +
                'CREATE (p:Passkey {credentialId: $credentialId, publicKey: $publicKey, counter: $counter, transports: $transports})-[:BELONGS_TO]->(u)',
                { userId, credentialId, publicKey, counter, transports }
            );
            return { success: true };
        } catch (err) {
            throw new Error(`Failed to create passkey: ${err.message}`);
        }
    },

    getPasskeysByUserId: async (userId) => {
        try {
            const { records } = await driver.executeQuery(
                'MATCH (p:Passkey)-[:BELONGS_TO]->(u:User {id: $userId}) RETURN p',
                { userId }
            );
            return { success: true, passkeys: records.map(r => r.get('p').properties) };
        } catch (err) {
            throw new Error(`Failed to get passkeys: ${err.message}`);
        }
    },

    getPasskeyByCredentialId: async (credentialId) => {
        try {
            const { records } = await driver.executeQuery(
                'MATCH (p:Passkey {credentialId: $credentialId})-[:BELONGS_TO]->(u:User) RETURN p, u.id AS userId',
                { credentialId }
            );
            if (records.length === 0) return null;
            return { ...records[0].get('p').properties, userId: records[0].get('userId') };
        } catch (err) {
            throw new Error(`Failed to get passkey: ${err.message}`);
        }
    },

    updatePasskeyCounter: async (credentialId, counter) => {
        try {
            await driver.executeQuery(
                'MATCH (p:Passkey {credentialId: $credentialId}) SET p.counter = $counter',
                { credentialId, counter }
            );
            return { success: true };
        } catch (err) {
            throw new Error(`Failed to update passkey counter: ${err.message}`);
        }
    },

    deletePasskey: async (credentialId, userId) => {
        try {
            const { summary } = await driver.executeQuery(
                'MATCH (p:Passkey {credentialId: $credentialId})-[:BELONGS_TO]->(u:User {id: $userId}) DETACH DELETE p',
                { credentialId, userId }
            );
            if (summary.counters.updates().nodesDeleted === 1) return { success: true };
            return { success: false, message: 'Passkey not found' };
        } catch (err) {
            throw new Error(`Failed to delete passkey: ${err.message}`);
        }
    },
};

const TOKEN_TYPES = new Set(['Invite', 'Password', 'EmailVerification', 'EmailChange']);

const tokenService = {
    create: async (type, payload, ttlMs) => {
        if (!TOKEN_TYPES.has(type)) throw new Error(`Invalid token type: ${type}`);
        await driver.executeQuery(`MATCH (t:Token:${type}) WHERE t.expiresAt <= datetime() DELETE t`);
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + ttlMs).toISOString();
        await driver.executeQuery(
            `CREATE (t:Token:${type} {token: $token, expiresAt: datetime($expiresAt)})
            SET t += $payload`,
            { token, expiresAt, payload }
        );
        return token;
    },

    find: async (type, token) => {
        if (!TOKEN_TYPES.has(type)) throw new Error(`Invalid token type: ${type}`);
        const { records } = await driver.executeQuery(
            `MATCH (t:Token:${type} {token: $token}) WHERE t.expiresAt > datetime() RETURN properties(t) AS props`,
            { token }
        );
        return records.length > 0 ? records[0].get('props') : null;
    },

    consume: async (type, token) => {
        if (!TOKEN_TYPES.has(type)) throw new Error(`Invalid token type: ${type}`);
        const { records } = await driver.executeQuery(
            `MATCH (t:Token:${type} {token: $token}) WHERE t.expiresAt > datetime()
            WITH t, properties(t) AS props
            DELETE t
            RETURN props`,
            { token }
        );
        return records.length > 0 ? records[0].get('props') : null;
    },
};

const inviteService = {
    createInvite: async (groupId, requesterId) => {
        const { records: check } = await driver.executeQuery(
            'MATCH (:User {id: $requesterId})-[:MEMBER_OF]->(g:Group {id: $groupId}) RETURN g',
            { requesterId, groupId }
        );
        if (check.length === 0) throw new Error('Access denied');
        const token = await tokenService.create('Invite', { groupId }, 7 * 24 * 60 * 60 * 1000);
        return { success: true, token };
    },

    getInviteInfo: async (token) => {
        const t = await tokenService.find('Invite', token);
        if (!t) return { success: false, message: 'Invite not found or expired' };
        const { records } = await driver.executeQuery(
            'MATCH (g:Group {id: $groupId}) RETURN g.id AS id, g.title AS title, g.icon AS icon',
            { groupId: t.groupId }
        );
        if (records.length === 0) return { success: false, message: 'Invite not found or expired' };
        return { success: true, group: { id: records[0].get('id'), title: records[0].get('title'), icon: records[0].get('icon') } };
    },

    redeemInvite: async (token, userId) => {
        const t = await tokenService.consume('Invite', token);
        if (!t) return { success: false, message: 'Invite not found or expired' };
        const { records } = await driver.executeQuery(
            `MATCH (g:Group {id: $groupId}), (u:User {id: $userId})
            MERGE (u)-[:MEMBER_OF]->(g)
            RETURN g.id AS groupId`,
            { groupId: t.groupId, userId }
        );
        if (records.length === 0) return { success: false, message: 'Group not found' };
        return { success: true, groupId: records[0].get('groupId') };
    },
};

module.exports = {
    userServiceNeo4j,
    currencyServiceNeo4j,
    categoryServiceNeo4j,
    groupServiceNeo4j,
    expenseService,
    shareService,
    passkeyService,
    inviteService,
    tokenService,
};
