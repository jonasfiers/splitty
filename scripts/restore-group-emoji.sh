#!/bin/bash
set -eo pipefail

# One-off: groups draw an emoji again (web/src/utils/icons.js), so a group's
# icon goes back to the emoji it had before the Lucide migration, which that
# migration kept in iconEmoji (scripts/migrate-emoji-icons.sh).
#
#   before: (:Group {icon: 'rainbow', iconEmoji: '🌈'})
#   after:  (:Group {icon: '🌈', iconName: 'rainbow'})
#
# Categories keep their line icons and trips their country; neither changes.
# A group with no iconEmoji keeps its name (the app still draws it).
#
# Self-contained, like migrate-emoji-icons.sh. Run it on the container as root
# (CT104 production, CT116 QA), right after deploying the web app that draws
# group emoji:
#
#   bash restore-group-emoji.sh check | apply | rollback

PHASE="$1"
case "$PHASE" in
  check|apply|rollback) ;;
  *) echo "usage: $0 check|apply|rollback" >&2; exit 2 ;;
esac
fail() { echo "restore-group-emoji: FATAL: $*" >&2; exit 1; }

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

case "$PHASE" in
  check)
    cypher <<'Q'
MATCH (g:Group) RETURN g.title AS group, g.icon AS icon, g.iconEmoji AS becomes, g.iconName AS restoredFrom ORDER BY group;
Q
    ;;
  apply)
    cypher <<'Q'
MATCH (g:Group) WHERE g.iconEmoji IS NOT NULL AND g.icon =~ '[a-z0-9-]+|country:[A-Z]{2}|'
SET g.iconName = g.icon, g.icon = g.iconEmoji
REMOVE g.iconEmoji
RETURN count(g) AS restored;
Q
    ;;
  rollback)
    cypher <<'Q'
MATCH (g:Group) WHERE g.iconName IS NOT NULL
SET g.iconEmoji = g.icon, g.icon = g.iconName
REMOVE g.iconName
RETURN count(g) AS rolledBack;
Q
    ;;
esac
