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

/**
 * 영역 이름을 문장에 넣기 좋게 다듬는다 ("1. 로그인" → "로그인").
 * 앞머리 번호는 표의 영역 칸에서 쓰는 것이고, 문장 안에서는 군더더기다.
 */
function screenOf(req) {
  return String(req.area || '대상').replace(/^\s*[\d.]+\s*/, '').trim() || '대상';
}

/**
 * 수행 단계와 기대 결과의 주어를 분리한다.
 *
 * 처음에는 요구사항의 동작절을 그대로 `실행:` 단계에 넣었다. 그런데 동작절은
 * **시스템이 하는 일**이다. "실행: 홈 화면으로 이동하고, 액세스 토큰을 저장한다" 는
 * QA 가 할 수 있는 행동이 아니다. 읽는 사람이 무엇을 해야 하는지 알 수 없다.
 *
 *   수행 단계 → 주어는 QA. "QA 는 로그인 화면에서 로그인 버튼을 누른다"
 *   기대 결과 → 주어는 시스템. "시스템은 홈 화면으로 이동하고 액세스 토큰을 저장한다"
 */
const qa = (body) => `QA 는 ${clean(body)}`;
const sys = (body) => `시스템은 ${clean(body)}`;

function basePrecondition(req, extra) {
  const screen = screenOf(req);
  const items = [`${screen} 화면에 접근할 수 있는 테스트 계정과 데이터가 준비되어 있다`];
  if (req.condition) items.push(`선행 조건: ${clean(req.condition)} 상태를 만들 수 있다`);
  if (extra) items.push(extra);
  return items;
}

