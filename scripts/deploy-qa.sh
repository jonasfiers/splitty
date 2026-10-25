#!/usr/bin/env bash
#
# ============================================================================
#  Splitty QA deploy — run this FROM devbox (CT111).
# ============================================================================
#
#  Publishes THIS worktree, as it is right now, to the QA container: committed
#  or not, pushed or not, any branch. That is the point of QA — a change is
#  looked at on a working copy of Splitty before it ever reaches main.
#
#  The same two build rules as scripts/deploy.sh apply, for the same reasons:
#  the frontend is built here on devbox, and the API's dependencies are
#  installed in the container with its own Node 24 (bcrypt is ABI-specific).
#
#  TOPOLOGY
#  --------
#     CT116   192.168.0.236 splitty-qa   nginx (web + /api/ proxy), the API,
#                                        Neo4j holding a copy of production
#     CT115   homeproxy                  https://splitty-qa.home.jonasfiers.eu
#                                        (Tailscale-only) -> CT116:80
#
#  QA is not production: it has its own secrets, its mail goes to a local sink
#  (/var/lib/splitty-qa-mail/mail.txt), and it holds no push subscriptions or
#  passkeys. Every page shows a QA ribbon.
#
#  USAGE
#  -----
#     scripts/deploy-qa.sh [--web-only | --api-only]
#
set -euo pipefail

PVE="root@192.168.0.240"
CT=116
QA_URL="https://splitty-qa.home.jonasfiers.eu"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
DO_WEB=true DO_API=true

case "${1:-}" in
  --web-only) DO_API=false ;;
  --api-only) DO_WEB=false ;;
  "") ;;
  *) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"; exit 2 ;;
esac

stage() { printf '\n==> %s\n' "$*"; }
log()   { printf '    %s\n' "$*"; }
pve_ssh() { ssh -o BatchMode=yes -o ConnectTimeout=15 "$PVE" "$@"; }
ship() { # ship <local file> <path in CT116>
  scp -q "$1" "$PVE:/tmp/$(basename "$1")"
  pve_ssh "pct push $CT /tmp/$(basename "$1") $2 && rm -f /tmp/$(basename "$1")"
}

cd "$REPO"
stage "Source"
log "branch $(git rev-parse --abbrev-ref HEAD) at $(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo ' + uncommitted changes')"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

if $DO_WEB; then
  stage "Web: build on devbox"
  npm run build -w web >/dev/null
  tar czf "$TMP/web.tgz" -C web/dist .
  log "built $(du -sh web/dist | cut -f1)"
fi

if $DO_API; then
  stage "API: package the worktree"
  tar czf "$TMP/api.tgz" --exclude=node_modules --exclude=package-lock.json -C api .
fi

stage "Publish to CT116"
ship "$REPO/scripts/deploy-ct116-qa.sh" /root/deploy-ct116-qa.sh
$DO_WEB && ship "$TMP/web.tgz" "/var/tmp/splitty-qa-web-$STAMP.tgz"
if $DO_API; then
  ship "$TMP/api.tgz" "/var/tmp/splitty-qa-api-$STAMP.tgz"
  # The API's dependency versions come from the root lock, as in production.
  cp package-lock.json "$TMP/splitty-qa-lock-$STAMP.json"
  ship "$TMP/splitty-qa-lock-$STAMP.json" "/var/tmp/splitty-qa-lock-$STAMP.json"
  ship "$REPO/scripts/api-lock-from-root.js" /root/api-lock-from-root.js
fi
pve_ssh "pct exec $CT -- bash /root/deploy-ct116-qa.sh $STAMP $DO_WEB $DO_API"

stage "Check through CT115"
# From inside CT115: devbox is not on the tailnet, and CT115 admits no LAN HTTPS.
code=$(pve_ssh "pct exec 115 -- curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
  --resolve splitty-qa.home.jonasfiers.eu:443:127.0.0.1 $QA_URL/api/health" || true)
log "$QA_URL/api/health -> $code"
[ "$code" = 200 ] || { echo "QA health check failed" >&2; exit 1; }
log "QA is live: $QA_URL"
