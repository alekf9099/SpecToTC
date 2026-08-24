'use strict';

/**
 * 실행 관측 결과 → 테스트케이스.
 *
 * 정적 분석 TC 의 기대 결과는 "그렇게 되어야 한다" 는 **추정**이다.
 * 여기서 만드는 TC 는 실제로 제출해 보고 관측한 것이므로 기대 결과에
 * **측정한 값**을 적는다. 다음 회귀 테스트의 기준선이 된다.
 *
 * 중요 — 관측은 "명세대로인지" 를 말해주지 않는다. 기획서 없이는 지금 동작이
 * 옳은지 알 수 없으므로, 관측값은 `현재 동작(기준선)` 으로만 적고
 * 옳은지는 QA 가 판단하도록 남긴다. 이 구분을 문구에서 흐리면 안 된다.
 */

const { step, truncate } = require('../engine/generator');

const TYPE_TAG = { Pass: '정상', Fail: '실패', 'Edge Case': '경계' };
const BASELINE = '현재 동작(기준선)';

/** 관측한 결과 신호를 한 줄로 */
function describeResults(results) {
  if (!results) return '결과 신호 없음';
  const parts = [];
  if (results.statedCounts && results.statedCounts.length) {
    parts.push(`본문 표기 ${results.statedCounts.slice(0, 3).join(' · ')}`);
  }
  if (results.largestList) parts.push(`목록 항목 ${results.largestList}개`);
  if (results.looksEmpty) parts.push('"결과 없음" 문구 노출');
  if (!parts.length) parts.push(`본문 ${results.bodyTextLength}자`);
  return parts.join(', ');
}

/** 관측 한 건을 사람이 검토할 수 있는 근거 문구로 */
function evidenceFor(run) {
  const parts = [
    `실행 관측 · ${run.form.method} ${run.form.action}`,
    run.submitAction,
    run.navigated ? `화면 이동: ${truncate(run.after.url, 80)}` : '화면 이동 없음(같은 주소)',
  ];
  if (run.httpStatus != null) parts.push(`HTTP ${run.httpStatus}`);
  if (run.valueInUrl && run.valueInUrl.length) parts.push(`입력값이 주소에 반영: ${run.valueInUrl.join(', ')}`);
  return parts.join(' · ');
}

/** 관측한 것을 기대 결과 목록으로 — 측정값과 판단 필요 사항을 분리한다 */
function expectedFrom(run) {
  const out = [];

  out.push(run.navigated
    ? `${BASELINE}: ${truncate(run.after.url, 90)} 로 이동`
    : `${BASELINE}: 주소가 바뀌지 않음 (JS 처리 또는 제출 차단)`);

  if (run.httpStatus != null) out.push(`${BASELINE}: HTTP ${run.httpStatus}`);
  if (run.after.title) out.push(`${BASELINE}: 화면 제목 "${truncate(run.after.title, 60)}"`);
  out.push(`${BASELINE}: ${describeResults(run.after.results)}`);

  if (run.valueInUrl && run.valueInUrl.length) {
    out.push(`입력값이 조회 조건으로 전달됨 (${run.valueInUrl.join(', ')} — 주소에 포함)`);
  }

  if (run.after.messages && run.after.messages.length) {
    out.push(`화면 안내 문구: ${run.after.messages.slice(0, 3).map((m) => `"${truncate(m, 50)}"`).join(', ')}`);
  }

  if (run.validityBeforeSubmit && run.validityBeforeSubmit.length) {
    out.push(`브라우저 기본 검증이 차단: ${run.validityBeforeSubmit
      .map((v) => `${v.name}${v.message ? ` ("${truncate(v.message, 40)}")` : ''}`).join(', ')}`);
  }

  if (run.consoleErrors.length) out.push(`⚠ 콘솔 오류 ${run.consoleErrors.length}건 — ${truncate(run.consoleErrors[0], 70)}`);
  if (run.pageErrors.length) out.push(`⚠ 스크립트 예외 ${run.pageErrors.length}건 — ${truncate(run.pageErrors[0], 70)}`);
  if (run.dialogs.length) out.push(`⚠ 대화상자 노출: ${run.dialogs.map((d) => `${d.type} "${truncate(d.message, 40)}"`).join(', ')}`);

  out.push('※ 위는 관측값입니다. 이 동작이 기획 의도와 맞는지는 QA 가 판단하세요.');
  return out;
}

/** 실행 결과가 성공적으로 조회/제출된 것으로 보이는지 (유형 판정용) */
function looksHandled(run) {
  if (run.validityBeforeSubmit && run.validityBeforeSubmit.length) return false;
  if (run.pageErrors.length) return false;
  if (run.httpStatus != null && run.httpStatus >= 400) return false;
  return run.navigated
    || (run.valueInUrl && run.valueInUrl.length > 0)
    || (run.after.results && (run.after.results.largestList > 0 || run.after.results.statedCounts.length > 0));
}

/**
 * 관측 목록 → TC 목록.
 *
 * @param {object} inventory 대상 인벤토리 (호스트·사전 조건용)
 * @param {Array<object>} runs runFormCase 결과들
 * @param {number} startIndex 기존 TC 개수 (ID 충돌 방지)
 */
