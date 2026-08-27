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

## License

[GPL-3.0](LICENSE)
