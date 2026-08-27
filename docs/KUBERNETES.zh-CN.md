# Kubernetes 部署与配置字段说明

[English](KUBERNETES.md)

> 对应清单文件：[`deploy/kubernetes/example.yaml`](../deploy/kubernetes/example.yaml)  
> 生产完整版：[`deploy/kubernetes/production-sidecar.yaml`](../deploy/kubernetes/production-sidecar.yaml)

---

## 1. 这个 Exporter 解决什么问题？

mongo-oplog-exporter 读取 MongoDB 两类实时数据，转成 Prometheus 指标：

| 数据源 | 解决的核心问题 |
|--------|----------------|
| **currentOp** | **慢查询**、**当前正在执行的语句**、谁在访问、是否全表扫描 |
| **oplog** | **谁在写什么**、哪个库表写入最频繁、异常批量变更 |

**典型运维场景：**

- 业务反馈「数据库慢」→ 看 `secs_running` + `planSummary` + `command`
- 想知道「现在谁在跑大 SQL」→ 看 currentOp 的 `query`、`ns`、`client`、`appName`
- 怀疑某表被误删/狂写 → 看 oplog 的 `op` + `ns` 增长率
- 分片迁移/复制噪音太多 → 用 `IGNORE_KEYVALUE` / `IGNORE_FIELD` 过滤

### 与其他工具对比

| 工具 | 特点 |
|------|------|
| **本 exporter** | 轻量、进 Prometheus、字段作 label 可灵活告警 |
| MongoDB Profiler | 更细粒度历史查询，但不直接进 Prometheus |
| mongodb_exporter | CPU/内存/连接数等 **服务器指标**，不含语句级 detail |
| PMM / Atlas | 功能全，需额外组件或云产品 |

### 能力边界（务必了解）

| 能力 | 说明 |
|------|------|
| 慢查询 | currentOp 默认 **20 秒**轮询，适合抓「跑得久」的操作；毫秒级一闪而过的 SQL 可能采不到 |
| 当前语句 | 采样时刻 `inprog` 里正在跑的操作，不是完整历史 |
| 写入审计 | oplog 只有 **写操作**（insert/update/delete），不含 read query |
| 指标形态 | counter + label，每次 Prometheus scrape 后 **registry 重置** |

---

## 2. Sidecar 部署架构

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
   业务连接                  Prometheus 抓取
   MONGO_URL=127.0.0.1:27017
