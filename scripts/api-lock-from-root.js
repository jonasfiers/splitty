#!/usr/bin/env node
//
// Derive a standalone package-lock.json for the API from the repo's root
// (workspaces) package-lock.json, for the API deploy on CT104 and CT116.
//
//   node api-lock-from-root.js <root package-lock.json> <api/package.json> > package-lock.json
//
// WHY
// ---
// The root lock is the only lock in git, and it describes the api workspace
// as part of a two-level tree: most packages hoisted to node_modules/, and
// some (where web or a hoisted package needs another version) nested under
// api/node_modules/. The servers run the API from a single directory with a
// single node_modules, so that tree cannot be copied as is: flattening it
// naively would let a hoisted package (say multer) pick up api's nested
// type-is 2.x where it was resolved to 1.x.
//
// So this script re-places the API's dependency graph into a tree rooted at
// the API, and writes it as a lockfile that `npm ci` installs verbatim.
//
// WHY THE VERSIONS ARE IDENTICAL TO THE ROOT LOCK
// -----------------------------------------------
// - No resolution happens here and nothing is fetched: every package entry
//   (version, resolved URL, integrity, dependency ranges) is copied unchanged
//   from the root lock. Only its position in the tree changes.
// - The graph is the root lock's graph: for every package in the API's
//   closure and every dependency it declares, the target is whatever Node's
//   lookup (walk up node_modules/ directories) finds from that package's
//   place in the ROOT tree.
// - Before printing, every edge is re-resolved in the new tree and must land
//   on an entry with the same version and integrity as in the root tree. Any
//   difference aborts with a non-zero exit, so a lock is printed only if it
//   is edge-for-edge identical.
// - The root entry's dependency lists come from the root lock's "api" entry,
//   so `npm ci` refuses to install if api/package.json disagrees with the
//   committed lock, exactly as it would at the repo root.
//
// Development dependencies (nodemon) are kept but flagged dev, as npm needs
// them in the lock for `npm ci` to accept it; `--omit=dev` leaves them out.
// No web package can appear: only the API's closure is walked.

'use strict';
const fs = require('fs');
const path = require('path');

// npm's own semver, bundled with the node running this (no install needed:
// this runs before `npm ci`). Without it the range check below is skipped and
// `npm ls` after the install is the only range check.
let semver = null;
try {
  semver = require(path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'node_modules', 'semver'));
} catch {
  console.error('api-lock-from-root: warning: npm\'s bundled semver not found, skipping the range check');
}

const [rootLockPath, apiPkgPath] = process.argv.slice(2);
if (!rootLockPath || !apiPkgPath) {
  console.error('usage: api-lock-from-root.js <root package-lock.json> <api/package.json>');
  process.exit(2);
}
const die = (msg) => { console.error(`api-lock-from-root: ${msg}`); process.exit(1); };

const rootLock = JSON.parse(fs.readFileSync(rootLockPath, 'utf8'));
const apiPkg = JSON.parse(fs.readFileSync(apiPkgPath, 'utf8'));
if (rootLock.lockfileVersion !== 3) die(`expected lockfileVersion 3, got ${rootLock.lockfileVersion}`);
const P = rootLock.packages;

const WS = Object.keys(P).find((k) => !k.includes('node_modules') && P[k].name === apiPkg.name);
if (WS === undefined || WS === '') die(`no workspace entry named ${apiPkg.name} in the root lock`);
const ws = P[WS];

// The same check `npm ci` makes at the repo root.
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  const a = JSON.stringify(Object.entries(apiPkg[field] || {}).sort());
  const b = JSON.stringify(Object.entries(ws[field] || {}).sort());
  if (a !== b) die(`${field} in ${apiPkgPath} do not match the root lock — run npm install at the repo root and commit package-lock.json`);
}

const parentDir = (p) => {
  const i = p.lastIndexOf('/node_modules/');
  return i >= 0 ? p.slice(0, i) : ''; // top-level packages and workspaces sit in the root
};
// Node's lookup from the package at `from`, within `pkgs`.
const resolveIn = (pkgs, from, name) => {
  for (let dir = from; dir !== null; dir = dir === '' ? null : parentDir(dir)) {
    const cand = (dir === '' ? '' : dir + '/') + 'node_modules/' + name;
    if (pkgs[cand]) return cand;
  }
  return null;
};

// Edges of a package: [name, kind, spec] where kind is
// prod|dev|optional|peer|peerOptional. Optional peers are never placed or
// walked (npm does not install them for their own sake); they are only
// checked where some other edge brought a copy into the tree.
const edgesOf = (entry, isRoot) => {
  const out = [];
  for (const [n, spec] of Object.entries(entry.dependencies || {})) out.push([n, 'prod', spec]);
  for (const [n, spec] of Object.entries(entry.optionalDependencies || {})) out.push([n, 'optional', spec]);
  const meta = entry.peerDependenciesMeta || {};
  for (const [n, spec] of Object.entries(entry.peerDependencies || {})) {
    out.push([n, meta[n] && meta[n].optional ? 'peerOptional' : 'peer', spec]);
  }
  if (isRoot) for (const [n, spec] of Object.entries(entry.devDependencies || {})) out.push([n, 'dev', spec]);
  return out;
};
const same = (a, b) => a.version === b.version && a.integrity === b.integrity && a.resolved === b.resolved;

