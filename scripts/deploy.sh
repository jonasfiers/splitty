#!/usr/bin/env bash
#
# ============================================================================
#  Splitty deploy — run this FROM devbox (CT111). It is the only deploy path.
# ============================================================================
#
#  WHERE THINGS GET BUILT, AND WHY (the two non-obvious constraints)
#  ----------------------------------------------------------------
#
#  1. THE FRONTEND IS BUILT ON DEVBOX. NEVER ON CT104.
#     CT104 has 1536 MB of RAM in total and Neo4j's MemoryMax is ~1350 MB of
#     it. There is no headroom for a Vite/Rollup build there — it will OOM and
#     take Neo4j down with it. devbox has 3072 MB and a warm node_modules, and
#     the Vite build is pure static output, so it is portable: whatever devbox
#     produces is byte-identical to what any other host would produce.
#     CT101 (nginx) has no Node at all and only ever receives a tarball.
#
#  2. THE API'S DEPENDENCIES ARE INSTALLED ON CT104. NEVER ON DEVBOX.
#     api/package.json depends on bcrypt, a native addon compiled against a
#     specific Node ABI. devbox runs Node 22; CT104 runs Node 24 at
#     /opt/node24. Installing on devbox and copying the tree over would ship a
#     bcrypt.node built for the wrong ABI and splitty-api.service would fail to
#     start. So `npm install --omit=dev` runs on CT104 with /opt/node24/bin/npm,
#     as the splitty service account, every time.
#
#     Corollary: the two halves of a deploy get their source differently. The
#     web half is built from THIS worktree. The API half is `git pull`ed on
#     CT104 from GitHub — so an API deploy requires the commit to be pushed,
#     and this script refuses to proceed if it is not.
#
#  TOPOLOGY
#  --------
#     devbox  CT111                 this host; build host; git remote is SSH
#     pve     192.168.0.240         Proxmox host; the only way into the CTs
#     CT101   192.168.0.241  npm    native nginx; serves /var/www/splitty,
#                                   proxies /api/ -> 192.168.0.244:3000
#     CT104   192.168.0.244 splitty splitty-api.service + neo4j.service
#
#  All container commands go devbox -> ssh pve -> pct exec. Deep nested
#  quoting through that chain is unreliable, so this script never inlines shell
#  snippets: it ships scripts/deploy-ct10*.sh into the container with `pct push`
#  and runs them there with simple word arguments.
#
#  ATOMICITY AND ROLLBACK
#  ----------------------
#  Neither tier is ever edited in place. Each is staged beside the live copy,
#  validated, then swapped in with rename(2), keeping the outgoing version as
#  a .prev rollback target. After the swap, four health checks must pass; if
#  any fails, every tier this run touched is rolled back automatically and the
#  script exits non-zero.
#
#  USAGE
#  -----
#     scripts/deploy.sh [options]
#
#       --web-only            build and publish the frontend only
#       --api-only            deploy the API only
#       --dry-run             print the plan, change nothing anywhere
#       --allow-dirty         proceed despite a dirty devbox worktree
#       --skip-pull           do not `git pull` the devbox worktree first
#       --simulate-failure=X  rollback drill: force a health check to fail.
#                             X = api-local | api-via-nginx | public | neo4j | all
#       -h, --help            this text
#
#  See docs/deploying.md for the longer version.
# ============================================================================

set -Eeuo pipefail

# ---------------------------------------------------------------- config ----
PVE="root@192.168.0.240"
CT_WEB=101
CT_API=104
API_HOST="192.168.0.244"
BRANCH="main"
PUBLIC_URL="https://splitty.jonasfiers.eu/"
NEO4J_URL="https://neo4j.home.jonasfiers.eu"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="${REPO_ROOT}/scripts"
STAMP="$(date +%Y%m%d-%H%M%S)"

# ---------------------------------------------------------------- options ---
DO_WEB=true
DO_API=true
DRY_RUN=false
ALLOW_DIRTY=false
SKIP_PULL=false
SIMULATE_FAILURE=""