```

多节点集群：每个 MongoDB Pod 一个 exporter，端口递增 `5000`、`5001`、`5002` …

---

## 3. example.yaml 逐字段说明

以下与 [`example.yaml`](../deploy/kubernetes/example.yaml) 一一对应。

### 3.1 核心连接

| env 变量 | 示例值 | 含义 |
|----------|--------|------|
| `OPEN_OPLOG` | `"true"` | 开启 oplog 流式采集 |
| `OPEN_CURRENTOP` | `"true"` | 开启 currentOp 轮询 |
| `PORT` | `"5000"` | HTTP 端口，暴露 `/metrics` |
| `MONGO_URL` | Secret 引用 | MongoDB URI；sidecar 连本 Pod `127.0.0.1:27017` |

### 3.2 Oplog 环境变量

| env 变量 | 示例值 | 含义 |
|----------|--------|------|
| `OPLOG_IGNORE_OP` | `'["n"]'` | 忽略 no-op 心跳操作 |
| `OPLOG_IGNORE_FIELD` | 见 yaml | 写入指标前 **删除** 这些 oplog 字段 |
| `OPENLOG_OPLOG` | `"false"` | 不打印 oplog 到 stdout（生产关闭） |
| `OPLOG_METRICS_TYPE` | `"counter"` | 每条 oplog counter +1 |
| `OPLOG_METRICS_NAME` | `log_to_metric_mongo_oplog` | Prometheus 指标名 |
| `OPLOG_INIT_LABEL` | 见下表 | 哪些 oplog 字段变成 Prometheus **label** |

### 3.3 CurrentOp 环境变量

| env 变量 | 示例值 | 含义 |
|----------|--------|------|
| `CURRENTOP_INTERVAL` | `"20000"` | 轮询间隔 **20 秒**（毫秒） |
| `CURRENTOP_IGNORE_OP` | `'["none"]'` | 不按 op 类型过滤 |
| `CURRENTOP_IGNORE_FIELD` | 见 yaml | 删除体积大/噪声字段 |
| `CURRENTOP_IGNORE_KEYVALUE` | 见 yaml | 整条操作按 key-value 过滤 |
| `OPENLOG_CURRENTOP` | `"false"` | 不打印 currentOp JSON |
| `CURRENTOP_METRICS_TYPE` | `"counter"` | counter 计数 |
| `CURRENTOP_METRICS_NAME` | `log_to_metric_mongo_currentop` | Prometheus 指标名 |
| `CURRENTOP_INIT_LABEL` | 见下表 | 哪些 currentOp 字段变成 **label** |

### 3.4 容器启动参数

| 参数 | 含义 |
|------|------|
| `--trace-warnings` | 输出 Node.js 警告，便于排障 |
| `--gc-interval=1000` | GC 间隔 1 秒，长期运行更稳 |
| `--max-old-space-size=2048` | 堆内存上限 2GB（oplog 流量大时需要） |
| `/home/app.js` | 镜像内入口文件 |

### 3.5 资源限制

| 字段 | 值 | 含义 |
|------|-----|------|
| `limits.cpu` | `1` | CPU 上限 1 核 |
| `limits.memory` | `1000Mi` | 内存上限 1GB |
| `requests.cpu` | `100m` | 调度预留 CPU |
| `requests.memory` | `256Mi` | 调度预留内存 |

---

## 4. OPLOG_INIT_LABEL 每个 label 含义

oplog 文档中的字段 → Prometheus label，用于 **`log_to_metric_mongo_oplog`** 指标。

| Label | 含义 | 告警/分析用途 |
|-------|------|---------------|
| `op` | 操作类型：`i` insert / `u` update / `d` delete / `c` command | 区分读写类型 |
| `ns` | 命名空间 `db.collection` | **热点表**、按表统计写入 |
| `node_name` | 节点名 | 多节点区分来源 |
| `service_name` | 服务名 | 业务维度 |
| `t` | 操作类型分类 | 内部分类 |
| `cluster` | 集群标识 | 多集群环境 |
| `v` | oplog 格式版本 | 一般不用告警 |
| `o2` | update/delete 的查询条件 | 定位更新了哪些文档 |
| `lsid` | 逻辑会话 ID | 关联同会话操作 |
| `ui` | 用户标识 UUID | 会话追踪 |
| `prevOpTime` | 上一条 op 时间戳 | 复制相关 |
| `stmtId` | 语句 ID | 事务内语句 |
| `ts` | oplog 时间戳 | 时间序列（已从文档删除但仍可在 init 声明） |
| `txnNumber` | 事务序号 | 事务追踪 |
| `wall` | wall clock 时间 | 时间参考 |
| `preImageOpTime` | 变更前镜像 op 时间 | 变更流 |
| `writeConflicts` | 写冲突次数 | 并发写冲突 |
| `transaction` | 事务相关信息 | 事务操作识别 |
| `fromMigrate` | 是否 chunk 迁移产生 | 过滤分片迁移噪音 |

### OPLOG_IGNORE_FIELD 为何忽略？

| 被忽略字段 | 原因 |
|------------|------|
| `lsid`, `ui`, `stmtId`, `txnNumber` | 会话/事务内部 ID，label 价值低 |
| `ts`, `wall`, `prevOpTime` | 时间类，label 基数爆炸 |
| `o`, `o2` | 文档/条件内容 **太大**，超过 label 长度 |
| `h` | oplog history hash，复制内部 |
| `postImageOpTime`, `fromMigrate` | 迁移/镜像相关噪音 |

---

## 5. CURRENTOP_INIT_LABEL 每个 label 含义

currentOp `inprog[]` 中每条操作 → Prometheus label，用于 **`log_to_metric_mongo_currentop`**。

### 5.1 慢查询 / 语句排查（最重要）

| Label | 含义 | 典型用途 |
|-------|------|----------|
| **`secs_running`** | 操作已运行 **秒数** | **慢查询核心**：>30s 告警 |
| **`microsecs_running`** | 已运行 **微秒数** | 更精细耗时 |
| **`command`** | 完整命令 BSON/JSON | 看 filter、sort、pipeline、具体 SQL 结构 |
| **`query`** | 查询部分 | 当前查询语句 |
| **`planSummary`** | 执行计划摘要 | `COLLSCAN`=全表扫、`IXSCAN`=索引扫 |
| `ns` | `db.collection` | 定位哪张表 |
| `op` | 操作类型 | `query` / `insert` / `update` / `getmore` / `command` |

### 5.2 来源与连接

| Label | 含义 |
|-------|------|
| `client` | 客户端地址 `ip:port` |
| `clientip` | 从 `client` 拆出的 IP（代码自动添加） |
| `appName` | 应用名（MongoDB 驱动设置，如 Java 应用名） |
| `connectionId` | 连接 ID |
| `effectiveUsers` | 当前有效用户 |
| `clientMetadata` | 驱动/OS/版本等元数据 |

### 5.3 状态与内部信息

| Label | 含义 |
|-------|------|
| `active` | 是否活跃（`true`=正在执行） |
| `desc` | 当前阶段描述 |
| `host` | mongod 主机名 |
| `type` | 操作大类 |
| `t` | 线程/操作分类 |
| `v` | 协议版本 |
| `opid` | 操作 ID |
| `waitingForLatch` | 是否在等待 latch |
| `cursor` | 游标信息（getMore 场景） |
| `originatingCommand` | 源命令（聚合子阶段等） |
| `writeConflicts` | 写冲突 |
| `transaction` | 事务信息 |
| `preImageOpTime` / `postImageOpTime` | 变更流镜像时间 |
| `fromMigrate` | 是否迁移相关 |
| `exporter_type` | 固定值 `currentOp`，区分指标来源 |

### CURRENTOP_IGNORE_FIELD 为何忽略？

| 被忽略字段 | 原因 |
|------------|------|
| `locks`, `lockStats`, `waitingForLock` | 锁结构 **极大**，label 爆炸 |
| `flowControlStats`, `waitingForFlowControl` | 流控细节 |
| `numYields`, `threadId` | 调度内部信息 |
| `clientMetadata`, `command.$clusterTime` | 体积大、重复多 |
| `currentOpTime`, `lsid` | 噪声 |

### CURRENTOP_IGNORE_KEYVALUE 过滤规则

**默认值为 `[]`（不过滤）**，系统命令也会进入指标。生产环境建议按下面配置过滤噪声。

| 条件 | 过滤原因 |
|------|----------|
| `{"command":"hello"}` | 驱动心跳 |
| `{"command":"isMaster"}` | 拓扑探测（旧驱动） |
| `{"command":"currentOp"}` | exporter 自身查询 |
| `{"appName":"OplogFetcher"}` | 副本集复制拉 oplog |
| `{"appName":"QAN"}` | Percona QAN 监控 |
| `{"ns":"admin"}` / `{"ns":"local"}` | 系统库内部操作（含 `admin.$cmd`、`local.*`） |

`{"ns":"admin"}` 对 `ns` 做**子串匹配**（不是精确相等），因此也会匹配 `admin.$cmd`。

推荐生产配置示例：

```bash
CURRENTOP_IGNORE_KEYVALUE=[{"command":"hello"},{"command":"currentOp"},{"command":"isMaster"},{"appName":"OplogFetcher"},{"ns":"admin"},{"ns":"local"},{"appName":"QAN"}]
```

详见 [README — 提示：过滤系统噪声](../README.md#tip-filter-system-noise-in-production)。

---

## 6. 数据流：从 MongoDB 到告警

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
                         告警：secs_running > 30
                         告警：planSummary = COLLSCAN
                         告警：ns 写入速率突增
```

