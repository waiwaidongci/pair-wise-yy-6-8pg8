// 启动引导：HTTP 服务仅负责监听，业务全部在 src/ 三个业务文件中
//   src/requestEntry.js  请求入口（HTTP 路由与表单提交处理）
//   src/decisionRules.js 判定规则（三段取样、天平校准、复核与失效留档）
//   src/recordStore.js   记录存储（JSON 持久化、串行写锁、幂等键、旧数据迁移）

import http from "node:http";
import { handle } from "./src/requestEntry.js";

const port = Number(process.env.PORT || 3037);
const server = http.createServer((req, res) => {
  handle(req, res);
});
server.listen(port, () => console.log("三段取样与称量校准准入台 listening on http://localhost:" + port));
