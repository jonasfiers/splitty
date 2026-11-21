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
  receipts: [{ id: 'r1', filename: 'supermarket-bill.jpg', mimeType: 'image/jpeg', size: 182000, uploadedBy: 'Ann', url: '/trips/files/r1?sig=smoke' }],
}
const shares = [{ userId: 'u1', user: USER, amount: 12.5 }, { userId: 'u2', user: OTHER, amount: 12.5 }]
const trip = { id: 't1', title: 'Taiwan', startDate: day(-2), endDate: day(10), icon: 'country:TW', groupId: 'g1', group }
const items = [
  { id: 'i1', tripId: 't1', kind: 'activity', title: 'Taipei 101 observatory', start: `${day(1)}T10:00`, end: `${day(1)}T12:00`, attachments: [], expenses: [], tickets: [] },
  { id: 'i2', tripId: 't1', kind: 'transport', mode: 'flight', title: 'TPE → AMS', start: `${day(10)}T23:30`, attachments: [], expenses: [], tickets: [] },
]

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
  [/^\/dash\/(recent-spend|activity|friends)/, () => ({})],
  [/^\/expenses\/e1\/history$/, () => ({ history: [] })],
  [/^\/expenses\/e1$/, () => ({ expense, shares, members })],
  [/^\/currencies/, () => ({ currencies: [{ iso: 'EUR', name: 'Euro', symbol: '€' }, { iso: 'TWD', name: 'New Taiwan dollar', symbol: 'NT$' }] })],
  [/^\/categories\/trip-kinds/, () => ({ kinds: [] })],
  [/^\/categories/, () => ({ categories: [] })],
  [/^\/trips\/offline/, () => ({ trips: [] })],
  [/^\/trips$/, () => ({ trips: [trip], groups: [group] })],
  [/^\/trips\/t1$/, () => ({ trip, items, places: [], documents: [] })],
  [/^\/trips\/t1\/(documents|photos|albums|follow-links|routes)/, () => ({ documents: [], photos: [], albums: [], links: [], routes: [], places: [] })],
  [/^\/trips\/items\/i\d$/, m => ({ item: items.find(i => m.input.endsWith(i.id)) })],
  [/^\/activity/, () => ({ activities: [], groups: [group], trips: [trip] })],
  [/^\/friends/, () => ({ friends: [] })],
  [/^\/dash\/groups/, () => ({ groups: [] })],
  [/^\/auth\/passkey\/list/, () => ({ passkeys: [] })],
  [/^\/(dash\/)?profile/, () => ({ profile: { ...USER, emailVerified: true } })],
  [/^\/push/, () => ({})],
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
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://localhost:${port}`,
    setRoot: d => { dir = path.resolve(d) },
    unknown, posts, uploads,
    close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r) }),
  })))
}
