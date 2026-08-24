'use strict';

/**
 * 발견된 폼 편집기 — QA 가 조건을 직접 지정해 TC 를 다시 만든다.
 *
 * 왜 필요한가
 *   페이지 HTML 은 "무엇이 있는지" 만 알려준다. 실제 규칙(최대 길이, 필수 여부,
 *   사내 형식 규칙, 선행 조건)은 대부분 HTML 에 없고 QA 가 알고 있다.
 *   그 조건을 넣으면 문서 기반 엔진과 같은 수준의 경계값·조건 분기 TC 가 나온다.
 *   JS 로 그려져 잡히지 않은 필드는 직접 추가할 수 있다.
 *
 * 재생성은 /api/web-testcases 를 쓴다 — 페이지를 다시 가져오지 않으므로
 * 조건을 고쳐가며 여러 번 눌러도 네트워크·레이트리밋을 소모하지 않는다.
 */

const WEB_FIELD_TYPES = [
  'text', 'email', 'password', 'tel', 'url', 'number', 'search', 'date',
  'file', 'checkbox', 'radio', 'textarea', 'select',
];

/** 편집기에 들어갈 한 필드의 행 */
function fieldRow(fi, xi, field) {
  const c = field.constraints || {};
  const id = `f-${fi}-${xi}`;
  const added = field.source === 'user-added';

  return `<tr data-form="${fi}" data-field="${xi}"${added ? ' class="wf-added"' : ''}>
      <td class="wf-name">
        <b>${esc(field.label)}</b>
        <span class="tag">${esc(field.type)}</span>
        ${added ? '<span class="tag tag-num">추가</span>' : ''}
        ${field.name ? `<span class="mono">${esc(field.name)}</span>` : ''}
      </td>
      <td class="wf-req">
        <label class="wf-check">
          <input type="checkbox" data-k="required" id="${id}-req"${c.required ? ' checked' : ''} />
          <span>필수</span>
        </label>
      </td>
      <td><input class="input wf-num" type="number" min="0" data-k="minLength"
                 value="${c.minLength != null ? esc(c.minLength) : ''}" placeholder="최소" /></td>
      <td><input class="input wf-num" type="number" min="0" data-k="maxLength"
                 value="${c.maxLength != null ? esc(c.maxLength) : ''}" placeholder="최대" /></td>
      <td><input class="input" type="text" data-k="rule" value="${esc(field.rule || '')}"
                 placeholder="예: 사내 도메인만 허용" /></td>
      <td><input class="input" type="text" data-k="testValue" value="${esc(field.testValue || '')}"
                 placeholder="예: qa@muhayu.com" /></td>
      <td><input class="input" type="text" data-k="note" value="${esc(field.note || '')}"
                 placeholder="예: 쿠폰 있을 때만 활성" /></td>
    </tr>`;
}

function formEditor(form, fi) {
  const rows = form.fields.map((f, xi) => fieldRow(fi, xi, f)).join('');

  return `<section class="wf-form" data-form="${fi}">
      <div class="wf-head">
        <b>${esc(form.name)}</b>
        <span class="mono">${esc(form.method)} ${esc(form.action)}</span>
        <span class="tag">${esc(form.fields.length)}개 필드</span>
        ${form.outsideForm ? '<span class="tag tag-warn">form 태그 밖</span>' : ''}
      </div>

      <label class="field-label" for="cond-${fi}">이 폼의 선행 조건 (있으면 조건 충족·미충족 TC 를 함께 만듭니다)</label>
      <input class="input input-block" type="text" id="cond-${fi}" data-cond="${fi}"
             value="${esc(form.condition || '')}" placeholder="예: 로그인한 회원만 접근 가능 / 장바구니에 상품이 1개 이상" />

      <div class="sum-table-wrap">
        <table class="sum-table wf-table">
          <thead>
            <tr>
              <th>필드</th><th>필수</th><th>최소</th><th>최대</th>
              <th>형식 규칙</th><th>정상 테스트 값</th><th>조건·비고</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="7" class="detail-empty">필드가 없습니다. 아래에서 직접 추가하세요.</td></tr>'}</tbody>
        </table>
      </div>

      <div class="wf-add" data-add="${fi}">
        <input class="input" type="text" data-k="label" placeholder="추가할 필드 이름 (예: 쿠폰 코드)" />
        <select class="select" data-k="type">
          ${WEB_FIELD_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-sm" data-add-btn="${fi}">필드 추가</button>
      </div>
    </section>`;
}

