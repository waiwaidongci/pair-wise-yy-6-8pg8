// 页面：三段取样与称量校准准入台（卡片、统计、单锭记录共用同一份数据，刷新后同步）

export function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>三段取样与称量校准准入台</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --blue:#34547a; --amber:#8a6d2a; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:20px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:23px; } h2 { margin:0 0 10px; font-size:16px; } h3 { margin:0; font-size:17px; }
    main { display:grid; grid-template-columns:400px 1fr; gap:20px; padding:20px 28px; align-items:start; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
    form { margin-bottom:14px; }
    label { display:block; margin:8px 0 4px; color:var(--muted); font-size:12.5px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:8px; font:inherit; background:#fff; } textarea { min-height:54px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:8px 12px; font-weight:700; cursor:pointer; font-size:13px; } button.secondary { background:#69736a; } button.warn { background:var(--warn); } button.blue { background:var(--blue); } button:disabled { background:#b3bbb0; cursor:not-allowed; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(104px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:22px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:150px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; } .card { display:grid; gap:7px; cursor:pointer; }
    .meta { color:var(--muted); font-size:12.5px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 9px; font-size:12px; width:max-content; }
    .pill.done { background:#e7f0df; color:var(--accent); border-color:#b9cfa9; } .pill.resample { background:#f5e0da; color:var(--warn); border-color:#d9b1a6; }
    .pill.recheck { background:#f6ecd4; color:var(--amber); border-color:#dcc797; } .pill.grinding { background:#dbe5ef; color:var(--blue); border-color:#aec2d8; }
    .segs { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; text-align:center; } .segs span { border:1px solid var(--line); border-radius:6px; padding:5px 2px; font-size:12px; background:#fafcf8; }
    .segs b { display:block; font-size:14px; } .segs .total b { color:var(--accent); } .segs .bad b { color:var(--warn); }
    .cal-ok { color:var(--accent); font-weight:700; } .cal-bad { color:var(--warn); font-weight:700; }
    .row { display:grid; grid-template-columns:1fr 1fr; gap:8px; } .btns { display:flex; gap:8px; flex-wrap:wrap; margin-top:6px; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:150px; overflow:auto; display:grid; gap:4px; }
    .trial { border:1px solid var(--line); border-radius:6px; padding:8px; margin:6px 0; background:#fafcf8; } .trial.archived { background:#f6f2ee; opacity:.85; }
    #toast { position:fixed; right:18px; bottom:18px; background:var(--ink); color:#fff; padding:10px 14px; border-radius:8px; font-size:13px; opacity:0; transition:opacity .2s; max-width:420px; pointer-events:none; white-space:pre-wrap; } #toast.show { opacity:.96; } #toast.err { background:var(--warn); }
    .rule { font-size:12.5px; color:var(--muted); line-height:1.7; }
    @media (max-width:960px){ header{display:block;padding:16px;} main{grid-template-columns:1fr;padding:14px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>三段取样与称量校准准入台</h1><div class="meta">每锭仅一条未结束试磨 · 校准8小时有效 · 前中后三段合计120–180毫克准入</div></div>
    <button id="reload">刷新</button>
  </header>
  <main>
    <section>
      <form id="createForm"><h2>新增墨锭建档</h2>
        <div class="row"><div><label>墨锭编号 *</label><input name="code" required></div><div><label>存放年限</label><input name="ageYears" type="number" min="0"></div></div>
        <div class="row"><div><label>烟料来源</label><input name="smokeSource"></div><div><label>胶料比例</label><input name="glueRatio" placeholder="如 7.5%"></div></div>
        <label>存放位置</label><input name="storage">
        <div class="btns"><button>保存建档</button></div>
      </form>

      <form id="startForm"><h2>开始试磨（登记天平校准）</h2>
        <label>选择墨锭</label><select name="id"></select>
        <div class="row"><div><label>开磨人</label><input name="operator"></div><div><label>天平校准时间 *</label><input name="calibratedAt" type="datetime-local"></div></div>
        <label>备注</label><input name="remark">
        <div class="btns"><button class="blue">开始试磨</button></div>
      </form>

      <form id="sampleForm"><h2>三段取样（出墨量 mg）</h2>
        <label>未结束试磨</label><select name="trial"></select>
        <div class="row"><div><label>前段</label><input name="front" type="number" min="0" step="0.01"></div><div><label>中段</label><input name="middle" type="number" min="0" step="0.01"></div></div>
        <label>后段</label><input name="back" type="number" min="0" step="0.01">
        <div class="row"><div><label>取样人</label><input name="operator"></div><div><label>当前合计</label><input id="liveTotal" readonly value="—"></div></div>
        <div class="btns"><button class="blue">提交三段重量</button></div>
      </form>

      <form id="recheckForm"><h2>换人复核重称（待复核锭）</h2>
        <label>待复核试磨</label><select name="trial"></select>
        <div class="row"><div><label>复核人（须不同于初试人）*</label><input name="operator"></div><div><label>本次天平校准时间 *</label><input name="calibratedAt" type="datetime-local"></div></div>
        <div class="row"><div><label>前段重称 mg *</label><input name="front" type="number" min="0" step="0.01"></div><div><label>中段重称 mg *</label><input name="middle" type="number" min="0" step="0.01"></div></div>
        <label>后段重称 mg *</label><input name="back" type="number" min="0" step="0.01">
        <div class="btns"><button class="warn">提交复核</button></div>
      </form>

      <form id="correctForm"><h2>修正留档（使原结论失效）</h2>
        <label>选择墨锭（修正烟料/胶料用）</label><select name="stick"></select>
        <label>修正项</label><select name="field">
          <option value="smokeSource">烟料来源</option>
          <option value="glueRatio">胶料比例</option>
          <option value="segFront">前段重量</option>
          <option value="segMiddle">中段重量</option>
          <option value="segBack">后段重量</option>
        </select>
        <label>选择试磨（仅修正三段重量时用）</label><select name="trial"></select>
        <div class="row"><div><label>修正值（重量填毫克）*</label><input name="value"></div><div><label>操作人 *</label><input name="operator"></div></div>
        <label>修正原因</label><textarea name="reason"></textarea>
        <div class="rule">修正烟料、胶料，或已结束试磨的任一段重量，原结论立即失效并整份留档，墨锭转待复采。</div>
        <div class="btns"><button class="warn">提交修正</button></div>
      </form>
    </section>

    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar">
        <select id="statusFilter"><option value="">全部状态</option></select>
        <input id="search" placeholder="搜索编号 / 烟料 / 胶料 / 存放位">
      </div>
      <div class="panel">
        <h2>单锭记录 <span class="meta" id="detailHint">点击卡片查看该锭全部试磨、复核与失效留档</span></h2>
        <div id="detail"></div>
      </div>
      <div class="panel" style="margin-top:14px">
        <div class="rule">判定规则：校准超过8小时、或缺少前/中/后任一段出墨量 → 仅转<b>待复采</b>，不计入已试磨；三段合计不在120至180毫克 → <b>待复核</b>，复核须换人并重称；全部满足 → <b>已试磨</b>。同一墨锭重复或并发开磨沿用首次提交。</div>
        <div class="grid" id="cards" style="margin-top:10px"></div>
      </div>
    </section>
  </main>
  <div id="toast"></div>
  <script>
${clientScript()}
  </script>
</body>
</html>`;
}

function clientScript() {
  return String.raw`
    const STATUSES = ["待试磨","试磨中","待复采","待复核","已试磨","重点观察"];
    const SEG_LABELS = { front: "前段", middle: "中段", back: "后段" };
    let sticks = [];
    let selectedId = null;

    const $ = (s) => document.querySelector(s);
    const createForm = $('#createForm'), startForm = $('#startForm'), sampleForm = $('#sampleForm'),
          recheckForm = $('#recheckForm'), correctForm = $('#correctForm');
    const toastEl = $('#toast');
    let toastTimer;
    function toast(msg, isErr) {
      toastEl.textContent = msg; toastEl.className = 'show' + (isErr ? ' err' : '');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.className = '', 3600);
    }
    function esc(v) {
      return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'k-'+Date.now()+'-'+Math.random().toString(16).slice(2)); }
    function nowLocalValue(d = new Date()) {
      return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
    }
    async function api(path, options = {}) {
      if (options.body) options.headers = { 'Content-Type': 'application/json' };
      const res = await fetch(path, options);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || '请求失败');
      return data;
    }
    async function submitForm(path, form, opts = {}) {
      const payload = opts.payload || Object.fromEntries(new FormData(form).entries());
      payload.clientKey = uuid();
      try {
        const data = await api(path, { method: opts.method || 'POST', body: JSON.stringify(payload) });
        if (data.idempotent) toast('重复提交，已沿用首次结果');
        else if (data.message) toast(data.message);
        else toast('已提交');
        form.reset();
        setCalibrationDefaults();
        await load();
        return data;
      } catch (e) { toast(e.message, true); }
    }

    function mgText(v) {
      const mg = v && typeof v === 'object' ? v.mg : v;
      return (mg === null || mg === undefined) ? '缺测' : Number(mg) + 'mg';
    }
    function trialTotal(t) {
      if (!t || !t.segments) return null;
      const vals = ['front','middle','back'].map(k => {
        const mg = t.segments[k] && typeof t.segments[k] === 'object' ? t.segments[k].mg : t.segments[k];
        return mg === null || mg === undefined ? NaN : Number(mg);
      });
      return vals.every(Number.isFinite) ? Math.round(vals.reduce((a,b)=>a+b,0)*100)/100 : null;
    }
    function calibrationInfo(t) {
      const ms = t && t.calibratedAt ? Date.now() - Date.parse(t.calibratedAt) : NaN;
      if (!Number.isFinite(ms)) return { ok:false, text:'校准时间缺失' };
      const hours = ms/3600000;
      if (ms < 0) return { ok:false, text:'校准时间在未来' };
      return { ok: hours <= 8, text:'校准距今' + hours.toFixed(1) + '小时' + (hours <= 8 ? '（有效）' : '（超8小时）') };
    }
    function totalClass(total) {
      if (total === null) return '';
      return total >= 120 && total <= 180 ? 'total' : 'bad';
    }
    function segBlock(t) {
      const total = trialTotal(t);
      const cal = calibrationInfo(t);
      const cells = ['front','middle','back'].map(k =>
        '<span><b>' + esc(mgText(t.segments[k])) + '</b>' + SEG_LABELS[k] + '</span>').join('');
      return '<div class="segs">' + cells +
        '<span class="' + totalClass(total) + '"><b>' + (total === null ? '不齐' : total + 'mg') + '</b>合计</span></div>' +
        '<div class="meta ' + (cal.ok ? 'cal-ok' : 'cal-bad') + '">' + esc(cal.text) +
        (total !== null ? '　合格区间120–180mg' : '') + '</div>';
    }

    function fillSelectors() {
      $('#statusFilter').innerHTML = '<option value="">全部状态</option>' +
        STATUSES.map(s => '<option>' + s + '</option>').join('');
      $('#statusFilter').value = savedFilter.status || '';
      $('#search').value = savedFilter.q || '';

      // 开始试磨：待复核锭不能新开；其余状态有未结束试磨时也沿用首次（后端兜底）
      startForm.querySelector('[name=id]').innerHTML = sticks
        .filter(s => s.status !== '待复核')
        .map(s => '<option value="' + s.id + '">' + esc(s.code) + ' · ' + esc(s.status) +
          (s.openTrial ? ' · 已有未结束试磨(沿用)' : '') + '</option>').join('');

      sampleForm.querySelector('[name=trial]').innerHTML = sticks
        .filter(s => s.openTrial).flatMap(s => [{ s, t: s.openTrial }])
        .map(({s,t}) => '<option value="' + s.id + '/' + t.id + '">' + esc(s.code) + ' · 第' + t.seq + '条试磨（开磨人' + esc(t.operator || '未填') + '）</option>')
        .join('') || '<option value="">暂无未结束试磨</option>';

      recheckForm.querySelector('[name=trial]').innerHTML = sticks
        .filter(s => s.status === '待复核')
        .map(s => {
          const full = s;
          return '<option value="' + s.id + '/' + esc(s.latestTrial ? s.latestTrial.id : '') + '">' +
            esc(s.code) + ' · 合计' + (s.latestTrial ? s.latestTrial.totalMg + 'mg' : '—') + '</option>';
        }).join('') || '<option value="">暂无待复核墨锭</option>';

      correctForm.querySelector('[name=trial]').innerHTML = sticks.flatMap(s =>
        (s._trials || []).map(t => '<option value="' + s.id + '/' + t.id + '">' +
          esc(s.code) + ' · 第' + t.seq + '条' + (t.archived ? '（已失效留档，不可再修正）' : t.finished ? '（' + esc(t.judgementStatus || '') + '）' : '（试磨中）') + '</option>')
      ).join('') || '<option value="">暂无可修正试磨</option>';

      correctForm.querySelector('[name=stick]').innerHTML = sticks
        .map(s => '<option value="' + s.id + '">' + esc(s.code) + ' · ' + esc(s.status) + '</option>').join('');
    }

    function renderStats() {
      const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
      sticks.forEach(s => { if (counts[s.status] !== undefined) counts[s.status]++; });
      $('#stats').innerHTML = STATUSES.map(k =>
        '<div class="stat"><span>' + k + '</span><strong>' + counts[k] + '</strong></div>').join('');
    }

    function renderCards() {
      const status = $('#statusFilter').value;
      const q = $('#search').value.trim();
      const visible = sticks.filter(s =>
        (!status || s.status === status) &&
        (!q || [s.code,s.smokeSource,s.glueRatio,s.storage].join(' ').includes(q)));
      $('#cards').innerHTML = visible.map(s => {
        const t = s.openTrial;
        const latest = s.latestTrial;
        let progress = '';
        if (t) progress = segBlock(t) +
          '<div class="btns"><button data-finish="' + s.id + '/' + t.id + '">结束试磨并判定</button>' +
          '<button class="secondary" data-note="' + s.id + '">追加备注</button></div>';
        else if (s.status === '待复核' && latest)
          progress = '<div class="meta">合计' + esc(latest.totalMg) + 'mg 越界，须换人复核重称（用左侧复核表单）</div>';
        else if (s.status === '待复采' && latest)
          progress = '<div class="meta">最近判定未准入：' + esc((latest.judgedReasons||[]).join('；')) + '</div>';
        else if (s.status === '已试磨' && latest)
          progress = '<div class="meta cal-ok">准入完成：合计' + esc(latest.totalMg) + 'mg</div>';
        return '<article class="card" data-card="' + s.id + '">' +
          '<div style="display:flex;justify-content:space-between;gap:8px"><h3>' + esc(s.code) + '</h3>' +
          '<span class="pill ' + pillClass(s.status) + '">' + esc(s.status) + '</span></div>' +
          '<div class="meta">' + esc(s.smokeSource) + ' · 胶' + esc(s.glueRatio) + ' · ' + esc(s.storage) +
          ' · 存' + esc(s.ageYears) + '年</div>' +
          (progress || '<div class="meta">暂无试磨</div>') +
          (s.archivedCount ? '<div class="meta">已有 ' + s.archivedCount + ' 份失效留档</div>' : '') +
          '</article>';
      }).join('') || '<div class="meta">没有符合条件的墨锭</div>';
    }

    function pillClass(status) {
      return ({ '已试磨':'done', '待复采':'resample', '待复核':'recheck', '试磨中':'grinding' })[status] || '';
    }

    function trialBlock(t) {
      const cal = calibrationInfo(t);
      const rows = segBlock(t) +
        '<div class="meta">开磨/操作人：' + esc(t.operator || '未填') +
        (t.previousOperator ? '　初试人：' + esc(t.previousOperator) : '') + '<br>' +
        '开始：' + esc((t.openedAt||'').replace('T',' ').slice(0,16)) +
        '　结束：' + esc((t.finishedAt||'—').replace('T',' ').slice(0,16)) + '<br>' +
        '校准时间：' + esc((t.calibratedAt||'').replace('T',' ').slice(0,16)) + '（' + esc(cal.text) + '）</div>';
      const reasons = (t.judgedReasons || []).length
        ? '<div class="meta">判定：' + esc(t.judgedReasons.join('；')) + '</div>' : '';
      const invalid = t.invalidation
        ? '<div class="meta warn" style="color:var(--warn)">失效留档：' + esc(t.invalidation.detail) +
          '；操作人' + esc(t.invalidation.by) + (t.invalidation.operatorNote ? '；原因：' + esc(t.invalidation.operatorNote) : '') + '</div>' : '';
      const corrections = (t.corrections || []).map(c =>
        '<div class="meta">修正：' + esc(c.label) + ' → ' + esc(c.newMg ?? c.newValue) +
        '（' + esc(c.by) + ' ' + esc((c.at||'').replace('T',' ').slice(0,16)) + '）</div>').join('');
      return '<div class="trial' + (t.archived ? ' archived' : '') + '"><b>第' + t.seq + '条' +
        (t.kind === 'recheck' ? '（换人复核，重称）' : '试磨') + '</b> ' +
        '<span class="pill ' + pillClass(t.judgementStatus) + '">' + esc(t.judgementStatus || (t.finished ? '已结束' : '试磨中')) + '</span>' +
        (t.archived ? ' <span class="pill resample">原结论失效</span>' : '') +
        rows + reasons + corrections + invalid + '</div>';
    }

    async function renderDetail() {
      if (!selectedId) { $('#detail').innerHTML = '<div class="meta">未选择</div>'; return; }
      const item = await api('/api/sticks/' + encodeURIComponent(selectedId));
      const trials = item.trials || [];
      $('#detail').innerHTML =
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center">' +
        '<h3>' + esc(item.code) + '　<span class="pill ' + pillClass(item.status) + '">' + esc(item.status) + '</span></h3>' +
        '<div class="btns">' +
          (item.status !== '重点观察' ? '<button class="secondary" data-watch="' + item.id + '">标记重点观察</button>' : '') +
          '<button class="secondary" data-note="' + item.id + '">追加备注</button></div></div>' +
        '<div class="meta">' + esc(item.smokeSource) + '（烟料） · ' + esc(item.glueRatio) + '（胶料） · 存' +
          esc(item.ageYears) + '年 · ' + esc(item.storage) + '</div>' +
        '<div style="margin-top:8px">' + trials.slice().reverse().map(trialBlock).join('') + '</div>' +
        '<div class="logs meta" style="margin-top:8px"><b>操作日志</b>' +
          item.logs.slice().reverse().map(l => '<div>[' + esc((l.at||'').replace('T',' ').slice(0,16)) + '] ' + esc(l.step) + '：' + esc(l.note) + '</div>').join('') + '</div>';
    }

    const savedFilter = { status: '', q: '' };
    async function load() {
      sticks = await api('/api/sticks');
      // 附带完整 trials 供修正表单与卡片之外的记录联动
      await Promise.all(sticks.map(async s => { const full = await api('/api/sticks/' + encodeURIComponent(s.id)); s._trials = full.trials || []; }));
      if (selectedId && !sticks.some(s => s.id === selectedId)) selectedId = null;
      fillSelectors(); renderStats(); renderCards(); renderDetail();
    }

    function setCalibrationDefaults() {
      const v = nowLocalValue();
      startForm.querySelector('[name=calibratedAt]').value = v;
      recheckForm.querySelector('[name=calibratedAt]').value = v;
    }
    function updateLiveTotal() {
      const vals = ['front','middle','back'].map(k => Number(sampleForm.querySelector('[name='+k+']').value));
      if (vals.some(v => !Number.isFinite(v))) { $('#liveTotal').value = '三段填齐后显示'; return; }
      const total = Math.round(vals.reduce((a,b)=>a+b,0)*100)/100;
      $('#liveTotal').value = total + ' mg（' + (total >= 120 && total <= 180 ? '区间内' : '越界→待复核') + '）';
    }

    createForm.onsubmit = e => { e.preventDefault(); submitForm('/api/sticks', createForm); };
    startForm.onsubmit = e => {
      e.preventDefault();
      const id = startForm.querySelector('[name=id]').value;
      submitForm('/api/sticks/' + encodeURIComponent(id) + '/trials', startForm);
    };
    sampleForm.onsubmit = e => {
      e.preventDefault();
      const ref = sampleForm.querySelector('[name=trial]').value;
      if (!ref) return toast('暂无未结束试磨', true);
      const [sid, tid] = ref.split('/');
      submitForm('/api/sticks/' + encodeURIComponent(sid) + '/trials/' + encodeURIComponent(tid) + '/segments', sampleForm, {
        method: 'PUT', payload: {
          readings: {
            front: sampleForm.querySelector('[name=front]').value,
            middle: sampleForm.querySelector('[name=middle]').value,
            back: sampleForm.querySelector('[name=back]').value,
          },
          operator: sampleForm.querySelector('[name=operator]').value,
        }
      });
    };
    recheckForm.onsubmit = e => {
      e.preventDefault();
      const ref = recheckForm.querySelector('[name=trial]').value;
      const [sid, tid] = ref.split('/');
      if (!tid) return toast('请选择待复核试磨', true);
      submitForm('/api/sticks/' + encodeURIComponent(sid) + '/trials/' + encodeURIComponent(tid) + '/recheck', recheckForm, {
        payload: {
          operator: recheckForm.querySelector('[name=operator]').value,
          calibratedAt: recheckForm.querySelector('[name=calibratedAt]').value,
          readings: {
            front: recheckForm.querySelector('[name=front]').value,
            middle: recheckForm.querySelector('[name=middle]').value,
            back: recheckForm.querySelector('[name=back]').value,
          },
        }
      });
    };
    correctForm.onsubmit = e => {
      e.preventDefault();
      const field = correctForm.querySelector('[name=field]').value;
      const payload = {
        field,
        value: correctForm.querySelector('[name=value]').value,
        operator: correctForm.querySelector('[name=operator]').value,
        reason: correctForm.querySelector('[name=reason]').value,
      };
      let path;
      if (field === 'smokeSource' || field === 'glueRatio') {
        path = '/api/sticks/' + encodeURIComponent(correctForm.querySelector('[name=stick]').value) + '/correction';
      } else {
        const ref = correctForm.querySelector('[name=trial]').value;
        if (!ref) return toast('请选择要修正的试磨', true);
        const [sid, tid] = ref.split('/');
        path = '/api/sticks/' + encodeURIComponent(sid) + '/trials/' + encodeURIComponent(tid) + '/correction';
      }
      submitForm(path, correctForm, { method: 'PATCH', payload });
    };

    document.body.addEventListener('click', async e => {
      const card = e.target.closest('[data-card]');
      if (card && !e.target.closest('button')) { selectedId = card.dataset.card; await renderDetail(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      const finish = e.target.closest('[data-finish]');
      if (finish) {
        const [sid, tid] = finish.dataset.finish.split('/');
        await submitForm('/api/sticks/' + encodeURIComponent(sid) + '/trials/' + encodeURIComponent(tid) + '/finish', { reset(){} }, { payload: {} });
        return;
      }
      const note = e.target.closest('[data-note]');
      if (note) {
        const text = prompt('追加备注');
        if (text && text.trim()) { try { await api('/api/sticks/' + encodeURIComponent(note.dataset.note) + '/notes', { method:'POST', body: JSON.stringify({ note: text }) }); await load(); } catch (err) { toast(err.message, true); } }
        return;
      }
      const watch = e.target.closest('[data-watch]');
      if (watch) {
        try { await api('/api/sticks/' + encodeURIComponent(watch.dataset.watch), { method:'PATCH', body: JSON.stringify({ status:'重点观察' }) }); await load(); } catch (err) { toast(err.message, true); }
      }
    });
    sampleForm.addEventListener('input', e => { if (['front','middle','back','operator'].includes(e.target.name)) updateLiveTotal(); });
    $('#statusFilter').onchange = () => { savedFilter.status = $('#statusFilter').value; renderCards(); };
    $('#search').oninput = () => { savedFilter.q = $('#search').value; renderCards(); };
    $('#reload').onclick = load;

    setCalibrationDefaults();
    updateLiveTotal();
    load();
`;
}
