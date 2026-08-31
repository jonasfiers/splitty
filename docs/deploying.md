# Deploying Splitty

There is one deploy path: `scripts/deploy.sh`, run **from devbox**.

```sh
cd /root/dev/splitty
./scripts/deploy.sh              # full deploy: web + API
./scripts/deploy.sh --dry-run    # print the plan, change nothing
./scripts/deploy.sh --web-only   # frontend only
./scripts/deploy.sh --api-only   # API only
```

Splitty runs natively under systemd. There is no Docker anywhere in this
homelab; the `compose.yaml` and `Dockerfile`s in this repo are Docker-era
leftovers and are not part of any deploy.

## Where things get built, and why

This is the part that is not obvious from reading the code, so it is written
down here and repeated in the header of `scripts/deploy.sh`.

### The frontend is built on devbox. Never on CT104.

CT104 has **1536 MB of RAM in total**, and Neo4j's `MemoryMax` claims about
1350 MB of it. There is no headroom there for a Vite/Rollup build — it will
OOM, and it will take Neo4j down with it. devbox has 3072 MB and a warm
`node_modules`.

This is safe to do off-box because the Vite build is pure static output: no
native code, no host-specific paths. Whatever devbox produces is what any
other machine would produce. CT101, which actually serves the files, has no
Node installed at all and only ever receives a tarball of the finished
`web/dist`.

### The API's dependencies are installed on CT104. Never on devbox.

`api/package.json` depends on **`bcrypt`**, a native addon compiled against a
specific Node ABI.

- devbox runs **Node 22** (`v22.23.1`)
- CT104 runs **Node 24** (`v24.19.0`, at `/opt/node24`)

Installing `node_modules` on devbox and copying the tree to CT104 would ship a
`bcrypt.node` built for the wrong ABI, and `splitty-api.service` would fail to
start. So `npm install --omit=dev` always runs **on CT104**, with
`/opt/node24/bin/npm`, as the `splitty` service account. The deploy then
explicitly `require()`s bcrypt under Node 24 before cutting over, so an ABI
mistake fails the deploy instead of the service.

Two related traps:

- `/opt/node24/bin/npm` has an `#!/usr/bin/env node` shebang and there is no
  `node` on the default `PATH`. Calling npm by absolute path is *not* enough —
  `/opt/node24/bin` has to be on `PATH`.
- The `splitty` account's shell is `nologin`, so only `runuser -u splitty --`
  (which execs directly rather than through a login shell) works.

### Consequence: the two halves get their source differently

The **web** half is built from the devbox worktree. The **API** half is
`git pull`ed on CT104 from GitHub. So an API deploy can only ever reach a
**pushed** commit, and `deploy.sh` refuses to run the API stage if `HEAD` is
not contained in `origin/main`. Use `--web-only` if you deliberately want to
publish an unpushed frontend change.

## Topology

| Host  | Address       | Role                                                        |
| ----- | ------------- | ----------------------------------------------------------- |
| devbox (CT111) | —    | dev repo, **build host**, where `deploy.sh` runs            |
| pve   | 192.168.0.240 | Proxmox host; the only way into the containers (`pct exec`) |
| CT101 | 192.168.0.241 | native nginx; serves `/var/www/splitty`, proxies `/api/` to CT104:3000 |
| CT104 | 192.168.0.244 | `splitty-api.service` (`/opt/splitty-api-node24`) + `neo4j.service` |

Everything reaches the containers as devbox → `ssh pve` → `pct exec`. Nested
quoting through that chain breaks past two or three layers, so `deploy.sh`
never inlines shell snippets remotely: it `pct push`es `deploy-ct101-web.sh`
and `deploy-ct104-api.sh` into the containers and runs them there with plain
word arguments.

## What a deploy actually does

**Web (CT101).** Build on devbox → tar → unpack into
`/var/www/splitty.staging.XXXXXX` → validate the payload really contains
`index.html` and `assets/` → swap by rename. The live document root is never
written into file-by-file; it changes identity in a single `rename(2)`, and
the outgoing build is kept at `/var/www/splitty.prev`.

