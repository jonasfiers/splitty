// A bare Chrome DevTools Protocol client: headless Chromium, no npm packages.
import { spawn } from 'child_process'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

export const sleep = ms => new Promise(r => setTimeout(r, ms))

const CHROME = process.env.CHROME || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync) || 'chromium'

export async function launch(port = 9340) {
  const profile = mkdtempSync(path.join(tmpdir(), 'splitty-smoke-'))
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' })
  let targets
  for (let i = 0; i < 60 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json() } catch { await sleep(250) }
  }
  if (!targets) { proc.kill(); throw new Error(`Chromium (${CHROME}) did not start`) }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  let id = 0
  const pending = new Map()
  const listeners = new Set()
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data)
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id) } else for (const l of listeners) l(m)
  })
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id
    pending.set(i, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)))
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Log.enable')
  return {
    send, evaluate, on: l => { listeners.add(l); return () => listeners.delete(l) },
    navigate: async url => { await send('Page.navigate', { url }) },
    close: () => { ws.close(); proc.kill(); try { rmSync(profile, { recursive: true, force: true }) } catch { /* still locked */ } },
  }
}
