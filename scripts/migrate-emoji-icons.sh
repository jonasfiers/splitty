#!/bin/bash
set -eo pipefail

# One-off migration: categories, groups and trips store an icon's name
# (web/src/utils/icons.js, Lucide: "train-front") instead of an emoji.
#
#   before: (:Category {icon: '🚂'})
#   after:  (:Category {icon: 'train-front', iconEmoji: '🚂'})
#
# The old emoji stays in iconEmoji, so rollback can put it back. An emoji with
# no match in the table below gets icon '' (the app then draws its default:
# the first letter for an expense, a tag, people or a suitcase) and is listed
# by `check`, so it can be added to the table and the migration run again
# after a rollback. Values that already are a name are never touched.
#
# Avatar emoji are not migrated: the app no longer draws them, and saving the
# profile clears them (u.avatarEmoji = null).
#
# Self-contained: it needs no checkout, only the Neo4j install behind
# neo4j.service and the API's env file. Copy it onto the container and run it
# there as root (CT104 production, CT116 QA):
#
#   bash migrate-emoji-icons.sh check | apply | rollback
#
#   check     Read-only. Every stored emoji, what it becomes, and how many
#             have no match (exits 1 if any).
#   apply     Maps the emoji. Run it right after deploying the web app that
#             draws icons (the old one would show the names as text).
#             Idempotent.
#   rollback  Before going back to a web app that draws emoji: icon =
#             iconEmoji again, iconEmoji removed.

PHASE="$1"
case "$PHASE" in
  check|apply|rollback) ;;
  *) echo "usage: $0 check|apply|rollback" >&2; exit 2 ;;
esac

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

# Emoji (without the U+FE0F variation selector) -> icon name. Flags (two
# regional indicators) become 'flag' separately.
PAIRS="[
['✈','plane'],['🛫','plane-takeoff'],['🛬','plane-landing'],
['🍽','utensils'],['🍴','utensils'],['🍝','utensils'],['🥢','utensils'],['🍜','soup'],['🍲','soup'],['🍛','soup'],
['🍣','fish'],['🍤','fish'],['🐟','fish'],['🍔','sandwich'],['🍟','sandwich'],['🌭','sandwich'],['🥪','sandwich'],['🌮','sandwich'],
['🍕','pizza'],['🥡','package'],['☕','coffee'],['🍵','coffee'],['🧋','cup-soda'],['🥤','cup-soda'],['🧃','cup-soda'],
['🍺','beer'],['🍻','beer'],['🍷','wine'],['🥂','wine'],['🍸','martini'],['🍹','martini'],['🍾','wine'],
['🍦','ice-cream-cone'],['🍨','ice-cream-cone'],['🍧','ice-cream-cone'],['🍰','cake-slice'],['🎂','cake-slice'],['🧁','cake-slice'],
['🍪','cookie'],['🍩','cookie'],['🍫','candy'],['🍬','candy'],['🍭','candy'],['🍿','popcorn'],['🥗','salad'],
['🥩','beef'],['🍖','beef'],['🍗','beef'],['🥓','beef'],['🍳','egg'],['🥚','egg'],['🥐','croissant'],['🍞','croissant'],['🥖','croissant'],['🥯','croissant'],
['🍎','apple'],['🍏','apple'],['🍉','apple'],['🍓','apple'],['🍌','apple'],['🍊','apple'],['🍇','apple'],['🥕','carrot'],['🥦','carrot'],['🥬','carrot'],
['🥛','milk'],['🧀','milk'],['🛒','shopping-cart'],['🧺','shopping-basket'],['🏪','store'],['🏬','store'],
['🚗','car'],['🚙','car'],['🚘','car'],['🏎','car'],['🚕','car-taxi-front'],['🚖','car-taxi-front'],
['🚌','bus'],['🚎','bus'],['🚐','bus'],['🚍','bus-front'],
['🚂','train-front'],['🚆','train-front'],['🚄','train-front'],['🚅','train-front'],['🚈','train-front'],['🚃','train-front'],['🚉','train-front'],
['🚇','train-front-tunnel'],['🚊','tram-front'],['🚋','tram-front'],['🚲','bike'],['🚴','bike'],['🛴','bike'],['🛵','bike'],['🏍','bike'],
['⛴','ship'],['🚢','ship'],['🛳','ship'],['🚤','ship'],['⛵','sailboat'],['🚡','cable-car'],['🚠','cable-car'],['🚟','cable-car'],
['⛽','fuel'],['🅿','parking-meter'],['🧭','compass'],['🗺','map'],['📍','map-pin'],['📌','map-pin'],['🚶','footprints'],['🥾','footprints'],
['🏨','hotel'],['🏩','hotel'],['🛌','bed-double'],['🛏','bed-double'],['🏠','house'],['🏡','house'],['🏘','house'],['🏢','building'],['🏙','building'],
['🔑','key-round'],['🗝','key-round'],['⛺','tent'],['🏕','tent'],['🧳','luggage'],['🎒','backpack'],
['🌍','globe'],['🌎','globe'],['🌏','globe'],['🌐','globe'],['🏝','tree-palm'],['🌴','tree-palm'],['🏖','umbrella'],['⛱','umbrella'],['☂','umbrella'],
['☀','sun'],['🌞','sun'],['🌅','sun'],['🌊','waves-horizontal'],['🏊','waves-horizontal'],['🏔','mountain-snow'],['⛷','mountain-snow'],['🎿','mountain-snow'],['🏂','mountain-snow'],
['⛰','mountain'],['🗻','mountain'],['❄','snowflake'],['☃','snowflake'],
['🛍','shopping-bag'],['👕','shirt'],['👗','shirt'],['👔','shirt'],['👖','shirt'],['👟','shirt'],['🧥','shirt'],['👚','shirt'],
['💎','gem'],['💍','gem'],['👓','glasses'],['🕶','glasses'],['⌚','watch'],['🎁','gift'],['📚','book'],['📕','book'],['📖','book-open'],
['💻','laptop'],['🖥','monitor'],['📱','smartphone'],['🎧','headphones'],['🎵','headphones'],['🎶','headphones'],['🎤','headphones'],['🎸','headphones'],
['📷','camera'],['📸','camera'],['🎮','gamepad-2'],['🕹','gamepad-2'],['🔌','plug'],['🔋','plug'],['🔧','wrench'],['🛠','wrench'],['🔩','wrench'],
['🔨','hammer'],['🖌','paintbrush'],['🎨','palette'],['✂','scissors'],['💇','scissors'],['💈','scissors'],['💄','sparkles'],['✨','sparkles'],['🧴','sparkles'],['🧹','sparkles'],['🧼','sparkles'],['🛋','sofa'],
['🎟','ticket'],['🎫','ticket'],['🎭','drama'],['🎬','film'],['🎥','film'],['🎉','party-popper'],['🎊','party-popper'],['🥳','party-popper'],
['🏛','landmark'],['🏦','landmark'],['🏰','castle'],['🏯','castle'],['🎡','ferris-wheel'],['🎢','ferris-wheel'],['🎠','ferris-wheel'],
['🏋','dumbbell'],['💪','dumbbell'],['⚽','trophy'],['🏆','trophy'],['🎾','trophy'],['🏀','trophy'],['🎲','dices'],['🧩','puzzle'],
['🌲','tree-pine'],['🌳','tree-pine'],['🏞','tree-pine'],['🌸','flower-2'],['🌷','flower-2'],['💐','flower-2'],['🌻','flower-2'],['🛁','bath'],['🧖','bath'],['♨','bath'],
['⚡','zap'],['💡','zap'],['💧','droplet'],['🚰','droplet'],['🔥','flame'],['📶','wifi'],['📞','phone'],['☎','phone'],['🧾','receipt'],['📄','file-text'],['📃','file-text'],['📝','file-text'],
['💳','credit-card'],['👛','wallet'],['💰','coins'],['🪙','coins'],['💵','banknote'],['💶','banknote'],['💷','banknote'],['💸','banknote'],['💱','coins'],['🐷','piggy-bank'],
['🛡','shield'],['🏥','heart-pulse'],['💊','pill'],['🩺','stethoscope'],['🎓','graduation-cap'],['🏫','graduation-cap'],['💼','briefcase'],
['📅','calendar'],['📆','calendar'],['🗓','calendar'],['🕰','calendar'],['⏰','calendar'],['🧺','shopping-basket'],
['👥','users'],['👫','users'],['👬','users'],['👭','users'],['👪','users'],['😀','users'],['😃','users'],['😄','users'],['😁','users'],['😊','users'],['🙂','users'],['😎','users'],['🤝','users'],
['👤','user'],['❤','heart'],['💕','heart'],['💑','heart'],['💖','heart'],['👶','baby'],['🐶','dog'],['🐕','dog'],['🐱','cat'],['🐈','cat'],['🐾','paw-print'],
['⭐','star'],['🌟','star'],['🚩','flag'],['🏁','flag'],['🏳','flag'],['🏷','tag'],['📁','folder'],['📂','folder'],['📦','box'],['🧪','star']
]"

