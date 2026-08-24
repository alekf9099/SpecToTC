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

test('모든 TC 가 읽기 가능한 필수 필드를 가진다', () => {
  const { testCases } = generateFromSpec(SAMPLE);
  for (const tc of testCases) {
    assert.match(tc.tc_id, /^TC-[PFE]-\d{3}$/, `TC_ID 형식 오류: ${tc.tc_id}`);
    assert.ok(tc.area && tc.title && tc.objective, `빈 필드: ${tc.tc_id}`);
    assert.match(tc.title, /^\[(정상|실패|경계)\] /, `제목에 유형 표기 없음: ${tc.title}`);
    for (const field of ['precondition', 'steps', 'expected']) {
      assert.ok(Array.isArray(tc[field]) && tc[field].length > 0, `${field} 비어 있음: ${tc.tc_id}`);
      assert.ok(tc[field].every((x) => typeof x === 'string' && x.trim()), `${field} 항목 오류: ${tc.tc_id}`);
    }
    assert.ok(tc.requirement && tc.requirement.id && tc.requirement.text, `근거 요구사항 없음: ${tc.tc_id}`);
    assert.ok(['High', 'Med', 'Low'].includes(tc.priority), `중요도 오류: ${tc.priority}`);
  }
});

test('수행 단계는 "레이블: 내용" 형식이다', () => {
  const { testCases } = generateFromSpec(SAMPLE);
  const steps = testCases.flatMap((tc) => tc.steps);
  const labeled = steps.filter((s) => /^(진입|조건 설정|입력|준비|실행|확인|상태|조작): /.test(s));
  assert.ok(labeled.length / steps.length > 0.9, `레이블 없는 단계가 많음: ${steps.length - labeled.length}/${steps.length}`);
});

test('하위 호환 필드(scenario/requirement_id)가 유지된다', () => {
  const { testCases } = generateFromSpec(SAMPLE);
  const tc = testCases[0];
  assert.equal(tc.scenario, tc.title);
  assert.equal(tc.requirement_id, tc.requirement.id);
  assert.equal(tc.source_text, tc.requirement.text);
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
  const joined = edge.steps.join(' ') + edge.expected.join(' ');
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
  assert.ok(csv.includes('TC_ID') && csv.includes('검증 목적'), '헤더 없음');
  assert.ok(csv.includes('"'), '따옴표 이스케이프 없음');
  assert.equal(csv.split('\r\n').filter(Boolean).length, testCases.length + 1);
});

test('excel:false(LF 줄바꿈)여도 BOM 은 유지된다', () => {
  const { testCases } = generateFromSpec('- 비밀번호는 8자 이상이다.');
  const csv = toCsv(testCases, { excel: false });
  assert.ok(csv.startsWith('﻿'), 'LF 모드에서 BOM 이 빠졌다 — Excel 한글 깨짐 원인');
  assert.ok(!csv.includes('\r\n'), 'LF 모드인데 CRLF 가 있다');
});

test('BOM 제거는 bom:false 로만 가능하다', () => {
  const { testCases } = generateFromSpec('- 비밀번호는 8자 이상이다.');
  assert.ok(!toCsv(testCases, { bom: false }).startsWith('﻿'));
});

test('CSV 셀에 수식 인젝션이 들어가지 않는다', () => {
  const csv = toCsv([{ tc_id: '=cmd|calc', area: 'a', type: 'Pass', scenario: 's', precondition: 'p', steps: ['x'], expected: 'e', priority: 'Low' }]);
  assert.ok(csv.includes("'=cmd|calc"), csv);
});

/* ------------------------------------------------------------- 요약 */

const { summarizeSpec } = require('../src/summary');

test('요약은 개요·핵심 요구사항·수치 기준을 추출한다', () => {
  const s = summarizeSpec(SAMPLE);
  assert.match(s.headline, /영역/);
  assert.ok(s.overview.requirements > 10);
  assert.ok(s.overview.languages.includes('ko') && s.overview.languages.includes('en'));
  assert.ok(s.keyPoints.length > 0 && s.keyPoints.length <= 8);
  assert.ok(s.keyPoints[0].score >= s.keyPoints[s.keyPoints.length - 1].score, '점수 내림차순 아님');
  assert.ok(s.byArea.length >= 4);

  const criteria = s.numericRules.map((n) => n.criterion);
  assert.ok(criteria.includes('8글자 이상'), criteria.join(' / '));
  assert.ok(criteria.includes('10 MB 이하'), '영문 단위는 띄어쓰기: ' + criteria.join(' / '));
  assert.ok(!criteria.some((c) => /자까지/.test(c)), '단위에 비교어가 섞임: ' + criteria.join(' / '));
});

