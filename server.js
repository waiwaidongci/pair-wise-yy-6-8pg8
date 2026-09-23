// 三段取样与称量校准准入台 —— 请求入口（HTTP 路由；判定见 rules.js，记录存储见 store.js）

import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDb, saveDb, findByCode, withLock } from "./store.js";
import {
  computeStats,
  buildItem,
  openTrial,
  submitSampling,
  submitRecheck,
  correctProfile,
  correctSegment,
} from "./rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3037);

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const err = new Error("请求体不是合法 JSON");
    err.status = 400;
    err.code = "bad_json";
    throw err;
  }
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function sendError(res, error) {
  send(res, error.status || 500, {
    error: error.code || "internal_error",
    message: error.message,
    ...(error.reasons && error.reasons.length ? { reasons: error.reasons } : {}),
  });
}

async function mutate(res, code, fn) {
  try {
    return await withLock(code, async () => {
      const db = await loadDb();
      const result = await fn(db);
      await saveDb(db);
      return result;
    });
  } catch (error) {
    sendError(res, error);
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = decodeURIComponent(url.pathname);

    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      const page = await readFile(join(__dirname, "public", "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page);
    }

    if (req.method === "GET" && p === "/api/items") {
      const db = await loadDb();
      return send(res, 200, db.items);
    }
    if (req.method === "GET" && p === "/api/stats") {
      const db = await loadDb();
      return send(res, 200, computeStats(db.items));
    }

    const itemMatch = p.match(/^\/api\/items\/([^/]+)(?:\/trials\/([^/]+)\/(sampling|recheck|segment))?\/?$/);
    if (itemMatch) {
      const [, code, trialId, action] = itemMatch;

      // 单锭记录：刷新后卡片、统计、单锭记录同源同步
      if (!action && req.method === "GET") {
        const db = await loadDb();
        const item = findByCode(db, code);
        if (!item) return send(res, 404, { error: "item_not_found", message: "墨锭不存在" });
        return send(res, 200, item);
      }

      if (!action && req.method === "POST") {
        // POST /api/items/:code 由下方建档路由处理（code 在 body 中）
      }

      if (action === "sampling" && req.method === "POST") {
        const input = await readBody(req);
        const out = await mutate(res, code, (db) => {
          const item = findByCode(db, code);
          if (!item) throw Object.assign(new Error("墨锭不存在"), { status: 404, code: "item_not_found" });
          return submitSampling(item, trialId, input);
        });
        if (out) return send(res, 201, out);
        return;
      }
      if (action === "recheck" && req.method === "POST") {
        const input = await readBody(req);
        const out = await mutate(res, code, (db) => {
          const item = findByCode(db, code);
          if (!item) throw Object.assign(new Error("墨锭不存在"), { status: 404, code: "item_not_found" });
          return submitRecheck(item, trialId, input);
        });
        if (out) return send(res, 201, out);
        return;
      }
      if (action === "segment" && req.method === "PATCH") {
        const input = await readBody(req);
        const out = await mutate(res, code, (db) => {
          const item = findByCode(db, code);
          if (!item) throw Object.assign(new Error("墨锭不存在"), { status: 404, code: "item_not_found" });
          return correctSegment(item, trialId, input);
        });
        if (out) return send(res, 200, out);
        return;
      }
    }

    const profileMatch = p.match(/^\/api\/items\/([^/]+)\/profile\/?$/);
    if (profileMatch && req.method === "PATCH") {
      const code = profileMatch[1];
      const patch = await readBody(req);
      const out = await mutate(res, code, (db) => {
        const item = findByCode(db, code);
        if (!item) throw Object.assign(new Error("墨锭不存在"), { status: 404, code: "item_not_found" });
        return correctProfile(item, patch);
      });
      if (out) return send(res, 200, out.item);
      return;
    }

    const trialsMatch = p.match(/^\/api\/items\/([^/]+)\/trials\/?$/);
    if (trialsMatch && req.method === "POST") {
      const code = trialsMatch[1];
      const input = await readBody(req);
      const out = await mutate(res, code, (db) => {
        const item = findByCode(db, code);
        if (!item) throw Object.assign(new Error("墨锭不存在"), { status: 404, code: "item_not_found" });
        return openTrial(item, input);
      });
      if (out) return send(res, 201, out);
      return;
    }

    if (req.method === "POST" && p === "/api/items") {
      const input = await readBody(req);
      const code = (input.code || "").trim();
      if (!code) return send(res, 400, { error: "code_required", message: "墨锭编号不能为空" });
      const out = await mutate(res, code, (db) => {
        if (findByCode(db, code)) {
          throw Object.assign(new Error("墨锭编号已存在"), { status: 409, code: "duplicate_code" });
        }
        const item = buildItem(input);
        db.items.unshift(item);
        return item;
      });
      if (out) return send(res, 201, out);
      return;
    }

    return send(res, 404, { error: "not_found", message: "接口不存在" });
  } catch (error) {
    return sendError(res, error);
  }
});

server.listen(port, () => console.log("三段取样与称量校准准入台 listening on http://localhost:" + port));
