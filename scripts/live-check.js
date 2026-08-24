'use strict';

/**
 * 실행 검증 수동 확인 스크립트.
 *
 * 대상 사이트에 **실제로 값을 입력하고 제출**하므로, 자동 테스트(npm test)에 넣지 않고
 * 사람이 의도적으로 실행하게 분리했다. 게이트 환경 변수를 직접 지정해야 동작한다.
 *
 *   SPECTOTC_BROWSER=1 \
 *   SPECTOTC_LIVE_SUBMIT=1 \
 *   SPECTOTC_LIVE_ALLOW_HOSTS=naver.com \
 *   node scripts/live-check.js https://www.naver.com 자동차
 *
 * 인자: [주소] [입력값] (기본: https://www.naver.com / 자동차)
 */

const { renderInventory, runFormCase } = require('../src/web/liveRun');
const { buildLiveTestCases } = require('../src/web/liveTestCases');

const url = process.argv[2] || 'https://www.naver.com';
const value = process.argv[3] || '자동차';

(async () => {
  console.log(`[1/2] 브라우저로 화면 분석 — ${url}`);
  const live = await renderInventory(url);
  const inv = live.inventory;
  console.log(`      폼 ${inv.interaction.forms.length}개 · 링크 ${inv.links.internalCount + inv.links.externalCount}개`
    + ` · 버튼 ${inv.interaction.buttonCount}개 · 콘솔 오류 ${live.observations.consoleErrors.length}건`);

  // 값을 넣을 폼 — 텍스트로 입력할 수 있는 첫 필드를 가진 폼
  const formIndex = inv.interaction.forms.findIndex((f) => f.fields.some(
    (x) => !['file', 'checkbox', 'radio', 'select'].includes(x.type),
  ));
  if (formIndex < 0) {
    console.log('입력할 수 있는 폼이 없습니다.');
    return;
  }

  const form = inv.interaction.forms[formIndex];
  const fieldIndex = form.fields.findIndex((x) => !['file', 'checkbox', 'radio', 'select'].includes(x.type));
  console.log(`\n[2/2] 실제 제출 — ${form.name} (${form.method} ${form.action})`);
  console.log(`      입력: ${form.fields[fieldIndex].label} = ${value}`);

  const run = await runFormCase(url, form, [{ index: fieldIndex, value }], { label: `${value} 조회` });

  console.log('');
  console.log('  제출 방식     :', run.submitAction);
  console.log('  화면 이동     :', run.navigated, run.httpStatus != null ? `(HTTP ${run.httpStatus})` : '');
  console.log('  이동 후 주소  :', run.after.url.slice(0, 140));
  console.log('  주소에 반영   :', run.valueInUrl.length ? run.valueInUrl.join(', ') : '(없음)');
  console.log('  결과 신호     :', JSON.stringify(run.after.results));
  if (run.skipped.length) console.log('  자동 입력 실패:', JSON.stringify(run.skipped));
  if (run.pageErrors.length) console.log('  스크립트 예외 :', run.pageErrors.length, '건');

  console.log('\n--- 생성된 TC ---');
  buildLiveTestCases(inv, [run]).forEach((tc) => {
    console.log(`\n${tc.tc_id}  ${tc.title}  [${tc.priority}]`);
    tc.steps.forEach((s) => console.log(`   ${s}`));
    console.log('   기대 결과:');
    tc.expected.forEach((e) => console.log(`     · ${e}`));
  });
})().catch((err) => {
  console.error('\n실패:', err.message.split('\n')[0]);
  process.exitCode = 1;
});
