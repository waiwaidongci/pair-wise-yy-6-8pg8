// 记录存储：data/ink-stick-testing.json 的读写、迁移与并发串行化

import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATUS } from "./decisionRules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const dbPath = join(__dirname, "..", "data", "ink-stick-testing.json");

const seed = {
  items: [
    {
      id: "IS-001",
      code: "IS-001",
      smokeSource: "黄山松烟",
      glueRatio: "7.5%",
      ageYears: 8,
      storage: "恒湿柜B",
      status: STATUS.DONE,
      logs: [
        { at: "2026-06-11T09:20:00.000Z", step: "建档", note: "创建墨锭" },
        {
          at: "2026-06-11T09:30:00.000Z",
          step: "结束试磨",
          note: "三段合计148毫克，天平校准有效，准予计入已试磨",
        },
      ],
      trials: [
        {
          id: "IS-001-T1",
          seq: 1,
          openedAt: "2026-06-11T09:25:00.000Z",
          finishedAt: "2026-06-11T09:30:00.000Z",
          finished: true,
          archived: false,
          operator: "周砚农",
          calibratedAt: "2026-06-11T08:00:00.000Z",
          segments: {
            front: { mg: 50 },
            middle: { mg: 51 },
            back: { mg: 47 },
          },
          totalMg: 148,
          judgementStatus: STATUS.DONE,
          notes: ["宣纸20滴水，出墨快，评分86"],
        },
      ],
    },
    {
      id: "IS-002",
      code: "IS-002",
      smokeSource: "桐油烟",
      glueRatio: "8%",
      ageYears: 3,
      storage: "试样盒C",
      status: STATUS.PENDING,
      logs: [{ at: "2026-06-20T03:40:00.000Z", step: "建档", note: "创建墨锭" }],
      trials: [],
    },
  ],
  idempotency: {},
};

let cache = null;
let chain = Promise.resolve();

// 所有写操作排队执行，避免并发提交互相覆盖（重复/并发提交沿用首次）
export function mutate(worker) {
  const run = chain.then(() => worker(cache));
  chain = run
    .catch(() => {})
    .then(async () => {
      await persist();
    });
  return run;
}

export async function loadDb() {
  if (cache) return cache;
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    cache = structuredClone(seed);
    await persist();
    return cache;
  }
  const raw = JSON.parse(await readFile(dbPath, "utf8"));
  cache = migrate(raw);
  return cache;
}

async function persist() {
  const tmp = dbPath + ".tmp";
  await writeFile(tmp, JSON.stringify(cache, null, 2));
  await rename(tmp, dbPath);
}

// 旧版（建档/试磨/评分结构）数据迁移：旧试磨记录只读留档，不生成准入结论
function migrate(db) {
  db.items ||= [];
  db.idempotency ||= {};
  for (const item of db.items) {
    item.id ||= item.code || "IS-" + Math.random().toString(36).slice(2, 8);
    item.trials ||= [];
    let seq = item.trials.length;
    for (const trial of item.trials) {
      trial.seq ||= ++seq;
      trial.segments ||= {};
      trial.notes ||= [];
      trial.archived ||= false;
      trial.finished = Boolean(trial.finishedAt || trial.finished);
    }
    item.logs ||= [];
    if (!Object.values(STATUS).includes(item.status)) item.status = STATUS.PENDING;
  }
  return db;
}

export function makeStickId(now) {
  return "IS-" + now.toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
}
export function makeTrialId(item, seq, now) {
  return item.code + "-T" + seq + "-" + now.toString(36);
}