test('요약은 모호 표현·누락 기준을 확인 필요 항목으로 묶는다', () => {
  const s = summarizeSpec([
    '## 알림',
    '- 발송 실패 시 재시도한다.',
    '- 목록은 적절히 정렬한다.',
    '- 응답은 빠르게 처리한다.',
  ].join('\n'));

  const types = s.risks.map((r) => r.type);
  assert.ok(types.includes('기준 누락'), '재시도 횟수 누락 미검출: ' + types.join(','));
  assert.ok(types.includes('모호 표현'), '모호 표현 미검출: ' + types.join(','));
  for (const r of s.risks) {
    assert.ok(r.count >= 1 && r.items.length === r.count, '건수 집계 오류');
    assert.ok(r.question && r.question.length > 5, '확인 질문 없음');
  }
});

test('요약 커버리지는 TC 미생성 요구사항을 알려준다', () => {
  const spec = '- 비밀번호는 8자 이상이다.';
  const { testCases, requirements } = generateFromSpec(spec);
  const s = summarizeSpec({ requirements }, { testCases });
  assert.equal(s.coverage.testCases, testCases.length);
  assert.equal(s.coverage.uncovered.length, 0);
  assert.ok(s.coverage.perRequirement > 1);
});

/* ------------------------------------------------- QA 검증 분석서 */

const qaPlanMod = require('../src/qaPlan');

const BOARD_SPEC = [
  '# 사내 공지 게시판',
  '## 목적',
  '- 사내 공지 전달 속도를 개선하기 위해 게시판을 구축한다.',
  '## 1. 게시글 목록',
  '- 목록은 /board/list 에서 한 페이지에 20건씩 표시하고 무한 스크롤로 추가 로딩한다.',
  '- 관리자 전용 관리 화면은 /admin/board 이며 관리자만 접근한다.',
  '- 디자인 시안: https://www.figma.com/file/abc123/board-ui',
  '## 2. 글 작성',
  '- 로그인한 회원만 글을 작성할 수 있다.',
  '- 제목은 최대 60자까지 입력할 수 있다.',
  '- 첨부파일은 5개까지, 각 10 MB 이하만 허용한다.',
  '- 저장 실패 시 최대 3회 재시도한다.',
  '- 저장 후 다음 단계로 이동한다.',
  '## 3. 범위',
  '- 결제 연동은 차기 버전에서 지원한다.',
  '- 댓글 알림은 미지원한다.',
].join('\n');

test('검증 분석서는 6개 고정 섹션을 모두 채운다', () => {
  const qa = summarizeSpec(BOARD_SPEC).qaPlan;
  assert.ok(qa, 'qaPlan 없음');

  // ① 참고사항 — 6개 관점이 순서대로
  assert.deepEqual(qa.checkpoints.map((g) => g.title), [
    '권한 / 역할 경계', '입력 검증', '경계조건', '예외 / 에러 처리', '데이터 정합성', '검증 환경',
  ]);
  for (const g of qa.checkpoints) {
    assert.ok(g.items.length > 0, `${g.title} 항목 없음`);
    for (const i of g.items) {
      assert.ok(i.what && i.why && i.how, `what/why/how 누락: ${g.title}`);
    }
  }

  // ① 준비 체크리스트 (해야 할 일)
  assert.ok(qa.todos.length >= 5, `준비 항목 부족: ${qa.todos.length}`);
  assert.ok(qa.todos.every((t) => t.text && t.reason));
  assert.ok(qa.todos.some((t) => /테스트 계정/.test(t.text)), '권한 계정 준비 항목 없음');

  // ② URL
  const paths = qa.urls.map((u) => u.path);
  assert.ok(paths.includes('/board/list'), paths.join(' / '));
  assert.ok(paths.includes('/admin/board'), paths.join(' / '));
  assert.equal(qa.urls.find((u) => u.path === '/admin/board').access, '관리자');
  assert.ok(!paths.some((p) => /figma\.com/.test(p)), 'Figma 링크가 URL 표에 섞였다');

  // ③ 흐름
  assert.match(qa.flow.mermaid, /^flowchart TD/);
  assert.ok(qa.flow.caption.length > 10, '흐름 설명 없음');

  // ④ Figma
  assert.deepEqual(qa.figma, ['https://www.figma.com/file/abc123/board-ui']);

  // ⑤ 비목표
  const nonGoalText = qa.nonGoals.map((n) => n.text).join(' | ');
  assert.match(nonGoalText, /차기 버전/);
  assert.match(nonGoalText, /미지원/);
  assert.ok(!/다음 단계로 이동/.test(nonGoalText), '일반 흐름 문장을 비목표로 오탐');

  // ⑥ 목표
  const goalText = qa.goals.map((g) => g.text).join(' | ');
  assert.match(goalText, /게시판을 구축한다/);
  assert.ok(!/차기 버전/.test(goalText), '비목표 문장이 목표에 섞였다');
  assert.match(qa.guarantee, /검증이 통과되면/);
});

