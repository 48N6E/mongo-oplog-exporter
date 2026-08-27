# mongo-oplog-exporter

[English README](README.md)

Prometheus exporter：采集 MongoDB **oplog** 与 **currentOp**，暴露为 Prometheus 指标。

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

## 功能

- **Oplog 采集**：对 `local.oplog.rs` 做 tailable cursor 流式监听
- **CurrentOp 采集**：周期性执行 `currentOp` 命令
- **Prometheus 暴露**：`GET /metrics` 供 Prometheus 抓取
- **灵活过滤**：通过环境变量忽略 op、字段、键值对
- **多种部署**：Docker / Docker Compose / Kubernetes 示例

## 解决什么问题？

| 需求 | 方式 |
|------|------|
| **快速发现慢查询** | currentOp → `secs_running`、`command`、`planSummary` |
| **看当前正在运行的语句** | 周期性采集 currentOp，含 `query`、`client`、`appName` |
| **写入审计 / 热点库表** | 实时 tail oplog → `op`、`ns`、写入速率 |
| **Prometheus 告警** | 指标 `log_to_metric_mongo_currentop` / `log_to_metric_mongo_oplog` |

详见 **[docs/KUBERNETES.zh-CN.md](docs/KUBERNETES.zh-CN.md)**（含 example.yaml 逐字段说明、全部 label 含义、PromQL 告警示例）

Grafana 面板示例（截图 + 可导入 JSON）：**[docs/grafana/README.md](docs/grafana/README.md)**

## 快速开始

### 前置要求

- Node.js >= 18
- MongoDB 副本集或主节点
- exporter 专用 MongoDB 用户

### 创建 MongoDB 用户

在 `admin` 库创建只读监控用户：

| 角色 | 库 | 用途 |
|------|-----|------|
| `clusterMonitor` | `admin` | 执行 `currentOp` |
| `read` | `local` | 读取 `local.oplog.rs` |

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

或使用脚本：`scripts/create-exporter-user.sh`

连接串（`authSource=admin` 必填）：

```
mongodb://exporter:change-me@<host>:27017/?authSource=admin
```

### 本地运行

```bash
cp config.example.json config.json
npm install && npm start
```

## 部署

详细步骤见 [English README — Deployment](README.md#deployment)，包括：

- **Docker Run** — `deploy/docker/docker-run.example.sh`
- **Docker Compose** — `docker compose up -d --build`
- **Kubernetes** — [`production-sidecar.yaml`](deploy/kubernetes/production-sidecar.yaml) + [字段说明](docs/KUBERNETES.zh-CN.md)

## 配置

环境变量优先级高于 `config.json`。完整变量表见 [English README — Configuration](README.md#configuration)。

### 提示：生产环境建议过滤系统噪声

**默认：** `CURRENTOP_IGNORE_KEYVALUE=[]` — **会采集** `admin.$cmd`、`hello`、`local.*` 等系统操作。配置过滤后，`ns` 等字段按**子串**匹配（例如 `{"ns":"admin"}` 也会匹配 `admin.$cmd`）。

**建议：** 高流量集群请自行配置过滤，降低心跳 / 复制 / 系统库噪声与 Prometheus 基数：

```bash
CURRENTOP_IGNORE_KEYVALUE=[{"command":"hello"},{"command":"currentOp"},{"command":"isMaster"},{"appName":"OplogFetcher"},{"ns":"admin"},{"ns":"local"},{"appName":"QAN"}]
```

| 条件 | 原因 |
|------|------|
| `{"command":"hello"}` / `{"command":"isMaster"}` | 驱动心跳 / 拓扑探测 |
| `{"command":"currentOp"}` | exporter 自身轮询 |
| `{"appName":"OplogFetcher"}` / `{"appName":"QAN"}` | 复制拉 oplog / QAN |
| `{"ns":"admin"}` / `{"ns":"local"}` | 系统库操作（含 `admin.$cmd`） |

**oplog** 默认仍只忽略 `op=n`（不按 `ns` 过滤）。

详见 [docs/KUBERNETES.zh-CN.md — CURRENTOP_IGNORE_KEYVALUE](docs/KUBERNETES.zh-CN.md#currentop_ignore_keyvalue-过滤规则)。

## 指标样例

默认不过滤时，`GET /metrics` 中可能出现系统操作（`hello`、exporter 自身的 `currentOp` 等，常见 `ns=admin.cmd`）：

```text
# HELP log_to_metric_mongo_currentop log_to_metric_mongo_currentop
# TYPE log_to_metric_mongo_currentop counter
log_to_metric_mongo_currentop{type="op",host="644eefa4f855_27017",desc="conn53",connectionId="53",clientip="172.17.0.1",client="172.17.0.1_46010",active="true",effectiveUsers="[user_exporter,db_admin]",opid="187254",secs_running="0",microsecs_running="131",op="command",ns="admin.cmd.aggregate",command="currentOp_1,lsid_id_...,db_admin"} 1
log_to_metric_mongo_currentop{type="op",host="644eefa4f855_27017",desc="conn51",connectionId="51",clientip="172.17.0.1",client="172.17.0.1_45992",active="true",opid="187391",secs_running="9",microsecs_running="9430152",op="command",ns="admin.cmd",command="hello_1,maxAwaitTimeMS_10000,...,db_admin",waitingForLatch="timestamp_...,captureName_AnonymousLatch"} 1
```

完整说明与生产过滤建议见 [English README — Metrics](README.md#metrics)。

## License

[GPL-3.0](LICENSE)
