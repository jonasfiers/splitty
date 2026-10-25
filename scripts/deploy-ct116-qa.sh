#!/usr/bin/env bash
#
# Runs INSIDE CT116 (splitty-qa), shipped and invoked by scripts/deploy-qa.sh.
# Usage: deploy-ct116-qa.sh <stamp> <do_web true|false> <do_api true|false>
#
# Each tier is staged beside the live copy and swapped in by rename, keeping
# the outgoing one as .prev; if the API does not come up healthy it is swapped
# back.
set -euo pipefail
STAMP="$1" DO_WEB="$2" DO_API="$3"
APP=/opt/splitty-api-node24
WEB=/var/www/splitty
NODE_BIN=/opt/node24/bin
log() { printf '    [ct116] %s\n' "$*"; }

if [ "$DO_WEB" = true ]; then
  TGZ="/var/tmp/splitty-qa-web-$STAMP.tgz"
  rm -rf "$WEB.new" && mkdir -p "$WEB.new"
  tar xzf "$TGZ" -C "$WEB.new" && rm -f "$TGZ"
  [ -f "$WEB.new/index.html" ] || { log "web tarball has no index.html"; exit 1; }
  rm -rf "$WEB.prev"; [ -d "$WEB" ] && mv "$WEB" "$WEB.prev"; mv "$WEB.new" "$WEB"
  log "web published (previous kept at $WEB.prev)"
fi

if [ "$DO_API" = true ]; then
  # Same install as production (scripts/deploy-ct104-api.sh): from scratch,
  # exactly the versions in the repo's root package-lock.json, via a lock
  # derived from it by api-lock-from-root.js and `npm ci`.
  TGZ="/var/tmp/splitty-qa-api-$STAMP.tgz"
  ROOT_LOCK="/var/tmp/splitty-qa-lock-$STAMP.json"
  app_npm() { (cd "$APP.new" && runuser -u splitty -- env PATH="$NODE_BIN:/usr/bin:/bin" HOME=/var/tmp/splitty-npm-home \
      npm_config_cache=/var/tmp/splitty-npm-home/.npm "$@"); }
  install -d -o splitty -g splitty /var/tmp/splitty-npm-home
  rm -rf "$APP.new" && mkdir -p "$APP.new"
  tar xzf "$TGZ" -C "$APP.new" && rm -f "$TGZ"
  "$NODE_BIN/node" /root/api-lock-from-root.js "$ROOT_LOCK" "$APP.new/package.json" 2>&1 >"$APP.new/package-lock.json" \
    | sed 's/^/    [ct116] /'
  rm -f "$ROOT_LOCK"
  chown -R splitty:splitty "$APP.new"
  log "npm ci --omit=dev with npm $(app_npm npm -v) (Node $("$NODE_BIN/node" -v))"
  app_npm npm ci --omit=dev --no-audit --no-fund 2>&1 | sed 's/^/    [ct116] /'
  app_npm node -e "require('bcrypt').hashSync('x', 4)" || { log "bcrypt does not load"; exit 1; }
  log "bcrypt (native) hashes OK"
  app_npm npm ls --omit=dev --all >/dev/null || { app_npm npm ls --omit=dev --all 2>&1 | sed 's/^/    [ct116]   /'; log "npm ls reports problems"; exit 1; }
  log "npm ls --omit=dev --all is clean"
  "$NODE_BIN/node" --check "$APP.new/index.js"
  log "installed (top level):"
  app_npm npm ls --omit=dev --depth=0 2>&1 | tail -n +2 | sed 's/^/    [ct116]   /'
  app_npm npm audit --omit=dev 2>&1 | sed 's/^/    [ct116]   audit: /' || log "npm audit reported findings (not fatal)"

  systemctl stop splitty-api 2>/dev/null || true
  rm -rf "$APP.prev"; [ -f "$APP/index.js" ] && mv "$APP" "$APP.prev" || rm -rf "$APP"
  mv "$APP.new" "$APP"
  systemctl enable --now splitty-api >/dev/null 2>&1
  for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/health)" = 200 ] && { log "API healthy"; break; }
    sleep 2
  done
  if [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/health)" != 200 ]; then
    log "API unhealthy — rolling back"
    journalctl -u splitty-api -n 20 --no-pager
    if [ -d "$APP.prev" ]; then
      systemctl stop splitty-api; rm -rf "$APP.failed"; mv "$APP" "$APP.failed"; mv "$APP.prev" "$APP"
      systemctl start splitty-api
    fi
    exit 1
  fi
fi
nginx -t 2>/dev/null && systemctl reload nginx
rm -f /root/deploy-ct116-qa.sh /root/api-lock-from-root.js
