# Kubernetes Deployment & Configuration Reference

[中文文档](KUBERNETES.zh-CN.md)

> Manifest: [`deploy/kubernetes/example.yaml`](../deploy/kubernetes/example.yaml)  
> Production: [`deploy/kubernetes/production-sidecar.yaml`](../deploy/kubernetes/production-sidecar.yaml)

---

## 1. What problems does this exporter solve?

mongo-oplog-exporter reads two real-time MongoDB data sources and exposes them as Prometheus metrics:

| Source | Core problems solved |
|--------|----------------------|
| **currentOp** | **Slow queries**, **statements running right now**, who is connected, full collection scans |
| **oplog** | **Who is writing what**, hottest collections, abnormal bulk changes |

**Typical ops scenarios:**

- “Database is slow” → check `secs_running` + `planSummary` + `command`
- “What big query is running now?” → currentOp `query`, `ns`, `client`, `appName`
- “Was a table mass-deleted or flooded with writes?” → oplog `op` + `ns` rate
- Too much replication / migration noise → filter with `IGNORE_KEYVALUE` / `IGNORE_FIELD`

### Comparison with other tools

| Tool | Notes |
|------|-------|
| **This exporter** | Lightweight, native Prometheus, flexible label-based alerts |
| MongoDB Profiler | Finer historical query detail, not Prometheus-native |
| mongodb_exporter | **Server metrics** (CPU, memory, connections), not statement-level |
| PMM / Atlas | Full-featured, requires extra stack or cloud product |

### Capabilities & limits

| Capability | Notes |
|------------|-------|
| Slow queries | currentOp polls every **20s** by default — catches **long-running** ops; sub-ms flashes may be missed |
| Active statements | Snapshot of `inprog` at poll time, not full history |
| Write audit | oplog covers **writes only** (insert/update/delete), not reads |
| Metric shape | counter + labels; registry **resets after each Prometheus scrape** |

---

## 2. Sidecar architecture

```
┌──────────────────────────────────────────┐
│  Pod: mongodb-node-0                     │
│  ┌──────────────┐  ┌──────────────────┐  │
│  │   mongod     │  │ oplog-exporter   │  │
│  │   :27017     │  │ :5000 /metrics   │  │
│  └──────────────┘  └──────────────────┘  │
└──────────────────────────────────────────┘
         ▲                      ▲
         │                      │
   App connections         Prometheus scrape
   MONGO_URL=127.0.0.1:27017
```

Multi-node clusters: one exporter per MongoDB Pod, ports `5000`, `5001`, `5002`, …

---

## 3. example.yaml field reference

Matches [`example.yaml`](../deploy/kubernetes/example.yaml) line by line.

### 3.1 Core connection

| Env var | Example | Meaning |
|---------|---------|---------|
| `OPEN_OPLOG` | `"true"` | Enable oplog tailing |
| `OPEN_CURRENTOP` | `"true"` | Enable currentOp polling |
| `PORT` | `"5000"` | HTTP port for `/metrics` |
| `MONGO_URL` | Secret ref | MongoDB URI; sidecar uses `127.0.0.1:27017` in same Pod |

### 3.2 Oplog environment variables

| Env var | Example | Meaning |
|---------|---------|---------|
| `OPLOG_IGNORE_OP` | `'["n"]'` | Ignore no-op heartbeats |
| `OPLOG_IGNORE_FIELD` | see yaml | **Strip** these oplog fields before labeling |
| `OPENLOG_OPLOG` | `"false"` | Do not log each oplog doc (keep false in prod) |
| `OPLOG_METRICS_TYPE` | `"counter"` | Increment counter per oplog entry |
| `OPLOG_METRICS_NAME` | `log_to_metric_mongo_oplog` | Prometheus metric name |
| `OPLOG_INIT_LABEL` | see §4 | Which oplog fields become Prometheus **labels** |

### 3.3 CurrentOp environment variables

| Env var | Example | Meaning |
|---------|---------|---------|
| `CURRENTOP_INTERVAL` | `"20000"` | Poll interval **20 seconds** (milliseconds) |
| `CURRENTOP_IGNORE_OP` | `'["none"]'` | Do not filter by op type |
| `CURRENTOP_IGNORE_FIELD` | see yaml | Strip large / noisy fields |
| `CURRENTOP_IGNORE_KEYVALUE` | see yaml | Drop whole ops matching key-value |
| `OPENLOG_CURRENTOP` | `"false"` | Do not log currentOp JSON |
| `CURRENTOP_METRICS_TYPE` | `"counter"` | Counter metric |
| `CURRENTOP_METRICS_NAME` | `log_to_metric_mongo_currentop` | Prometheus metric name |
| `CURRENTOP_INIT_LABEL` | see §5 | Which currentOp fields become **labels** |

