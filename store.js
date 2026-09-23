// 三段取样与称量校准准入台 —— 记录存储（JSON 持久化、按墨锭串行化、旧档迁移）

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const dbPath = join(__dirname, "data", "ink-stick-testing.json");
export const DB_VERSION = 2;

const locks = new Map(); // code -> Promise（保证同一锭的写操作串行，重复/并发提交沿用首次）

// 对同一墨锭的变更串行执行；不同墨锭互不阻塞
export async function withLock(code, task) {
  const previous = locks.get(code) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  locks.set(code, previous.then(() => current));
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (locks.get(code) === current) locks.delete(code);
  }
}

function hoursAgo(h) {
  return new Date(Date.now() - h * 3600_000).toISOString();
}
function minutesAgo(m) {
  return new Date(Date.now() - m * 60_000).toISOString();
}

function seedDb() {
  const now = new Date().toISOString();
  return {
    version: DB_VERSION,
    items: [
      {
        code: "IS-101",
        smokeSource: "黄山松烟",
        glueRatio: "7.5%",
        ageYears: 8,
        storage: "恒湿柜B",
        status: "已试磨",
        trials: [
          {
            id: "T-seed-101",
            openedAt: hoursAgo(26),
            openedBy: "周砚农",
            finishedAt: hoursAgo(25),
            conclusion: "已试磨",
            calibrationAt: hoursAgo(25),
            weighedBy: "周砚农",
            segments: { front: 42.5, middle: 58.0, back: 51.2 },
            total: 151.7,
            lastResult: "已试磨",
            attempts: [
              {
                at: hoursAgo(25),
                kind: "采样称量",
                by: "周砚农",
                calibrationAt: hoursAgo(25),
                segments: { front: 42.5, middle: 58.0, back: 51.2 },
                total: 151.7,
                result: "已试磨",
                reasons: [],
              },
            ],
            archives: [],
          },
        ],
        logs: [
          { at: hoursAgo(26), step: "建档", note: "墨锭 IS-101 建档，等待试磨" },
          { at: hoursAgo(25), step: "判定", note: "三段称量通过：合计151.7mg，天平校准有效，准入「已试磨」" },
        ],
      },
      {
        code: "IS-102",
        smokeSource: "桐油烟",
        glueRatio: "8%",
        ageYears: 3,
        storage: "试样盒C",
        status: "待复采",
        trials: [
          {
            id: "T-seed-102",
            openedAt: hoursAgo(30),
            openedBy: "李慕墨",
            finishedAt: null,
            conclusion: null,
            calibrationAt: hoursAgo(12),
            weighedBy: "李慕墨",
            segments: { front: 46.0, middle: 52.3, back: null },
            total: null,
            lastResult: "待复采",
            attempts: [
              {
                at: hoursAgo(12),
                kind: "采样称量",
                by: "李慕墨",
                calibrationAt: hoursAgo(12),
                segments: { front: 46.0, middle: 52.3, back: null },
                total: null,
                result: "待复采",
                reasons: ["缺少后段出墨量", "天平校准已超过8小时"],
              },
            ],
            archives: [],
          },
        ],
        logs: [
          { at: hoursAgo(30), step: "建档", note: "墨锭 IS-102 建档，等待试磨" },
          { at: hoursAgo(30), step: "试磨", note: "开启试磨（首次提交）T-seed-102，负责人：李慕墨" },
          { at: hoursAgo(12), step: "判定", note: "T-seed-102 转「待复采」：缺少后段出墨量；天平校准已超过8小时" },
        ],
      },
      {
        code: "IS-103",
        smokeSource: "漆烟",
        glueRatio: "9%",
        ageYears: 5,
        storage: "陈架A2",
        status: "待复核",
        trials: [
          {
            id: "T-seed-103",
            openedAt: hoursAgo(8),
            openedBy: "苏墨卿",
            finishedAt: null,
            conclusion: null,
            calibrationAt: hoursAgo(2),
            weighedBy: "苏墨卿",
            segments: { front: 35.0, middle: 40.0, back: 38.0 },
            total: 113.0,
            lastResult: "待复核",
            attempts: [
              {
                at: hoursAgo(1),
                kind: "采样称量",
                by: "苏墨卿",
                calibrationAt: hoursAgo(2),
                segments: { front: 35.0, middle: 40.0, back: 38.0 },
                total: 113.0,
                result: "待复核",
                reasons: ["三段合计113mg不在120–180mg区间，转待复核（须换人重称）"],
              },
            ],
            archives: [],
          },
        ],
        logs: [
          { at: hoursAgo(8), step: "建档", note: "墨锭 IS-103 建档，等待试磨" },
          { at: hoursAgo(8), step: "试磨", note: "开启试磨（首次提交）T-seed-103，负责人：苏墨卿" },
          { at: hoursAgo(1), step: "判定", note: "T-seed-103 转「待复核」：三段合计113mg不在120–180mg区间，转待复核（须换人重称）" },
        ],
      },
      {
        code: "IS-104",
        smokeSource: "工业炭黑",
        glueRatio: "7%",
        ageYears: 1,
        storage: "待检区D",
        status: "试磨中",
        trials: [
          {
            id: "T-seed-104",
            openedAt: minutesAgo(40),
            openedBy: "韩松",
            finishedAt: null,
            conclusion: null,
            calibrationAt: null,
            weighedBy: null,
            segments: { front: null, middle: null, back: null },
            total: null,
            lastResult: null,
            attempts: [],
            archives: [],
          },
        ],
        logs: [
          { at: minutesAgo(40), step: "建档", note: "墨锭 IS-104 建档，等待试磨" },
          { at: minutesAgo(40), step: "试磨", note: "开启试磨（首次提交）T-seed-104，负责人：韩松" },
        ],
      },
      {
        code: "IS-105",
        smokeSource: "黄山松烟",
        glueRatio: "8.5%",
        ageYears: 12,
        storage: "恒湿柜B",
        status: "待试磨",
        trials: [],
        logs: [{ at: hoursAgo(3), step: "建档", note: "墨锭 IS-105 建档，等待试磨" }],
      },
      {
        code: "IS-106",
        smokeSource: "桐油烟（已修正）",
        glueRatio: "8%",
        ageYears: 6,
        storage: "陈架A1",
        status: "待试磨",
        trials: [
          {
            id: "T-seed-106",
            openedAt: hoursAgo(72),
            openedBy: "周砚农",
            finishedAt: hoursAgo(70),
            conclusion: "已失效",
            invalidatedAt: hoursAgo(6),
            invalidReason: "烟料来源「桐油烟」→「桐油烟（已修正）」",
            calibrationAt: hoursAgo(70),
            weighedBy: "周砚农",
            segments: { front: 44.0, middle: 60.0, back: 54.0 },
            total: 158.0,
            lastResult: "已试磨",
            attempts: [
              {
                at: hoursAgo(70),
                kind: "采样称量",
                by: "周砚农",
                calibrationAt: hoursAgo(70),
                segments: { front: 44.0, middle: 60.0, back: 54.0 },
                total: 158.0,
                result: "已试磨",
                reasons: [],
              },
            ],
            archives: [
              {
                at: hoursAgo(6),
                by: "李慕墨",
                kind: "档案修正",
                reason: "烟料来源「桐油烟」→「桐油烟（已修正）」",
                changes: { smokeSource: ["桐油烟", "桐油烟（已修正）"] },
                snapshot: {
                  conclusion: "已试磨",
                  finishedAt: hoursAgo(70),
                  calibrationAt: hoursAgo(70),
                  segments: { front: 44.0, middle: 60.0, back: 54.0 },
                  total: 158.0,
                  weighedBy: "周砚农",
                },
              },
            ],
          },
        ],
        logs: [
          { at: hoursAgo(72), step: "建档", note: "墨锭 IS-106 建档，等待试磨" },
          { at: hoursAgo(70), step: "判定", note: "三段称量通过：合计158mg，天平校准有效，准入「已试磨」" },
          { at: hoursAgo(6), step: "留档", note: "烟料/胶料修正（烟料来源「桐油烟」→「桐油烟（已修正）」），1条原「已试磨」结论失效留档：T-seed-106" },
        ],
      },
    ],
  };
}

