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
  TGZ="/var/tmp/splitty-qa-api-$STAMP.tgz"
  rm -rf "$APP.new"
  # Start from the live tree so npm reconciles against an existing node_modules.
  if [ -d "$APP/node_modules" ]; then cp -a "$APP" "$APP.new"; else mkdir -p "$APP.new"; fi
  find "$APP.new" -mindepth 1 -maxdepth 1 ! -name node_modules ! -name package-lock.json -exec rm -rf {} +
  tar xzf "$TGZ" -C "$APP.new" && rm -f "$TGZ"
  chown -R splitty:splitty "$APP.new"
  log "installing production deps with Node $("$NODE_BIN/node" -v)"
  (cd "$APP.new" && runuser -u splitty -- env PATH="$NODE_BIN:$PATH" HOME=/var/tmp/splitty-npm-home \
      npm_config_cache=/var/tmp/splitty-npm-home/.npm npm install --omit=dev --no-audit --no-fund >/dev/null)
  (cd "$APP.new" && runuser -u splitty -- "$NODE_BIN/node" -e 'require("bcrypt")') || { log "bcrypt does not load"; exit 1; }
  "$NODE_BIN/node" --check "$APP.new/index.js"

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
rm -f /root/deploy-ct116-qa.sh
