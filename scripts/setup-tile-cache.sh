#!/bin/bash
# Map tile cache: nginx keeps copies of the OpenStreetMap tiles the API fetches
# (api/tileProxy.js). Runs INSIDE the nginx container, as root:
#
#   bash setup-tile-cache.sh prod    CT101, in front of CT104, cache 1 GB
#   bash setup-tile-cache.sh qa      CT116, in front of its own API, 200 MB
#
# What it does:
#   1. Adds a cache zone and a rate limit for tiles to the top of the Splitty
#      site file (http level, like the existing limit_req_zone).
#   2. Adds `location ^~ /api/tiles/` before `location /api/`: cached, with
#      its own limit, since one map view is dozens of tiles and the general
#      /api/ limit (10 r/s on production) would refuse most of them. The ^~
#      also keeps the site's `\.png$` static-file rule from catching tiles.
#   3. Checks the config with nginx -t and reloads; on a failed check it puts
#      the backup back and changes nothing.
# Safe to run twice: a file that already has the cache is left alone.
set -euo pipefail

STAMP=$(date +%Y%m%d-%H%M%S)
case "${1:-}" in
  prod) SITE=/etc/nginx/sites-available/splitty.conf
        UPSTREAM=http://192.168.0.244:3000/tiles/
        PROTO='$scheme'
        SIZE=1g ;;
  qa)   SITE=/etc/nginx/sites-available/splitty-qa.conf
        UPSTREAM=http://127.0.0.1:3000/tiles/
        PROTO=https
        SIZE=200m ;;
  *) echo "usage: $0 prod|qa" >&2; exit 2 ;;
esac
CACHE=/var/cache/nginx/splitty-tiles

[ -f "$SITE" ] || { echo "no $SITE" >&2; exit 1; }
if grep -q 'splitty_tiles' "$SITE"; then
  echo "$SITE already has the tile cache: nothing to do"
  exit 0
fi
[ "$(grep -c '^    location /api/ {$' "$SITE")" = 1 ] || { echo "expected exactly one '    location /api/ {' in $SITE: stopping" >&2; exit 1; }

NGINX_USER=$(awk '$1 == "user" { gsub(";", "", $2); print $2; exit }' /etc/nginx/nginx.conf)
NGINX_USER=${NGINX_USER:-www-data}
install -d -m 755 /var/cache/nginx
install -d -m 700 -o "$NGINX_USER" -g "$NGINX_USER" "$CACHE"

BACKUP="$SITE.bak-$STAMP-tile-cache"
cp -p "$SITE" "$BACKUP"

TOP="# Map tile cache (scripts/setup-tile-cache.sh): copies of the OpenStreetMap
# tiles the API fetches, kept as long as OpenStreetMap's headers allow and
# revalidated after; the least recently used go first once $SIZE is reached.
proxy_cache_path $CACHE levels=1:2 keys_zone=splitty_tiles:10m max_size=$SIZE inactive=30d use_temp_path=off;
limit_req_zone \$binary_remote_addr zone=splitty_tiles_limit:10m rate=50r/s;
"

LOCATION="    # Map tiles (api/tileProxy.js), cached here: the browser never contacts
    # OpenStreetMap. ^~ keeps the .png static-file rule from catching them.
    location ^~ /api/tiles/ {
        limit_req zone=splitty_tiles_limit burst=200 nodelay;
        limit_req_status 429;
        proxy_pass $UPSTREAM;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $PROTO;
        proxy_cache splitty_tiles;
        proxy_cache_key \$uri;
        proxy_cache_revalidate on;
        proxy_cache_lock on;
        proxy_cache_background_update on;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        add_header X-Cache-Status \$upstream_cache_status always;
    }
"

TMP=$(mktemp)
{
  printf '%s\n' "$TOP"
  awk -v loc="$LOCATION" '$0 == "    location /api/ {" { printf "%s\n", loc } { print }' "$SITE"
} > "$TMP"
cat "$TMP" > "$SITE"   # keeps the file's owner, mode and the sites-enabled link
rm -f "$TMP"

if ! nginx -t 2>&1; then
  echo "nginx -t failed: putting $BACKUP back" >&2
  cp -p "$BACKUP" "$SITE"
  exit 1
fi
systemctl reload nginx
echo "== tile cache on ($SIZE at $CACHE); backup: $BACKUP"

# A quick check: the second request for the same tile should be a HIT.
sleep 1
NAME=$(awk '$1 == "server_name" { gsub(";", "", $2); print $2; exit }' "$SITE")
if [ "$1" = prod ]; then URL="https://$NAME/api/tiles/3/4/2.png"; RESOLVE=(--resolve "$NAME:443:127.0.0.1")
else URL="http://$NAME/api/tiles/3/4/2.png"; RESOLVE=(--resolve "$NAME:80:127.0.0.1"); fi
for i in 1 2; do
  curl -s "${RESOLVE[@]}" -o /dev/null -D - "$URL" | grep -iE '^HTTP|^x-cache-status' | tr -d '\r' | paste -sd' '
done
