#!/usr/bin/env bash
#
# Splitty API deploy — runs INSIDE CT104 (splitty, 192.168.0.244).
#
# Pushed here by scripts/deploy.sh on devbox; not meant to be run by hand.
#
# WHY THE API'S DEPENDENCIES ARE INSTALLED HERE AND NOT ON DEVBOX
# ---------------------------------------------------------------
# api/package.json depends on bcrypt, a native addon compiled against a
# specific Node ABI. devbox runs Node 22, CT104 runs Node 24 (/opt/node24).
# A node_modules tree installed on devbox and copied here would ship a
# bcrypt.node built for the wrong ABI and the service would fail to start.
# So dependency installation happens here, with /opt/node24/bin/npm, always.
#
# Note /opt/node24/bin/npm has an `#!/usr/bin/env node` shebang and there is no
# `node` on the default PATH, so npm must be invoked with /opt/node24/bin ON
# PATH — using npm's absolute path alone is not enough.
#
# EXIT CODES (deploy.sh depends on these to decide whether to roll back)
#   0   success
#   10  failed BEFORE cutover — the live app dir was never touched
#   11  failed AFTER cutover  — the live app dir is the new one and is unhealthy
#   20  rollback itself failed
#
# Usage:
#   deploy-ct104-api.sh preflight <expected-commit>
#   deploy-ct104-api.sh deploy    <expected-commit>
#   deploy-ct104-api.sh rollback
#   deploy-ct104-api.sh state

set -Eeuo pipefail

CHECKOUT="/opt/splitty"
APP="/opt/splitty-api-node24"
NEW="${APP}.new"
PREV="${APP}.prev"
FAILED="${APP}.failed"
SERVICE="splitty-api.service"
NODE_BIN="/opt/node24/bin"
APP_USER="splitty"
APP_GROUP="splitty"
NPM_HOME="/var/tmp/splitty-npm-home"
BRANCH="main"

CUTOVER=0   # flips to 1 the instant the live app dir becomes the new one

log() { printf '    [ct104] %s\n' "$*"; }
die() { printf '    [ct104] ERROR: %s\n' "$*" >&2; exit 10; }

# Any unexpected error reports whether the live directory had already been
# swapped, so the orchestrator knows if a rollback is warranted or harmful.
on_err() {
  local rc=$?
  printf '    [ct104] command failed (rc=%s)\n' "$rc" >&2
  if [ "$CUTOVER" -eq 1 ]; then exit 11; else exit 10; fi
}
trap on_err ERR

as_app_user() {
  # Run a command as the service account with a usable HOME and a PATH that can
  # actually find node. splitty's shell is nologin, so `runuser -u ... --`
  # (which execs directly instead of via a login shell) is the only form that
  # works here.
  install -d -o "$APP_USER" -g "$APP_GROUP" -m 0755 "$NPM_HOME"
  runuser -u "$APP_USER" -- env \
    HOME="$NPM_HOME" \
    PATH="${NODE_BIN}:/usr/local/bin:/usr/bin:/bin" \
    npm_config_cache="${NPM_HOME}/.npm" \
    "$@"
}

health_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/health 2>/dev/null || echo 000
}

wait_for_health() {
  local tries="${1:-20}" i code
  for ((i = 1; i <= tries; i++)); do
    code="$(health_code)"
    if [ "$code" = "200" ]; then
      log "local /health returned 200 after ${i} attempt(s)"
      return 0
    fi
    sleep 2
  done
  log "local /health never returned 200 (last: ${code:-none})"
  return 1
}

cmd="${1:-}"

