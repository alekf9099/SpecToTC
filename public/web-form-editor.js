'use strict';

/**
 * 발견된 폼 편집기 — QA 가 값을 지정해 TC 를 다시 만든다.
 *
 * 화면에는 값어치가 확실한 두 칸만 둔다.
 *   · 정상 테스트 값 — [실제로 제출해 확인] 의 유일한 입력원이고, TC 수행 단계에 그대로 들어간다
 *   · 선행 조건     — 폼당 1칸. 조건 충족/미충족 두 갈래 TC 를 만든다
 *
 * 처음에는 칸이 6개(필수·최소·최대·형식 규칙·비고·필드 추가)였는데, 입력 부담만
 * 크고 대부분 TC 를 한 건씩 늘리는 수준이었다. 특히 최대 길이는 HTML 에 이미
 * 있는 경우가 많고(naver 검색창 255 자동 인식), 필드 추가는 브라우저 렌더링
 * 분석이 생기면서 대부분 필요 없어졌다.
 *
 * 서버(applyOverrides)는 지운 칸들을 여전히 처리한다 — API 로는 쓸 수 있다.
 * 화면에서만 뺐다.
 *
 * 재생성은 /api/web-testcases 를 쓴다 — 페이지를 다시 가져오지 않으므로
 * 조건을 고쳐가며 여러 번 눌러도 네트워크·레이트리밋을 소모하지 않는다.
 */

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

/** 필드 한 줄 — 이름과 "정상 테스트 값" 한 칸 */
function fieldRow(fi, xi, field) {
  const observed = observedSummary(field);

  return `<label class="wf-field" data-form="${fi}" data-field="${xi}">
      <span class="wf-field-name">
        ${esc(field.label)}
        <em>${esc(field.type)}${observed.startsWith('페이지 관측') ? ` · ${esc(observed.replace('페이지 관측: ', ''))}` : ''}</em>
      </span>
      <input class="input" type="text" data-k="testValue" value="${esc(field.testValue || '')}"
             placeholder="이 값으로 테스트 (예: 자동차)" />
    </label>`;
}

function formEditor(form, fi) {
  const rows = form.fields.map((f, xi) => fieldRow(fi, xi, f)).join('');
  const filled = form.fields.filter((f) => f.testValue).length;

  return `<details class="wf-form" data-form="${fi}">
      <summary class="wf-head">
        <b>${esc(form.name)}</b>
        <span class="tag">${esc(form.method)}</span>
        <span class="tag">${esc(form.fields.length)}개 필드</span>
        ${filled ? `<span class="tag tag-ok">${filled}개 입력됨</span>` : ''}
        ${form.condition ? '<span class="tag tag-ok">조건 지정</span>' : ''}
        ${form.outsideForm ? '<span class="tag tag-warn">form 태그 밖</span>' : ''}
      </summary>

      <p class="wf-action mono">${esc(form.method)} ${esc(form.action)}</p>

      <label class="wf-field wf-cond">
        <span class="wf-field-name">선행 조건<em>충족·미충족 두 갈래 TC 를 만듭니다</em></span>
        <input class="input" type="text" data-cond="${fi}" value="${esc(form.condition || '')}"
               placeholder="예: 로그인한 회원만 접근 가능" />
      </label>

      ${rows || '<p class="detail-empty">읽어낸 입력 필드가 없습니다.</p>'}
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

  const specified = forms.filter((f) => f.condition || f.fields.some((x) => x.testValue)).length;

  // 전체를 접어둔다 — 값을 지정하지 않아도 TC 는 이미 만들어져 있으므로,
  // 쓸 사람만 펴는 게 맞다.
  box.innerHTML = `
    <details class="wf-root"${specified ? ' open' : ''}>
      <summary class="wf-root-head">
        <b>테스트 값 · 조건 지정</b>
        <span class="tag">폼 ${forms.length}개</span>
        ${specified ? `<span class="tag tag-ok">${specified}개 지정됨</span>` : ''}
        <em>선택 — 넣으면 그 값이 반영된 TC 를 다시 만듭니다</em>
      </summary>

      ${forms.map(formEditor).join('')}

      <div class="actions wf-actions">
        <button id="btnRegenWebTc" class="btn btn-primary">값 반영해 TC 다시 생성</button>
        <button id="btnLiveVerify" class="btn"
                title="브라우저로 실제 값을 입력·제출하고 결과를 관측합니다. 서버에서 허용한 도메인만 가능합니다.">실제로 제출해 확인</button>
        <button id="btnResetWebOverrides" class="btn btn-ghost">초기화</button>
      </div>
      <p class="sum-note wf-live-note">
        <b>값 반영해 TC 다시 생성</b> 은 문서만 만듭니다(실제 조회하지 않음).
        <b>실제로 제출해 확인</b> 은 브라우저로 정말 입력·제출해 결과를 관측하고, 기대 결과에 실측값을 넣습니다.
      </p>
    </details>`;

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
        if (el.value.trim() !== '') values[el.dataset.k] = el.value.trim();
      });
      if (Object.keys(values).length) entry.fields[xi] = values;
    });

    forms[fi] = entry;
  });

  return { forms };
}

/**
 * 화면 입력값을 state.webInventory 에 반영 (재렌더 시 유실 방지).
 *
 * 화면에 없는 키(rule·note·length 등)는 건드리지 않는다. API 로 지정한 값이
 * 화면을 거치면서 지워지면 안 된다.
 */
function mergeOverridesIntoState() {
  const overrides = collectOverrides();
  const forms = state.webInventory.interaction.forms;

  Object.entries(overrides.forms).forEach(([fi, entry]) => {
    const form = forms[Number(fi)];
    if (!form) return;
    form.condition = entry.condition || null;

    // 값을 지운 필드도 반영해야 하므로 전체 필드를 훑는다
    form.fields.forEach((field, xi) => {
      const v = entry.fields[String(xi)] || {};
      field.testValue = v.testValue || null;
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
  setStatus('지정한 값을 반영해 TC 를 다시 만드는 중…');

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
      `반영 완료 — TC ${state.testCases.length}건`,
      `테스트 값 ${a.fields}개 · 선행 조건 ${a.conditions}개`,
      a.fields + a.conditions === 0
        ? '아직 지정한 값이 없어 페이지 관측값만으로 만들었습니다.'
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
    setStatus(`실제 제출을 할 수 없습니다 — ${blocked}\n대신 [값 반영해 TC 다시 생성] 으로 문서 TC 를 만들 수 있습니다.`, 'error');
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
