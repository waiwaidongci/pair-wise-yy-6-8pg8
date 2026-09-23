# 三段取样与称量校准准入台（原「墨锭试磨室」）

运行：

```bash
npm start
```

访问 `http://localhost:3037`。数据保存在 `data/ink-stick-testing.json`。

## 业务拆分

| 文件 | 职责 |
| --- | --- |
| `server.js` | 请求入口：HTTP 路由、请求体解析、按墨锭加锁后调用规则 |
| `rules.js` | 判定规则：纯业务函数（不含 HTTP、不直接落盘） |
| `store.js` | 记录存储：JSON 持久化、旧档迁移、按墨锭串行锁 |
| `public/index.html` | 页面：卡片 / 统计 / 单锭记录三视图，刷新时同源同步重取 |

## 判定规则

1. **每锭只留一条未结束试磨**：重复或并发提交沿用首次那条（存储层按墨锭编号串行 + 规则层复用未结束试磨）。
2. **校准超 8 小时或缺少前/中/后任一段出墨量** → 转「待复采」，**不计入已试磨**；可在原试磨上补采后重新判定。
3. **三段合计不在 120–180mg** → 转「待复核」；复核**必须换人重称**（原称人提交复核将被拒绝），称齐三段且校准有效后重新判定。
4. **修正烟料、胶料，或任一段重量** → 原「已试磨」结论失效，快照留档（`archives`），日志登记；段重修正会把该试磨重新开放，须再次称量判定。
5. 状态：待试磨 / 试磨中 / 待复采 / 待复核 / 已试磨；另统计「失效留档」份数。

## 主要接口

- `GET /api/items` 卡片列表 · `GET /api/stats` 统计 · `GET /api/items/:code` 单锭记录
- `POST /api/items` 建档
- `POST /api/items/:code/trials` 首次提交开启试磨（重复/并发沿用首次）
- `POST /api/items/:code/trials/:id/sampling` 提交三段称量
- `POST /api/items/:code/trials/:id/recheck` 复核换人重称
- `PATCH /api/items/:code/profile` 修正烟料/胶料/年限/位置
- `PATCH /api/items/:code/trials/:id/segment` 修正任一段重量
