#!/bin/bash
# Security headers, including the Content Security Policy, for the Splitty
# site. Runs INSIDE the nginx container, as root:
#
#   bash setup-security-headers.sh prod     CT101
#   bash setup-security-headers.sh qa       CT116
#
# nginx drops every add_header of an enclosing level as soon as a location
# sets one of its own. The site set its security headers at server level and
# Cache-Control in several locations, so the app's own page (index.html) got
# none of them. This puts them in one snippet, included at server level AND in
# every location with its own add_header:
#   1. writes /etc/nginx/snippets/splitty-security-headers.conf;
#   2. in the site file, replaces the server-level X-Frame-Options,
#      X-Content-Type-Options, Referrer-Policy (and on QA X-Robots-Tag) lines
#      with the include, and adds the include to each such location;
#   3. nginx -t, reload; on a failed check both files go back as they were.
# Safe to run twice: with the include already there, only the snippet is
# rewritten (that is how to change the policy later).
set -euo pipefail

STAMP=$(date +%Y%m%d-%H%M%S)
case "${1:-}" in
  prod) SITE=/etc/nginx/sites-available/splitty.conf; ROBOTS='' ;;
  qa)   SITE=/etc/nginx/sites-available/splitty-qa.conf; ROBOTS='add_header X-Robots-Tag "noindex" always;' ;;
  *) echo "usage: $0 prod|qa" >&2; exit 2 ;;
esac
SNIPPET=/etc/nginx/snippets/splitty-security-headers.conf
[ -f "$SITE" ] || { echo "no $SITE" >&2; exit 1; }

# Only what the web app loads: everything from Splitty itself. Inline styles
# are allowed because the emoji picker (emoji-mart) inserts a <style> element
# and the map code sets style attributes; scripts stay strictly 'self', which
# is what blocks injected code. Fonts and a few images are data: URLs in the
# built CSS/JS. Violations are reported to the API (api/routes/cspReport.js).
CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'; report-uri /api/csp-report"

NEW_SNIPPET="# Splitty's security headers (scripts/setup-security-headers.sh). Included at
# server level and in every location with its own add_header: nginx drops an
# enclosing level's add_header lines in a location that sets any.
add_header X-Frame-Options \"SAMEORIGIN\" always;
add_header X-Content-Type-Options \"nosniff\" always;
add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;
add_header Content-Security-Policy \"$CSP\" always;
$ROBOTS"

cp -p "$SITE" "$SITE.bak-$STAMP-security-headers"
[ -f "$SNIPPET" ] && cp -p "$SNIPPET" "$SNIPPET.bak-$STAMP"
printf '%s\n' "$NEW_SNIPPET" > "$SNIPPET"

if grep -q 'splitty-security-headers.conf' "$SITE"; then
  echo "$SITE already includes the snippet: only the snippet was rewritten"
else
  python3 - "$SITE" <<'PY'
import re, sys
path = sys.argv[1]
lines = open(path).read().split('\n')
INC = 'include snippets/splitty-security-headers.conf;'
SERVER_LEVEL = re.compile(r'^    add_header (X-Frame-Options|X-Content-Type-Options|Referrer-Policy|X-Robots-Tag) ')
out, i, replaced, locations = [], 0, 0, 0
while i < len(lines):
    line = lines[i]
    if SERVER_LEVEL.match(line):
        if replaced == 0:
            out.append('    ' + INC)
        replaced += 1
        i += 1
        continue
    # A multi-line location block at server level: include the snippet in it
    # if it sets any header itself.
    if re.match(r'^    location .*\{\s*$', line):
        j = i + 1
        while j < len(lines) and lines[j] != '    }':
            j += 1
        block = lines[i + 1:j]
        out.append(line)
        if any(l.lstrip().startswith('add_header ') for l in block):
            out.append('        ' + INC)
            locations += 1
        out.extend(block)
        i = j
        continue
    out.append(line)
    i += 1
if replaced == 0:
    sys.exit('no server-level security add_header lines found: stopping')
open(path, 'w').write('\n'.join(out))
print(f'replaced {replaced} server-level header line(s); include added to {locations} location(s)')
PY
fi

if ! nginx -t 2>&1; then
  echo "nginx -t failed: putting the backups back" >&2
  cp -p "$SITE.bak-$STAMP-security-headers" "$SITE"
  if [ -f "$SNIPPET.bak-$STAMP" ]; then cp -p "$SNIPPET.bak-$STAMP" "$SNIPPET"; else rm -f "$SNIPPET"; fi
  exit 1
fi
systemctl reload nginx
echo "== security headers on; backup: $SITE.bak-$STAMP-security-headers"
echo "== include lines:"; grep -n 'splitty-security-headers' "$SITE"

# What the app's page and a static asset now send.
sleep 1
NAME=$(awk '$1 == "server_name" { gsub(";", "", $2); print $2; exit }' "$SITE")
if [ "$1" = prod ]; then BASE="https://$NAME"; RESOLVE=(--resolve "$NAME:443:127.0.0.1")
else BASE="http://$NAME"; RESOLVE=(--resolve "$NAME:80:127.0.0.1"); fi
for p in / /trips /sw.js /manifest.webmanifest; do
  echo "-- $p"
  curl -s "${RESOLVE[@]}" -o /dev/null -D - "$BASE$p" | tr -d '\r' \
    | grep -iE '^HTTP|^x-frame|^x-content|^referrer|^x-robots|^content-security' | sed 's/\(content-security-policy: .\{50\}\).*/\1.../I'
done
