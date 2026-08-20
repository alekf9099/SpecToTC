'use strict';

/* ------------------------------------------------------------------ state */
const state = {
  testCases: [],
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

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
      const hay = `${tc.tc_id} ${tc.scenario} ${tc.expected} ${tc.precondition} ${(tc.steps || []).join(' ')}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

function renderTable() {
  const rows = visibleCases();
  const body = $('#tcBody');

  if (!rows.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="8">${
      state.testCases.length ? '필터 조건에 맞는 테스트케이스가 없습니다.' : '좌측에 기획서를 붙여넣고 <b>테스트케이스 생성</b>을 누르세요.'
    }</td></tr>`;
    return;
  }

  body.innerHTML = rows.map((tc) => `
    <tr class="prio-${esc(tc.priority)}">
      <td class="cell-id">${esc(tc.tc_id)}${tc.origin === 'ai' ? '<span class="pill pill-ai">AI</span>' : ''}</td>
      <td>${esc(tc.area)}</td>
      <td><span class="pill pill-${TYPE_CLASS[tc.type] || 'low'}">${esc(tc.type)}</span></td>
      <td>${esc(tc.scenario)}</td>
      <td>${esc(tc.precondition)}</td>
      <td class="cell-steps"><ol>${(tc.steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol></td>
      <td>${esc(tc.expected)}</td>
      <td><span class="pill pill-${String(tc.priority).toLowerCase()}">${esc(tc.priority)}</span></td>
    </tr>`).join('');
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
  ['#btnCsv', '#btnExcel', '#btnJson'].forEach((id) => { $(id).disabled = !hasRows; });
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
    renderSummary(data);
    renderTable();

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

async function exportCsv(excel) {
  if (!state.testCases.length) return;
  try {
    const res = await fetch('/api/export-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testCases: visibleCases(), excel }),
    });
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
  $('#btnClear').addEventListener('click', () => {
    $('#specText').value = '';
    state.testCases = [];
    renderSummary({ summary: {}, areas: [], requirements: [] });
    renderTable();
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

  $('#btnCsv').addEventListener('click', () => exportCsv(false));
  $('#btnExcel').addEventListener('click', () => exportCsv(true));
  $('#btnJson').addEventListener('click', exportJson);

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
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
    const aiBadge = $('#aiBadge');
    aiBadge.textContent = data.ai.enabled ? `AI 보강 사용 가능 · ${data.ai.model}` : 'AI 보강 비활성 (규칙 엔진)';
    aiBadge.className = 'badge ' + (data.ai.enabled ? 'badge-ok' : 'badge-muted');
    $('#healthBadge').textContent = `v${data.version} · ${data.node}`;
    $('#healthBadge').className = 'badge badge-ok';
    if (!data.ai.enabled) $('#optAI').disabled = true;
  } catch (err) {
    $('#aiBadge').textContent = '서버 연결 실패';
    $('#aiBadge').className = 'badge badge-off';
  }
}

bind();
loadHealth();
