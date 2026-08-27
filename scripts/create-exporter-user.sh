#!/bin/sh
# Create a read-only MongoDB user for the exporter.
#
# Usage:
#   MONGO_URI='mongodb://admin:pass@localhost:27017/admin' \
#   EXPORTER_USER=exporter EXPORTER_PWD='your-password' \
#   ./scripts/create-exporter-user.sh
#
# Roles:
#   clusterMonitor@admin — currentOp and cluster monitoring
#   read@local           — tail local.oplog.rs

set -e

MONGO_URI="${MONGO_URI:-mongodb://localhost:27017/admin}"
EXPORTER_USER="${EXPORTER_USER:-exporter}"
EXPORTER_PWD="${EXPORTER_PWD:-change-me}"

mongosh "$MONGO_URI" --quiet --eval "
db.createUser({
  user: \"${EXPORTER_USER}\",
  pwd: \"${EXPORTER_PWD}\",
  roles: [
    { role: \"clusterMonitor\", db: \"admin\" },
    { role: \"read\", db: \"local\" }
  ]
})
"

echo "User '${EXPORTER_USER}' created."
echo "MONGO_URL=mongodb://${EXPORTER_USER}:<password>@<host>:27017/?authSource=admin"
