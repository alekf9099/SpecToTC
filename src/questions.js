'use strict';

/**
 * 요청 확인 항목 — 기획서를 읽은 QA 가 **테스트를 시작하기 위해** 물어봐야 할 것들.
 *
 * 기존 `확인 필요(risks)` 와 다른 물음이다.
 *   · risks     : 문서가 잘못됐거나 모호한 곳 → "이 문장 기준이 뭔가요"
 *   · questions : 문서가 틀리지 않았어도 **테스트를 못 하게 막는 것** → "무슨 계정으로 하나요"
 *
 * 화면(FE)과 연동에 무게를 둔다. 백엔드 로직은 대개 문서에 적히지만,
 * 로딩·빈 상태·에러 문구·타임아웃 화면·서드파티 샌드박스처럼
 * **화면과 연동 경계에서 벌어지는 일**은 문서에 거의 없고 그게 QA 를 멈춰 세운다.
 *
 * 질문은 두 갈래로 만든다.
 *   1) 문서가 유발한 질문 — 결제를 언급했으니 PG 샌드박스를 물어야 한다 (근거 있음)
 *   2) 문서에 없어서 묻는 질문 — 지원 브라우저가 어디에도 없다 (부재가 근거)
 *
 * 근거 없는 일반론은 넣지 않는다. 매번 똑같은 체크리스트가 나오면 아무도 안 읽는다.
 */

const { truncate } = require('./engine/generator');

/** 질문 묶음 — 화면·연동 순으로 둔다 (QA 가 먼저 막히는 순서) */
const GROUPS = [
  { key: 'screen', label: '화면 · 상태', hint: '문서에 거의 없지만 화면을 열면 바로 마주치는 것' },
  { key: 'input', label: '입력 · 검증(프런트)', hint: '언제 · 어디에 · 무슨 문구로 막히는지' },
  { key: 'api', label: '연동 · API 경계', hint: '느리거나 실패했을 때 화면이 어떻게 되는지' },
  { key: 'external', label: '외부 연동', hint: '남의 시스템이라 준비가 필요한 것' },
  { key: 'data', label: '데이터 · 표시 형식', hint: '눈으로 판정하려면 기준이 필요한 것' },
  { key: 'env', label: '검증 환경 · 계정', hint: '이게 없으면 테스트를 시작할 수 없다' },
];

const FRONTEND_GROUPS = new Set(['screen', 'input', 'api', 'external', 'data']);

/**
 * 문서에 이 주제가 이미 적혀 있는지.
 * 적혀 있으면 묻지 않는다 — 이미 답이 있는 걸 물으면 신뢰를 잃는다.
 */
function mentions(text, patterns) {
  return patterns.some((re) => re.test(text));
}

/**
 * 카테고리가 감지됐을 때 던질 질문.
 * `when` 이 참이면 질문이 나가고, `unless` 에 해당하는 표현이 문서에 있으면 빠진다.
 */
