'use strict';

const { CATEGORIES } = require('./dictionary');

const WEIGHTS = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.weight]));
const LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

const TYPE = { PASS: 'Pass', FAIL: 'Fail', EDGE: 'Edge Case' };
const TYPE_CODE = { [TYPE.PASS]: 'P', [TYPE.FAIL]: 'F', [TYPE.EDGE]: 'E' };

/** 카테고리 가중치 합 + 유형 보정으로 중요도 산출 */
function calcPriority(req, type) {
  let score = req.categories.reduce((sum, key) => sum + (WEIGHTS[key] || 0), 0);
  if (type === TYPE.FAIL) score += 2;
  if (type === TYPE.EDGE) score += 1;
  if (req.constraints.length) score += 1;
  if (req.categories.length === 1 && req.categories[0] === 'DISPLAY') score -= 2;

  if (score >= 10) return 'High';
  if (score >= 5) return 'Med';
  return 'Low';
}

/** 문장 끝 종결부호를 떼어 다른 문장에 끼워 넣기 좋은 형태로 만든다. */
function clean(text) {
  return String(text == null ? '' : text).trim().replace(/[.;,]+$/, '');
}

/** 단계/기대결과 안에서 요구사항 문구를 인용할 때 사용 */
function quote(text) {
  return `「${clean(text)}」`;
}

function buildPrecondition(req, extra) {
  const lines = [`대상 영역: ${req.area}`];
  if (req.condition) lines.push(`선행 조건: ${clean(req.condition)}`);
  lines.push('테스트 계정/데이터 준비 완료');
  if (extra) lines.push(extra);
  return lines.join(' / ');
}

function delta(value) {
  return Number.isInteger(value) ? 1 : Math.pow(10, -String(value).split('.')[1].length);
}

function fmt(value, unit) {
  const n = Number.isInteger(value) ? value : Number(value.toFixed(4));
  return unit ? `${n}${unit}` : `${n}`;
}

const OP_TEXT = { '>=': '이상', '<=': '이하', '>': '초과', '<': '미만' };

/** 경계값 3점(내부/경계/외부)과 각 기대 판정을 계산 */
function boundaryPoints(c) {
  const d = delta(c.value);
  const inside = { '>=': c.value + d, '<=': c.value - d, '>': c.value + d * 2, '<': c.value - d * 2 };
  const outside = { '>=': c.value - d, '<=': c.value + d, '>': c.value, '<': c.value };
  const atBoundaryPasses = c.op === '>=' || c.op === '<=';

  return [
    { value: outside[c.op], verdict: '거부(유효성 오류 안내)', label: '경계 외부' },
    { value: c.value, verdict: atBoundaryPasses ? '허용(정상 처리)' : '거부(유효성 오류 안내)', label: '경계 정확값' },
    { value: inside[c.op], verdict: '허용(정상 처리)', label: '경계 내부' },
  ];
}

/* ---------------------------------------------------------------- Pass TC */

function passCases(req) {
  const cases = [{
    scenario: req.condition
      ? `[정상] ${clean(req.condition)} 조건 충족 → ${clean(req.action)}`
      : `[정상] ${clean(req.action)}`,
    precondition: buildPrecondition(req),
    steps: [
      `${req.area} 화면/기능으로 진입한다.`,
      req.condition ? `${quote(req.condition)} 조건을 충족하는 상태를 만든다.` : '명세에 정의된 정상 입력값을 준비한다.',
      `${quote(req.action)} 동작을 수행한다.`,
      '화면 표시 결과와 서버 응답(200)을 함께 확인한다.',
    ],
    expected: `명세대로 ${quote(req.action)} 가 정상 수행된다. 오류 문구/알럿 없이 정상 상태로 종료된다.`,
    tags: ['happy-path'],
  }];

  if (req.categories.includes('STATE')) {
    cases.push({
      scenario: `[정상] ${clean(req.action)} 후 재진입 시 상태 유지 확인`,
      precondition: buildPrecondition(req, '정상 처리 1회 완료'),
      steps: [`${quote(req.action)} 동작을 정상 수행한다.`, '화면을 새로고침하거나 앱을 재실행한다.', '동일 화면으로 재진입한다.'],
      expected: '이전에 저장/동기화된 상태가 그대로 복원된다.',
      tags: ['persistence'],
    });
  }

  if (req.categories.includes('NOTIFICATION')) {
    cases.push({
      scenario: `[정상] ${clean(req.action)} 시 알림 발송 확인`,
      precondition: buildPrecondition(req, '알림 수신 채널(푸시/메일/SMS) 활성화'),
      steps: [`${quote(req.action)} 동작을 수행한다.`, '수신 채널에서 알림 도착 여부를 확인한다.'],
      expected: '명세에 정의된 채널로 1건 발송되며, 문구/링크가 기획서와 일치한다.',
      tags: ['notification'],
    });
  }

  return cases;
}

