// The built app (web/dist or any copy of it) plus a made-up API under /api,
// on one port, as nginx serves production. `setRoot(dir)` swaps the build
// being served, to test what an open page does when a new version arrives.
import http from 'http'
import fs from 'fs'
import path from 'path'

const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.mjs': 'text/javascript' }

const today = new Date()
const day = n => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10)

export const USER = { id: 'u1', userId: 'u1', name: 'Smoke Tester', email: 'smoke@example.test' }
const OTHER = { id: 'u2', name: 'Robin', email: 'robin@example.test' }
const members = [{ ...USER, isAdmin: true }, OTHER]
const group = { id: 'g1', name: 'Flatmates', currencyIso: 'EUR', icon: 'home', balanceLent: 12.5, balanceOwed: 0, memberCount: 2, members }
const expense = {
  id: 'e1', groupId: 'g1', description: 'Groceries', amount: 25, currencyIso: 'EUR', date: day(-1), createdAt: `${day(-1)}T10:00:00Z`, paidBy: USER, paidByUserId: 'u1', categoryId: null, splitType: 'equal',
  receipts: [{ id: 'r1', filename: 'supermarket-bill.jpg', mimeType: 'image/jpeg', size: 182000, uploadedBy: 'Ann', url: '/trips/files/r1?sig=smoke', thumbUrl: '/trips/files/r1/thumb?sig=smoke' }],
}
const shares = [{ userId: 'u1', user: USER, amount: 12.5 }, { userId: 'u2', user: OTHER, amount: 12.5 }]
const DOCUMENT = { id: 'd1', filename: 'arrival-card.png', mimeType: 'image/png', size: 5282, shared: false, mine: true, ownerName: 'Smoke Tester', url: '/trips/files/d1?sig=smoke', thumbUrl: '/trips/files/d1/thumb?sig=smoke' }
const trip = { id: 't1', title: 'Taiwan', startDate: day(-2), endDate: day(10), icon: 'country:TW', groupId: 'g1', group }
const items = [
  { id: 'i1', tripId: 't1', kind: 'activity', title: 'Taipei 101 observatory', start: `${day(1)}T10:00`, end: `${day(1)}T12:00`, expenses: [], tickets: [],
    // One file with a stored preview, one without (the phone draws and sends it).
    attachments: [
      { id: 'a1', filename: 'observatory-ticket.png', mimeType: 'image/png', size: 5282, url: '/trips/files/a1?sig=smoke', thumbUrl: '/trips/files/a1/thumb?sig=smoke' },
      { id: 'a2', filename: 'booking.png', mimeType: 'image/png', size: 5282, url: '/trips/files/a2?sig=smoke', thumbUrl: null },
    ] },
  { id: 'i2', tripId: 't1', kind: 'transport', mode: 'flight', title: 'TPE → AMS', start: `${day(10)}T23:30`, attachments: [], expenses: [], tickets: [] },
]

// A follow link of a trip that has ended (api/followService.js): opens as
// the slideshow (TripStory). Two days with a photo each, one with a journey.
const FOLLOW_ENDED = {
  token: 'smokefinished0000000000', sharer: 'Smoke', today: day(0), started: true, ended: true, lookBack: true,
  summary: { days: 3, towns: 1, km: 120, photos: 2 },
  trip: { title: 'Taiwan', icon: 'country:TW', startDate: day(-4), endDate: day(-2) },
  items: [
    { id: 'f1', kind: 'transport', mode: 'train', title: 'Train to Hualien', start: `${day(-3)}T09:00`, end: `${day(-3)}T11:00`, fromPlaceId: 'p1', toPlaceId: 'p2' },
    { id: 'f2', kind: 'stay', title: 'Stay in Hualien', start: `${day(-3)}T15:00`, end: `${day(-2)}T11:00`, placeId: 'p2' },
  ],
  places: [
    { id: 'p1', name: 'Taipei Main Station', lat: 25.0478, lon: 121.5171 },
    { id: 'p2', name: 'Hualien', lat: 24.0, lon: 121.6, approximate: true },
  ],
  photos: ['ph1', 'ph2'].map((id, n) => ({ id, album: 'al1', at: `${day(n - 3)}T12:00`, ratio: 1.5, lat: 24.5 - n * 0.4, lon: 121.7, thumb: `/follow/smokefinished0000000000/photos/al1/${id}/thumbnail`, preview: `/follow/smokefinished0000000000/photos/al1/${id}/preview` })),
  kinds: [],
}

// The Content-Security-Policy production's nginx sends (CT101
// snippets/splitty-security-headers.conf), so the app is tested under it:
// something it refuses (a blob: image, say) fails here too. Keep in step.
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"

