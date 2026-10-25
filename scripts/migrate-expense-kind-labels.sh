#!/bin/bash
set -eo pipefail

# One-off migration: settlements and balance transfers get a secondary label
# instead of a boolean property.
#
#   before: (:Expense {isSettlement: true})   (:Expense {isTransfer: true})
#   after:  (:Expense:Settlement)             (:Expense:Transfer)
#
# Ordinary expenses stay plain :Expense. Balances are untouched: they never
# looked at the flags, only at PAID / OWED_BY / BALANCE_IN.
#
# Self-contained: it needs no checkout, only the Neo4j install behind
# neo4j.service and the API's env file. Copy it onto the container and run it
# there as root (CT104 production, CT116 QA):
#
#   bash mekl.sh phase1 | phase2 | rollback | check [--strict]
#
#   phase1    BEFORE deploying the API that reads labels, and once more right
#             after it. Adds the labels and leaves the old properties in
#             place, so the previous API keeps working.
#   phase2    Only AFTER the new API is deployed and verified. Re-applies
#             phase 1 (catching anything an older API wrote in between) and
#             removes the old properties, in one transaction.
#   rollback  Before going back to an API that reads the properties: sets
#             isSettlement / isTransfer again from the labels (labels stay).
#             Needed after any deploy of the new API, even before phase 2,
#             because the new API writes labels only.
#   check     Read-only. Counts per kind and consistency checks. Exits 1 if a
#             must-be-zero check is not zero; with --strict, leftover
#             properties count as a failure too (the state after phase 2).
#
# Every phase ends with the check (phase2 with the strict one) and exits with
# its status. Every phase is idempotent. See docs/deploying.md, "Expense kind
# labels".
#
# No index is needed: the queries test a label on a node they already hold
# (e:Settlement), which is a flag on the node record, and Neo4j keeps a label
# scan store for MATCH (:Settlement) without any CREATE INDEX. The repo creates
# no indexes or constraints anywhere.

PHASE="$1"
STRICT=false
case "$PHASE" in
  phase1|rollback) ;;
  phase2) STRICT=true ;;
  check)
    case "$2" in
      "") ;;
      --strict) STRICT=true ;;
      *) echo "usage: $0 phase1|phase2|rollback|check [--strict]" >&2; exit 2 ;;
    esac ;;
  *) echo "usage: $0 phase1|phase2|rollback|check [--strict]" >&2; exit 2 ;;
esac

fail() { echo "migrate: FATAL: $*" >&2; exit 1; }

# neo4j.service runs with JAVA_HOME=/opt/java21 on CT104 and CT116.
if [ -z "$JAVA_HOME" ] && [ -d /opt/java21 ]; then JAVA_HOME=/opt/java21; fi
if [ -n "$JAVA_HOME" ]; then export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"; fi

# Same resolution as backup-neo4j.sh: follow what neo4j.service runs rather
# than a glob (/opt/neo4j on CT104 is an old rollback copy). NEO4J_HOME may be
# set in the environment to point this at another install, e.g. a test one.
if [ -z "$NEO4J_HOME" ]; then
  NEO4J_EXEC=$(systemctl show neo4j --property=ExecStart --value 2>/dev/null \
    | tr ' ' '\n' | grep -m1 '^path=' | cut -d= -f2- || true)
  [ -n "$NEO4J_EXEC" ] || fail "could not read ExecStart from neo4j.service (set NEO4J_HOME)"
  NEO4J_HOME=$(dirname "$(dirname "$NEO4J_EXEC")")
fi
[ -x "$NEO4J_HOME/bin/cypher-shell" ] || fail "no cypher-shell under NEO4J_HOME=$NEO4J_HOME"

# The API's own config: the systemd EnvironmentFile. Not bash-sourceable
# (EMAIL_FROM has an unquoted <), so read single values, systemd-style: first
# match, CR stripped, one layer of surrounding quotes removed.
# /opt/splitty/.env is NOT the right file: its NEO4J_URI is a dead Docker name.
ENV_FILE=${ENV_FILE:-/etc/splitty-api.env}
[ -r "$ENV_FILE" ] || fail "cannot read $ENV_FILE (set ENV_FILE)"

