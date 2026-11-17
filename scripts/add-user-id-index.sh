#!/usr/bin/env bash
# Index on User.id (every request's session check and most queries match on it).
#   pct exec <ct> -- bash -s < scripts/add-user-id-index.sh
set -euo pipefail
export JAVA_HOME=/opt/java21 PATH=/opt/java21/bin:$PATH
EXEC=$(systemctl show neo4j --property=ExecStart --value | sed -n 's/.*path=\([^ ;]*\).*/\1/p')
NEO4J_HOME=$(dirname "$(dirname "$EXEC")")
val() { sed -n "s/^$1=//p" /etc/splitty-api.env | tail -1 | sed 's/^["'"'"']//;s/["'"'"']$//'; }
export NEO4J_USERNAME=$(val NEO4J_USER) NEO4J_PASSWORD=$(val NEO4J_PASSWORD)
"$NEO4J_HOME/bin/cypher-shell" -a "$(val NEO4J_URI)" --format plain <<'Q'
CREATE INDEX user_id IF NOT EXISTS FOR (u:User) ON (u.id);
SHOW INDEXES YIELD name, labelsOrTypes, properties, state WHERE name = 'user_id' RETURN name, properties, state;
Q
