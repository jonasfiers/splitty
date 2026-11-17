#!/usr/bin/env bash
# Trip items no longer have a planned price (removed from the API 2026-11-17).
# Removes the leftover `price` property and the item's EXPRESSED_IN currency link.
#
#   pct exec <ct> -- bash -s check < scripts/drop-trip-item-price.sh
#   pct exec <ct> -- bash -s apply < scripts/drop-trip-item-price.sh
#
# Expenses' EXPRESSED_IN links are untouched (only TripItem sources match).
set -euo pipefail
PHASE=${1:-check}
export JAVA_HOME=/opt/java21 PATH=/opt/java21/bin:$PATH
EXEC=$(systemctl show neo4j --property=ExecStart --value | sed -n 's/.*path=\([^ ;]*\).*/\1/p')
NEO4J_HOME=$(dirname "$(dirname "$EXEC")")
val() { sed -n "s/^$1=//p" /etc/splitty-api.env | tail -1 | sed 's/^["'"'"']//;s/["'"'"']$//'; }
export NEO4J_USERNAME=$(val NEO4J_USER) NEO4J_PASSWORD=$(val NEO4J_PASSWORD)
cy() { "$NEO4J_HOME/bin/cypher-shell" -a "$(val NEO4J_URI)" --format plain; }

echo "== items with a price or an item currency:"
cy <<'Q'
MATCH (i:TripItem) WHERE i.price IS NOT NULL OR EXISTS { (i)-[:EXPRESSED_IN]->() }
RETURN i.id AS id, i.title AS title, i.price AS price, [(i)-[:EXPRESSED_IN]->(c:Currency) | c.iso] AS currency;
Q
if [ "$PHASE" = apply ]; then
  echo "== applying"
  cy <<'Q'
MATCH (i:TripItem) OPTIONAL MATCH (i)-[r:EXPRESSED_IN]->(:Currency)
WITH i, collect(r) AS rs, i.price IS NOT NULL AS hadPrice
FOREACH (x IN rs | DELETE x)
REMOVE i.price
RETURN sum(CASE WHEN hadPrice THEN 1 ELSE 0 END) AS pricesRemoved, sum(size(rs)) AS currencyLinksRemoved;
Q
fi
