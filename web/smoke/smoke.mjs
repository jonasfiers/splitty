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
import { cpSync, mkdtempSync, rmSync, appendFileSync, readFileSync } from 'fs'
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
  const thumb = await evaluate(`(() => { const i = document.querySelector('.receipts .receipt-tile img'); return i ? { alt: i.alt, w: i.naturalWidth, thumb: i.src.includes('/thumb?') } : null })()`)
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
    const input = document.querySelector('.receipt-add input[type=file][multiple]')
    const dt = new DataTransfer(); dt.items.add(new File([bytes], 'lunch.png', { type: 'image/png' })); input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    for (let i = 0; i < 20 && !document.querySelector('.receipt-tile img')?.naturalWidth; i++) await new Promise(r => setTimeout(r, 100))
    const img = document.querySelector('.receipt-tile img')
    return img ? { src: img.src.slice(0, 15), w: img.naturalWidth } : null
  })()`)
  expect(picked?.w > 0, `a picked photo shows as a thumbnail before saving (${JSON.stringify(picked)})`)
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