usage() { awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"; }

for arg in "$@"; do
  case "$arg" in
    --web-only)            DO_API=false ;;
    --api-only)            DO_WEB=false ;;
    --dry-run)             DRY_RUN=true ;;
    --allow-dirty)         ALLOW_DIRTY=true ;;
    --skip-pull)           SKIP_PULL=true ;;
    --simulate-failure=*)  SIMULATE_FAILURE="${arg#*=}" ;;
    -h|--help)             usage; exit 0 ;;
    *) printf 'Unknown option: %s\n\n' "$arg" >&2; usage >&2; exit 2 ;;
  esac
done

$DO_WEB || $DO_API || { echo "--web-only and --api-only are mutually exclusive" >&2; exit 2; }

case "$SIMULATE_FAILURE" in
  ""|api-local|api-via-nginx|public|neo4j|all) ;;
  *) echo "--simulate-failure must be one of: api-local api-via-nginx public neo4j all" >&2; exit 2 ;;
esac

# ---------------------------------------------------------------- logging ---
BOLD=""; DIM=""; RED=""; GRN=""; YLW=""; RST=""
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RST=$'\033[0m'
fi
stage() { printf '\n%s==> %s%s\n' "$BOLD" "$*" "$RST"; }
log()   { printf '    %s\n' "$*"; }
ok()    { printf '    %s%s%s\n' "$GRN" "$*" "$RST"; }
warn()  { printf '    %s%s%s\n' "$YLW" "$*" "$RST"; }
err()   { printf '    %s%s%s\n' "$RED" "$*" "$RST" >&2; }
plan()  { printf '    %swould: %s%s\n' "$DIM" "$*" "$RST"; }
die()   { err "$*"; exit 1; }

# --------------------------------------------------------------- remoting ---
pve_ssh() { ssh -o BatchMode=yes -o ConnectTimeout=15 "$PVE" "$@"; }

# ct_exec <ctid> <cmd...> — run a command inside a container.
# Arguments are requoted with printf %q so they survive the devbox -> pve shell
# hop intact; this is why nothing here is ever hand-quoted inline.
ct_exec() {
  local id="$1"; shift
  pve_ssh "pct exec $id -- $(printf '%q ' "$@")"
}

# ct_capture <ctid> <cmd...> — same, but return stdout and never fail the run.
ct_capture() {
  local id="$1"; shift
  pve_ssh "pct exec $id -- $(printf '%q ' "$@")" 2>/dev/null || true
}

# ship <ctid> <local file> <remote path> — devbox -> pve -> container.
ship() {
  local id="$1" src="$2" dst="$3" base
  base="$(basename "$dst")"
  scp -q -o BatchMode=yes "$src" "${PVE}:/tmp/${base}"
  pve_ssh "pct push $id /tmp/${base} ${dst} --perms 755 && rm -f /tmp/${base}"
}

# ------------------------------------------------------------ health gate ---
# Each check names where it runs. splitty.jonasfiers.eu is checked from devbox
# because that is a genuine outside-in view. neo4j.home.jonasfiers.eu is a
# Tailscale name (100.80.37.123) and devbox is not on Tailscale, so that one is
# checked from CT101, which is.
http_code_local() {
  local c; c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1" 2>/dev/null || true)"
  printf '%s' "${c:-000}"
}
http_code_in_ct() {
  local c; c="$(ct_capture "$1" curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$2")"
  c="${c//[$'\r\n ']/}"
  printf '%s' "${c:-000}"
}

check() { # check <name> <expected> <actual> -> 0/1
  local name="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '    %s[ok]%s   %-46s %s\n' "$GRN" "$RST" "$name" "$got"
    return 0
  fi
  printf '    %s[FAIL]%s %-46s %s (wanted %s)\n' "$RED" "$RST" "$name" "$got" "$want"
  return 1
}