### 3.4 Container command flags

| Flag | Meaning |
|------|---------|
| `--trace-warnings` | Print Node.js warnings for troubleshooting |
| `--gc-interval=1000` | GC every 1s — stable long-running process |
| `--max-old-space-size=2048` | 2GB heap cap (needed under heavy oplog traffic) |
| `/home/app.js` | Entry point inside the image |

### 3.5 Resource limits

| Field | Value | Meaning |
|-------|-------|---------|
| `limits.cpu` | `1` | Max 1 CPU core |
| `limits.memory` | `1000Mi` | Max 1GB RAM |
| `requests.cpu` | `100m` | Scheduling CPU reservation |
| `requests.memory` | `256Mi` | Scheduling memory reservation |

---

## 4. OPLOG_INIT_LABEL reference

Oplog document fields → Prometheus labels on **`log_to_metric_mongo_oplog`**.

| Label | Meaning | Alert / analysis use |
|-------|---------|----------------------|
| `op` | Op type: `i` insert / `u` update / `d` delete / `c` command | Distinguish write types |
| `ns` | Namespace `db.collection` | **Hot collections**, per-table write rate |
| `node_name` | Node name | Multi-node attribution |
| `service_name` | Service name | Business dimension |
| `t` | Operation type category | Internal classification |
| `cluster` | Cluster identifier | Multi-cluster environments |
| `v` | Oplog format version | Rarely used in alerts |
| `o2` | Query selector for update/delete | Which documents were targeted |
| `lsid` | Logical session ID | Correlate same-session ops |
| `ui` | User identifier UUID | Session tracking |
| `prevOpTime` | Previous op timestamp | Replication |
| `stmtId` | Statement ID | In-transaction statements |
| `ts` | Oplog timestamp | Time series (may be stripped from doc but declared in init) |
| `txnNumber` | Transaction number | Transaction tracking |
| `wall` | Wall-clock time | Time reference |
| `preImageOpTime` | Pre-image op time | Change streams |
| `writeConflicts` | Write conflict count | Concurrent write conflicts |
| `transaction` | Transaction metadata | Identify transactional ops |
| `fromMigrate` | From chunk migration | Filter sharding migration noise |

### Why OPLOG_IGNORE_FIELD?

| Ignored field | Reason |
|---------------|--------|
| `lsid`, `ui`, `stmtId`, `txnNumber` | Session/transaction IDs — low alert value |
| `ts`, `wall`, `prevOpTime` | Timestamps — high label cardinality |
| `o`, `o2` | Document/selector payload **too large** for labels |
| `h` | Oplog history hash — replication internal |
| `postImageOpTime`, `fromMigrate` | Migration / image noise |

---

## 5. CURRENTOP_INIT_LABEL reference

Each entry in currentOp `inprog[]` → labels on **`log_to_metric_mongo_currentop`**.

### 5.1 Slow queries & statement troubleshooting (most important)

| Label | Meaning | Typical use |
|-------|---------|-------------|
| **`secs_running`** | Seconds the op has been running | **Slow query core field** — alert if >30s |
| **`microsecs_running`** | Microseconds running | Finer-grained duration |
| **`command`** | Full command BSON/JSON | filter, sort, pipeline, query shape |
| **`query`** | Query portion | Current query text |
| **`planSummary`** | Plan summary | `COLLSCAN` = full scan, `IXSCAN` = index scan |
| `ns` | `db.collection` | Which table |
| `op` | Operation type | `query` / `insert` / `update` / `getmore` / `command` |

### 5.2 Source & connection

| Label | Meaning |
|-------|---------|
| `client` | Client address `ip:port` |
| `clientip` | IP extracted from `client` (added by exporter code) |
| `appName` | Application name (set in MongoDB driver) |
| `connectionId` | Connection ID |
| `effectiveUsers` | Effective user(s) |
| `clientMetadata` | Driver / OS / version metadata |

### 5.3 State & internals

| Label | Meaning |
|-------|---------|
| `active` | Whether op is active (`true` = running) |
| `desc` | Current stage description |
| `host` | mongod hostname |
| `type` | Operation category |
| `t` | Thread / op classification |
| `v` | Protocol version |
| `opid` | Operation ID |
| `waitingForLatch` | Waiting on internal latch |
| `cursor` | Cursor info (getMore) |
| `originatingCommand` | Originating command (aggregation sub-stages) |
| `writeConflicts` | Write conflicts |
| `transaction` | Transaction info |
| `preImageOpTime` / `postImageOpTime` | Change stream image times |
| `fromMigrate` | Migration-related |
| `exporter_type` | Always `currentOp` — identifies metric source |

