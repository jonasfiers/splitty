// Follow links' rules (followRules.js, 2026-11-25): which photos a link shows
// (all, starred, none; up to today; in time order) and the summary a finished
// trip opens with. Pure: no database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { photoMode, pickPhotos, summarize } = require('../followRules');

test('photo modes: older links (true/false) read as all/none; anything odd as none', () => {
    assert.equal(photoMode(true), 'all');
    assert.equal(photoMode(false), 'none');
    assert.equal(photoMode('favourites'), 'favourites');
    assert.equal(photoMode(undefined), 'none');
    assert.equal(photoMode('everything'), 'none');
});

test('photos: all or only starred, never after today, in time order, without the star itself', () => {
    const photos = [
        { id: 'c', at: '2026-11-12T09:00', favourite: true },
        { id: 'a', at: '2026-11-10T18:00', favourite: false },
        { id: 'b', at: '2026-11-11T08:00', favourite: true },
        { id: 'later', at: '2026-11-20T08:00', favourite: true },
        { id: 'undated', at: null, favourite: true },
    ];
    assert.deepEqual(pickPhotos(photos, 'all', '2026-11-12').map(p => p.id), ['a', 'b', 'c']);
    const starred = pickPhotos(photos, 'favourites', '2026-11-12');
    assert.deepEqual(starred.map(p => p.id), ['b', 'c']);
    assert.ok(starred.every(p => !('favourite' in p)));
    assert.deepEqual(pickPhotos(photos, 'none', '2026-11-30'), []);
});

test('summary: days, towns slept in, journeys in km, photos', () => {
    const placeById = new Map([
        ['tpe', { lat: 25.0478, lon: 121.5171 }], // Taipei Main Station
        ['hua', { lat: 23.9930, lon: 121.6011 }], // Hualien Station, ~118 km
        ['nowhere', { lat: null, lon: null }],
    ]);
    const items = [
        { kind: 'transport', fromPlaceId: 'tpe', toPlaceId: 'hua' },
        { kind: 'transport', fromPlaceId: 'hua', toPlaceId: 'nowhere' }, // no coordinates: not counted
        { kind: 'activity', placeId: 'hua' },
    ];
    const s = summarize({ startDate: '2026-11-10', endDate: '2026-11-25', today: '2026-11-30', items, placeById, towns: ['Taipei', 'Hualien', 'Taipei'], photoCount: 12 });
    assert.deepEqual(s, { days: 16, towns: 2, km: 120, photos: 12 });
    // While on: the days so far.
    assert.equal(summarize({ startDate: '2026-11-10', endDate: '2026-11-25', today: '2026-11-12', items: [], placeById, towns: [], photoCount: 0 }).days, 3);
});

test('cover: the first album cover chosen in Immich, up to today, even with favourites only; none without photos', () => {
    const { pickCover } = require('../followRules');
    const albums = [
        { cover: null, photos: [{ id: 'x', at: '2026-11-10T10:00' }] }, // no cover set
        { cover: 'late', photos: [{ id: 'late', at: '2026-11-30T10:00' }] }, // after today
        { cover: 'b', photos: [{ id: 'a', at: '2026-11-10T10:00' }, { id: 'b', at: '2026-11-11T10:00', favourite: false }] },
    ];
    const cover = pickCover(albums, 'favourites', '2026-11-20');
    assert.equal(cover.id, 'b');
    assert.ok(!('favourite' in cover));
    assert.equal(pickCover(albums, 'none', '2026-11-20'), null);
    assert.equal(pickCover([albums[0]], 'all', '2026-11-20'), null, 'no cover: the page uses the first photo');
});
