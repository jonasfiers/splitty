#!/usr/bin/env bash
# The API tests' own Neo4j on CT116 (2026-11-20), installed as
# /usr/local/bin/splitty-test-neo4j and run by splitty-test-neo4j.service.
# Separate from QA's database in every way: its own config, data directory
# (/var/lib/splitty-test-neo4j), ports (bolt 7697, http 7484, localhost only)
# and password. It runs only while tests run (not started at boot) and the
# tests wipe it, so it never holds anything worth keeping.
#
# Uses the newest Neo4j under /opt (the one QA's database was upgraded to),
# with QA's config as the base and the settings below on top.
set -euo pipefail
NEO4J_HOME="$(ls -d /opt/neo4j-2* | sort -V | tail -1)"
CONF_DIR=/etc/splitty-test-neo4j
DATA=/var/lib/splitty-test-neo4j
OVERRIDES=(
  "server.directories.data=$DATA/data"
  "server.directories.transaction.logs.root=$DATA/data/transactions"
  "server.directories.logs=$DATA/logs"
  "server.directories.run=$DATA/run"
  "server.directories.import=$DATA/import"
  "server.directories.plugins=$NEO4J_HOME/plugins"
  "server.default_listen_address=127.0.0.1"
  "server.bolt.listen_address=127.0.0.1:7697"
  "server.http.listen_address=127.0.0.1:7484"
  "server.https.enabled=false"
  "server.routing.listen_address=127.0.0.1:7698"
  "server.memory.heap.initial_size=192m"
  "server.memory.heap.max_size=256m"
  "server.memory.pagecache.size=32m"
  "db.tx_log.rotation.retention_policy=2 files"
  "dbms.usage_report.enabled=false"
)
install -d -m 755 "$CONF_DIR"
keys="$(printf '%s\n' "${OVERRIDES[@]}" | cut -d= -f1 | sed 's/\./\\./g' | paste -sd'|')"
{
  grep -vE "^(${keys})=" "$NEO4J_HOME/conf/neo4j.conf" | grep -v 'AlwaysPreTouch'
  printf '%s\n' "${OVERRIDES[@]}"
} > "$CONF_DIR/neo4j.conf"
install -d -o neo4j -g neo4j "$DATA" "$DATA/data" "$DATA/logs" "$DATA/run" "$DATA/import"
export NEO4J_CONF="$CONF_DIR" JAVA_HOME=/opt/java21 PATH=/opt/java21/bin:/usr/bin:/bin
case "${1:-console}" in
  console) exec /usr/sbin/runuser -u neo4j -- env NEO4J_CONF="$CONF_DIR" JAVA_HOME=/opt/java21 PATH="$PATH" "$NEO4J_HOME/bin/neo4j" console ;;
  set-password) exec /usr/sbin/runuser -u neo4j -- env NEO4J_CONF="$CONF_DIR" JAVA_HOME=/opt/java21 PATH="$PATH" "$NEO4J_HOME/bin/neo4j-admin" dbms set-initial-password "$2" ;;
  *) echo "usage: $0 [console|set-password <pw>]" >&2; exit 2 ;;
esac
