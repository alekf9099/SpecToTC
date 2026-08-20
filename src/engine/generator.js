'use strict';

const { CATEGORIES } = require('./dictionary');

const WEIGHTS = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.weight]));
const LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

const TYPE = { PASS: 'Pass', FAIL: 'Fail', EDGE: 'Edge Case' };
const TYPE_CODE = { [TYPE.PASS]: 'P', [TYPE.FAIL]: 'F', [TYPE.EDGE]: 'E' };

/* ------------------------------------------------------------------ 문구 유틸 */

/** 문장 끝 종결부호를 떼어 다른 문장에 끼워 넣기 좋은 형태로 만든다. */
function clean(text) {
  return String(text == null ? '' : text).trim().replace(/[.;,]+$/, '');
}

/** 표/제목에서 길게 늘어진 문장을 읽기 좋은 길이로 자른다. */
function truncate(text, limit = 90) {
  const s = clean(text);
  if (s.length <= limit) return s;
  return `${s.slice(0, limit - 1).replace(/\s+\S*$/, '')}…`;
}

/** 조사 문제를 피하기 위해 "레이블: 내용" 형태로 단계를 구성한다. */
const step = (label, body) => `${label}: ${clean(body)}`;

/* ------------------------------------------------------------------ 중요도 */

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

/* --------------------------------------------------------------- 공통 조립 */

function basePrecondition(req, extra) {
  const items = [`${req.area} 진입 가능한 테스트 계정/데이터 준비`];
  if (req.condition) items.push(`선행 조건 — ${truncate(req.condition, 70)}`);
  if (extra) items.push(extra);
  return items;
}

function delta(value) {
  return Number.isInteger(value) ? 1 : Math.pow(10, -String(value).split('.')[1].length);
}

function fmt(value, unit) {
  const n = Number.isInteger(value) ? value : Number(value.toFixed(4));
  if (!unit) return `${n}`;
  // 한글 단위는 붙여 쓰고(8글자), 영문 단위는 띄어 쓴다(10 MB).
  return /^[A-Za-z]/.test(unit) ? `${n} ${unit}` : `${n}${unit}`;
}

/** "8글자 이상" 형태의 기준 문구 — 요약/TC 에서 공통으로 쓴다. */
function formatCriterion(c) {
  return `${fmt(c.value, c.unit)} ${OP_TEXT[c.op] || c.op}`;
}

const OP_TEXT = { '>=': '이상', '<=': '이하', '>': '초과', '<': '미만' };

/** 경계값 3점(내부/경계/외부)과 각 기대 판정 */
function boundaryPoints(c) {
  const d = delta(c.value);
  const inside = { '>=': c.value + d, '<=': c.value - d, '>': c.value + d * 2, '<': c.value - d * 2 };
  const outside = { '>=': c.value - d, '<=': c.value + d, '>': c.value, '<': c.value };
  const atBoundaryPasses = c.op === '>=' || c.op === '<=';

  return [
    { value: outside[c.op], verdict: '거부 + 유효성 안내', label: '경계 외부', pass: false },
    { value: c.value, verdict: atBoundaryPasses ? '허용 + 정상 처리' : '거부 + 유효성 안내', label: '경계 정확값', pass: atBoundaryPasses },
    { value: inside[c.op], verdict: '허용 + 정상 처리', label: '경계 내부', pass: true },
  ];
}

/* ---------------------------------------------------------------- Pass TC */

