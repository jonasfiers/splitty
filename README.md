# Splitty

Splitwise, but the balances are a graph. A self-hosted expense-splitting app where debts aren't stored directly between people — they're derived from `PAID` and `OWED_BY` relationships on `Expense` nodes in Neo4j.

Built mostly as an excuse to get properly hands-on with graph data modeling.

**Live:** [splitty.jonasfiers.eu](https://splitty.jonasfiers.eu)

![Group overview — Cabin weekend](docs/screenshot-group.png)
![Expense detail with per-person split](docs/screenshot-expense.png)

## How it's modeled

The obvious schema is `(:Person)-[:OWES {amount}]->(:Person)` — and it's a trap. Every new expense means finding, updating, or deleting edges between every pair involved, and the moment an update is missed, your balances silently drift from reality.

Instead, every expense is its own node, and nothing else is stored:

```cypher
MATCH (payer:User)-[:PAID]->(e:Expense)-[o:OWED_BY]->(u:User)
RETURN payer, e, o, u
```

You paid €96 for the cabin weekend; Mila owes €32, Theo owes €40. That's one `Expense` node, one `PAID` relationship in, two `OWED_BY` relationships out.

**Balances are derived, never stored.** What Mila owes you is summed on the fly from every `PAID`/`OWED_BY` pair across your shared groups. There's no balance field to keep in sync, so there's nothing to drift, and the full history of *why* a balance is what it is stays queryable.

**Settlements aren't a separate concept.** Paying someone back is just another `Expense` node (`isSettlement: true`) — the same traversal that computes balances handles them for free.

## Features

- Groups with multi-currency support and daily exchange-rate snapshots
- Expenses with hierarchical categories, arbitrary per-person shares, and settlements
- Balance transfers between groups
- Passkey (WebAuthn) and password login
- Push notifications for group activity
- Installable PWA with an offline-friendly service worker
- Animated cat avatar with an idle / success / fail state machine

## Stack

- **API** — Node.js, Express, Neo4j (`neo4j-driver` + APOC), JWT, WebAuthn, `web-push`, Nodemailer
- **Web** — React, Vite, React Router, Recharts
- **Infra** — Nginx, with the API and Neo4j as native systemd services; Docker Compose is kept as a portable self-hosting path (public exposure is left to you — a host-level Cloudflare Tunnel, reverse proxy, etc.)

## Running it

This is an npm workspaces monorepo: one `package.json` and one `package-lock.json` at the root, with `api/` and `web/` as workspaces. `npm install` at the root installs both.

### Local dev

```bash
cp .env.example .env                        # fill in the values
docker compose -f compose.dev.yaml up -d    # Neo4j only, exposed on bolt://localhost:7688
npm install
npm run dev                                 # api on :3000, web on :5173
```

`npm run dev:api` and `npm run dev:web` run either half on its own.

Three settings want local values, on top of the secrets in `.env`:

- `NEO4J_URI=bolt://localhost:7688` in `.env` — where `compose.dev.yaml` puts Neo4j.
- `RP_ORIGIN=http://localhost:5173` in `.env` — the API builds its CORS allow-list from this, and the Vite dev server's origin has to be on it.
- `VITE_API_TARGET=http://localhost:3000` in `web/.env.local` — the dev server proxies `/api` to this; the default (`http://api:3000`) assumes the API is a Compose service. It has to live in `web/.env.local` rather than the root `.env`, because Vite reads env files relative to the `web/` workspace.

### Self-hosting with Docker Compose

```bash
cp .env.example .env   # fill in the values
docker compose up -d --build
```

This brings up Neo4j, the API, and an Nginx serving the built frontend on port 80. Nothing above that is set up for you — no TLS, no public hostname. That's intentionally left to whatever you're already using on the host (Cloudflare Tunnel, a reverse proxy, etc.).

Fair warning: this is *not* how the live instance runs, so it gets far less exercise than the native path below. The images pin Node 20 where production is on 24, and they build from `package.json` without the lockfile, so you get a fresh dependency resolution rather than the pinned tree.

### How the live instance runs

Not on Docker — it was migrated off Compose to native systemd services on 2026-08-25. The frontend is a plain Vite build, served as static files by Nginx from `/var/www/splitty/` on a reverse-proxy host, which also proxies `/api/` to a second host running `splitty-api.service` (Node 24) and `neo4j.service`.

Deploys run from a build host:

```sh
./scripts/deploy.sh              # web + API
./scripts/deploy.sh --dry-run    # print the plan, change nothing
./scripts/deploy.sh --web-only   # frontend only
./scripts/deploy.sh --api-only   # API only
```

Neither half is ever edited in place: each is staged next to the live copy, validated, then swapped in with a single `rename(2)`, keeping the outgoing version as a rollback target. Health checks then have to pass, or every tier the run touched is rolled back automatically.

Two constraints there are worth knowing before reorganising any of it, because neither is visible in the code:

- **The frontend is built on the build host, never on the API host.** That box has 1.5 GB of RAM and Neo4j claims most of it; a Vite/Rollup build there OOMs and takes the database down with it. Building elsewhere is safe precisely because the output is pure static files — no native code, no host-specific paths.
- **The API's dependencies are installed on the API host, never copied in.** `bcrypt` is a native addon compiled against a specific Node ABI, and the build host runs a different Node major than the API host. Shipping a `node_modules` built on the wrong one produces a service that won't start.

[`docs/deploying.md`](docs/deploying.md) is the full story — topology, the health gate and its rollback drill, `npm ci` vs `npm install` in a workspaces repo, and the gotchas. The script itself is written for my homelab, with hosts and paths hardcoded; it's in the repo as a description of the shape of the deploy, not as something you can run unmodified.

## Backups

Neo4j Community Edition doesn't support online (zero-downtime) backups — that's an Enterprise-only feature. `scripts/backup-neo4j.sh` briefly stops `neo4j.service`, tars up the live data directory, and starts it back up. It asks systemd which binary the service actually runs rather than hardcoding a versioned path, so a Neo4j upgrade can't silently leave it backing up a stale directory. Written for the native deployment; it assumes the checkout lives at `/opt/splitty` and writes to `/opt/backups/neo4j`.

Restarting the database empties its page cache, which used to make the first visit of the day slow, so the script then waits until Cypher actually answers and warms the store and the balance query plan before it exits.

Run nightly via cron:

```
0 3 * * * /opt/splitty/scripts/backup-neo4j.sh
```

Backups older than 14 days are pruned automatically. This only protects against data loss, not host loss — the tarballs land on the same machine, so copying them elsewhere is left as an exercise for whoever's reading this.

## License

MIT — see [LICENSE](LICENSE).

---

Built by [Jonas Fiers](https://www.jonasfiers.eu) — software engineer in Ghent, usually somewhere between low-code platforms and graph databases.
