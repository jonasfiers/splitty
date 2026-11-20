#!/usr/bin/env bash
# One-time (idempotent) setup on CT116 of what the API tests need
# (scripts/test-api.sh): their own Neo4j (neo4j-test.sh) as a systemd unit
# that is not started at boot, its password in /etc/splitty-api-test.env, and
# /opt/splitty-api-test for the code under test. Run from devbox with
#   scripts/test-api.sh --setup
set -euo pipefail
install -m 755 /root/neo4j-test.sh /usr/local/bin/splitty-test-neo4j
rm -f /root/neo4j-test.sh
cat > /etc/systemd/system/splitty-test-neo4j.service <<'UNIT'
[Unit]
Description=Neo4j for the Splitty API tests only (started and stopped by scripts/test-api.sh)
After=network.target

[Service]
ExecStart=/usr/local/bin/splitty-test-neo4j console
Restart=no
TimeoutStopSec=60
MemoryMax=800M
UNIT
systemctl daemon-reload
ENV=/etc/splitty-api-test.env
if [ ! -f "$ENV" ]; then
  pw="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' )"
  /usr/local/bin/splitty-test-neo4j set-password "$pw" >/dev/null
  umask 027
  printf 'NEO4J_URI=bolt://127.0.0.1:7697\nNEO4J_USER=neo4j\nNEO4J_PASSWORD=%s\n' "$pw" > "$ENV"
  chown root:splitty "$ENV"; chmod 640 "$ENV"
  echo "test database password set"
fi
install -d -o splitty -g splitty /opt/splitty-api-test
echo "CT116 ready for API tests"
