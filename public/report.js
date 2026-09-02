'use strict';

/**
 * 전체 문서 내보내기 — 요약 + QA 검증 분석서 + 테스트케이스를 한 문서로 만든다.
 *
 * PDF 는 브라우저 인쇄(PDF로 저장)를 쓴다.
 *   · 서버에서 PDF 를 직접 만들려면 한글 폰트 파일(수 MB)을 임베딩해야 하고,
 *     라이브러리 기본 폰트로는 한글이 전부 깨진다.
 *   · 인쇄 경로는 시스템 폰트를 쓰므로 깨짐이 없고, 글자가 이미지가 아니라
 *     선택·검색 가능한 상태로 남는다.
 *
 * 같은 HTML 을 파일로도 내려준다(첨부·공유용). 두 경로가 한 생성기를 공유하므로
 * 내용이 어긋나지 않는다.
 */

/* ------------------------------------------------------------- 인쇄용 스타일 */

const REPORT_CSS = `
  @page { size: A4; margin: 15mm 13mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px 32px; color: #16181d; background: #fff;
    font: 12px/1.65 -apple-system, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1 { font-size: 21px; margin: 0 0 6px; letter-spacing: -0.3px; }
  h2 {
    font-size: 15px; margin: 26px 0 10px; padding-bottom: 6px;
    border-bottom: 2px solid #2f3542; break-after: avoid;
  }
  h3 { font-size: 13px; margin: 18px 0 8px; break-after: avoid; }
  h4 {
    font-size: 11px; margin: 14px 0 6px; color: #5b6471;
    text-transform: uppercase; letter-spacing: 0.04em; break-after: avoid;
  }
  p { margin: 0 0 8px; }
  ul, ol { margin: 6px 0 10px; padding-left: 20px; }
  li { margin-bottom: 3px; break-inside: avoid; }
  a { color: #2b4fd4; word-break: break-all; }
  code, .mono {
    font: 11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
    background: #f1f3f6; padding: 1px 5px; border-radius: 4px;
  }

  .cover { padding-bottom: 14px; border-bottom: 3px solid #16181d; margin-bottom: 6px; }
  .cover .meta { color: #5b6471; font-size: 11.5px; margin: 0; }
  .cover .title-sub { color: #5b6471; font-size: 12.5px; margin: 2px 0 10px; }

  .stats { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
  .stat {
    padding: 4px 10px; border: 1px solid #d6dae1; border-radius: 999px;
    font-size: 11px; background: #f8f9fb;
  }
  .stat b { font-weight: 650; }

  table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 11px; }
  thead { display: table-header-group; }          /* 페이지가 넘어가도 머리행 반복 */
  th, td { border: 1px solid #d6dae1; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #eef1f5; font-weight: 650; font-size: 10.5px; }
  tr { break-inside: avoid; }
  td ul, td ol { margin: 0; padding-left: 16px; }

  .tag {
    display: inline-block; padding: 1px 7px; margin-right: 4px; border-radius: 999px;
    border: 1px solid #d6dae1; background: #f4f6f9; font-size: 10px; color: #454d59;
  }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 4px; font-size: 10px; font-weight: 650; }
  .badge-pass { background: #e6f6ee; color: #1c7a4e; border: 1px solid #b6e0cb; }
  .badge-fail { background: #fdeaec; color: #a52633; border: 1px solid #f3c2c8; }
  .badge-edge { background: #fdf3e0; color: #8a5a10; border: 1px solid #f0d9ac; }
  .badge-high { background: #fdeaec; color: #a52633; border: 1px solid #f3c2c8; }
  .badge-med  { background: #fdf3e0; color: #8a5a10; border: 1px solid #f0d9ac; }
  .badge-low  { background: #f1f3f6; color: #5b6471; border: 1px solid #d6dae1; }

  .box { padding: 10px 12px; border: 1px solid #d6dae1; border-radius: 6px; margin: 8px 0 12px; background: #fafbfc; }
  .box-goal { background: #f2faf6; border-color: #b6e0cb; }
  .box-nongoal { background: #fdf5f6; border-color: #f3c2c8; }
  .box-risk { background: #fdfaf3; border-color: #f0d9ac; }
  .note { color: #5b6471; font-size: 11px; margin: 4px 0 0; }

  pre.flow {
    margin: 0 0 8px; padding: 10px 12px; background: #f6f7f9; border: 1px solid #d6dae1;
    border-radius: 6px; font: 10.5px/1.55 ui-monospace, Consolas, monospace;
    white-space: pre-wrap; break-inside: avoid;
  }

  .tc { border: 1px solid #d6dae1; border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; break-inside: avoid; }
  .tc-head { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; margin-bottom: 6px; }
  .tc-id { font: 11px/1.5 ui-monospace, Consolas, monospace; font-weight: 650; }
  .tc-title { font-weight: 600; font-size: 12px; }
  .tc-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 8px; }
  .tc-src { margin-top: 8px; padding-top: 6px; border-top: 1px dashed #d6dae1; color: #5b6471; font-size: 10.5px; }

  .page-break { break-before: page; }
  .empty { color: #8b929c; }

  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
  }
`;

