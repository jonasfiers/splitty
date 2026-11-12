// The IANA time zone at a point on the map (coarse near borders), or null
// without coordinates. Shared by the route finder and the trip's places: the
// app reads "now" in the zone where the schedule puts the traveller.
const tzlookup = require('@photostructure/tz-lookup');

const zoneAt = (lat, lon) => {
    if (lat == null || lon == null) return null;
    try {
        return tzlookup(lat, lon);
    } catch {
        return null;
    }
};

module.exports = { zoneAt };