function buildLiveTestCases(inventory, runs, startIndex = 0) {
  const counters = { P: startIndex, F: startIndex, E: startIndex };
  const out = [];
  const host = (() => {
    try { return new URL(inventory.page.url).hostname; } catch { return inventory.page.url; }
  })();

  const emit = (type, area, tc) => {
    const code = type === 'Pass' ? 'P' : type === 'Fail' ? 'F' : 'E';
    counters[code] += 1;
    const title = `[${TYPE_TAG[type]}] ${area} — ${tc.title}`;
    out.push({
      tc_id: `TC-L${code}-${String(counters[code]).padStart(3, '0')}`,
      type,
      priority: tc.priority || 'Med',
      area,
      title,
      objective: tc.objective,
      precondition: tc.precondition,
      steps: tc.steps,
      expected: tc.expected,
      requirement: {
        id: 'LIVE',
        text: tc.evidence,
        line: null,
        categories: tc.categories || ['실행 검증'],
      },
      tags: (tc.tags || []).concat(['web', 'live']),
      origin: 'live',

      // 하위 호환 필드 (CSV·기존 스크립트용)
      scenario: title,
      requirement_id: 'LIVE',
      source_text: tc.evidence,
      source_line: null,
      categories: tc.categories || ['실행 검증'],
    });
  };

  runs.filter(Boolean).forEach((run) => {
    const area = run.form.name || '폼';
    const handled = looksHandled(run);

    const inputSteps = run.filled.length
      ? run.filled.map((f) => step('입력', `${f.label} = ${f.value}`))
      : [step('입력', '입력 없이 진행')];

    emit(handled ? 'Pass' : 'Fail', area, {
      title: `${run.label} — 실제 제출 결과 확인`,
      objective: '지정한 값으로 실제 제출했을 때의 동작을 브라우저에서 관측해 기준선으로 남긴다.',
      precondition: [
        `${host} 접속 가능`,
        `대상 폼: ${run.form.method} ${run.form.action}`,
        '헤드리스 브라우저로 실제 제출 (관측 시점 기준)',
      ],
      steps: [
        step('진입', run.before.url),
        ...inputSteps,
        step('실행', run.submitAction),
        step('확인', '이동한 주소 · 결과 건수 · 화면 안내 문구 · 콘솔 오류'),
      ],
      expected: expectedFrom(run),
      evidence: evidenceFor(run),
      priority: run.pageErrors.length || (run.httpStatus != null && run.httpStatus >= 500) ? 'High' : 'Med',
      categories: ['실행 검증', run.form.method === 'GET' ? '조회' : '제출'],
      tags: ['live-run', handled ? 'observed-ok' : 'observed-problem'],
    });

    // 넣지 못한 값이 있으면 자동화로는 확인 못 한 것이므로 수동 확인 TC 로 남긴다
    if (run.skipped.length) {
      emit('Edge Case', area, {
        title: `자동 입력하지 못한 필드 수동 확인 (${run.skipped.length}개)`,
        objective: '자동화가 값을 넣지 못한 필드는 사람이 직접 확인해야 한다.',
        precondition: [`${host} 접속 가능`],
        steps: run.skipped.slice(0, 6).map((s) => step('확인', `${s.label || `필드 ${s.index}`} — ${s.reason}`)),
        expected: [
          '해당 필드를 수동으로 입력해 정상 동작을 확인',
          '자동화 대상에서 제외된 이유가 타당한지 점검 (파일 업로드·캡차 등)',
        ],
        evidence: `실행 관측 · 자동 입력 실패: ${run.skipped.map((s) => `${s.label || s.index}(${truncate(s.reason, 40)})`).join(' / ')}`,
        priority: 'Low',
        categories: ['실행 검증', '수동 확인'],
        tags: ['live-run', 'manual-check'],
      });
    }

    // 콘솔 오류·스크립트 예외는 그 자체로 결함 후보다
    if (run.consoleErrors.length || run.pageErrors.length) {
      emit('Fail', area, {
        title: `제출 과정에서 발생한 스크립트 오류 (${run.consoleErrors.length + run.pageErrors.length}건)`,
        objective: '제출 흐름에서 콘솔 오류나 스크립트 예외가 발생하지 않아야 한다.',
        precondition: [`${host} 접속 가능`, '개발자 도구 콘솔 열어둔 상태'],
        steps: [
          step('진입', run.before.url),
          step('실행', `${run.label} 과 같은 값으로 제출`),
          step('확인', '콘솔 탭의 오류 메시지'),
        ],
        expected: [
          '콘솔 오류 없음',
          `관측된 오류 — ${[...run.pageErrors, ...run.consoleErrors].slice(0, 3).map((e) => `"${truncate(e, 70)}"`).join(', ')}`,
        ],
        evidence: `실행 관측 · 콘솔 오류 ${run.consoleErrors.length}건 · 스크립트 예외 ${run.pageErrors.length}건`,
        priority: run.pageErrors.length ? 'High' : 'Med',
        categories: ['실행 검증', '오류'],
        tags: ['live-run', 'console-error'],
      });
    }
  });

  return out;
}

module.exports = { buildLiveTestCases, describeResults, looksHandled, expectedFrom, BASELINE };
