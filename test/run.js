'use strict';

/**
 * 의존성 없는 미니 테스트 러너.  실행: npm test
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseDocument, extractConstraints, splitConditionAction, extractRetryCount } = require('../src/engine/parser');
const { generateFromSpec } = require('../src/engine');
const { toCsv } = require('../src/csv');
const { diffSpecs } = require('../src/diff');
const { createApp } = require('../src/app');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ------------------------------------------------------------- parser */

test('경계값 표현을 파싱한다 (한글)', () => {
  const c = extractConstraints('비밀번호는 8자 이상 20자 이하로 입력해야 한다.');
  assert.ok(c.some((x) => x.value === 8 && x.op === '>=' && x.unit === '글자'), '8자 이상');
  assert.ok(c.some((x) => x.value === 20 && x.op === '<='), '20자 이하');
});

test('경계값 표현을 파싱한다 (영문)', () => {
  const c = extractConstraints('Users can upload up to 5 files, each no more than 10 MB.');
  assert.ok(c.some((x) => x.value === 5 && x.op === '<='), 'up to 5');
  assert.ok(c.some((x) => x.value === 10 && x.op === '<='), 'no more than 10');
});

test('최대/최소 선행 표현을 파싱한다', () => {
  const c = extractConstraints('닉네임은 최대 12자까지 허용한다.');
  assert.ok(c.some((x) => x.value === 12 && x.op === '<='));
});

test('조건절/동작절을 분리한다', () => {
  const ko = splitConditionAction('결제 승인이 실패하면 주문을 확정하지 않는다.');
  assert.equal(ko.condition, '결제 승인이 실패');
  assert.ok(ko.action.includes('주문을 확정하지 않는다'));

  const en = splitConditionAction('If the user disables push notifications, the app must not send any push message.');
  assert.ok(en.condition && /disables push/.test(en.condition));
  assert.ok(/must not send/.test(en.action));
});

test('재시도 횟수를 추출한다', () => {
  assert.equal(extractRetryCount('최대 2회 재시도한다.'), 2);
  assert.equal(extractRetryCount('retry up to 3 times with backoff'), 3);
});

test('마크다운 제목을 요구사항 영역으로 인식한다', () => {
  const parsed = parseDocument('# 회원\n## 1. 로그인\n- 로그인 성공 시 홈으로 이동한다.\n');
  assert.equal(parsed.requirements.length, 1);
  assert.equal(parsed.requirements[0].area, '1. 로그인');
});

test('서술문만 있는 문서는 요구사항을 만들지 않는다', () => {
  const parsed = parseDocument('이 문서는 회원 서비스의 개요를 설명합니다\n작성자 홍길동\n');
  assert.equal(parsed.requirements.length, 0);
});

/* ---------------------------------------------------------- generator */

const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'samples', 'sample-srs.md'), 'utf8');

test('샘플 기획서에서 Pass/Fail/Edge 3종을 모두 생성한다', () => {
  const { testCases, summary } = generateFromSpec(SAMPLE);
  assert.ok(testCases.length > 30, `TC 가 너무 적음: ${testCases.length}`);
  assert.ok(summary.byType.Pass > 0, 'Pass 없음');
  assert.ok(summary.byType.Fail > 0, 'Fail 없음');
  assert.ok(summary.byType['Edge Case'] > 0, 'Edge 없음');
});

test('모든 TC 가 필수 필드를 가진다', () => {
  const { testCases } = generateFromSpec(SAMPLE);
  for (const tc of testCases) {
    assert.match(tc.tc_id, /^TC-[PFE]-\d{3}$/, `TC_ID 형식 오류: ${tc.tc_id}`);
    assert.ok(tc.area && tc.scenario && tc.precondition && tc.expected, `빈 필드: ${tc.tc_id}`);
    assert.ok(Array.isArray(tc.steps) && tc.steps.length > 0, `steps 없음: ${tc.tc_id}`);
    assert.ok(['High', 'Med', 'Low'].includes(tc.priority), `중요도 오류: ${tc.priority}`);
  }
});

test('TC_ID 는 중복되지 않는다', () => {
  const { testCases } = generateFromSpec(SAMPLE);
  assert.equal(new Set(testCases.map((t) => t.tc_id)).size, testCases.length);
});

test('유형 필터 옵션이 반영된다', () => {
  const { testCases } = generateFromSpec(SAMPLE, { includeFail: false, includeEdge: false });
  assert.ok(testCases.length > 0);
  assert.ok(testCases.every((tc) => tc.type === 'Pass'));
});

test('경계값 TC 는 경계 ±1 지점을 포함한다', () => {
  const { testCases } = generateFromSpec('- 비밀번호는 8자 이상으로 입력해야 한다.');
  const edge = testCases.find((tc) => tc.type === 'Edge Case' && tc.tags.includes('boundary'));
  assert.ok(edge, '경계값 TC 없음');
  const joined = edge.steps.join(' ') + edge.expected;
  assert.ok(joined.includes('7글자') && joined.includes('8글자') && joined.includes('9글자'), joined);
});

