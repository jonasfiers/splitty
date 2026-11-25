#!/usr/bin/env node
// Smoke test of a built Splitty web app (2026-11-20): opens it in headless
// Chromium against a made-up API (server.mjs) and checks that
//   1. every page opens: no uncaught error, no error logged, something drawn;
//   2. an open page reloads onto a new build only on returning to the
//      foreground, and not while a form is open (utils/appUpdate.js);
//   3. a file shared from another app ends up on the item (share target).
// No npm packages: Node 22+ and Chromium (or $CHROME).
//
//   npm run build -w web && node web/smoke/smoke.mjs [dist-dir]
//
// Exit 0 when all pass. deploy.sh runs it before publishing the web build.
import { cpSync, mkdtempSync, rmSync, appendFileSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { launch, sleep } from './cdp.mjs'
import { startServer, USER } from './server.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(process.argv[2] || path.join(HERE, '../dist'))

// Every page, with ids the made-up API knows.
const PAGES = [
  '/groups', '/groups/g1', '/groups/g1/expenses/e1', '/groups/g1/expenses/new', '/groups/g1/expenses/e1/edit',
  '/trips', '/trips/t1', '/trips/t1/items/new', '/trips/t1/items/i1', '/trips/t1/items/i1/edit',
  '/trips/t1/route', '/trips/t1/documents', '/activity', '/insights', '/friends', '/profile', '/share',
  '/privacy', '/offline-documents',
]
const LOGGED_OUT = ['/login', '/register', '/forgot-password']

// Errors that are the made-up API's doing, not the app's.
const IGNORE = [/Failed to load resource/, /favicon/]

let failed = 0
const pass = msg => console.log(`  ok    ${msg}`)
const fail = msg => { failed++; console.log(`  FAIL  ${msg}`) }
const expect = (cond, msg) => (cond ? pass(msg) : fail(msg))

const work = mkdtempSync(path.join(tmpdir(), 'splitty-smoke-dist-'))
const server = await startServer({ root: DIST })
const browser = await launch()
const { evaluate, navigate, send } = browser

const errors = []
browser.on(m => {
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] || m.params.exceptionDetails.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300))
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text.slice(0, 300))
})
// SMOKE_SHOTS=<dir>: screenshots of chosen moments, to look at a layout.
const screenshot = async name => {
  if (!process.env.SMOKE_SHOTS) return
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(path.join(process.env.SMOKE_SHOTS, `${name}.png`), Buffer.from(data, 'base64'))
}
const takeErrors = () => errors.splice(0).filter(e => !IGNORE.some(re => re.test(e)))

