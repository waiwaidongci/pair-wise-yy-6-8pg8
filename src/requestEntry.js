// 请求入口：HTTP 路由与请求处理（判定走 decisionRules，落盘走 recordStore）

import {
  STATUS,
  FLOW_STATUSES,
  SEGMENTS,
  PROFILE_FIELDS,
  SEGMENT_FIELDS,
  evaluateTrial,
  evaluateRecheck,
  correctionKind,
  computeStats,
  toMg,
  findOpenTrial,
  latestLiveTrial,
  trialTotalMg,
} from "./decisionRules.js";
import { loadDb, mutate, makeStickId, makeTrialId } from "./recordStore.js";
import { page } from "./page.js";

const JSON_HEADER = { "Content-Type": "application/json; charset=utf-8" };

export async function handle(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    await loadDb();
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page());
    }
    if (req.method === "GET" && url.pathname === "/api/flow-statuses")
      return send(res, 200, FLOW_STATUSES);
    if (req.method === "GET" && url.pathname === "/api/sticks") return listSticks(res);
    if (req.method === "GET" && url.pathname === "/api/stats") return send(res, 200, computeStats((await loadDb()).items));

    const one = url.pathname.match(/^\/api\/sticks\/([^/]+)$/);
    if (one && req.method === "GET") return getStick(res, one[1]);
    if (one && req.method === "PATCH") return patchStick(res, one[1], await readBody(req));
    if (req.method === "POST" && url.pathname === "/api/sticks") return createStick(res, await readBody(req));

    const note = url.pathname.match(/^\/api\/sticks\/([^/]+)\/notes$/);
    if (note && req.method === "POST") return addNote(res, note[1], await readBody(req));

    const trials = url.pathname.match(/^\/api\/sticks\/([^/]+)\/trials$/);
    if (trials && req.method === "POST") return startTrial(res, trials[1], await readBody(req));

    const segment = url.pathname.match(/^\/api\/sticks\/([^/]+)\/trials\/([^/]+)\/segments$/);
    if (segment && req.method === "PUT")
      return submitSegments(res, segment[1], segment[2], await readBody(req));

    const finish = url.pathname.match(/^\/api\/sticks\/([^/]+)\/trials\/([^/]+)\/finish$/);
    if (finish && req.method === "POST")
      return finishTrial(res, finish[1], finish[2], await readBody(req));

    const recheck = url.pathname.match(/^\/api\/sticks\/([^/]+)\/trials\/([^/]+)\/recheck$/);
    if (recheck && req.method === "POST")
      return recheckTrial(res, recheck[1], recheck[2], await readBody(req));

    const correction = url.pathname.match(/^\/api\/sticks\/([^/]+)\/trials\/([^/]+)\/correction$/);
    if (correction && req.method === "PATCH")
      return correctTrial(res, correction[1], correction[2], await readBody(req));

    const stickCorrection = url.pathname.match(/^\/api\/sticks\/([^/]+)\/correction$/);
    if (stickCorrection && req.method === "PATCH")
      return correctProfile(res, stickCorrection[1], await readBody(req));

    return send(res, 404, { error: "not_found" });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, JSON_HEADER);
  res.end(JSON.stringify(data, null, 2));
}
function findStick(db, ref) {
  return db.items.find((x) => x.id === ref || x.code === ref);
}
function findTrial(item, tid) {
  return (item.trials || []).find((t) => t.id === tid || String(t.seq) === tid);
}
function addLog(item, step, note) {
  item.logs.push({ at: new Date().toISOString(), step, note });
}
function nowIso() {
  return new Date().toISOString();
}

// 同一 clientKey 的重复或并发提交沿用首次结果
function remember(db, key, status, body) {
  db.idempotency[key] = { at: nowIso(), status, body };
}
function recall(res, db, key) {
  if (key && db.idempotency[key]) {
    const hit = db.idempotency[key];
    send(res, hit.status, { ...hit.body, idempotent: true });
    return true;
  }
  return false;
}