const TRIGGERED = [
  /* ---------------------------------------------------------------- 화면 */
  {
    group: 'screen', category: 'LIST', priority: 'High',
    unless: [/빈\s*화면|빈\s*상태|결과가?\s*없|0건|empty/i],
    question: '목록에 결과가 0건일 때 화면에 무엇을 보여주나요? (문구 · 일러스트 · 다음 행동 버튼)',
    why: '0건은 가장 흔한 실패 화면인데 문서에 정의가 없으면 QA 가 결함인지 정상인지 판정할 수 없습니다.',
  },
  {
    group: 'screen', category: 'LIST', priority: 'Med',
    unless: [/페이지네이션|무한\s*스크롤|더\s*보기|정렬\s*기본/],
    question: '목록의 기본 정렬 기준과 페이지 방식(페이지네이션 / 무한 스크롤 / 더 보기)은 무엇인가요?',
    why: '정렬 기본값을 모르면 "순서가 이상하다" 를 결함으로 올릴 수 없습니다.',
  },
  {
    group: 'screen', category: 'PERFORMANCE', priority: 'High',
    unless: [/로딩|스켈레톤|스피너|프로그레스/],
    question: '응답을 기다리는 동안 화면 처리는 무엇인가요? (스피너 · 스켈레톤 · 버튼 비활성)',
    why: '성능 기준이 있는데 대기 중 화면이 없으면 지연 상황을 재현해도 무엇을 확인할지 정할 수 없습니다.',
  },
  {
    group: 'screen', category: 'DESTRUCTIVE', priority: 'High',
    unless: [/확인\s*(창|팝업|모달|다이얼로그)|재확인|되돌리기|취소할\s*수/],
    question: '삭제·되돌릴 수 없는 동작에 확인 단계가 있나요? 실행 후 취소(Undo)는 가능한가요?',
    why: '확인 단계 유무에 따라 테스트 시나리오와 데이터 복구 계획이 완전히 달라집니다.',
  },
  {
    group: 'screen', category: 'NAVIGATION', priority: 'Med',
    unless: [/뒤로\s*가기|브라우저\s*뒤로|새로\s*고침|history/i],
    question: '브라우저 뒤로 가기·새로고침을 했을 때 입력값과 화면 상태는 유지되나요?',
    why: '실사용자가 가장 많이 하는 조작인데 명세가 없으면 유지/초기화 중 무엇이 정답인지 알 수 없습니다.',
  },

  /* ------------------------------------------------------------ 입력·검증 */
  {
    group: 'input', category: 'VALIDATION', priority: 'High',
    unless: [/에러\s*(문구|메시지)|오류\s*문구|안내\s*문구|validation\s*message/i],
    question: '검증 실패 시 문구를 어디에 어떤 문장으로 보여주나요? (필드 하단 · 상단 배너 · 토스트)',
    why: '문구와 위치가 정해져 있지 않으면 "막히긴 하는데 안내가 없다" 를 결함으로 올릴 근거가 없습니다.',
  },
  {
    group: 'input', category: 'VALIDATION', priority: 'Med',
    unless: [/실시간\s*검증|blur|입력\s*중|제출\s*시\s*검증/i],
    question: '검증 시점은 언제인가요? (입력 중 / 포커스 아웃 / 제출 버튼 클릭)',
    why: '시점이 다르면 같은 입력으로도 결과가 달라져 재현 절차를 고정할 수 없습니다.',
  },
  {
    group: 'input', category: 'THRESHOLD', priority: 'High',
    unless: [/초과\s*입력\s*차단|입력\s*제한|maxlength/i],
    question: '최대 길이·최대값을 넘기면 입력 자체를 막나요, 아니면 입력은 되고 제출 시 경고하나요?',
    why: '경계값 테스트의 절차가 갈립니다. 입력이 막히면 초과값 케이스 자체를 만들 수 없습니다.',
  },
  {
    group: 'input', category: 'FILE', priority: 'High',
    unless: [/확장자\s*(검사|차단|제한).*(프런트|클라이언트|화면)/],
    question: '파일 확장자·용량 검사를 화면에서도 하나요, 서버에서만 하나요? 진행률 표시는 있나요?',
    why: '화면에서 막으면 서버 검증을 우회 테스트해야 하고, 서버에서만 막으면 대기 시간 UX 를 봐야 합니다.',
  },

  /* --------------------------------------------------------------- 연동 */
  {
    group: 'api', category: 'ERROR', priority: 'High',
    unless: [/에러\s*코드.*문구|error\s*code.*message/i],
    question: '서버 에러 코드와 화면 문구의 매핑표가 있나요? 없는 코드가 오면 무엇을 보여주나요?',
    why: '매핑표가 없으면 어떤 오류에서 어떤 문구가 정답인지 판정할 수 없고, 미정의 코드 처리도 확인 불가입니다.',
  },
  {
    group: 'api', category: 'PERFORMANCE', priority: 'Med',
    unless: [/타임아웃|timeout/i],
    question: 'API 타임아웃은 몇 초이고, 타임아웃 시 화면은 어떻게 되나요? (재시도 버튼 · 이전 화면 복귀)',
    why: '지연 상황은 프록시로 재현할 수 있지만, 기대 화면이 없으면 관측만 하고 판정을 못 합니다.',
  },
  {
    group: 'api', category: 'RETRY', priority: 'High',
    unless: [/재시도.*(사용자|화면|버튼|안내)/],
    question: '재시도는 자동인가요 사용자 조작인가요? 재시도 중임을 화면에 알리나요?',
    why: '자동 재시도는 사용자가 모르게 지나가므로, 알림 여부에 따라 확인 방법이 달라집니다.',
  },
  {
    group: 'api', category: 'STATE', priority: 'Med',
    unless: [/중복\s*(클릭|제출|요청)|멱등|debounce/i],
    question: '제출 버튼 연타·중복 요청을 막나요? (버튼 비활성 · 멱등키) 서버 중복 처리 정책은요?',
    why: '연타는 가장 쉽게 재현되는 결함 경로인데, 막는 주체가 화면인지 서버인지에 따라 확인 지점이 다릅니다.',
  },
  {
    group: 'api', category: 'AUTH', priority: 'High',
    unless: [/세션\s*만료.*(화면|이동|안내)|토큰\s*만료/],
    question: '작업 도중 세션·토큰이 만료되면 화면이 어떻게 되나요? 입력하던 내용은 보존되나요?',
    why: '만료는 장시간 테스트에서 반드시 마주치며, 보존 여부를 모르면 데이터 유실을 결함으로 볼지 정할 수 없습니다.',
  },

  /* ------------------------------------------------------------ 외부 연동 */
  {
    group: 'external', category: 'PAYMENT', priority: 'High',
    question: '결제 검증용 샌드박스 환경과 테스트 카드를 받을 수 있나요? 실패·취소·부분환불을 임의로 만들 방법은요?',
    why: '실 결제로는 실패 케이스를 만들 수 없습니다. 샌드박스가 없으면 결제 실패 TC 전체가 실행 불가입니다.',
  },
  {
    group: 'external', category: 'PAYMENT', priority: 'High',
    unless: [/콜백|웹훅|webhook|리다이렉트\s*복귀/i],
    question: 'PG 결제창에서 돌아오는 경로(리다이렉트·콜백)는 어떻게 되나요? 창을 닫거나 뒤로 가면요?',
    why: '결제 이탈은 실제로 가장 많이 발생하는데, 복귀 흐름이 없으면 어떤 화면이 정상인지 알 수 없습니다.',
  },
  {
    group: 'external', category: 'NOTIFICATION', priority: 'High',
    question: '알림(메일·SMS·푸시) 발송을 검증할 수신 계정과 발송 결과를 확인할 방법이 있나요?',
    why: '발송했다는 로그만으로는 검증이 끝나지 않습니다. 실제 수신함이나 발송 콘솔 접근이 필요합니다.',
  },
  {
    group: 'external', category: 'AUTH', priority: 'Med',
    unless: [/SSO|OAuth|소셜\s*로그인/i],
    question: '외부 인증(SSO·소셜 로그인)을 쓰나요? 쓴다면 검증 환경에서도 동작하나요?',
    why: '운영 계정만 되는 인증이면 검증 환경에서 로그인 자체가 막혀 이후 TC 를 하나도 못 돕니다.',
  },

  /* --------------------------------------------------------------- 데이터 */
  {
    group: 'data', category: 'PRIVACY', priority: 'High',
    unless: [/마스킹\s*(규칙|형식|자리)/],
    question: '개인정보 마스킹 규칙이 정확히 무엇인가요? (어느 자리를 몇 글자, 목록·상세·다운로드에서 각각)',
    why: '"마스킹한다" 만으로는 화면마다 다른 표기를 결함으로 볼지 판단할 수 없습니다.',
  },
  {
    group: 'data', category: 'PRIVACY', priority: 'Med',
    question: '검증에 쓸 개인정보성 데이터는 어떻게 준비하나요? (가명 데이터 제공 여부 · 실데이터 사용 금지 범위)',
    why: '실데이터를 쓰면 안 되는데 대체 데이터가 없으면 개인정보 관련 TC 를 실행할 수 없습니다.',
  },
  {
    group: 'data', category: 'DISPLAY', priority: 'Med',
    unless: [/타임존|timezone|UTC|서식|포맷/i],
    question: '날짜·금액·수량의 표시 형식과 타임존 기준은 무엇인가요?',
    why: '기준이 없으면 "9시간 차이" 같은 표시 오류를 결함으로 올릴 근거가 없습니다.',
  },
];

