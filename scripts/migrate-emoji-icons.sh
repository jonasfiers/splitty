#!/bin/bash
set -eo pipefail

# One-off migration: categories, groups and trips store an icon's name
# (web/src/utils/icons.js, Lucide: "train-front") instead of an emoji.
#
#   before: (:Category {icon: '🚂'})        (:Group {icon: '🇹🇼'})
#   after:  (:Category {icon: 'train-front', iconEmoji: '🚂'})
#           (:Group {icon: 'country:TW', iconEmoji: '🇹🇼'})
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

# Emoji (without the U+FE0F variation selector) -> icon name. A country's flag
# becomes its code ('country:TW', drawn as the letters); any other pair of
# regional indicators becomes 'flag'.
FLAGS="['🇦🇩','country:AD'],['🇦🇪','country:AE'],['🇦🇫','country:AF'],['🇦🇬','country:AG'],['🇦🇮','country:AI'],['🇦🇱','country:AL'],['🇦🇲','country:AM'],['🇦🇴','country:AO'],['🇦🇶','country:AQ'],['🇦🇷','country:AR'],['🇦🇸','country:AS'],['🇦🇹','country:AT'],['🇦🇺','country:AU'],['🇦🇼','country:AW'],['🇦🇽','country:AX'],['🇦🇿','country:AZ'],['🇧🇦','country:BA'],['🇧🇧','country:BB'],['🇧🇩','country:BD'],['🇧🇪','country:BE'],['🇧🇫','country:BF'],['🇧🇬','country:BG'],['🇧🇭','country:BH'],['🇧🇮','country:BI'],['🇧🇯','country:BJ'],['🇧🇱','country:BL'],['🇧🇲','country:BM'],['🇧🇳','country:BN'],['🇧🇴','country:BO'],['🇧🇶','country:BQ'],['🇧🇷','country:BR'],['🇧🇸','country:BS'],['🇧🇹','country:BT'],['🇧🇻','country:BV'],['🇧🇼','country:BW'],['🇧🇾','country:BY'],['🇧🇿','country:BZ'],['🇨🇦','country:CA'],['🇨🇨','country:CC'],['🇨🇩','country:CD'],['🇨🇫','country:CF'],['🇨🇬','country:CG'],['🇨🇭','country:CH'],['🇨🇮','country:CI'],['🇨🇰','country:CK'],['🇨🇱','country:CL'],['🇨🇲','country:CM'],['🇨🇳','country:CN'],['🇨🇴','country:CO'],['🇨🇷','country:CR'],['🇨🇺','country:CU'],['🇨🇻','country:CV'],['🇨🇼','country:CW'],['🇨🇽','country:CX'],['🇨🇾','country:CY'],['🇨🇿','country:CZ'],['🇩🇪','country:DE'],['🇩🇯','country:DJ'],['🇩🇰','country:DK'],['🇩🇲','country:DM'],['🇩🇴','country:DO'],['🇩🇿','country:DZ'],['🇪🇨','country:EC'],['🇪🇪','country:EE'],['🇪🇬','country:EG'],['🇪🇭','country:EH'],['🇪🇷','country:ER'],['🇪🇸','country:ES'],['🇪🇹','country:ET'],['🇪🇺','country:EU'],['🇫🇮','country:FI'],['🇫🇯','country:FJ'],['🇫🇰','country:FK'],['🇫🇲','country:FM'],['🇫🇴','country:FO'],['🇫🇷','country:FR'],['🇬🇦','country:GA'],['🇬🇧','country:GB'],['🇬🇩','country:GD'],['🇬🇪','country:GE'],['🇬🇫','country:GF'],['🇬🇬','country:GG'],['🇬🇭','country:GH'],['🇬🇮','country:GI'],['🇬🇱','country:GL'],['🇬🇲','country:GM'],['🇬🇳','country:GN'],['🇬🇵','country:GP'],['🇬🇶','country:GQ'],['🇬🇷','country:GR'],['🇬🇸','country:GS'],['🇬🇹','country:GT'],['🇬🇺','country:GU'],['🇬🇼','country:GW'],['🇬🇾','country:GY'],['🇭🇰','country:HK'],['🇭🇲','country:HM'],['🇭🇳','country:HN'],['🇭🇷','country:HR'],['🇭🇹','country:HT'],['🇭🇺','country:HU'],['🇮🇩','country:ID'],['🇮🇪','country:IE'],['🇮🇱','country:IL'],['🇮🇲','country:IM'],['🇮🇳','country:IN'],['🇮🇴','country:IO'],['🇮🇶','country:IQ'],['🇮🇷','country:IR'],['🇮🇸','country:IS'],['🇮🇹','country:IT'],['🇯🇪','country:JE'],['🇯🇲','country:JM'],['🇯🇴','country:JO'],['🇯🇵','country:JP'],['🇰🇪','country:KE'],['🇰🇬','country:KG'],['🇰🇭','country:KH'],['🇰🇮','country:KI'],['🇰🇲','country:KM'],['🇰🇳','country:KN'],['🇰🇵','country:KP'],['🇰🇷','country:KR'],['🇰🇼','country:KW'],['🇰🇾','country:KY'],['🇰🇿','country:KZ'],['🇱🇦','country:LA'],['🇱🇧','country:LB'],['🇱🇨','country:LC'],['🇱🇮','country:LI'],['🇱🇰','country:LK'],['🇱🇷','country:LR'],['🇱🇸','country:LS'],['🇱🇹','country:LT'],['🇱🇺','country:LU'],['🇱🇻','country:LV'],['🇱🇾','country:LY'],['🇲🇦','country:MA'],['🇲🇨','country:MC'],['🇲🇩','country:MD'],['🇲🇪','country:ME'],['🇲🇫','country:MF'],['🇲🇬','country:MG'],['🇲🇭','country:MH'],['🇲🇰','country:MK'],['🇲🇱','country:ML'],['🇲🇲','country:MM'],['🇲🇳','country:MN'],['🇲🇴','country:MO'],['🇲🇵','country:MP'],['🇲🇶','country:MQ'],['🇲🇷','country:MR'],['🇲🇸','country:MS'],['🇲🇹','country:MT'],['🇲🇺','country:MU'],['🇲🇻','country:MV'],['🇲🇼','country:MW'],['🇲🇽','country:MX'],['🇲🇾','country:MY'],['🇲🇿','country:MZ'],['🇳🇦','country:NA'],['🇳🇨','country:NC'],['🇳🇪','country:NE'],['🇳🇫','country:NF'],['🇳🇬','country:NG'],['🇳🇮','country:NI'],['🇳🇱','country:NL'],['🇳🇴','country:NO'],['🇳🇵','country:NP'],['🇳🇷','country:NR'],['🇳🇺','country:NU'],['🇳🇿','country:NZ'],['🇴🇲','country:OM'],['🇵🇦','country:PA'],['🇵🇪','country:PE'],['🇵🇫','country:PF'],['🇵🇬','country:PG'],['🇵🇭','country:PH'],['🇵🇰','country:PK'],['🇵🇱','country:PL'],['🇵🇲','country:PM'],['🇵🇳','country:PN'],['🇵🇷','country:PR'],['🇵🇸','country:PS'],['🇵🇹','country:PT'],['🇵🇼','country:PW'],['🇵🇾','country:PY'],['🇶🇦','country:QA'],['🇷🇪','country:RE'],['🇷🇴','country:RO'],['🇷🇸','country:RS'],['🇷🇺','country:RU'],['🇷🇼','country:RW'],['🇸🇦','country:SA'],['🇸🇧','country:SB'],['🇸🇨','country:SC'],['🇸🇩','country:SD'],['🇸🇪','country:SE'],['🇸🇬','country:SG'],['🇸🇭','country:SH'],['🇸🇮','country:SI'],['🇸🇯','country:SJ'],['🇸🇰','country:SK'],['🇸🇱','country:SL'],['🇸🇲','country:SM'],['🇸🇳','country:SN'],['🇸🇴','country:SO'],['🇸🇷','country:SR'],['🇸🇸','country:SS'],['🇸🇹','country:ST'],['🇸🇻','country:SV'],['🇸🇽','country:SX'],['🇸🇾','country:SY'],['🇸🇿','country:SZ'],['🇹🇨','country:TC'],['🇹🇩','country:TD'],['🇹🇫','country:TF'],['🇹🇬','country:TG'],['🇹🇭','country:TH'],['🇹🇯','country:TJ'],['🇹🇰','country:TK'],['🇹🇱','country:TL'],['🇹🇲','country:TM'],['🇹🇳','country:TN'],['🇹🇴','country:TO'],['🇹🇷','country:TR'],['🇹🇹','country:TT'],['🇹🇻','country:TV'],['🇹🇼','country:TW'],['🇹🇿','country:TZ'],['🇺🇦','country:UA'],['🇺🇬','country:UG'],['🇺🇲','country:UM'],['🇺🇸','country:US'],['🇺🇾','country:UY'],['🇺🇿','country:UZ'],['🇻🇦','country:VA'],['🇻🇨','country:VC'],['🇻🇪','country:VE'],['🇻🇬','country:VG'],['🇻🇮','country:VI'],['🇻🇳','country:VN'],['🇻🇺','country:VU'],['🇼🇫','country:WF'],['🇼🇸','country:WS'],['🇽🇰','country:XK'],['🇾🇪','country:YE'],['🇾🇹','country:YT'],['🇿🇦','country:ZA'],['🇿🇲','country:ZM'],['🇿🇼','country:ZW']"
PAIRS="[$FLAGS,
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
['🌈','rainbow'],['⭐','star'],['🌟','star'],['🚩','flag'],['🏁','flag'],['🏳','flag'],['🏷','tag'],['📁','folder'],['📂','folder'],['📦','box'],['🧪','star']
]"

# The rows still holding something other than an icon name, and what each becomes.
MAPPED="
MATCH (n) WHERE (n:Category OR n:Group OR n:Trip) AND n.icon IS NOT NULL AND n.icon <> '' AND NOT n.icon =~ '[a-z0-9-]+|country:[A-Z]{2}'
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
// Flags migrated before countries existed (QA, 2026-11-14) got 'flag'.
MATCH (n) WHERE (n:Category OR n:Group OR n:Trip) AND n.icon = 'flag' AND n.iconEmoji IS NOT NULL
WITH n, [p IN [$FLAGS] WHERE p[0] = replace(n.iconEmoji, '\\uFE0F', '') | p[1]][0] AS name
WHERE name IS NOT NULL
SET n.icon = name
RETURN count(n) AS flagsToCountries;
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