function summarize(item) {
  const openTrial = findOpenTrial(item);
  const latest = latestLiveTrial(item);
  return {
    id: item.id,
    code: item.code,
    smokeSource: item.smokeSource,
    glueRatio: item.glueRatio,
    ageYears: item.ageYears,
    storage: item.storage,
    status: item.status,
    logCount: (item.logs || []).length,
    trialCount: (item.trials || []).filter((t) => !t.archived).length,
    archivedCount: (item.trials || []).filter((t) => t.archived).length,
    openTrial: openTrial
      ? {
          id: openTrial.id,
          seq: openTrial.seq,
          operator: openTrial.operator,
          calibratedAt: openTrial.calibratedAt,
          segments: openTrial.segments,
          totalMg: trialTotalMg(openTrial),
        }
      : null,
    latestTrial: latest
      ? {
          id: latest.id,
          seq: latest.seq,
          finished: latest.finished,
          archived: latest.archived,
          totalMg: latest.finished ? latest.totalMg ?? trialTotalMg(latest) : trialTotalMg(latest),
          judgementStatus: latest.judgementStatus,
          judgedReasons: latest.judgedReasons || [],
        }
      : null,
  };
}

async function listSticks(res) {
  const db = await loadDb();
  return send(res, 200, db.items.map(summarize));
}
async function getStick(res, ref) {
  const db = await loadDb();
  const item = findStick(db, ref);
  if (!item) return send(res, 404, { error: "stick_not_found" });
  return send(res, 200, item);
}

async function createStick(res, input) {
  const code = String(input.code || "").trim();
  if (!code) return send(res, 400, { error: "code_required", message: "墨锭编号必填" });
  return mutate(async (db) => {
    if (recall(res, db, input.clientKey)) return;
    if (db.items.some((x) => x.code === code))
      return send(res, 409, { error: "duplicate_code", message: "墨锭编号已存在" });
    const ts = Date.now();
    const item = {
      id: makeStickId(ts),
      code,
      smokeSource: String(input.smokeSource || "").trim(),
      glueRatio: String(input.glueRatio || "").trim(),
      ageYears: input.ageYears === "" ? null : Number(input.ageYears) || 0,
      storage: String(input.storage || "").trim(),
      status: STATUS.PENDING,
      logs: [],
      trials: [],
    };
    addLog(item, "建档", "创建墨锭，进入" + STATUS.PENDING);
    db.items.unshift(item);
    if (input.clientKey) remember(db, input.clientKey, 201, summarize(item));
    return send(res, 201, item);
  });
}

async function patchStick(res, ref, input) {
  return mutate(async (db) => {
    const item = findStick(db, ref);
    if (!item) return send(res, 404, { error: "stick_not_found" });
    // 仅允许人工标记/解除重点观察，不允许绕过准入规则改判定状态
    if (input.status && input.status !== STATUS.WATCH && input.status !== item.status)
      return send(res, 400, { error: "status_locked", message: "准入状态由试磨判定流转，不能手工修改" });
    if (input.status === STATUS.WATCH) {
      item.status = STATUS.WATCH;
      addLog(item, "标记", "人工标记为重点观察");
    }
    if (input.note) addLog(item, "备注", String(input.note));
    return send(res, 200, item);
  });
}

async function addNote(res, ref, input) {
  return mutate(async (db) => {
    const item = findStick(db, ref);
    if (!item) return send(res, 404, { error: "stick_not_found" });
    addLog(item, "备注", String(input.note || ""));
    return send(res, 201, item);
  });
}

