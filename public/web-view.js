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

  const render = $('#optRender') && $('#optRender').checked;
  const btn = $('#btnAnalyzeUrl');
  btn.disabled = true;
  setStatus(render
    ? '브라우저로 페이지를 열어 렌더링된 화면을 분석하는 중… (JS 로 그려지는 요소 포함, 시간이 더 걸립니다)'
    : '페이지를 가져와 화면 요소를 분석하는 중…');

  try {
    const data = await api('/api/analyze-url', { url, render });
    state.webUrl = url;

    state.testCases = data.testCases || [];
    state.specSummary = data.specSummary || null;
    state.aiSummary = null;
    state.sourceName = data.page.finalUrl;
    state.expanded.clear();

    // 편집기에서 조건을 지정하고 되돌릴 수 있게 원본과 작업본을 함께 둔다
    state.webInventory = JSON.parse(JSON.stringify(data.inventory));
    state.webInventoryOriginal = JSON.parse(JSON.stringify(data.inventory));

    renderWebResult(data);
    renderFormEditor();
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
      data.renderedByBrowser
        ? '✔ 브라우저로 렌더링한 화면을 분석했습니다 — JS 로 그려지는 요소가 포함됩니다.'
        : '',
      data.renderFallbackNote ? `⚠ ${data.renderFallbackNote}` : '',
      !data.renderedByBrowser && inv.rendering.jsRendered
        ? '⚠ JS 렌더링 위주 페이지입니다 — [브라우저로 렌더링 분석] 을 켜고 다시 시도하면 가려진 요소까지 볼 수 있습니다.'
        : '',
      data.observations && data.observations.consoleErrors.length
        ? `⚠ 페이지 로딩 중 콘솔 오류 ${data.observations.consoleErrors.length}건 관측`
        : '',
    ].filter(Boolean).join('\n'), 'ok');
  } catch (err) {
    setStatus(`분석 실패: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

/**
 * 로그인 후 여러 화면을 돌며 TC 를 만든다.
 *
 * 한 장 분석(analyzeUrl)과 달리 링크를 따라가므로 화면마다 세부 TC 가 나온다.
 * 자격 증명은 요청 본문으로만 보내고 화면·상태 어디에도 보관하지 않는다.
 */
async function analyzeSite() {
  const blocked = browserBlockReason('render');
  if (blocked) {
    setStatus(`사이트 탐색을 할 수 없습니다 — ${blocked}\n대신 [화면 분석 후 TC 생성] 으로 한 화면만 분석할 수 있습니다.`, 'error');
    return;
  }

  const url = $('#siteUrl').value.trim();
  if (!url) {
    setStatus('분석할 주소를 입력하세요.', 'error');
    return;
  }

  const password = $('#sitePass').value;
  const [maxPages, maxDepth] = $('#siteScope').value.split(',').map(Number);

  if (password && !confirm([
    '입력한 계정으로 대상 사이트에 실제로 로그인합니다.',
    '',
    `주소   ${url}`,
    `계정   ${$('#siteUser').value || '(아이디 없음)'}`,
    `범위   화면 ${maxPages}개 · 깊이 ${maxDepth}`,
    '',
    '검증 권한이 있는 사이트가 맞습니까?',
  ].join('\n'))) return;

  const btn = $('#btnAnalyzeSite');
  btn.disabled = true;
  setStatus(password
    ? `로그인 후 화면을 돌며 분석하는 중… (최대 ${maxPages}개 화면, 시간이 걸립니다)`
    : `링크를 따라가며 화면을 분석하는 중… (최대 ${maxPages}개 화면)`);

  try {
    const data = await api('/api/analyze-site', {
      url,
      login: password ? { username: $('#siteUser').value, password, url: $('#siteLoginUrl').value.trim() || null } : null,
      maxPages,
      maxDepth,
    });

    state.webUrl = url;
    state.testCases = data.testCases || [];
    state.specSummary = data.specSummary || null;
    state.aiSummary = null;
    state.sourceName = data.site.start;
    state.ranEmpty = state.testCases.length === 0;
    state.expanded.clear();

    // 탐색 결과는 폼 편집기 대상이 아니다 (화면이 여러 개라 하나로 특정할 수 없다)
    state.webInventory = null;
    state.webInventoryOriginal = null;
    renderFormEditor();

    renderSiteResult(data.site);
    renderSummary(data);
    renderTable();
    renderSpecSummary();
    setView('tc');

    const s = data.site;
    setStatus([
      `탐색 완료 — 화면 ${s.pages.length}개 · TC ${state.testCases.length}건 (${data.elapsedMs}ms)`,
      s.login
        ? (s.login.ok ? '✔ 로그인 성공 — 로그인 상태로 탐색했습니다.' : `⚠ 로그인 실패 — ${s.login.note || '자격 증명을 확인해 주세요.'}`)
        : '로그인 없이 탐색했습니다.',
      `분석한 화면: ${s.pages.map((p) => p.name).slice(0, 6).join(', ')}${s.pages.length > 6 ? ` 외 ${s.pages.length - 6}개` : ''}`,
      s.skippedLinks.length ? `⚠ 되돌릴 수 없어 보여 건너뛴 링크 ${s.skippedLinks.length}개 — 수동 확인 TC 로 남겼습니다.` : '',
      s.notVisited.length ? `⚠ 탐색 상한으로 보지 못한 화면 ${s.notVisited.length}개 — 범위를 넓혀 다시 실행할 수 있습니다.` : '',
      s.observations.consoleErrors.length ? `⚠ 탐색 중 콘솔 오류 ${s.observations.consoleErrors.length}건 관측` : '',
    ].filter(Boolean).join('\n'), 'ok');
  } catch (err) {
    setStatus(`사이트 탐색 실패: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    // 비밀번호는 화면에도 남기지 않는다
    $('#sitePass').value = '';
  }
}

/** 탐색한 화면 목록 — 무엇을 봤고 무엇을 못 봤는지 */
function renderSiteResult(site) {
  const box = $('#webResult');
  if (!box) return;

  const row = (p) => `<tr>
      <td>${esc(p.name)}</td>
      <td class="mono">${esc(p.path)}</td>
      <td>${p.forms}</td><td>${p.buttons}</td><td>${p.links}</td>
      <td class="sum-src">${esc(p.viaLabel || '시작 화면')}</td>
    </tr>`;

  box.innerHTML = `
    <div class="diff-group">
      <h3>탐색한 화면 ${site.pages.length}개</h3>
      <div class="sum-table-wrap">
        <table class="sum-table">
          <thead><tr><th>화면</th><th>경로</th><th>폼</th><th>버튼</th><th>링크</th><th>도달 경로</th></tr></thead>
          <tbody>${site.pages.map(row).join('')}</tbody>
        </table>
      </div>
      ${site.login ? `<p class="sum-note">로그인: ${site.login.ok ? '성공' : '실패'}${
    site.login.note ? ` — ${esc(site.login.note)}` : ''}</p>` : ''}
      ${site.skippedLinks.length ? `<p class="sum-note">건너뛴 링크: ${
    site.skippedLinks.slice(0, 6).map((s) => esc(s.label || s.url)).join(', ')}</p>` : ''}
      ${site.notVisited.length ? `<p class="sum-note">미방문(상한): ${
    site.notVisited.slice(0, 6).map((s) => esc(s.label || s.url)).join(', ')}</p>` : ''}
    </div>`;
}