/** 편집기를 그린다. 분석 결과가 없으면 아무것도 하지 않는다. */
function renderFormEditor() {
  const box = $('#webEditor');
  if (!box) return;

  const inv = state.webInventory;
  const forms = inv && inv.interaction && inv.interaction.forms;
  if (!forms || !forms.length) {
    box.innerHTML = '';
    return;
  }

  box.innerHTML = `
    <div class="wf-intro">
      <label class="field-label">발견된 폼에 조건 지정 → TC 다시 생성</label>
      <p class="sum-note">
        페이지 HTML 에 없는 실제 규칙(최대 길이 · 필수 여부 · 사내 형식 규칙 · 선행 조건)을 여기에 넣으면
        그 조건이 반영된 경계값·조건 분기 TC 가 만들어집니다. 잡히지 않은 필드는 직접 추가할 수 있습니다.
      </p>
    </div>
    ${forms.map(formEditor).join('')}
    <div class="actions wf-actions">
      <button id="btnRegenWebTc" class="btn btn-primary">조건 반영해 TC 다시 생성</button>
      <button id="btnLiveVerify" class="btn"
              title="브라우저로 실제 값을 입력·제출하고 결과를 관측합니다. 서버에서 허용한 도메인만 가능합니다.">실제로 제출해 확인</button>
      <button id="btnResetWebOverrides" class="btn btn-ghost">지정한 조건 초기화</button>
    </div>
    <p class="sum-note wf-live-note">
      <b>조건 반영해 TC 다시 생성</b> 은 문서만 만듭니다(실제 조회하지 않음).
      <b>실제로 제출해 확인</b> 은 브라우저로 정말 입력·제출해 결과를 관측하고, 기대 결과에 실측값을 넣습니다.
    </p>`;

  box.querySelectorAll('[data-add-btn]').forEach((btn) => {
    btn.addEventListener('click', () => addFieldRow(Number(btn.dataset.addBtn)));
  });
  $('#btnRegenWebTc').addEventListener('click', regenerateWebTestCases);
  $('#btnLiveVerify').addEventListener('click', liveVerify);
  $('#btnResetWebOverrides').addEventListener('click', resetWebOverrides);
}

/** 화면에서 QA 가 입력한 값을 오버라이드 객체로 모은다 */
function collectOverrides() {
  const forms = {};
  const box = $('#webEditor');
  if (!box) return { forms };

  box.querySelectorAll('.wf-form').forEach((section) => {
    const fi = section.dataset.form;
    const entry = { fields: {} };

    const cond = section.querySelector(`[data-cond="${fi}"]`);
    if (cond && cond.value.trim()) entry.condition = cond.value.trim();

    section.querySelectorAll('tbody tr[data-field]').forEach((tr) => {
      const xi = tr.dataset.field;
      const values = {};
      tr.querySelectorAll('[data-k]').forEach((el) => {
        const key = el.dataset.k;
        if (el.type === 'checkbox') values[key] = el.checked;
        else if (el.value.trim() !== '') values[key] = el.value.trim();
      });
      // 체크가 꺼진 required 는 "지정 안 함"과 구분해야 하므로 그대로 보낸다.
      if (Object.keys(values).length) entry.fields[xi] = values;
    });

    forms[fi] = entry;
  });

  return { forms };
}