// 每锭只留一条未结束试磨：重复或并发提交沿用首次
async function startTrial(res, ref, input) {
  return mutate(async (db) => {
    const item = findStick(db, ref);
    if (!item) return send(res, 404, { error: "stick_not_found" });
    if (input.clientKey && recall(res, db, input.clientKey)) return;
    const open = findOpenTrial(item);
    if (open)
      return send(res, 200, { ...summarize(item), reused: open.id, message: "该墨锭已有未结束试磨，沿用首次提交" });
    if (item.status === STATUS.RECHECK)
      return send(res, 409, {
        error: "recheck_required",
        message: "该墨锭处于待复核，须换人重称后提交复核，不能新开试磨",
      });
    const calibratedAt = String(input.calibratedAt || "").trim();
    if (!Number.isFinite(Date.parse(calibratedAt)))
      return send(res, 400, { error: "calibration_required", message: "请填写天平校准时间" });
    const seq = item.trials.length + 1;
    const ts = Date.now();
    const trial = {
      id: makeTrialId(item, seq, ts),
      seq,
      openedAt: nowIso(),
      finishedAt: null,
      finished: false,
      archived: false,
      operator: String(input.operator || "").trim(),
      calibratedAt: new Date(calibratedAt).toISOString(),
      segments: { front: null, middle: null, back: null },
      notes: input.remark ? [String(input.remark)] : [],
    };
    item.trials.push(trial);
    item.status = STATUS.GRINDING;
    addLog(
      item,
      "开始试磨",
      "第" + seq + "条试磨，开磨人" + (trial.operator || "未填") + "，天平校准时间" + trial.calibratedAt
    );
    if (input.clientKey) remember(db, input.clientKey, 201, summarize(item));
    return send(res, 201, summarize(item));
  });
}

function readReadings(input) {
  const readings = {};
  if (input.readings) Object.assign(readings, input.readings);
  if (input.segment) readings[input.segment] = input.mg;
  return readings;
}

async function submitSegments(res, ref, tid, input) {
  const readings = readReadings(input);
  const keys = Object.keys(readings).filter((k) => SEGMENTS.some(([key]) => key === k));
  if (!keys.length) return send(res, 400, { error: "segment_required", message: "请提交至少一段出墨量" });
  return mutate(async (db) => {
    const item = findStick(db, ref);
    if (!item) return send(res, 404, { error: "stick_not_found" });
    if (input.clientKey && recall(res, db, input.clientKey)) return;
    const trial = findTrial(item, tid);
    if (!trial || trial.archived) return send(res, 404, { error: "trial_not_found" });
    if (trial.finished)
      return send(res, 409, { error: "trial_closed", message: "该试磨已结束，重量修正请走修正留档" });
    for (const key of keys) {
      const mg = toMg(readings[key]);
      if (!Number.isFinite(mg))
        return send(res, 400, { error: "bad_weight", message: SEGMENT_FIELDS["seg" + key[0].toUpperCase() + key.slice(1)][1] + "须为非负数字（毫克）" });
      trial.segments[key] = { mg, at: nowIso(), by: String(input.operator || trial.operator || "") };
    }
    const labels = keys.map((k) => SEGMENTS.find(([key]) => key === k)[1]);
    addLog(item, "三段取样", "第" + trial.seq + "条试磨录入" + labels.join("、") + "出墨量");
    if (input.clientKey) remember(db, input.clientKey, 200, summarize(item));
    return send(res, 200, summarize(item));
  });
}

// 结束试磨：校准超8小时或缺前中后三段 → 待复采；合计越界 → 待复核；合格 → 已试磨
async function finishTrial(res, ref, tid, input) {
  return mutate(async (db) => {
    const item = findStick(db, ref);
    if (!item) return send(res, 404, { error: "stick_not_found" });
    if (input.clientKey && recall(res, db, input.clientKey)) return;
    const trial = findTrial(item, tid);
    if (!trial || trial.archived) return send(res, 404, { error: "trial_not_found" });
    if (trial.finished)
      return send(res, 409, { error: "trial_closed", message: "该试磨已结束，重复提交不改变原结论" });
    if (input.remark) trial.notes.push(String(input.remark));
    const judgement = evaluateTrial(trial);
    trial.finished = true;
    trial.finishedAt = nowIso();
    trial.totalMg = judgement.totalMg;
    trial.judgementStatus = judgement.status;
    trial.judgedReasons = judgement.reasons;
    item.status = judgement.status;
    const step =
      judgement.status === STATUS.DONE
        ? "结束试磨"
        : judgement.status === STATUS.RECHECK
          ? "转待复核"
          : "转待复采";
    addLog(item, step, "第" + trial.seq + "条试磨：" + judgement.reasons.join("；"));
    if (input.clientKey) remember(db, input.clientKey, 200, summarize(item));
    return send(res, 200, { ...summarize(item), judgement });
  });
}

