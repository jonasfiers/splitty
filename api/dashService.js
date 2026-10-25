const driver = require('./neo4j');

// The user's own part of each expense, for getInsights' "mine" scope. The payer
// has no OWED_BY of their own: only the others' shares are stored, so what the
// payer carries is the amount minus those. Expenses the user neither paid nor
// shares in drop out.
const MY_SHARE = `
            OPTIONAL MATCH (e)-[share:OWED_BY]->(me)
            OPTIONAL MATCH (me)-[paid:PAID]->(e)
            WITH me, e, g, share, paid
            WHERE share IS NOT NULL OR paid IS NOT NULL
            OPTIONAL MATCH (e)-[other:OWED_BY]->(:User)
            WITH e, g, share, sum(other.amount) AS owedByAll
            WITH e, g, CASE WHEN share IS NOT NULL THEN share.amount ELSE e.amount - owedByAll END AS raw
            WHERE raw > 0`

const dashService = {

    // BALANCE HEADER
    getBalances: async (userId) => {
        try {
            const {records} = await driver.executeQuery(
                `MATCH (u:User {id: $userId})
                CALL {
                  WITH u
                  MATCH (u)-[:PAID]->(e:Expense)-[o:OWED_BY]->(other:User) WHERE other <> u
                  RETURN other, sum(o.amount * coalesce(e.rateSnapshot, 1)) as lent, 0 as owed
                  UNION ALL
                  WITH u
                  MATCH (other:User)-[:PAID]->(e:Expense)-[o:OWED_BY]->(u) WHERE other <> u
                  RETURN other, 0 as lent, sum(o.amount * coalesce(e.rateSnapshot, 1)) as owed
                }
                WITH other, sum(lent) as totalLent, sum(owed) as totalOwed
                WITH totalLent - totalOwed as net, totalLent, totalOwed
                RETURN 
                  sum(totalLent) as grossLent,
                  sum(totalOwed) as grossOwed,
                  sum(CASE WHEN net > 0 THEN net ELSE 0 END) as balanceLent,
                  sum(CASE WHEN net < 0 THEN -net ELSE 0 END) as balanceOwed`, {userId: userId}
            )
            const rec = records[0];
            return {
                success: true,
                grossLent: Number(rec?.get('grossLent') ?? 0),
                grossOwed: Number(rec?.get('grossOwed') ?? 0),
                balanceLent: Number(rec?.get('balanceLent') ?? 0),
                balanceOwed: Number(rec?.get('balanceOwed') ?? 0)
            }
        } catch (err) {
            throw new Error(`Failed to get balances: ${err.message}`);
        }
    },

    // GROUP CARDS
    // READ ALL
    getGroupCards: async (userId) => {
        try {
            const {records} = await driver.executeQuery(
                `MATCH (g:Group)<-[:MEMBER_OF]-(u:User {id: $userId})
                OPTIONAL MATCH (g)-[:EXPRESSED_IN]->(c:Currency)
                WITH g, u, c
                MATCH (g)<-[:MEMBER_OF]-(m:User)
                OPTIONAL MATCH (g)<-[:BALANCE_IN]-(e:Expense)
                OPTIONAL MATCH (e)-[o:OWED_BY]->(m)
                OPTIONAL MATCH (m)-[:PAID]->(e)-[p:OWED_BY]->(:User)
                WITH g, u, c, m, sum(p.amount * coalesce(e.rateSnapshot, 1)) - sum(o.amount * coalesce(e.rateSnapshot, 1)) AS memberBalance
                WITH g, u, c, collect({id: m.id, name: m.name, balance: memberBalance, avatarColor: m.avatarColor, avatarEmoji: m.avatarEmoji}) AS members, count(m) AS memberCount
                OPTIONAL MATCH (g)<-[:BALANCE_IN]-(le:Expense)-[lr:UPDATED_BY|CREATED_BY]->(:User)
                WITH g, c, members, memberCount, max(lr.on) AS lastActivity
                RETURN g,
                       members,
                       c.iso AS iso,
                       memberCount,
                       lastActivity`,
                {userId}
            )
            return {
                success: true,
                groups: records.map(record => ({
                    ...record.get('g').properties,
                    members: record.get('members').map(m => ({ ...m, balance: Number(m.balance ?? 0) })),
                    memberCount: record.get('memberCount').toNumber(),
                    iso: record.get('iso'),
                    lastActivity: record.get('lastActivity') ? record.get('lastActivity').toStandardDate().getTime() : null,
                }))
            };
        } catch (err) {
            throw new Error(`Failed to get group cards: ${err.message}`);
        }
    },

    // ACTIVITY CARDS
    getActivity: async (userId) => {
        try {
            const {records} = await driver.executeQuery(
                `MATCH 
                (u:User)<-[r:UPDATED_BY|CREATED_BY]-(e:Expense)-[:BALANCE_IN]->(g:Group)<-[:MEMBER_OF]-(:User {id: $userId})
                MATCH (e)-[:EXPRESSED_IN]->(c:Currency)
            RETURN
            u.name as userName, 
            e.id as expenseId, 
            g.id as groupId, 
            e.description as description, 
            e.amount as amount, 
            c.iso as currencyIso,
            type(r) as action,
            r.on as timestamp,
            e:Settlement as isSettlement
            order by r.on DESC`,
                {userId}
            )
            return {
                success: true,
                activities: records.map(record => ({
                    userName: record.get('userName'),
                    expenseId: record.get('expenseId'),
                    groupId: record.get('groupId'),
                    description: record.get('description'),
                    amount: record.get('amount'),
                    currencyIso: record.get('currencyIso'),
                    action: record.get('action'),
                    timestamp: record.get('timestamp').toStandardDate().getTime(),
                    isSettlement: record.get('isSettlement') || false
                }))
            };
        } catch (err) {
            throw new Error(`Failed to get groups: ${err.message}`);
        }
    },

    // PROFILE
    getProfile: async (userId) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH (u:User {id: $userId})
                OPTIONAL MATCH (g:Group)<-[:MEMBER_OF]-(u)
                OPTIONAL MATCH (g)<-[:BALANCE_IN]-(e:Expense)
                WHERE NOT e:Settlement AND NOT e:Transfer
                WITH u, count(distinct g) AS groupCount, count(distinct e) AS expenseCount
                CALL {
                    WITH u
                    OPTIONAL MATCH (u)-[:PAID]->(ep:Expense)-[p:OWED_BY]->(:User)
                    RETURN sum(p.amount * coalesce(ep.rateSnapshot, 1)) AS balanceLent
                }
                CALL {
                    WITH u
                    OPTIONAL MATCH (eo:Expense)-[o:OWED_BY]->(u)
                    RETURN sum(o.amount * coalesce(eo.rateSnapshot, 1)) AS balanceOwed
                }
                RETURN u, groupCount, expenseCount, balanceLent - balanceOwed AS balance`
                ,{userId})
            if (!records[0]) return { success: true, profile: null };
            const { password, pendingEmail, ...userProps } = records[0].get('u').properties;
            return {
                success: true,
                profile: {
                    ...userProps,
                    hasPassword: !!password,
                    pendingEmail: pendingEmail || null,
                    groupCount: Number(records[0].get('groupCount')),
                    expenseCount: Number(records[0].get('expenseCount')),
                    balance: Number(records[0].get('balance')),
                }
            }
        }
        catch (err) {
            throw new Error(`Failed to get profile: ${err.message}`);
        }
    },

    // Optional filters: from (YYYY-MM-DD, inclusive), groupId (one of the user's
    // groups), mine (count the user's own share of each expense instead of its
    // full amount). Without them this is all groups, all time, full amounts.
    getInsights: async (userId, { from = null, groupId = null, mine = false } = {}) => {
        // Shared start of every query below. Only these two fixed fragments vary,
        // never anything taken from the request.
        const base = (dated) => `
            MATCH (me:User {id: $userId})-[:MEMBER_OF]->(g:Group)
            WHERE $groupId IS NULL OR g.id = $groupId
            MATCH (e:Expense)-[:BALANCE_IN]->(g)
            WHERE NOT e:Settlement AND NOT e:Transfer
              AND ($from IS NULL OR e.date >= $from)
              ${dated ? 'AND e.date IS NOT NULL' : ''}
            ${mine ? MY_SHARE : 'WITH e, g, e.amount AS raw'}
            WITH e, g, raw * coalesce(e.rateSnapshot, 1) AS amt`
        const params = { userId, from, groupId }
        try {
            const [monthlyRes, categoryRes, memberRes, dowRes, biggestRes] = await Promise.all([
                driver.executeQuery(
                    `${base(true)}
                    OPTIONAL MATCH (e)-[:IN_CATEGORY]->(c:Category)
                    OPTIONAL MATCH path = (c)-[:CHILD_OF*]->(root:Category)
                    WHERE NOT (root)-[:CHILD_OF]->(:Category)
                    WITH e, amt,
                        CASE WHEN c IS NULL THEN 'Uncategorized'
                             WHEN path IS NULL THEN c.name
                             ELSE apoc.text.join([node IN reverse(nodes(path)) | node.name], ' - ')
                        END AS categoryName
                    WITH substring(e.date, 0, 7) AS month, categoryName, sum(amt) AS amount
                    ORDER BY month DESC, amount DESC
                    WITH month, collect({name: categoryName, amount: amount}) AS breakdown, sum(amount) AS total
                    RETURN month, breakdown, total
                    ORDER BY month DESC
                    LIMIT 12`,
                    params
                ),
                driver.executeQuery(
                    `${base(false)}
                    OPTIONAL MATCH (e)-[:IN_CATEGORY]->(c:Category)
                    WITH c, sum(amt) AS total
                    OPTIONAL MATCH iconPath = (c)-[:CHILD_OF*0..]->(iconAncestor:Category)
                    WHERE iconAncestor.icon <> ""
                    WITH c, total, iconAncestor, length(iconPath) AS iconDist
                    ORDER BY iconDist
                    WITH c, total, collect(iconAncestor)[0] AS nearestIcon
                    OPTIONAL MATCH p = (c)-[:CHILD_OF*0..]->(root:Category)
                    WHERE NOT (root)-[:CHILD_OF]->(:Category)
                    RETURN 
                        CASE WHEN c IS NULL THEN 'Uncategorized' 
                             ELSE apoc.text.join([node IN reverse(nodes(p)) | node.name], ' - ')
                        END AS name,
                        coalesce(nearestIcon.icon, '❓') AS icon,
                        total
                    ORDER BY total DESC`,
                    params
                ),
                driver.executeQuery(
                    `${base(false)}
                    MATCH (u:User)-[:PAID]->(e)
                    WITH u.name AS name, sum(amt) AS total
                    RETURN name, total
                    ORDER BY total DESC`,
                    params
                ),
                driver.executeQuery(
                    `${base(true)}
                    WITH date(e.date).dayOfWeek AS dow,
                         ((date(e.date).day - 1) / 7) + 1 AS weekOfMonth,
                         amt
                    WITH dow, weekOfMonth, sum(amt) AS total, count(*) AS count
                    RETURN dow, weekOfMonth, total, count
                    ORDER BY weekOfMonth, dow`,
                    params
                ),
                driver.executeQuery(
                    `${base(false)}
                    RETURN e.id AS id, e.description AS description, e.date AS date, g.id AS groupId, amt
                    ORDER BY amt DESC
                    LIMIT 1`,
                    params
                ),
            ])
            const biggest = biggestRes.records[0]
            return {
                success: true,
                monthly: monthlyRes.records.map(r => ({
                    month: r.get('month'),
                    total: Number(r.get('total')),
                    breakdown: r.get('breakdown').map(b => ({ name: b.name, amount: Number(b.amount) }))
                })).reverse(),
                categories: categoryRes.records.map(r => ({
                    name: r.get('name'),
                    icon: r.get('icon'),
                    total: Number(r.get('total'))
                })),
                members: memberRes.records.map(r => ({
                    name: r.get('name'),
                    total: Number(r.get('total'))
                })),
                byDow: dowRes.records.map(r => ({
                    dow: r.get('dow').toNumber(),
                    weekOfMonth: r.get('weekOfMonth').toNumber(),
                    total: Number(r.get('total')),
                    count: r.get('count').toNumber()
                })),
                biggest: biggest ? {
                    id: biggest.get('id'),
                    description: biggest.get('description'),
                    date: biggest.get('date'),
                    groupId: biggest.get('groupId'),
                    amount: Number(biggest.get('amt'))
                } : null,
            }
        } catch (err) {
            throw new Error(`Failed to get insights: ${err.message}`)
        }
    },

    getExportData: async (userId) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH (u:User {id: $userId})-[:MEMBER_OF]->(g:Group)
                MATCH (e:Expense)-[:BALANCE_IN]->(g)
                OPTIONAL MATCH (e)<-[:PAID]-(payer:User)
                OPTIONAL MATCH (e)-[:IN_CATEGORY]->(cat:Category)
                OPTIONAL MATCH (e)-[:EXPRESSED_IN]->(cur:Currency)
                OPTIONAL MATCH (e)-[o:OWED_BY]->(:User {id: $userId})
                RETURN 
                    e.date AS date,
                    e.description AS description,
                    e.amount AS amount,
                    cur.iso AS currency,
                    cat.name AS category,
                    g.title AS group,
                    payer.name AS paidBy,
                    o.amount AS myShare,
                    e:Settlement AS isSettlement
                ORDER BY e.date DESC`,
                { userId }
            );
            return {
                success: true,
                data: records.map(r => ({
                    date: r.get('date'),
                    description: r.get('description'),
                    amount: Number(r.get('amount')),
                    currency: r.get('currency'),
                    category: r.get('category') || 'Uncategorized',
                    group: r.get('group'),
                    paidBy: r.get('paidBy'),
                    myShare: Number(r.get('myShare') || 0),
                    isSettlement: r.get('isSettlement') || false
                }))
            };
        } catch (err) {
            throw new Error(`Failed to get export data: ${err.message}`);
        }
    },
}

module.exports = {dashService};