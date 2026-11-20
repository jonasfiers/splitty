#!/usr/bin/env node
// Every top-level client route in web/src/App.jsx must be in CT101 nginx's SPA
// allowlist, or that page 404s on production (QA has no allowlist, so it can't
// show this). Used by deploy.sh (stops the deploy) and deploy-qa.sh (warns).
//
//   node scripts/check-routes.mjs <nginx-config-file | ->
//
// Exit 0: all covered. 1: routes missing (named on stdout). 2: can't check.
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const app = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../web/src/App.jsx'), 'utf8')
const conf = readFileSync(process.argv[2] === '-' || !process.argv[2] ? 0 : process.argv[2], 'utf8')

// First path segment of each <Route path="/x...">; params (/:token) and '*'
// belong to the follow host, which has its own nginx.
const routes = new Set()
for (const [, p] of app.matchAll(/<Route\s+path="\/([^"/]*)/g)) if (p && !p.startsWith(':') && p !== '*') routes.add(p)

// The SPA fallback: location ~ ^/(a|b|c)(/|$) { try_files $uri /index.html; }
const m = conf.match(/location\s+~\s+\^\/\(([^)]+)\)\(\/\|\$\)\s*\{[^}]*try_files[^}]*index\.html/)
if (!m) {
  console.log('no SPA allowlist (location ~ ^/(...)(/|$) with try_files … /index.html) found in the nginx config')
  process.exit(2)
}
const allowed = new Set(m[1].split('|'))
const missing = [...routes].filter(r => !allowed.has(r)).sort()
if (missing.length) {
  console.log(missing.join(' '))
  process.exit(1)
}
console.log(`${routes.size} top-level routes, all in the allowlist`)