/** 페이지에서 잡히지 않은 필드를 인벤토리에 직접 추가 */
function addFieldRow(fi) {
  const wrap = $(`[data-add="${fi}"]`);
  const label = wrap.querySelector('[data-k="label"]').value.trim();
  const type = wrap.querySelector('[data-k="type"]').value;

  if (!label) {
    setStatus('추가할 필드 이름을 입력하세요.', 'error');
    return;
  }

  // 현재 화면의 지정값을 먼저 인벤토리에 반영한 뒤 필드를 붙인다 (입력 유실 방지)
  mergeOverridesIntoState();

  const form = state.webInventory.interaction.forms[fi];
  form.fields.push({
    tag: type === 'textarea' || type === 'select' ? type : 'input',
    type,
    name: null,
    label,
    placeholder: null,
    constraints: {},
    rule: null,
    testValue: null,
    note: null,
    source: 'user-added',
  });

  renderFormEditor();
  setStatus(`"${label}" 필드를 추가했습니다. 조건을 채운 뒤 [조건 반영해 TC 다시 생성] 을 누르세요.`, 'ok');
}

/** 화면 입력값을 state.webInventory 에 반영 (재렌더 시 유실 방지) */
function mergeOverridesIntoState() {
  const overrides = collectOverrides();
  const forms = state.webInventory.interaction.forms;

  Object.entries(overrides.forms).forEach(([fi, entry]) => {
    const form = forms[Number(fi)];
    if (!form) return;
    form.condition = entry.condition || null;

    Object.entries(entry.fields || {}).forEach(([xi, v]) => {
      const field = form.fields[Number(xi)];
      if (!field) return;
      field.constraints = { ...field.constraints };
      if (v.required !== undefined) {
        if (v.required) field.constraints.required = true;
        else delete field.constraints.required;
      }
      if (v.maxLength !== undefined) field.constraints.maxLength = v.maxLength;
      if (v.minLength !== undefined) field.constraints.minLength = v.minLength;
      field.rule = v.rule || null;
      field.testValue = v.testValue || null;
      field.note = v.note || null;
    });
  });
}

