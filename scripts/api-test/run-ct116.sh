#!/usr/bin/env bash
# Runs INSIDE CT116, shipped and invoked by scripts/test-api.sh.
# Usage: run-ct116.sh <stamp>
#
# Unpacks the API under test (with its tests) into /opt/splitty-api-test/app,
# installs its dependencies exactly as a deploy does (lock derived from the
# root lock, npm ci --omit=dev; reused while the lock is unchanged), starts the
# tests' own Neo4j (splitty-test-neo4j, port 7697), runs `node --test`, and
# stops that Neo4j again whatever happens. QA's database and API are never
# touched.
set -euo pipefail
STAMP="$1"
BASE=/opt/splitty-api-test
APP="$BASE/app"
NODE_BIN=/opt/node24/bin
log() { printf '    [ct116] %s\n' "$*"; }

exec 9>/run/lock/splitty-api-test.lock
flock -n 9 || { log "another API test run is in progress"; exit 1; }

cleanup() {
  systemctl stop splitty-test-neo4j 2>/dev/null || true
  rm -f "/var/tmp/splitty-api-test-$STAMP.tgz" "/var/tmp/splitty-api-test-lock-$STAMP.json" /root/api-lock-from-root.js /root/run-ct116.sh
}
trap cleanup EXIT

as_splitty() { runuser -u splitty -- env PATH="$NODE_BIN:/usr/bin:/bin" HOME=/var/tmp/splitty-npm-home \
  npm_config_cache=/var/tmp/splitty-npm-home/.npm "$@"; }

# A run that was cut off can leave its API behind on the test port, and the
# next run would then talk to it (with another JWT secret). Clear it first.
for pid in $(pgrep -u splitty -f '^/opt/node24/bin/node index.js$' || true); do
  case "$(readlink "/proc/$pid/cwd")" in "$APP"*) kill "$pid" && log "stopped a leftover test API (pid $pid)" ;; esac
done

install -d -o splitty -g splitty "$BASE" /var/tmp/splitty-npm-home
rm -rf "$APP.new" && mkdir -p "$APP.new"
tar xzf "/var/tmp/splitty-api-test-$STAMP.tgz" -C "$APP.new"
"$NODE_BIN/node" /root/api-lock-from-root.js "/var/tmp/splitty-api-test-lock-$STAMP.json" "$APP.new/package.json" \
  2>/dev/null >"$APP.new/package-lock.json"
lock_hash="$(sha256sum "$APP.new/package-lock.json" | cut -d' ' -f1)"
if [ -d "$APP/node_modules" ] && [ "$(cat "$APP/.lock-hash" 2>/dev/null)" = "$lock_hash" ]; then
  mv "$APP/node_modules" "$APP.new/node_modules"
  log "dependencies unchanged, reused"
  chown -R splitty:splitty "$APP.new"
else
  chown -R splitty:splitty "$APP.new"
  log "npm ci --omit=dev (Node $("$NODE_BIN/node" -v))"
  (cd "$APP.new" && as_splitty npm ci --omit=dev --no-audit --no-fund --loglevel=error) 2>&1 | sed 's/^/    [ct116] /'
fi
echo "$lock_hash" > "$APP.new/.lock-hash"
rm -rf "$APP" && mv "$APP.new" "$APP"

systemctl start splitty-test-neo4j
for _ in $(seq 1 90); do
  ss -ltn | grep -q '127.0.0.1\]*:7697 \|:7697 ' && break
  sleep 1
done
ss -ltn | grep -q ':7697 ' || { log "test Neo4j did not start"; journalctl -u splitty-test-neo4j -n 30 --no-pager; exit 1; }
log "test Neo4j up (port 7697)"

set +e
(cd "$APP" && set -a && . /etc/splitty-api-test.env && set +a && \
  runuser -u splitty --preserve-environment -- env PATH="$NODE_BIN:/usr/bin:/bin" HOME=/var/tmp/splitty-npm-home \
    timeout 900 node --test --test-concurrency=1 --test-reporter=spec 'tests/*.test.js')
rc=$?
set -e
exit $rc
