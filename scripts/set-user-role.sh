#!/bin/bash
set -eo pipefail
# Grant, revoke or list the admin role. There is no screen for this on
# purpose; run it on the container as root (CT104 production, CT116 QA):
#
#   bash set-user-role.sh grant  <email>    make the user an admin
#   bash set-user-role.sh revoke <email>    back to an ordinary user
#   bash set-user-role.sh list              every admin
#
# The API reads the role from the database on every admin request, so a
# change takes effect at once, without logging in again. Self-contained: it
# needs only the Neo4j install behind neo4j.service and the API's env file.

ACTION="$1"
EMAIL="$2"
usage() { echo "usage: $0 grant|revoke <email> | list" >&2; exit 2; }
case "$ACTION" in
  grant|revoke) [ -n "$EMAIL" ] || usage ;;
  list) [ -z "$EMAIL" ] || usage ;;
  *) usage ;;
esac

fail() { echo "set-user-role: FATAL: $*" >&2; exit 1; }

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

if [ "$ACTION" = list ]; then
  cypher "MATCH (u:User) WHERE u.role = 'admin' RETURN u.email AS email, u.name AS name ORDER BY email;"
  exit 0
fi

# The email reaches Cypher as a parameter, never spliced into the query; the
# check below only keeps the --param literal well-formed.
case "$EMAIL" in
  *[\'\"\\[:space:]]*) fail "email contains quotes, backslashes or spaces" ;;
  *@*) ;;
  *) fail "not an email address: $EMAIL" ;;
esac

# Exact match on the stored address (registration is case-sensitive, so
# Jonas@x and jonas@x can be two accounts), and the change is made only if
# exactly one account matches; grant also refuses an account login would
# refuse: emailVerified = false (new, unconfirmed registrations). Older
# accounts have no flag at all and log in normally, so they qualify.
if [ "$ACTION" = grant ]; then
  WHERE="u.email = \$email AND coalesce(u.emailVerified, true) <> false"
  CHANGE="SET u.role = 'admin'"
else
  WHERE="u.email = \$email"
  CHANGE="REMOVE u.role"
fi
QUERY="MATCH (u:User) WHERE $WHERE
WITH collect(u) AS us WHERE size(us) = 1
UNWIND us AS u $CHANGE
RETURN u.email AS email, u.role AS role;"

OUT=$(cypher --param "email => '$EMAIL'" "$QUERY")
echo "$OUT"
# plain format prints a header line, then one line per changed account;
# nothing at all when the WITH filtered everything out
if [ "$(printf '%s\n' "$OUT" | wc -l)" -lt 2 ]; then
  N=$(cypher --param "email => '$EMAIL'" "MATCH (u:User) WHERE u.email = \$email RETURN count(u) AS n, sum(CASE WHEN u.emailVerified = false THEN 0 ELSE 1 END) AS canLogIn;" | tail -1)
  fail "nothing changed for $EMAIL (accounts with that exact address, of which can log in: $N); grant needs exactly one that can log in"
fi