async function regenerateWebTestCases() {
  if (!state.webInventory) {
    setStatus('먼저 웹사이트를 분석해 주세요.', 'error');
    return;
  }

  const btn = $('#btnRegenWebTc');
  btn.disabled = true;
  setStatus('지정한 조건을 반영해 TC 를 다시 만드는 중…');

  try {
    const overrides = collectOverrides();
    const data = await api('/api/web-testcases', { inventory: state.webInventory, overrides });

    state.webInventory = data.inventory;
    state.testCases = data.testCases || [];
    state.specSummary = data.specSummary || null;
    state.aiSummary = null;
    state.expanded.clear();

    renderSummary(data);
    renderTable();
    renderSpecSummary();
    renderFormEditor();
    setView('tc');

    const a = data.applied;
    setStatus([
      `조건 반영 완료 — TC ${state.testCases.length}건`,
      `지정한 조건: 필드 ${a.fields}개 · 추가한 필드 ${a.added}개 · 선행 조건 ${a.conditions}개`,
      a.fields + a.added + a.conditions === 0
        ? '아직 지정한 조건이 없어 페이지 관측값만으로 만들었습니다.'
        : 'QA 지정 항목은 TC 근거란에 "QA 지정" 으로 표기됩니다.',
    ].join('\n'), 'ok');
  } catch (err) {
    setStatus(`재생성 실패: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

/**
 * 브라우저로 실제 입력·제출하고 결과를 관측한다.
 *
 * 재생성(문서 생성)과 달리 이건 대상 사이트에 실제 요청을 보낸다.
 * 그래서 서버가 허용한 도메인에서만 되고, 실패 이유를 그대로 보여준다.
 */
async function liveVerify() {
  const url = state.webUrl || $('#siteUrl').value.trim();
  if (!url) {
    setStatus('검증할 주소가 없습니다. 먼저 웹사이트를 분석해 주세요.', 'error');
    return;
  }

  // 어떤 폼을 실행할지 — 테스트 값이 채워진 첫 폼
  mergeOverridesIntoState();
  const forms = state.webInventory.interaction.forms;
  const formIndex = forms.findIndex((f) => f.fields.some((x) => x.testValue));
  if (formIndex < 0) {
    setStatus('실행할 값이 없습니다. [정상 테스트 값] 칸에 실제로 입력할 값을 적어주세요. (예: 검색어 = 자동차)', 'error');
    return;
  }

  const form = forms[formIndex];
  const values = form.fields.filter((f) => f.testValue).map((f) => `${f.label}=${f.testValue}`).join(', ');
  if (!confirm(`대상 사이트에 실제로 값을 입력하고 제출합니다.\n\n주소: ${url}\n폼: ${form.name} (${form.method})\n입력: ${values}\n\n진행할까요?`)) return;

  const btn = $('#btnLiveVerify');
  btn.disabled = true;
  setStatus(`브라우저로 실제 제출하는 중… (${form.name})`);

  try {
    const data = await api('/api/live-verify', {
      url, inventory: state.webInventory, overrides: collectOverrides(), formIndex,
    });

    const run = data.run;
    // 관측 TC 는 기존 TC 뒤에 붙인다 — 정적 분석 결과를 지우면 안 된다
    state.testCases = state.testCases.concat(data.testCases || []);
    state.expanded.clear();
    renderSummary({ summary: summarizeLocal(state.testCases), areas: [] });
    renderTable();
    setView('tc');

    setStatus([
      `실행 검증 완료 — 관측 TC ${(data.testCases || []).length}건 추가 (${data.elapsedMs}ms)`,
      `입력: ${run.filled.map((f) => `${f.label}=${f.value}`).join(', ') || '없음'}`,
      `${run.submitAction} → ${run.navigated ? `이동: ${run.after.url}` : '주소 변경 없음'}${run.httpStatus != null ? ` (HTTP ${run.httpStatus})` : ''}`,
      run.valueInUrl.length ? `✔ 입력값이 조회 조건으로 전달됨 (${run.valueInUrl.join(', ')})` : '',
      run.after.results.statedCounts.length ? `결과 표기: ${run.after.results.statedCounts.join(' · ')}` : '',
      run.after.results.largestList ? `목록 항목 ${run.after.results.largestList}개 관측` : '',
      run.skipped.length ? `⚠ 자동 입력 못 한 필드 ${run.skipped.length}개 — 수동 확인 TC 로 추가됨` : '',
      run.pageErrors.length || run.consoleErrors.length
        ? `⚠ 스크립트 오류 ${run.pageErrors.length + run.consoleErrors.length}건 관측`
        : '',
      '※ 관측값은 현재 동작(기준선)입니다. 기획 의도와 맞는지는 QA 가 판단하세요.',
    ].filter(Boolean).join('\n'), 'ok');
  } catch (err) {
    setStatus(`실행 검증 실패: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

/** TC 배열을 요약 통계로 (서버 왕복 없이 표 상단 숫자를 갱신하기 위해) */
function summarizeLocal(list) {
  const byType = {};
  const byPriority = {};
  list.forEach((tc) => {
    byType[tc.type] = (byType[tc.type] || 0) + 1;
    byPriority[tc.priority] = (byPriority[tc.priority] || 0) + 1;
  });
  return { total: list.length, byType, byPriority };
}

/** 페이지에서 처음 관측한 상태로 되돌린다 */
function resetWebOverrides() {
  if (!state.webInventoryOriginal) {
    setStatus('되돌릴 원본 분석 결과가 없습니다.', 'error');
    return;
  }
  state.webInventory = JSON.parse(JSON.stringify(state.webInventoryOriginal));
  renderFormEditor();
  setStatus('지정한 조건을 모두 지웠습니다. 페이지 관측값으로 되돌렸습니다.', 'ok');
}
