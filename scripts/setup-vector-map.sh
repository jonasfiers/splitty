#!/bin/bash
# Vector base map (web/src/components/TripMap/basemap.js): serve the Protomaps
# planet and its fonts and icons from the host HDD. Runs ON PVE, as root:
#
#   bash setup-vector-map.sh qa      CT116
#   bash setup-vector-map.sh prod    CT101
#
# What it does:
#   1. Bind-mounts /mnt/hdd/protomaps read-only at /srv/maps in the container
#      (first free mpN). LXC adds a bind mount to a running container live.
#   2. Adds two locations to the Splitty site, before `location /api/`:
#        = /maps/planet.pmtiles   the current build (a link, see below)
#        ^~ /maps/assets/          fonts and sprites
#      Nothing else in the folder (dated builds, a download in progress) is
#      served. nginx answers the browser's range requests itself.
#   3. nginx -t and reload; on a failed check the site file goes back.
# Safe to run twice.
#
# /mnt/hdd/protomaps/planet.pmtiles must be a relative link to the build in
# use, e.g. planet.pmtiles -> 20261106.pmtiles; a refresh downloads the new
# build next to it and moves the link (docs/deploying.md, "Vector base map").
set -euo pipefail

case "${1:-}" in
  prod) CT=101; SITE=/etc/nginx/sites-available/splitty.conf ;;
  qa)   CT=116; SITE=/etc/nginx/sites-available/splitty-qa.conf ;;
  *) echo "usage: $0 qa|prod" >&2; exit 2 ;;
esac
SRC=/mnt/hdd/protomaps
STAMP=$(date +%Y%m%d-%H%M%S)
[ -d "$SRC/assets/fonts" ] || { echo "no $SRC/assets/fonts: stopping" >&2; exit 1; }

CONF=/etc/pve/lxc/$CT.conf
if grep -q "^mp[0-9]*: $SRC," "$CONF"; then
  echo "== $SRC already mounted in CT$CT"
else
  cp "$CONF" "/root/$CT.conf.bak-$STAMP-maps"
  for n in $(seq 0 9); do grep -q "^mp$n:" "$CONF" || break; done
  pct set "$CT" "-mp$n" "$SRC,mp=/srv/maps,ro=1"
  echo "== mounted $SRC at /srv/maps (mp$n)"
fi
pct config "$CT" | grep "$SRC"
pct exec "$CT" -- ls /srv/maps/assets >/dev/null || { echo "/srv/maps not visible in CT$CT (mount pending? reboot it)" >&2; exit 1; }

pct exec "$CT" -- python3 - "$SITE" "$STAMP" <<'PY'
import shutil, subprocess, sys
site, stamp = sys.argv[1], sys.argv[2]
s = open(site).read()
if '/maps/planet.pmtiles' in s:
    print('== nginx locations already there'); sys.exit(0)
anchor = '    location /api/ {\n'
assert s.count(anchor) == 1, 'expected exactly one "location /api/ {"'
block = '''    # Vector base map (scripts/setup-vector-map.sh): the Protomaps planet and
    # its fonts and icons, from the host HDD (read-only bind mount). Only the
    # current build and the assets are served; ^~ keeps the .png rule away.
    location = /maps/planet.pmtiles {
        include snippets/splitty-security-headers.conf;
        alias /srv/maps/planet.pmtiles;
        default_type application/octet-stream;
        add_header Cache-Control "public, max-age=86400" always;
    }
    location ^~ /maps/assets/ {
        include snippets/splitty-security-headers.conf;
        alias /srv/maps/assets/;
        types { application/x-protobuf pbf; application/json json; image/png png; }
        default_type application/octet-stream;
        add_header Cache-Control "public, max-age=604800" always;
    }

'''
backup = f'{site}.bak-{stamp}-maps'
shutil.copy2(site, backup)
open(site, 'w').write(s.replace(anchor, block + anchor))
t = subprocess.run(['nginx', '-t'], capture_output=True, text=True)
print(t.stderr.strip())
if t.returncode != 0:
    shutil.copy2(backup, site); sys.exit('nginx -t failed: site file put back')
subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
print(f'== nginx reloaded; backup {backup}')
PY

# What the browser will get (planet.pmtiles only once the link exists).
NAME=$(pct exec "$CT" -- awk '$1 == "server_name" { gsub(";", "", $2); print $2; exit }' "$SITE")
if [ "$1" = prod ]; then URL="https://$NAME"; PORT=443; else URL="http://$NAME"; PORT=80; fi
for p in "/maps/assets/fonts/Noto%20Sans%20Regular/0-255.pbf" /maps/assets/sprites/v4/light.json /maps/planet.pmtiles /maps/20261106.pmtiles.part; do
  printf '%-52s ' "$p"
  pct exec "$CT" -- curl -s --resolve "$NAME:$PORT:127.0.0.1" -r 0-15 -o /dev/null -w '%{http_code} %{content_type} %{size_download}B\n' "$URL$p"
done
