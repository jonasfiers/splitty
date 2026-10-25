#!/bin/bash
set -e

# One-off migration: settlements and balance transfers get a secondary label
# instead of a boolean property.
#
#   before: (:Expense {isSettlement: true})   (:Expense {isTransfer: true})
#   after:  (:Expense:Settlement)             (:Expense:Transfer)
#
# Ordinary expenses stay plain :Expense. Balances are untouched: they never
# looked at the flags, only at PAID / OWED_BY / BALANCE_IN.
#
# Run on CT104 from the checkout, as root:
#
#   /opt/splitty/scripts/migrate-expense-kind-labels.sh phase1
#   /opt/splitty/scripts/migrate-expense-kind-labels.sh check
#   /opt/splitty/scripts/migrate-expense-kind-labels.sh phase2
#
#   phase1  BEFORE (or together with) deploying the API that reads labels.
#           Adds the labels and leaves the old properties in place, so the
#           previous API keeps working if the deploy is rolled back.
#   check   Read-only. Counts per kind and consistency checks; every check
#           prints the value it found next to the value it should be.
#   phase2  Only AFTER the new API is deployed and verified. Re-applies phase 1
#           (catching anything an older API wrote in between) and removes the
#           old properties, in one transaction. After this, rolling back to an
#           API that reads the properties would count settlements and
#           transfers as spending and let them be edited.
#
# Every phase is idempotent: running it twice changes nothing the second time.
# See docs/deploying.md, "Expense kind labels".
#
# No index is needed: the queries test a label on a node they already hold
# (e:Settlement), which is a flag on the node record, and Neo4j keeps a label
# scan store for MATCH (:Settlement) without any CREATE INDEX. The repo creates
# no indexes or constraints anywhere.

PHASE="$1"
case "$PHASE" in
  phase1|phase2|check) ;;
  *) echo "usage: $0 phase1|check|phase2" >&2; exit 2 ;;
esac

export JAVA_HOME=${JAVA_HOME:-/opt/java21}
export PATH=$JAVA_HOME/bin:$PATH

# Same resolution as backup-neo4j.sh: follow what neo4j.service runs rather
# than a glob (/opt/neo4j is an old rollback copy). NEO4J_HOME and ENV_FILE may
# be set in the environment to point this at another install, e.g. a test one.
if [ -z "$NEO4J_HOME" ]; then
  NEO4J_EXEC=$(systemctl show neo4j --property=ExecStart --value 2>/dev/null \
    | tr ' ' '\n' | grep -m1 '^path=' | cut -d= -f2- || true)
  if [ -z "$NEO4J_EXEC" ]; then
    echo "migrate: FATAL: could not read ExecStart from neo4j.service (set NEO4J_HOME)" >&2
    exit 1
  fi
  NEO4J_HOME=$(dirname "$(dirname "$NEO4J_EXEC")")
fi
if [ ! -x "$NEO4J_HOME/bin/cypher-shell" ]; then
  echo "migrate: FATAL: no cypher-shell under NEO4J_HOME=$NEO4J_HOME" >&2
  exit 1
fi

# Read the values rather than sourcing .env (it is not safely source-able).
ENV_FILE=${ENV_FILE:-/opt/splitty/.env}
NEO4J_USER=$(grep -E '^NEO4J_USER=' "$ENV_FILE" | cut -d= -f2-)
NEO4J_PASSWORD=$(grep -E '^NEO4J_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
NEO4J_URI=$(grep -E '^NEO4J_URI=' "$ENV_FILE" | cut -d= -f2- || true)

# Password through the environment of the one child process, never as -p.
cypher() {
  NEO4J_PASSWORD="$NEO4J_PASSWORD" "$NEO4J_HOME/bin/cypher-shell" \
    -a "${NEO4J_URI:-bolt://localhost:7687}" -u "${NEO4J_USER:-neo4j}" --format plain
}

# --- phase 1: add the labels, keep the properties ------------------------------
PHASE1='
MATCH (e:Expense) WHERE e.isSettlement = true AND NOT e:Settlement
SET e:Settlement
RETURN count(e) AS settlementsLabelled;

MATCH (e:Expense) WHERE e.isTransfer = true AND NOT e:Transfer
SET e:Transfer
RETURN count(e) AS transfersLabelled;
'

# --- phase 2: drop the properties (phase 1 again first, same transaction) ------
PHASE2="
:begin
$PHASE1
MATCH (e:Expense) WHERE e.isSettlement IS NOT NULL OR e.isTransfer IS NOT NULL
REMOVE e.isSettlement, e.isTransfer
RETURN count(e) AS propertiesRemoved;
:commit
"

# --- checks (read-only) --------------------------------------------------------
# One row per check: what was found, and what it should be. "-" means any
# value is fine (a count to eyeball against what you expect).
CHECK='
MATCH (e:Expense) WITH count(e) AS found
RETURN "expenses (all kinds)" AS check, found, "-" AS expected
UNION ALL
MATCH (e:Expense) WHERE NOT e:Settlement AND NOT e:Transfer WITH count(e) AS found
RETURN "ordinary expenses" AS check, found, "-" AS expected
UNION ALL
MATCH (e:Expense:Settlement) WITH count(e) AS found
RETURN "settlements" AS check, found, "-" AS expected
UNION ALL
MATCH (e:Expense:Transfer) WITH count(e) AS found
RETURN "transfers (two nodes per transfer)" AS check, found, "-" AS expected
UNION ALL
MATCH (e:Expense:Settlement:Transfer) WITH count(e) AS found
RETURN "expenses with both labels" AS check, found, "0" AS expected
UNION ALL
MATCH (n) WHERE (n:Settlement OR n:Transfer) AND NOT n:Expense WITH count(n) AS found
RETURN "Settlement/Transfer label on a non-Expense" AS check, found, "0" AS expected
UNION ALL
MATCH (e:Expense) WHERE (e.isSettlement = true AND NOT e:Settlement) OR (e.isTransfer = true AND NOT e:Transfer)
WITH count(e) AS found
RETURN "flagged but not labelled (phase 1 missing)" AS check, found, "0" AS expected
UNION ALL
MATCH (n) WHERE n.isSettlement IS NOT NULL OR n.isTransfer IS NOT NULL WITH count(n) AS found
RETURN "nodes with a leftover property" AS check, found, "0 after phase 2" AS expected
UNION ALL
MATCH (t:Transfer)
OPTIONAL MATCH (t)-[:TRANSFER_PAIR]-(p)
WITH t, collect(p) AS partners
WITH count(CASE WHEN size(partners) <> 1 OR NOT partners[0]:Transfer THEN t END) AS found
RETURN "transfers without exactly one Transfer partner" AS check, found, "0" AS expected
UNION ALL
MATCH (a)-[:TRANSFER_PAIR]-(b) WHERE NOT a:Transfer WITH count(DISTINCT a) AS found
RETURN "TRANSFER_PAIR touching a non-Transfer" AS check, found, "0" AS expected;
'

echo "migrate: $(date +%F_%T) $PHASE using NEO4J_HOME=$NEO4J_HOME"
case "$PHASE" in
  phase1) printf '%s' "$PHASE1" | cypher ;;
  phase2) printf '%s' "$PHASE2" | cypher ;;
esac
printf '%s' "$CHECK" | cypher
