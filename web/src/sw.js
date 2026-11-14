import { colorFor, getInitials } from './utils/avatar.js'
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
// What each file is, per build: a name with a content hash has no revision
// (a new content gets a new name); others (index.html, icons) do. Saved in
// every app cache, so the next build can tell which of its files it has
// already (install, below).
const REVISIONS_KEY = '/__splitty-revisions'
const REVISIONS = Object.fromEntries(MANIFEST.map(e => [new URL(e.url, self.location).pathname, e.revision ?? null]))
const NAVIGATION_TIMEOUT_MS = 4000

// Only what changed is downloaded: a file the previous build saved as it is
// now (the same hashed name, or the same revision) is copied from its cache.
// Otherwise every deploy fetched all of the app (5 MB: the map, pdf.js...)
// again, and pages loaded slowly while that ran. What is left goes three
// files at a time and at low priority, so the app's own requests (the trips,
// the groups) are not stuck behind it. All or nothing, as cache.addAll: one
// missing file and this version does not install (the previous one keeps
// working).
async function reusable() {
    const found = new Map() // path -> saved response
    // This build's own cache counts too: it already exists, under the same
    // name, when only this worker changed and the app files did not.
    const older = (await caches.keys()).filter(k => k.startsWith('splitty-app-'))
    for (const key of older) {
        const old = await caches.open(key)
        const saved = await old.match(REVISIONS_KEY)
        const revisions = saved ? await saved.json().catch(() => ({})) : {}
        for (const path of APP_URLS) {
            if (found.has(path)) continue
            const rev = REVISIONS[path]
            // A hashed name is the same file wherever it is; others only with the same revision.
            if (rev !== null && revisions[path] !== rev) continue
            const hit = await old.match(path)
            if (hit) found.set(path, hit)
        }
    }
    return found
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(APP_CACHE)
        const have = await reusable().catch(() => new Map())
        for (const [path, res] of have) await cache.put(path, res)
        const queue = APP_URLS.filter(path => !have.has(path))
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
            await cache.put(REVISIONS_KEY, new Response(JSON.stringify(REVISIONS), { headers: { 'Content-Type': 'application/json' } }))
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
        event.respondWith((async () => (await fromApp(url.pathname)) ?? fetch(request))())
    }
})

async function navigation(request) {
    const network = fetch(request)
    const timeout = new Promise(resolve => setTimeout(resolve, NAVIGATION_TIMEOUT_MS, null))
    try {
        const res = await Promise.race([network, timeout])
        if (res) return res
    } catch { /* offline: the saved app below */ }
    const saved = await fromApp(INDEX)
    if (saved) {
        network.catch(() => {})   // a late answer is not needed any more
        return saved
    }
    return network                // nothing saved yet: wait for the network
}

// A saved app file: this build's copy first. A bare caches.match() searches the
// caches oldest first, so the kept previous build would win for every file whose
// name does not change between builds (manifest.webmanifest, icons, index.html):
// the installed app kept getting the old manifest. The previous build's cache is
// only a fallback, for a page still running it that loads one of its lazy parts.
async function fromApp(path) {
    return (await (await caches.open(APP_CACHE)).match(path)) ?? caches.match(path)
}

async function cacheFirst(name, request) {
    const cache = await caches.open(name)
    const hit = await cache.match(request)
    if (hit) return hit
    const res = await fetch(request)
    if (res.ok) cache.put(request, res.clone())
    return res
}

// The notification's picture: the avatar of who did it (`avatar` from the
// API), drawn like the app's own avatars. Android already shows the app icon
// on the other side, and an empty picture slot gets a grey letter from Chrome
// (2026-11-13), so the slot says who instead. The cat when it can't be drawn.
const ICON_SIZE = 192
async function avatarIcon(avatar) {
    if (!avatar?.name || typeof OffscreenCanvas === 'undefined') return '/cat-icon-192.png'
    try {
        const { bg, fg } = colorFor(avatar.color ?? avatar.name)
        const canvas = new OffscreenCanvas(ICON_SIZE, ICON_SIZE)
        const ctx = canvas.getContext('2d')
        const mid = ICON_SIZE / 2
        ctx.fillStyle = bg
        ctx.beginPath()
        ctx.arc(mid, mid, mid, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = fg
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = `700 ${ICON_SIZE * 0.38}px sans-serif`
        ctx.fillText(getInitials(avatar.name), mid, mid + ICON_SIZE * 0.03)
        const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
        let binary = ''
        for (const b of bytes) binary += String.fromCharCode(b)
        return `data:image/png;base64,${btoa(binary)}`
    } catch {
        return '/cat-icon-192.png'
    }
}

self.addEventListener('push', event => {
    const data = event.data?.json()
    if (!data) return
    event.waitUntil((async () => {
        await self.registration.showNotification(data.title, {
            body: data.body,
            icon: await avatarIcon(data.avatar),
            // The status-bar icon, of which Android only uses the shape (a
            // white silhouette on transparency). iOS always shows the app icon.
            badge: '/notification-badge.png',
            data: { url: data.url }
        })
    })())
})

self.addEventListener('notificationclick', event => {
    event.notification.close()
    const target = self.location.origin + (event.notification.data?.url || '/')
    event.waitUntil(clients.openWindow(target))
})