# The rows still holding something other than an icon name, and what each becomes.
MAPPED="
MATCH (n) WHERE (n:Category OR n:Group OR n:Trip) AND n.icon IS NOT NULL AND n.icon <> '' AND NOT n.icon =~ '[a-z0-9-]+'
WITH n, replace(n.icon, '\\uFE0F', '') AS e
WITH n, coalesce([p IN $PAIRS WHERE p[0] = e | p[1]][0],
                 CASE WHEN e =~ '[\\\\x{1F1E6}-\\\\x{1F1FF}]{2}' THEN 'flag' END) AS name
"

case "$PHASE" in
  check)
    cypher <<EOF
$MAPPED
RETURN labels(n)[0] AS kind, n.icon AS emoji, coalesce(name, '(no match)') AS becomes, count(*) AS n, collect(coalesce(n.name, n.title))[0..3] AS examples
ORDER BY becomes = '(no match)' DESC, kind, becomes;
MATCH (n) WHERE (n:Category OR n:Group OR n:Trip) AND n.iconEmoji IS NOT NULL RETURN count(n) AS alreadyMigrated;
EOF
    UNMATCHED=$(cypher <<EOF | tail -1
$MAPPED
WITH n WHERE name IS NULL RETURN count(n) AS unmatched;
EOF
)
    echo "unmatched: $UNMATCHED"
    [ "$UNMATCHED" = "0" ] || exit 1
    ;;
  apply)
    cypher <<EOF
$MAPPED
SET n.iconEmoji = n.icon, n.icon = coalesce(name, '')
RETURN count(n) AS migrated, sum(CASE WHEN name IS NULL THEN 1 ELSE 0 END) AS withoutMatch;
EOF
    ;;
  rollback)
    cypher <<'EOF'
MATCH (n) WHERE (n:Category OR n:Group OR n:Trip) AND n.iconEmoji IS NOT NULL
SET n.icon = n.iconEmoji REMOVE n.iconEmoji
RETURN count(n) AS restored;
EOF
    ;;
esac
