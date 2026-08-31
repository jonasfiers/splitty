#!/usr/bin/env bash
#
# Splitty web publish — runs INSIDE CT101 (npm, 192.168.0.241).
#
# Pushed here by scripts/deploy.sh on devbox; not meant to be run by hand.
# CT101 has no Node and never builds anything: it only receives a tarball of an
# already-built Vite dist and swaps it into place.
#
# The publish is atomic in the way that matters: the live document root is
# never partially written. The new build is unpacked into a staging directory
# on the same filesystem and validated, and only then does the live directory
# change identity via two rename(2) calls. nginx resolves `root /var/www/splitty`
# per request, so the exposure window is one rename, not a file-by-file copy.
#
# EXIT CODES (deploy.sh depends on these to decide whether to roll back)
#   0   success
#   10  failed BEFORE the swap — the live directory was never touched
#   20  rollback itself failed
#
# Usage:
#   deploy-ct101-web.sh publish <tarball>
#   deploy-ct101-web.sh rollback
#   deploy-ct101-web.sh state

set -Eeuo pipefail

WEB_ROOT="/var/www/splitty"
PREV="${WEB_ROOT}.prev"
FAILED="${WEB_ROOT}.failed"

log() { printf '    [ct101] %s\n' "$*"; }
die() { printf '    [ct101] ERROR: %s\n' "$*" >&2; exit 10; }

trap 'printf "    [ct101] command failed (rc=$?)\n" >&2; exit 10' ERR

cmd="${1:-}"

case "$cmd" in
  publish)
    tarball="${2:-}"
    [ -n "$tarball" ] || die "publish needs a tarball path"
    [ -f "$tarball" ] || die "tarball not found: $tarball"

    # Staging sits beside the live root so the later mv is a same-filesystem
    # rename (atomic), not a copy.
    staging="$(mktemp -d "${WEB_ROOT}.staging.XXXXXX")"
    log "unpacking $(basename "$tarball") into $staging"
    tar -xzf "$tarball" -C "$staging"

    # Refuse to publish a payload that is obviously not a Splitty build.
    [ -f "$staging/index.html" ] || die "payload has no index.html — refusing to publish"
    [ -d "$staging/assets" ]     || die "payload has no assets/ — refusing to publish"
    log "payload validated: $(find "$staging" -type f | wc -l) files"

    chown -R root:root "$staging"
    chmod -R u=rwX,go=rX "$staging"

    # Retain exactly one previous version as the rollback target. The older
    # .prev is only discarded once the new build is live.
    rm -rf "${PREV}.old"
    if [ -d "$PREV" ]; then mv "$PREV" "${PREV}.old"; fi

    if [ -d "$WEB_ROOT" ]; then
      mv "$WEB_ROOT" "$PREV"      # <- rollback target captured here
      mv "$staging" "$WEB_ROOT"   # <- live again; window is a single rename
      log "swapped in; previous build retained at $PREV"
    else
      mv "$staging" "$WEB_ROOT"
      log "no previous $WEB_ROOT existed; published fresh (no rollback target)"
    fi

    rm -rf "${PREV}.old"
    rm -f "$tarball"
    log "index.html mtime is now $(stat -c '%y' "${WEB_ROOT}/index.html")"
    ;;

  rollback)
    trap - ERR
    if [ ! -d "$PREV" ]; then
      printf '    [ct101] ERROR: no %s — cannot roll back the web tier\n' "$PREV" >&2
      exit 20
    fi
    rm -rf "$FAILED"
    if [ -d "$WEB_ROOT" ]; then mv "$WEB_ROOT" "$FAILED"; fi
    mv "$PREV" "$WEB_ROOT"
    log "rolled back; the rejected build is kept at $FAILED for inspection"
    log "index.html mtime is now $(stat -c '%y' "${WEB_ROOT}/index.html")"
    ;;

  state)
    trap - ERR
    for d in "$WEB_ROOT" "$PREV" "$FAILED"; do
      if [ -d "$d" ]; then
        printf '    [ct101] %-30s %s  (%s files)\n' "$d" \
          "$(stat -c '%y' "$d" | cut -d. -f1)" "$(find "$d" -type f | wc -l)"
      else
        printf '    [ct101] %-30s absent\n' "$d"
      fi
    done
    if [ -f "${WEB_ROOT}/index.html" ]; then
      printf '    [ct101] %-30s %s\n' "index.html mtime" "$(stat -c '%y' "${WEB_ROOT}/index.html" | cut -d. -f1)"
      printf '    [ct101] %-30s %s\n' "index.html sha256" "$(sha256sum "${WEB_ROOT}/index.html" | cut -c1-16)"
    fi
    ;;

  *)
    die "unknown command: ${cmd:-<none>} (expected publish|rollback|state)"
    ;;
esac
