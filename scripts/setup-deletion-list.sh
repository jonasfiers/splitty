#!/bin/bash
# Splitty account deletion: set up the deletion list (see the repo's
# api/accountDeletion.js). Run on pve as root:
#
#   bash setup-deletion-list.sh qa      CT116     (copy it to pve first)
#   bash setup-deletion-list.sh prod    CT104
#
# What it does, for the chosen container:
#   1. /mnt/hdd/splitty-deletions/{prod,qa} on the host HDD, each with the
#      marker file the API checks for (both are created on every run).
#   2. Bind-mounts its folder at /var/lib/splitty-deletions (mp0). QA also
#      gets production's folder read-only at /var/lib/splitty-deletions-prod
#      (mp1). Bind mounts are never part of vzdump backups, which is the point.
#   3. Adds DELETION_LIST_FILE (QA also DELETION_LIST_READ_FILES) to
#      /etc/splitty-api.env, after a backup of that file, and a systemd
#      drop-in letting the API write to the folder (ProtectSystem=strict).
#   4. Reboots the container (a new mount point needs it), waits for the API
#      and prints its "Deletion list:" startup line.
# Safe to run twice: existing folders, mounts and env lines are left alone.
set -euo pipefail

BASE=/mnt/hdd/splitty-deletions
STAMP=$(date +%Y%m%d-%H%M%S)
MARKER=.splitty-deletion-list

case "${1:-}" in
  prod) CT=104 ;;
  qa)   CT=116 ;;
  *) echo "usage: $0 qa|prod" >&2; exit 2 ;;
esac

# Host uid/gid = 100000 + the 'splitty' user's uid/gid inside each container.
mkfolder() { # dir uid gid
  install -d -m 755 -o "$2" -g "$3" "$1"
  [ -e "$1/$MARKER" ] || { echo "created by setup-deletion-list.sh $STAMP" > "$1/$MARKER"; chmod 644 "$1/$MARKER"; }
}
install -d -m 755 -o root -g root "$BASE"
mkfolder "$BASE/prod" 100999 100995   # CT104 splitty = 999:995
mkfolder "$BASE/qa"   100997 100988   # CT116 splitty = 997:988
echo "== folders"; ls -la "$BASE/prod" "$BASE/qa"

CONF=/etc/pve/lxc/$CT.conf
cp "$CONF" "/root/$CT.conf.bak-$STAMP-deletion-list"
if ! grep -q "^mp0: $BASE/" "$CONF"; then
  grep -q '^mp0:' "$CONF" && { echo "mp0 is already used in $CONF: stopping" >&2; exit 1; }
  [ "$CT" = 104 ] && pct set 104 -mp0 "$BASE/prod,mp=/var/lib/splitty-deletions"
  [ "$CT" = 116 ] && pct set 116 -mp0 "$BASE/qa,mp=/var/lib/splitty-deletions"
fi
if [ "$CT" = 116 ] && ! grep -q "^mp1: $BASE/prod" "$CONF"; then
  grep -q '^mp1:' "$CONF" && { echo "mp1 is already used in $CONF: stopping" >&2; exit 1; }
  pct set 116 -mp1 "$BASE/prod,mp=/var/lib/splitty-deletions-prod,ro=1"
fi
echo "== $CONF mounts"; grep '^mp' "$CONF"

ENVLINES="DELETION_LIST_FILE=/var/lib/splitty-deletions/deleted-users.log"
[ "$CT" = 116 ] && ENVLINES="$ENVLINES
DELETION_LIST_READ_FILES=/var/lib/splitty-deletions-prod/deleted-users.log"
pct exec "$CT" -- sh -c "cp -p /etc/splitty-api.env /etc/splitty-api.env.bak-$STAMP-deletion-list"
printf '%s\n' "$ENVLINES" | while IFS= read -r line; do
  key=${line%%=*}
  pct exec "$CT" -- sh -c "grep -q '^$key=' /etc/splitty-api.env || echo '$line' >> /etc/splitty-api.env"
done
echo "== env"; pct exec "$CT" -- grep '^DELETION_LIST' /etc/splitty-api.env

# The unit has ProtectSystem=strict: the API may only write where listed.
pct exec "$CT" -- sh -c 'mkdir -p /etc/systemd/system/splitty-api.service.d && printf "%s\n" "# Account deletion list (host bind mount, see api/accountDeletion.js)." "[Service]" "ReadWritePaths=/var/lib/splitty-deletions" > /etc/systemd/system/splitty-api.service.d/deletion-list.conf && systemctl daemon-reload'
echo "== drop-in"; pct exec "$CT" -- cat /etc/systemd/system/splitty-api.service.d/deletion-list.conf

echo "== rebooting CT$CT"
pct reboot "$CT"
for i in $(seq 1 60); do
  if pct exec "$CT" -- curl -sf -o /dev/null http://127.0.0.1:3000/health 2>/dev/null; then break; fi
  sleep 2
done
pct exec "$CT" -- curl -s -o /dev/null -w "health: %{http_code}\n" http://127.0.0.1:3000/health || true
pct exec "$CT" -- journalctl -u splitty-api -b --no-pager -o cat | grep -E 'Deletion list|Re-applying account deletions failed' | tail -3