/* ---------------------------------------------------------------- Fail TC */

const FAIL_RECIPES = [
  {
    key: 'VALIDATION',
    title: '필수값 미입력 / 형식 오류',
    steps: ['필수 입력 항목을 공백으로 두거나 형식에 맞지 않는 값을 입력한다.', '저장/제출 버튼을 누른다.'],
    expected: '요청이 차단되고 해당 필드에 유효성 오류 문구가 노출된다. 서버 요청이 발생하지 않거나 400 응답을 받는다.',
  },
  {
    key: 'AUTH',
    title: '미인증 / 권한 없는 계정 접근',
    steps: ['로그아웃 상태(또는 권한 없는 계정)로 해당 기능에 접근한다.', '만료된 토큰으로 API를 직접 호출한다.'],
    expected: '기능이 노출되지 않거나 401/403 응답과 함께 로그인/권한 안내 화면으로 유도된다.',
  },
  {
    key: 'PAYMENT',
    title: '결제 승인 실패',
    steps: ['한도 초과/잔액 부족 카드로 결제를 시도한다.', 'PG 승인 실패 응답을 수신한다.'],
    expected: '주문이 확정되지 않고 결제 실패 사유가 안내된다. 중복 청구가 발생하지 않는다.',
  },
  {
    key: 'FILE',
    title: '허용되지 않는 파일 / 용량 초과',
    steps: ['허용 확장자가 아닌 파일을 선택한다.', '용량 제한을 초과하는 파일로 업로드를 시도한다.'],
    expected: '업로드가 차단되고 허용 확장자/용량 기준이 포함된 오류 문구가 노출된다.',
  },
  {
    key: 'NOTIFICATION',
    title: '알림 발송 실패',
    steps: ['수신 채널을 차단하거나 잘못된 수신처를 등록한다.', '발송을 유발하는 동작을 수행한다.'],
    expected: '발송 실패가 로그로 기록되고, 본 기능의 주요 흐름은 실패로 중단되지 않는다(정책 확인 필요).',
  },
  {
    key: 'DESTRUCTIVE',
    title: '삭제 취소 / 권한 없는 삭제',
    steps: ['삭제 확인 팝업에서 취소를 누른다.', '권한이 없는 계정으로 동일 삭제 API를 호출한다.'],
    expected: '데이터가 삭제되지 않고 원상태가 유지된다. 권한 없는 호출은 403으로 차단된다.',
  },
  {
    key: 'ABORT',
    title: '중도 이탈 / 타임아웃',
    steps: ['처리 중간 단계에서 뒤로가기 또는 앱 종료로 이탈한다.', '응답 대기 중 네트워크를 차단해 타임아웃을 유발한다.'],
    expected: '중간 상태가 확정되지 않고 명세된 이탈 처리(임시저장/롤백/안내)가 동작한다.',
  },
  {
    key: 'ERROR',
    title: '서버 오류(5xx) 응답',
    steps: ['서버가 500을 반환하도록 목(mock) 처리한다.', '동일 동작을 재수행한다.'],
    expected: '앱이 크래시되지 않고 오류 안내 문구와 재시도 수단이 제공된다.',
  },
];