// Waits until the page has drawn more than a loading spinner.
const settle = async () => {
  for (let i = 0; i < 40; i++) {
    await sleep(150)
    const ready = await evaluate(`document.readyState === 'complete' && !!document.querySelector('#root')?.children.length && !document.querySelector('.loading, [aria-busy="true"]')`).catch(() => false)
    if (ready) break
  }
  await sleep(300)
}
const drawn = () => evaluate(`(document.querySelector('#root')?.innerText || '').trim().length`)

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  const token = `x.${Buffer.from(JSON.stringify({ ...USER, exp: 4102444800 })).toString('base64url')}.y`

  console.log('Pages, logged out')
  for (const page of LOGGED_OUT) {
    await navigate(server.url + page); await settle()
    const errs = takeErrors()
    expect(errs.length === 0 && (await drawn()) > 20, `${page}${errs.length ? ` — ${errs.join(' | ')}` : ''}`)
  }

  console.log('Pages, logged in')
  await evaluate(`localStorage.setItem('token', ${JSON.stringify(token)})`)
  for (const page of PAGES) {
    await navigate(server.url + page); await settle()
    const errs = takeErrors()
    const text = await drawn()
    const path = await evaluate('location.pathname')
    expect(errs.length === 0 && text > 20 && path === page, `${page}${path !== page ? ` (ended on ${path})` : ''}${text <= 20 ? ' — blank page' : ''}${errs.length ? ` — ${errs.join(' | ')}` : ''}`)
  }

  console.log('Receipts on an expense')
  await navigate(`${server.url}/groups/g1/expenses/e1`); await settle()
  await sleep(500)
  const thumb = await evaluate(`(() => { const i = document.querySelector('.receipts .file-tile img'); return i ? { alt: i.alt, w: i.naturalWidth, thumb: i.src.includes('/thumb?') } : null })()`)
  expect(thumb?.alt === 'supermarket-bill.jpg' && thumb.w > 0 && thumb.thumb, `the expense shows its receipt's preview as a thumbnail (${JSON.stringify(thumb)})`)
  expect((await evaluate(`document.querySelector('.receipts')?.textContent || ''`)).includes('Add a photo or PDF'), 'and offers another')
  // A big phone photo carrying a (fake) location in its EXIF block.
  const sent = await evaluate(`(async () => {
    const c = Object.assign(document.createElement('canvas'), { width: 3200, height: 2400 })
    const g = c.getContext('2d')
    for (let i = 0; i < 4000; i++) { g.fillStyle = 'hsl(' + (i * 37 % 360) + ',60%,' + (30 + i % 50) + '%)'; g.fillRect((i * 97) % 3200, (i * 53) % 2400, 60, 40) }
    const jpeg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.97))).arrayBuffer())
    const tag = new TextEncoder().encode('SMOKE-GPS-52.37N')
    const tiff = [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0]
    const payload = [...new TextEncoder().encode('Exif'), 0, 0, ...tiff, ...tag]
    const app1 = [0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload]
    const photo = new File([jpeg.slice(0, 2), new Uint8Array(app1), jpeg.slice(2)], 'IMG_0042.jpeg', { type: 'image/jpeg' })
    const input = document.querySelector('.receipts input[type=file][multiple]')
    const dt = new DataTransfer(); dt.items.add(photo); input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return photo.size
  })()`)
  for (let i = 0; i < 50 && !server.uploads.some(u => u.path === '/expenses/e1/receipts'); i++) await sleep(200)
  const up = server.uploads.find(u => u.path === '/expenses/e1/receipts')
  expect(!!up, 'the photo is uploaded to the expense')
  if (up) {
    const body = up.body.toString('latin1')
    expect(/filename="IMG_0042\.jpg"/.test(body) && /Content-Type: image\/jpeg/.test(body), 'sent as a JPEG')
    expect(up.body.length < sent / 2, `made smaller before sending (${Math.round(sent / 1024)} KB -> ${Math.round(up.body.length / 1024)} KB)`)
    expect(!body.includes('SMOKE-GPS'), 'its location is gone')
    const preview = /name="thumbnail"; filename="thumbnail\.jpg"\r\nContent-Type: image\/jpeg\r\n\r\n([\s\S]*?)\r\n--/.exec(body)
    expect(!!preview && preview[1].length < 60 * 1024, `a small preview goes with it (${preview ? Math.round(preview[1].length / 1024) + ' KB' : 'none'})`)
  }
  await navigate(`${server.url}/groups/g1/expenses/new`); await settle()
  expect((await evaluate(`document.body.textContent`)).includes('Add a photo or PDF'), 'a new expense can take a receipt')
  const picked = await evaluate(`(async () => {
    const bytes = await (await fetch('/api/trips/files/any?sig=x')).blob()
    const input = document.querySelector('.file-add input[type=file][multiple]')
    const dt = new DataTransfer(); dt.items.add(new File([bytes], 'lunch.png', { type: 'image/png' })); input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    for (let i = 0; i < 20 && !document.querySelector('.file-tile img')?.naturalWidth; i++) await new Promise(r => setTimeout(r, 100))
    const img = document.querySelector('.file-tile img')
    return img ? { src: img.src.slice(0, 15), w: img.naturalWidth } : null
  })()`)
  expect(picked?.w > 0, `a picked photo shows as a thumbnail before saving (${JSON.stringify(picked)})`)
  // A one-page PDF invoice (built here, with a correct cross-reference table).
  const pdfPreview = await evaluate(`(async () => {
    const parts = [], offsets = []
    const add = s => { offsets.push(parts.join('').length); parts.push(s) }
    parts.push('%PDF-1.4\\n')
    const text = 'BT /F1 28 Tf 40 700 Td (HOTEL LISBOA - INVOICE) Tj 0 -60 Td (Total EUR 312.00) Tj ET'
    add('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\\n')
    add('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\\n')
    add('3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >> endobj\\n')
    add('4 0 obj << /Length ' + text.length + ' >> stream\\n' + text + '\\nendstream endobj\\n')
    add('5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\\n')
    const xref = parts.join('').length
    parts.push('xref\\n0 6\\n0000000000 65535 f \\n' + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \\n').join(''))
    parts.push('trailer << /Size 6 /Root 1 0 R >>\\nstartxref\\n' + xref + '\\n%%EOF\\n')
    const input = document.querySelector('.file-add input[type=file][multiple]')
    const dt = new DataTransfer(); dt.items.add(new File([parts.join('')], 'invoice.pdf', { type: 'application/pdf' })); input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    for (let i = 0; i < 80; i++) {
      const imgs = [...document.querySelectorAll('.file-tile img')]
      if (imgs.length > 1 && imgs[1].naturalWidth) break
      await new Promise(r => setTimeout(r, 100))
    }
    const img = document.querySelectorAll('.file-tile img')[1]
    if (!img) return null
    // Not a blank page: some pixels are dark (the text).
    const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight })
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const px = g.getImageData(0, 0, c.width, c.height).data
    let dark = 0; for (let i = 0; i < px.length; i += 4) if (px[i] < 100) dark++
    return { w: img.naturalWidth, h: img.naturalHeight, dark }
  })()`)
  expect(pdfPreview?.h > pdfPreview?.w && pdfPreview.dark > 50, `a picked PDF shows its first page (${JSON.stringify(pdfPreview)})`)
  takeErrors()

  console.log('Files on a trip item and the trip documents')
  await navigate(`${server.url}/trips/t1/items/i1`); await settle()
  for (let i = 0; i < 30 && !server.uploads.some(u => u.path === '/trips/files/a2/thumb'); i++) await sleep(200)
  const itemTiles = await evaluate(`[...document.querySelectorAll('.file-tile')].map(t => ({ name: t.querySelector('.file-tile-name')?.textContent, img: t.querySelector('img')?.naturalWidth || 0, thumb: !!t.querySelector('img')?.src.includes('/thumb?') }))`)
  expect(itemTiles.length === 2 && itemTiles.every(t => t.img > 0), `the item's files show as tiles with pictures (${JSON.stringify(itemTiles)})`)
  expect(itemTiles[0]?.thumb, 'a file with a stored preview shows that preview')
  const sentPreview = server.uploads.find(u => u.path === '/trips/files/a2/thumb')
  expect(!!sentPreview && /name="thumbnail"[\s\S]*Content-Type: image\/jpeg/.test(sentPreview.body.toString('latin1')), 'a file without one gets a preview drawn on the phone and sent')
  await navigate(`${server.url}/trips/t1/documents`); await settle()
  const docTile = await evaluate(`(() => { const t = document.querySelector('.trip-docs .file-tile'); return t ? { name: t.querySelector('.file-tile-name')?.textContent, meta: t.querySelector('.file-tile-meta')?.textContent, img: t.querySelector('img')?.naturalWidth || 0, actions: t.querySelectorAll('.trip-docs-icon').length } : null })()`)
  expect(docTile?.name === 'arrival-card.png' && docTile.img > 0 && docTile.actions === 2 && /Only you/.test(docTile.meta), `a document is a tile with its preview, who sees it and its buttons (${JSON.stringify(docTile)})`)
  takeErrors()

  console.log('Previews kept offline')
  const keptKeys = () => evaluate(`caches.open('splitty-offline-docs').then(c => c.keys()).then(k => k.map(r => new URL(r.url).pathname))`)
  let keys = []
  for (let i = 0; i < 40; i++) { keys = await keptKeys(); if (keys.includes('/offline-docs/thumbs/a1') && keys.includes('/offline-docs/thumbs/d1')) break; await sleep(250) }
  expect(keys.includes('/offline-docs/thumbs/a1') && keys.includes('/offline-docs/thumbs/d1'), `the kept trip's previews are on the device (${keys.filter(k => k.includes('thumbs')).join(', ') || 'none'})`)
  const storedLinks = await evaluate(`new Promise(res => { const r = indexedDB.open('splitty-offline'); r.onsuccess = () => { try { const q = r.result.transaction('trips').objectStore('trips').get('t1'); q.onsuccess = () => res(JSON.stringify(q.result || {}).includes('thumbUrl')); q.onerror = () => res(null) } catch { res(null) } }; r.onerror = () => res(null) })`)
  expect(storedLinks === false, 'the kept trip holds no expiring preview links')
  await send('Network.enable')
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await navigate(`${server.url}/trips/t1/items/i1`); await settle(); await sleep(800)
  const offlineTiles = await evaluate(`[...document.querySelectorAll('.file-tile')].map(t => { const i = t.querySelector('img'); return { src: i ? new URL(i.src).pathname : null, w: i?.naturalWidth || 0 } })`)
  expect(offlineTiles[0]?.src === '/offline-docs/thumbs/a1' && offlineTiles[0].w > 0, `offline, a tile shows its kept preview (${JSON.stringify(offlineTiles)})`)
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  takeErrors()

  console.log('Receipts in the Activity feed')
  // Network back on before this (the offline check above turns it off and on).
  await navigate(`${server.url}/activity`); await settle()
  const actRows = await evaluate(`[...document.querySelectorAll('.act-row')].map(r => ({ desc: r.querySelector('.act-desc')?.textContent, meta: r.querySelector('.act-text .act-meta')?.textContent, amt: r.querySelector('.act-amt')?.textContent || null, href: r.getAttribute('href') }))`)
  const rcpt = actRows.find(r => /added a receipt/.test(r.meta || ''))
  expect(rcpt && rcpt.desc === 'Groceries' && rcpt.amt === null && rcpt.href === '/groups/g1/expenses/e1', `a receipt row names its expense, has no amount and opens the expense (${JSON.stringify(rcpt)})`)
  const exp = actRows.find(r => /Smoke Tester added/.test(r.meta || ''))
  expect(exp && exp.amt, `the expense row keeps its amount (${JSON.stringify(exp)})`)
  takeErrors()

  console.log('Place search as you type')
  await navigate(`${server.url}/trips/t1/items/new`); await settle()
  expect(await evaluate(`(() => { const b = document.querySelector('.place-trigger'); b?.click(); return !!b })()`), 'a place field opens its picker')
  await sleep(400)
  await evaluate(`(() => {
    const input = document.querySelector('.place-sheet input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'taipei ma')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  let placeMeta = []
  for (let i = 0; i < 20 && !placeMeta.length; i++) {
    await sleep(200)
    placeMeta = await evaluate(`[...document.querySelectorAll('.place-sheet .place-row-meta')].map(e => e.textContent).filter(t => t.includes('·'))`)
  }
  expect(placeMeta.includes('Station · Taipei, Taiwan'), `results appear without pressing Enter, with their kind and town (${JSON.stringify(placeMeta)})`)
  const opening = await evaluate(`getComputedStyle(document.querySelector('.sheet-overlay > .sheet')).animationName`)
  expect(opening === 'sheet-up', `the sheet slides up as it opens (${opening})`)
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await sleep(60)
  const closing = await evaluate(`({ ghost: document.querySelectorAll('.sheet-ghost').length, open: document.querySelectorAll('.sheet-overlay').length })`)
  expect(closing.ghost === 1 && closing.open === 0, `closing leaves only an animating copy (${JSON.stringify(closing)})`)
  await sleep(400)
  expect(await evaluate(`document.querySelectorAll('.sheet-ghost').length`) === 0, 'and the copy is gone after the animation')
  takeErrors()

  console.log('Follow link of a finished trip: the slideshow')
  const FIRST_DAY = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10)
  await navigate(`${server.url}/follow/smokefinished0000000000`); await settle()
  const cover = await evaluate(`({ title: document.querySelector('.story-title h1')?.textContent || '', summary: document.querySelector('.story-summary')?.textContent || '' })`)
  expect(cover.title.includes('Taiwan') && cover.summary.startsWith('3 days'), `opens on the title card (${JSON.stringify(cover)})`)
  await screenshot('story-title')
  const choices = await evaluate(`[...document.querySelectorAll('.story-choice-name')].map(e => e.textContent.trim())`)
  expect(choices.join('|') === 'Watch the journey|Day by day', `the title card offers the two ways side by side (${JSON.stringify(choices)})`)
  await evaluate(`document.querySelector('.story-choice.primary').click()`)
  await sleep(400)
  const leg = await evaluate(`({ what: document.querySelector('.story-panel-top .story-what')?.textContent || '', map: document.querySelector('.story-map-canvas')?.offsetHeight || 0, head: !!document.querySelector('.story-head') })`)
  expect(leg.what.includes('Train to Hualien') && leg.map > 400, `Play starts with the first journey, over the full-screen map (${JSON.stringify(leg)})`)
  await sleep(3800); await screenshot('story-leg')
  const legLine = await evaluate(`[...document.querySelectorAll('.story-map-canvas path.story-line')].map(p => p.getTotalLength())`)
  expect(legLine.length === 1 && legLine[0] > 50, `the journey is drawn on the map (${JSON.stringify(legLine)})`)
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))`)
  await sleep(300)
  await sleep(1600); await screenshot('story-photo')
  const shot = await evaluate(`({ img: !!document.querySelector('.story-card img'), caption: document.querySelector('.story-card figcaption')?.textContent || '', map: document.querySelector('.story-map-canvas')?.offsetHeight || 0, taken: !!document.querySelector('.story-shot img') })`)
  expect(shot.img && shot.caption.startsWith('Train to Hualien · Day 2') && shot.map > 400 && shot.taken, `then the photo taken on the way, as a card over the map that marks where (${JSON.stringify(shot)})`)
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))`)
  await sleep(2000); await screenshot('story-stop')
  const stop = await evaluate(`({ what: document.querySelector('.story-panel-top .story-what')?.textContent || '', pins: document.querySelectorAll('.story-map-canvas .trip-pin').length, current: document.querySelectorAll('.story-pin-current').length })`)
  expect(stop.what.includes('Stay in Hualien') && stop.pins === 2 && stop.current === 1, `then the next place, flown in to and marked (${JSON.stringify(stop)})`)
  const speed = await evaluate(`(() => { const b = document.querySelector('.story-speed'); b.click(); return new Promise(r => setTimeout(() => r(b.textContent), 50)) })()`)
  expect(speed === '2×', `the speed button goes to 2× (${speed})`)
  // Scrubbing: drag to the last step (the label says where), let go: there.
  const scrubbed = await evaluate(`(async () => {
    const input = document.querySelector('.story-scrub input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, input.max)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 50))
    const label = document.querySelector('.story-scrub-label')?.textContent
    input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    return { label, end: !!document.querySelector('.story-panel-bottom') }
  })()`)
  expect(scrubbed.label === 'The whole route' && scrubbed.end, `the scrub bar shows where it lands and jumps there (${JSON.stringify(scrubbed)})`)
  await sleep(500); await screenshot('story-end')
  const end = await evaluate(`({ title: document.querySelector('.story-panel-top h2')?.textContent || '', lines: document.querySelectorAll('.story-map-canvas path.story-line').length })`)
  expect(end.title.includes('Taiwan') && end.lines === 1, `ends on the whole route (${JSON.stringify(end)})`)
  expect(await evaluate(`[...document.querySelectorAll('.story-top .view-switch button')].map(b => b.textContent.trim() + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join('|')`) === 'Journey*|Day by day', 'the switch at the top shows Journey, with Day by day next to it')
  await evaluate(`[...document.querySelectorAll('.story-top .view-switch button')].find(b => b.textContent.includes('Day by day')).click()`)
  await sleep(300)
  const list = await evaluate(`({ hash: location.hash, first: document.querySelector('.trip-day')?.id, kicker: document.querySelector('.follow-kicker')?.textContent, marked: document.querySelectorAll('.trip-day.today, .entry-list .past').length })`)
  expect(list.hash === '#days' && list.first === `day-${FIRST_DAY}` && !list.kicker.startsWith('Follow') && list.marked === 0, `"Day by day" lists the days from the first, none greyed or marked today (${JSON.stringify(list)})`)
  await screenshot('days')
  expect(await evaluate(`document.querySelector('.follow .view-switch button[aria-pressed="true"]')?.textContent.trim()`) === 'Day by day', 'the list has the same switch, on Day by day')
  await evaluate(`[...document.querySelectorAll('.follow .view-switch button')].find(b => b.textContent.includes('Journey')).click()`)
  await sleep(400)
  expect(await evaluate(`!!document.querySelector('.story') && location.hash === ''`), 'and Journey goes back to the slideshow')
  takeErrors()

  console.log('Version on the profile page')
  await navigate(`${server.url}/profile`); await settle()
  const version = await evaluate(`document.querySelector('.profile-version')?.textContent || ''`)
  const commit = (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return '' } })()
  expect(/^Version .+\d{4}/.test(version) && (!commit || version.includes(commit)), `shows the build: "${version}"`)

  console.log('A new version under an open page')
  const builds = ['B', 'C'].map(name => {
    const dir = path.join(work, name)
    cpSync(DIST, dir, { recursive: true })
    appendFileSync(path.join(dir, 'sw.js'), `\n// smoke build ${name}\n`) // a new worker, same app
    return dir
  })
  await navigate(`${server.url}/privacy`); await settle()
  await evaluate('navigator.serviceWorker.ready')
  await sleep(1000)
  const mark = () => evaluate('window.__smoke = 1')
  const same = () => evaluate('window.__smoke === 1')
  const foreground = () => evaluate(`document.dispatchEvent(new Event('visibilitychange'))`)
  const newBuild = async dir => {
    server.setRoot(dir)
    return evaluate(`new Promise(res => {
      navigator.serviceWorker.addEventListener('controllerchange', () => res(true), { once: true })
      navigator.serviceWorker.getRegistration().then(r => r.update())
      setTimeout(() => res(false), 20000)
    })`)
  }
  await mark()
  expect(await evaluate('!!navigator.serviceWorker.controller'), 'the service worker controls the page')
  await foreground(); await sleep(800)
  expect(await same(), 'first install: no reload')
  expect(await newBuild(builds[0]), 'new build B takes over')
  await sleep(500)
  expect(await same(), 'no reload while the page is in view')
  await foreground(); await sleep(2000); await settle()
  expect(!(await same()), 'reloads on returning to the foreground')
  await navigate(`${server.url}/trips/t1/items/new`); await settle(); await mark()
  expect(await newBuild(builds[1]), 'new build C takes over')
  await foreground(); await sleep(1200)
  expect(await same(), 'no reload while a form is open')
  await evaluate(`history.pushState(null, '', '/privacy')`)
  await foreground(); await sleep(2000); await settle()
  expect(!(await same()), 'reloads once the form is left')
  server.setRoot(DIST)
  takeErrors()

  console.log('Sharing a file into Splitty')
  const pdf = readFileSync(path.join(HERE, 'ticket.png')).toString('base64')
  const redirected = await evaluate(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(pdf)}), c => c.charCodeAt(0))
    const body = new FormData()
    body.append('files', new File([bytes], 'museum.png', { type: 'image/png' }))
    const r = await fetch('/share-target', { method: 'POST', body })
    return new URL(r.url).pathname
  })()`)
  expect(redirected === '/share', `the service worker takes the shared file (→ ${redirected})`)
  await navigate(`${server.url}/share`)
  for (let i = 0; i < 40 && !(await evaluate(`!!document.body?.innerText.includes('museum.png') && !document.body.innerText.includes('Reading')`).catch(() => false)); i++) await sleep(250)
  expect(await evaluate(`document.body.innerText.includes('museum.png')`), 'the share page lists the file')
  expect(await evaluate(`/ticket code/i.test(document.body.innerText) && !/None found/.test(document.body.innerText)`), 'the code in it is read')
  const click = text => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)})); b?.click(); return !!b })()`)
  expect(await click('Taiwan'), 'pick the trip'); await sleep(1200)
  expect(await click('Taipei 101'), 'pick the item'); await sleep(2000)
  expect(await evaluate('location.pathname') === '/trips/t1/items/i1', 'the item opens')
  expect(server.posts.includes('POST /trips/items/i1/tickets') && server.posts.includes('POST /trips/items/i1/attachments'), 'codes and file are sent to the item')
  expect(await evaluate(`caches.has('splitty-shared')`) === false || await evaluate(`caches.open('splitty-shared').then(c => c.keys()).then(k => k.length === 0)`), 'the shared file is cleared')
  const errs = takeErrors()
  expect(errs.length === 0, `no errors along the way${errs.length ? ` — ${errs.join(' | ')}` : ''}`)
} catch (err) {
  fail(`stopped: ${err.message}`)
} finally {
  browser.close()
  await server.close()
  rmSync(work, { recursive: true, force: true })
}

if (process.env.SMOKE_VERBOSE && server.unknown.size) console.log(`\n(made-up API had no answer for: ${[...server.unknown].join(', ')})`)
console.log(failed ? `\n${failed} check(s) failed` : '\nAll smoke checks passed')
process.exit(failed ? 1 : 0)