test('결제/인증 요구사항은 High 로 분류된다', () => {
  const { testCases } = generateFromSpec('- 결제 승인이 실패하면 주문을 확정하지 않고 실패 사유를 안내한다.');
  assert.ok(testCases.some((tc) => tc.priority === 'High'));
});

/* ---------------------------------------------------------------- csv */

test('CSV 는 BOM/헤더/이스케이프를 포함한다', () => {
  const { testCases } = generateFromSpec(SAMPLE);
  const csv = toCsv(testCases);
  assert.ok(csv.startsWith('﻿'), 'BOM 없음');
  assert.ok(csv.includes('TC_ID'), '헤더 없음');
  assert.ok(csv.includes('"'), '따옴표 이스케이프 없음');
  assert.equal(csv.split('\r\n').filter(Boolean).length, testCases.length + 1);
});

test('CSV 셀에 수식 인젝션이 들어가지 않는다', () => {
  const csv = toCsv([{ tc_id: '=cmd|calc', area: 'a', type: 'Pass', scenario: 's', precondition: 'p', steps: ['x'], expected: 'e', priority: 'Low' }]);
  assert.ok(csv.includes("'=cmd|calc"), csv);
});

/* --------------------------------------------------------------- diff */

test('추가/수정/삭제된 요구사항을 구분한다', () => {
  const before = '## 로그인\n- 비밀번호는 8자 이상으로 입력해야 한다.\n- 로그인 실패 시 안내 문구를 노출한다.\n';
  const after = '## 로그인\n- 비밀번호는 10자 이상으로 입력해야 한다.\n- 신규 기기에서는 추가 인증을 요구한다.\n';
  const d = diffSpecs(before, after);

  assert.equal(d.summary.modified, 1, JSON.stringify(d.modified));
  assert.equal(d.summary.added, 1);
  assert.equal(d.summary.removed, 1);
  assert.ok(d.modified[0].changes.join(' ').includes('경계값'));
  assert.ok(d.regressionTestCases.length > 0);
  assert.ok(d.regressionTestCases.every((tc) => tc.tags.includes('regression')));
});

test('동일 문서 비교 시 변경이 없다', () => {
  const d = diffSpecs(SAMPLE, SAMPLE);
  assert.equal(d.summary.added, 0);
  assert.equal(d.summary.removed, 0);
  assert.equal(d.summary.modified, 0);
});

/* ---------------------------------------------------------------- HTTP */

function withServer(fn) {
  return new Promise((resolve, reject) => {
    const server = createApp().listen(0, async () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        await fn(base);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

const post = (base, path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /api/health', () => withServer(async (base) => {
  const data = await (await fetch(`${base}/api/health`)).json();
  assert.equal(data.ok, true);
  assert.equal(data.service, 'SpecToTC');
}));

test('POST /api/generate-tc', () => withServer(async (base) => {
  const res = await post(base, '/api/generate-tc', { specText: SAMPLE });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.ok(data.testCases.length > 30);
  assert.ok(data.summary.byType.Fail > 0);
  assert.equal(data.ai.enabled, false);
}));

test('POST /api/generate-tc — 빈 입력은 400', () => withServer(async (base) => {
  const res = await post(base, '/api/generate-tc', { specText: '   ' });
  assert.equal(res.status, 400);
}));

test('POST /api/export-csv — specText 만으로도 CSV 반환', () => withServer(async (base) => {
  const res = await post(base, '/api/export-csv', { specText: SAMPLE });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  const text = await res.text();
  assert.ok(text.includes('TC_ID'));
}));

test('POST /api/diff-check', () => withServer(async (base) => {
  const res = await post(base, '/api/diff-check', {
    oldText: '- 비밀번호는 8자 이상이다.',
    newText: '- 비밀번호는 12자 이상이다.',
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.summary.modified, 1);
}));

test('없는 API 경로는 404 JSON', () => withServer(async (base) => {
  const res = await post(base, '/api/nope', {});
  assert.equal(res.status, 404);
  assert.equal((await res.json()).ok, false);
}));

/* -------------------------------------------------------------- runner */

(async () => {
  let pass = 0;
  const failures = [];

  for (const t of tests) {
    try {
      await t.fn();
      pass += 1;
      console.log(`  ✓ ${t.name}`);
    } catch (err) {
      failures.push({ name: t.name, err });
      console.log(`  ✗ ${t.name}\n      ${err.message.split('\n')[0]}`);
    }
  }

  console.log(`\n  ${pass}/${tests.length} passed`);
  if (failures.length) {
    console.log('\n실패 상세:');
    failures.forEach((f) => console.log(`\n[${f.name}]\n${f.err.stack}`));
    process.exit(1);
  }
})();
