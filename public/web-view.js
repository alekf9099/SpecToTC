'use strict';

/**
 * 웹사이트 화면 분석 뷰 — dashboard.js 와 전역 스코프를 공유한다.
 *
 * 결과 TC 는 기획서 기반 TC 와 같은 구조이므로, 우측 표·요약·CSV·PDF 내보내기는
 * 손대지 않고 그대로 재사용한다. 이 파일은 좌측 패널의 분석 개요만 그린다.
 */

const WEB_KIND_LABEL = { login: '로그인', search: '검색', generic: '일반' };

/** 필드 하나를 제약 표기와 함께 태그로 */
function webFieldTag(field) {
  const c = field.constraints || {};
  const marks = [];
  if (c.required) marks.push('필수');
  if (c.maxLength) marks.push(`≤${c.maxLength}자`);
  if (c.minLength) marks.push(`≥${c.minLength}자`);
  if (c.pattern) marks.push('패턴');
  if (c.accept) marks.push('형식제한');
  if (c.readonly) marks.push('읽기전용');
  const suffix = marks.length ? ` · ${marks.join(' ')}` : '';
  return `<span class="tag">${esc(field.label)} (${esc(field.type)}${esc(suffix)})</span>`;
}

function webFormItem(form) {
  const fields = form.fields.slice(0, 10).map(webFieldTag).join('');
  const more = form.fields.length > 10 ? `<span class="tag">+${form.fields.length - 10}개</span>` : '';
  return `<li>
      <span class="mono">${esc(form.method)} ${esc(form.action)}</span>
      <span class="tag">${esc(WEB_KIND_LABEL[form.kind] || form.kind)}</span>
      ${form.outsideForm ? '<span class="tag tag-warn">form 태그 밖</span>' : ''}
      ${form.hasFileUpload ? '<span class="tag">파일 업로드</span>' : ''}
      <div class="sum-tags">${fields}${more}</div>
      ${form.submits.length ? `<p class="sum-note">제출 버튼: ${esc(form.submits.join(', '))}</p>` : ''}
    </li>`;
}

function renderWebResult(data) {
  const inv = data.inventory;
  const fieldCount = inv.interaction.forms.reduce((n, f) => n + f.fields.length, 0);
  const stat = (k, v) => `<span class="stat">${esc(k)} <b>${esc(v)}</b></span>`;
  const warn = (msg) => `<p class="web-warn">${esc(msg)}</p>`;

  const head = `<p class="sum-note">${esc(data.page.finalUrl)} · ${data.page.status} · ${
    Math.round(data.page.bytes / 1024)}KB${
    data.page.redirects.length ? ` · 리다이렉트 ${data.page.redirects.length}회` : ''}</p>`
    + (data.page.title ? `<p><b>${esc(data.page.title)}</b></p>` : '');

  const forms = (inv.interaction.forms || []).map(webFormItem).join('');
  const a11y = inv.accessibility;
  const a11yNotes = [];
  if (a11y.missingAlt) a11yNotes.push(`alt 누락 ${a11y.missingAlt}/${a11y.images}`);
  if (a11y.langMissing) a11yNotes.push('lang 속성 없음');
  if (!inv.page.hasViewport) a11yNotes.push('viewport 없음');
  if (inv.links.problems.targetBlankNoRel) a11yNotes.push(`rel=noopener 누락 ${inv.links.problems.targetBlankNoRel}`);
  if (inv.links.problems.emptyHref) a11yNotes.push(`빈 링크 ${inv.links.problems.emptyHref}`);

  $('#webResult').innerHTML = [
    head,
    '<div class="web-stats">',
    stat('폼', inv.interaction.forms.length),
    stat('입력', fieldCount),
    stat('버튼', inv.interaction.buttonCount),
    stat('내부 링크', inv.links.internalCount),
    stat('외부 링크', inv.links.externalCount),
    stat('이미지', a11y.images),
    '</div>',
    inv.rendering.note ? warn(inv.rendering.note) : '',
    data.page.truncated ? warn('페이지가 커서 앞부분만 분석했습니다. 놓친 요소가 있을 수 있습니다.') : '',
    a11yNotes.length ? `<p class="sum-note">점검 신호: ${esc(a11yNotes.join(' · '))}</p>` : '',
    forms ? `<label class="field-label">발견된 폼 ${inv.interaction.forms.length}개</label><ul class="web-forms">${forms}</ul>` : '',
  ].join('');
}

async function analyzeUrl() {
  const url = $('#siteUrl').value.trim();
  if (!url) {
    setStatus('분석할 주소를 입력하세요.', 'error');
    return;
  }

  const btn = $('#btnAnalyzeUrl');
  btn.disabled = true;
  setStatus('페이지를 가져와 화면 요소를 분석하는 중…');

  try {
    const data = await api('/api/analyze-url', { url });

    state.testCases = data.testCases || [];
    state.specSummary = data.specSummary || null;
    state.aiSummary = null;
    state.sourceName = data.page.finalUrl;
    state.expanded.clear();

    renderWebResult(data);
    renderSummary(data);
    renderTable();
    renderSpecSummary();
    setView('tc');

    const inv = data.inventory;
    const fieldCount = inv.interaction.forms.reduce((n, f) => n + f.fields.length, 0);
    setStatus([
      `분석 완료 — TC ${state.testCases.length}건 (${data.elapsedMs}ms)`,
      data.page.title ? `제목: ${data.page.title}` : '',
      `폼 ${inv.interaction.forms.length}개 · 입력 ${fieldCount}개 · 버튼 ${inv.interaction.buttonCount}개 · 내부 링크 ${inv.links.internalCount}개`,
      inv.rendering.jsRendered
        ? '⚠ JS 렌더링 위주 페이지입니다 — 브라우저에서 직접 열어 놓친 요소를 TC 로 보완하세요.'
        : '',
    ].filter(Boolean).join('\n'), 'ok');
  } catch (err) {
    setStatus(`분석 실패: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}