---

## 7. PromQL / Grafana 告警示例

### 慢查询

```promql
# 运行超过 30 秒的操作（5 分钟窗口内有计数即告警）
increase(log_to_metric_mongo_currentop{secs_running=~"[3-9][0-9]|[1-9][0-9]{2,}"}[5m]) > 0
```

### 全表扫描

```promql
increase(log_to_metric_mongo_currentop{planSummary=~".*COLLSCAN.*"}[5m]) > 0
```

### 特定应用慢查询

```promql
increase(log_to_metric_mongo_currentop{appName="order-service",secs_running=~"[1-9][0-9]+"}[5m]) > 0
```

### 某表写入突增

```promql
sum(increase(log_to_metric_mongo_oplog{ns="mydb.orders"}[5m])) > 10000
```

### 大量 delete

```promql
sum(increase(log_to_metric_mongo_oplog{ns="mydb.users",op="d"}[5m])) > 100
```

---

## 8. Prometheus 抓取配置

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

## 9. 指标行为说明

| 特性 | 说明 |
|------|------|
| 指标类型 | counter，每条 oplog/currentOp 记录 +1 |
| scrape 后重置 | 每次 `/metrics` 被 Prometheus 抓取后 registry 清空，相当于窗口计数 |
| label 来源 | MongoDB 文档字段几乎 **全部** 转为 label |
| 基数控制 | 务必配置 `IGNORE_FIELD` + `IGNORE_KEYVALUE`，否则高流量集群 label 爆炸 |
| 长字段截断 | `OPLOG_VALUE_LENGTH` / `CURRENTOP_VALUE_LENGTH` 默认 1000 字符 |

---

## 10. 相关文件

| 文件 | 说明 |
|------|------|
| [`example.yaml`](../deploy/kubernetes/example.yaml) | 标准 sidecar 示例 |
| [`production-sidecar.yaml`](../deploy/kubernetes/production-sidecar.yaml) | 生产配置 |
| [`secret.example.yaml`](../deploy/kubernetes/secret.example.yaml) | MONGO_URL Secret 模板 |
| [`README.md`](../README.md) | 项目总览 |
| [`README.zh-CN.md`](../README.zh-CN.md) | 中文简版 README |
