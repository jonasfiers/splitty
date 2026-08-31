#!/bin/bash
set -e

# Nightly Neo4j backup for the native (non-Docker) deployment on CT104.
# Invoked by root's crontab: 0 3 * * * /opt/splitty/scripts/backup-neo4j.sh
#
# This file is the single canonical copy. Cron runs it from inside the git
# checkout at /opt/splitty so that `git status` there surfaces any future drift
# instead of hiding it: between the 2026-08-25 Docker->systemd migration and
# 2026-08-31 the live script lived untracked at /opt/splitty/backup-neo4j.sh
# while git still tracked the obsolete Docker-era version at this path.

BACKUP_DIR="/opt/backups/neo4j"
RETENTION_DAYS=14
TIMESTAMP=$(date +%F_%H%M)
export JAVA_HOME=/opt/java21
export PATH=/opt/java21/bin:$PATH

# --- resolve the live Neo4j installation ---------------------------------------
# Do NOT hardcode the versioned directory: the migration left this script
# pinned to /opt/neo4j-2026.07.1, so the next version bump would have tarred a
# stale (or absent) data directory without anyone noticing.
#
# Ask systemd which binary neo4j.service actually runs and work back to
# NEO4J_HOME from there. That deliberately follows the service rather than a
# glob, because /opt/neo4j is a retained 2026.04.0 rollback copy that a glob or
# a "first match" scan could easily pick instead. If it cannot be resolved we
# abort loudly rather than back up nothing.
NEO4J_EXEC=$(systemctl show neo4j --property=ExecStart --value 2>/dev/null \
  | tr ' ' '\n' | grep -m1 '^path=' | cut -d= -f2- || true)

if [ -z "$NEO4J_EXEC" ]; then
  echo "backup-neo4j: FATAL: could not read ExecStart from neo4j.service" >&2
  exit 1
fi

NEO4J_HOME=$(dirname "$(dirname "$NEO4J_EXEC")")

for required in "$NEO4J_HOME/data/databases" "$NEO4J_HOME/bin/cypher-shell"; do
  if [ ! -e "$required" ]; then
    echo "backup-neo4j: FATAL: resolved NEO4J_HOME=$NEO4J_HOME but $required is missing" >&2
    exit 1
  fi
done

echo "backup-neo4j: $(date +%F_%T) using NEO4J_HOME=$NEO4J_HOME"

mkdir -p "$BACKUP_DIR"

systemctl stop neo4j
tar czf "$BACKUP_DIR/neo4j-$TIMESTAMP.tar.gz" -C "$NEO4J_HOME/data" .
systemctl start neo4j

# --- credentials --------------------------------------------------------------
# Read the two values we need rather than sourcing .env: some values there are
# unquoted and contain shell metacharacters (EMAIL_FROM has a `<`), so sourcing
# it errors out and, under `set -e`, would abort the rest of this script.
NEO4J_USER=$(grep -E '^NEO4J_USER=' /opt/splitty/.env | cut -d= -f2-)
NEO4J_PASSWORD=$(grep -E '^NEO4J_PASSWORD=' /opt/splitty/.env | cut -d= -f2-)

cypher() {
  "$NEO4J_HOME/bin/cypher-shell" \
    -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" "$1" >/dev/null 2>&1
}

# --- wait until Neo4j can actually answer Cypher -------------------------------
# systemd reports the unit "active" as soon as the process starts, well before
# the store is recovered and Bolt is listening. Poll a trivial query, because
# that is what the app actually needs to succeed.
for _ in $(seq 1 60); do
  cypher "RETURN 1;" && break
  sleep 2
done

# --- warm the page cache and the query plan cache ------------------------------
# Restarting Neo4j empties its pagecache and resets the JVM, which is why the
# first visit of the day was slow. Scanning all nodes and relationships pulls
# the store back off disk; running the balance traversal compiles and caches the
# plan that every group page depends on.
cypher "MATCH (n) RETURN count(n);" || true
cypher "MATCH ()-[r]->() RETURN count(r);" || true
cypher "MATCH (payer:User)-[:PAID]->(e:Expense)-[o:OWED_BY]->(u:User) RETURN count(o);" || true

# --- nudge the API so its Bolt pool is rebuilt before a user arrives ------------
curl -fsS -m 10 http://127.0.0.1:3000/health >/dev/null 2>&1 || true

# delete backups older than RETENTION_DAYS
find "$BACKUP_DIR" -name "neo4j-*.tar.gz" -mtime +$RETENTION_DAYS -delete