// 复核：换人 + 前中后全部重称
async function recheckTrial(res, ref, tid, input) {
  return mutate(async (db) => {
    const item = findStick(db, ref);
    if (!item) return send(res, 404, { error: "stick_not_found" });
    if (input.clientKey && recall(res, db, input.clientKey)) return;
    const trial = findTrial(item, tid);
    if (!trial || trial.archived) return send(res, 404, { error: "trial_not_found" });
    if (!trial.finished || trial.judgementStatus !== STATUS.RECHECK)
      return send(res, 409, { error: "not_recheck_pending", message: "仅待复核的试磨可提交复核" });
    const calibratedAt = String(input.calibratedAt || "").trim();
    if (!Number.isFinite(Date.parse(calibratedAt)))
      return send(res, 400, { error: "calibration_required", message: "复核须填写本次天平校准时间" });
    const verdict = evaluateRecheck({
      trial,
      operator: String(input.operator || "").trim(),
      calibratedAt,
      readings: input.readings,
    });
    if (!verdict.ok) return send(res, 400, { error: verdict.error, message: verdict.message });

    const seq = item.trials.length + 1;
    const ts = Date.now();
    const reTrial = {
      id: makeTrialId(item, seq, ts),
      seq,
      openedAt: nowIso(),
      finishedAt: nowIso(),
      finished: true,
      archived: false,
      kind: "recheck",
      recheckOf: trial.id,
      operator: String(input.operator).trim(),
      previousOperator: trial.operator || "",
      calibratedAt: new Date(calibratedAt).toISOString(),
      segments: verdict.segments,
      totalMg: verdict.judgement.totalMg,
      judgementStatus: verdict.judgement.status,
      judgedReasons: ["换人复核，三段全部重称。"].concat(verdict.judgement.reasons),
      notes: input.remark ? [String(input.remark)] : [],
    };
    trial.supersededBy = reTrial.id;
    item.trials.push(reTrial);
    item.status = verdict.judgement.status;
    addLog(
      item,
      verdict.judgement.status === STATUS.RECHECK ? "复核仍待复核" : verdict.judgement.status === STATUS.DONE ? "复核通过" : "复核转待复采",
      "第" +
        seq +
        "条由" +
        reTrial.operator +
        "（初试人" +
        (trial.operator || "未填") +
        "）重称：" +
        verdict.judgement.reasons.join("；")
    );
    if (input.clientKey) remember(db, input.clientKey, 200, summarize(item));
    return send(res, 200, { ...summarize(item), judgement: verdict.judgement });
  });
}