function passCases(req) {
  const action = truncate(req.action, 60);

  const cases = [{
    title: req.condition ? `${truncate(req.condition, 32)} → ${action}` : action,
    objective: '요구사항에 정의된 정상 흐름이 명세대로 동작하는지 확인한다.',
    precondition: basePrecondition(req),
    steps: [
      step('진입', `${req.area} 화면/기능`),
      req.condition ? step('조건 설정', req.condition) : step('입력', '명세에 정의된 정상 값'),
      step('실행', action),
      step('확인', '화면 표시 결과 + 서버 응답'),
    ],
    expected: [
      `요구사항대로 처리됨 — ${action}`,
      '오류 문구·알럿 미발생',
      '서버 응답 정상(2xx)',
    ],
    tags: ['happy-path'],
  }];

  if (req.categories.includes('STATE')) {
    cases.push({
      title: `${action} 후 재진입 시 상태 유지`,
      objective: '저장/동기화된 상태가 재진입 후에도 복원되는지 확인한다.',
      precondition: basePrecondition(req, '정상 처리 1회 완료된 상태'),
      steps: [step('실행', action), step('조작', '새로고침 또는 앱 재실행'), step('확인', '동일 화면 재진입')],
      expected: ['이전 저장 상태 그대로 복원', '중복 데이터 미생성'],
      tags: ['persistence'],
    });
  }

  if (req.categories.includes('NOTIFICATION')) {
    cases.push({
      title: `${action} 시 알림 발송`,
      objective: '명세된 채널로 알림이 1건 발송되고 문구가 일치하는지 확인한다.',
      precondition: basePrecondition(req, '알림 수신 채널(푸시/메일/SMS) 활성화'),
      steps: [step('실행', action), step('확인', '수신 채널에서 알림 도착 여부')],
      expected: ['명세 채널로 1건 발송', '문구·링크가 기획서와 일치', '중복 발송 없음'],
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
    objective: '잘못된 입력이 차단되고 사용자에게 사유가 안내되는지 확인한다.',
    steps: [
      step('입력', '필수 항목 공백 또는 형식에 맞지 않는 값'),
      step('실행', '저장/제출'),
    ],
    expected: ['요청 차단', '해당 필드에 유효성 오류 문구 노출', '서버 요청 미발생 또는 400 응답'],
  },
  {
    key: 'AUTH',
    title: '미인증 / 권한 없는 계정 접근',
    objective: '권한이 없는 주체가 기능에 접근할 수 없는지 확인한다.',
    steps: [
      step('상태', '로그아웃 또는 권한 없는 계정'),
      step('실행', '기능 접근 및 만료 토큰으로 API 직접 호출'),
    ],
    expected: ['기능 미노출 또는 401/403 응답', '로그인·권한 안내 화면으로 유도', '우회 접근 불가'],
  },
  {
    key: 'PAYMENT',
    title: '결제 승인 실패',
    objective: '결제 실패 시 주문이 확정되지 않고 중복 청구가 없는지 확인한다.',
    steps: [
      step('준비', '한도 초과/잔액 부족 카드'),
      step('실행', '결제 시도 후 PG 승인 실패 응답 수신'),
    ],
    expected: ['주문 미확정', '실패 사유 안내', '중복 청구 없음'],
  },
  {
    key: 'FILE',
    title: '허용되지 않는 파일 / 용량 초과',
    objective: '확장자·용량 제한이 실제로 차단되는지 확인한다.',
    steps: [
      step('입력', '허용 확장자가 아닌 파일'),
      step('실행', '용량 제한 초과 파일 업로드'),
    ],
    expected: ['업로드 차단', '허용 확장자·용량 기준이 포함된 오류 문구 노출'],
  },
  {
    key: 'NOTIFICATION',
    title: '알림 발송 실패',
    objective: '알림 실패가 본 기능의 주요 흐름을 중단시키지 않는지 확인한다.',
    steps: [
      step('준비', '수신 채널 차단 또는 잘못된 수신처'),
      step('실행', '발송을 유발하는 동작'),
    ],
    expected: ['발송 실패 로그 기록', '주요 흐름은 실패로 중단되지 않음(정책 확인 필요)'],
  },
  {
    key: 'DESTRUCTIVE',
    title: '삭제 취소 / 권한 없는 삭제',
    objective: '되돌릴 수 없는 동작이 의도 없이 실행되지 않는지 확인한다.',
    steps: [
      step('실행', '삭제 확인 팝업에서 취소'),
      step('실행', '권한 없는 계정으로 동일 삭제 API 호출'),
    ],
    expected: ['데이터 미삭제 및 원상태 유지', '권한 없는 호출 403 차단'],
  },
  {
    key: 'ABORT',
    title: '중도 이탈 / 타임아웃',
    objective: '중간 이탈 시 상태가 확정되지 않고 명세된 이탈 처리가 동작하는지 확인한다.',
    steps: [
      step('실행', '처리 중간 단계에서 뒤로가기 또는 앱 종료'),
      step('실행', '응답 대기 중 네트워크 차단으로 타임아웃 유발'),
    ],
    expected: ['중간 상태 미확정', '명세된 이탈 처리(임시저장/롤백/안내) 동작', '유령 데이터 미생성'],
  },
  {
    key: 'ERROR',
    title: '서버 오류(5xx) 응답',
    objective: '서버 장애 상황에서 앱이 안전하게 실패하는지 확인한다.',
    steps: [
      step('준비', '서버가 500 을 반환하도록 목(mock) 처리'),
      step('실행', '동일 동작 재수행'),
    ],
    expected: ['크래시·무한 로딩 없음', '오류 안내 문구 노출', '재시도 수단 제공'],
  },
];

function failCases(req, limit) {
  const action = truncate(req.action, 60);
  const cases = [];

  if (req.condition) {
    cases.push({
      title: `조건 미충족(${truncate(req.condition, 28)} 아님) 상태에서 실행`,
      objective: '조건을 만족하지 않을 때 동작이 차단되고 사유가 안내되는지 확인한다.',
      precondition: basePrecondition(req, `${truncate(req.condition, 60)} 조건을 의도적으로 불충족 상태로 설정`),
      steps: [
        step('진입', `${req.area} 화면/기능`),
        step('조건 설정', `${req.condition} — 불충족`),
        step('실행', action),
      ],
      expected: [`동작 미수행 — ${action}`, '조건 미충족 사유 안내', '데이터 변경 없음'],
      tags: ['negative-condition'],
    });
  }

  for (const recipe of FAIL_RECIPES) {
    if (!req.categories.includes(recipe.key)) continue;
    cases.push({
      title: recipe.title,
      objective: recipe.objective,
      precondition: basePrecondition(req),
      steps: [step('진입', `${req.area} 화면/기능`), ...recipe.steps],
      expected: recipe.expected,
      tags: [recipe.key.toLowerCase()],
    });
  }

  if (!cases.length) {
    cases.push({
      title: '네트워크 단절 상태에서 실행',
      objective: '네트워크 오류 시 무한 로딩 없이 안내와 복구 수단이 제공되는지 확인한다.',
      precondition: basePrecondition(req, '네트워크 차단 도구 준비'),
      steps: [step('진입', `${req.area} 화면/기능`), step('준비', '네트워크 차단'), step('실행', action)],
      expected: ['무한 로딩 없음', '네트워크 오류 안내 노출', '재시도 수단 제공'],
      tags: ['network'],
    });
  }

  return cases.slice(0, limit);
}

/* ---------------------------------------------------------------- Edge TC */

function edgeCases(req, limit) {
  const action = truncate(req.action, 60);
  const cases = [];

  for (const c of req.constraints) {
    const points = boundaryPoints(c);
    const criterion = `${fmt(c.value, c.unit)} ${OP_TEXT[c.op] || c.op}`;
    cases.push({
      title: `경계값 ${criterion} 전후 판정`,
      objective: `기준값 ${criterion} 의 경계에서 허용/거부 판정이 정확한지 확인한다.`,
      precondition: basePrecondition(req, `기준: ${criterion} (기획서 표현 "${c.source}")`),
      steps: points.map((p) => step('입력', `${fmt(p.value, c.unit)} — ${p.label}`)),
      expected: points.map((p) => `${fmt(p.value, c.unit)} → ${p.verdict}`),
      tags: ['boundary'],
    });
  }

  if (req.retryCount != null) {
    const n = req.retryCount;
    cases.push({
      title: `재시도 ${n}회 소진 및 초과 동작`,
      objective: `재시도 상한 ${n}회가 지켜지고 소진 후 최종 실패 처리가 되는지 확인한다.`,
      precondition: basePrecondition(req, '실패 응답을 강제할 수 있는 목(mock) 환경'),
      steps: [
        step('실행', `${Math.max(1, n - 1)}회까지 실패 후 다음 시도에서 성공 응답`),
        step('실행', `연속 ${n}회 모두 실패`),
        step('확인', `${n}회 실패 이후 추가 시도 발생 여부 (네트워크 로그)`),
      ],
      expected: [
        '마지막 재시도 성공 시 정상 처리',
        `${n}회 모두 실패 시 재시도 중단 + 최종 실패 안내`,
        `${n}회 초과 요청 미발생`,
      ],
      tags: ['retry', 'boundary'],
    });
  } else if (req.categories.includes('RETRY')) {
    cases.push({
      title: '재시도 정책 상한 확인 (기획 미정의)',
      objective: '기획서에 재시도 상한이 명시되지 않아 실제 동작을 계측하고 기준을 확정한다.',
      precondition: basePrecondition(req, '실패 응답을 강제할 수 있는 목(mock) 환경'),
      steps: [step('실행', '실패 응답 반복 수신'), step('확인', '재시도 호출 횟수·간격 계측')],
      expected: ['상한 횟수에서 재시도 중단', '상한 미명시 시 기획 확인 필요 항목으로 리포트'],
      tags: ['retry', 'spec-gap'],
    });
  }

  if (req.categories.includes('PERFORMANCE')) {
    cases.push({
      title: '저속 네트워크/응답 지연 시 동작',
      objective: '응답이 느릴 때 로딩 상태 유지와 중복 요청 방지가 되는지 확인한다.',
      precondition: basePrecondition(req, '3G 수준 네트워크 스로틀링 적용'),
      steps: [step('준비', '네트워크 속도 제한'), step('실행', action), step('확인', '로딩 인디케이터 + 중복 요청 발생 여부')],
      expected: ['기준 응답시간 초과에도 로딩 상태 유지', '중복 요청 미발생', '타임아웃 시 안내 노출'],
      tags: ['performance'],
    });
  }

  if (req.categories.includes('LIST')) {
    cases.push({
      title: '목록 0건 / 1건 / 페이지 경계 / 대량 데이터',
      objective: '데이터 개수 경계에서 렌더·페이징·정렬이 정확한지 확인한다.',
      precondition: basePrecondition(req, '0건, 1건, 페이지 크기+1건, 대량(1만건) 데이터셋 준비'),
      steps: [
        step('확인', '0건 상태 진입'),
        step('확인', '1건 상태 진입'),
        step('확인', '페이지 크기 +1건 상태에서 페이징'),
        step('확인', '대량 데이터에서 스크롤·정렬·검색'),
      ],
      expected: ['0건은 빈 상태 문구', '1건 정상 렌더', '페이지 경계에서 중복·누락 없음', '대량에서도 정렬·검색 결과 정확'],
      tags: ['boundary', 'list'],
    });
  }

  if (req.categories.includes('ABORT') && !req.constraints.length) {
    cases.push({
      title: '이탈 직후 재진입 시 상태 처리',
      objective: '이탈 처리 정책이 일관되게 적용되는지 확인한다.',
      precondition: basePrecondition(req),
      steps: [
        step('실행', '처리 중간 단계에서 이탈'),
        step('실행', '즉시 동일 화면 재진입'),
        step('확인', '이탈 이전 입력값 및 서버 상태 비교'),
      ],
      expected: ['명세된 정책(임시저장 또는 초기화) 일관 적용', '중복 처리·유령 데이터 미생성'],
      tags: ['abort'],
    });
  }

  if (!cases.length) {
    cases.push({
      title: '연속 중복 실행(따닥) 및 처리 중 새로고침',
      objective: '중복 요청이 멱등하게 처리되는지 확인한다.',
      precondition: basePrecondition(req),
      steps: [step('실행', `${action} — 1초 내 3회 연속`), step('실행', '처리 중 새로고침/뒤로가기')],
      expected: ['요청 1건만 처리 또는 멱등 처리', '중복 데이터·중복 알림 미생성'],
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

const TYPE_TAG = { [TYPE.PASS]: '정상', [TYPE.FAIL]: '실패', [TYPE.EDGE]: '경계' };

/**
 * 파싱된 요구사항 목록 → 테스트케이스 목록
 *
 * 출력 구조는 "다른 사람이 표만 보고 실행할 수 있는가"를 기준으로 설계했다.
 *   title       한 줄 제목 (무엇을 검증하는 케이스인지)
 *   objective   검증 목적 (왜 이 TC 가 필요한지)
 *   precondition/steps/expected  모두 배열 — 표·CSV 에서 줄 단위로 읽힌다
 *   requirement 근거 요구사항(원문·라인) — 기획서로 역추적 가능
 */
function buildTestCases(requirements, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const counters = { P: 0, F: 0, E: 0 };
  const out = [];

  const emit = (req, type, tc) => {
    const code = TYPE_CODE[type];
    counters[code] += 1;
    const title = `[${TYPE_TAG[type]}] ${req.area} — ${tc.title}`;

    out.push({
      tc_id: `${opt.idPrefix}-${code}-${String(counters[code]).padStart(3, '0')}`,
      type,
      priority: calcPriority(req, type),
      area: req.area,
      title,
      objective: tc.objective,
      precondition: tc.precondition,
      steps: tc.steps,
      expected: tc.expected,
      requirement: {
        id: req.id,
        text: req.text,
        line: req.line,
        categories: req.categories.map((k) => LABELS[k] || k),
      },
      tags: tc.tags || [],
      origin: 'rule',

      // 하위 호환 필드 — 기존 스크립트/시트가 참조할 수 있어 남겨둔다.
      scenario: title,
      requirement_id: req.id,
      source_text: req.text,
      source_line: req.line,
      categories: req.categories.map((k) => LABELS[k] || k),
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

module.exports = {
  buildTestCases, summarize, calcPriority, boundaryPoints,
  TYPE, clean, truncate, step, LABELS, WEIGHTS, fmt, formatCriterion,
};
