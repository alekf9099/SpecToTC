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

/** 페이지에서 이미 읽어낸 제약을 한 줄로 — 뭘 덮어쓰는지 알고 입력하게 */
function observedSummary(field) {
  const c = field.constraints || {};
  const out = [];
  if (c.required) out.push('필수');
  if (c.minLength != null) out.push(`최소 ${c.minLength}`);
  if (c.maxLength != null) out.push(`최대 ${c.maxLength}`);
  if (c.pattern) out.push('패턴 있음');
  if (c.accept) out.push(`허용 ${c.accept}`);
  return out.length ? `페이지 관측: ${out.join(' · ')}` : '페이지에서 읽어낸 제약 없음';
}

/**
 * 필드 하나를 카드로 그린다.
 *
 * 표(7열)로 만들었더니 입력 패널 폭에서 각 칸이 90px 밑으로 눌리고, 헤더가
 * 가로 스크롤 밖으로 나가 무슨 칸인지 알 수 없었다. 칸마다 라벨을 붙인
 * 카드가 좁은 폭에서 훨씬 낫다.
 */
function fieldCard(fi, xi, field) {
  const c = field.constraints || {};
  const added = field.source === 'user-added';
  const num = (v) => (v != null ? esc(v) : '');

  return `<div class="wf-field${added ? ' wf-added' : ''}" data-form="${fi}" data-field="${xi}">
      <div class="wf-field-head">
        <b>${esc(field.label)}</b>
        <span class="tag">${esc(field.type)}</span>
        ${field.name ? `<span class="tag tag-mono">${esc(field.name)}</span>` : ''}
        ${added ? '<span class="tag tag-num">직접 추가</span>' : ''}
        <label class="wf-check" title="이 필드를 비우고 제출했을 때 막히는지 확인하는 TC 를 만듭니다">
          <input type="checkbox" data-k="required"${c.required ? ' checked' : ''} />
          <span>필수</span>
        </label>
      </div>
      <p class="wf-observed">${esc(observedSummary(field))}</p>

      <div class="wf-grid">
        <label class="wf-cell">
          <span>최소 길이</span>
          <input class="input" type="number" min="0" data-k="minLength" value="${num(c.minLength)}" placeholder="없음" />
        </label>
        <label class="wf-cell">
          <span>최대 길이</span>
          <input class="input" type="number" min="0" data-k="maxLength" value="${num(c.maxLength)}" placeholder="없음" />
        </label>
        <label class="wf-cell wf-cell-wide">
          <span>정상 테스트 값 <em>실제 제출에 쓰입니다</em></span>
          <input class="input" type="text" data-k="testValue" value="${esc(field.testValue || '')}"
                 placeholder="예: 자동차 / qa@muhayu.com" />
        </label>
        <label class="wf-cell wf-cell-wide">
          <span>형식 규칙 <em>HTML 에 없는 사내 규칙</em></span>
          <input class="input" type="text" data-k="rule" value="${esc(field.rule || '')}"
                 placeholder="예: 사내 도메인만 허용 / 숫자만" />
        </label>
        <label class="wf-cell wf-cell-wide">
          <span>조건 · 비고</span>
          <input class="input" type="text" data-k="note" value="${esc(field.note || '')}"
                 placeholder="예: 쿠폰이 있을 때만 활성화" />
        </label>
      </div>
    </div>`;
}

function formEditor(form, fi) {
  const cards = form.fields.map((f, xi) => fieldCard(fi, xi, f)).join('');
  const filled = form.fields.filter((f) => f.testValue || f.rule || f.note || f.constraints.required).length;

  return `<details class="wf-form" data-form="${fi}" open>
      <summary class="wf-head">
        <b>${esc(form.name)}</b>
        <span class="tag">${esc(form.method)}</span>
        <span class="tag">${esc(form.fields.length)}개 필드</span>
        ${filled ? `<span class="tag tag-ok">${filled}개 지정됨</span>` : ''}
        ${form.outsideForm ? '<span class="tag tag-warn">form 태그 밖</span>' : ''}
      </summary>

      <p class="wf-action mono">${esc(form.method)} ${esc(form.action)}</p>

      <label class="wf-cell wf-cell-wide wf-cond">
        <span>이 폼의 선행 조건 <em>넣으면 조건 충족·미충족 TC 를 함께 만듭니다</em></span>
        <input class="input" type="text" data-cond="${fi}" value="${esc(form.condition || '')}"
               placeholder="예: 로그인한 회원만 접근 가능" />
      </label>

      ${cards || '<p class="detail-empty">읽어낸 필드가 없습니다. 아래에서 직접 추가하세요.</p>'}

      <div class="wf-add" data-add="${fi}">
        <input class="input" type="text" data-k="label" placeholder="잡히지 않은 필드 이름 (예: 쿠폰 코드)" />
        <select class="select" data-k="type">
          ${WEB_FIELD_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-sm" data-add-btn="${fi}">필드 추가</button>
      </div>
    </details>`;
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

  // 편집기는 health 응답보다 늦게 그려지므로, 그릴 때마다 서버 상태를 다시 반영한다
  applyBrowserGating();
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

    section.querySelectorAll('.wf-field[data-field]').forEach((tr) => {
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
  // 서버가 못 하는 일이면 확인 창을 띄우기 전에 멈춘다.
  // 확인을 누른 뒤 실패하면 "혹시 제출된 건가?" 하는 불안이 남는다.
  const blocked = browserBlockReason('submit');
  if (blocked) {
    setStatus(`실제 제출을 할 수 없습니다 — ${blocked}\n대신 [조건 반영해 TC 다시 생성] 으로 문서 TC 를 만들 수 있습니다.`, 'error');
    return;
  }

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
  // 라벨이 placeholder 문장인 경우가 많아 "라벨=값" 은 읽기 어렵다. 줄로 나눠 값을 따옴표로 감싼다.
  const values = form.fields
    .filter((f) => f.testValue)
    .map((f) => `  · ${String(f.label).replace(/[.:]\s*$/, '')} → "${f.testValue}"`)
    .join('\n');

  const confirmed = confirm([
    '대상 사이트에 실제로 값을 입력하고 제출합니다.',
    '',
    `주소   ${url}`,
    `폼     ${form.name} (${form.method} ${form.action})`,
    '입력값',
    values,
    '',
    '진행할까요?',
  ].join('\n'));
  if (!confirmed) return;

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