env_value() {
  local v
  v=$(grep -m1 -E "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '\r' || true)
  if [ ${#v} -ge 2 ]; then
    case "$v" in
      \"*\") v=${v:1:${#v}-2} ;;
      \'*\') v=${v:1:${#v}-2} ;;
    esac
  fi
  printf '%s' "$v"
}

NEO4J_USER=$(env_value NEO4J_USER)
NEO4J_PASSWORD=$(env_value NEO4J_PASSWORD)
NEO4J_URI=$(env_value NEO4J_URI)
[ -n "$NEO4J_PASSWORD" ] || fail "NEO4J_PASSWORD is empty or missing in $ENV_FILE"

# Password through the environment of the one child process, never as -p.
cypher() {
  NEO4J_PASSWORD="$NEO4J_PASSWORD" "$NEO4J_HOME/bin/cypher-shell" \
    -a "${NEO4J_URI:-bolt://127.0.0.1:7687}" -u "${NEO4J_USER:-neo4j}" --format plain "$@"
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

# --- rollback: properties back from the labels, labels kept --------------------
ROLLBACK='
:begin
MATCH (e:Expense:Settlement) WHERE e.isSettlement IS NULL OR e.isSettlement <> true
SET e.isSettlement = true
RETURN count(e) AS settlementsFlagged;

MATCH (e:Expense:Transfer) WHERE e.isTransfer IS NULL OR e.isTransfer <> true
SET e.isTransfer = true
RETURN count(e) AS transfersFlagged;
:commit
'

# --- checks (read-only) --------------------------------------------------------
# One row per check: what was found, what it should be, and ok / FAIL ("-" for
# plain counts to eyeball). Any FAIL makes the script exit 1.
if [ "$STRICT" = true ]; then
  LEFTOVER='"0" AS expected, CASE WHEN found = 0 THEN "ok" ELSE "FAIL" END AS status'
else
  LEFTOVER='"0 after phase 2" AS expected, "-" AS status'
fi
ZERO='"0" AS expected, CASE WHEN found = 0 THEN "ok" ELSE "FAIL" END AS status'
COUNT='"-" AS expected, "-" AS status'
CHECK="
MATCH (e:Expense) WITH count(e) AS found
RETURN 'expenses (all kinds)' AS check, found, $COUNT
UNION ALL
MATCH (e:Expense) WHERE NOT e:Settlement AND NOT e:Transfer WITH count(e) AS found
RETURN 'ordinary expenses' AS check, found, $COUNT
UNION ALL
MATCH (e:Expense:Settlement) WITH count(e) AS found
RETURN 'settlements' AS check, found, $COUNT
UNION ALL
MATCH (e:Expense:Transfer) WITH count(e) AS found
RETURN 'transfers (two nodes per transfer)' AS check, found, $COUNT
UNION ALL
MATCH (e:Expense:Settlement:Transfer) WITH count(e) AS found
RETURN 'expenses with both labels' AS check, found, $ZERO
UNION ALL
MATCH (n) WHERE (n:Settlement OR n:Transfer) AND NOT n:Expense WITH count(n) AS found
RETURN 'Settlement/Transfer label on a non-Expense' AS check, found, $ZERO
UNION ALL
MATCH (e:Expense) WHERE (e.isSettlement = true AND NOT e:Settlement) OR (e.isTransfer = true AND NOT e:Transfer)
WITH count(e) AS found
RETURN 'flagged but not labelled (phase 1 missing)' AS check, found, $ZERO
UNION ALL
MATCH (n) WHERE n.isSettlement IS NOT NULL OR n.isTransfer IS NOT NULL WITH count(n) AS found
RETURN 'nodes with a leftover property' AS check, found, $LEFTOVER
UNION ALL
MATCH (t:Transfer)
OPTIONAL MATCH (t)-[:TRANSFER_PAIR]-(p)
WITH t, collect(p) AS partners
WITH count(CASE WHEN size(partners) <> 1 OR NOT partners[0]:Transfer THEN t END) AS found
RETURN 'transfers without exactly one Transfer partner' AS check, found, $ZERO
UNION ALL
MATCH (a)-[:TRANSFER_PAIR]-(b) WHERE NOT a:Transfer WITH count(DISTINCT a) AS found
RETURN 'TRANSFER_PAIR touching a non-Transfer' AS check, found, $ZERO;
"

run_check() {
  local out
  out=$(printf '%s' "$CHECK" | cypher --access-mode read) || fail "check query failed"
  printf '%s\n' "$out"
  if printf '%s\n' "$out" | grep -q '"FAIL"'; then
    echo "migrate: CHECK FAILED (strict=$STRICT)" >&2
    return 1
  fi
  echo "migrate: check ok (strict=$STRICT)"
}

echo "migrate: $(date +%F_%T) $PHASE using NEO4J_HOME=$NEO4J_HOME, ENV_FILE=$ENV_FILE"
case "$PHASE" in
  phase1)   printf '%s' "$PHASE1"   | cypher ;;
  phase2)   printf '%s' "$PHASE2"   | cypher ;;
  rollback) printf '%s' "$ROLLBACK" | cypher ;;
esac
run_check
