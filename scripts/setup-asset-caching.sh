#!/bin/bash
# Let browsers keep Splitty's build files. Runs INSIDE the web container
# (CT101 prod, CT116 QA), as root:  bash setup-asset-caching.sh
#
# Everything under /assets/ has a content hash in its name (a new content is
# a new name), so it can be kept for a year without asking again. Without
# this, every load the service worker doesn't answer (a hard refresh, a first
# visit) asked the server about each file again (a 304 each), a round trip per
# file over a slow link. index.html, sw.js and the icons keep their own rules.
#
# Idempotent; backs the site config up first and puts it back if nginx -t fails.
set -euo pipefail
LINK=$(grep -l -E 'server_name [a-z0-9.-]*splitty' /etc/nginx/sites-enabled/* | head -1)
[ -n "$LINK" ] || { echo "no Splitty site found"; exit 1; }
# The real file (sites-enabled holds a link): the backup goes next to it, in
# sites-available, which nginx doesn't load. In sites-enabled nginx would read
# the backup as a second copy of the site and refuse to start.
CONF=$(readlink -f "$LINK")
MARK='# splitty-asset-caching'
if grep -q "$MARK" "$CONF"; then echo "already set up in $CONF"; exit 0; fi
# Always in sites-available (not loaded), also when the site file itself is
# a plain file in sites-enabled.
BACKUP="/etc/nginx/sites-available/$(basename "$CONF").bak-$(date +%Y%m%d-%H%M%S)-asset-caching"
cp "$CONF" "$BACKUP"
# Into the server block that serves the app: before its "location / {" with
# try_files (not the http -> https redirect one).
python3 - "$CONF" "$MARK" <<'PY'
import re, sys
path, mark = sys.argv[1], sys.argv[2]
s = open(path).read()
m = None
for x in re.finditer(r'^(\s*)location / \{\s*\n\s*try_files', s, re.M):
    m = x
if not m:
    sys.exit('no "location / { try_files" block found')
ind = m.group(1)
block = (f"{ind}{mark}\n"
         f"{ind}location ^~ /assets/ {{\n"
         f"{ind}    include snippets/splitty-security-headers.conf;\n"
         f"{ind}    add_header Cache-Control \"public, max-age=31536000, immutable\" always;\n"
         f"{ind}    try_files $uri =404;\n"
         f"{ind}}}\n")
open(path, 'w').write(s[:m.start()] + block + s[m.start():])
PY
if ! nginx -t 2>/dev/null; then
  cp "$BACKUP" "$CONF"; echo "nginx -t failed; $CONF restored from $BACKUP"; nginx -t; exit 1
fi
nginx -s reload
sleep 1
JS=$(ls /var/www/splitty/assets | grep -E '\.js$' | head -1)
HOST=$(grep -h -o -E 'server_name [a-z0-9.-]+' "$CONF" | awk '{print $2}' | grep -m1 splitty)
echo "== /assets/$JS:"
curl -skI -L --resolve "$HOST:80:127.0.0.1" --resolve "$HOST:443:127.0.0.1" "http://$HOST/assets/$JS" \
  | grep -i -E '^(HTTP|cache-control|content-security-policy)' | cut -c1-90