// 旧版墨锭试磨室数据迁移：旧的「已试磨」没有三段采样，一律不算，转待复采
function migrate(raw) {
  const db = raw && typeof raw === "object" && Array.isArray(raw.items) ? raw : seedDb();
  if (db.version === DB_VERSION) return db;
  for (const item of db.items) {
    item.trials ||= [];
    item.logs ||= [];
    if (!["待试磨", "试磨中", "待复采", "待复核", "已试磨"].includes(item.status)) {
      item.status = item.trials.length ? "试磨中" : "待试磨";
    }
    if (item.status === "已试磨" && !item.trials.some((t) => t.conclusion === "已试磨")) {
      item.status = "待复采";
      item.logs.push({
        at: new Date().toISOString(),
        step: "迁移",
        note: "旧版「已试磨」缺少前中后三段出墨量，按新规不计入已试磨，转待复采",
      });
    }
  }
  db.version = DB_VERSION;
  return db;
}

let cache = null;

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seedDb(), null, 2));
    cache = JSON.parse(await readFile(dbPath, "utf8"));
    return cache;
  }
  if (!cache) cache = migrate(JSON.parse(await readFile(dbPath, "utf8")));
  return cache;
}

export async function saveDb(db) {
  cache = db;
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

export function findByCode(db, code) {
  return db.items.find((x) => x.code === code || x.id === code);
}
