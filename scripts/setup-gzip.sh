#!/bin/bash
# Compress text responses in nginx. Runs INSIDE the web container (CT101 prod,
# CT116 QA), as root:  bash setup-gzip.sh
#
# Debian's nginx.conf has "gzip on" but only for HTML (the default
# gzip_types), so the app's JavaScript and CSS went out uncompressed: about
# three times the bytes on every first visit and after every deploy. Map tiles
# (.pmtiles, .png) are compressed already and are left out.
set -euo pipefail
CONF=/etc/nginx/conf.d/splitty-gzip.conf
cat > "$CONF" <<'NGINX'
# Written by Splitty's scripts/setup-gzip.sh.
gzip_vary on;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_proxied any;
gzip_types text/css application/javascript text/javascript application/json application/manifest+json image/svg+xml text/plain application/x-protobuf;
NGINX
if ! nginx -t 2>/dev/null; then
  rm -f "$CONF"; echo "nginx -t failed; $CONF removed, nothing changed"; nginx -t; exit 1
fi
nginx -s reload
sleep 1
JS=$(ls /var/www/splitty/assets | grep -E '^index-.*\.js$' | head -1)
plain=$(curl -s -o /dev/null -w '%{size_download}' "http://127.0.0.1/assets/$JS")
packed=$(curl -s -o /dev/null -H 'Accept-Encoding: gzip' -w '%{size_download}' "http://127.0.0.1/assets/$JS")
echo "== $JS: $plain bytes plain, $packed with gzip"
