// 三段取样与称量校准准入台 —— 判定规则（纯业务，不负责持久化与 HTTP）

export const STATUSES = ["待试磨", "试磨中", "待复采", "待复核", "已试磨"];
export const CALIBRATION_TTL_MS = 8 * 60 * 60 * 1000; // 天平校准有效期 8 小时
export const MIN_TOTAL_MG = 120;
export const MAX_TOTAL_MG = 180;
export const SEGMENTS = [
  ["front", "前段"],
  ["middle", "中段"],
  ["back", "后段"],
];

export function newTrialId(at = Date.now()) {
  return "T-" + new Date(at).getTime().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

function fail(status, code, message, reasons = []) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.reasons = reasons;
  return err;
}

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function parseMg(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

function pushLog(item, step, note, extra = {}) {
  item.logs.push({ at: new Date().toISOString(), step, note, ...extra });
}

export function findOpenTrial(item) {
  return item.trials.find((t) => !t.finishedAt && t.conclusion !== "已失效");
}

export function findTrial(item, trialId) {
  return item.trials.find((t) => t.id === trialId);
}

function checkCalibration(rawCalibrationAt, at) {
  const raw = text(rawCalibrationAt);
  if (!raw) return { iso: null, reasons: ["缺少天平校准时间"] };
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return { iso: null, reasons: ["天平校准时间无效"] };
  if (t > at) return { iso: null, reasons: ["天平校准时间晚于当前时间"] };
  const iso = new Date(t).toISOString();
  if (at - t > CALIBRATION_TTL_MS) {
    return { iso, reasons: ["天平校准已超过8小时"] };
  }
  return { iso, reasons: [] };
}

// 一次三段称量的判定：校准失效或缺段 -> 待复采；合计越界 -> 待复核；否则已试磨
export function evaluate(input, at = Date.now()) {
  const reasons = [];
  const segments = {};
  let complete = true;
  for (const [key, label] of SEGMENTS) {
    const mg = parseMg(input[key]);
    segments[key] = mg;
    if (mg === null) {
      complete = false;
      reasons.push(`缺少${label}出墨量`);
    } else if (Number.isNaN(mg)) {
      complete = false;
      reasons.push(`${label}出墨量不是有效数字`);
    }
  }
  const calibration = checkCalibration(input.calibrationAt, at);
  reasons.push(...calibration.reasons);
  const total = complete
    ? Math.round((segments.front + segments.middle + segments.back) * 100) / 100
    : null;
  if (reasons.length) return { result: "待复采", segments, total, reasons, calibrationAt: calibration.iso };
  if (total < MIN_TOTAL_MG || total > MAX_TOTAL_MG) {
    return {
      result: "待复核",
      segments,
      total,
      reasons: [`三段合计${total}mg不在120–180mg区间，转待复核（须换人重称）`],
      calibrationAt: calibration.iso,
    };
  }
  return { result: "已试磨", segments, total, reasons: [], calibrationAt: calibration.iso };
}

export function buildItem(input, at = new Date().toISOString()) {
  const code = text(input.code);
  if (!code) throw fail(400, "code_required", "墨锭编号不能为空");
  return {
    code,
    smokeSource: text(input.smokeSource),
    glueRatio: text(input.glueRatio),
    ageYears: input.ageYears === undefined || input.ageYears === "" ? null : Number(input.ageYears),
    storage: text(input.storage),
    status: "待试磨",
    trials: [],
    logs: [{ at, step: "建档", note: `墨锭 ${code} 建档，等待试磨` }],
  };
}

// 每锭只留一条未结束试磨；重复或并发提交沿用首次
export function openTrial(item, input = {}, at = new Date().toISOString()) {
  const operator = text(input.operator);
  if (!operator) throw fail(400, "operator_required", "缺少取样负责人");
  const existing = findOpenTrial(item);
  if (existing) {
    pushLog(item, "试磨", `重复/并发提交沿用首次试磨 ${existing.id}（首次提交人：${existing.openedBy}）`);
    return { trial: existing, reused: true };
  }
  const trial = {
    id: newTrialId(Date.parse(at)),
    openedAt: at,
    openedBy: operator,
    finishedAt: null,
    conclusion: null,
    calibrationAt: null,
    weighedBy: null,
    segments: { front: null, middle: null, back: null },
    total: null,
    lastResult: null,
    attempts: [],
    archives: [],
  };
  item.trials.unshift(trial);
  item.status = "试磨中";
  pushLog(item, "试磨", `开启试磨（首次提交）${trial.id}，负责人：${operator}`);
  return { trial, reused: false };
}

function requireOpenTrial(item, trialId) {
  const trial = findTrial(item, trialId);
  if (!trial) throw fail(404, "trial_not_found", "试磨记录不存在");
  if (trial.conclusion === "已失效") throw fail(400, "trial_invalidated", "该试磨已失效留档，请新开试磨");
  if (trial.finishedAt) throw fail(400, "trial_finished", "该试磨已结束，请新开试磨");
  return trial;
}

function recordWeighing(item, trial, input, kind, at) {
  const operator = text(input.operator);
  if (!operator) throw fail(400, "operator_required", "缺少称量/复核人");
  if (kind === "recheck") {
    if (item.status !== "待复核" || trial.lastResult !== "待复核") {
      throw fail(400, "not_review_pending", "当前没有待复核结论，不能提交复核重称");
    }
    const previous = trial.attempts[trial.attempts.length - 1];
    if (previous && previous.by === operator) {
      throw fail(400, "review_must_change_person", "复核须换人重称", [
        `原称人「${previous.by}」不得复核本人称量，请更换人员后重新称量三段重量`,
      ]);
    }
  }
  const ev = evaluate(input, Date.parse(at));
  const attempt = {
    at,
    kind: kind === "recheck" ? "复核重称" : "采样称量",
    by: operator,
    calibrationAt: ev.calibrationAt,
    segments: ev.segments,
    total: ev.total,
    result: ev.result,
    reasons: ev.reasons,
  };
  trial.attempts.push(attempt);
  trial.calibrationAt = ev.calibrationAt;
  trial.segments = ev.segments;
  trial.total = ev.total;
  trial.weighedBy = operator;
  trial.lastResult = ev.result;
  if (ev.result === "已试磨") {
    trial.finishedAt = at;
    trial.conclusion = "已试磨";
    item.status = "已试磨";
    pushLog(
      item,
      "判定",
      `${kind === "recheck" ? "复核重称" : "三段称量"}通过：合计${ev.total}mg，天平校准有效，准入「已试磨」`,
      { trialId: trial.id, total: ev.total }
    );
  } else {
    item.status = ev.result;
    pushLog(item, "判定", `${trial.id} 转「${ev.result}」：${ev.reasons.join("；")}`, {
      trialId: trial.id,
    });
  }
  return { trial, evaluation: ev, attempt };
}

export function submitSampling(item, trialId, input, at = new Date().toISOString()) {
  const trial = requireOpenTrial(item, trialId);
  return recordWeighing(item, trial, input, "sampling", at);
}

export function submitRecheck(item, trialId, input, at = new Date().toISOString()) {
  const trial = requireOpenTrial(item, trialId);
  return recordWeighing(item, trial, input, "recheck", at);
}

// 修正烟料、胶料：原「已试磨」结论一律失效留档；年限/位置修正不影响结论
export function correctProfile(item, patch = {}, at = new Date().toISOString()) {
  const operator = text(patch.operator);
  if (!operator) throw fail(400, "operator_required", "缺少修正操作人");
  const changes = {};
  const nextSmoke = patch.smokeSource === undefined ? undefined : text(patch.smokeSource);
  const nextGlue = patch.glueRatio === undefined ? undefined : text(patch.glueRatio);
  if (nextSmoke !== undefined && nextSmoke !== item.smokeSource) {
    changes.smokeSource = [item.smokeSource, nextSmoke];
    item.smokeSource = nextSmoke;
  }
  if (nextGlue !== undefined && nextGlue !== item.glueRatio) {
    changes.glueRatio = [item.glueRatio, nextGlue];
    item.glueRatio = nextGlue;
  }
  if (patch.ageYears !== undefined && String(patch.ageYears).trim() !== "") {
    item.ageYears = Number(patch.ageYears);
  }
  if (patch.storage !== undefined) item.storage = text(patch.storage);

  const labels = { smokeSource: "烟料来源", glueRatio: "胶料比例" };
  const invalidated = [];
  if (Object.keys(changes).length) {
    const reasonText = Object.entries(changes)
      .map(([k, [before, after]]) => `${labels[k]}「${before || "空"}」→「${after || "空"}」`)
      .join("，");
    for (const trial of item.trials) {
      if (trial.conclusion !== "已试磨") continue;
      const archive = {
        at,
        by: operator,
        kind: "档案修正",
        reason: reasonText,
        changes,
        snapshot: {
          conclusion: trial.conclusion,
          finishedAt: trial.finishedAt,
          calibrationAt: trial.calibrationAt,
          segments: { ...trial.segments },
          total: trial.total,
          weighedBy: trial.weighedBy,
        },
      };
      trial.archives.push(archive);
      trial.conclusion = "已失效";
      trial.invalidatedAt = at;
      trial.invalidReason = reasonText;
      invalidated.push(trial.id);
    }
    item.status = findOpenTrial(item) ? "试磨中" : "待试磨";
    pushLog(
      item,
      "留档",
      `烟料/胶料修正（${reasonText}），${invalidated.length}条原「已试磨」结论失效留档${
        invalidated.length ? "：" + invalidated.join("、") : ""
      }`,
      { invalidated }
    );
  } else {
    pushLog(item, "档案", "档案信息修订（烟料、胶料未变，原结论继续有效）");
  }
  return { item, invalidated };
}

// 修正任一段重量：若该试磨已有结论，原结论失效留档并重新开放判定
export function correctSegment(item, trialId, input = {}, at = new Date().toISOString()) {
  const operator = text(input.operator);
  if (!operator) throw fail(400, "operator_required", "缺少修正操作人");
  const entry = SEGMENTS.find(([key]) => key === input.segment);
  if (!entry) throw fail(400, "bad_segment", "段次必须为 front/middle/back 之一");
  const [segment, label] = entry;
  const value = parseMg(input.value);
  if (value === null || Number.isNaN(value)) throw fail(400, "bad_weight", `${label}重量不是有效数字`);
  const trial = findTrial(item, trialId);
  if (!trial) throw fail(404, "trial_not_found", "试磨记录不存在");
  if (trial.conclusion === "已失效") {
    throw fail(400, "trial_invalidated", "该试磨已失效留档，不能再修正，请新开试磨");
  }
  const before = trial.segments[segment];
  const hadConclusion = trial.conclusion === "已试磨";
  const snapshot = hadConclusion
    ? {
        conclusion: trial.conclusion,
        finishedAt: trial.finishedAt,
        calibrationAt: trial.calibrationAt,
        segments: { ...trial.segments },
        total: trial.total,
        weighedBy: trial.weighedBy,
      }
    : null;
  trial.segments[segment] = value;
  const values = SEGMENTS.map(([k]) => trial.segments[k]);
  const total = values.every((v) => typeof v === "number")
    ? Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100
    : null;

  if (hadConclusion) {
    trial.archives.push({
      at,
      by: operator,
      kind: "段重修正",
      reason: `${label}出墨量 ${before}mg → ${value}mg`,
      segment,
      before,
      after: value,
      snapshot,
    });
    trial.conclusion = null;
    trial.finishedAt = null;
    trial.total = total;
    trial.lastResult = null;
    trial.weighedBy = operator;
    item.status = "试磨中";
    pushLog(
      item,
      "留档",
      `${trial.id} ${label}出墨量修正为${value}mg，原「已试磨」结论（合计${snapshot.total}mg）失效留档，须重新提交判定`,
      { trialId: trial.id }
    );
  } else {
    trial.total = total;
    pushLog(item, "试磨", `${trial.id} ${label}出墨量登记修正为${value}mg（试磨未结束，原无结论）`, {
      trialId: trial.id,
    });
  }
  return trial;
}

export function computeStats(items) {
  const stats = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let archived = 0;
  for (const item of items) {
    if (stats[item.status] !== undefined) stats[item.status] += 1;
    archived += item.trials.reduce((n, t) => n + (t.archives ? t.archives.length : 0), 0);
  }
  stats.失效留档 = archived;
  return stats;
}
