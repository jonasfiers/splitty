#!/usr/bin/env bash
# Give every top-level category without a colour one (web/src/utils/categoryColours.js).
# Known names get the colour from the design (Eat out amber, Transport blue…),
# the rest the first colours not yet taken, busiest category first.
#   check: show what would change   apply: set it
# Runs on the API host (CT104 prod, CT116 QA): pct exec <id> -- bash -s check < this
set -eo pipefail

PHASE="$1"
case "$PHASE" in check|apply) ;; *) echo "usage: $0 check|apply" >&2; exit 2 ;; esac
fail() { echo "migrate: FATAL: $*" >&2; exit 1; }

if [ -z "$JAVA_HOME" ] && [ -d /opt/java21 ]; then JAVA_HOME=/opt/java21; fi
if [ -n "$JAVA_HOME" ]; then export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"; fi
# cypher-shell prints emoji as ? under the POSIX locale.
export LANG=C.UTF-8 LC_ALL=C.UTF-8

if [ -z "$NEO4J_HOME" ]; then
  NEO4J_EXEC=$(systemctl show neo4j --property=ExecStart --value 2>/dev/null \
    | tr ' ' '\n' | grep -m1 '^path=' | cut -d= -f2- || true)
  [ -n "$NEO4J_EXEC" ] || fail "could not read ExecStart from neo4j.service (set NEO4J_HOME)"
  NEO4J_HOME=$(dirname "$(dirname "$NEO4J_EXEC")")
fi
[ -x "$NEO4J_HOME/bin/cypher-shell" ] || fail "no cypher-shell under NEO4J_HOME=$NEO4J_HOME"

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

QUERY='
WITH ["amber","green","teal","sky","blue","violet","pink","slate"] AS keys,
     {`eat out`:"amber", groceries:"green", shopping:"teal", transport:"blue", accommodation:"violet", leisure:"pink"} AS known
MATCH (c:Category) WHERE NOT (c)-[:CHILD_OF]->(:Category)
OPTIONAL MATCH (e:Expense)-[:IN_CATEGORY]->(:Category)-[:CHILD_OF*0..]->(c)
WITH keys, known, c, count(e) AS n ORDER BY n DESC
WITH keys, collect({c: c, want: CASE WHEN c.colour IS NOT NULL THEN c.colour ELSE known[toLower(trim(c.name))] END}) AS rows
WITH keys, rows, [r IN rows WHERE r.want IS NOT NULL | r.want] AS taken
WITH keys, rows, [k IN keys WHERE NOT k IN taken] AS free
WITH rows, free, [r IN rows WHERE r.want IS NULL | r.c] AS rest
UNWIND range(0, size(rows) - 1) AS i
WITH rows[i] AS r, free, rest
WITH r.c AS c, coalesce(r.want, free[apoc.coll.indexOf(rest, r.c) % size(free)]) AS colour
'
if [ "$PHASE" = check ]; then
  cypher "$QUERY RETURN c.name AS name, c.colour AS now, colour AS becomes ORDER BY name"
else
  cypher "$QUERY WITH c, colour WHERE c.colour IS NULL SET c.colour = colour RETURN c.name AS name, c.colour AS colour ORDER BY name"
fi