// GET path → body. Anything else answers {} (logged, so a test can show it).
const ROUTES = [
  [/^\/admin\/me$/, () => ({ isAdmin: false })],
  [/^\/groups$/, () => ({ groups: [group] })],
  [/^\/groups\/g1$/, () => ({ group, members })],
  [/^\/groups\/g1\/members$/, () => ({ members })],
  [/^\/groups\/g1\/expenses/, () => ({ expenses: [expense], hasMore: false, members, bilateralBalance: [] })],
  [/^\/shares\/expense\/e1$/, () => ({ shares })],
  [/^\/groups\/g1\/category-totals/, () => ({ totals: [] })],
  [/^\/dash\/insights/, () => ({ monthly: [], categories: [], members: [], byDow: [] })],
  [/^\/dash\/balance/, () => ({ currencies: [{ iso: 'TWD', lent: 20000, owed: 50000 }, { iso: 'EUR', lent: 1250, owed: 0 }] })],
  // Activity: an expense and a receipt added to it (kind 'receipt', 2026-11-21).
  [/^\/dash\/activity/, () => ({ success: true, activities: [
    { kind: 'receipt', action: 'UPLOADED_BY', userName: 'Ann', groupId: 'g1', timestamp: Date.now() - 60000, description: 'Groceries', expenseId: 'e1', filename: 'bill.jpg', isSettlement: false },
    { kind: 'expense', action: 'CREATED_BY', userName: 'Smoke Tester', groupId: 'g1', timestamp: Date.now() - 120000, description: 'Groceries', expenseId: 'e1', amount: 2500, currencyIso: 'EUR', isSettlement: false, isTransfer: false, categoryIcon: null, categoryColour: null, changes: [] },
  ] })],
  [/^\/dash\/(recent-spend|friends)/, () => ({})],
  [/^\/expenses\/e1\/history$/, () => ({ history: [] })],
  [/^\/expenses\/e1$/, () => ({ expense, shares, members })],
  [/^\/currencies/, () => ({ currencies: [{ iso: 'EUR', name: 'Euro', symbol: '€' }, { iso: 'TWD', name: 'New Taiwan dollar', symbol: 'NT$' }] })],
  [/^\/categories\/trip-kinds/, () => ({ kinds: [] })],
  [/^\/categories/, () => ({ categories: [] })],
  // The trip kept offline, with its files and their previews (utils/offlineTrips.js, offlineDocs.js).
  [/^\/trips\/offline/, () => ({ trips: [{ trip, places: [], items, documents: [DOCUMENT] }] })],
  [/^\/trips$/, () => ({ trips: [trip], groups: [group] })],
  // Place search (api/geocodeService.js): what a search as you type answers.
  [/^\/trips\/geocode$/, () => ({ success: true, results: [
    { name: 'Taipei Main Station', address: 'Zhongxiao West Road 49, Taipei, Taiwan', area: 'Taipei, Taiwan', type: 'station', label: 'Station', lat: 25.0478, lon: 121.5171 },
    { name: 'Sun Moon Lake', address: 'Yuchi Township, Taiwan', area: 'Yuchi Township, Taiwan', type: 'water', label: 'Lake', lat: 23.8655, lon: 120.9155 },
  ] })],
  [/^\/trips\/t1$/, () => ({ trip, items, places: [], documents: [] })],
  [/^\/trips\/t1\/documents$/, () => ({ documents: [DOCUMENT] })],
  [/^\/trips\/t1\/(documents|photos|albums|follow-links|routes)/, () => ({ documents: [], photos: [], albums: [], links: [], routes: [], places: [] })],
  [/^\/trips\/items\/i\d$/, m => ({ item: items.find(i => m.input.endsWith(i.id)) })],
  [/^\/activity/, () => ({ activities: [], groups: [group], trips: [trip] })],
  [/^\/friends/, () => ({ friends: [] })],
  [/^\/dash\/groups/, () => ({ groups: [] })],
  [/^\/auth\/passkey\/list/, () => ({ passkeys: [] })],
  [/^\/(dash\/)?profile/, () => ({ profile: { ...USER, emailVerified: true } })],
  [/^\/push/, () => ({})],
  [/^\/follow\/smokefinished0000000000$/, () => FOLLOW_ENDED],
]

export function startServer({ root, port = 5190 }) {
  let dir = path.resolve(root)
  const unknown = new Set()
  const posts = []
  const uploads = [] // multipart bodies sent, as { path, body: Buffer }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const p = decodeURIComponent(url.pathname)
    if (p.startsWith('/api/')) {
      const api = p.slice(4)
      const chunks = []
      req.on('data', c => chunks.push(c)).on('end', () => {
        const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
        // A signed file link (thumbnails): any image will do.
        if (req.method === 'GET' && (api.startsWith('/trips/files/') || /^\/follow\/[^/]+\/photos\//.test(api))) {
          res.writeHead(200, { 'Content-Type': 'image/png' })
          return res.end(fs.readFileSync(new URL('./ticket.png', import.meta.url)))
        }
        if (req.method !== 'GET') {
          posts.push(`${req.method} ${api}`)
          if (/multipart/.test(req.headers['content-type'] || '')) uploads.push({ path: api, body: Buffer.concat(chunks) })
          return json({ success: true })
        }
        for (const [re, fn] of ROUTES) { const m = api.match(re); if (m) return json(fn(m)) }
        unknown.add(api)
        json({})
      })
      return
    }
    let file = path.join(dir, p)
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html')
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Security-Policy': CSP })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://localhost:${port}`,
    setRoot: d => { dir = path.resolve(d) },
    unknown, posts, uploads,
    close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r) }),
  })))
}
