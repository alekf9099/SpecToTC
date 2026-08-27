'use strict';

/**
 * 문서 요약 뷰 — dashboard.js 와 전역 스코프를 공유한다 (state / $ / esc / api / setStatus).
 * index.html 에서 dashboard.js 보다 먼저 로드된다 (여기서는 함수만 선언한다).
 */

function renderSpecSummary() {
  const box = $('#summaryBody');
  const s = state.specSummary;

  if (!s) {
    box.innerHTML = '<div class="summary-empty-box">파일을 올리거나 좌측에서 생성하면 요약과 QA 검증 분석서가 표시됩니다.</div>';
    return;
  }

  const ov = s.overview || {};
  const ai = state.aiSummary;

  const card = (title, body, cls) =>
    `<section class="sum-card${cls ? ` ${cls}` : ''}"><h3>${title}</h3>${body}</section>`;
  const li = (items) => (items || []).map((x) => `<li>${esc(x)}</li>`).join('');
  const tags = (items, cls) => (items || []).map((x) => `<span class="tag${cls ? ` ${cls}` : ''}">${esc(x)}</span>`).join('');

  /* ------------------------------------------------------------- 개요 */
  const stats = [
    ['영역', ov.areas], ['요구사항', ov.requirements], ['조건 분기', ov.conditional],
    ['수치 기준 보유', ov.withNumericRule], ['언어', (ov.languages || []).join('/')],
  ].map(([k, v]) => `<span class="stat">${k} <b>${esc(v)}</b></span>`).join('');

  const coverage = s.coverage
    ? `<p class="sum-note">TC ${s.coverage.testCases}건 · 요구사항당 평균 ${s.coverage.perRequirement}건 · ${
      s.coverage.uncovered.length ? `TC 미생성 ${s.coverage.uncovered.length}건` : '미커버 없음'}</p>`
    : '';

  const overviewCard = card('개요', `
    <p class="sum-headline">${esc(s.headline)}</p>
    <div class="sum-stats">${stats}</div>
    ${(ov.topCategories || []).length
      ? `<div class="sum-tags">${(ov.topCategories).map((c) => `<span class="tag">${esc(c.label)} ${c.count}</span>`).join('')}</div>`
      : ''}
    ${coverage}
  `);

  /* ---------------------------------------------------------- AI 요약 */
  const aiCard = ai ? card('AI 요약 <span class="pill pill-ai">Claude</span>', `
    <p class="sum-headline">${esc(ai.headline)}</p>
    ${(ai.scope || []).length ? `<h4>다루는 범위</h4><ul class="sum-list">${li(ai.scope)}</ul>` : ''}
    ${(ai.criticalFlows || []).length ? `<h4>핵심 흐름</h4>${ai.criticalFlows.map((f) => `
      <div class="sum-flow"><b>${esc(f.name)}</b><p>${esc(f.why)}</p>
        <p class="sum-watch">주의 — ${esc(f.watchOut)}</p></div>`).join('')}` : ''}
    ${(ai.openQuestions || []).length ? `<h4>기획 확인 질문</h4><ul class="sum-list">${li(ai.openQuestions)}</ul>` : ''}
    ${(ai.riskNotes || []).length ? `<h4>QA 유의사항</h4><ul class="sum-list">${li(ai.riskNotes)}</ul>` : ''}
  `, 'sum-ai') : '';

  /* ------------------------------------------------------ 핵심 요구사항 */
  const keyCard = card('핵심 요구사항', (s.keyPoints || []).length
    ? `<ol class="sum-key">${s.keyPoints.map((k) => `
        <li>
          <div class="sum-key-head">
            <span class="mono">${esc(k.requirementId)}</span>
            <span class="tag">${esc(k.area)}</span>
            ${tags(k.constraints, 'tag-num')}
          </div>
          <p>${esc(k.text)}</p>
          ${k.condition ? `<p class="sum-note">조건 — ${esc(k.condition)}</p>` : ''}
        </li>`).join('')}</ol>`
    : '<p class="detail-empty">추출된 요구사항이 없습니다.</p>');

  /* ---------------------------------------------------------- 수치 기준 */
  const numCard = card('수치 기준 <span class="sum-sub">검증 시 그대로 사용</span>', (s.numericRules || []).length
    ? `<div class="sum-table-wrap"><table class="sum-table">
        <thead><tr><th>구분</th><th>기준</th><th>영역</th><th>근거 문구</th></tr></thead>
        <tbody>${s.numericRules.map((n) => `<tr>
          <td><span class="tag">${esc(n.kind)}</span></td>
          <td class="mono">${esc(n.criterion)}</td>
          <td>${esc(n.area)}</td>
          <td class="sum-src">${esc(n.source || n.text)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : '<p class="detail-empty">수치 기준이 발견되지 않았습니다.</p>');

  /* ---------------------------------------------------------- 확인 필요 */
  const riskCard = card('확인 필요 <span class="sum-sub">기획 문의 목록</span>', (s.risks || []).length
    ? `<ul class="sum-risks">${s.risks.map((r) => `
        <li>
          <div class="sum-risk-head">
            <span class="tag tag-warn">${esc(r.type)}</span>
            <span class="sum-count">${r.count}건</span>
            <b>${esc(r.message)}</b>
          </div>
          <p class="sum-q">${esc(r.question)}</p>
          <p class="sum-note">${esc(r.items.map((i) => `${i.requirementId} (L${i.line})`).join(', '))}</p>
        </li>`).join('')}</ul>`
    : '<p class="detail-empty">모호 표현·누락 항목이 발견되지 않았습니다.</p>');

  /* -------------------------------------------------------- 영역별 요점 */
  const areaCard = card('영역별 요점', (s.byArea || []).map((a) => `
    <div class="sum-area">
      <div class="sum-area-head">
        <b>${esc(a.area)}</b><span class="sum-count">${a.requirements}건</span>${tags(a.focus)}
      </div>
      <ul class="sum-list">${li(a.highlights)}</ul>
    </div>`).join(''));

  // 체크박스 DOM 이 아니라 서버 상태를 본다 — health 응답 전에도 잘못 활성되지 않게
  const aiBlocked = aiBlockReason();
  const tcCount = (state.testCases || []).length;
  const actions = `<div class="sum-actions">
      <button id="btnExportPdf" class="btn btn-sm btn-primary">전체 문서 PDF 내보내기</button>
      <button id="btnExportHtml" class="btn btn-sm">HTML 파일 저장</button>
      <button id="btnAiSummary" class="btn btn-sm"${aiBlocked ? ` disabled title="${esc(aiBlocked)}"` : ''}>Claude 서술형 요약</button>
      <button id="btnCopySummary" class="btn btn-sm btn-ghost">요약 마크다운 복사</button>
    </div>
    <p class="sum-note export-note">내보내는 문서: 문서 요약 · QA 검증 분석서${
      tcCount ? ` · 테스트케이스 ${tcCount}건` : ' (테스트케이스는 좌측에서 생성하면 함께 포함됩니다)'}</p>`;

  // 사내 표준 6개 섹션 검증 분석서를 요약 아래에 붙인다.
  const qaPlan = renderQaPlan(s.qaPlan, ai);

  box.innerHTML = actions + overviewCard + aiCard + keyCard + numCard + riskCard + areaCard + qaPlan;
  $('#btnAiSummary').addEventListener('click', requestAiSummary);
  $('#btnCopySummary').addEventListener('click', copySummaryText);
  $('#btnExportPdf').addEventListener('click', () => exportReportPdf());
  $('#btnExportHtml').addEventListener('click', () => downloadReportHtml());
  if ($('#btnCopyQaPlan')) $('#btnCopyQaPlan').addEventListener('click', copyQaPlan);
  if ($('#btnCopyFlow')) $('#btnCopyFlow').addEventListener('click', copyFlow);
}

/** 요약을 마크다운으로 변환 (회의록·티켓 붙여넣기용) */
function summaryToMarkdown() {
  const s = state.specSummary;
  if (!s) return '';

  const out = ['# 기획서 요약', '', s.headline, ''];

  if (state.aiSummary) {
    out.push('## AI 요약', state.aiSummary.headline, '');
    if ((state.aiSummary.openQuestions || []).length) {
      out.push('### 기획 확인 질문', ...state.aiSummary.openQuestions.map((q) => `- ${q}`), '');
    }
  }

  out.push('## 핵심 요구사항');
  (s.keyPoints || []).forEach((k) => {
    const nums = (k.constraints || []).length ? ` (${k.constraints.join(', ')})` : '';
    out.push(`- [${k.area}] ${k.text}${nums}`);
  });

  out.push('', '## 수치 기준');
  (s.numericRules || []).forEach((n) => out.push(`- ${n.kind} ${n.criterion} — ${n.area}`));

  out.push('', '## 확인 필요');
  (s.risks || []).forEach((r) => out.push(`- [${r.type}] ${r.message} (${r.count}건) → ${r.question}`));

  return out.join('\n');
}

async function copySummaryText() {
  try {
    await navigator.clipboard.writeText(summaryToMarkdown());
    setStatus('요약을 마크다운으로 복사했습니다.', 'ok');
  } catch (err) {
    setStatus(`복사 실패: ${err.message}`, 'error');
  }
}

async function requestAiSummary() {
  const blocked = aiBlockReason();
  if (blocked) {
    setStatus(`Claude 서술형 요약을 쓸 수 없습니다 — ${blocked}
규칙 엔진 요약은 위에 이미 표시돼 있습니다.`, 'error');
    return;
  }

  const specText = $('#specText').value;
  if (!specText.trim()) {
    setStatus('기획서 텍스트를 입력하세요.', 'error');
    return;
  }

  const btn = $('#btnAiSummary');
  btn.disabled = true;
  btn.textContent = 'Claude 요약 생성 중…';

  try {
    const data = await api('/api/summarize', { specText, useAI: true });
    state.specSummary = data.summary;
    if (data.ai && data.ai.summary) {
      state.aiSummary = data.ai.summary;
      setStatus(`AI 요약 완료 (${data.ai.model})`, 'ok');
    } else {
      setStatus(`AI 요약 사용 불가: ${(data.ai && data.ai.error) || '알 수 없는 오류'}`, 'error');
    }
    renderSpecSummary();
  } catch (err) {
    setStatus(`AI 요약 실패: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Claude 서술형 요약';
  }
}

/**
 * 요약 탭에 올린 파일을 요약한다 (TC 생성 없이 요약만).
 * 좌측 텍스트 영역도 함께 채워 두어 이후 TC 생성으로 이어갈 수 있게 한다.
 */
async function summarizeOnly(specText) {
  setStatus('요약 중…');
  try {
    const data = await api('/api/summarize', { specText, useAI: false });
    state.specSummary = data.summary;
    state.aiSummary = null;
    renderSpecSummary();
    setView('summary');

    const qa = data.summary.qaPlan || {};
    setStatus([
      `요약 완료 — ${data.summary.headline}`,
      `검증 분석서: URL ${(qa.urls || []).length}건 · 준비 항목 ${(qa.todos || []).length}건 · 비목표 ${(qa.nonGoals || []).length}건`,
      '좌측 [테스트케이스 생성] 을 누르면 같은 문서로 TC 까지 만듭니다.',
    ].join('\n'), 'ok');
  } catch (err) {
    setStatus(`요약 실패: ${err.message}`, 'error');
  }
}

function setView(view) {
  state.view = view;
  $$('.view-switch .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
  $('#tcView').hidden = view !== 'tc';
  $('.filters').hidden = view !== 'tc';
  $('#summaryView').hidden = view !== 'summary';
}