test('메타 섹션(목적·범위)은 기능 영역으로 취급하지 않는다', () => {
  assert.equal(qaPlanMod.isFeatureArea('목적'), false);
  assert.equal(qaPlanMod.isFeatureArea('3. 범위'), false);
  assert.equal(qaPlanMod.isFeatureArea('변경 이력'), false);
  assert.equal(qaPlanMod.isFeatureArea('미분류'), false);
  assert.equal(qaPlanMod.isFeatureArea('1. 게시글 목록'), true);

  const qa = summarizeSpec(BOARD_SPEC).qaPlan;
  assert.ok(!/목적|범위/.test(qa.guarantee), `보장 문장에 메타 섹션이 섞였다: ${qa.guarantee}`);
  assert.ok(!/\[목적\]|\[3. 범위\]/.test(qa.flow.mermaid), '흐름도에 메타 섹션이 섞였다');
});

test('흐름도 관문은 이름이 인증을 뜻하는 영역일 때만 세운다', () => {
  const withLogin = summarizeSpec('## 1. 로그인\n- 비밀번호는 8자 이상이다.\n## 2. 주문\n- 결제 실패 시 주문을 확정하지 않는다.').qaPlan;
  assert.match(withLogin.flow.mermaid, /AUTH\[1\. 로그인\]/);
  assert.match(withLogin.flow.caption, /진입 관문/);

  // 인증 키워드가 기능 안에만 섞여 있으면 관문을 세우지 않는다
  const inline = summarizeSpec('## 1. 글 작성\n- 로그인한 회원만 글을 작성할 수 있다.').qaPlan;
  assert.ok(!/AUTHR/.test(inline.flow.mermaid), '임의 영역을 로그인 관문으로 세웠다');
  assert.match(inline.flow.caption, /개별 기능 안에 섞여/);
});

test('문서에 없는 항목은 "확인 필요" 로 표기한다', () => {
  const qa = summarizeSpec('- 목록을 표시한다.').qaPlan;
  assert.equal(qa.figma, null, 'Figma 링크가 없으면 null 이어야 한다');
  assert.ok(qa.urls.length === 0);
  assert.match(qa.nonGoals[0].text, /확인 필요|검증 대상에서 제외/);
  assert.ok(qa.checkpoints[0].items[0].what.includes(qaPlanMod.NOT_SPECIFIED)
    || qa.checkpoints[0].items[0].what.length > 0);
});

test('URL 표기를 여러 형태로 추출하고 중복을 합친다', () => {
  const doc = [
    '## 1. 화면 목록',
    '| 화면 | 경로 | 권한 |',
    '| --- | --- | --- |',
    '| 게시글 목록 | /board/list | 전체 |',
    '| 글 작성 | /board/write | 회원 |',
    '| 게시판 관리 | /admin/board | 관리자 |',
    '- 상세는 [게시글 상세](https://staging.example.com/board/view/{id}) 에서 확인한다.',
    '- 운영 주소: center.muhayu.com/post/view/abc',
    '- 목록 API 는 GET /api/posts 를 호출하고, 저장은 POST /api/posts 로 전송한다.',
    '- 시안: https://www.figma.com/file/abc/board',
    '- 아이콘은 /assets/icon.png 를 쓴다.',
  ].join('\n');

  const urls = summarizeSpec(doc).qaPlan.urls;
  const byPath = Object.fromEntries(urls.map((u) => [u.path, u]));

  // 표 셀의 권한 값을 그대로 읽는다
  assert.equal(byPath['/board/list'].access, '전체');
  assert.equal(byPath['/board/write'].access, '회원');
  assert.equal(byPath['/admin/board'].access, '관리자');
  // 표 첫 셀을 화면 이름으로 쓴다
  assert.equal(byPath['/board/write'].screen, '글 작성');
  // 마크다운 링크 라벨을 화면 이름으로 쓴다
  assert.equal(byPath['https://staging.example.com/board/view/{id}'].screen, '게시글 상세');
  // 스킴 없는 사내 도메인도 잡는다
  assert.ok(byPath['center.muhayu.com/post/view/abc'], Object.keys(byPath).join(' / '));
  // 같은 경로의 GET/POST 는 한 행으로 합친다
  assert.ok(byPath['/api/posts'], 'API 경로 없음');
  assert.equal(byPath['/api/posts'].method, 'GET / POST');
  assert.equal(urls.filter((u) => u.path === '/api/posts').length, 1, '메서드 유무로 행이 중복됐다');
  // 정적 자산·Figma 는 검증 대상이 아니다
  assert.ok(!byPath['/assets/icon.png'], '이미지 경로가 URL 표에 섞였다');
  assert.ok(!urls.some((u) => /figma/.test(u.path)), 'Figma 링크가 URL 표에 섞였다');
});

test('검증 시나리오는 화면 이름·경로에 맞춰 추정한다', () => {
  const qa = summarizeSpec([
    '## 1. 화면 목록',
    '| 화면 | 경로 | 권한 |',
    '| --- | --- | --- |',
    '| 게시글 목록 | /board/list | 전체 |',
    '| 글 작성 | /board/write | 회원 |',
    '| 게시판 관리 | /admin/board | 관리자 |',
    '- 목록 API 는 GET /api/posts 를 호출한다.',
    '- 상세는 [게시글 상세](/board/view/1) 이다.',
  ].join('\n')).qaPlan;

  const by = Object.fromEntries(qa.urls.map((u) => [u.path, u.scenario]));
  assert.match(by['/board/list'], /페이징/);
  assert.match(by['/board/write'], /필수값/, '작성 화면에 입력 검증 관점이 없다');
  assert.ok(!/페이징/.test(by['/board/write']), '작성 화면에 목록 관점이 붙었다');
  assert.match(by['/admin/board'], /권한 경계/);
  assert.match(by['/api/posts'], /토큰 직접 호출/, 'API 경로 관점이 화면과 같다');
  assert.match(by['/board/view/1'], /화면 이동/);
});