case "$cmd" in
  preflight)
    # Untracked files (the two Docker-era *.bak files that live here on
    # purpose) must never block a deploy, hence -uno.
    dirty="$(git -C "$CHECKOUT" status --porcelain -uno)"
    if [ -n "$dirty" ]; then
      printf '    [ct104] tracked files are modified in %s:\n' "$CHECKOUT" >&2
      printf '%s\n' "$dirty" | sed 's/^/    [ct104]   /' >&2
      die "refusing to pull over local modifications. Inspect them, then commit
      them upstream or discard with: git -C $CHECKOUT checkout -- <file>"
    fi

    branch="$(git -C "$CHECKOUT" symbolic-ref --short HEAD)"
    [ "$branch" = "$BRANCH" ] || die "checkout is on branch '$branch', expected '$BRANCH'"

    log "checkout clean (tracked files), on $branch, at $(git -C "$CHECKOUT" rev-parse --short HEAD)"
    log "target commit ${2:0:12}"
    ;;

  deploy)
    expected="${2:-}"
    [ -n "$expected" ] || die "deploy needs the expected commit hash"

    log "fetching origin"
    git -C "$CHECKOUT" fetch --prune origin
    log "fast-forwarding $BRANCH"
    git -C "$CHECKOUT" merge --ff-only "origin/${BRANCH}"

    head="$(git -C "$CHECKOUT" rev-parse HEAD)"
    if [ "$head" != "$expected" ]; then
      die "checkout is at ${head:0:12} but devbox expected ${expected:0:12}.
      CT104 deploys by pulling from GitHub — is the commit pushed?"
    fi
    log "checkout now at $(git -C "$CHECKOUT" rev-parse --short HEAD)"

    # Build the next app dir beside the live one. Seeding it from the current
    # live dir gives npm an existing node_modules to reconcile against, so an
    # unchanged dependency set costs seconds and bcrypt is not recompiled.
    log "staging new app dir at $NEW"
    rm -rf "$NEW"
    cp -a "$APP" "$NEW"

    # Sync source over the staged copy. node_modules and the locally generated
    # package-lock.json are excluded from BOTH transfer and deletion — that
    # lock is gitignored and exists only on this host.
    rsync -a --delete \
      --exclude 'node_modules/' \
      --exclude 'package-lock.json' \
      "${CHECKOUT}/api/" "${NEW}/"
    chown -R "${APP_USER}:${APP_GROUP}" "$NEW"

    log "installing production deps with ${NODE_BIN}/npm (Node $("${NODE_BIN}/node" -v))"
    cd "$NEW"
    as_app_user npm install --omit=dev --no-audit --no-fund

    # Prove the tree actually loads under this Node before cutting over. This
    # is precisely the failure mode a devbox-side install would produce.
    log "verifying the built tree under Node 24"
    runuser -u "$APP_USER" -- env HOME="$NPM_HOME" "${NODE_BIN}/node" \
      -e "require('${NEW}/node_modules/bcrypt'); console.log('    [ct104] bcrypt (native, ABI-sensitive) loads OK under Node ' + process.versions.node)"
    runuser -u "$APP_USER" -- "${NODE_BIN}/node" --check "${NEW}/index.js"
    log "index.js parses OK"

    log "cutting over"
    systemctl stop "$SERVICE"
    rm -rf "${PREV}.old"
    if [ -d "$PREV" ]; then mv "$PREV" "${PREV}.old"; fi
    mv "$APP" "$PREV"
    mv "$NEW" "$APP"
    CUTOVER=1
    systemctl start "$SERVICE"
    rm -rf "${PREV}.old"
    log "previous app dir retained at $PREV"

    if ! wait_for_health 20; then
      log "service did not become healthy within ~40s; state: $(systemctl is-active "$SERVICE" || true)"
      exit 11
    fi
    log "deploy complete and healthy"
    ;;

  rollback)
    trap - ERR
    if [ ! -d "$PREV" ]; then
      printf '    [ct104] ERROR: no %s — cannot roll back the API tier\n' "$PREV" >&2
      exit 20
    fi
    log "rolling back to $PREV"
    systemctl stop "$SERVICE" || true
    rm -rf "$FAILED"
    if [ -d "$APP" ]; then mv "$APP" "$FAILED"; fi
    mv "$PREV" "$APP"
    systemctl start "$SERVICE" || true
    log "the rejected app dir is kept at $FAILED for inspection"
    if wait_for_health 20; then
      log "rollback restored a healthy service"
    else
      printf '    [ct104] ERROR: SERVICE STILL UNHEALTHY AFTER ROLLBACK — manual intervention needed\n' >&2
      exit 20
    fi
    ;;

  state)
    trap - ERR
    for d in "$APP" "$PREV" "$NEW" "$FAILED"; do
      if [ -d "$d" ]; then
        printf '    [ct104] %-34s %s  %s\n' "$d" \
          "$(stat -c '%y' "$d" | cut -d. -f1)" "$(stat -c '%U:%G' "$d")"
      else
        printf '    [ct104] %-34s absent\n' "$d"
      fi
    done
    printf '    [ct104] %-34s %s\n' "$SERVICE" "$(systemctl is-active "$SERVICE" || true)"
    printf '    [ct104] %-34s %s\n' "${CHECKOUT} HEAD" "$(git -C "$CHECKOUT" rev-parse --short HEAD)"
    printf '    [ct104] %-34s %s\n' "local /health" "$(health_code)"
    ;;

  *)
    die "unknown command: ${cmd:-<none>} (expected preflight|deploy|rollback|state)"
    ;;
esac
