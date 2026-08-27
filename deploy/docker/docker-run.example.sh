#!/bin/sh
# docker run example — production params aligned with Kubernetes sidecar deploy
#
# Usage:
#   MONGO_URL='mongodb://exporter:change-me@mongodb-host:27017/?authSource=admin' \
#   ./deploy/docker/docker-run.example.sh

set -e

IMAGE="${IMAGE:-mongo-oplog-exporter:latest}"
MONGO_URL="${MONGO_URL:?Set MONGO_URL}"
PORT="${PORT:-7777}"

docker build -t "$IMAGE" .

docker run -d \
  --name mongo-oplog-exporter \
  --restart unless-stopped \
  -p "${PORT}:${PORT}" \
  -e MONGO_URL="$MONGO_URL" \
  -e MONGO_DIRECT_CONNECTION="${MONGO_DIRECT_CONNECTION:-true}" \
  -e PORT="$PORT" \
  -e OPEN_OPLOG="${OPEN_OPLOG:-true}" \
  -e OPENLOG_OPLOG="${OPENLOG_OPLOG:-false}" \
  -e OPLOG_METRICS_TYPE="${OPLOG_METRICS_TYPE:-counter}" \
  -e OPLOG_METRICS_NAME="${OPLOG_METRICS_NAME:-log_to_metric_mongo_oplog}" \
  -e 'OPLOG_IGNORE_OP=["n"]' \
  -e 'OPLOG_IGNORE_FIELD=["lsid","ui","prevOpTime","stmtId","ts","txnNumber","wall","o2","o","postImageOpTime","h","fromMigrate"]' \
  -e 'OPLOG_INIT_LABEL=["op","ns","node_name","service_name","t","cluster","v","o2","lsid","ui","prevOpTime","stmtId","ts","txnNumber","wall","preImageOpTime","writeConflicts","transaction","fromMigrate"]' \
  -e OPEN_CURRENTOP="${OPEN_CURRENTOP:-true}" \
  -e OPENLOG_CURRENTOP="${OPENLOG_CURRENTOP:-false}" \
  -e CURRENTOP_INTERVAL="${CURRENTOP_INTERVAL:-20000}" \
  -e CURRENTOP_METRICS_TYPE="${CURRENTOP_METRICS_TYPE:-counter}" \
  -e CURRENTOP_METRICS_NAME="${CURRENTOP_METRICS_NAME:-log_to_metric_mongo_currentop}" \
  -e 'CURRENTOP_IGNORE_OP=["none"]' \
  -e 'CURRENTOP_IGNORE_FIELD=["lsid","waitingForFlowControl","flowControlStats","numYields","currentOpTime","clientMetadata","command.$clusterTime","locks","waitingForLock","lockStats","threadId"]' \
  -e 'CURRENTOP_IGNORE_KEYVALUE=[{"command":"hello"},{"command":"currentOp"},{"command":"isMaster"},{"appName":"OplogFetcher"},{"ns":"admin"},{"ns":"local"},{"appName":"QAN"}]' \
  -e 'CURRENTOP_INIT_LABEL=["command","opid","v","active","t","connectionId","desc","host","type","exporter_type","effectiveUsers","client","clientMetadata","secs_running","microsecs_running","waitingForLatch","appName","planSummary","cursor","preImageOpTime","writeConflicts","transaction","postImageOpTime","originatingCommand","query","fromMigrate"]' \
  --memory=1000m \
  --cpus=1 \
  "$IMAGE" \
  node --trace-warnings --gc-interval=1000 --max-old-space-size=2048 app.js

echo "Exporter started: http://localhost:${PORT}/metrics"