test('문서에 단계 표기가 있으면 순서대로 흐름을 그린다', () => {
  const stepped = summarizeSpec([
    '## 작성 흐름',
    '- 1단계: 글쓰기 버튼을 누른다.',
    '- 2단계: 제목과 본문을 입력한다. 제목은 최대 60자까지 허용한다.',
    '- 3단계: 저장하면 목록으로 이동한다.',
  ].join('\n')).qaPlan;

  assert.equal(stepped.flow.ordered, true, '단계 표기를 인식하지 못했다');
  const m = stepped.flow.mermaid;
  assert.match(m, /S0\["1\. 글쓰기 버튼을 누른다"\]/);
  assert.match(m, /C0 -- 정상 --> S1/, '정상 경로 엣지 라벨 누락');
  assert.match(m, /C0 -- 실패 --> NG0/);
  assert.match(m, /DONE\[처리 완료/);
  // 단계 라벨은 첫 문장만 — 뒤 설명이 노드에 붙으면 도형이 깨진다
  assert.ok(!/최대 60자/.test(m), `단계 라벨이 너무 길다: ${m}`);
  assert.match(stepped.flow.caption, /단계 표기\(3단계\)/);

  // Step / 동그라미 숫자 표기도 인식한다
  const en = summarizeSpec('- Step 1: open the form.\n- Step 2: submit the form.').qaPlan;
  assert.equal(en.flow.ordered, true);
  const circled = summarizeSpec('- ① 목록을 연다.\n- ② 상세로 이동한다.').qaPlan;
  assert.equal(circled.flow.ordered, true);
});

test('단계 표기가 없으면 순서를 추측하지 않는다', () => {
  const qa = summarizeSpec('## 1. 로그인\n- 비밀번호는 8자 이상이다.\n## 2. 주문\n- 결제 실패 시 주문을 확정하지 않는다.').qaPlan;
  assert.equal(qa.flow.ordered, false, '번호 붙은 절 제목을 흐름 순서로 단정했다');
  assert.match(qa.flow.caption, /단계 표기.*없어|기획 확인/);
});

test('POST /api/summarize 응답에 qaPlan 이 포함된다', () => withServer(async (base) => {
  const res = await post(base, '/api/summarize', { specText: BOARD_SPEC });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.ok(data.summary.qaPlan, 'qaPlan 없음');
  assert.equal(data.summary.qaPlan.checkpoints.length, 6);
  assert.ok(data.summary.qaPlan.urls.length >= 2);
  assert.deepEqual(data.summary.qaPlan.figma, ['https://www.figma.com/file/abc123/board-ui']);
}));

test('POST /api/generate-tc 응답의 specSummary 에도 qaPlan 이 포함된다', () => withServer(async (base) => {
  const res = await post(base, '/api/generate-tc', { specText: BOARD_SPEC });
  const data = await res.json();
  assert.ok(data.specSummary.qaPlan, 'qaPlan 없음');
  assert.ok(data.specSummary.qaPlan.todos.length > 0);
}));

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

/* ------------------------------------------------------------ 파일 추출 */

const { extractText } = require('../src/extract');
const { makeDocx, makePdf } = require('./fixtures');

test('.docx 에서 제목·목록·표·이스케이프를 복원한다', async () => {
  const { text, meta } = await extractText(makeDocx(), 'spec.docx');
  assert.equal(meta.kind, 'docx');
  assert.ok(text.includes('# 회원 서비스 기획서'), '제목1 → # 변환 실패');
  assert.ok(text.includes('## 로그인'), '제목2 → ## 변환 실패');
  assert.ok(text.includes('- 비밀번호는 8자 이상 20자 이하로 입력해야 한다.'), '목록 → - 변환 실패');
  assert.ok(/서버 응답이 3초 이내 에 오지 않으면/.test(text), '분리된 run 병합 실패');
  assert.ok(text.includes('| 항목 | 결제 승인이 실패하면'), '표 → 파이프 행 변환 실패');
  assert.ok(text.includes('AT&T 문자 <태그>'), 'XML 엔티티 복원 실패');
});

test('.docx 추출 결과로 TC 가 생성된다 (제목이 영역으로 잡힌다)', async () => {
  const { text } = await extractText(makeDocx(), 'spec.docx');
  const { testCases } = generateFromSpec(text);
  assert.ok(testCases.length > 5, `TC 부족: ${testCases.length}`);
  assert.ok(testCases.some((tc) => tc.area === '로그인'), '영역 인식 실패: ' + [...new Set(testCases.map((t) => t.area))].join(','));
  assert.ok(testCases.some((tc) => tc.tags.includes('boundary')), '경계값 TC 없음');
});

test('.pdf 에서 텍스트를 추출한다', async () => {
  const pdf = makePdf(['Password must be at least 8 characters.', 'If payment fails, do not confirm the order.']);
  const { text, meta } = await extractText(pdf, 'spec.pdf');
  assert.equal(meta.kind, 'pdf');
  assert.equal(meta.pages, 1);
  assert.match(text, /at least 8 characters/);
  assert.match(text, /payment fails/);
});

test('PDF 머리글·바닥글 반복 줄을 제거한다', () => {
  const { stripPageChrome, isChrome } = require('../src/extract/pdf');

  assert.equal(isChrome('1 / 4'), true);
  assert.equal(isChrome('- 3 -'), true);
  assert.equal(isChrome('https://center.example.com/post/view/abc 1/4'), true);
  assert.equal(isChrome('26. 6. 23. 오전 11:39 [QA 완료 보고서]'), true);
  assert.equal(isChrome('비밀번호는 8자 이상이다.'), false);

  const pages = [
    ['[QA 보고서] 프로젝트명', '비밀번호는 8자 이상이다.', '1 / 2'],
    ['[QA 보고서] 프로젝트명', '결제 실패 시 주문을 확정하지 않는다.', '2 / 2'],
  ];
  const cleaned = stripPageChrome(pages);
  assert.deepEqual(cleaned, [
    ['비밀번호는 8자 이상이다.'],
    ['결제 실패 시 주문을 확정하지 않는다.'],
  ]);
});

test('네이티브 canvas 없이도 PDF 를 처리한다 (DOMMatrix 폴리필)', async () => {
  const { domSupport } = require('../src/extract/pdf');
  const { installDomShims, DOMMatrixShim } = require('../src/extract/domShims');

  // pdf.js 는 DOMMatrix/ImageData/Path2D 를 optionalDependency(@napi-rs/canvas)에서
  // 가져오므로, 그 네이티브 패키지가 없는 환경에서는 import 자체가 실패한다.
  // 어느 쪽 환경이든 전역이 채워져 있어야 한다.
  for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) {
    assert.equal(typeof globalThis[name], 'function', `${name} 전역이 없다`);
  }
  assert.ok(Array.isArray(domSupport().installed), '폴리필 상태를 보고하지 않는다');

  // 실제 추출이 되는지 (폴리필/네이티브 어느 쪽이든)
  const { text, meta } = await extractText(makePdf(['Password must be at least 8 characters.']), 'spec.pdf');
  assert.equal(meta.kind, 'pdf');
  assert.match(text, /at least 8 characters/);

  // 폴리필을 두 번 깔아도 기존 전역을 덮지 않는다
  const first = globalThis.DOMMatrix;
  installDomShims();
  assert.equal(globalThis.DOMMatrix, first, '이미 있는 전역을 덮어썼다');

  // DOMMatrix 대체 구현의 행렬 연산이 실제로 맞는지 (틀리면 좌표가 조용히 어긋난다)
  const m = new DOMMatrixShim([2, 0, 0, 3, 10, 20]);
  assert.deepEqual(m.transformPoint({ x: 1, y: 1 }), { x: 12, y: 23, z: 0, w: 1 });

  const inv = m.inverse();
  const back = inv.transformPoint(m.transformPoint({ x: 4, y: 5 }));
  assert.ok(Math.abs(back.x - 4) < 1e-9 && Math.abs(back.y - 5) < 1e-9, '역행렬이 원점 복귀에 실패');

  // translate 는 곱셈 순서를 지켜야 한다 (스케일이 이동에 반영)
  const t = new DOMMatrixShim([2, 0, 0, 2, 0, 0]).translate(5, 5);
  assert.equal(t.e, 10);
  assert.equal(t.f, 10);

  // 문자열/4x4 배열 초기화
  assert.equal(new DOMMatrixShim('matrix(1, 0, 0, 1, 7, 8)').e, 7);
  const m4 = new DOMMatrixShim([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 0, 1]);
  assert.equal(m4.e, 3);
  assert.equal(m4.f, 4);
});