# The simulated failure exists to trip the health gate. Once we are verifying
# that the rollback worked, it must be lifted — otherwise a drill always ends
# by claiming production is broken when it is not.
SIMULATION_ACTIVE=true
simulated() {
  $SIMULATION_ACTIVE || return 1
  [ "$SIMULATE_FAILURE" = "all" ] || [ "$SIMULATE_FAILURE" = "$1" ]
}
lift_simulation() {
  if [ -n "$SIMULATE_FAILURE" ] && $SIMULATION_ACTIVE; then
    SIMULATION_ACTIVE=false
    warn "drill: simulated failure lifted — the checks below are the real thing"
  fi
}

run_health_checks() { # -> 0 all good, 1 something failed
  local failures=0 code

  if simulated api-local; then code=000; warn "SIMULATED FAILURE: api-local"; else
    code="$(http_code_in_ct "$CT_API" http://127.0.0.1:3000/health)"; fi
  check "CT104  curl 127.0.0.1:3000/health" 200 "$code" || failures=$((failures + 1))

  if simulated api-via-nginx; then code=000; warn "SIMULATED FAILURE: api-via-nginx"; else
    code="$(http_code_in_ct "$CT_WEB" "http://${API_HOST}:3000/health")"; fi
  check "CT101  curl ${API_HOST}:3000/health" 200 "$code" || failures=$((failures + 1))

  if simulated public; then code=000; warn "SIMULATED FAILURE: public"; else
    code="$(http_code_local "$PUBLIC_URL")"; fi
  check "devbox ${PUBLIC_URL}" 200 "$code" || failures=$((failures + 1))

  if simulated neo4j; then code=000; warn "SIMULATED FAILURE: neo4j"; else
    code="$(http_code_in_ct "$CT_WEB" "$NEO4J_URL")"; fi
  check "CT101  ${NEO4J_URL}" 200 "$code" || failures=$((failures + 1))

  [ "$failures" -eq 0 ]
}

# --------------------------------------------------------------- rollback ---
WEB_DEPLOYED=false
API_DEPLOYED=false

rollback_all() {
  stage "ROLLING BACK"
  local rc=0
  if $API_DEPLOYED; then
    log "restoring previous API app dir on CT104"
    ct_exec "$CT_API" bash /root/deploy-ct104-api.sh rollback || rc=1
  fi
  if $WEB_DEPLOYED; then
    log "restoring previous web build on CT101"
    ct_exec "$CT_WEB" bash /root/deploy-ct101-web.sh rollback || rc=1
  fi
  if ! $API_DEPLOYED && ! $WEB_DEPLOYED; then
    warn "nothing had been deployed yet — nothing to roll back"
  fi
  return $rc
}

# ============================================================================
stage "Splitty deploy — $(date '+%F %T')"
log "repo:        $REPO_ROOT"
log "build host:  $(hostname) (devbox), node $(node -v), npm $(npm -v)"
log "stages:      web=$DO_WEB api=$DO_API"
$DRY_RUN && warn "DRY RUN — nothing will be changed on any host"
[ -n "$SIMULATE_FAILURE" ] && warn "ROLLBACK DRILL — health check '$SIMULATE_FAILURE' will be forced to fail"

# ------------------------------------------------------- 1. safety guards ---
stage "Preflight (devbox)"
cd "$REPO_ROOT"

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current_branch" != "$BRANCH" ]; then
  $ALLOW_DIRTY || die "on branch '$current_branch', expected '$BRANCH' (override with --allow-dirty)"
  warn "on branch '$current_branch', not '$BRANCH' — continuing because --allow-dirty"
fi

if [ -n "$(git status --porcelain -uno)" ]; then
  git status --short -uno | sed 's/^/    /'
  $ALLOW_DIRTY || die "worktree has uncommitted changes to tracked files (override with --allow-dirty)"
  warn "dirty worktree — continuing because --allow-dirty"
else
  ok "worktree clean, on $current_branch"
fi

