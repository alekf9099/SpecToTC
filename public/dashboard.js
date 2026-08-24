'use strict';

/* ------------------------------------------------------------------ state */
const state = {
  testCases: [],
  sourceName: null,
  specSummary: null,
  aiSummary: null,
  view: 'tc',
  expanded: new Set(),
  filter: { type: 'all', priority: 'all', area: 'all', q: '' },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setStatus(message, kind) {
  const box = $('#statusBox');
  if (!message) { box.hidden = true; return; }
  box.hidden = false;
  box.textContent = message;
  box.className = 'status' + (kind ? ` is-${kind}` : '');
}

/** 세션이 끊기면 현재 경로를 물고 로그인 화면으로 이동한다. */
function redirectToLogin() {
  const next = encodeURIComponent(location.pathname + location.search);
  location.replace('/login.html?next=' + next);
}

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    redirectToLogin();
    throw new Error('세션이 만료되었습니다. 다시 로그인해 주세요.');
  }
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* --------------------------------------------------------------- rendering */
const TYPE_CLASS = { Pass: 'pass', Fail: 'fail', 'Edge Case': 'edge' };

function visibleCases() {
  const { type, priority, area, q } = state.filter;
  const needle = q.trim().toLowerCase();
  return state.testCases.filter((tc) => {
    if (type !== 'all' && tc.type !== type) return false;
    if (priority !== 'all' && tc.priority !== priority) return false;
    if (area !== 'all' && tc.area !== area) return false;
    if (needle) {
      const hay = [
        tc.tc_id, tc.title || tc.scenario, tc.objective,
        (tc.expected || []).join(' '), (tc.precondition || []).join(' '), (tc.steps || []).join(' '),
        tc.requirement && tc.requirement.text,
      ].join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

function renderTable() {
  const rows = visibleCases();
  const body = $('#tcBody');

  if (!rows.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="6">${
      state.testCases.length ? '필터 조건에 맞는 테스트케이스가 없습니다.' : '좌측에 기획서를 붙여넣거나 파일을 끌어다 놓고 <b>테스트케이스 생성</b>을 누르세요.'
    }</td></tr>`;
    return;
  }

  const list = (items, ordered) => {
    if (!Array.isArray(items) || !items.length) return '<p class="detail-empty">-</p>';
    const tag = ordered ? 'ol' : 'ul';
    return `<${tag} class="detail-list">${items.map((s) => `<li>${esc(s)}</li>`).join('')}</${tag}>`;
  };

  body.innerHTML = rows.map((tc) => {
    const open = state.expanded.has(tc.tc_id);
    const req = tc.requirement || {};
    const title = tc.title || tc.scenario || '';

    const detail = `
      <tr class="detail-row" data-detail="${esc(tc.tc_id)}"${open ? '' : ' hidden'}>
        <td colspan="6">
          <div class="detail">
            <div class="detail-block detail-objective"><h4>검증 목적</h4><p>${esc(tc.objective || '-')}</p></div>
            <div class="detail-grid">
              <div class="detail-block"><h4>사전 조건</h4>${list(tc.precondition, false)}</div>
              <div class="detail-block"><h4>수행 단계</h4>${list(tc.steps, true)}</div>
              <div class="detail-block"><h4>기대 결과</h4>${list(tc.expected, false)}</div>
            </div>
            <div class="detail-block detail-source">
              <h4>근거 요구사항</h4>
              <p><span class="mono">${esc(req.id || tc.requirement_id || '-')}</span>
                 ${req.line != null ? `<span class="mono">L${req.line}</span>` : ''}
                 ${esc(req.text || tc.source_text || '')}</p>
              <p class="detail-tags">${(req.categories || tc.categories || []).concat(tc.tags || [])
                .map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</p>
            </div>
          </div>
        </td>
      </tr>`;

    return `
      <tr class="tc-row prio-${esc(tc.priority)}${open ? ' is-open' : ''}" data-tc="${esc(tc.tc_id)}" tabindex="0">
        <td class="cell-id">${esc(tc.tc_id)}${tc.origin === 'ai' ? '<span class="pill pill-ai">AI</span>' : ''}</td>
        <td><span class="pill pill-${TYPE_CLASS[tc.type] || 'low'}">${esc(tc.type)}</span></td>
        <td><span class="pill pill-${String(tc.priority).toLowerCase()}">${esc(tc.priority)}</span></td>
        <td class="cell-area">${esc(tc.area)}</td>
        <td class="cell-title">${esc(title)}<span class="cell-objective">${esc(tc.objective || '')}</span></td>
        <td class="cell-toggle"><span class="chevron" aria-hidden="true">${open ? '▾' : '▸'}</span></td>
      </tr>${detail}`;
  }).join('');
}

function toggleDetail(tcId) {
  if (state.expanded.has(tcId)) state.expanded.delete(tcId);
  else state.expanded.add(tcId);
  renderTable();
}

function renderSummary(data) {
  const s = data.summary || {};
  const byType = s.byType || {};
  const byPriority = s.byPriority || {};
  const stat = (label, value) => `<span class="stat">${label} <b>${value ?? 0}</b></span>`;

  $('#summary').innerHTML = [
    stat('총 TC', s.total),
    stat('Pass', byType.Pass),
    stat('Fail', byType.Fail),
    stat('Edge', byType['Edge Case']),
    stat('High', byPriority.High),
    stat('요구사항', (s.parse && s.parse.requirements) || (data.requirements || []).length),
    stat('영역', (data.areas || []).length),
  ].join('');

  const areaSelect = $('#areaFilter');
  const current = areaSelect.value;
  const areas = [...new Set(state.testCases.map((tc) => tc.area))];
  areaSelect.innerHTML = '<option value="all">영역 전체</option>' +
    areas.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  areaSelect.value = areas.includes(current) ? current : 'all';
  state.filter.area = areaSelect.value;

  const hasRows = state.testCases.length > 0;
  ['#btnCsv', '#btnExcel', '#btnJson', '#btnExportPdfTc'].forEach((id) => { $(id).disabled = !hasRows; });
}

/* ---------------------------------------------------------------- actions */
async function generate() {
  const specText = $('#specText').value;
  if (!specText.trim()) return setStatus('기획서 텍스트를 입력하세요.', 'error');

  const btn = $('#btnGenerate');
  btn.disabled = true;
  setStatus('생성 중…');

  try {
    const data = await api('/api/generate-tc', {
      specText,
      useAI: $('#optAI').checked,
      options: {
        includePass: $('#optPass').checked,
        includeFail: $('#optFail').checked,
        includeEdge: $('#optEdge').checked,
      },
    });

    state.testCases = data.testCases || [];
    state.specSummary = data.specSummary || null;
    state.aiSummary = null;
    state.expanded.clear();
    renderSummary(data);
    renderTable();
    renderSpecSummary();

    const lines = [`완료 — TC ${state.testCases.length}건 / 요구사항 ${data.requirements.length}건 (${data.elapsedMs}ms)`];
    if (data.ai && data.ai.requested) {
      lines.push(data.ai.error ? `AI 보강: ${data.ai.error}` : `AI 보강: ${data.ai.added}건 추가 (${data.ai.model})`);
    }
    setStatus(lines.join('\n'), 'ok');
  } catch (err) {
    setStatus(`생성 실패: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function exportCsv(opts = {}) {
  if (!state.testCases.length) return;
  try {
    const res = await fetch('/api/export-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testCases: visibleCases(), excel: opts.excel !== false, bom: opts.bom !== false }),
    });
    if (res.status === 401) {
      redirectToLogin();
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    triggerDownload(blob, fileNameFromHeader(res) || 'spectotc-tc.csv');
  } catch (err) {
    setStatus(`CSV 내보내기 실패: ${err.message}`, 'error');
  }
}

function fileNameFromHeader(res) {
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="?([^";]+)"?/);
  return m ? decodeURIComponent(m[1]) : null;
}

function exportJson() {
  const blob = new Blob([JSON.stringify(visibleCases(), null, 2)], { type: 'application/json' });
  triggerDownload(blob, 'spectotc-tc.json');
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------ file upload */
const KIND_LABEL = { pdf: 'PDF', docx: 'Word(.docx)', text: '텍스트' };

function showFileChip(meta, selector) {
  const chip = $(selector || '#fileChip');
  if (!chip) return;
  if (!meta) { chip.hidden = true; chip.innerHTML = ''; return; }

  const bits = [KIND_LABEL[meta.kind] || meta.kind, `${meta.chars.toLocaleString()}자`];
  if (meta.pages) bits.push(`${meta.extractedPages}/${meta.pages}p`);
  if (meta.paragraphs) bits.push(`문단 ${meta.paragraphs}`);
  if (meta.tables) bits.push(`표 ${meta.tables}`);
  if (meta.encoding && meta.encoding !== 'utf-8') bits.push(meta.encoding);

  chip.hidden = false;
  chip.innerHTML = `<b>${esc(meta.fileName)}</b><span>${esc(bits.join(' · '))}</span>`
    + '<button type="button" class="chip-clear" title="첨부 해제" aria-label="첨부 해제">✕</button>';
  chip.querySelector('.chip-clear').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#fileInput').value = '';
    if ($('#summaryFileInput')) $('#summaryFileInput').value = '';
    showFileChip(null, '#fileChip');
    showFileChip(null, '#summaryFileChip');
  });
}

/**
 * @param {File} file
 * @param {{mode?: 'generate'|'summary', dropzone?: string, chip?: string}} opts
 *   mode 'summary' 면 TC 생성 대신 요약만 실행한다 (요약 탭에 올린 경우).
 */
async function uploadFile(file, opts = {}) {
  if (!file) return;
  const mode = opts.mode || 'generate';
  const dz = $(opts.dropzone || '#dropzone');
  dz.classList.add('is-busy');
  setStatus(`${file.name} 에서 텍스트를 추출하는 중…`);

  try {
    const res = await fetch('/api/extract-text', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        // 한글 파일명이 헤더에서 깨지지 않도록 인코딩해 보낸다.
        'X-File-Name': encodeURIComponent(file.name),
      },
      body: file,
    });
    if (res.status === 401) {
      redirectToLogin();
      return;
    }
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);

    $('#specText').value = data.specText;
    state.sourceName = data.meta.fileName;
    showFileChip(data.meta, opts.chip || '#fileChip');
    if (opts.chip && opts.chip !== '#fileChip') showFileChip(data.meta, '#fileChip');

    if (data.meta.truncated) {
      setStatus(`${file.name} — 문서가 길어 앞부분만 사용합니다 (${data.meta.chars.toLocaleString()}자 중 일부).`, 'error');
    }

    if (mode === 'summary') await summarizeOnly(data.specText);
    else await generate();
  } catch (err) {
    setStatus(`파일 처리 실패: ${err.message}`, 'error');
  } finally {
    dz.classList.remove('is-busy');
  }
}

/**
 * 드롭존 하나를 배선한다.
 * @param {{zone: string, input: string, dropArea: string, chip: string, mode: string}} cfg
 */
function bindDropTarget(cfg) {
  const dz = $(cfg.zone);
  const input = $(cfg.input);
  const area = document.querySelector(cfg.dropArea);
  if (!dz || !input || !area) return;

  const opts = { mode: cfg.mode, dropzone: cfg.zone, chip: cfg.chip };

  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  input.addEventListener('change', () => uploadFile(input.files && input.files[0], opts));

  let depth = 0;
  area.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    depth += 1;
    dz.classList.add('is-drag');
  });
  area.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) dz.classList.remove('is-drag');
  });
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    dz.classList.remove('is-drag');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    if (files.length > 1) setStatus(`파일 ${files.length}개 중 첫 번째(${files[0].name})만 사용합니다.`);
    uploadFile(files[0], opts);
  });
}