/**
 * 문서에 아예 언급이 없을 때 묻는 질문.
 * 부재 자체가 근거이므로 `absent` 패턴이 문서 어디에도 없을 때만 나간다.
 */
const ABSENT = [
  {
    group: 'env', priority: 'High',
    absent: [/https?:\/\//, /검증\s*(환경|서버|URL)|스테이징|staging|dev\s*서버/i],
    question: '검증을 진행할 환경 주소(스테이징·개발 서버)를 알려주세요.',
    why: '주소가 없으면 테스트를 시작할 수 없습니다. 검증 분석서의 "검증 URL" 섹션도 이 값으로 채워집니다.',
  },
  {
    group: 'env', priority: 'High',
    absent: [/테스트\s*계정|검증\s*계정|test\s*account/i],
    question: '역할별 테스트 계정을 받을 수 있나요? (일반 사용자 · 관리자 · 권한 없는 사용자)',
    why: '권한 분기 TC 는 계정이 없으면 전부 실행 불가입니다. 역할이 하나만 있어도 절반이 막힙니다.',
  },
  {
    group: 'env', priority: 'Med',
    absent: [/브라우저|크롬|chrome|사파리|safari|엣지|edge|지원\s*환경/i],
    question: '지원 브라우저·기기 매트릭스가 어떻게 되나요? (모바일 웹 포함 여부)',
    why: '범위가 없으면 어디까지 확인해야 끝인지 알 수 없어 일정 산정이 불가능합니다.',
  },
  {
    group: 'env', priority: 'Med',
    absent: [/배포\s*(일정|예정)|릴리스|release|QA\s*기간/i],
    question: '개발 완료·QA 착수·배포 예정일이 언제인가요? 기능별로 순차 배포되나요?',
    why: '순차 배포면 미완성 기능을 결함으로 올리게 되므로, 회차별 검증 범위를 먼저 나눠야 합니다.',
  },
  {
    group: 'screen', priority: 'Med',
    absent: [/피그마|figma|시안|디자인\s*(링크|파일)|화면\s*설계/i],
    question: '화면 시안(Figma 등) 링크를 받을 수 있나요? 최신 버전이 어느 것인가요?',
    why: '시안이 없으면 레이아웃·문구·상태 표현을 문서 문장만으로 판정해야 해서 UI 결함을 걸러낼 수 없습니다.',
  },
  {
    group: 'api', priority: 'Med',
    absent: [/API\s*(명세|문서|스펙)|swagger|openapi|엔드포인트/i],
    question: 'API 명세(Swagger 등)를 볼 수 있나요? 연동 실패를 임의로 만들 방법(목·에러 강제)이 있나요?',
    why: '연동 실패 화면은 서버를 실패시켜야 볼 수 있습니다. 방법이 없으면 실패 경로 TC 가 전부 막힙니다.',
  },
];

/** 질문 하나를 만든다 — 근거 요구사항을 함께 달아 추적 가능하게 */
function makeQuestion(spec, evidence) {
  return {
    group: spec.group,
    priority: spec.priority || 'Med',
    question: spec.question,
    why: spec.why,
    basis: evidence
      ? { kind: 'requirement', id: evidence.id, line: evidence.line, text: truncate(evidence.text, 70) }
      : { kind: 'absent', id: null, line: null, text: '문서에 관련 언급이 없습니다' },
  };
}

/**
 * 요청 확인 항목을 만든다.
 *
 * @param {Array} requirements parseDocument 결과
 * @param {string} rawText 문서 원문 (언급 여부 판단용)
 * @returns {{groups: Array, total: number, high: number, frontendRatio: number}}
 */
function buildQuestions(requirements, rawText) {
  const text = String(rawText || '');
  const byCategory = new Map();
  for (const req of requirements) {
    for (const cat of req.categories) {
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(req);
    }
  }

  const picked = [];

  // 1) 문서가 유발한 질문 — 감지된 카테고리에서만
  for (const spec of TRIGGERED) {
    const hits = byCategory.get(spec.category);
    if (!hits || !hits.length) continue;
    if (spec.unless && mentions(text, spec.unless)) continue;

    // 근거는 그 카테고리에서 가장 무거운 요구사항 하나로 대표한다
    const evidence = hits.reduce((a, b) => (b.constraints.length > a.constraints.length ? b : a), hits[0]);
    picked.push(makeQuestion(spec, evidence));
  }

  // 2) 문서에 없어서 묻는 질문
  for (const spec of ABSENT) {
    if (mentions(text, spec.absent)) continue;
    picked.push(makeQuestion(spec, null));
  }

  const order = { High: 0, Med: 1, Low: 2 };
  const groups = GROUPS.map((g) => ({
    ...g,
    items: picked.filter((q) => q.group === g.key).sort((a, b) => order[a.priority] - order[b.priority]),
  })).filter((g) => g.items.length);

  const frontend = picked.filter((q) => FRONTEND_GROUPS.has(q.group)).length;

  return {
    groups,
    total: picked.length,
    high: picked.filter((q) => q.priority === 'High').length,
    frontendRatio: picked.length ? Math.round((frontend / picked.length) * 100) : 0,
  };
}

/** 질문 목록을 그대로 붙여넣을 수 있는 마크다운으로 */
function questionsToMarkdown(questions) {
  if (!questions || !questions.groups.length) return '';
  const out = ['## 요청 확인 항목 (기획·개발 확인 요청)', ''];
  out.push(`테스트 착수 전 확인 ${questions.high}건 포함, 총 ${questions.total}건. 화면·연동 비중 ${questions.frontendRatio}%.`, '');

  for (const group of questions.groups) {
    out.push(`### ${group.label}`, '');
    for (const q of group.items) {
      out.push(`- **[${q.priority}] ${q.question}**`);
      out.push(`  - 왜 필요한가: ${q.why}`);
      out.push(`  - 근거: ${q.basis.kind === 'requirement'
        ? `${q.basis.id}${q.basis.line != null ? ` (L${q.basis.line})` : ''} ${q.basis.text}`
        : q.basis.text}`);
    }
    out.push('');
  }
  return out.join('\n');
}

module.exports = { buildQuestions, questionsToMarkdown, GROUPS, TRIGGERED, ABSENT };
