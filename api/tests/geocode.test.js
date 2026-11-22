// Place search (2026-11-22): Photon answers as the user types, shaped into a
// name, a kind and a town; duplicates of one station or street are dropped;
// when Photon fails, a search sent while typing fails too (Nominatim's policy
// forbids autocomplete) and an explicit one falls back to Nominatim. Pure: no
// database, fetch is replaced.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { search, fromPhoton, dedupe } = require('../geocodeService');

const feature = (props, lon, lat) => ({ geometry: { coordinates: [lon, lat] }, properties: props });
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

test('a Photon station: name, kind, town without local script, full address', () => {
    const r = fromPhoton(feature({
        osm_key: 'railway', osm_value: 'station', name: 'Ershui', street: '田仔一巷',
        postcode: '53042', city: 'Ershui Township', state: '台灣省', country: 'Taiwan',
    }, 120.6178, 23.8128));
    assert.deepEqual(r, {
        name: 'Ershui', address: '53042 Ershui Township, Taiwan', area: 'Ershui Township, Taiwan',
        type: 'station', label: 'Station', lat: 23.8128, lon: 120.6178,
    });
});

test('an address without a name is named by its street', () => {
    const r = fromPhoton(feature({ osm_key: 'building', osm_value: 'yes', type: 'house', street: 'Rue de la Loi', housenumber: '16', postcode: '1000', city: 'Brussels', country: 'Belgium' }, 4.37, 50.84));
    assert.equal(r.name, 'Rue de la Loi 16');
    assert.equal(r.type, 'address');
    assert.equal(r.address, '1000 Brussels, Belgium');
});

test('one station mapped three times, a path in pieces: shown once each', () => {
    const at = (name, type, lat, lon, area = 'Taipei, Taiwan') => ({ name, type, label: '', area, address: '', lat, lon });
    const kept = dedupe([
        at('Taipei Main Station', 'station', 25.0478, 121.5171),
        at('Taipei main station', 'bus', 25.0465, 121.5150), // a stop of the same name, 250 m on
        at('Taipei Main Station', 'station', 25.0490, 121.5230), // a platform 600 m on
        at('Sun Moon Lake Bikeway', 'street', 23.86, 120.91, 'Yuchi, Taiwan'),
        at('Sun Moon Lake Bikeway', 'street', 23.84, 120.94, 'Yuchi, Taiwan'),
        at('Taipei Main Station', 'station', 24.9, 121.0), // far away: another place
    ]);
    assert.deepEqual(kept.map(k => `${k.type}@${k.lat}`), ['station@25.0478', 'street@23.86', 'station@24.9']);
});

test('near, transit and the Photon request', async () => {
    let asked;
    global.fetch = async url => {
        asked = new URL(url);
        return { ok: true, json: async () => ({ features: [
            feature({ osm_key: 'tourism', osm_value: 'hotel', name: 'Lake Hotel', city: 'Yuchi', country: 'Taiwan' }, 120.91, 23.86),
            feature({ osm_key: 'highway', osm_value: 'bus_stop', name: 'Lake Pier', city: 'Yuchi', country: 'Taiwan' }, 120.92, 23.87),
        ] }) };
    };
    const results = await search('  lake   test one ', { near: { lat: 24, lon: 120.9 }, transit: true, typing: true });
    assert.equal(asked.origin + asked.pathname, 'https://photon.komoot.io/api/');
    assert.equal(asked.searchParams.get('q'), 'lake test one');
    assert.equal(asked.searchParams.get('lat'), '24');
    assert.deepEqual(results.map(r => r.name), ['Lake Pier', 'Lake Hotel']);
});

test('Photon down: typing fails, an explicit search uses Nominatim', async () => {
    const hosts = [];
    global.fetch = async url => {
        const u = new URL(url);
        hosts.push(u.hostname);
        if (u.hostname === 'photon.komoot.io') return { ok: false, status: 502 };
        return { ok: true, json: async () => [{ name: 'Fallback Place', display_name: 'Fallback Place, Somewhere', lat: '1.5', lon: '2.5' }] };
    };
    await assert.rejects(search('fallback test two', { typing: true }));
    assert.deepEqual(hosts, ['photon.komoot.io']);
    const results = await search('fallback test two');
    assert.ok(hosts.includes('nominatim.openstreetmap.org'));
    assert.equal(results[0].name, 'Fallback Place');
    assert.equal(results[0].lat, 1.5);
});
