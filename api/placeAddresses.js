// Addresses for places the route finder made from timetable stops, which
// come with a name and coordinates only (2026-11-18). Looked up after the
// connection is added, in the background, one at a time (Nominatim: one
// request a second), and only filled in where the place still has none, so
// an address typed in meanwhile wins.
const driver = require('./neo4j');
const { addressAt } = require('./geocodeService');

const queue = new Map(); // placeId -> { lat, lon }
let working = false;

async function work() {
    if (working) return;
    working = true;
    try {
        while (queue.size) {
            const [id, p] = queue.entries().next().value;
            queue.delete(id);
            try {
                const address = await addressAt(p.lat, p.lon);
                if (!address) continue;
                await driver.executeQuery(
                    `MATCH (p:Place {id: $id}) WHERE coalesce(p.address, '') = '' SET p.address = $address`,
                    { id, address }
                );
            } catch (err) {
                if (err.busy) { queue.set(id, p); await new Promise(r => setTimeout(r, 2000)); continue; }
                console.error(`[placeAddresses] ${id}: ${err.message}`);
            }
        }
    } finally {
        working = false;
    }
}

// Queues every place of the trip that has coordinates but no address.
async function fillMissing(tripId) {
    const { records } = await driver.executeQuery(
        `MATCH (p:Place)-[:PLACE_OF]->(:Trip {id: $tripId})
         WHERE coalesce(p.address, '') = '' AND p.lat IS NOT NULL AND p.lon IS NOT NULL
         RETURN p.id AS id, p.lat AS lat, p.lon AS lon LIMIT 30`,
        { tripId }
    );
    for (const r of records) queue.set(r.get('id'), { lat: r.get('lat'), lon: r.get('lon') });
    work();
}

module.exports = { fillMissing };