function failCases(req, limit) {
  const cases = [];

  if (req.condition) {
    cases.push({
      scenario: `[실패] 조건 미충족(${clean(req.condition)} 아님) 상태에서 동일 동작 수행`,
      precondition: buildPrecondition(req, `${clean(req.condition)} 조건을 의도적으로 불충족 상태로 설정`),
      steps: [
        `${req.area} 화면/기능으로 진입한다.`,
        `${quote(req.condition)} 조건을 충족하지 않는 상태를 만든다.`,
        `${quote(req.action)} 동작을 수행한다.`,
      ],
      expected: `${quote(req.action)} 가 수행되지 않고, 조건 미충족 사유가 사용자에게 안내된다.`,
      tags: ['negative-condition'],
    });
  }

  for (const recipe of FAIL_RECIPES) {
    if (!req.categories.includes(recipe.key)) continue;
    cases.push({
      scenario: `[실패] ${recipe.title} — ${clean(req.action)}`,
      precondition: buildPrecondition(req),
      steps: [`${req.area} 화면/기능으로 진입한다.`, ...recipe.steps],
      expected: recipe.expected,
      tags: [recipe.key.toLowerCase()],
    });
  }

  if (!cases.length) {
    cases.push({
      scenario: `[실패] 네트워크 단절 상태에서 ${clean(req.action)}`,
      precondition: buildPrecondition(req, '네트워크 차단 도구 준비'),
      steps: [`${req.area} 화면/기능으로 진입한다.`, '네트워크를 차단한다.', `${quote(req.action)} 동작을 수행한다.`],
      expected: '무한 로딩 없이 네트워크 오류 안내가 노출되고 재시도 수단이 제공된다.',
      tags: ['network'],
    });
  }

  return cases.slice(0, limit);
}

/* ---------------------------------------------------------------- Edge TC */

function edgeCases(req, limit) {
  const cases = [];

  for (const c of req.constraints) {
    const points = boundaryPoints(c);
    cases.push({
      scenario: `[경계값] ${fmt(c.value, c.unit)} ${OP_TEXT[c.op] || c.op} 기준 경계 검증 — ${req.area}`,
      precondition: buildPrecondition(req, `기준값: ${fmt(c.value, c.unit)} ${OP_TEXT[c.op] || c.op} (원문: ${c.source})`),
      steps: points.map((p) => `입력값 ${fmt(p.value, c.unit)} (${p.label})로 동작을 수행한다.`),
      expected: points.map((p) => `${fmt(p.value, c.unit)} → ${p.verdict}`).join(' / '),
      tags: ['boundary'],
    });
  }

  if (req.retryCount != null) {
    const n = req.retryCount;
    cases.push({
      scenario: `[경계값] 재시도 ${n}회 소진 및 초과 동작 검증`,
      precondition: buildPrecondition(req, '실패 응답을 강제할 수 있는 목(mock) 환경'),
      steps: [
        `${n - 1}회까지 실패시킨 뒤 다음 시도에서 성공 응답을 준다.`,
        `연속 ${n}회 모두 실패시킨다.`,
        `${n}회 실패 이후 추가 시도를 발생시킨다.`,
      ],
      expected: `마지막 재시도 성공 시 정상 처리된다. ${n}회 모두 실패하면 재시도를 중단하고 최종 실패 처리/안내가 노출된다. ${n}회 초과 요청은 발생하지 않는다.`,
      tags: ['retry', 'boundary'],
    });
  } else if (req.categories.includes('RETRY')) {
    cases.push({
      scenario: `[경계값] 재시도 정책 상한 검증 — ${req.area}`,
      precondition: buildPrecondition(req, '실패 응답을 강제할 수 있는 목(mock) 환경'),
      steps: ['실패 응답을 반복 수신시킨다.', '재시도 호출 횟수와 간격을 네트워크 로그로 계측한다.'],
      expected: '기획서에 정의된 상한 횟수에서 재시도가 멈춘다. 상한이 명시되지 않았다면 기획 확인이 필요한 미정의 항목으로 리포트한다.',
      tags: ['retry', 'spec-gap'],
    });
  }

  if (req.categories.includes('PERFORMANCE')) {
    cases.push({
      scenario: `[경계값] 응답 지연/저속 네트워크에서의 동작 — ${req.area}`,
      precondition: buildPrecondition(req, '3G 수준 네트워크 스로틀링 적용'),
      steps: ['네트워크 속도를 제한한다.', `${quote(req.action)} 동작을 수행한다.`, '로딩 인디케이터와 중복 요청 발생 여부를 확인한다.'],
      expected: '기준 응답시간을 초과하더라도 로딩 상태가 유지되고 중복 요청이 발생하지 않는다.',
      tags: ['performance'],
    });
  }

  if (req.categories.includes('LIST')) {
    cases.push({
      scenario: `[경계값] 목록 0건 / 1건 / 대량 데이터 — ${req.area}`,
      precondition: buildPrecondition(req, '0건, 1건, 페이지 크기+1건, 대량(1만건) 데이터셋 준비'),
      steps: ['0건 상태로 진입한다.', '1건 상태로 진입한다.', '페이지 크기 +1건 상태로 진입해 페이징을 확인한다.', '대량 데이터로 스크롤/정렬/검색을 수행한다.'],
      expected: '0건은 빈 상태 문구, 1건은 정상 렌더, 페이지 경계에서 중복/누락 없이 페이징된다. 대량에서도 정렬/검색 결과가 정확하다.',
      tags: ['boundary', 'list'],
    });
  }

  if (req.categories.includes('ABORT') && !req.constraints.length) {
    cases.push({
      scenario: `[경계값] 이탈 직후 재진입 시 상태 처리 — ${req.area}`,
      precondition: buildPrecondition(req),
      steps: ['처리 중간 단계에서 이탈한다.', '즉시 동일 화면으로 재진입한다.', '이탈 이전 입력값과 서버 상태를 비교한다.'],
      expected: '명세된 이탈 처리 정책(임시저장 또는 초기화)이 일관되게 적용되고, 중복 처리/유령 데이터가 생기지 않는다.',
      tags: ['abort'],
    });
  }

  if (!cases.length) {
    cases.push({
      scenario: `[경계값] 연속 중복 실행(따닥) 및 새로고침 — ${clean(req.action)}`,
      precondition: buildPrecondition(req),
      steps: [`${quote(req.action)} 동작을 1초 내 3회 연속 실행한다.`, '처리 중 새로고침/뒤로가기를 수행한다.'],
      expected: '요청이 1건만 처리되거나 멱등하게 처리된다. 중복 데이터/중복 알림이 생성되지 않는다.',
      tags: ['idempotency'],
    });
  }

  return cases.slice(0, limit);
}