**API (CT104).** `git pull` in `/opt/splitty` → copy the live app dir to
`/opt/splitty-api-node24.new` → rsync `api/` over it → `npm install --omit=dev`
with Node 24 → verify bcrypt loads and `index.js` parses → stop the service,
swap the directory, start. The outgoing app dir is kept at
`/opt/splitty-api-node24.prev`.

The staged copy is seeded from the live directory so npm has an existing
`node_modules` to reconcile against; an unchanged dependency set costs under a
second and bcrypt is not recompiled.

`node_modules/` and `package-lock.json` are excluded from both transfer and
deletion during the rsync. That lock file is gitignored and exists only on
CT104.

## The health gate

After the swaps, four checks must return 200:

| Check                              | Run from | Why there |
| ---------------------------------- | -------- | --------- |
| `127.0.0.1:3000/health`            | CT104    | the API process itself |
| `192.168.0.244:3000/health`        | CT101    | the path nginx actually proxies over |
| `https://splitty.jonasfiers.eu/`   | devbox   | a genuine outside-in view |
| `https://neo4j.home.jonasfiers.eu` | CT101    | Tailscale-only name; devbox is not on Tailscale |

If any check fails, **every tier this run touched is rolled back
automatically** (previous directory restored, service restarted), the checks
are re-run, and the script exits non-zero. A `--web-only` run only rolls back
the web tier.

If the API stage fails *before* the cutover, the live app directory was never
touched and the API is deliberately **not** rolled back — doing so would
replace a healthy version with an older one. The remote script signals this
with exit code 10 (pre-cutover) versus 11 (post-cutover).

Rejected versions are kept as `/var/www/splitty.failed` and
`/opt/splitty-api-node24.failed` for inspection. Delete them once you have
looked.

### Testing the rollback

`--simulate-failure=<check>` forces one health check to report a failure, so
the whole rollback path can be exercised against production on demand:

```sh
./scripts/deploy.sh --simulate-failure=public
```

This performs a **real** deploy and then rolls it back. The simulation is
lifted before the post-rollback verification, so the final checks are honest.

## npm ci vs npm install

This repo is an **npm workspaces** monorepo. The lockfile that matters is
`package-lock.json` at the repo root, and it covers both the `api` and `web`
workspaces. `web/` has no lockfile of its own, and `web/node_modules` being
nearly empty is normal — dependencies hoist to the root `node_modules`, it is
not a broken install.

`deploy.sh` checks for the root lockfile and uses:

```sh
npm ci --workspace web
```

`npm ci` because the lockfile exists and is in sync, so builds are
reproducible. `--workspace web` because a bare `npm ci` would also install the
API's dependencies on devbox — including compiling bcrypt against Node 22,
which is wasted work for a tree that must never be shipped to CT104. If the
root lockfile is ever missing, the script falls back to `npm install
--workspace web` and says so.

## Notes and gotchas

- `/opt/splitty/.env` and `/etc/splitty-api.env` hold live secrets. They are
  also **not safely `source`-able**: `EMAIL_FROM` contains an unquoted `<`.
  Use `grep`/`cut` if you need a value out of them.
- `/opt/splitty` on CT104 keeps two intentional untracked files,
  `backup-neo4j.sh.docker-era.bak` and `compose.yaml.pre-stage1.bak`. The
  dirty-checkout guard uses `git status --porcelain -uno`, so untracked files
  never block a deploy. Modified *tracked* files do, on purpose — the deploy
  refuses to pull over them rather than discarding someone's work.
- `scripts/backup-neo4j.sh` is run by cron on CT104 out of `/opt/splitty`, so
  a deploy's `git pull` updates the live backup script too. That is deliberate
  (see the header of that script).
- The public site sits behind Cloudflare, which injects its own script into
  `index.html`. The HTML you get from `https://splitty.jonasfiers.eu/` will
  therefore not hash-match the built file; fetch from CT101 with a `Host:`
  header to compare bytes against `web/dist`.