# Untracked (non-ignored) files do not block a deploy, but the web build does
# come from this worktree, so they are worth naming out loud.
untracked="$(git ls-files --others --exclude-standard)"
if [ -n "$untracked" ]; then
  warn "untracked files present (they will not reach CT104, but may affect the web build):"
  printf '%s\n' "$untracked" | sed 's/^/      /'
fi

if $SKIP_PULL; then
  warn "skipping git pull (--skip-pull)"
elif $DRY_RUN; then
  plan "git pull --ff-only origin $BRANCH"
  # A fetch updates remote-tracking refs only. It touches no worktree file and
  # no deploy target, and it is what makes the 'is it pushed?' guard below
  # meaningful during a dry run.
  git fetch --quiet origin "$BRANCH" 2>/dev/null || warn "could not fetch origin (offline?)"
else
  log "git pull --ff-only origin $BRANCH"
  git pull --ff-only origin "$BRANCH"
fi

COMMIT="$(git rev-parse HEAD)"
COMMIT_SHORT="$(git rev-parse --short HEAD)"
COMMIT_SUBJECT="$(git log -1 --pretty=%s)"
ok "deploying $COMMIT_SHORT — $COMMIT_SUBJECT"

# The API tier pulls from GitHub, so it can only ever reach a pushed commit.
if $DO_API; then
  if git merge-base --is-ancestor "$COMMIT" "origin/${BRANCH}" 2>/dev/null; then
    ok "$COMMIT_SHORT is present on origin/$BRANCH — CT104 can pull it"
  else
    die "$COMMIT_SHORT is NOT on origin/$BRANCH. CT104 deploys by pulling from
      GitHub, so it cannot reach an unpushed commit. Push first, or use
      --web-only (the web build comes from this worktree, not from GitHub)."
  fi
fi

# ------------------------------------------------- 2. ship helper scripts ---
stage "Shipping helper scripts to the containers"
if $DRY_RUN; then
  $DO_WEB && plan "pct push $CT_WEB deploy-ct101-web.sh -> /root/deploy-ct101-web.sh"
  $DO_API && plan "pct push $CT_API deploy-ct104-api.sh -> /root/deploy-ct104-api.sh"
else
  if $DO_WEB; then
    ship "$CT_WEB" "${SCRIPT_DIR}/deploy-ct101-web.sh" /root/deploy-ct101-web.sh
    ok "CT101 <- deploy-ct101-web.sh"
  fi
  if $DO_API; then
    ship "$CT_API" "${SCRIPT_DIR}/deploy-ct104-api.sh" /root/deploy-ct104-api.sh
    ok "CT104 <- deploy-ct104-api.sh"
  fi
fi

# CT104 preflight has to happen before anything is changed anywhere, so a
# dirty checkout there aborts the run instead of stranding a half deploy.
if $DO_API; then
  stage "Preflight (CT104 checkout)"
  if $DRY_RUN; then
    # Read-only equivalent of the preflight, so a dry run still surfaces a
    # dirty remote checkout without pushing anything into the container.
    remote_head="$(ct_capture "$CT_API" git -C /opt/splitty rev-parse --short HEAD)"
    remote_dirty="$(ct_capture "$CT_API" git -C /opt/splitty status --porcelain -uno)"
    log "CT104 /opt/splitty is at ${remote_head:-unknown}, target $COMMIT_SHORT"
    if [ -n "$remote_dirty" ]; then
      printf '%s\n' "$remote_dirty" | sed 's/^/    /'
      warn "CT104 checkout has modified tracked files — a real run would REFUSE to pull"
    else
      ok "CT104 checkout is clean (tracked files); untracked files are ignored by design"
    fi
  else
    ct_exec "$CT_API" bash /root/deploy-ct104-api.sh preflight "$COMMIT"
  fi
fi

