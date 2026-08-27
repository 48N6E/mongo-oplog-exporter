# mongo-oplog-exporter

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)

Prometheus exporter that tails MongoDB **oplog** and polls **currentOp**, exposing operations as Prometheus metrics.

[中文文档](README.zh-CN.md)

## Features

- **Oplog tailing** — tailable cursor on `local.oplog.rs` for real-time write operations
- **CurrentOp polling** — periodic `{ currentOp: 1 }` for in-flight operations
- **Prometheus `/metrics`** — scrape-friendly HTTP endpoint
- **Flexible filtering** — ignore ops, fields, and key-value pairs via env vars
- **Production-ready deploys** — Docker, Docker Compose, and Kubernetes examples included

## What problems does it solve?

| Need | How |
|------|-----|
| **Slow queries** | `currentOp` → `secs_running`, `command`, `planSummary` as Prometheus labels |
| **Active statements now** | Poll `currentOp` every N seconds; see `query`, `op`, `client`, `appName` |
| **Write audit / hot collections** | Tail `oplog` → `op`, `ns`, write rate per collection |
| **Alert in Prometheus/Grafana** | Counter metrics `log_to_metric_mongo_currentop` / `log_to_metric_mongo_oplog` |

Full guide: **[docs/KUBERNETES.md](docs/KUBERNETES.md)** · **[docs/KUBERNETES.zh-CN.md](docs/KUBERNETES.zh-CN.md)** (use cases, every env var & label, PromQL alerts)

Grafana dashboard example (screenshots + importable JSON): **[docs/grafana/README.md](docs/grafana/README.md)**

## Quick start

### Prerequisites

