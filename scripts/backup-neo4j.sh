#!/bin/bash
set -e

BACKUP_DIR="/opt/backups/neo4j"
RETENTION_DAYS=14
TIMESTAMP=$(date +%F_%H%M)

mkdir -p "$BACKUP_DIR"

cd /opt/splitty
docker compose stop neo4j
docker run --rm -v splitty_neo4j_data:/data -v "$BACKUP_DIR":/backup alpine \
  tar czf /backup/neo4j-$TIMESTAMP.tar.gz -C /data .
docker compose start neo4j

# --- credentials --------------------------------------------------------------
# Read the two values we need rather than sourcing .env: some values there are
# unquoted and contain shell metacharacters (EMAIL_FROM has a `<`), so sourcing
# it errors out and, under `set -e`, would abort the rest of this script.
NEO4J_USER=$(grep -E '^NEO4J_USER=' .env | cut -d= -f2-)
NEO4J_PASSWORD=$(grep -E '^NEO4J_PASSWORD=' .env | cut -d= -f2-)

cypher() {
  docker exec splitty_neo4j cypher-shell \
    -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" "$1" >/dev/null 2>&1
}

# --- wait until Neo4j can actually answer Cypher -------------------------------
# `docker compose start` returns as soon as the container is up, well before the
# store is recovered and Bolt is listening. Poll a trivial query, because that is
# what the app actually needs to succeed.
for _ in $(seq 1 60); do
  cypher "RETURN 1;" && break
  sleep 2
done

# --- warm the page cache and the query plan cache ------------------------------
# Restarting Neo4j empties its 256MB page cache and resets the JVM, which is why
# the first visit of the day was slow. Scanning all nodes and relationships pulls
# the store back off disk; running the balance traversal compiles and caches the
# plan that every group page depends on.
# (apoc.warmup.run is NOT available on this version - it no longer ships - so the
# scans below are the replacement, not a nice-to-have.)
cypher "MATCH (n) RETURN count(n);" || true
cypher "MATCH ()-[r]->() RETURN count(r);" || true
cypher "MATCH (payer:User)-[:PAID]->(e:Expense)-[o:OWED_BY]->(u:User) RETURN count(o);" || true

# --- nudge the API so its Bolt pool is rebuilt before a user arrives ------------
curl -fsS -m 10 http://127.0.0.1:3000/health >/dev/null 2>&1 || true

# delete backups older than RETENTION_DAYS
find "$BACKUP_DIR" -name "neo4j-*.tar.gz" -mtime +$RETENTION_DAYS -delete
