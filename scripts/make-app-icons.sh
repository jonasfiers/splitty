#!/bin/sh
# Builds the square, opaque app icons from web/public/cat-avatar.svg:
#   apple-touch-icon.png (180)  - iOS home screen. iOS fills transparency with
#                                 white, so the round cat-icon-*.png showed as a
#                                 cream circle in a white square.
#   cat-icon-maskable-512.png   - Android adaptive icon; the cat stays inside the
#                                 central 80% safe zone.
# Needs rsvg-convert (librsvg2-bin). Run from the repo root.
set -eu
pub=web/public
body=$(sed -e '1d' -e '$d' -e '/<circle cx="24" cy="24" r="24"/d' "$pub/cat-avatar.svg")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

square() { # $1 scale, $2 size, $3 output
  printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#F5EDE0"/><g transform="translate(24 25) scale(%s) translate(-24 -24)">%s</g></svg>\n' "$1" "$body" > "$tmp/icon.svg"
  rsvg-convert -b '#F5EDE0' -w "$2" -h "$2" "$tmp/icon.svg" -o "$3"
}

square 0.82 180 "$pub/apple-touch-icon.png"
square 0.78 512 "$pub/cat-icon-maskable-512.png"
echo "wrote $pub/apple-touch-icon.png $pub/cat-icon-maskable-512.png"