test('PDF 워커를 메인 스레드에 직접 공급한다 (서버리스 번들 대응)', async () => {
  const { domSupport } = require('../src/extract/pdf');

  // 한 번 처리해 워커가 준비되게 한다
  await extractText(makePdf(['Worker check.']), 'worker.pdf');

  // pdf.js 는 globalThis.pdfjsWorker 가 있으면 workerSrc 를 동적 import 하지 않는다.
  // (그 경로가 Vercel 번들에서 "Cannot find module ... pdf.worker.mjs" 로 실패했다)
  assert.equal(domSupport().worker, 'main-thread', `워커 모드: ${domSupport().worker}`);
  assert.equal(typeof globalThis.pdfjsWorker?.WorkerMessageHandler, 'function', 'WorkerMessageHandler 미공급');

  // 워커 파일이 사라져도(번들 누락 상황) 이미 로드된 모듈로 계속 동작해야 한다
  const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const hidden = workerPath + '.test-hidden';
  fs.renameSync(workerPath, hidden);
  try {
    const { text } = await extractText(makePdf(['Still works without the file.']), 'worker2.pdf');
    assert.match(text, /Still works without the file/);
  } finally {
    fs.renameSync(hidden, workerPath);
  }
});

test('PDF 오류 메시지는 원인별로 구분한다', () => {
  const { describePdfError } = require('../src/extract/pdf');
  assert.match(describePdfError(new Error('DOMMatrix is not defined'), '여는'), /그래픽 API/);
  assert.match(describePdfError(new Error('Setting up fake worker failed: "Cannot find module pdf.worker.mjs"'), '여는'), /워커 모듈/);
  assert.match(describePdfError(new Error('Password required'), '여는'), /암호/);
  assert.match(describePdfError(new Error('Invalid PDF structure'), '여는'), /손상/);
  assert.match(describePdfError(new Error('something else'), '읽는'), /읽는 중 오류/);
});
test('확장자가 없어도 매직 넘버로 형식을 판별한다', async () => {
  const pdf = await extractText(makePdf(['Retry up to 3 times.']), 'unknown-name');
  assert.equal(pdf.meta.kind, 'pdf');
  const docx = await extractText(makeDocx(), 'unknown-name');
  assert.equal(docx.meta.kind, 'docx');
});