stage "State before deploy"
if $DRY_RUN; then
  if $DO_WEB; then
    log "CT101 /var/www/splitty  index.html mtime: $(ct_capture "$CT_WEB" stat -c '%y' /var/www/splitty/index.html)"
    log "CT101 /var/www/splitty.prev: $(ct_capture "$CT_WEB" bash -c 'test -d /var/www/splitty.prev && echo present || echo absent')"
  fi
  if $DO_API; then
    log "CT104 splitty-api.service: $(ct_capture "$CT_API" systemctl is-active splitty-api.service)"
    log "CT104 /opt/splitty-api-node24.prev: $(ct_capture "$CT_API" bash -c 'test -d /opt/splitty-api-node24.prev && echo present || echo absent')"
  fi
else
  if $DO_WEB; then ct_exec "$CT_WEB" bash /root/deploy-ct101-web.sh state; fi
  if $DO_API; then ct_exec "$CT_API" bash /root/deploy-ct104-api.sh state; fi
fi

# ------------------------------------------------------------ 3. web tier ---
WEB_TARBALL=""
if $DO_WEB; then
  stage "Web: install dependencies and build (on devbox)"

  # This is an npm workspaces monorepo: the lockfile that matters is the one
  # at the repo root, and it covers both workspaces. web/ has no lockfile of
  # its own and web/node_modules is a near-empty hoist artifact — that is
  # normal here, not a broken install.
  if [ -f "${REPO_ROOT}/package-lock.json" ]; then
    # --workspace web keeps the API's native deps (bcrypt) out of the devbox
    # install entirely: nothing built here is ever shipped to CT104.
    INSTALL_CMD=(npm ci --workspace web)
    log "root package-lock.json present -> npm ci (reproducible)"
  else
    INSTALL_CMD=(npm install --workspace web)
    warn "no root package-lock.json -> falling back to npm install"
  fi

  if $DRY_RUN; then
    plan "${INSTALL_CMD[*]}"
    plan "npm run build --workspace web   (output: web/dist)"
    plan "tar czf /tmp/splitty-web-${STAMP}.tgz -C web/dist ."
  else
    log "${INSTALL_CMD[*]}"
    "${INSTALL_CMD[@]}"
    log "npm run build --workspace web"
    rm -rf "${REPO_ROOT}/web/dist"
    npm run build --workspace web
    [ -f "${REPO_ROOT}/web/dist/index.html" ] || die "build produced no web/dist/index.html"
    ok "built $(find "${REPO_ROOT}/web/dist" -type f | wc -l) files into web/dist"

    WEB_TARBALL="/tmp/splitty-web-${STAMP}.tgz"
    tar -czf "$WEB_TARBALL" -C "${REPO_ROOT}/web/dist" .
    ok "packed $(du -h "$WEB_TARBALL" | cut -f1) -> $WEB_TARBALL"
  fi

  stage "Web: publish to CT101 (atomic swap)"
  if $DRY_RUN; then
    plan "pct push $CT_WEB <tarball> -> /var/tmp/splitty-web-${STAMP}.tgz"
    plan "CT101: unpack to /var/www/splitty.staging.XXXXXX, validate,"
    plan "CT101: mv /var/www/splitty -> /var/www/splitty.prev  (rollback target)"
    plan "CT101: mv /var/www/splitty.staging.XXXXXX -> /var/www/splitty"
  else
    ship "$CT_WEB" "$WEB_TARBALL" "/var/tmp/splitty-web-${STAMP}.tgz"
    set +e
    ct_exec "$CT_WEB" bash /root/deploy-ct101-web.sh publish "/var/tmp/splitty-web-${STAMP}.tgz"
    web_rc=$?
    set -e
    rm -f "$WEB_TARBALL"
    if [ "$web_rc" -ne 0 ]; then
      # The publish script only fails before the swap, so the live site is
      # still the previous build; there is nothing to roll back.
      die "web publish failed on CT101 (rc=$web_rc) — the live site is untouched"
    fi
    WEB_DEPLOYED=true
    ok "web tier published"
  fi
fi