/** 요구사항 하나를 실행하기까지의 공통 앞단계 — 진입 → (조건 설정 | 입력) */
function entrySteps(req) {
  const screen = screenOf(req);
  const steps = [step('진입', qa(`${screen} 화면에 진입한다`))];
  steps.push(req.condition
    ? step('조건 설정', qa(`${clean(req.condition)} 상태를 만든다`))
    : step('입력', qa(`${screen} 화면의 입력 항목에 명세에 정의된 정상 값을 입력한다`)));
  return steps;
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
  const action = clean(req.action);
  const screen = screenOf(req);

  const cases = [{
    title: req.condition ? `${clean(req.condition)} → ${action}` : action,
    objective: `${screen} 화면에서 요구사항에 정의된 정상 흐름이 명세대로 동작하는지 확인한다.`,
    precondition: basePrecondition(req),
    steps: [
      ...entrySteps(req),
      step('실행', qa(`${screen} 화면에서 해당 기능을 실행한다 (기대 동작: ${action})`)),
      step('확인', qa('화면에 표시된 결과와 서버 응답을 확인한다')),
    ],
    expected: [
      sys(action),
      '화면에 오류 문구나 경고 알럿이 표시되지 않는다',
      '서버가 2xx 로 응답한다',
    ],
    tags: ['happy-path'],
  }];

  if (req.categories.includes('STATE')) {
    cases.push({
      title: '재진입 후 상태 유지',
      objective: `${screen} 화면에서 저장·동기화된 상태가 재진입 후에도 복원되는지 확인한다.`,
      precondition: basePrecondition(req, `${screen} 기능이 정상 처리로 1회 완료된 상태다`),
      steps: [
        step('진입', qa(`${screen} 화면에 진입한다`)),
        step('실행', qa(`해당 기능을 실행해 상태를 저장한다 (기대 동작: ${action})`)),
        step('조작', qa('브라우저를 새로고침하거나 앱을 다시 실행한다')),
        step('확인', qa(`${screen} 화면에 다시 진입해 이전 상태가 남아 있는지 확인한다`)),
      ],
      expected: [
        sys('직전에 저장한 상태를 그대로 복원한다'),
        sys('같은 데이터를 중복으로 만들지 않는다'),
      ],
      tags: ['persistence'],
    });
  }

  if (req.categories.includes('NOTIFICATION')) {
    cases.push({
      title: '알림 발송',
      objective: `${screen} 기능 수행 시 명세된 채널로 알림이 1건 발송되고 문구가 일치하는지 확인한다.`,
      precondition: basePrecondition(req, '알림 수신 채널(푸시·메일·SMS)이 활성화된 수신 계정이 준비되어 있다'),
      steps: [
        step('진입', qa(`${screen} 화면에 진입한다`)),
        step('실행', qa(`알림을 유발하는 기능을 실행한다 (기대 동작: ${action})`)),
        step('확인', qa('수신 계정의 수신함(푸시·메일·SMS)에서 알림 도착 여부와 문구를 확인한다')),
      ],
      expected: [
        sys('명세된 채널로 알림을 1건 발송한다'),
        '알림 문구와 링크가 기획서에 적힌 내용과 일치한다',
        sys('같은 알림을 중복 발송하지 않는다'),
      ],
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
    objective: (screen) => `${screen} 화면에서 잘못된 입력이 차단되고 사용자에게 사유가 안내되는지 확인한다.`,
    steps: (screen) => [
      step('입력', qa(`${screen} 화면의 필수 항목을 공백으로 두고, 나머지 항목에 형식에 맞지 않는 값을 입력한다`)),
      step('실행', qa('저장·제출 버튼을 누른다')),
      step('확인', qa('요청 차단 여부와 오류 문구가 표시된 위치를 확인한다')),
    ],
    expected: [
      sys('요청을 차단하고 저장하지 않는다'),
      sys('값이 잘못된 필드마다 유효성 오류 문구를 표시한다'),
      sys('서버로 요청을 보내지 않거나, 보냈다면 400 으로 응답한다'),
    ],
  },
  {
    key: 'AUTH',
    title: '미인증 / 권한 없는 계정 접근',
    objective: (screen) => `권한이 없는 사용자가 ${screen} 기능에 접근할 수 없는지 확인한다.`,
    steps: (screen) => [
      step('상태', qa('로그아웃하거나, 해당 기능 권한이 없는 계정으로 로그인한다')),
      step('실행', qa(`${screen} 화면에 진입을 시도한다`)),
      step('실행', qa(`만료된 토큰으로 ${screen} 기능의 API 를 직접 호출한다`)),
      step('확인', qa('화면 노출 여부와 응답 코드를 확인한다')),
    ],
    expected: [
      sys('기능을 노출하지 않거나 401·403 으로 응답한다'),
      sys('로그인 화면이나 권한 안내 화면으로 이동시킨다'),
      sys('API 직접 호출로도 우회 접근을 허용하지 않는다'),
    ],
  },
  {
    key: 'PAYMENT',
    title: '결제 승인 실패',
    objective: (screen) => `${screen} 결제가 실패했을 때 주문이 확정되지 않고 중복 청구가 없는지 확인한다.`,
    steps: (screen) => [
      step('준비', qa('한도 초과 또는 잔액 부족 상태의 테스트 카드를 준비한다')),
      step('실행', qa(`${screen} 화면에서 그 카드로 결제를 시도한다`)),
      step('확인', qa('PG 승인 실패 응답을 받은 뒤 주문 상태와 청구 내역을 확인한다')),
    ],
    expected: [
      sys('주문을 확정하지 않는다'),
      sys('결제가 실패한 사유를 화면에 안내한다'),
      sys('같은 결제를 중복으로 청구하지 않는다'),
    ],
  },
  {
    key: 'FILE',
    title: '허용되지 않는 파일 / 용량 초과',
    objective: (screen) => `${screen} 화면의 확장자·용량 제한이 실제로 차단되는지 확인한다.`,
    steps: (screen) => [
      step('입력', qa(`${screen} 화면에서 허용 확장자가 아닌 파일을 선택한다`)),
      step('실행', qa('용량 제한을 넘는 파일로 업로드를 시도한다')),
      step('확인', qa('업로드 차단 여부와 오류 문구에 적힌 기준을 확인한다')),
    ],
    expected: [
      sys('허용되지 않는 파일의 업로드를 차단한다'),
      sys('허용 확장자와 용량 기준이 포함된 오류 문구를 표시한다'),
    ],
  },
  {
    key: 'NOTIFICATION',
    title: '알림 발송 실패',
    objective: (screen) => `알림 발송이 실패해도 ${screen} 의 주요 흐름이 중단되지 않는지 확인한다.`,
    steps: (screen) => [
      step('준비', qa('수신 채널을 차단하거나 잘못된 수신처로 설정한다')),
      step('실행', qa(`${screen} 화면에서 알림 발송을 유발하는 동작을 수행한다`)),
      step('확인', qa('주요 흐름의 완료 여부와 발송 실패 기록을 확인한다')),
    ],
    expected: [
      sys('발송 실패를 로그로 남긴다'),
      sys('알림 실패를 이유로 주요 흐름을 중단하지 않는다 (정책 확인 필요)'),
    ],
  },
  {
    key: 'DESTRUCTIVE',
    title: '삭제 취소 / 권한 없는 삭제',
    objective: (screen) => `${screen} 의 되돌릴 수 없는 동작이 의도 없이 실행되지 않는지 확인한다.`,
    steps: (screen) => [
      step('실행', qa(`${screen} 화면에서 삭제를 누른 뒤 확인 팝업에서 취소를 선택한다`)),
      step('실행', qa('권한이 없는 계정으로 같은 삭제 API 를 직접 호출한다')),
      step('확인', qa('데이터가 남아 있는지와 응답 코드를 확인한다')),
    ],
    expected: [
      sys('취소했을 때 데이터를 삭제하지 않고 원래 상태를 유지한다'),
      sys('권한 없는 호출을 403 으로 차단한다'),
    ],
  },
  {
    key: 'ABORT',
    title: '중도 이탈 / 타임아웃',
    objective: (screen) => `${screen} 처리 중간에 이탈했을 때 상태가 확정되지 않고 명세된 이탈 처리가 동작하는지 확인한다.`,
    steps: (screen) => [
      step('실행', qa(`${screen} 처리 중간 단계에서 뒤로 가기를 누르거나 앱을 종료한다`)),
      step('실행', qa('응답 대기 중 네트워크를 차단해 타임아웃을 유발한다')),
      step('확인', qa('중간 상태의 확정 여부와 재진입 시 화면을 확인한다')),
    ],
    expected: [
      sys('중간 상태를 확정하지 않는다'),
      sys('명세된 이탈 처리(임시저장·롤백·안내)를 수행한다'),
      sys('처리되지 않은 유령 데이터를 남기지 않는다'),
    ],
  },
  {
    key: 'ERROR',
    title: '서버 오류(5xx) 응답',
    objective: (screen) => `서버 장애 상황에서 ${screen} 화면이 안전하게 실패하는지 확인한다.`,
    steps: (screen) => [
      step('준비', qa('서버가 500 을 반환하도록 목(mock)이나 프록시로 설정한다')),
      step('실행', qa(`${screen} 화면에서 같은 동작을 다시 수행한다`)),
      step('확인', qa('화면 상태와 안내 문구, 재시도 수단을 확인한다')),
    ],
    expected: [
      sys('앱이 죽거나 무한 로딩에 빠지지 않는다'),
      sys('오류 안내 문구를 표시한다'),
      sys('사용자가 다시 시도할 수 있는 수단을 제공한다'),
    ],
  },
];

function failCases(req, limit) {
  const action = clean(req.action);
  const screen = screenOf(req);
  const cases = [];

  if (req.condition) {
    cases.push({
      title: `조건 미충족 상태에서 실행 (조건: ${clean(req.condition)})`,
      objective: `${clean(req.condition)} 조건을 만족하지 않을 때 ${screen} 동작이 차단되고 사유가 안내되는지 확인한다.`,
      precondition: basePrecondition(req, `${clean(req.condition)} 조건을 의도적으로 불충족 상태로 만들 수 있다`),
      steps: [
        step('진입', qa(`${screen} 화면에 진입한다`)),
        step('조건 설정', qa(`${clean(req.condition)} 조건을 불충족 상태로 만든다`)),
        step('실행', qa(`${screen} 화면에서 해당 기능을 실행한다`)),
        step('확인', qa('동작 수행 여부와 안내 문구, 데이터 변경 여부를 확인한다')),
      ],
      expected: [
        sys(`${action} — 이 동작을 수행하지 않는다`),
        sys('조건을 만족하지 않은 사유를 화면에 안내한다'),
        sys('데이터를 변경하지 않는다'),
      ],
      tags: ['negative-condition'],
    });
  }

  for (const recipe of FAIL_RECIPES) {
    if (!req.categories.includes(recipe.key)) continue;
    const screen = screenOf(req);
    const recipeSteps = recipe.steps(screen);
    // `상태:` `준비:` 로 시작하는 레시피는 화면 진입보다 먼저 해야 할 설정이 있고
    // 진입 단계도 제 안에 들고 있다. 앞에 진입을 또 붙이면 순서가 뒤집힌다.
    const needsEntry = !/^(상태|준비):/.test(recipeSteps[0] || '');
    cases.push({
      title: recipe.title,
      objective: recipe.objective(screen),
      precondition: basePrecondition(req),
      steps: needsEntry
        ? [step('진입', qa(`${screen} 화면에 진입한다`)), ...recipeSteps]
        : recipeSteps,
      expected: recipe.expected,
      tags: [recipe.key.toLowerCase()],
    });
  }

  if (!cases.length) {
    cases.push({
      title: '네트워크 단절 상태에서 실행',
      objective: '네트워크 오류 시 무한 로딩 없이 안내와 복구 수단이 제공되는지 확인한다.',
      precondition: basePrecondition(req, '네트워크를 차단할 수 있는 도구(개발자 도구·프록시)가 준비되어 있다'),
      steps: [
        step('진입', qa(`${screen} 화면에 진입한다`)),
        step('준비', qa('개발자 도구나 프록시로 네트워크를 차단한다')),
        step('실행', qa(`${screen} 화면에서 해당 기능을 실행한다 (기대 동작: ${action})`)),
        step('확인', qa('로딩 상태와 안내 문구, 재시도 수단을 확인한다')),
      ],
      expected: [
        sys('무한 로딩에 빠지지 않는다'),
        sys('네트워크 오류 안내 문구를 표시한다'),
        sys('사용자가 다시 시도할 수 있는 수단을 제공한다'),
      ],
      tags: ['network'],
    });
  }

  return cases.slice(0, limit);
}

/* ---------------------------------------------------------------- Edge TC */

function edgeCases(req, limit) {
  const action = clean(req.action);
  const screen = screenOf(req);
  const cases = [];

  for (const c of req.constraints) {
    const points = boundaryPoints(c);
    const criterion = `${fmt(c.value, c.unit)} ${OP_TEXT[c.op] || c.op}`;
    cases.push({
      title: `경계값 ${criterion} 전후 판정`,
      objective: `${screen} 화면에서 기준값 ${criterion} 의 경계 앞뒤로 허용·거부 판정이 정확한지 확인한다.`,
      precondition: basePrecondition(req, `판정 기준: ${criterion} (기획서 표현 "${clean(c.source)}")`),
      steps: [
        step('진입', qa(`${screen} 화면에 진입한다`)),
        ...points.map((p) => step('입력', qa(`해당 항목에 ${fmt(p.value, c.unit)} 을 입력하고 제출한다 — ${p.label}`))),
        step('확인', qa('세 값 각각의 허용·거부 결과와 안내 문구를 확인한다')),
      ],
      expected: points.map((p) => sys(`${fmt(p.value, c.unit)} 입력 시 ${p.verdict}`)),
      tags: ['boundary'],
    });
  }

  if (req.retryCount != null) {
    const n = req.retryCount;
    cases.push({
      title: `재시도 ${n}회 소진 및 초과 동작`,
      objective: `재시도 상한 ${n}회가 지켜지고 소진 후 최종 실패 처리가 되는지 확인한다.`,
      precondition: basePrecondition(req, '서버가 실패 응답을 반환하도록 강제할 수 있는 목(mock) 환경이 준비되어 있다'),
      steps: [
        step('진입', qa(`${screen} 화면에 진입한다`)),
        step('실행', qa(`서버가 ${Math.max(1, n - 1)}회까지 실패하고 다음 시도에서 성공하도록 설정한 뒤 기능을 실행한다`)),
        step('실행', qa(`서버가 연속 ${n}회 모두 실패하도록 설정한 뒤 같은 기능을 실행한다`)),
        step('확인', qa(`네트워크 로그에서 ${n}회 이후 추가 요청이 있었는지 확인한다`)),
      ],
      expected: [
        sys('마지막 재시도가 성공하면 정상 처리한다'),
        sys(`${n}회 모두 실패하면 재시도를 멈추고 최종 실패를 안내한다`),
        sys(`${n}회를 넘는 요청을 보내지 않는다`),
      ],
      tags: ['retry', 'boundary'],
    });
  } else if (req.categories.includes('RETRY')) {
    cases.push({
      title: '재시도 정책 상한 확인 (기획 미정의)',
      objective: '기획서에 재시도 상한이 명시되지 않아 실제 동작을 계측하고 기준을 확정한다.',
      precondition: basePrecondition(req, '서버가 실패 응답을 반복 반환하도록 강제할 수 있는 목(mock) 환경이 준비되어 있다'),
      steps: [
        step('진입', qa(`${screen} 화면에 진입한다`)),
        step('실행', qa('서버가 계속 실패하도록 설정한 뒤 기능을 실행한다')),
        step('확인', qa('네트워크 로그에서 재시도 호출 횟수와 간격을 계측한다')),
      ],
      expected: [
        sys('어떤 상한에서 재시도를 멈춘다 (계측한 값을 기록한다)'),
        '기획서에 상한이 없으므로 계측값을 기획 확인 항목으로 올린다',
      ],
      tags: ['retry', 'spec-gap'],
    });
  }

  if (req.categories.includes('PERFORMANCE')) {
    cases.push({
      title: '저속 네트워크/응답 지연 시 동작',
      objective: '응답이 느릴 때 로딩 상태 유지와 중복 요청 방지가 되는지 확인한다.',
      precondition: basePrecondition(req, '개발자 도구로 3G 수준의 네트워크 스로틀링을 걸 수 있다'),
      steps: [
        step('준비', qa('개발자 도구에서 네트워크 속도를 3G 수준으로 제한한다')),
        step('진입', qa(`${screen} 화면에 진입한다`)),
        step('실행', qa(`해당 기능을 실행한다 (기대 동작: ${action})`)),
        step('확인', qa('로딩 표시 유지 여부와 같은 요청이 중복으로 나갔는지 네트워크 로그에서 확인한다')),
      ],
      expected: [
        sys('기준 응답시간을 넘겨도 로딩 상태를 유지한다'),
        sys('같은 요청을 중복으로 보내지 않는다'),
        sys('타임아웃되면 안내 문구를 표시한다'),
      ],
      tags: ['performance'],
    });
  }

  if (req.categories.includes('LIST')) {
    cases.push({
      title: '목록 0건 / 1건 / 페이지 경계 / 대량 데이터',
      objective: '데이터 개수 경계에서 렌더·페이징·정렬이 정확한지 확인한다.',
      precondition: basePrecondition(req, '0건·1건·페이지 크기+1건·대량(1만 건) 데이터셋을 각각 준비할 수 있다'),
      steps: [
        step('확인', qa(`데이터가 0건인 상태로 ${screen} 목록에 진입한다`)),
        step('확인', qa(`데이터가 1건인 상태로 ${screen} 목록에 진입한다`)),
        step('확인', qa('페이지 크기보다 1건 많은 상태에서 다음 페이지로 이동한다')),
        step('확인', qa('대량 데이터 상태에서 스크롤·정렬·검색을 수행한다')),
      ],
      expected: [
        sys('0건일 때 빈 상태 문구를 표시한다'),
        sys('1건일 때도 목록을 정상 표시한다'),
        sys('페이지 경계에서 항목을 중복하거나 누락하지 않는다'),
        sys('대량 데이터에서도 정렬·검색 결과를 정확히 반환한다'),
      ],
      tags: ['boundary', 'list'],
    });
  }

  if (req.categories.includes('ABORT') && !req.constraints.length) {
    cases.push({
      title: '이탈 직후 재진입 시 상태 처리',
      objective: '이탈 처리 정책이 일관되게 적용되는지 확인한다.',
      precondition: basePrecondition(req),
      steps: [
        step('진입', qa(`${screen} 화면에 진입해 처리를 시작한다`)),
        step('실행', qa('중간 단계에서 뒤로 가기나 창 닫기로 이탈한다')),
        step('실행', qa(`곧바로 ${screen} 화면에 다시 진입한다`)),
        step('확인', qa('이탈 전 입력값이 남아 있는지와 서버 상태를 함께 확인한다')),
      ],
      expected: [
        sys('명세된 이탈 정책(임시저장 또는 초기화)을 일관되게 적용한다'),
        sys('같은 처리를 중복 수행하거나 유령 데이터를 남기지 않는다'),
      ],
      tags: ['abort'],
    });
  }

  if (!cases.length) {
    cases.push({
      title: '연속 중복 실행(따닥) 및 처리 중 새로고침',
      objective: `${screen} 화면에서 같은 요청이 여러 번 들어와도 멱등하게 처리되는지 확인한다.`,
      precondition: basePrecondition(req),
      steps: [
        step('진입', qa(`${screen} 화면에 진입한다`)),
        step('실행', qa(`실행 버튼을 1초 안에 3회 연속으로 누른다 (기대 동작: ${action})`)),
        step('실행', qa('처리가 끝나기 전에 새로고침하거나 뒤로 가기를 누른다')),
        step('확인', qa('생성된 데이터 건수와 발송된 알림 건수를 확인한다')),
      ],
      expected: [
        sys('요청을 1건만 처리하거나 멱등하게 처리한다'),
        sys('데이터나 알림을 중복으로 만들지 않는다'),
      ],
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

/** 이 TC 가 무엇을 대상으로 하는지 — 제목에서 케이스를 구분해 주는 부분 */
function subjectOf(req) {
  // 자르지 않는다. CSV·PDF 는 읽고 실행하는 문서라 "…" 로 끊기면 내용을 알 수 없다.
  // 화면 표가 길어지는 문제는 CSS 줄 제한으로 처리한다.
  return clean(req.action || req.text);
}

/**
 * 표에서 한 줄만 보고 무슨 테스트인지 알 수 있는 제목을 만든다.
 *
 * 두 가지를 고친 결과다.
 *   1) 영역을 제목에서 뺐다. 화면 표와 CSV 모두 `영역` 이 별도 칸이라 그대로 중복이었다.
 *   2) 레시피 제목에 대상을 붙인다. "미인증 / 권한 없는 계정 접근" 은 한 영역 안에서
 *      요구사항마다 똑같이 나와, 표에서 네 줄이 완전히 구별되지 않았다.
 */
function scenarioTitle(req, tc) {
  const base = clean(tc.title);
  if (tc.generic === false) return base;

  const subject = subjectOf(req);
  if (!subject) return base;

  // 이미 대상이 제목에 들어 있으면(정상 흐름처럼 제목 자체가 대상인 경우) 덧붙이지 않는다.
  // 둘 다 길이 제한으로 잘려 있을 수 있어 말줄임을 떼고 앞부분으로 비교한다.
  const head = (s) => s.replace(/…$/, '');
  if (base.includes(subject) || subject.includes(base)) return base;
  if (base.startsWith(head(subject)) || subject.startsWith(head(base))) return base;

  return `${base} — ${subject}`;
}

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
    const title = `[${TYPE_TAG[type]}] ${scenarioTitle(req, tc)}`;

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