test('CP949 로 저장된 텍스트 파일을 디코딩한다', async () => {
  // "- 비밀번호는 8자 이상이다." 를 CP949 로 인코딩한 바이트
  const cp949 = Buffer.from([
    0x2d, 0x20, 0xba, 0xf1, 0xb9, 0xd0, 0xb9, 0xf8, 0xc8, 0xa3, 0xb4, 0xc2,
    0x20, 0x38, 0xc0, 0xda, 0x20, 0xc0, 0xcc, 0xbb, 0xf3, 0xc0, 0xcc, 0xb4, 0xd9, 0x2e,
  ]);
  const { text, meta } = await extractText(cp949, 'spec.txt');
  assert.equal(meta.kind, 'text');
  assert.ok(text.includes('비밀번호'), `디코딩 실패: ${text}`);
  assert.match(meta.encoding, /euc-kr/);
});

test('지원하지 않는 형식은 명확한 오류를 낸다', async () => {
  await assert.rejects(() => extractText(Buffer.from('x'), 'spec.hwp'), /한글\(\.hwp/);
  await assert.rejects(() => extractText(Buffer.from('x'), 'spec.doc'), /\.docx 로 다시 저장/);
  await assert.rejects(() => extractText(Buffer.alloc(0), 'a.md'), /비어 있습니다/);
});

/* ---------------------------------------------------------------- HTTP */

function withServer(fn, envOverrides) {
  const saved = {};
  if (envOverrides) {
    for (const [k, v] of Object.entries(envOverrides)) {
      saved[k] = process.env[k];
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  }

  const restore = () => {
    if (!envOverrides) return;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };

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
        restore();
      }
    });
  });
}

const PW = 'test-team-password';
const authEnv = (extra) => ({ SPECTOTC_PASSWORD: PW, SPECTOTC_DISABLE_RATELIMIT: 'true', ...extra });

/** 로그인해서 세션 쿠키 문자열을 얻는다 */
async function login(base, password = PW) {
  const res = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  const cookie = (setCookie || []).filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  return { status: res.status, body: await res.json(), cookie };
}

const post = (base, path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /api/health', () => withServer(async (base) => {
  const data = await (await fetch(`${base}/api/health`)).json();
  assert.equal(data.ok, true);
  assert.equal(data.service, 'SpecToTC');
}));

test('GET /api/health 는 PDF DOM 구현 상태를 알려준다', () => withServer(async (base) => {
  const data = await (await fetch(base + '/api/health')).json();
  assert.ok(data.pdf && data.pdf.dom, 'pdf.dom 진단 정보 없음');
  for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) {
    assert.ok(['native', 'shim', 'preexisting'].includes(data.pdf.dom[name]), `${name} 상태 불명: ${data.pdf.dom[name]}`);
  }
  assert.equal(typeof data.pdf.nativeCanvas, 'boolean');
  assert.equal(typeof data.pdf.worker, 'string');
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

test('POST /api/export-csv — 응답 바이트가 UTF-8 BOM 으로 시작한다', () => withServer(async (base) => {
  const res = await post(base, '/api/export-csv', { specText: SAMPLE });
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 3).toString('hex'), 'efbbbf', 'BOM 없음 — Excel 에서 한글이 깨진다');
  assert.match(buf.toString('utf8'), /요구사항 영역/, '한글 헤더가 UTF-8 로 디코딩되지 않는다');
}));