### Why CURRENTOP_IGNORE_FIELD?

| Ignored field | Reason |
|---------------|--------|
| `locks`, `lockStats`, `waitingForLock` | Lock structures are **huge** — label explosion |
| `flowControlStats`, `waitingForFlowControl` | Flow control internals |
| `numYields`, `threadId` | Scheduler internals |
| `clientMetadata`, `command.$clusterTime` | Large, repetitive |
| `currentOpTime`, `lsid` | Noise |

### CURRENTOP_IGNORE_KEYVALUE rules

**Default is `[]` (no key-value filtering)** — system ops are exported. For production, apply the filters below to reduce noise.

| Filter | Reason |
|--------|--------|
| `{"command":"hello"}` | Driver heartbeat |
| `{"command":"isMaster"}` | Topology check (legacy drivers) |
| `{"command":"currentOp"}` | Exporter's own query |
| `{"appName":"OplogFetcher"}` | Replica set oplog replication |
| `{"appName":"QAN"}` | Percona QAN agent |
| `{"ns":"admin"}` / `{"ns":"local"}` | System database internals (`admin.$cmd`, `local.*`) |

`{"ns":"admin"}` uses **substring** matching on `ns` (not exact equality), so it also matches `admin.$cmd`.

Recommended production example:

```bash
CURRENTOP_IGNORE_KEYVALUE=[{"command":"hello"},{"command":"currentOp"},{"command":"isMaster"},{"appName":"OplogFetcher"},{"ns":"admin"},{"ns":"local"},{"appName":"QAN"}]
```

See [README — tip: filter system noise](../README.md#tip-filter-system-noise-in-production).

---

## 6. Data flow: MongoDB → alerts

```
MongoDB                          Exporter                    Prometheus/Grafana
────────                         ────────                    ──────────────────
local.oplog.rs  ──tail──►  log_to_metric_mongo_oplog{op,ns,...}
                              counter +1

admin currentOp ──20s──►  log_to_metric_mongo_currentop{secs_running,command,...}
                              counter +1

GET /metrics ◄── scrape ── Prometheus
                              │
                              ▼
                         Alert: secs_running > 30
                         Alert: planSummary = COLLSCAN
                         Alert: ns write rate spike
```

---

## 7. PromQL / Grafana alert examples

### Slow queries

```promql
# Ops running longer than 30 seconds (count in 5m window)
increase(log_to_metric_mongo_currentop{secs_running=~"[3-9][0-9]|[1-9][0-9]{2,}"}[5m]) > 0
```

### Full collection scan

```promql
increase(log_to_metric_mongo_currentop{planSummary=~".*COLLSCAN.*"}[5m]) > 0
```

### Slow queries from a specific app

```promql
increase(log_to_metric_mongo_currentop{appName="order-service",secs_running=~"[1-9][0-9]+"}[5m]) > 0
```

### Write spike on a collection

```promql
sum(increase(log_to_metric_mongo_oplog{ns="mydb.orders"}[5m])) > 10000
```

### Mass deletes

```promql
sum(increase(log_to_metric_mongo_oplog{ns="mydb.users",op="d"}[5m])) > 100
```

---

## 8. Prometheus scrape config

```yaml
scrape_configs:
  - job_name: mongo-oplog-exporter
    scrape_interval: 30s
    static_configs:
      - targets:
          - mongodb-0.mongodb.svc:5000
          - mongodb-1.mongodb.svc:5001
          - mongodb-2.mongodb.svc:5002
```

---

## 9. Metric behavior

| Property | Description |
|----------|-------------|
| Type | counter — each oplog/currentOp record increments by 1 |
| Reset on scrape | Registry cleared after each `/metrics` scrape — window counter semantics |
| Label source | Nearly **all** MongoDB document fields become labels |
| Cardinality | Configure `IGNORE_FIELD` + `IGNORE_KEYVALUE` on busy clusters |
| Truncation | `OPLOG_VALUE_LENGTH` / `CURRENTOP_VALUE_LENGTH` default to 1000 chars |

---

## 10. Related files

| File | Description |
|------|-------------|
| [`example.yaml`](../deploy/kubernetes/example.yaml) | Standard sidecar example (annotated) |
| [`production-sidecar.yaml`](../deploy/kubernetes/production-sidecar.yaml) | Production manifest |
| [`secret.example.yaml`](../deploy/kubernetes/secret.example.yaml) | MONGO_URL Secret template |
| [`README.md`](../README.md) | Project overview |
| [`README.zh-CN.md`](../README.zh-CN.md) | Chinese README summary |