/* --------------------------------------------------------------- 조립 헬퍼 */

/**
 * 문서 제목 추정 — 기획서의 첫 제목(# ...) → 업로드 파일명 → 기본값 순.
 * 표지와 저장 파일명에 함께 쓴다.
 */
function reportProjectName() {
  const spec = ($('#specText') && $('#specText').value) || '';
  const heading = spec.match(/^#{1,2}\s+(.{2,60})$/m);
  if (heading) return heading[1].trim();
  if (state.sourceName) return state.sourceName.replace(/\.[^.]+$/, '');
  return '기획서';
}

const TYPE_BADGE = { Pass: 'pass', Fail: 'fail', 'Edge Case': 'edge' };

function reportList(items, ordered) {
  if (!Array.isArray(items) || !items.length) return '<p class="empty">-</p>';
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</${tag}>`;
}

/** 문서 요약 파트 */
function reportSummarySection(s, ai) {
  const ov = s.overview || {};
  const stats = [
    ['영역', ov.areas], ['요구사항', ov.requirements], ['조건 분기', ov.conditional],
    ['수치 기준 보유', ov.withNumericRule], ['언어', (ov.languages || []).join('/')],
  ].map(([k, v]) => `<span class="stat">${esc(k)} <b>${esc(v)}</b></span>`).join('');

  const coverage = s.coverage
    ? `<p class="note">TC ${s.coverage.testCases}건 · 요구사항당 평균 ${s.coverage.perRequirement}건 · ${
      s.coverage.uncovered.length ? `TC 미생성 ${s.coverage.uncovered.length}건` : '미커버 없음'}</p>`
    : '';

  const aiPart = ai ? `
    <h3>AI 요약 (Claude)</h3>
    <div class="box"><p>${esc(ai.headline)}</p>
      ${(ai.scope || []).length ? `<h4>다루는 범위</h4>${reportList(ai.scope)}` : ''}
      ${(ai.criticalFlows || []).length ? `<h4>핵심 흐름</h4><ul>${ai.criticalFlows
        .map((f) => `<li><b>${esc(f.name)}</b> — ${esc(f.why)}<br /><span class="note">주의: ${esc(f.watchOut)}</span></li>`)
        .join('')}</ul>` : ''}
      ${(ai.openQuestions || []).length ? `<h4>기획 확인 질문</h4>${reportList(ai.openQuestions)}` : ''}
    </div>` : '';

  const keyPoints = (s.keyPoints || []).length
    ? `<table>
        <thead><tr><th style="width:74px">요구사항</th><th style="width:104px">영역</th><th>내용</th><th style="width:120px">수치 기준</th></tr></thead>
        <tbody>${s.keyPoints.map((k) => `<tr>
          <td class="mono">${esc(k.requirementId)}</td>
          <td>${esc(k.area)}</td>
          <td>${esc(k.text)}${k.condition ? `<br /><span class="note">조건 — ${esc(k.condition)}</span>` : ''}</td>
          <td>${(k.constraints || []).map((c) => `<span class="tag">${esc(c)}</span>`).join('') || '-'}</td>
        </tr>`).join('')}</tbody>
      </table>`
    : '<p class="empty">추출된 요구사항이 없습니다.</p>';

  const numeric = (s.numericRules || []).length
    ? `<table>
        <thead><tr><th style="width:70px">구분</th><th style="width:120px">기준</th><th style="width:130px">영역</th><th>근거 문구</th></tr></thead>
        <tbody>${s.numericRules.map((n) => `<tr>
          <td><span class="tag">${esc(n.kind)}</span></td>
          <td class="mono">${esc(n.criterion)}</td>
          <td>${esc(n.area)}</td>
          <td>${esc(n.source || n.text)}</td>
        </tr>`).join('')}</tbody>
      </table>`
    : '<p class="empty">수치 기준이 발견되지 않았습니다.</p>';

  const risks = (s.risks || []).length
    ? s.risks.map((r) => `<div class="box box-risk">
        <p><span class="tag">${esc(r.type)}</span><b>${esc(r.message)}</b> (${r.count}건)</p>
        <p>질문: ${esc(r.question)}</p>
        <p class="note">${esc(r.items.map((i) => `${i.requirementId} (L${i.line})`).join(', '))}</p>
      </div>`).join('')
    : '<p class="empty">모호 표현·누락 항목이 발견되지 않았습니다.</p>';

  // 요청 확인 항목 — 인쇄해서 기획·개발과 함께 보는 용도라 표로 낸다
  const q = s.questions;
  const questions = q && q.groups.length
    ? `<p class="note">테스트 착수 전 확인 ${q.high}건 포함 총 ${q.total}건 · 화면·연동 비중 ${q.frontendRatio}%</p>
       ${q.groups.map((g) => `
         <h4>${esc(g.label)} <span class="note">${esc(g.hint)}</span></h4>
         <table>
           <thead><tr><th style="width:46px">우선</th><th style="width:44%">확인 요청</th><th>왜 필요한가</th><th style="width:120px">근거</th></tr></thead>
           <tbody>${g.items.map((item) => `<tr>
             <td>${esc(item.priority)}</td>
             <td>${esc(item.question)}</td>
             <td class="note">${esc(item.why)}</td>
             <td class="note">${item.basis.kind === 'requirement'
    ? `${esc(item.basis.id)}${item.basis.line != null ? ` (L${item.basis.line})` : ''}`
    : '문서에 언급 없음'}</td>
           </tr>`).join('')}</tbody>
         </table>`).join('')}`
    : '<p class="empty">문서에서 유발된 확인 항목이 없습니다.</p>';

  const byArea = (s.byArea || []).length
    ? `<table>
        <thead><tr><th style="width:150px">영역</th><th style="width:52px">건수</th><th style="width:180px">주요 관점</th><th>대표 문장</th></tr></thead>
        <tbody>${s.byArea.map((a) => `<tr>
          <td>${esc(a.area)}</td>
          <td>${a.requirements}</td>
          <td>${(a.focus || []).map((f) => `<span class="tag">${esc(f)}</span>`).join('')}</td>
          <td>${reportList(a.highlights)}</td>
        </tr>`).join('')}</tbody>
      </table>`
    : '';

  return `
    <h2>문서 요약</h2>
    <p>${esc(s.headline)}</p>
    <div class="stats">${stats}</div>
    ${coverage}
    ${aiPart}
    <h3>핵심 요구사항</h3>${keyPoints}
    <h3>수치 기준 <span class="note">검증 시 그대로 사용</span></h3>${numeric}
    <h3>확인 필요 <span class="note">문서의 모호·누락</span></h3>${risks}
    <h3>요청 확인 항목 <span class="note">기획·개발 확인 요청 — 화면·연동 중심</span></h3>${questions}
    ${byArea ? `<h3>영역별 요점</h3>${byArea}` : ''}
  `;
}

/** QA 검증 분석서 6개 고정 섹션 */
function reportQaSection(qa, ai) {
  if (!qa) return '';

  const checkpoints = (qa.checkpoints || []).map((g) => `
    <h4>${esc(g.title)}</h4>
    <table>
      <thead><tr><th style="width:28%">확인할 것</th><th style="width:30%">왜</th><th>어떻게</th></tr></thead>
      <tbody>${g.items.map((i) => `<tr>
        <td><b>${esc(i.what)}</b></td><td>${esc(i.why)}</td><td>${esc(i.how)}</td>
      </tr>`).join('')}</tbody>
    </table>`).join('');

  const todos = (qa.todos || []).length
    ? `<h4>검증 착수 전 준비 (해야 할 일)</h4>
       <ul>${qa.todos.map((t) => `<li>☐ ${esc(t.text)} <span class="note">— ${esc(t.reason)}</span></li>`).join('')}</ul>`
    : '';

  const aiFocus = ai && (ai.testFocus || []).length
    ? `<h4>AI 보강 — 반드시 수행할 테스트</h4>${reportList(ai.testFocus)}` : '';
  const aiRisks = ai && (ai.riskNotes || []).length
    ? `<h4>AI 보강 — 유의사항</h4>${reportList(ai.riskNotes)}` : '';

  const urls = (qa.urls || []).length
    ? `<table>
        <thead><tr><th style="width:34px">#</th><th style="width:130px">화면/기능</th><th>URL 경로</th><th style="width:120px">접근 권한</th><th style="width:200px">핵심 검증 시나리오</th></tr></thead>
        <tbody>${qa.urls.map((u, i) => `<tr>
          <td>${i + 1}</td>
          <td>${esc(u.screen)}</td>
          <td class="mono">${u.method ? `${esc(u.method)} ` : ''}${esc(u.path)}</td>
          <td>${esc(u.access)}</td>
          <td>${esc(u.scenario)}</td>
        </tr>`).join('')}</tbody>
      </table>
      <p class="note">상대경로는 검증 환경(스테이징) base URL 을 붙여 사용하세요.</p>`
    : '<p class="empty">문서에서 URL·경로를 찾지 못했습니다 — 검증 대상 주소를 기획에 확인해야 합니다.</p>';

  const flow = qa.flow || {};
  const flowPart = flow.mermaid
    ? `<pre class="flow">${esc(flow.mermaid)}</pre><p class="note">${esc(flow.caption || '')}</p>
       <p class="note">위 소스를 Notion·GitHub 에 붙여넣으면 다이어그램으로 표시됩니다.</p>`
    : '<p class="empty">영역을 인식하지 못해 흐름도를 만들지 못했습니다.</p>';

  const figma = qa.figma
    ? `<ul>${qa.figma.map((u) => `<li><a href="${esc(u)}">${esc(u)}</a></li>`).join('')}</ul>`
    : '<p><b>Figma 링크 없음</b></p>';

  const scopeList = (items, cls) => `<div class="box ${cls}"><ul>${items.map((x) => `
    <li>${esc(x.text)}${x.source ? ` <span class="tag">${esc(x.source)}</span>` : ''}${
    x.line ? ` <span class="mono">L${x.line}</span>` : ''}</li>`).join('')}</ul></div>`;

  const aiScope = (items, label) => (items && items.length
    ? `<h4>AI 보강 — ${esc(label)}</h4>${reportList(items)}` : '');

  return `
    <div class="page-break"></div>
    <h2>QA/QC 검증 분석서</h2>

    <h3>1. QC·QA 검증 진행 시 참고해야 할 점</h3>
    ${checkpoints}${todos}${aiFocus}${aiRisks}

    <h3>2. 검증 시 진행해야 할 URL</h3>
    ${urls}

    <h3>3. 프로젝트 동작 흐름</h3>
    ${flowPart}

    <h3>4. Figma 링크</h3>
    ${figma}

    <h3>5. 목표가 아닌 것 (Out of Scope)</h3>
    ${scopeList(qa.nonGoals || [], 'box-nongoal')}
    ${aiScope(ai && ai.nonGoals, '범위 제외')}
    <p class="note">범위를 명확히 해두면 불필요한 결함 리포트를 줄일 수 있습니다.</p>

    <h3>6. 목표 (In Scope)</h3>
    ${scopeList(qa.goals || [], 'box-goal')}
    ${aiScope(ai && ai.goals, '목표')}
    <div class="box box-goal"><p>${esc(qa.guarantee || '')}</p></div>
  `;
}

/** 테스트케이스 전문 */
function reportTestCaseSection(testCases) {
  if (!testCases.length) return '';

  const byType = testCases.reduce((acc, tc) => {
    acc[tc.type] = (acc[tc.type] || 0) + 1;
    return acc;
  }, {});
  const byPriority = testCases.reduce((acc, tc) => {
    acc[tc.priority] = (acc[tc.priority] || 0) + 1;
    return acc;
  }, {});

  const stats = [
    ['총 TC', testCases.length], ['Pass', byType.Pass || 0], ['Fail', byType.Fail || 0],
    ['Edge', byType['Edge Case'] || 0], ['High', byPriority.High || 0],
  ].map(([k, v]) => `<span class="stat">${esc(k)} <b>${v}</b></span>`).join('');

  const cards = testCases.map((tc) => {
    const req = tc.requirement || {};
    return `<div class="tc">
      <div class="tc-head">
        <span class="tc-id">${esc(tc.tc_id)}</span>
        <span class="badge badge-${TYPE_BADGE[tc.type] || 'low'}">${esc(tc.type)}</span>
        <span class="badge badge-${String(tc.priority).toLowerCase()}">${esc(tc.priority)}</span>
        <span class="tag">${esc(tc.area)}</span>
        ${tc.origin === 'ai' ? '<span class="tag">AI 보강</span>' : ''}
      </div>
      <p class="tc-title">${esc(tc.title || tc.scenario || '')}</p>
      <p class="note">${esc(tc.objective || '')}</p>
      <div class="tc-grid">
        <div><h4>사전 조건</h4>${reportList(tc.precondition)}</div>
        <div><h4>수행 단계</h4>${reportList(tc.steps, true)}</div>
        <div><h4>기대 결과</h4>${reportList(tc.expected)}</div>
      </div>
      <p class="tc-src">근거 — <span class="mono">${esc(req.id || tc.requirement_id || '-')}</span>${
      req.line != null ? ` <span class="mono">L${req.line}</span>` : ''} ${esc(req.text || tc.source_text || '')}</p>
    </div>`;
  }).join('');

  return `
    <div class="page-break"></div>
    <h2>테스트케이스 (${testCases.length}건)</h2>
    <div class="stats">${stats}</div>
    ${cards}
  `;
}

/**
 * 전체 문서 HTML 을 만든다. 인쇄와 파일 저장이 같은 결과를 쓰도록 한 곳에서 생성한다.
 * @param {{includeTestCases?: boolean}} opts
 */
function buildReportHtml(opts = {}) {
  const s = state.specSummary;
  if (!s) return null;

  const ai = state.aiSummary;
  const includeTc = opts.includeTestCases !== false;
  const testCases = includeTc ? (state.testCases || []) : [];
  const source = state.sourceName || '붙여넣은 기획서 텍스트';
  const today = new Date().toISOString().slice(0, 10);
  const project = reportProjectName();
  const title = `[${project}] QA 검증 문서`;

  const body = `
    <div class="cover">
      <h1>[${esc(project)}] QA 검증 문서</h1>
      <p class="title-sub">기획서 요약 · QA/QC 검증 분석서${testCases.length ? ' · 테스트케이스' : ''}</p>
      <p class="meta">분석 출처: ${esc(source)}</p>
      <p class="meta">작성 기준일: ${esc(today)} · 생성: SpecToTC</p>
    </div>
    ${reportSummarySection(s, ai)}
    ${reportQaSection(s.qaPlan, ai)}
    ${reportTestCaseSection(testCases)}
  `;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="robots" content="noindex, nofollow" />
<title>${esc(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** 인쇄 대화상자를 띄운다 (사용자가 "PDF로 저장" 선택) */
function exportReportPdf(opts) {
  const html = buildReportHtml(opts);
  if (!html) {
    setStatus('먼저 기획서를 요약하거나 TC 를 생성해 주세요.', 'error');
    return;
  }

  // 팝업 차단을 피하기 위해 새 창이 아니라 숨긴 iframe 에서 인쇄한다.
  const old = document.querySelector('#reportFrame');
  if (old) old.remove();

  const frame = document.createElement('iframe');
  frame.id = 'reportFrame';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(frame);

  frame.onload = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setStatus('인쇄 창에서 대상을 "PDF로 저장"으로 선택하면 PDF 파일이 만들어집니다.', 'ok');
    } catch (err) {
      setStatus(`인쇄를 열지 못했습니다: ${err.message}`, 'error');
    }
  };
  frame.srcdoc = html;
}

/** 같은 내용을 단일 HTML 파일로 저장 (첨부·공유용) */
function downloadReportHtml(opts) {
  const html = buildReportHtml(opts);
  if (!html) {
    setStatus('먼저 기획서를 요약하거나 TC 를 생성해 주세요.', 'error');
    return;
  }
  const base = reportProjectName().replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  triggerDownload(blob, `${base}-검증문서-${new Date().toISOString().slice(0, 10)}.html`);
  setStatus('검증 문서를 HTML 파일로 저장했습니다. 브라우저에서 열어 인쇄하면 PDF 로도 만들 수 있습니다.', 'ok');
}