- Node.js >= 18
- MongoDB replica set or primary (oplog requires a replica set)
- Dedicated MongoDB user for the exporter ([setup below](#mongodb-user-setup))

### MongoDB user setup

Create a read-only monitoring user in the `admin` database:

| Role | Database | Purpose |
|------|----------|---------|
| `clusterMonitor` | `admin` | Run `currentOp` and cluster monitoring commands |
| `read` | `local` | Read `local.oplog.rs` |

**Option 1 — mongosh**

```javascript
use admin
db.createUser({
  user: "exporter",
  pwd: "change-me",
  roles: [
    { role: "clusterMonitor", db: "admin" },
    { role: "read", db: "local" }
  ]
})
```

**Option 2 — pipe via echo (scripts / init containers)**

```bash
echo 'db.createUser({user:"exporter",pwd:"change-me",roles:[{"role":"clusterMonitor","db":"admin"},{"role":"read","db":"local"}]})' \
  | mongosh "mongodb://admin:password@localhost:27017/admin"
```

**Option 3 — helper script**

```bash
chmod +x scripts/create-exporter-user.sh
MONGO_URI='mongodb://admin:password@localhost:27017/admin' \
EXPORTER_PWD='your-secure-password' \
./scripts/create-exporter-user.sh
```

Connection string (`authSource=admin` is required):

```
mongodb://exporter:change-me@<host>:27017/?authSource=admin
```

Use strong passwords in production. Inject credentials via secrets or environment variables — never commit them to Git.

### Run locally

```bash
cp config.example.json config.json
# Edit config.json with your MongoDB URI

npm install
npm start
```

Metrics: `http://0.0.0.0:7777/metrics`

## Deployment

### Docker Run

Pull from Docker Hub:

```bash
docker pull 48n6e/mongo-oplog-exporter:latest
```

Or build locally:

```bash
docker build -t 48n6e/mongo-oplog-exporter:latest .

docker run -d \
  --name mongo-oplog-exporter \
  --restart unless-stopped \
  -p 7777:7777 \
  -e MONGO_URL="mongodb://exporter:change-me@mongodb-host:27017/?authSource=admin" \
  -e MONGO_DIRECT_CONNECTION="true" \
  -e PORT="7777" \
  -e OPEN_OPLOG="true" \
  -e OPENLOG_OPLOG="false" \
  -e OPLOG_METRICS_TYPE="counter" \
  -e OPLOG_METRICS_NAME="log_to_metric_mongo_oplog" \
  -e 'OPLOG_IGNORE_OP=["n"]' \
  -e OPEN_CURRENTOP="true" \
  -e OPENLOG_CURRENTOP="false" \
  -e CURRENTOP_INTERVAL="20000" \
  -e CURRENTOP_METRICS_NAME="log_to_metric_mongo_currentop" \
  --memory=1000m \
  --cpus=1 \
  48n6e/mongo-oplog-exporter:latest \
  node --trace-warnings --gc-interval=1000 --max-old-space-size=2048 app.js

curl http://localhost:7777/metrics
```

When MongoDB runs on the host:
- **Windows / macOS**: use `host.docker.internal` in `MONGO_URL`
- **Linux**: use the host IP or `--network host`

Full example: [`deploy/docker/docker-run.example.sh`](deploy/docker/docker-run.example.sh)

### Docker Compose

```bash
cp .env.example .env
# Edit .env — set MONGO_URL at minimum

docker compose up -d --build
docker compose logs -f
curl http://localhost:7777/metrics
```

Stop: `docker compose down`

JSON array env vars (e.g. `OPLOG_IGNORE_OP`) use the same format as Kubernetes. `.env` is gitignored.

### Kubernetes

Typical pattern: run the exporter as a **sidecar** per MongoDB pod, with per-node ports (e.g. `5000`, `5001`).

```yaml
- name: mongo-oplog-exporter
  image: 48n6e/mongo-oplog-exporter:latest
  env:
    - name: MONGO_URL
      valueFrom:
        secretKeyRef:
          name: mongodb-exporter
          key: mongo-url
    - name: PORT
      value: "5000"
    - name: OPEN_OPLOG
      value: "true"
    - name: OPEN_CURRENTOP
      value: "true"
    - name: CURRENTOP_INTERVAL
      value: "20000"
    - name: OPLOG_METRICS_NAME
      value: "log_to_metric_mongo_oplog"
    - name: CURRENTOP_METRICS_NAME
      value: "log_to_metric_mongo_currentop"
  command:
    - node
    - --trace-warnings
    - --gc-interval=1000
    - --max-old-space-size=2048
    - /home/app.js
  resources:
    limits:
      cpu: "1"
      memory: "1000Mi"
```

Full manifest: [`deploy/kubernetes/production-sidecar.yaml`](deploy/kubernetes/production-sidecar.yaml)  
Field reference: **[docs/KUBERNETES.zh-CN.md](docs/KUBERNETES.zh-CN.md)**

Image workdir is `/home`. Use the read-only `exporter` account for `MONGO_URL`.

## Configuration

**Priority: environment variables > `config.json`**

Production deployments should inject all settings via env vars.

### Common variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGO_URL` | MongoDB connection URI | `mongodb://localhost:27017` |
| `MONGO_DIRECT_CONNECTION` | Direct single-node connection | `true` |
| `PORT` | HTTP / metrics port | `7777` |
| `OPEN_OPLOG` | Enable oplog collection | `true` |
| `OPEN_CURRENTOP` | Enable currentOp collection | `false` |
| `CURRENTOP_INTERVAL` | currentOp poll interval (ms) | `20000` |
| `OPENLOG_OPLOG` | Log each oplog document | `false` |
| `OPENLOG_CURRENTOP` | Log each currentOp response | `false` |

### Oplog tuning

| Variable | Description |
|----------|-------------|
| `OPLOG_IGNORE_OP` | Ignored op types, e.g. `'["n"]'` |
| `OPLOG_IGNORE_FIELD` | Fields stripped before labeling |
| `OPLOG_METRICS_TYPE` | `counter` or `gauge` |
| `OPLOG_METRICS_NAME` | Metric name (default: `log_to_metric_mongo_oplog`) |
| `OPLOG_INIT_LABEL` | Pre-declared counter labels |
| `OPLOG_VALUE_LENGTH` | Max label value length |

### CurrentOp tuning

| Variable | Description |
|----------|-------------|
| `CURRENTOP_IGNORE_OP` | Ignored op types |
| `CURRENTOP_IGNORE_FIELD` | Stripped fields (`locks`, `lockStats`, …) |
| `CURRENTOP_IGNORE_KEYVALUE` | Filter by key-value (hello, QAN, …) |
| `CURRENTOP_METRICS_TYPE` | `counter` or `gauge` |
| `CURRENTOP_METRICS_NAME` | Metric name (default: `log_to_metric_mongo_currentop`) |
| `CURRENTOP_INIT_LABEL` | Pre-declared counter labels |
| `CURRENTOP_VALUE_LENGTH` | Max label value length |

### Default filtering: `admin.$cmd` and system noise

**currentOp** (default): `CURRENTOP_IGNORE_KEYVALUE` includes `{"ns":"admin"}`. Matching uses **substring** on the `ns` label, so **`admin.$cmd`** and other `admin.*` namespaces are **not exported** to `log_to_metric_mongo_currentop`. This reduces noise from internal commands (`hello`, replication, etc. are filtered separately). **`local`** is filtered the same way.

**oplog** (default): only `OPLOG_IGNORE_OP=["n"]` — **no** `ns` filter. Writes to `admin.$cmd` still appear in `log_to_metric_mongo_oplog` if present in `local.oplog.rs`.

To **include** `admin` / `admin.$cmd` in currentOp metrics, remove `{"ns":"admin"}` from `CURRENTOP_IGNORE_KEYVALUE`, for example:

```bash
-e 'CURRENTOP_IGNORE_KEYVALUE=[{"command":"hello"},{"command":"currentOp"},{"command":"isMaster"},{"appName":"OplogFetcher"},{"ns":"local"},{"appName":"QAN"}]'
```

See [docs/KUBERNETES.md](docs/KUBERNETES.md) for the full filter table.

See [`config.example.json`](config.example.json) and [`.env.example`](.env.example).

## Prometheus

```yaml
scrape_configs:
  - job_name: mongo-oplog-exporter
    static_configs:
      - targets: ['localhost:7777']
```

## Metrics

| Name | Type | Source |
|------|------|--------|
| `log_to_metric_mongo_oplog` | counter | oplog document fields as labels |
| `log_to_metric_mongo_currentop` | counter | each `inprog` operation as labels |

Rename via `OPLOG_METRICS_NAME` / `CURRENTOP_METRICS_NAME`.

The metric registry **resets after each scrape**, so counters behave like window counters between scrapes.

## Project layout

```
├── app.js                      # Entry: MongoDB collectors + HTTP server
├── config.json                 # Default config (override via env vars in production)
├── config.example.json
├── .github/workflows/docker-publish.yml
├── docker-compose.yml
├── .env.example
├── scripts/create-exporter-user.sh
├── docs/
│   ├── grafana/              # Grafana dashboard JSON + screenshots
│   ├── KUBERNETES.zh-CN.md   # K8s 字段说明 + 使用场景 + 告警示例
│   └── KUBERNETES.md
├── deploy/
│   ├── kubernetes/
│   │   ├── production-sidecar.yaml  # 生产 sidecar 完整配置
│   │   ├── example.yaml
│   │   └── secret.example.yaml
├── controllers/metrics.js      # oplog/currentOp → Prometheus
├── routes/metrics.js           # GET /metrics
└── utils/rconfig.js
```

## License

Licensed under [GNU General Public License v3.0 (GPL-3.0)](LICENSE).

- Free to use, modify, and distribute
- Derivative works must remain open source under GPL-3.0
- Include copyright notice and LICENSE when redistributing
