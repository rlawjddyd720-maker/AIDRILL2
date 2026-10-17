/* AI 요약 보고서 모달 */
(function () {
  'use strict';
  const P = window.PMS;
  const $ = (s) => document.querySelector(s);
  const dlg = $('#reportDialog');
  const body = $('#reportBody');
  const r = { tab: 'ai', ai: false, model: '', cached: {}, busy: false, autoText: '', shownText: '' };
  const isLocal = () => P.state.mode !== 'server';
  const LS_KEY = 'pms.apiKey';
  const LS_MODEL = 'pms.aiModel';
  const LS_SUM = 'pms.summaries';
  const DEFAULT_MODEL = 'claude-sonnet-5-5';
  const SYSTEM_PROMPT = [
    '당신은 전문대학 혁신지원사업 AI 사업단의 성과관리 담당자입니다.',
    '사업단장에게 올릴 자율성과지표 현황 요약 보고서를 한국어로 작성합니다.',
    '',
    '원칙',
    '- 제공된 JSON 데이터에 있는 수치만 사용합니다. 계산하거나 추정한 값을 새로 만들지 않습니다.',
    "- value가 null인 항목은 '미입력', flag가 있는 항목은 그 상태(근거 확인, 계획 포함 등)를 반드시 밝힙니다.",
    '- 진척률(rate)은 2차년도 목표 대비 비율입니다. 누적형(type=count) 지표는 집계기간 경과율(paceRatio)과 비교해 해석하고, 점수·비율형(type=level) 지표는 목표 대비로만 해석합니다.',
    '- 지수는 3차년도 목표를 분모로 하므로 집계 중간에는 낮게 나온다는 점을 필요할 때 짚습니다.',
    '- 단장이 1~2분 안에 읽을 수 있게 간결하게 씁니다. 과장이나 미사여구를 쓰지 않습니다.',
    '',
    '형식 (마크다운, 아래 제목을 그대로 사용)',
    '## 종합 판단', '2~3문장.',
    '## 지수별 현황', '지수마다 한 줄 불릿. 진척률(또는 달성도)과 핵심 원인.',
    '## 주의가 필요한 지표', '불릿. 이유와 함께.',
    '## 권고 조치', '불릿. 각 항목 앞에 **담당 부서**를 굵게 표시.',
    '## 확인이 필요한 자료', '불릿. 미입력·근거 확인·계획 포함 값과 자료 점검 미해결 항목.'
  ].join('\n');

  // ---------- 간단한 마크다운 → HTML (## 제목, - 목록, **굵게**) ----------
  function mdToHtml(md) {
    const inline = (t) => P.esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const out = [];
    let list = false;
    md.split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      const item = /^[-*•]\s+(.*)$/.exec(line);
      if (item) {
        if (!list) { out.push('<ul>'); list = true; }
        out.push('<li>' + inline(item[1]) + '</li>');
        return;
      }
      if (list) { out.push('</ul>'); list = false; }
      if (!line) return;
      const h = /^#{1,4}\s+(.*)$/.exec(line);
      if (h) out.push('<h3>' + inline(h[1]) + '</h3>');
      else out.push('<p>' + inline(line) + '</p>');
    });
    if (list) out.push('</ul>');
    return out.join('');
  }

  // ---------- 규칙 기반 자동 요약 ----------
  function autoReport() {
    const d = P.state.data;
    const c = P.compute(d);
    const isY2 = P.state.view === 'y2';
    const pct = (v) => P.fmtPct(v);
    const L = [];

    if (!isY2) {
      const sorted = c.indices.slice().sort((a, b) => b.y1.rate - a.y1.rate);
      L.push('## 종합 판단');
      L.push(`1차년도('25) 자율성과지표 4개의 평균 달성도는 ${d.meta.y1Average.toFixed(1)}%이며, 4개 지수 모두 목표를 넘었습니다. 달성도가 가장 높은 지수는 ${sorted[0].no} ${sorted[0].name}(${pct(sorted[0].y1.rate)})입니다.`);
      L.push('## 지수별 현황');
      c.indices.forEach((ix) => L.push(`- **${ix.no} ${ix.name}** 달성도 ${pct(ix.y1.rate)} (실적 ${ix.y1.value.toFixed(1)} / 목표 ${ix.targets.y1.toFixed(1)})`));
      const miss = [];
      c.indices.forEach((ix) => ix.subs.forEach((s) => { if (P.isNum(s.y1.rate) && s.y1.rate < 100) miss.push({ ix, s }); }));
      L.push('## 주의가 필요한 지표');
      if (miss.length) miss.forEach(({ ix, s }) => L.push(`- ${s.name}(${ix.no}) 달성률 ${pct(s.y1.rate)}: ${s.y1.note}`));
      else L.push('- 목표에 미달한 세부지표가 없습니다.');
      L.push('## 권고 조치');
      miss.forEach(({ ix, s }) => L.push(`- **${s.y2.owner || '담당 부서'}**: ${s.name} 미달 원인을 2차년도 추진 계획에 반영`));
      L.push('- **사업단**: 정의서 수치 불일치 항목을 연차보고서 제출 전에 정정');
      const open = d.issues.filter((i) => i.scope === 'y1' && !i.done);
      L.push('## 확인이 필요한 자료');
      if (open.length) open.forEach((i) => L.push(`- ${i.title}: ${i.desc}`));
      else L.push('- 미해결 점검 항목이 없습니다.');
      if (c.indices.some((ix) => ix.subs.every((s) => !P.isNum(s.y1.rate)))) L.push('- ④ 사회적책무혁신지수의 1차년도 세부 실적이 정의서에 없습니다.');
      return L.join('\n');
    }

    const pace = c.period.asOfRatio * 100;
    const all = [];
    c.indices.forEach((ix) => ix.subs.forEach((s) => all.push({ ix, s })));
    const missing = all.filter(({ s }) => s.v2 === null);
    const flagged = all.filter(({ s }) => s.v2 !== null && s.y2.flag);
    const confirmed = all.filter(({ s }) => s.v2 !== null && !s.y2.flag);
    const good = confirmed.filter(({ s }) => (s.type === 'count' ? s.r2 >= pace : s.r2 >= 100));
    const late = confirmed.filter(({ s }) => (s.type === 'count' ? s.r2 < pace : s.r2 < 100));

    L.push('## 종합 판단');
    L.push(`${d.meta.asOfLabel}(${d.meta.asOf.replace(/-/g, '.')}) 기준, 4개 지수의 2차년도 목표 대비 평균 진척률은 ${pct(c.avgY2)}이고 집계기간은 ${pace.toFixed(1)}% 지났습니다. 세부지표 ${all.length}개 중 확정 ${confirmed.length}개, 확인 필요 ${flagged.length}개, 미입력 ${missing.length}개입니다.`);
    L.push(missing.length
      ? '미입력 항목이 0으로 계산되고 지수는 3차년도 목표를 분모로 하므로, 현재 지수는 실제보다 낮게 나타납니다. 분기 판단은 세부지표 진척률을 기간 경과율과 비교해 보는 것이 정확합니다.'
      : '지수는 3차년도 목표를 분모로 하는 연말 기준 값이므로, 분기 판단은 세부지표 진척률을 기간 경과율과 비교해 보는 것이 정확합니다.');

    L.push('## 지수별 현황');
    c.indices.forEach((ix) => {
      const notes = ix.subs.map((s) => `${s.name} ${s.v2 === null ? '미입력' : pct(s.r2)}${s.v2 !== null && s.y2.flag ? '(' + s.y2.flag + ')' : ''}`).join(', ');
      L.push(`- **${ix.no} ${ix.name}** 진척률 ${pct(ix.r2)} (현재 ${ix.v2.toFixed(1)} / 목표 ${ix.targets.y2.toFixed(1)}). ${notes}`);
    });

    L.push('## 주의가 필요한 지표');
    if (!late.length && !missing.length) L.push('- 확정값 가운데 기간 경과율보다 뒤처진 지표가 없습니다.');
    late.forEach(({ ix, s }) => L.push(`- ${s.name}(${ix.no}) 진척률 ${pct(s.r2)}로 ${s.type === 'count' ? `기간 경과율(${pace.toFixed(1)}%)보다 낮습니다` : '목표에 못 미칩니다'}. ${s.y1.rate !== null && s.y1.rate < 100 ? '1차년도에도 미달한 지표입니다.' : ''}`.trim()));
    missing.forEach(({ ix, s }) => L.push(`- ${s.name}(${ix.no})는 값이 입력되지 않아 ${ix.no} 지수가 낮게 계산됩니다.`));
    if (good.length) L.push(`- 참고로 ${good.map(({ s }) => s.name + ' ' + pct(s.r2)).join(', ')}는 확정값 기준으로 진도가 양호합니다.`);

    L.push('## 권고 조치');
    missing.forEach(({ s }) => L.push(`- **${s.y2.owner || '담당 부서'}**: ${s.name} 값 입력`));
    flagged.forEach(({ s }) => {
      const act = s.y2.flag === '근거 확인' ? '현재값의 출처를 확인하거나 임시값으로 표기'
        : s.y2.flag === '계획 포함' ? '결과 확정 시 실적값으로 교체'
        : s.y2.flag === '부분 입력' ? '빈 세부운영지수 입력'
        : s.y2.flag === '집계 중' ? '집계 완료 일정 공유' : '값 확정';
      L.push(`- **${s.y2.owner || '담당 부서'}**: ${s.name} ${act}`);
    });
    late.forEach(({ s }) => L.push(`- **${s.y2.owner || '담당 부서'}**: ${s.name} 하반기 추진 계획과 만회 방안 보고`));

    L.push('## 확인이 필요한 자료');
    const open = d.issues.filter((i) => i.scope === 'y2' && !i.done);
    if (open.length) open.forEach((i) => L.push(`- [${i.level}] ${i.title} (담당 ${i.owner})`));
    else L.push('- 미해결 점검 항목이 없습니다.');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const soon = d.schedule.map((s) => ({ s, dt: P.parseDate(s.date) })).filter((x) => x.dt && x.dt >= today && (x.dt - today) / 86400000 <= 30);
    const undated = d.schedule.filter((s) => !P.parseDate(s.date)).length;
    soon.forEach(({ s, dt }) => L.push(`- 30일 이내 일정: ${s.title}, ${P.fmtDate(dt)} (${s.owner})`));
    if (undated) L.push(`- 날짜가 정해지지 않은 일정 ${undated}건`);
    return L.join('\n');
  }

  // ---------- AI 입력 데이터 ----------
  function aiInput() {
    const d = P.state.data;
    const c = P.compute(d);
    const isY2 = P.state.view === 'y2';
    const r1 = (v) => (P.isNum(v) ? Math.round(v * 10) / 10 : null);
    return {
      view: isY2 ? `2차년도('26) ${d.meta.asOfLabel} 진척 현황` : "1차년도('25) 성과 달성 현황",
      program: d.meta.program,
      asOf: d.meta.asOf,
      period: d.meta.period,
      paceRatio: isY2 ? r1(c.period.asOfRatio * 100) : null,
      averageRate: isY2 ? r1(c.avgY2) : d.meta.y1Average,
      indices: c.indices.map((ix) => ({
        no: ix.no, name: ix.name, formula: ix.formula,
        target: isY2 ? ix.targets.y2 : ix.targets.y1,
        value: isY2 ? r1(ix.v2) : ix.y1.value,
        rate: isY2 ? r1(ix.r2) : ix.y1.rate,
        hasMissing: isY2 ? ix.missing : undefined,
        subs: ix.subs.map((s) => ({
          name: s.name, type: s.type, weight: s.weight, unit: s.unit,
          target: isY2 ? s.targets.y2 : s.targets.y1,
          value: isY2 ? (s.v2 === null ? null : r1(s.v2)) : s.y1.value,
          rate: isY2 ? r1(s.r2) : s.y1.rate,
          flag: isY2 ? (s.v2 === null ? '미입력' : s.y2.flag || '확정') : undefined,
          note: isY2 ? P.compNote(s) : s.y1.note,
          owner: s.y2.owner,
          lastYearRate: isY2 ? s.y1.rate : undefined
        }))
      })),
      openIssues: d.issues.filter((i) => i.scope === P.state.view && !i.done).map((i) => ({ level: i.level, title: i.title, desc: i.desc, owner: i.owner })),
      schedule: isY2 ? d.schedule.map((s) => ({ title: s.title, date: s.date || '미정', owner: s.owner })) : undefined
    };
  }

  // ---------- 화면 ----------
  const viewKey = () => P.state.view;
  const stamp = (iso) => (iso || '').replace('T', ' ').slice(0, 16);

  function paint() {
    const d = P.state.data;
    const isY2 = P.state.view === 'y2';
    $('#reportMeta').textContent = (isY2 ? `2차년도('26) ${d.meta.asOfLabel} 진척 현황` : "1차년도('25) 성과 달성 현황") + `, 데이터 v${d.version}`;
    document.querySelectorAll('[data-rtab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rtab === r.tab)));
    const gen = $('#reportGen');
    gen.hidden = !(r.tab === 'ai' && r.ai);
    $('#reportNote').textContent = r.tab === 'auto' ? '입력된 수치로 즉시 만든 요약입니다.' :
      (r.ai ? `${r.model} 모델이 작성합니다. 수치는 반드시 원자료와 대조하세요.` : '');
    const note = $('#reportNote');
    if (r.tab === 'ai' && r.ai && isLocal()) note.insertAdjacentHTML('beforeend', ' <button type="button" class="btn-link" data-clearkey="1">API 키 삭제</button>');

    if (r.tab === 'auto') {
      r.autoText = autoReport();
      r.shownText = r.autoText;
      body.innerHTML = mdToHtml(r.autoText);
      const n = new Date(); const p2 = (x) => String(x).padStart(2, '0');
      $('#reportStamp').textContent = `작성 ${n.getFullYear()}.${p2(n.getMonth() + 1)}.${p2(n.getDate())} ${p2(n.getHours())}:${p2(n.getMinutes())} (자동)`;
      return;
    }
    if (!r.ai) {
      r.shownText = '';
      body.innerHTML = isLocal()
        ? `<div class="report-empty"><p>AI 요약을 쓰려면 Claude API 키가 필요합니다.<br>키는 이 PC의 이 브라우저에만 저장되며, 요약할 때 Anthropic API로 직접 전송됩니다.</p>
            <label class="field" style="width:min(420px,100%);text-align:left"><span>Claude API 키</span><input type="password" id="apiKeyInput" autocomplete="off" placeholder="sk-ant-..."></label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button type="button" class="btn-primary" data-savekey="1">키 저장</button><button type="button" class="btn-line" data-rtab="auto">자동 요약 보기</button></div>
            <p style="font-size:13px">공용 PC에서는 키를 저장하지 마세요. 키는 console.anthropic.com에서 발급합니다.</p></div>`
        : `<div class="report-empty"><p>AI 요약이 연결되어 있지 않습니다.<br>${r.edge ? '관리자가 Netlify 환경변수 <strong>ANTHROPIC_API_KEY</strong>를 설정하면 사용할 수 있습니다.' : '서버 폴더의 config.json에 <strong>anthropic_api_key</strong>를 입력하고 서버를 다시 실행하면 사용할 수 있습니다.'}</p>
            <button type="button" class="btn-line" data-rtab="auto">자동 요약 보기</button></div>`;
      $('#reportStamp').textContent = '';
      return;
    }
    if (r.busy) {
      body.innerHTML = '<div class="report-empty"><div class="spinner" aria-hidden="true"></div><p>AI가 현황을 요약하고 있습니다. 보통 10~30초 걸립니다.</p></div>';
      gen.disabled = true;
      return;
    }
    gen.disabled = false;
    const cached = r.cached[viewKey()];
    if (!cached) {
      r.shownText = '';
      gen.textContent = 'AI 요약 생성';
      body.innerHTML = `<div class="report-empty"><p>아직 생성된 AI 요약이 없습니다.</p><button type="button" class="btn-primary" data-gen="1">AI 요약 생성</button></div>`;
      $('#reportStamp').textContent = '';
      return;
    }
    gen.textContent = '다시 생성';
    r.shownText = cached.text;
    const stale = cached.version !== d.version;
    body.innerHTML = mdToHtml(cached.text) + (stale ? `<p class="report-warn">이 요약은 데이터 v${P.esc(cached.version)} 기준입니다. 이후 실적이 바뀌었으니 '다시 생성'을 눌러 최신 내용으로 갱신하세요.</p>` : '');
    $('#reportStamp').textContent = `생성 ${stamp(cached.generatedAt).replace(/-/g, '.')} · ${cached.by}`;
  }

  async function loadMeta() {
    if (isLocal()) {
      r.ai = !!localStorage.getItem(LS_KEY);
      r.model = localStorage.getItem(LS_MODEL) || DEFAULT_MODEL;
      try { r.cached = JSON.parse(localStorage.getItem(LS_SUM) || '{}'); } catch (e) { r.cached = {}; }
      return;
    }
    try {
      const res = await fetch('/api/summary', { cache: 'no-store' });
      const j = await res.json();
      r.ai = !!j.ai;
      r.edge = !!j.edge;
      r.model = j.model || '';
      r.cached = j.cached || {};
    } catch (e) {
      r.ai = false;
    }
  }

  async function generate() {
    if (r.busy) return;
    const editor = localStorage.getItem('pms.editor') || window.prompt('요청자 이름을 입력하세요.') || '';
    if (!editor) return;
    localStorage.setItem('pms.editor', editor);
    r.busy = true;
    paint();
    if (isLocal()) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': localStorage.getItem(LS_KEY) || '',
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: r.model, max_tokens: 2000, system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: '다음은 성과관리 시스템의 현재 데이터(JSON)입니다. 형식에 맞춰 요약 보고서를 작성해 주세요.\n\n' + JSON.stringify(aiInput()) }]
          })
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          const m = (j.error && j.error.message) || '';
          throw new Error(res.status === 401 ? 'API 키가 올바르지 않습니다. 키를 삭제하고 다시 입력하세요.' : `AI 서비스 오류(${res.status}) ${m}`.trim());
        }
        const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        if (!text) throw new Error('AI가 빈 응답을 보냈습니다. 다시 시도해 주세요.');
        const n = new Date();
        const p2 = (x) => String(x).padStart(2, '0');
        r.cached[viewKey()] = { text, version: P.state.data.version, generatedAt: `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())}T${p2(n.getHours())}:${p2(n.getMinutes())}`, by: editor, model: r.model };
        try { localStorage.setItem(LS_SUM, JSON.stringify(r.cached)); } catch (e) { /* 저장 공간 부족 시 무시 */ }
        P.toast('AI 요약을 만들었습니다.');
      } catch (e) {
        P.toast(e.message === 'Failed to fetch' ? 'AI 서비스에 연결하지 못했습니다. 인터넷 연결을 확인하세요.' : e.message);
      } finally {
        r.busy = false;
        paint();
      }
      return;
    }
    if (r.edge) {
      try {
        const gen = await fetch('/api/ai-summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: aiInput() }) });
        const g = await gen.json().catch(() => ({}));
        if (!gen.ok) throw new Error(g.error || 'AI 요약을 만들지 못했습니다.');
        const saveRes = await fetch('/api/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ view: viewKey(), version: P.state.data.version, editor, text: g.text, model: g.model }) });
        const entry = await saveRes.json().catch(() => ({}));
        r.cached[viewKey()] = saveRes.ok ? entry : { text: g.text, version: P.state.data.version, generatedAt: new Date().toISOString(), by: editor, model: g.model };
        P.toast('AI 요약을 만들었습니다. 다른 사용자도 같은 요약을 볼 수 있습니다.');
      } catch (e) {
        P.toast(e.message === 'Failed to fetch' ? 'AI 서비스에 연결하지 못했습니다.' : e.message);
      } finally {
        r.busy = false;
        paint();
      }
      return;
    }
    try {
      const headers = { 'Content-Type': 'application/json' };
      const key = sessionStorage.getItem('pms.editKey');
      if (key) headers['X-Edit-Key'] = key;
      let res = await fetch('/api/summary', { method: 'POST', headers, body: JSON.stringify({ view: viewKey(), version: P.state.data.version, editor, input: aiInput() }) });
      if (res.status === 401) {
        const k = window.prompt('편집 비밀번호를 입력하세요.');
        if (!k) throw new Error('비밀번호가 없어 요약을 만들지 않았습니다.');
        sessionStorage.setItem('pms.editKey', k);
        P.state.editKey = k;
        headers['X-Edit-Key'] = k;
        res = await fetch('/api/summary', { method: 'POST', headers, body: JSON.stringify({ view: viewKey(), version: P.state.data.version, editor, input: aiInput() }) });
      }
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'AI 요약을 만들지 못했습니다.');
      r.cached[viewKey()] = j;
      P.toast('AI 요약을 만들었습니다. 다른 사용자도 같은 요약을 볼 수 있습니다.');
    } catch (e) {
      P.toast(e.message);
    } finally {
      r.busy = false;
      paint();
    }
  }

  function printReport() {
    if (!r.shownText) { P.toast('인쇄할 요약이 없습니다.'); return; }
    const d = P.state.data;
    const w = window.open('', '_blank');
    if (!w) { P.toast('팝업이 차단되어 인쇄 창을 열지 못했습니다.'); return; }
    w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>자율성과지표 요약 보고서 | 경북과학대학교</title>
      <style>body{font-family:'IBM Plex Sans KR','Malgun Gothic',sans-serif;max-width:720px;margin:32px auto;padding:0 24px;color:#1A2233;line-height:1.7;font-size:14px}
      h1{font-size:22px;margin:0 0 4px}.m{color:#4A5568;font-size:13px;margin:0 0 20px}h3{font-size:16px;margin:20px 0 6px;border-bottom:2px solid #F5B700;display:inline-block}ul{padding-left:20px}</style></head>
      <body><h1>${P.esc(P.univName(d))} 전문대학 혁신지원사업 자율성과지표 요약 보고서</h1>
      <p class="m">${P.esc($('#reportMeta').textContent)} · ${P.esc($('#reportStamp').textContent)}</p>${mdToHtml(r.shownText)}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  // ---------- 이벤트 ----------
  $('#reportBtn').addEventListener('click', async () => {
    if (!P.state.data) return;
    await loadMeta();
    r.tab = r.ai ? 'ai' : 'auto';
    paint();
    dlg.showModal();
  });
  dlg.addEventListener('click', (e) => {
    const t = e.target.closest('[data-rtab]');
    if (t) { r.tab = t.dataset.rtab; paint(); return; }
    if (e.target.closest('[data-gen]')) generate();
    if (e.target.closest('[data-savekey]')) {
      const v = ($('#apiKeyInput').value || '').trim();
      if (!v) { $('#apiKeyInput').focus(); return; }
      localStorage.setItem(LS_KEY, v);
      r.ai = true;
      paint();
      P.toast('API 키를 이 브라우저에 저장했습니다.');
    }
    if (e.target.closest('[data-clearkey]')) {
      localStorage.removeItem(LS_KEY);
      r.ai = false;
      paint();
      P.toast('API 키를 삭제했습니다.');
    }
  });
  $('#reportGen').addEventListener('click', generate);
  $('#reportCopy').addEventListener('click', async () => {
    if (!r.shownText) { P.toast('복사할 요약이 없습니다.'); return; }
    const plain = r.shownText.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^##\s+/gm, '■ ').replace(/^-\s+/gm, '  · ');
    try { await navigator.clipboard.writeText(plain); P.toast('요약을 복사했습니다.'); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = plain; dlg.appendChild(ta); ta.select();
      try { document.execCommand('copy'); P.toast('요약을 복사했습니다.'); } catch (x) { P.toast('복사하지 못했습니다.'); }
      ta.remove();
    }
  });
  $('#reportPrint').addEventListener('click', printReport);
  $('#reportClose').addEventListener('click', () => dlg.close());
  $('#reportOk').addEventListener('click', () => dlg.close());
})();
