# 三段取样与称量校准准入台（原墨锭试磨室）

墨锭建档、三段取样、天平校准准入与复核留档。

运行：

```bash
npm start
```

访问 `http://localhost:3037`。数据保存在 `data/ink-stick-testing.json`（旧版建档/评分数据启动时自动迁移，旧试磨记录只读留档）。

## 业务文件拆分

| 文件 | 职责 |
| --- | --- |
| `src/requestEntry.js` | 请求入口：HTTP 路由与全部表单提交处理 |
| `src/decisionRules.js` | 判定规则：纯函数，不碰 HTTP 与存储 |
| `src/recordStore.js` | 记录存储：JSON 持久化、串行写锁、幂等键、旧数据迁移 |
| `src/page.js` | 页面与前端脚本（卡片、统计、单锭记录共用一次加载） |
| `server.js` | 启动引导，仅负责监听端口 |

## 判定规则

- 每锭只保留**一条未结束试磨**；重复或并发开磨沿用首次提交（`clientKey` 幂等）。
- 结束试磨时：
  - 天平校准时间缺失或距今**超过 8 小时** → 仅转 **待复采**，不计入已试磨；
  - 前、中、后三段出墨量**任一段缺测** → 仅转 **待复采**，不计入已试磨；
  - 三段合计**不在 120–180 毫克**（含边界）→ 转 **待复核**，复核须**换人并重称**三段；
  - 校准有效、三段齐称、合计达标 → 准入 **已试磨**。
- 待复核期间不能新开试磨；复核人不得与初试人相同，且三段必须全部重新称量。
- **修正烟料来源、胶料比例，或已结束试磨的任一段重量，原结论立即失效**：该份试磨整份留档（`archived`），墨锭转待复采重新取样。试磨中的段重量修正直接改正并记录。
- 准入状态只能由判定流转，接口拒绝手工改判；“重点观察”仍可人工标记。

## 接口

- `GET /api/sticks` / `GET /api/sticks/:id` / `POST /api/sticks`
- `POST /api/sticks/:id/trials` 开磨（登记开磨人与天平校准时间）
- `PUT /api/sticks/:id/trials/:tid/segments` 录入三段出墨量（毫克）
- `POST /api/sticks/:id/trials/:tid/finish` 结束试磨并判定
- `POST /api/sticks/:id/trials/:tid/recheck` 换人复核重称
- `PATCH /api/sticks/:id/trials/:tid/correction` 修正三段重量
- `PATCH /api/sticks/:id/correction` 修正烟料 / 胶料
- `GET /api/stats`、`GET /api/flow-statuses`