test('POST /api/export-csv — bom:false 일 때만 BOM 이 빠진다', () => withServer(async (base) => {
  const res = await post(base, '/api/export-csv', { specText: SAMPLE, bom: false });
  const buf = Buffer.from(await res.arrayBuffer());
  assert.notEqual(buf.subarray(0, 3).toString('hex'), 'efbbbf');
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

test('POST /api/extract-text — .docx 업로드', () => withServer(async (base) => {
  const res = await fetch(`${base}/api/extract-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('로그인 기획서.docx') },
    body: makeDocx(),
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.meta.kind, 'docx');
  assert.equal(data.meta.fileName, '로그인 기획서.docx', '한글 파일명 복원 실패');
  assert.ok(data.specText.includes('## 로그인'));
}));

test('POST /api/extract-text — 빈 본문은 400', () => withServer(async (base) => {
  const res = await fetch(`${base}/api/extract-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  assert.equal(res.status, 400);
}));

test('POST /api/summarize', () => withServer(async (base) => {
  const res = await post(base, '/api/summarize', { specText: SAMPLE, topN: 5 });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.summary.keyPoints.length, 5);
  assert.ok(data.summary.numericRules.length > 5);
  assert.equal(data.ai.enabled, false);
}));

test('POST /api/generate-tc 응답에 specSummary 가 포함된다', () => withServer(async (base) => {
  const res = await post(base, '/api/generate-tc', { specText: SAMPLE });
  const data = await res.json();
  assert.ok(data.specSummary && data.specSummary.headline);
  assert.ok(data.specSummary.coverage.testCases === data.testCases.length);
}));

/* --------------------------------------------------------------- 인증 */

const auth = require('../src/auth');
const ratelimit = require('../src/ratelimit');

test('비밀번호 검증은 타이밍 안전 비교를 쓴다', () => {
  const saved = process.env.SPECTOTC_PASSWORD;
  process.env.SPECTOTC_PASSWORD = 'hunter2';
  try {
    assert.equal(auth.isEnabled(), true);
    assert.equal(auth.verifyPassword('hunter2'), true);
    assert.equal(auth.verifyPassword('hunter3'), false);
    assert.equal(auth.verifyPassword('hunter2 '), false, '공백까지 일치해야 한다');
    assert.equal(auth.verifyPassword(''), false);
    assert.equal(auth.verifyPassword(null), false);
  } finally {
    if (saved === undefined) delete process.env.SPECTOTC_PASSWORD;
    else process.env.SPECTOTC_PASSWORD = saved;
  }
});

test('세션 토큰은 위조·만료를 걸러낸다', () => {
  const saved = process.env.SPECTOTC_PASSWORD;
  process.env.SPECTOTC_PASSWORD = 'hunter2';
  try {
    const token = auth.createToken();
    assert.equal(auth.verifyToken(token), true);

    const [payload, sig] = token.split('.');
    assert.equal(auth.verifyToken(payload + '.' + sig.slice(0, -2) + 'xx'), false, '서명 위조 통과');
    assert.equal(auth.verifyToken(payload), false, '서명 없는 토큰 통과');
    assert.equal(auth.verifyToken(''), false);

    // 만료된 페이로드를 같은 키로 정상 서명해도 거부돼야 한다
    const crypto = require('node:crypto');
    const expired = Buffer.from(JSON.stringify({ v: 1, exp: Date.now() - 1000 })).toString('base64url');
    const secret = crypto.createHash('sha256').update('spectotc:hunter2').digest('hex');
    const sig2 = crypto.createHmac('sha256', secret).update(expired).digest('base64url');
    assert.equal(auth.verifyToken(expired + '.' + sig2), false, '만료 토큰 통과');

    // 비밀번호를 바꾸면 기존 토큰이 무효가 된다
    process.env.SPECTOTC_PASSWORD = 'other';
    assert.equal(auth.verifyToken(token), false, '비밀번호 교체 후에도 세션 유효');
  } finally {
    if (saved === undefined) delete process.env.SPECTOTC_PASSWORD;
    else process.env.SPECTOTC_PASSWORD = saved;
  }
});

test('인증이 켜지면 API 는 401, 화면은 로그인으로 리다이렉트', () => withServer(async (base) => {
  const api = await post(base, '/api/generate-tc', { specText: '- 비밀번호는 8자 이상이다.' });
  assert.equal(api.status, 401);
  const body = await api.json();
  assert.equal(body.loginUrl, '/login.html');

  const page = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /^\/login\.html\?next=/);
}, authEnv()));

test('로그인 후 세션 쿠키로 API 를 쓸 수 있다', () => withServer(async (base) => {
  const bad = await login(base, 'wrong-password');
  assert.equal(bad.status, 401);
  assert.equal(bad.cookie, '', '실패 시 쿠키가 발급됨');

  const ok = await login(base);
  assert.equal(ok.status, 200);
  assert.match(ok.cookie, /spectotc_session=/);

  const res = await fetch(base + '/api/generate-tc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ok.cookie },
    body: JSON.stringify({ specText: SAMPLE }),
  });
  assert.equal(res.status, 200);
  assert.ok((await res.json()).testCases.length > 30);
}, authEnv()));

test('세션 쿠키는 HttpOnly · SameSite 속성을 갖는다', () => withServer(async (base) => {
  const res = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PW }),
  });
  const raw = (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')]).join(';;');
  assert.match(raw, /HttpOnly/i);
  assert.match(raw, /SameSite=Lax/i);
  assert.match(raw, /Max-Age=\d+/i);
}, authEnv()));