// Place the graph, breadth first. `src` maps each new path to its root-lock path.
const out = {};
const src = { '': WS };
const queue = [''];
while (queue.length) {
  const here = queue.shift();
  for (const [name, kind] of edgesOf(P[src[here]], here === '')) {
    if (kind === 'peerOptional') continue;
    const target = resolveIn(P, src[here], name);
    if (!target) {
      if (kind === 'optional') continue; // e.g. a platform-specific package npm skipped
      die(`${src[here] || '(root)'} needs ${name}, which the root lock does not provide`);
    }
    if (P[target].link) die(`${name} is a link in the root lock; not supported here`);
    if (P[target].inBundle) die(`${target} is a bundled dependency in the root lock; not supported here`);
    const found = resolveIn(out, here, name);
    if (found && same(out[found], P[target])) continue;
    // Hoist to the top if nothing is there yet; otherwise nest under the
    // dependent so only it (and its own subtree) sees this version.
    const place = found ? (here === '' ? '' : here + '/') + 'node_modules/' + name : 'node_modules/' + name;
    if (out[place]) die(`internal: ${place} already placed`);
    out[place] = P[target];
    src[place] = target;
    queue.push(place);
  }
}

// Verify every edge against the root tree; see the header.
let edges = 0;
for (const here of ['', ...Object.keys(out)]) {
  for (const [name, kind, spec] of edgesOf(P[src[here]], here === '')) {
    const want = resolveIn(P, src[here], name);
    const got = resolveIn(out, here, name);
    if (kind === 'peerOptional') {
      if (got && want && !same(out[got], P[want])) {
        die(`optional peer ${here || '(root)'} -> ${name}: root lock has ${P[want].version}, derived tree has ${out[got].version}`);
      }
    } else {
      if (!want) continue; // optional and absent, as in the root tree
      if (!got || !same(out[got], P[want])) {
        die(`edge ${here || '(root)'} -> ${name}: root lock has ${P[want].version}, derived tree has ${got ? out[got].version : 'nothing'}`);
      }
      edges++;
    }
    // A version outside the declared range can only come from an `overrides`
    // entry in the root package.json, which the standalone lock cannot carry
    // (and `npm ls` would then reject the install). Say so up front.
    if (got && semver && semver.validRange(spec, true) && !semver.satisfies(out[got].version, spec, true)) {
      die(`version ${out[got].version} of ${name} is outside range ${spec} required by ${src[here] || '(root)'} — root overrides are not supported by the API deploy`);
    }
  }
}

// Dependency flags relative to the new root, as npm sets them: dev = only
// reachable through a devDependency, optional = only through optional edges,
// devOptional = not needed by prod except optionally, and also needed by dev.
// `rootKinds` picks which of the root's edges to start from; below the root,
// prod and peer edges are followed, optional ones only if `viaOptional`.
const reach = (rootKinds, viaOptional) => {
  const seen = new Set();
  const walk = (here, kinds) => {
    for (const [name, kind] of edgesOf(P[src[here]], here === '')) {
      if (!kinds.includes(kind) && !(viaOptional && kind === 'optional')) continue;
      const at = resolveIn(out, here, name);
      if (at && !seen.has(at)) { seen.add(at); walk(at, ['prod', 'peer']); }
    }
  };
  walk('', rootKinds);
  return seen;
};
const prodHard = reach(['prod', 'peer'], false);
const prodAny = reach(['prod', 'peer'], true);
const devHard = reach(['dev'], false);
const devAny = reach(['dev'], true);

const packages = { '': { name: apiPkg.name, version: apiPkg.version } };
for (const f of ['license', 'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'engines']) {
  if (ws[f]) packages[''][f] = ws[f];
}
for (const k of Object.keys(out).sort()) {
  const { dev, optional, devOptional, peer, ...entry } = out[k];
  if (!prodHard.has(k)) {
    if (prodAny.has(k) && devAny.has(k)) entry.devOptional = true;
    else if (prodAny.has(k)) entry.optional = true;
    else {
      entry.dev = true;
      if (!devHard.has(k)) entry.optional = true;
    }
  }
  packages[k] = entry;
}

process.stdout.write(JSON.stringify({
  name: apiPkg.name,
  version: apiPkg.version,
  lockfileVersion: 3,
  requires: true,
  packages,
}, null, 2) + '\n');
console.error(`api-lock-from-root: ${Object.keys(out).length} packages, ${edges} edges verified against ${rootLockPath}`);
