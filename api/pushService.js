const webpush = require('web-push')
const driver = require('./neo4j')

webpush.setVapidDetails(
    process.env.VAPID_EMAIL,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
)

const pushService = {
    saveSubscription: async (userId, subscription) => {
        await driver.executeQuery(
            `MATCH (u:User {id: $userId})
             MERGE (u)-[:HAS_SUBSCRIPTION]->(s:PushSubscription {endpoint: $endpoint})
             SET s.keys = $keys`,
            { userId, endpoint: subscription.endpoint, keys: JSON.stringify(subscription.keys) }
        )
    },

    deleteSubscription: async (userId, endpoint) => {
        await driver.executeQuery(
            `MATCH (:User {id: $userId})-[:HAS_SUBSCRIPTION]->(s:PushSubscription {endpoint: $endpoint})
             DETACH DELETE s`,
            { userId, endpoint }
        )
    },

    notifyGroupMembers: async (groupId, excludeUserId, payload) => {
        try {
            const { records } = await driver.executeQuery(
                `MATCH (g:Group {id: $groupId})<-[:MEMBER_OF]-(u:User)
                 WHERE u.id <> $excludeUserId
                 MATCH (u)-[:HAS_SUBSCRIPTION]->(s:PushSubscription)
                 RETURN u.id AS userId, s.endpoint AS endpoint, s.keys AS keys`,
                { groupId, excludeUserId }
            )

            console.log(`[push] ${records.length} subscription(s) found for group ${groupId}`)

            const body = JSON.stringify(payload)
            const results = await Promise.allSettled(
                records.map(r => {
                    const sub = { endpoint: r.get('endpoint'), keys: JSON.parse(r.get('keys')) }
                    return webpush.sendNotification(sub, body, {
                        urgency: 'high',
                        TTL: 3600
                    })
                })
            )

            await Promise.all(results.map(async (result, i) => {
                if (result.status === 'rejected') {
                    const err = result.reason
                    if (err?.statusCode === 410 || err?.statusCode === 404 || err?.statusCode === 403) {
                        const endpoint = records[i].get('endpoint')
                        console.log(`[push] removing stale subscription: ${endpoint}`)
                        await driver.executeQuery(
                            `MATCH (s:PushSubscription {endpoint: $endpoint}) DETACH DELETE s`,
                            { endpoint }
                        )
                    } else {
                        console.error(`[push] failed for user ${records[i].get('userId')}:`, err?.message)
                    }
                }
            }))
        } catch (err) {
            console.error('[push] notifyGroupMembers error:', err.message)
        }
    }
}

module.exports = pushService