test('로그아웃하면 세션이 무효가 된다', () => withServer(async (base) => {
  const { cookie } = await login(base);
  const out = await fetch(base + '/api/logout', { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(out.status, 200);
  const cleared = (out.headers.getSetCookie ? out.headers.getSetCookie() : [out.headers.get('set-cookie')]).join(';;');
  assert.match(cleared, /Max-Age=0/i);
}, authEnv()));

test('로그인 화면과 health 는 인증 없이 열린다', () => withServer(async (base) => {
  assert.equal((await fetch(base + '/login.html')).status, 200);
  assert.equal((await fetch(base + '/dashboard.css')).status, 200);
  assert.equal((await fetch(base + '/robots.txt')).status, 200);

  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.auth.required, true);
  assert.equal(health.auth.authenticated, false);
  assert.equal(health.node, undefined, '미인증 상태에 상세 정보 노출');
  assert.equal(health.upload, undefined, '미인증 상태에 상세 정보 노출');
}, authEnv()));

test('기본값은 인증 없이 열림 (비밀번호 미설정)', () => withServer(async (base) => {
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.auth.required, false);
  assert.equal(health.auth.authenticated, true);

  // 로그인 없이 바로 생성이 된다
  const res = await post(base, '/api/generate-tc', { specText: '- 비밀번호는 8자 이상이다.' });
  assert.equal(res.status, 200);
  assert.ok((await res.json()).testCases.length > 0);

  // 화면도 리다이렉트 없이 열린다
  const page = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(page.status, 200);
}, { SPECTOTC_PASSWORD: undefined, SPECTOTC_REQUIRE_AUTH: undefined }));

test('인증을 필수로 켰는데 비밀번호가 없으면 503 으로 잠근다', () => withServer(async (base) => {
  const res = await fetch(base + '/api/health');
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /SPECTOTC_REQUIRE_AUTH/);
}, { SPECTOTC_PASSWORD: undefined, SPECTOTC_REQUIRE_AUTH: 'true' }));

test('로그인 시도는 레이트리밋에 걸린다', () => withServer(async (base) => {
  ratelimit.reset();
  let blocked = 0;
  for (let i = 0; i < 13; i += 1) {
    const res = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'nope' }),
    });
    if (res.status === 429) {
      blocked += 1;
      assert.ok(res.headers.get('retry-after'), 'Retry-After 헤더 없음');
    }
  }
  ratelimit.reset();
  assert.ok(blocked >= 3, `차단된 요청이 부족: ${blocked}`);
}, { SPECTOTC_PASSWORD: PW, SPECTOTC_DISABLE_RATELIMIT: undefined }));

test('AI 보강은 서버 설정으로 잠글 수 있다', () => withServer(async (base) => {
  const { cookie } = await login(base);
  const res = await fetch(base + '/api/generate-tc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ specText: '- 비밀번호는 8자 이상이다.', useAI: true }),
  });
  const data = await res.json();
  assert.equal(data.ai.enabled, false);
  assert.match(data.ai.error, /비활성화/);
  assert.ok(data.testCases.length > 0, '규칙 엔진 결과는 그대로 나와야 한다');
}, authEnv({ SPECTOTC_AI_ENABLED: 'false' })));

test('AI 토큰이 설정되면 헤더 없이는 거부된다', () => withServer(async (base) => {
  const { cookie } = await login(base);
  const call = (headers) => fetch(base + '/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
    body: JSON.stringify({ specText: '- 비밀번호는 8자 이상이다.', useAI: true }),
  }).then((r) => r.json());

  const denied = await call({});
  assert.match(denied.ai.error, /X-AI-Token/);
  const wrong = await call({ 'X-AI-Token': 'bad' });
  assert.match(wrong.ai.error, /X-AI-Token/);
}, authEnv({ SPECTOTC_AI_TOKEN: 'secret-token', SPECTOTC_AI_ENABLED: undefined })));

test('검색 엔진 차단 헤더와 robots.txt 를 내려준다', () => withServer(async (base) => {
  const res = await fetch(base + '/api/health');
  assert.match(res.headers.get('x-robots-tag'), /noindex/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');

  const robots = await fetch(base + '/robots.txt');
  assert.match(await robots.text(), /Disallow: \//);
}));

test('깨진 JSON 본문은 내용을 되돌려주지 않는다', () => withServer(async (base) => {
  const secret = '사내 대외비 기획 내용';
  const res = await fetch(base + '/api/generate-tc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"specText": "' + secret + '"',  // 닫는 중괄호 없음
  });
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.ok(!body.includes(secret), '응답에 기획서 내용이 노출됨: ' + body);
  assert.match(body, /JSON/);
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
