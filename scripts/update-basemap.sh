#!/bin/bash
# Download a Protomaps planet build for the vector base map and switch to it.
# Runs ON PVE, as root; takes hours, so start it as a service:
#
#   systemd-run --unit=update-basemap bash /root/update-basemap.sh [YYYYMMDD]
#   journalctl -u update-basemap -f
#
# Without a date it takes the newest build. Steps:
#   1. download https://build.protomaps.com/<date>.pmtiles to
#      /mnt/hdd/protomaps/<date>.pmtiles.part (resumable, 15 MB/s cap, retries);
#   2. check it against the md5 in Protomaps' build list;
#   3. point the planet.pmtiles link at it (one rename: the map never sees a
#      half-written file; browsers notice the new ETag and reload the index);
#   4. delete older builds and the sparse test file, if any.
# On any failure the current map is left alone. Needs about 140 GB free on
# the HDD on top of the build in use.
set -uo pipefail

DIR=/mnt/hdd/protomaps
UA="Splitty self-hosted basemap (https://splitty.jonasfiers.eu)"
mkdir -p "$DIR"

LIST=$(curl -sS -f -A "$UA" https://build-metadata.protomaps.dev/builds.json) || { echo "cannot read the build list"; exit 1; }
read -r BUILD SIZE MD5_B64 < <(printf '%s' "$LIST" | python3 -c '
import json, sys
builds = json.load(sys.stdin)
want = sys.argv[1] if len(sys.argv) > 1 else ""
b = [x for x in builds if x["key"] == want + ".pmtiles"] if want else builds[-1:]
if not b: sys.exit("no such build: " + want)
print(b[0]["key"].removesuffix(".pmtiles"), b[0]["size"], b[0]["md5sum"])' "${1:-}") || exit 1
echo "build $BUILD, $((SIZE / 1000000000)) GB"

FINAL=$DIR/$BUILD.pmtiles; PART=$FINAL.part
if [ ! -f "$FINAL" ]; then
  FREE=$(df --output=avail -B1 "$DIR" | tail -1)
  HAVE=$(stat -c %s "$PART" 2>/dev/null || echo 0)
  [ "$FREE" -gt $((SIZE - HAVE + 10000000000)) ] || { echo "not enough space on the HDD"; exit 1; }
  for attempt in $(seq 1 50); do
    curl -sS -f -L -C - --limit-rate 15M --retry 5 --retry-delay 30 -A "$UA" \
      -o "$PART" "https://build.protomaps.com/$BUILD.pmtiles" && break
    echo "attempt $attempt failed, $(stat -c %s "$PART" 2>/dev/null) bytes so far; retrying in 60 s"
    sleep 60
  done
  [ "$(stat -c %s "$PART")" = "$SIZE" ] || { echo "download incomplete"; exit 1; }
  echo "downloaded; checking md5"
  GOT=$(md5sum "$PART" | cut -d' ' -f1)
  WANT=$(printf %s "$MD5_B64" | base64 -d | od -An -tx1 | tr -d ' \n')
  [ "$GOT" = "$WANT" ] || { echo "MD5 MISMATCH (got $GOT, want $WANT); $PART left for a look"; exit 1; }
  mv "$PART" "$FINAL"
fi

ln -sfn "$BUILD.pmtiles" "$DIR/planet.pmtiles.new" && mv -T "$DIR/planet.pmtiles.new" "$DIR/planet.pmtiles"
echo "planet.pmtiles -> $(readlink "$DIR/planet.pmtiles")"
for old in "$DIR"/*.pmtiles "$DIR"/*.pmtiles.part; do
  [ -e "$old" ] || continue
  case "$(basename "$old")" in planet.pmtiles|"$BUILD.pmtiles") continue ;; esac
  rm -f "$old" && echo "removed $(basename "$old")"
done