# ------------------------------------------------------------ 4. api tier ---
if $DO_API; then
  stage "API: deploy to CT104"
  if $DRY_RUN; then
    plan "CT104: git -C /opt/splitty fetch && merge --ff-only origin/$BRANCH"
    plan "CT104: verify HEAD == $COMMIT_SHORT"
    plan "CT104: cp -a /opt/splitty-api-node24 /opt/splitty-api-node24.new"
    plan "CT104: rsync /opt/splitty/api/ -> .new (excluding node_modules, package-lock.json)"
    plan "CT104: chown -R splitty:splitty .new"
    plan "CT104: /opt/node24/bin/npm install --omit=dev  (as splitty, Node 24 ABI)"
    plan "CT104: verify bcrypt loads and index.js parses"
    plan "CT104: stop splitty-api, mv live -> .prev, mv .new -> live, start"
  else
    set +e
    ct_exec "$CT_API" bash /root/deploy-ct104-api.sh deploy "$COMMIT"
    api_rc=$?
    set -e

    if [ "$api_rc" -eq 0 ]; then
      API_DEPLOYED=true
      ok "API tier deployed"
    else
      # Exit code 10 means the remote script bailed out BEFORE the cutover, so
      # the live app dir was never touched. Rolling the API back in that case
      # would replace a perfectly good live version with an older one, so we
      # deliberately do not. Anything else is treated as post-cutover.
      if [ "$api_rc" -eq 10 ]; then
        err "API deploy aborted before cutover (rc=10) — the live API is untouched"
      else
        err "API deploy failed after cutover (rc=$api_rc) — the API tier needs rolling back"
        API_DEPLOYED=true
      fi
      rollback_all || err "rollback reported problems"
      stage "Post-rollback health"
      lift_simulation
      run_health_checks || err "still unhealthy after rollback"
      die "DEPLOY FAILED during the API stage. Nothing from $COMMIT_SHORT is live."
    fi
  fi
fi

# --------------------------------------------------------- 5. health gate ---
stage "Health gate"
if $DRY_RUN; then
  log "running the health checks read-only (they change nothing):"
  if run_health_checks; then ok "all four checks pass right now"; else warn "one or more checks are failing BEFORE any deploy"; fi
else
  # Give nginx/the API a moment to settle after the swaps.
  sleep 2
  if run_health_checks; then
    ok "all four health checks passed"
  else
    err "health gate FAILED — rolling back automatically"
    rollback_all || err "rollback itself reported problems"
    stage "Post-rollback health"
    lift_simulation
    if run_health_checks; then
      warn "service restored by rollback; the deploy of $COMMIT_SHORT was REJECTED"
    else
      err "PRODUCTION IS STILL UNHEALTHY AFTER ROLLBACK — manual intervention required"
    fi
    die "DEPLOY FAILED and was rolled back. Nothing from $COMMIT_SHORT is live."
  fi
fi

# ------------------------------------------------------------- 6. summary ---
stage "Summary"
if $DRY_RUN; then
  log "DRY RUN — no host was modified."
  log "commit that would be deployed: $COMMIT_SHORT ($COMMIT_SUBJECT)"
  $DO_WEB && log "web: would build on devbox and publish to CT101:/var/www/splitty"
  $DO_API && log "api: would pull on CT104 and rebuild /opt/splitty-api-node24"
  exit 0
fi

log "commit:  $COMMIT_SHORT  $COMMIT_SUBJECT"
if $WEB_DEPLOYED; then
  log "web:     built on devbox (node $(node -v)) -> CT101:/var/www/splitty"
  log "         rollback target: CT101:/var/www/splitty.prev"
  log "         index.html mtime: $(ct_capture "$CT_WEB" stat -c '%y' /var/www/splitty/index.html)"
else
  log "web:     not deployed this run"
fi
if $API_DEPLOYED; then
  log "api:     deps installed on CT104 with /opt/node24/bin/npm -> /opt/splitty-api-node24"
  log "         rollback target: CT104:/opt/splitty-api-node24.prev"
  log "         service: $(ct_capture "$CT_API" systemctl is-active splitty-api.service)"
else
  log "api:     not deployed this run"
fi
log "live:    $PUBLIC_URL"
ok "DEPLOY OK"