function bindDropzone() {
  // 브라우저 기본 동작(파일 열기로 페이지 이탈)을 막는다.
  ['dragover', 'drop'].forEach((type) => {
    window.addEventListener(type, (e) => e.preventDefault());
  });

  // 좌측 입력 패널 — 올리면 TC 생성까지 진행
  bindDropTarget({
    zone: '#dropzone', input: '#fileInput', dropArea: '.pane-input',
    chip: '#fileChip', mode: 'generate',
  });

  // 우측 문서 요약 탭 — 올리면 요약만 실행
  bindDropTarget({
    zone: '#summaryDrop', input: '#summaryFileInput', dropArea: '#summaryView',
    chip: '#summaryFileChip', mode: 'summary',
  });
}

async function runDiff() {
  const oldText = $('#oldText').value;
  const newText = $('#newText').value;
  if (!oldText.trim() || !newText.trim()) return setStatus('이전/신규 기획서를 모두 입력하세요.', 'error');

  const btn = $('#btnDiff');
  btn.disabled = true;
  setStatus('비교 중…');

  try {
    const data = await api('/api/diff-check', { oldText, newText });
    renderDiff(data);

    state.testCases = data.regressionTestCases || [];
    state.expanded.clear();
    setView('tc');
    renderSummary({ summary: data.regressionSummary, areas: data.summary.impactedAreas, requirements: [] });
    renderTable();

    setStatus(
      `변경 추출 완료 — 추가 ${data.summary.added} / 수정 ${data.summary.modified} / 삭제 ${data.summary.removed}\n` +
      `영향 영역: ${data.summary.impactedAreas.join(', ') || '없음'}\n` +
      `우측 표에 회귀 대상 TC ${state.testCases.length}건을 표시했습니다.`,
      'ok'
    );
  } catch (err) {
    setStatus(`비교 실패: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

function renderDiff(data) {
  const group = (title, items, cls, render) => {
    if (!items || !items.length) return '';
    return `<div class="diff-group"><h3>${title} (${items.length})</h3>${items.map(render).join('')}</div>`;
  };

  $('#diffResult').innerHTML = [
    group('추가된 요구사항', data.added, 'added', (i) => `
      <div class="diff-item diff-added">${esc(i.requirement.text)}
        <div class="meta">${esc(i.requirement.area)} · L${i.requirement.line}</div></div>`),
    group('수정된 요구사항', data.modified, 'modified', (i) => `
      <div class="diff-item diff-modified">${esc(i.requirement.text)}
        <div class="meta"><del>${esc(i.previousText)}</del></div>
        <div class="meta">${esc(i.requirement.area)} · 유사도 ${i.similarity} · ${esc(i.changes.join(' / '))}</div></div>`),
    group('삭제된 요구사항', data.removed, 'removed', (i) => `
      <div class="diff-item diff-removed">${esc(i.requirement.text)}
        <div class="meta">${esc(i.requirement.area)} · L${i.requirement.line}</div></div>`),
  ].join('') || '<div class="diff-item">변경된 요구사항이 없습니다.</div>';
}

/* ------------------------------------------------------------------ wiring */
function bind() {
  $('#btnGenerate').addEventListener('click', generate);
  bindDropzone();

  $$('.view-switch .tab').forEach((tab) => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  });

  // 행이 매번 다시 렌더되므로 tbody 에 위임해 상세를 토글한다.
  $('#tcBody').addEventListener('click', (e) => {
    const row = e.target.closest('tr.tc-row');
    if (row) toggleDetail(row.dataset.tc);
  });
  $('#tcBody').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('tr.tc-row');
    if (!row) return;
    e.preventDefault();
    toggleDetail(row.dataset.tc);
  });

  $('#btnClear').addEventListener('click', () => {
    $('#specText').value = '';
    $('#fileInput').value = '';
    if ($('#summaryFileInput')) $('#summaryFileInput').value = '';
    showFileChip(null, '#fileChip');
    showFileChip(null, '#summaryFileChip');
    state.sourceName = null;
    state.testCases = [];
    state.specSummary = null;
    state.aiSummary = null;
    state.expanded.clear();
    renderSummary({ summary: {}, areas: [], requirements: [] });
    renderTable();
    renderSpecSummary();
    setStatus('');
  });

  $('#btnSample').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/sample');
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      $('#specText').value = data.specText;
      setStatus('샘플 기획서를 불러왔습니다.', 'ok');
    } catch (err) {
      setStatus(`샘플 불러오기 실패: ${err.message}`, 'error');
    }
  });

  $('#btnAnalyzeUrl').addEventListener('click', analyzeUrl);
  $('#siteUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') analyzeUrl(); });
  $('#btnUrlSample').addEventListener('click', () => {
    $('#siteUrl').value = 'https://www.naver.com';
    setStatus('예시 주소를 넣었습니다. [화면 분석 후 TC 생성] 을 눌러보세요.', 'ok');
  });

  $('#btnDiff').addEventListener('click', runDiff);
  $('#btnDiffSample').addEventListener('click', async () => {
    const res = await fetch('/api/sample');
    const data = await res.json();
    if (!data.ok) return;
    $('#oldText').value = data.specText;
    $('#newText').value = data.specText
      .replace('8자 이상 20자 이하', '10자 이상 24자 이하')
      .replace('5회 연속 틀리면', '3회 연속 틀리면')
      .replace('최대 2회 재시도한다', '최대 4회 재시도한다')
      + '\n- 로그인 시 기기 정보를 저장하고, 새로운 기기에서는 추가 인증을 요구한다.\n';
    setStatus('샘플 비교 데이터를 채웠습니다. [변경 요구사항 추출]을 눌러보세요.', 'ok');
  });

  $('#btnExcel').addEventListener('click', () => exportCsv({ excel: true, bom: true }));
  $('#btnCsv').addEventListener('click', () => exportCsv({ excel: false, bom: false }));
  $('#btnJson').addEventListener('click', exportJson);
  $('#btnExportPdfTc').addEventListener('click', () => exportReportPdf());

  $('#btnLogout').addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } finally {
      location.replace('/login.html');
    }
  });

  $$('.tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tabs .tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      $$('.tab-panel').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === tab.dataset.tab));
    });
  });

  $$('#typeFilters .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $$('#typeFilters .chip').forEach((c) => c.classList.toggle('is-active', c === chip));
      state.filter.type = chip.dataset.type;
      renderTable();
    });
  });

  $('#priorityFilter').addEventListener('change', (e) => { state.filter.priority = e.target.value; renderTable(); });
  $('#areaFilter').addEventListener('change', (e) => { state.filter.area = e.target.value; renderTable(); });
  $('#searchInput').addEventListener('input', (e) => { state.filter.q = e.target.value; renderTable(); });

  $('#specText').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generate();
  });
}

async function loadHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    // 인증이 필요한 서버인데 세션이 없으면 바로 로그인 화면으로
    if (data.auth && data.auth.required && !data.auth.authenticated) {
      redirectToLogin();
      return;
    }
    $('#btnLogout').hidden = !(data.auth && data.auth.required);

    const ai = data.ai || {};
    const aiBadge = $('#aiBadge');
    aiBadge.textContent = ai.enabled
      ? `AI 보강 사용 가능 · ${ai.model}${ai.tokenRequired ? ' (토큰 필요)' : ''}`
      : 'AI 보강 비활성 (규칙 엔진)';
    aiBadge.className = 'badge ' + (ai.enabled ? 'badge-ok' : 'badge-muted');
    $('#healthBadge').textContent = `v${data.version}${data.node ? ' · ' + data.node : ''}`;
    $('#healthBadge').className = 'badge badge-ok';
    if (!ai.enabled) $('#optAI').disabled = true;
  } catch (err) {
    $('#aiBadge').textContent = '서버 연결 실패';
    $('#aiBadge').className = 'badge badge-off';
  }
}

bind();
loadHealth();