/* ------------------------------------------------------------- 조립/ID 부여 */

const DEFAULTS = {
  includePass: true,
  includeFail: true,
  includeEdge: true,
  maxFailPerRequirement: 3,
  maxEdgePerRequirement: 2,
  idPrefix: 'TC',
};

/**
 * 파싱된 요구사항 목록 → 테스트케이스 목록
 */
function buildTestCases(requirements, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const counters = { P: 0, F: 0, E: 0 };
  const out = [];

  const emit = (req, type, tc) => {
    const code = TYPE_CODE[type];
    counters[code] += 1;
    out.push({
      tc_id: `${opt.idPrefix}-${code}-${String(counters[code]).padStart(3, '0')}`,
      requirement_id: req.id,
      area: req.area,
      type,
      scenario: tc.scenario,
      precondition: tc.precondition,
      steps: tc.steps,
      expected: tc.expected,
      priority: calcPriority(req, type),
      categories: req.categories.map((k) => LABELS[k] || k),
      tags: tc.tags || [],
      source_text: req.text,
      source_line: req.line,
      origin: 'rule',
    });
  };

  for (const req of requirements) {
    if (opt.includePass) passCases(req).forEach((tc) => emit(req, TYPE.PASS, tc));
    if (opt.includeFail) failCases(req, opt.maxFailPerRequirement).forEach((tc) => emit(req, TYPE.FAIL, tc));
    if (opt.includeEdge) edgeCases(req, opt.maxEdgePerRequirement).forEach((tc) => emit(req, TYPE.EDGE, tc));
  }

  return out;
}

function summarize(testCases) {
  const by = (field) => testCases.reduce((acc, tc) => {
    acc[tc[field]] = (acc[tc[field]] || 0) + 1;
    return acc;
  }, {});
  return { total: testCases.length, byType: by('type'), byPriority: by('priority'), byArea: by('area') };
}

module.exports = { buildTestCases, summarize, calcPriority, boundaryPoints, TYPE };
