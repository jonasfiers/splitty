// Splitty's service worker: push notifications, and Splitty working without
// a connection (so offline documents can be opened at a border or a gate).
//
//   pages          network first (4 s), else the saved index.html: online you
//                  always get the current version, offline the app still opens
//   app files      the build's files (names change with every build), saved
//                  when this worker installs and served from there
//   /pdfjs/        pdf.js's fonts and character maps: saved when first used
//   /offline-docs/ documents kept offline (utils/offlineDocs.js): only ever
//                  from the phone's storage
//   everything else (the API, the map, tiles) goes to the network untouched.
//
// The list of app files is the build's (vite-plugin-pwa, injectManifest).

const MANIFEST = self.__WB_MANIFEST
const version = MANIFEST.map(e => `${e.url}@${e.revision ?? ''}`).join('|')
const hash = [...version].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)
const APP_CACHE = `splitty-app-${(hash >>> 0).toString(36)}`
const PDFJS_CACHE = 'splitty-pdfjs'
const OFFLINE_DOCS = 'splitty-offline-docs'   // also utils/offlineDocs.js
// Unique: the plugin lists the manifest's icons a second time, and one
// duplicate makes saving the whole list fail.
const APP_URLS = [...new Set(MANIFEST.map(e => new URL(e.url, self.location).pathname))]
const INDEX = '/index.html'
const NAVIGATION_TIMEOUT_MS = 4000

// Three files at a time and at low priority, so the app's own requests (the
// trips, the groups) are not stuck behind ~2 MB of program files on a slow
// connection. All or nothing, as cache.addAll: one missing file and this
// version does not install (the previous one keeps working).
self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(APP_CACHE)
        const queue = [...APP_URLS]
        const worker = async () => {
            for (let url; (url = queue.shift()); ) {
                // 'reload': past the browser's HTTP cache, so index.html is current.
                const res = await fetch(new Request(url, { cache: 'reload', priority: 'low' }))
                if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
                await cache.put(url, res)
            }
        }
        try {
            await Promise.all([worker(), worker(), worker()])
        } catch (err) {
            await caches.delete(APP_CACHE)
            throw err
        }
        await self.skipWaiting()
    })())
})

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        // Keep the previous build too: a page still running it may load one
        // of its lazy parts after this worker took over.
        const apps = (await caches.keys()).filter(k => k.startsWith('splitty-app-') && k !== APP_CACHE)
        const keep = await previousApp(apps)
        await Promise.all(apps.filter(k => k !== keep).map(k => caches.delete(k)))
        await clients.claim()
    })())
})

// The newest other build's cache, by the date its index.html was saved.
async function previousApp(keys) {
    let best = null, bestDate = 0
    for (const key of keys) {
        const res = await (await caches.open(key)).match(INDEX)
        const date = Date.parse(res?.headers.get('date') || '') || 0
        if (date > bestDate) { best = key; bestDate = date }
    }
    return best
}

self.addEventListener('fetch', event => {
    const { request } = event
    if (request.method !== 'GET') return
    const url = new URL(request.url)
    if (url.origin !== self.location.origin) return

    if (url.pathname.startsWith('/offline-docs/')) {
        event.respondWith((async () => (await (await caches.open(OFFLINE_DOCS)).match(url.pathname))
            ?? new Response('Not kept offline on this device', { status: 404, headers: { 'Content-Type': 'text/plain' } }))())
        return
    }
    if (request.mode === 'navigate') {
        if (/^\/(api|maps|pdfjs|offline-docs)\//.test(url.pathname)) return
        event.respondWith(navigation(request))
        return
    }
    if (url.pathname.startsWith('/pdfjs/')) {
        event.respondWith(cacheFirst(PDFJS_CACHE, request))
        return
    }
    if (APP_URLS.includes(url.pathname)) {
        event.respondWith((async () => (await caches.match(url.pathname)) ?? fetch(request))())
    }
})

async function navigation(request) {
    const network = fetch(request)
    const timeout = new Promise(resolve => setTimeout(resolve, NAVIGATION_TIMEOUT_MS, null))
    try {
        const res = await Promise.race([network, timeout])
        if (res) return res
    } catch { /* offline: the saved app below */ }
    const saved = await caches.match(INDEX)
    if (saved) {
        network.catch(() => {})   // a late answer is not needed any more
        return saved
    }
    return network                // nothing saved yet: wait for the network
}

async function cacheFirst(name, request) {
    const cache = await caches.open(name)
    const hit = await cache.match(request)
    if (hit) return hit
    const res = await fetch(request)
    if (res.ok) cache.put(request, res.clone())
    return res
}

self.addEventListener('push', event => {
    const data = event.data?.json()
    if (!data) return
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.icon ? `${data.icon} ${data.body}` : data.body,
            // iOS always shows the app icon; Android needs both: `icon` is
            // the large colour picture, `badge` the status-bar icon, of which
            // Android only uses the shape (a white silhouette on transparency).
            icon: '/cat-icon-192.png',
            badge: '/notification-badge.png',
            data: { url: data.url }
        })
    )
})

self.addEventListener('notificationclick', event => {
    event.notification.close()
    const target = self.location.origin + (event.notification.data?.url || '/')
    event.waitUntil(clients.openWindow(target))
})