// English names for public-transport stops in route finder results
// (2026-11-18). Some feeds, Taiwan's among them, name every stop only in the
// local script ("臺北 → 花蓮"), and Transitous has no translation to give.
// OpenStreetMap usually knows the station's English name
// (geocodeService.englishStopName), but Nominatim allows one request a
// second, too slow to wait for while a search answers.
//
// So names are remembered for good, per stop:
//   (:StopName {key, original, english, checkedOn})
// keyed by the feed's stop id (stable, e.g. "tw-taiwan-tdx_TRA_1000"), or
// name and position without one. `english` null means "looked up, none
// found", tried again after RECHECK_DAYS. A search uses what is known at once
// and queues the rest; the route page asks again (namesFor) and fills them in.

const driver = require('./neo4j');
const { englishStopName, isLatin } = require('./geocodeService');

const RECHECK_DAYS = 30;
const MAX_QUEUE = 200;

let indexed = null;
const ensureIndex = () => (indexed ??= driver.executeQuery(
    'CREATE INDEX stop_name_key IF NOT EXISTS FOR (s:StopName) ON (s.key)'
).catch(err => { indexed = null; console.error('[stopNames] index:', err.message); }));

const keyOf = stop => stop.stopId || `${stop.name}@${Number(stop.lat).toFixed(4)},${Number(stop.lon).toFixed(4)}`;
const needsName = stop => stop?.name && !isLatin(stop.name) && stop.lat != null && stop.lon != null;

// key -> { english, fresh } for those in the database.
async function known(keys) {
    if (!keys.length) return new Map();
    await ensureIndex();
    const { records } = await driver.executeQuery(
        `MATCH (s:StopName) WHERE s.key IN $keys
         RETURN s.key AS key, s.english AS english,
                s.checkedOn > datetime() - duration({days: $days}) AS fresh`,
        { keys, days: RECHECK_DAYS }
    );
    return new Map(records.map(r => [r.get('key'), { english: r.get('english'), fresh: r.get('fresh') }]));
}

// original -> English for names learned at any stop (headsigns, lines).
async function knownByOriginal(originals) {
    if (!originals.length) return new Map();
    const { records } = await driver.executeQuery(
        `MATCH (s:StopName) WHERE s.original IN $originals AND s.english IS NOT NULL
         RETURN s.original AS original, head(collect(s.english)) AS english`,
        { originals: originals.slice(0, 200) }
    );
    return new Map(records.map(r => [r.get('original'), r.get('english')]));
}

// ── Background lookups, one at a time (Nominatim's own queue spaces them) ──
const queue = new Map(); // key -> stop
let working = false;

async function work() {
    if (working) return;
    working = true;
    try {
        while (queue.size) {
            const [key, stop] = queue.entries().next().value;
            queue.delete(key);
            let english = null;
            try {
                english = await englishStopName(stop.name, stop.lat, stop.lon);
            } catch (err) {
                if (err.busy) { queue.set(key, stop); await new Promise(r => setTimeout(r, 2000)); continue; }
                console.error(`[stopNames] ${stop.name}: ${err.message}`);
                continue; // not remembered: tried again next time
            }
            await driver.executeQuery(
                `MERGE (s:StopName {key: $key})
                 SET s.original = $original, s.english = $english, s.checkedOn = datetime()`,
                { key, original: stop.name, english }
            ).catch(err => console.error('[stopNames] save:', err.message));
        }
    } finally {
        working = false;
    }
}

function learn(stops) {
    for (const s of stops) {
        if (queue.size >= MAX_QUEUE) break;
        if (!queue.has(keyOf(s))) queue.set(keyOf(s), { name: s.name, lat: s.lat, lon: s.lon });
    }
    work();
}

// Translates a route search result in place: stop names, headsigns and line
// names made of stop names ("彰化-花蓮"). Each stop gets `nameKey` and, when
// translated, `originalName`. Returns how many names are still being looked up.
async function translateResult(result) {
    const stops = [];
    for (const it of result.itineraries || []) for (const leg of it.legs || []) stops.push(leg.from, leg.to);
    const wanted = stops.filter(needsName);
    for (const s of wanted) s.nameKey = keyOf(s);
    const names = await known([...new Set(wanted.map(s => s.nameKey))]);

    const byOriginal = new Map(); // "花蓮" -> "Hualien", for headsigns and lines
    const unknown = new Map();
    for (const s of wanted) {
        const hit = names.get(s.nameKey);
        if (hit?.english) {
            byOriginal.set(s.name, hit.english);
            s.originalName = s.name;
            s.name = hit.english;
        }
        if (!hit || !hit.fresh) unknown.set(s.nameKey, s);
    }
    // Headsigns and the stations in line names ("彰化-花蓮") that are not
    // stops of this search: any stop of that name learned before.
    const extra = new Set();
    for (const it of result.itineraries || []) {
        for (const leg of it.legs || []) {
            for (const t of [leg.headsign, ...(leg.line && /[-–~]/.test(leg.line) ? leg.line.split(/\s*[-–~]\s*/) : [])]) {
                if (t && !isLatin(t) && !byOriginal.has(t)) extra.add(t);
            }
        }
    }
    for (const [original, english] of await knownByOriginal([...extra])) byOriginal.set(original, english);
    for (const it of result.itineraries || []) {
        for (const leg of it.legs || []) {
            applyToLeg(leg, byOriginal);
        }
    }
    const pending = [...unknown.values()].map(s => ({ name: s.originalName || s.name, lat: s.lat, lon: s.lon, stopId: s.nameKey }));
    learn(pending.map(p => ({ ...p, stopId: p.stopId })));
    return pending.length;
}

// Headsign, line and title from the names known so far.
function applyToLeg(leg, byOriginal) {
    const tr = text => byOriginal.get(text) ?? text;
    if (leg.headsign && byOriginal.has(leg.headsign)) { leg.headsignOriginal ??= leg.headsign; leg.headsign = tr(leg.headsign); }
    if (leg.line && /[-–~]/.test(leg.line)) {
        const parts = leg.line.split(/\s*([-–~])\s*/);
        const translated = parts.map(p => (/^[-–~]$/.test(p) ? '–' : tr(p)));
        if (translated.join('') !== parts.join('') && translated.every((p, i) => i % 2 || isLatin(p))) {
            leg.lineOriginal ??= leg.line;
            leg.line = translated.join(' ');
        }
    }
    leg.title = `${leg.from.name} → ${leg.to.name}`;
}

// For the route page's follow-up: [{ key, original, english }] for the keys
// whose English name is known by now.
async function namesFor(keys) {
    const list = [...new Set(keys)].slice(0, 200);
    if (!list.length) return [];
    await ensureIndex();
    const { records } = await driver.executeQuery(
        'MATCH (s:StopName) WHERE s.key IN $keys AND s.english IS NOT NULL RETURN s.key AS key, s.original AS original, s.english AS english',
        { keys: list }
    );
    return records.map(r => ({ key: r.get('key'), original: r.get('original'), english: r.get('english') }));
}

module.exports = { translateResult, namesFor, keyOf };