// 修正烟料、胶料或任一段重量：原结论失效并留档，重新取样
async function correctTrial(res, ref, tid, input) {
  return mutate(async (db) => {
    const item = findStick(db, ref);
    if (!item) return send(res, 404, { error: "stick_not_found" });
    if (input.clientKey && recall(res, db, input.clientKey)) return;
    const trial = findTrial(item, tid);
    if (!trial || trial.archived) return send(res, 404, { error: "trial_not_found" });
    const field = String(input.field || "");
    const kind = correctionKind(field);
    if (!kind)
      return send(res, 400, { error: "field_not_correctable", message: "仅可修正三段重量（烟料、胶料请用墨锭级修正）" });
    if (kind.type !== "segment")
      return send(res, 400, { error: "use_stick_correction", message: "烟料、胶料请使用墨锭级修正入口" });
    const operator = String(input.operator || "").trim();
    if (!operator) return send(res, 400, { error: "operator_required", message: "修正须留操作人" });

    const correction = {
      at: nowIso(),
      by: operator,
      field,
      label: kind.label,
      reason: String(input.reason || "").trim(),
      newValue: null,
      newMg: null,
    };

    {
      const mg = toMg(input.value);
      if (!Number.isFinite(mg))
        return send(res, 400, { error: "bad_weight", message: "修正重量须为非负数字（毫克）" });
      correction.newMg = mg;
      // 未结束试磨：直接改正本段，尚无结论可失效
      if (!trial.finished) {
        trial.segments[kind.segment] = {
          mg,
          correctedAt: nowIso(),
          correctedBy: operator,
        };
        trial.corrections ||= [];
        trial.corrections.push(correction);
        addLog(item, "修正留档", "第" + trial.seq + "条试磨" + kind.label + "修正为" + mg + "毫克（试磨未结束，直接改正）");
        if (input.clientKey) remember(db, input.clientKey, 200, summarize(item));
        return send(res, 200, summarize(item));
      }
    }

    // 已形成结论：原结论失效，整份试磨留档，墨锭转待复采（若已有新试磨在磨则保持试磨中）
    invalidateConclusion(item, trial, correction, kind);
    if (!findOpenTrial(item)) item.status = STATUS.RESAMPLE;
    if (input.clientKey) remember(db, input.clientKey, 200, summarize(item));
    return send(res, 200, summarize(item));
  });
}

// 墨锭级修正：烟料来源、胶料比例。存在生效结论时结论失效留档并转待复采
async function correctProfile(res, ref, input) {
  return mutate(async (db) => {
    const item = findStick(db, ref);
    if (!item) return send(res, 404, { error: "stick_not_found" });
    if (input.clientKey && recall(res, db, input.clientKey)) return;
    const field = String(input.field || "");
    const kind = correctionKind(field);
    if (!kind || kind.type !== "profile")
      return send(res, 400, { error: "field_not_correctable", message: "此处仅可修正烟料来源或胶料比例" });
    const operator = String(input.operator || "").trim();
    if (!operator) return send(res, 400, { error: "operator_required", message: "修正须留操作人" });
    const value = String(input.value ?? "").trim();
    if (!value) return send(res, 400, { error: "value_required", message: "修正值不能为空" });

    item[field] = value;
    const correction = {
      at: nowIso(),
      by: operator,
      field,
      label: kind.label,
      reason: String(input.reason || "").trim(),
      newValue: value,
      newMg: null,
    };
    // 最近一份生效（未留档、已结束）的结论随之失效
    const liveFinished = [...(item.trials || [])].reverse().find((t) => !t.archived && t.finished);
    if (liveFinished) {
      invalidateConclusion(item, liveFinished, correction, kind);
      if (!findOpenTrial(item)) item.status = STATUS.RESAMPLE;
    } else {
      addLog(item, "修正留档", kind.label + "修正为" + value + "（当前无生效结论，直接改正档案），操作人" + operator);
    }
    if (input.clientKey) remember(db, input.clientKey, 200, summarize(item));
    return send(res, 200, summarize(item));
  });
}

function invalidateConclusion(item, trial, correction, kind) {
  const detail =
    kind.type === "segment"
      ? "第" + trial.seq + "条试磨" + correction.label + "修正为" + correction.newMg + "毫克"
      : correction.label + "修正为" + correction.newValue;
  trial.archived = true;
  trial.archivedAt = correction.at;
  trial.invalidation = {
    reason: "material_correction",
    detail,
    by: correction.by,
    operatorNote: correction.reason,
  };
  addLog(
    item,
    "结论失效留档",
    detail +
      "，原判定" +
      (trial.judgementStatus || "（未判定）") +
      "（合计" +
      (trial.totalMg ?? "-") +
      "毫克）失效，操作人" +
      correction.by +
      "，墨锭转" +
      STATUS.RESAMPLE
  );
}
