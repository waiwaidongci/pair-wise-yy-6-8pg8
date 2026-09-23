// 判定规则：三段取样与称量校准准入（纯函数，不碰 HTTP 与文件存储）

export const CALIBRATION_LIMIT_MS = 8 * 60 * 60 * 1000; // 天平校准有效期：8小时
export const TOTAL_MIN_MG = 120; // 三段合计下限（毫克）
export const TOTAL_MAX_MG = 180; // 三段合计上限（毫克）

export const STATUS = Object.freeze({
  PENDING: "待试磨",
  GRINDING: "试磨中",
  RESAMPLE: "待复采",
  RECHECK: "待复核",
  DONE: "已试磨",
  WATCH: "重点观察",
});

// 统计与筛选使用同一套状态顺序
export const FLOW_STATUSES = [
  STATUS.PENDING,
  STATUS.GRINDING,
  STATUS.RESAMPLE,
  STATUS.RECHECK,
  STATUS.DONE,
  STATUS.WATCH,
];

export const SEGMENTS = [
  ["front", "前段"],
  ["middle", "中段"],
  ["back", "后段"],
];

// 修正字段：烟料、胶料属于档案字段，seg* 属于三段重量
export const PROFILE_FIELDS = {
  smokeSource: "烟料来源",
  glueRatio: "胶料比例",
};
export const SEGMENT_FIELDS = {
  segFront: ["front", "前段重量"],
  segMiddle: ["middle", "中段重量"],
  segBack: ["back", "后段重量"],
};

export function round1(n) {
  return Math.round(n * 100) / 100;
}

// 出墨量归一：空值=null（缺测），非数字或负数=NaN（非法）
export function toMg(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") value = value?.mg;
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) && n >= 0 ? round1(n) : NaN;
}

export function findOpenTrial(item) {
  return (item.trials || []).find((t) => !t.archived && !t.finished);
}

export function latestLiveTrial(item) {
  const live = (item.trials || []).filter((t) => !t.archived);
  return live.length ? live[live.length - 1] : null;
}

export function trialTotalMg(trial) {
  let total = 0;
  for (const [key] of SEGMENTS) {
    const mg = toMg(trial?.segments?.[key]);
    if (!Number.isFinite(mg)) return null;
    total += mg;
  }
  return round1(total);
}

export function formatDuration(ms) {
  return (ms / 3600000).toFixed(1) + "小时";
}

// 核心准入判定：
// 1) 天平校准超8小时（或缺校准时间）→ 待复采；2) 前中后任一段缺测 → 待复采；
// 3) 三段合计不在 120–180 毫克 → 待复核（换人重称）；4) 全部满足 → 已试磨。
export function evaluateTrial(trial, now = Date.now()) {
  const missing = [];
  for (const [key, label] of SEGMENTS) {
    if (!Number.isFinite(toMg(trial?.segments?.[key]))) missing.push(label);
  }
  const calibratedAt = Date.parse(trial?.calibratedAt || "");
  const calibrationAgeMs = Number.isFinite(calibratedAt) ? now - calibratedAt : null;
  const noCalibration = calibrationAgeMs === null;
  const futureCalibration = calibrationAgeMs !== null && calibrationAgeMs < 0;
  const calibrationStale =
    noCalibration || futureCalibration || calibrationAgeMs > CALIBRATION_LIMIT_MS;
  const totalMg = missing.length ? null : trialTotalMg(trial);
  const reasons = [];

  if (noCalibration) reasons.push("缺少天平校准时间");
  else if (futureCalibration) reasons.push("天平校准时间晚于当前时间");
  else if (calibrationStale)
    reasons.push("天平校准已超过8小时（距今" + formatDuration(calibrationAgeMs) + "）");
  if (missing.length) reasons.push("缺少" + missing.join("、") + "出墨量");

  // 校准失效或缺段：只能转待复采，不计入已试磨
  if (calibrationStale || missing.length) {
    return { status: STATUS.RESAMPLE, totalMg, missing, calibrationAgeMs, reasons };
  }
  // 合计越界：只能待复核，复核须换人并重称
  if (totalMg < TOTAL_MIN_MG || totalMg > TOTAL_MAX_MG) {
    reasons.push(
      "三段合计" + totalMg + "毫克，不在" + TOTAL_MIN_MG + "至" + TOTAL_MAX_MG + "毫克区间，须换人复核并重称"
    );
    return { status: STATUS.RECHECK, totalMg, missing: [], calibrationAgeMs, reasons };
  }
  reasons.push("三段合计" + totalMg + "毫克，天平校准有效，准予计入已试磨");
  return { status: STATUS.DONE, totalMg, missing: [], calibrationAgeMs, reasons };
}

// 复核判定：换人（reviewer 与初试人不同）且三段全部重称，结论规则不变
export function evaluateRecheck({ trial, operator, calibratedAt, readings, now = Date.now() }) {
  if (!operator || !String(operator).trim()) {
    return { ok: false, error: "reviewer_required", message: "复核须填写复核人" };
  }
  if (trial && String(operator).trim() === String(trial.operator || "")) {
    return { ok: false, error: "reviewer_must_differ", message: "复核须换人，复核人不能与初试人相同" };
  }
  const missing = [];
  const segments = {};
  for (const [key, label] of SEGMENTS) {
    const mg = toMg(readings?.[key]);
    if (mg === null || Number.isNaN(mg)) missing.push(label);
    segments[key] = Number.isFinite(mg) ? { mg } : null;
  }
  if (missing.length) {
    return {
      ok: false,
      error: "reweigh_required",
      message: "复核须重新称齐前中后三段重量，缺少" + missing.join("、") + "出墨量",
    };
  }
  const judgement = evaluateTrial({ calibratedAt, segments }, now);
  return { ok: true, segments, judgement };
}

// 修正烟料、胶料或任一段重量，均使原结论失效
export function correctionKind(field) {
  if (PROFILE_FIELDS[field]) return { type: "profile", segment: null, label: PROFILE_FIELDS[field] };
  if (SEGMENT_FIELDS[field])
    return { type: "segment", segment: SEGMENT_FIELDS[field][0], label: SEGMENT_FIELDS[field][1] };
  return null;
}

export function computeStats(items) {
  const stats = Object.fromEntries(FLOW_STATUSES.map((s) => [s, 0]));
  for (const item of items) if (stats[item.status] !== undefined) stats[item.status] += 1;
  return stats;
}
