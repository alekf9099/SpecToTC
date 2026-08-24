'use strict';

/**
 * QA 검증 분석서 렌더러 — 사내 표준 6개 고정 섹션.
 * dashboard.js / summary-view.js 와 전역 스코프를 공유한다.
 */

const QA_SECTIONS = [
  '1. QC·QA 검증 진행 시 참고해야 할 점',
  '2. 검증 시 진행해야 할 URL',
  '3. 프로젝트 동작 흐름',
  '4. Figma 링크',
  '5. 목표가 아닌 것 (Out of Scope)',
  '6. 목표 (In Scope)',
];

function renderQaPlan(qa, ai) {
  if (!qa) return '';

  const card = (title, body) => `<section class="sum-card qa-card"><h3>${title}</h3>${body}</section>`;
  const empty = (msg) => `<p class="detail-empty">${esc(msg)}</p>`;

  /* ---------------------------------------------------- 1. 참고해야 할 점 */
  const aiFocus = ai && (ai.testFocus || []).length
    ? `<h4>AI 보강 — 반드시 수행할 테스트</h4><ul class="sum-list">${
      ai.testFocus.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
    : '';
  const aiRisks = ai && (ai.riskNotes || []).length
    ? `<h4>AI 보강 — 유의사항</h4><ul class="sum-list">${
      ai.riskNotes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
    : '';

  const checkpoints = (qa.checkpoints || []).map((g) => `
    <div class="qa-group">
      <div class="qa-group-head"><b>${esc(g.title)}</b><span class="sum-count">${g.items.length}</span></div>
      <table class="sum-table qa-table">
        <thead><tr><th>확인할 것</th><th>왜</th><th>어떻게</th></tr></thead>
        <tbody>${g.items.map((i) => `<tr>
          <td><b>${esc(i.what)}</b></td>
          <td class="sum-src">${esc(i.why)}</td>
          <td>${esc(i.how)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`).join('');

  const todos = (qa.todos || []).length
    ? `<h4>검증 착수 전 준비 (해야 할 일)</h4>
       <ul class="qa-todos">${qa.todos.map((t) => `
         <li><span class="qa-check" aria-hidden="true">☐</span>
           <span>${esc(t.text)}<span class="sum-note">${esc(t.reason)}</span></span></li>`).join('')}</ul>`
    : '';

  const section1 = card(QA_SECTIONS[0],
    (checkpoints || empty('추출된 확인 사항이 없습니다.')) + todos + aiFocus + aiRisks);

  /* ------------------------------------------------------------ 2. URL */
  const section2 = card(QA_SECTIONS[1], (qa.urls || []).length
    ? `<div class="sum-table-wrap"><table class="sum-table">
        <thead><tr><th>#</th><th>화면/기능</th><th>URL 경로</th><th>접근 권한</th><th>핵심 검증 시나리오</th></tr></thead>
        <tbody>${qa.urls.map((u, i) => `<tr>
          <td>${i + 1}</td>
          <td>${esc(u.screen)}</td>
          <td class="mono">${u.method ? `<span class="qa-method">${esc(u.method)}</span>` : ''}${esc(u.path)}</td>
          <td>${esc(u.access)}</td>
          <td class="sum-src">${esc(u.scenario)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="sum-note">상대경로는 검증 환경(스테이징) base URL 을 붙여 사용하세요.</p>`
    : empty('문서에서 URL·경로를 찾지 못했습니다 — 검증 대상 주소를 기획에 확인해야 합니다.'));

  /* ----------------------------------------------------------- 3. 흐름 */
  const flow = qa.flow || {};
  const section3 = card(QA_SECTIONS[2], flow.mermaid
    ? `<pre class="qa-mermaid" id="qaMermaid">${esc(flow.mermaid)}</pre>
       <div class="qa-flow-actions">
         <button class="btn btn-sm btn-ghost" id="btnCopyFlow">mermaid 복사</button>
         <span class="sum-note">Notion·GitHub 에 붙이면 다이어그램으로 렌더됩니다.</span>
       </div>
       <p class="sum-note">${esc(flow.caption || '')}</p>`
    : empty('영역을 인식하지 못해 흐름도를 만들지 못했습니다.'));

  /* ---------------------------------------------------------- 4. Figma */
  const section4 = card(QA_SECTIONS[3], qa.figma
    ? `<ul class="sum-list">${qa.figma.map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noreferrer noopener">${esc(u)}</a></li>`).join('')}</ul>`
    : '<p class="qa-none"><b>Figma 링크 없음</b></p>');

  /* --------------------------------------------------------- 5. 비목표 */
  const aiNonGoals = ai && (ai.nonGoals || []).length
    ? `<h4>AI 보강</h4><ul class="sum-list">${ai.nonGoals.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
    : '';
  const section5 = card(QA_SECTIONS[4],
    `<ul class="qa-scope">${(qa.nonGoals || []).map((n) => `
      <li>${esc(n.text)}${n.source ? `<span class="tag">${esc(n.source)}</span>` : ''}${
      n.line ? `<span class="mono">L${n.line}</span>` : ''}</li>`).join('')}</ul>${aiNonGoals}
     <p class="sum-note">범위를 명확히 해두면 불필요한 결함 리포트를 줄일 수 있습니다.</p>`);

  /* ----------------------------------------------------------- 6. 목표 */
  const aiGoals = ai && (ai.goals || []).length
    ? `<h4>AI 보강</h4><ul class="sum-list">${ai.goals.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
    : '';
  const section6 = card(QA_SECTIONS[5],
    `<ul class="qa-scope qa-scope-goal">${(qa.goals || []).map((g) => `
      <li>${esc(g.text)}${g.source ? `<span class="tag">${esc(g.source)}</span>` : ''}${
      g.line ? `<span class="mono">L${g.line}</span>` : ''}</li>`).join('')}</ul>${aiGoals}
     <p class="qa-guarantee">${esc(qa.guarantee || '')}</p>`);

  return `<div class="qa-plan">
      <div class="qa-plan-head">
        <h2>QA/QC 검증 분석서</h2>
        <button class="btn btn-sm" id="btnCopyQaPlan">검증 분석서 마크다운 복사</button>
      </div>
      ${section1}${section2}${section3}${section4}${section5}${section6}
    </div>`;
}

/** 6개 섹션을 사내 표준 마크다운으로 — Notion·티켓에 그대로 붙여넣는 용도 */
function qaPlanToMarkdown() {
  const s = state.specSummary;
  const qa = s && s.qaPlan;
  if (!qa) return '';
  const ai = state.aiSummary;
  const out = [];

  out.push('# QA/QC 검증 분석서', '');
  out.push(`> 분석 출처: ${state.sourceName || '붙여넣은 기획서 텍스트'}`);
  out.push(`> 작성 기준일: ${new Date().toISOString().slice(0, 10)}`, '', '---', '');

  out.push(`## ${QA_SECTIONS[0]}`, '');
  (qa.checkpoints || []).forEach((g) => {
    out.push(`### ${g.title}`, '');
    out.push('| 확인할 것 | 왜 | 어떻게 |', '| --- | --- | --- |');
    g.items.forEach((i) => out.push(`| ${i.what} | ${i.why} | ${i.how} |`));
    out.push('');
  });
  if ((qa.todos || []).length) {
    out.push('### 검증 착수 전 준비 (해야 할 일)', '');
    qa.todos.forEach((t) => out.push(`- [ ] ${t.text} — ${t.reason}`));
    out.push('');
  }
  if (ai && (ai.testFocus || []).length) {
    out.push('### AI 보강 — 반드시 수행할 테스트', '');
    ai.testFocus.forEach((t) => out.push(`- ${t}`));
    out.push('');
  }
  if (ai && (ai.riskNotes || []).length) {
    out.push('### AI 보강 — 유의사항', '');
    ai.riskNotes.forEach((t) => out.push(`- ${t}`));
    out.push('');
  }

  out.push(`## ${QA_SECTIONS[1]}`, '');
  if ((qa.urls || []).length) {
    out.push('| # | 화면/기능 | URL 경로 | 접근 권한 | 핵심 검증 시나리오 |', '| --- | --- | --- | --- | --- |');
    qa.urls.forEach((u, i) => out.push(
      `| ${i + 1} | ${u.screen} | ${u.method ? `\`${u.method}\` ` : ''}${u.path} | ${u.access} | ${u.scenario} |`));
  } else {
    out.push('문서에서 URL·경로를 찾지 못했습니다 — 검증 대상 주소를 기획에 확인해야 합니다.');
  }
  out.push('');

  out.push(`## ${QA_SECTIONS[2]}`, '');
  if (qa.flow && qa.flow.mermaid) {
    out.push('```mermaid', qa.flow.mermaid, '```', '', qa.flow.caption || '');
  } else {
    out.push('영역을 인식하지 못해 흐름도를 만들지 못했습니다.');
  }
  out.push('');

  out.push(`## ${QA_SECTIONS[3]}`, '');
  if (qa.figma) qa.figma.forEach((u) => out.push(`- ${u}`));
  else out.push('> **Figma 링크 없음**');
  out.push('');

  out.push(`## ${QA_SECTIONS[4]}`, '');
  (qa.nonGoals || []).forEach((n) => out.push(`- ${n.text}${n.source ? ` _(${n.source})_` : ''}`));
  if (ai && (ai.nonGoals || []).length) ai.nonGoals.forEach((t) => out.push(`- ${t} _(AI 보강)_`));
  out.push('');

  out.push(`## ${QA_SECTIONS[5]}`, '');
  (qa.goals || []).forEach((g) => out.push(`- ${g.text}${g.source ? ` _(${g.source})_` : ''}`));
  if (ai && (ai.goals || []).length) ai.goals.forEach((t) => out.push(`- ${t} _(AI 보강)_`));
  if (qa.guarantee) out.push('', qa.guarantee);

  return out.join('\n');
}

async function copyQaPlan() {
  try {
    await navigator.clipboard.writeText(qaPlanToMarkdown());
    setStatus('검증 분석서를 마크다운으로 복사했습니다. Notion 에 그대로 붙여넣을 수 있습니다.', 'ok');
  } catch (err) {
    setStatus(`복사 실패: ${err.message}`, 'error');
  }
}

async function copyFlow() {
  const s = state.specSummary;
  const mermaid = s && s.qaPlan && s.qaPlan.flow && s.qaPlan.flow.mermaid;
  if (!mermaid) return;
  try {
    await navigator.clipboard.writeText(mermaid);
    setStatus('mermaid 소스를 복사했습니다.', 'ok');
  } catch (err) {
    setStatus(`복사 실패: ${err.message}`, 'error');
  }
}
