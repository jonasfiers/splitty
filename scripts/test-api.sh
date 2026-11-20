#!/usr/bin/env bash
#
# Splitty API tests — run this FROM devbox (CT111). (2026-11-20)
#
# Sends THIS worktree's api/ (with api/tests/) to CT116 and runs the tests
# there against the tests' own Neo4j (port 7697, wiped by every test file;
# never QA's or production's database). Each test file starts the API from
# this checkout and calls it over HTTP: balances, splits, currencies,
# settlements, who may see what. deploy.sh runs this before touching CT104.
#
#   scripts/test-api.sh            run the tests
#   scripts/test-api.sh --setup    one-time setup on CT116 (idempotent)
#
# Exit 0 when every test passes.
set -euo pipefail
PVE="root@192.168.0.240"
CT=116
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)-$$"
pve_ssh() { ssh -o BatchMode=yes -o ConnectTimeout=15 "$PVE" "$@"; }
ship() { # ship <local> <path in CT116>
  scp -q "$1" "$PVE:/tmp/$(basename "$2")"
  pve_ssh "pct push $CT /tmp/$(basename "$2") $2 && rm -f /tmp/$(basename "$2")"
}

if [ "${1:-}" = --setup ]; then
  ship "$REPO/scripts/api-test/neo4j-test.sh" /root/neo4j-test.sh
  ship "$REPO/scripts/api-test/setup-ct116.sh" /root/setup-ct116.sh
  pve_ssh "pct exec $CT -- bash -c 'bash /root/setup-ct116.sh; rc=\$?; rm -f /root/setup-ct116.sh; exit \$rc'"
  exit
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
tar czf "$TMP/api.tgz" --exclude=node_modules --exclude=package-lock.json -C "$REPO/api" .
cp "$REPO/package-lock.json" "$TMP/lock.json"
ship "$TMP/api.tgz" "/var/tmp/splitty-api-test-$STAMP.tgz"
ship "$TMP/lock.json" "/var/tmp/splitty-api-test-lock-$STAMP.json"
ship "$REPO/scripts/api-lock-from-root.js" /root/api-lock-from-root.js
ship "$REPO/scripts/api-test/run-ct116.sh" /root/run-ct116.sh
pve_ssh "pct exec $CT -- bash /root/run-ct116.sh $STAMP"
