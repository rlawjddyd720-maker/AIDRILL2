/* AI 사업단 성과관리 시스템 - 화면 로직 (외부 라이브러리 없음) */
(function () {
  'use strict';

  const POLL_MS = 30000; // 다른 사용자 저장 확인 주기(화면이 보일 때만)
  const $ = (s, r) => (r || document).querySelector(s);
  const app = $('#app');

  const state = {
    data: null,
    view: localStorage.getItem('pms.view') || 'y2',          // y2: 2차 진행, y1: 1차 실적
    colorMode: localStorage.getItem('pms.colorMode') || 'target', // target: 목표 대비, pace: 기간 경과 반영
    editKey: sessionStorage.getItem('pms.editKey') || '',
    saving: false,
    mode: null,
    inlineEdit: null
  };

  // ---------- 유틸 ----------
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const fmtNum = (v) => {
    if (!isNum(v)) return '—';
    const d = Math.abs(v) < 10 && !Number.isInteger(v) ? 2 : (Number.isInteger(v) ? 0 : 1);
    return v.toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: d });
  };
  const fmtPct = (v) => (isNum(v) ? v.toFixed(1) + '%' : '—');
  const pad = (n) => String(n).padStart(2, '0');
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const parseDate = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const fmtDate = (d) => d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + ' (' + DAYS[d.getDay()] + ')';

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 3500);
  }

  // ---------- 테마 ----------
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const b = $('#themeBtn');
    b.textContent = theme === 'dark' ? '일반 모드' : '다크 모드';
    b.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  }
  let theme = localStorage.getItem('pms.theme') ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(theme);
  $('#themeBtn').addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('pms.theme', theme);
    applyTheme(theme);
  });

  // ---------- 계산 ----------
  function periodInfo(meta, at) {
    const start = parseDate(meta.period.start);
    const endEx = parseDate(meta.period.end);
    endEx.setDate(endEx.getDate() + 1);
    const ratio = (d) => Math.max(0, Math.min(1, (d - start) / (endEx - start)));
    const asOf = parseDate(meta.asOf) || at;
    return { asOfRatio: ratio(asOf), todayRatio: ratio(at) };
  }

  function subValueY2(s) {
    const y = s.y2;
    const vals = y.components.map((c) => (isNum(c.value) ? c.value : null));
    if (y.agg === 'ratio') {
      const [a, b] = vals;
      return isNum(a) && isNum(b) && a > 0 ? (b / a) * 100 : null;
    }
    if (y.agg === 'single') return vals[0];
    const filled = vals.filter((v) => v !== null);
    return filled.length ? filled.reduce((x, v) => x + v, 0) : null;
  }

  function compute(data) {
    const p = periodInfo(data.meta, new Date());
    const indices = data.indices.map((ix) => {
      let indexY2 = 0;
      let missing = false;
      const subs = ix.subs.map((s) => {
        const v2 = subValueY2(s);
        if (v2 === null) missing = true;
        indexY2 += ((v2 || 0) / s.targets.y3) * 100 * s.weight;
        const r2 = v2 === null ? null : (v2 / s.targets.y2) * 100;
        const partial = s.y2.agg === 'sum' && s.y2.components.some((c) => !isNum(c.value)) && v2 !== null;
        return { ...s, v2, r2, partial };
      });
      const r2 = (indexY2 / ix.targets.y2) * 100;
      return { ...ix, subs, v2: indexY2, r2, missing };
    });
    const avgY2 = indices.reduce((a, ix) => a + ix.r2, 0) / indices.length;
    return { indices, avgY2, period: p };
  }

  // 색상: 90% 이상 초록 · 60% 이상 주황 · 60% 미만 빨강
  function colorFor(pct) {
    if (!isNum(pct)) return 'var(--flag)';
    if (pct >= 90) return 'var(--green)';
    if (pct >= 60) return 'var(--orange)';
    return 'var(--red)';
  }

  // 기간 경과 반영 모드: 누적형 지표는 (진척률 ÷ 경과율)로 색을 판단
  function colorBasis(pct, type, pace) {
    if (state.colorMode === 'pace' && type === 'count' && isNum(pct) && pace > 0) return pct / pace;
    return pct;
  }

  function donutSVG(pct, color, opts) {
    const o = opts || {};
    const size = o.size || 140;
    const C = 2 * Math.PI * 50;
    const p = isNum(pct) ? Math.max(0, Math.min(pct, 100)) : 0;
    const len = (p / 100) * C;
    const cap = p > 0 && p < 100 ? 'round' : 'butt';
    let tick = '';
    if (isNum(o.tick)) {
      const a = (o.tick * 360 - 90) * Math.PI / 180;
      const x1 = 60 + 41 * Math.cos(a), y1 = 60 + 41 * Math.sin(a);
      const x2 = 60 + 59 * Math.cos(a), y2 = 60 + 59 * Math.sin(a);
      tick = `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="var(--strong)" stroke-width="2"/>`;
    }
    return `<svg width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="${esc(o.aria || '')}">
      <circle cx="60" cy="60" r="50" fill="none" stroke="var(--track)" stroke-width="11"/>
      <circle class="arc" cx="60" cy="60" r="50" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="${cap}" stroke-dasharray="${len.toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 60 60)"/>
      ${tick}
      <text x="60" y="62" text-anchor="middle" font-size="21" font-weight="700" fill="var(--strong)">${esc(isNum(pct) ? pct.toFixed(1) + '%' : '—')}</text>
      <text x="60" y="79" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(o.caption || '')}</text>
    </svg>`;
  }

  function subStatus(s, isY2) {
    if (!isY2) {
      if (!isNum(s.y1.rate)) return { text: '자료 없음', cls: 'flag' };
      return s.y1.rate >= 100 ? { text: '달성', cls: 'ok' } : { text: '미달', cls: 'miss' };
    }
    if (s.v2 === null) return { text: '미입력', cls: 'flag' };
    if (s.y2.flag) return { text: s.y2.flag, cls: 'flag' };
    return { text: '확정', cls: 'ok' };
  }

  // 대학명: 저장된 값이 자리표시([..])이면 기본값 사용
  const univName = (d) => (d && d.meta && d.meta.university && !/^\[/.test(d.meta.university) ? d.meta.university : '경북과학대학교');

  // ---------- 렌더 ----------
  function render() {
    const data = state.data;
    if (!data) return;
    const c = compute(data);
    const isY2 = state.view === 'y2';
    const pace = c.period.asOfRatio;
    const now = new Date();

    $('#brandUniv').textContent = univName(data);
    $('#footUpdated').textContent = (state.mode === 'local' ? '단독 실행(이 브라우저에 저장) · ' : '') + '최종 저장 ' + (data.updatedAt || '').replace('T', ' ').slice(0, 16) + ' · ' + (data.updatedBy || '') + ' · v' + data.version;
    $('#editBtn').hidden = !isY2;

    // 상태 집계
    const counts = { done: 0, flag: 0, missing: 0 };
    c.indices.forEach((ix) => ix.subs.forEach((s) => {
      if (s.v2 === null) counts.missing++; else if (s.y2.flag) counts.flag++; else counts.done++;
    }));

    const head = `
      <section class="page-head">
        <div>
          <div class="eyebrow">${esc(data.meta.program)} 자율성과지표</div>
          <h1>${isY2 ? `2차년도('26) ${esc(data.meta.asOfLabel)} 진척 현황` : `1차년도('25) 성과 달성 현황`}</h1>
          <p><span class="now" id="nowText">${esc(nowText())}</span>
            ${isY2 ? `, 자료 기준일 ${esc(data.meta.asOf.replace(/-/g, '.'))}` : ', 정의서 원값 기준'}</p>
        </div>
        <div class="head-ctrls">
          <div class="seg" role="group" aria-label="연차 선택">
            <button type="button" data-view="y2" aria-pressed="${isY2}">2차년도 진행</button>
            <button type="button" data-view="y1" aria-pressed="${!isY2}">1차년도 실적</button>
          </div>
          ${isY2 ? `<div class="seg" role="group" aria-label="색상 기준">
            <button type="button" data-color="target" aria-pressed="${state.colorMode === 'target'}">목표 대비</button>
            <button type="button" data-color="pace" aria-pressed="${state.colorMode === 'pace'}">기간 경과 반영</button>
          </div>` : ''}
          <div class="tools">
            <button type="button" class="btn-line" data-act="csv">CSV 내려받기</button>
            <button type="button" class="btn-line" data-act="export">JSON 내보내기</button>
            <button type="button" class="btn-line" data-act="import">JSON 불러오기</button>
            ${state.mode === 'server' ? '<button type="button" class="btn-line" data-act="history">변경 이력</button>' : ''}
            <button type="button" class="btn-line" data-act="print">인쇄</button>
          </div>
        </div>
      </section>`;

    const period = isY2 ? `
      <section class="card period" aria-label="집계기간 경과">
        <div class="period-main">
          <div class="period-text">
            <b>집계기간 ${esc(data.meta.period.start.replace(/-/g, '.'))} – ${esc(data.meta.period.end.replace(/-/g, '.'))}</b>
            <span>자료 기준일 경과 ${(pace * 100).toFixed(1)}%, 오늘 기준 <span id="todayRatio">${(c.period.todayRatio * 100).toFixed(1)}</span>%</span>
          </div>
          <div class="bar"><div class="fill" style="width:${(c.period.todayRatio * 100).toFixed(1)}%"></div><div class="mark" style="left:calc(${(pace * 100).toFixed(1)}% - 1px)"></div></div>
        </div>
        <div class="pills">
          <span class="pill chip ok">확정 ${counts.done}</span>
          <span class="pill chip flag">확인 필요 ${counts.flag}</span>
          <span class="pill chip miss">미입력 ${counts.missing}</span>
        </div>
      </section>` : '';

    const legend = `<div class="legend">
        <span><i style="background:var(--green)"></i>90% 이상</span>
        <span><i style="background:var(--orange)"></i>60–90%</span>
        <span><i style="background:var(--red)"></i>60% 미만</span>
        ${isY2 ? (state.colorMode === 'target' ? '<span><i class="tick"></i>기간 경과 지점</span>' : '<span>누적 지표는 경과율 대비로 색 판단</span>') : '<span><i style="background:var(--flag)"></i>자료 없음</span>'}
      </div>`;

    // 지수 도넛
    const avg = isY2 ? c.avgY2 : data.meta.y1Average;
    const tickIdx = isY2 && state.colorMode === 'target' ? pace : null;
    const idxColor = (r) => colorFor(isY2 && state.colorMode === 'pace' ? r / pace : r);
    let donuts = `<div class="donut">${donutSVG(avg, idxColor(avg), { caption: isY2 ? '4개 지수 평균' : '평균 달성도', tick: tickIdx, aria: '종합 ' + fmtPct(avg) })}
        <span class="d-label">종합</span><span class="d-detail">${isY2 ? (c.indices.some((i) => i.missing) ? '미입력 항목 포함' : '4개 지수 평균') : '4개 지수 모두 목표 초과'}</span></div>`;
    c.indices.forEach((ix) => {
      const r = isY2 ? ix.r2 : ix.y1.rate;
      donuts += `<div class="donut">${donutSVG(r, idxColor(r), { caption: isY2 ? '2차 목표 대비' : '1차 달성도', tick: tickIdx, aria: ix.name + ' ' + fmtPct(r) })}
        <span class="d-label">${esc(ix.no)} ${esc(ix.name)}</span>
        <span class="d-detail">${isY2 ? `현재 ${ix.v2.toFixed(1)} / 목표 ${ix.targets.y2.toFixed(1)}` : `실적 ${ix.y1.value.toFixed(1)} / 목표 ${ix.targets.y1.toFixed(1)}`}</span></div>`;
    });

    const roadmap = `<div class="table-box"><table class="wide">
      <caption>연차별 목표 로드맵 (3차년도 '27 목표 = 100.0)</caption>
      <thead><tr><th scope="col">자율성과지표</th><th scope="col">기준값</th><th scope="col">1차 목표</th><th scope="col">1차 실적</th><th scope="col">1차 달성도</th><th scope="col">2차 목표</th><th scope="col">2차 현재</th><th scope="col">2차 진척률</th></tr></thead>
      <tbody>${c.indices.map((ix) => `<tr>
        <th scope="row">${esc(ix.no)} ${esc(ix.name)}</th>
        <td>${ix.base.toFixed(1)}</td><td>${ix.targets.y1.toFixed(1)}</td>
        <td class="v">${ix.y1.value.toFixed(1)}</td><td class="r" style="color:${colorFor(ix.y1.rate)}">${fmtPct(ix.y1.rate)}</td>
        <td>${ix.targets.y2.toFixed(1)}</td><td class="v">${ix.v2.toFixed(1)}</td>
        <td class="r" style="color:${idxColor(ix.r2)}">${fmtPct(ix.r2)}</td></tr>`).join('')}
      </tbody></table></div>
      ${isY2 ? '<p class="memo">2차 지수는 3차년도 목표를 분모로 한 연말 기준 값이라 집계 중간에는 낮게 나옵니다. 미입력 항목은 0으로 계산됩니다. 분기 점검은 세부지표 진척률을 기간 경과율과 함께 보세요.</p>' : ''}`;

    const indexCard = `<section class="card" aria-labelledby="idxTitle">
      <div class="card-head"><div><h2 id="idxTitle">${isY2 ? '지수별 진척률' : '지수별 달성도'}</h2>
        <p>${isY2 ? '2차년도 목표 대비 현재 지수' : '1차년도 목표 대비 실적 (문서 원값)'}</p></div>${legend}</div>
      <div class="donut-grid">${donuts}</div>${roadmap}</section>`;

    // 지표별 섹션
    const sections = c.indices.map((ix) => {
      const subDonuts = ix.subs.map((s) => {
        const r = isY2 ? s.r2 : s.y1.rate;
        const st = subStatus(s, isY2);
        const tk = isY2 && state.colorMode === 'target' && s.type === 'count' ? pace : null;
        return `<div class="donut">${donutSVG(r, colorFor(isY2 ? colorBasis(r, s.type, pace) : r), { size: 116, caption: isY2 ? '진척률' : '달성률', tick: tk, aria: s.name + ' ' + fmtPct(r) + ', ' + st.text })}
          <span class="d-label">${esc(s.name)}</span><span class="chip ${st.cls}">${esc(st.text)}</span></div>`;
      }).join('');
      const rows = ix.subs.map((s) => {
        const y = isY2 ? { t: s.targets.y2, v: s.v2, r: s.r2, note: compNote(s) } : { t: s.targets.y1, v: s.y1.value, r: s.y1.rate, note: s.y1.note };
        const col = colorFor(isY2 ? colorBasis(y.r, s.type, pace) : y.r);
        const editing = isY2 && state.inlineEdit === s.id;
        const valueText = isNum(y.v) ? fmtNum(y.v) + esc(s.unit) : '—';
        const valueCell = isY2
          ? `<button type="button" class="cell-edit" data-inline-edit="${esc(s.id)}" aria-expanded="${editing}" aria-label="${esc(s.name)} 현재값 수정">
               <span>${isNum(y.v) ? valueText : '입력'}</span>
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
             </button>`
          : valueText;
        return `<tr class="${editing ? 'is-editing' : ''}"><th scope="row">${esc(s.name)} <span class="w">(${Math.round(s.weight * 100)}%)</span></th>
          <td>${fmtNum(y.t)}${esc(s.unit)}</td>
          <td class="v">${valueCell}</td>
          <td class="r" style="color:${col}">${fmtPct(y.r)}</td>
          <td class="note">${esc(y.note)}${isY2 && s.y2.owner ? `<br><span class="sub-meta">${esc(s.y2.owner)}${s.y2.manager ? ' · ' + esc(s.y2.manager) : ''}</span>` : ''}</td></tr>
          ${editing ? inlineEditor(s) : ''}`;
      }).join('');
      const memo = isY2 && ix.missing ? `<p class="memo">미입력 항목이 있어 지수(${ix.v2.toFixed(1)})가 실제보다 낮게 계산되었습니다.</p>` :
        (!isY2 && ix.subs.every((s) => !isNum(s.y1.rate)) ? '<p class="memo">정의서에 1차년도 세부 실적이 없어 지수 실적만 반영했습니다.</p>' : '');
      return `<section class="card" id="sec-${esc(ix.id)}">
        <div class="card-head"><div><h2>${esc(ix.no)} ${esc(ix.name)}</h2><p>${esc(ix.area)}</p></div>
          <span class="sub-meta">${isY2 ? `지수 ${ix.v2.toFixed(1)} / 2차 목표 ${ix.targets.y2.toFixed(1)}, 진척률 ${fmtPct(ix.r2)}` : `지수 ${ix.y1.value.toFixed(1)} / 1차 목표 ${ix.targets.y1.toFixed(1)}, 달성도 ${fmtPct(ix.y1.rate)}`}</span></div>
        <div class="donut-grid sm">${subDonuts}</div>
        <div class="table-box"><table class="wide">
          <thead><tr><th scope="col">세부지표 (가중치)</th><th scope="col">${isY2 ? '2차 목표' : '1차 목표'}</th><th scope="col">${isY2 ? '현재값 <span class="w">(눌러서 수정)</span>' : '1차 실적'}</th><th scope="col">${isY2 ? '진척률' : '달성률'}</th><th scope="col" class="l">산출 내역 · 비고</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
        ${memo}
        <details class="def"><summary>지표 정의와 산출식</summary><dl>
          <dt>정의</dt><dd>${esc(ix.definition)}</dd>
          <dt>산출식</dt><dd>${esc(ix.formula)} · 각 세부지표 ÷ 3차년도 목표 × 100 × 가중치</dd>
          ${ix.subs.map((s) => `<dt>${esc(s.name)}</dt><dd>${esc(s.criteria)} · 목표 ${fmtNum(s.targets.base)} → ${fmtNum(s.targets.y1)} → ${fmtNum(s.targets.y2)} → ${fmtNum(s.targets.y3)}${esc(s.unit)}</dd>`).join('')}
        </dl></details>
      </section>`;
    }).join('');

    // 사이드
    const issues = data.issues.filter((i) => i.scope === state.view);
    const openCount = issues.filter((i) => !i.done).length;
    const issueCard = `<section class="card" aria-labelledby="issueTitle">
      <div class="card-head"><h2 id="issueTitle">자료 점검</h2><span class="badge-count">미해결 ${openCount}건</span></div>
      <p class="sub-meta" style="margin:0">${isY2 ? '2분기 엑셀 파일 기준. 해결되면 체크하세요(모두에게 반영).' : '정의서 기준. 수치는 원문대로 표기했습니다.'}</p>
      <ul class="issue-list">${issues.map((i) => `<li class="issue ${i.done ? 'done' : ''}">
        <input type="checkbox" id="iss-${esc(i.id)}" data-issue="${esc(i.id)}" ${i.done ? 'checked' : ''}>
        <label for="iss-${esc(i.id)}"><span class="it">${esc(i.title)}</span><span class="id">${esc(i.desc)}</span><span class="io">담당 ${esc(i.owner)}</span></label>
        <span class="lv ${esc(i.level)}">${esc(i.level)}</span></li>`).join('')}</ul></section>`;

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sched = data.schedule.map((s) => {
      const d = parseDate(s.date);
      let dd = 'D-[ ]', soon = false, when = '날짜 미정';
      if (d) {
        const diff = Math.round((d - today) / 86400000);
        dd = diff === 0 ? 'D-DAY' : diff > 0 ? 'D-' + diff : 'D+' + (-diff);
        soon = diff >= 0 && diff <= 7;
        when = fmtDate(d);
      }
      return `<li><span class="dday ${soon ? 'soon' : ''}">${dd}</span><span><span class="st">${esc(s.title)}</span><br><span class="sd">${esc(when)}, ${esc(s.owner)}</span></span></li>`;
    }).join('');
    const schedCard = `<section class="card" aria-labelledby="schedTitle"><h2 id="schedTitle">주요 일정</h2>
      <ul class="sched">${sched}</ul>${isY2 ? '<p class="sub-meta" style="margin:0">날짜는 실적 입력 화면에서 정합니다.</p>' : ''}</section>`;

    app.innerHTML = head + period + indexCard +
      `<div class="cols"><div class="main-col">${sections}</div><aside>${issueCard}${schedCard}</aside></div>`;
  }

  // ---------- 현재값 바로 수정(표 안 편집) ----------
  function inlineEditor(s) {
    const editor = localStorage.getItem('pms.editor') || '';
    const formula = s.y2.agg === 'ratio' ? 'B/A×100으로 자동 계산' : s.y2.agg === 'sum' ? '합계로 자동 계산' : '';
    return `<tr class="inline-row"><td colspan="5">
      <div class="inline-form" data-inline-form="${esc(s.id)}" role="group" aria-label="${esc(s.name)} 현재값 수정">
        <div class="edit-grid">
          ${s.y2.components.map((c, k) => `<label class="field"><span>${esc(c.name)}</span>
            <input type="number" step="any" inputmode="decimal" data-comp="${k}" value="${isNum(c.value) ? c.value : ''}"></label>`).join('')}
          <label class="field"><span>상태</span><select data-flag>
            ${FLAGS.map((f) => `<option value="${esc(f)}" ${s.y2.flag === f ? 'selected' : ''}>${f ? esc(f) : '확정'}</option>`).join('')}
          </select></label>
        </div>
        <label class="field"><span>비고 · 근거 문서</span><textarea rows="2" data-note>${esc(s.y2.note)}</textarea></label>
        <div class="inline-foot">
          <span class="calc" data-inline-calc>${formula}</span>
          <label class="field inline"><span>입력자</span><input type="text" data-editor maxlength="40" value="${esc(editor)}" placeholder="이름 또는 부서"></label>
          <button type="button" class="btn-line" data-inline-cancel>취소</button>
          <button type="button" class="btn-primary" data-inline-save="${esc(s.id)}">저장</button>
        </div>
      </div></td></tr>`;
  }

  function readInline(form, sub) {
    const draft = clone(sub);
    form.querySelectorAll('[data-comp]').forEach((inp) => {
      const raw = inp.value.trim();
      draft.y2.components[+inp.dataset.comp].value = raw === '' ? null : Number(raw);
    });
    draft.y2.flag = form.querySelector('[data-flag]').value;
    draft.y2.note = form.querySelector('[data-note]').value.trim();
    return draft;
  }

  function findSub(data, id) {
    for (const ix of data.indices) for (const s of ix.subs) if (s.id === id) return s;
    return null;
  }

  function updateInlineCalc(form) {
    const sub = findSub(state.data, form.dataset.inlineForm);
    if (!sub) return;
    const v = subValueY2(readInline(form, sub));
    const el = form.querySelector('[data-inline-calc]');
    el.innerHTML = v === null ? '현재값 <b>미입력</b>' :
      `현재값 <b>${fmtNum(+v.toFixed(2))}${esc(sub.unit)}</b>, 진척률 <b style="color:${colorFor((v / sub.targets.y2) * 100)}">${fmtPct((v / sub.targets.y2) * 100)}</b>`;
  }

  function openInline(id) {
    state.inlineEdit = id;
    render();
    const form = document.querySelector(`[data-inline-form="${id}"]`);
    if (form) {
      updateInlineCalc(form);
      const first = form.querySelector('input[data-comp]');
      if (first) { first.focus(); first.select(); }
    }
  }

  function closeInline(focusId) {
    state.inlineEdit = null;
    render();
    const b = focusId && document.querySelector(`[data-inline-edit="${focusId}"]`);
    if (b) b.focus();
  }

  async function saveInline(id) {
    const form = document.querySelector(`[data-inline-form="${id}"]`);
    if (!form) return;
    const editorInput = form.querySelector('[data-editor]');
    const editor = editorInput.value.trim();
    if (!editor) { editorInput.focus(); toast('입력자 이름을 적어 주세요.'); return; }
    localStorage.setItem('pms.editor', editor);
    const next = clone(state.data);
    const target = findSub(next, id);
    const draft = readInline(form, target);
    target.y2.components = draft.y2.components;
    target.y2.flag = draft.y2.flag;
    target.y2.note = draft.y2.note;
    const btn = form.querySelector('[data-inline-save]');
    btn.disabled = true;
    btn.textContent = '저장 중';
    const ok = await save(next, editor);
    if (ok) closeInline(id);
    else if (state.inlineEdit === id) {
      const f = document.querySelector(`[data-inline-form="${id}"]`);
      if (f) updateInlineCalc(f);
    }
  }

  app.addEventListener('input', (e) => {
    const form = e.target.closest('[data-inline-form]');
    if (form) updateInlineCalc(form);
  });
  app.addEventListener('keydown', (e) => {
    const form = e.target.closest('[data-inline-form]');
    if (!form) return;
    if (e.key === 'Escape') { e.preventDefault(); closeInline(form.dataset.inlineForm); }
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveInline(form.dataset.inlineForm); }
  });

  function compNote(s) {
    const parts = s.y2.components.map((c) => c.name + ' ' + (isNum(c.value) ? fmtNum(c.value) : '미입력'));
    const formula = s.y2.agg === 'ratio' ? ' (B/A×100)' : '';
    const head = s.y2.agg === 'single' ? '' : parts.join(', ') + formula;
    return [head, s.y2.note].filter(Boolean).join(' / ');
  }

  function nowText() {
    const n = new Date();
    return '오늘 ' + fmtDate(n) + ' ' + pad(n.getHours()) + ':' + pad(n.getMinutes());
  }
  setInterval(() => {
    const el = $('#nowText');
    if (el) el.textContent = nowText();
  }, 10000);

  // ---------- 저장소: 서버 모드(server.py로 실행) / 단독 파일 모드(HTML만 열기) ----------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const LS_DATA = 'pms.data';
  const LS_BACKUP = 'pms.backups';

  function setSync(text, cls) {
    const s = $('#syncState');
    s.textContent = text;
    s.className = 'sync ' + (cls || '');
  }

  function localIso() {
    const d = new Date();
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      sign + pad(Math.floor(Math.abs(off) / 60)) + ':' + pad(Math.abs(off) % 60);
  }

  async function detectMode() {
    if (!/^https?:$/.test(location.protocol)) return 'local';
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2500);
      const res = await fetch('/api/version', { cache: 'no-store', signal: ctl.signal });
      clearTimeout(timer);
      return res.ok && (res.headers.get('content-type') || '').includes('json') ? 'server' : 'local';
    } catch (e) {
      return 'local';
    }
  }

  const seedData = () => clone(window.PMS_SEED);
  function readLocal() {
    try {
      const raw = localStorage.getItem(LS_DATA);
      return raw ? JSON.parse(raw) : seedData();
    } catch (e) {
      return seedData();
    }
  }
  function writeLocal(d) {
    try {
      const prev = localStorage.getItem(LS_DATA);
      if (prev) {
        const list = JSON.parse(localStorage.getItem(LS_BACKUP) || '[]');
        list.unshift(prev);
        localStorage.setItem(LS_BACKUP, JSON.stringify(list.slice(0, 20)));
      }
      localStorage.setItem(LS_DATA, JSON.stringify(d));
      return true;
    } catch (e) {
      return false;
    }
  }

  async function load() {
    if (!state.mode) state.mode = await detectMode();
    if (state.mode === 'local') {
      if (!window.PMS_SEED && !localStorage.getItem(LS_DATA)) {
        app.innerHTML = '<div class="error-box">초기 데이터를 찾지 못했습니다. 단독 실행용 HTML 파일을 사용하세요.</div>';
        return;
      }
      state.data = readLocal();
      setSync('이 브라우저에 저장', 'ok');
      render();
      return;
    }
    try {
      const res = await fetch('/api/data', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      state.data = await res.json();
      setSync('실시간 연결', 'ok');
      render();
    } catch (e) {
      setSync('서버 연결 끊김', 'err');
      if (!state.data) app.innerHTML = '<div class="error-box">서버에 연결하지 못했습니다. 서버 PC에서 프로그램이 실행 중인지, 같은 와이파이에 연결되어 있는지 확인하세요.</div>';
    }
  }

  async function poll() {
    if (state.mode !== 'server' || document.hidden) return;
    if (state.saving || state.inlineEdit || $('#editDialog').open || $('#reportDialog').open || $('#historyDialog').open) return;
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      const v = await res.json();
      setSync('실시간 연결', 'ok');
      if (state.data && v.version !== state.data.version) {
        await load();
        toast((v.updatedBy || '다른 사용자') + '님이 저장한 최신 내용을 불러왔습니다.');
      }
    } catch (e) {
      setSync('서버 연결 끊김', 'err');
    }
  }

  window.addEventListener('storage', (e) => {
    if (state.mode === 'local' && e.key === LS_DATA && !$('#editDialog').open && !state.inlineEdit) {
      state.data = readLocal();
      render();
      toast('다른 탭에서 저장한 내용을 불러왔습니다.');
    }
  });

  async function save(next, editor) {
    if (state.mode === 'local') {
      delete next._auth;
      next.version = (state.data.version || 0) + 1;
      next.updatedAt = localIso();
      next.updatedBy = String(editor || '이름 없음').slice(0, 40);
      if (!writeLocal(next)) {
        toast('브라우저에 저장하지 못했습니다. JSON 내보내기로 백업하세요.');
        return false;
      }
      state.data = next;
      render();
      toast('저장했습니다. 이 브라우저에 보관됩니다.');
      return true;
    }
    state.saving = true;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (state.editKey) headers['X-Edit-Key'] = state.editKey;
      const res = await fetch('/api/data', { method: 'PUT', headers, body: JSON.stringify({ data: next, baseVersion: state.data.version, editor }) });
      const body = await res.json();
      if (res.status === 401) {
        const key = window.prompt('편집 비밀번호를 입력하세요.');
        if (key) {
          state.editKey = key;
          sessionStorage.setItem('pms.editKey', key);
          state.saving = false;
          return save(next, editor);
        }
        toast('비밀번호가 없어 저장하지 않았습니다.');
        return false;
      }
      if (res.status === 409) {
        state.data = body.current;
        render();
        toast(body.error);
        return false;
      }
      if (!res.ok) { toast(body.error || '저장하지 못했습니다.'); return false; }
      state.data = body;
      render();
      toast('저장했습니다. 접속 중인 모든 화면에 반영됩니다.');
      return true;
    } catch (e) {
      toast('서버에 연결하지 못해 저장하지 않았습니다.');
      return false;
    } finally {
      state.saving = false;
    }
  }

  // JSON 내보내기·불러오기 (파일로 주고받기, 백업)
  function exportJSON() {
    const out = clone(state.data);
    delete out._auth;
    const d = new Date();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
    a.download = `성과관리_데이터_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_v${out.version}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = '.json,application/json';
  importInput.hidden = true;
  document.body.appendChild(importInput);
  importInput.addEventListener('change', () => {
    const file = importInput.files[0];
    importInput.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let next;
      try {
        next = JSON.parse(reader.result);
        if (!Array.isArray(next.indices) || !next.meta) throw new Error('form');
      } catch (e) {
        toast('성과관리 데이터 파일이 아닙니다. 이 화면에서 내보낸 JSON 파일을 선택하세요.');
        return;
      }
      const msg = `"${file.name}" (v${next.version || '?'}, ${String(next.updatedAt || '').slice(0, 10)})의 내용으로 현재 데이터를 바꿉니다. 계속할까요?`;
      if (!window.confirm(msg)) return;
      const editor = localStorage.getItem('pms.editor') || window.prompt('입력자 이름을 입력하세요.') || '이름 없음';
      localStorage.setItem('pms.editor', editor);
      await save(next, editor + ' (파일 불러오기)');
    };
    reader.readAsText(file, 'utf-8');
  });

  // ---------- 이벤트 ----------
  app.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) { state.inlineEdit = null; state.view = b.dataset.view; localStorage.setItem('pms.view', state.view); render(); }
    if (b.dataset.color) { state.colorMode = b.dataset.color; localStorage.setItem('pms.colorMode', state.colorMode); render(); }
    if (b.dataset.act === 'print') window.print();
    if (b.dataset.act === 'csv') downloadCSV();
    if (b.dataset.act === 'export') exportJSON();
    if (b.dataset.act === 'import') importInput.click();
    if (b.dataset.act === 'history') openHistory();
    if (b.dataset.inlineEdit) {
      if (state.inlineEdit === b.dataset.inlineEdit) closeInline(b.dataset.inlineEdit);
      else openInline(b.dataset.inlineEdit);
    }
    if ('inlineCancel' in b.dataset) closeInline(state.inlineEdit);
    if (b.dataset.inlineSave) saveInline(b.dataset.inlineSave);
  });

  app.addEventListener('change', async (e) => {
    const id = e.target.dataset && e.target.dataset.issue;
    if (!id) return;
    const next = clone(state.data);
    const it = next.issues.find((i) => i.id === id);
    it.done = e.target.checked;
    const ok = await save(next, localStorage.getItem('pms.editor') || '이름 없음');
    if (!ok) render();
  });

  function downloadCSV() {
    const c = compute(state.data);
    const rows = [['지표', '세부지표', '단위', '가중치', '기준값', '1차 목표', '1차 실적', '1차 달성률', '2차 목표', '2차 현재값', '2차 진척률', '상태', '3차 목표', '비고']];
    c.indices.forEach((ix) => {
      ix.subs.forEach((s) => rows.push([ix.name, s.name, s.unit, s.weight, s.targets.base, s.targets.y1, s.y1.value ?? '', s.y1.rate ?? '',
        s.targets.y2, s.v2 === null ? '' : +s.v2.toFixed(2), s.r2 === null ? '' : +s.r2.toFixed(1), subStatus(s, true).text, s.targets.y3, compNote(s)]));
      rows.push([ix.name, '(지수)', '', 1, ix.base, ix.targets.y1, ix.y1.value, ix.y1.rate, ix.targets.y2, +ix.v2.toFixed(1), +ix.r2.toFixed(1), ix.missing ? '미입력 포함' : '', ix.targets.y3, '']);
    });
    const csv = '\uFEFF' + rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const d = new Date();
    a.download = `자율성과지표_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- 실적 입력 ----------
  const dlg = $('#editDialog');
  const FLAGS = ['', '부분 입력', '집계 중', '근거 확인', '계획 포함', '임시값'];

  function openEditor() {
    const d = state.data;
    const body = $('#editBody');
    let html = `<p class="sub-meta">값을 비워 두면 '미입력'으로 처리됩니다. 합계와 비율은 자동 계산됩니다.</p>
      <div class="edit-grid">
        <label class="field"><span>자료 기준일</span><input type="date" name="meta.asOf" value="${esc(d.meta.asOf)}"></label>
        <label class="field"><span>기준 분기 표기</span><input type="text" name="meta.asOfLabel" value="${esc(d.meta.asOfLabel)}"></label>
      </div>`;
    d.indices.forEach((ix, i) => {
      html += `<details ${i === 0 ? 'open' : ''}><summary>${esc(ix.no)} ${esc(ix.name)}</summary>`;
      ix.subs.forEach((s) => {
        html += `<div class="edit-sub" data-sub="${esc(s.id)}">
          <h3>${esc(s.name)} <small>2차 목표 ${fmtNum(s.targets.y2)}${esc(s.unit)} · ${s.y2.agg === 'ratio' ? 'B/A×100' : s.y2.agg === 'sum' ? '합계' : '단일값'}</small></h3>
          <div class="edit-grid">${s.y2.components.map((c, k) => `
            <label class="field"><span>${esc(c.name)}</span>
              <input type="number" step="any" inputmode="decimal" name="${esc(s.id)}.c${k}" value="${isNum(c.value) ? c.value : ''}"></label>`).join('')}
            <label class="field"><span>상태</span><select name="${esc(s.id)}.flag">
              ${FLAGS.map((f) => `<option value="${esc(f)}" ${s.y2.flag === f ? 'selected' : ''}>${f ? esc(f) : '확정'}</option>`).join('')}
            </select></label>
          </div>
          <label class="field"><span>비고 · 근거 문서</span><textarea name="${esc(s.id)}.note" rows="2">${esc(s.y2.note)}</textarea></label>
          <div class="calc" data-calc="${esc(s.id)}"></div>
        </div>`;
      });
      html += '</details>';
    });
    html += `<h3 class="section-title">주요 일정</h3><div class="edit-grid">${d.schedule.map((s) => `
      <label class="field"><span>${esc(s.title)}</span><input type="date" name="sched.${esc(s.id)}" value="${esc(s.date)}"></label>`).join('')}</div>`;
    body.innerHTML = html;
    $('#editorName').value = localStorage.getItem('pms.editor') || '';
    updateCalcs();
    dlg.showModal();
  }

  function readForm() {
    const next = clone(state.data);
    const f = $('#editForm');
    const get = (n) => f.elements.namedItem(n);
    next.meta.asOf = get('meta.asOf').value || next.meta.asOf;
    next.meta.asOfLabel = get('meta.asOfLabel').value.trim() || next.meta.asOfLabel;
    next.indices.forEach((ix) => ix.subs.forEach((s) => {
      s.y2.components.forEach((c, k) => {
        const raw = get(s.id + '.c' + k).value.trim();
        c.value = raw === '' ? null : Number(raw);
      });
      s.y2.flag = get(s.id + '.flag').value;
      s.y2.note = get(s.id + '.note').value.trim();
    }));
    next.schedule.forEach((s) => { s.date = get('sched.' + s.id).value || ''; });
    return next;
  }

  function updateCalcs() {
    const next = readForm();
    next.indices.forEach((ix) => ix.subs.forEach((s) => {
      const v = subValueY2(s);
      const el = document.querySelector(`[data-calc="${s.id}"]`);
      if (el) el.innerHTML = v === null ? '현재값 <b>미입력</b>' :
        `현재값 <b>${fmtNum(+v.toFixed(2))}${esc(s.unit)}</b>, 진척률 <b style="color:${colorFor((v / s.targets.y2) * 100)}">${fmtPct((v / s.targets.y2) * 100)}</b>`;
    }));
  }

  $('#editBody').addEventListener('input', updateCalcs);
  $('#editBtn').addEventListener('click', () => { if (state.data) openEditor(); });
  $('#editClose').addEventListener('click', () => dlg.close());
  $('#editCancel').addEventListener('click', () => dlg.close());
  $('#editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editor = $('#editorName').value.trim();
    if (!editor) { $('#editorName').focus(); return; }
    localStorage.setItem('pms.editor', editor);
    const btn = $('#editSave');
    btn.disabled = true;
    btn.textContent = '저장 중';
    const ok = await save(readForm(), editor);
    btn.disabled = false;
    btn.textContent = '저장';
    if (ok) dlg.close();
  });


  // ---------- 변경 이력·복원 (서버 모드) ----------
  const hdlg = $('#historyDialog');
  async function openHistory() {
    const list = $('#historyBody');
    list.innerHTML = '<p class="sub-meta">불러오는 중입니다.</p>';
    hdlg.showModal();
    try {
      const res = await fetch('/api/history', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status === 404 ? '이 환경에서는 변경 이력을 지원하지 않습니다.' : '이력을 불러오지 못했습니다.');
      const j = await res.json();
      const when = (iso) => String(iso || '').replace('T', ' ').slice(0, 16);
      const rows = [`<li class="hist cur"><span><b>v${esc(j.current.version)}</b> 현재 버전</span><span class="sub-meta">${esc(when(j.current.updatedAt))} · ${esc(j.current.updatedBy)}</span></li>`]
        .concat(j.history.map((h) => `<li class="hist"><span><b>v${esc(h.version)}</b></span><span class="sub-meta">${esc(when(h.updatedAt))} · ${esc(h.updatedBy)}</span>
          <button type="button" class="btn-line" data-restore="${esc(h.version)}">이 버전으로 복원</button></li>`));
      list.innerHTML = `<p class="sub-meta">저장할 때마다 직전 버전이 보관됩니다(최근 100개). 복원해도 현재 버전은 이력에 남습니다.</p><ul class="hist-list">${rows.join('')}</ul>`;
    } catch (e) {
      list.innerHTML = `<p class="sub-meta">${esc(e.message)}</p>`;
    }
  }
  hdlg.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-restore]');
    if (!b) return;
    const v = b.dataset.restore;
    if (!window.confirm(`v${v} 내용으로 되돌립니다. 계속할까요?`)) return;
    const editor = localStorage.getItem('pms.editor') || window.prompt('이름을 입력하세요.') || '이름 없음';
    localStorage.setItem('pms.editor', editor);
    b.disabled = true;
    try {
      const res = await fetch('/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: Number(v), editor }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || '복원하지 못했습니다.');
      state.data = j;
      render();
      hdlg.close();
      toast(`v${v} 내용으로 복원했습니다.`);
    } catch (err) {
      toast(err.message);
      b.disabled = false;
    }
  });
  $('#historyClose').addEventListener('click', () => hdlg.close());

  // 요약 보고서(report.js)에서 쓰는 공용 함수
  window.PMS = { univName, state, compute, subStatus, compNote, esc, isNum, fmtNum, fmtPct, parseDate, fmtDate, toast };

  load();
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
