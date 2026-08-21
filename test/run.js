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

test('비밀번호 없이 배포되면 503 으로 잠근다', () => withServer(async (base) => {
  const res = await fetch(base + '/api/health');
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /SPECTOTC_PASSWORD/);
}, { SPECTOTC_PASSWORD: undefined, SPECTOTC_FORCE_AUTH: '1' }));

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
