'use strict';

/**
 * QA/QC 검증 분석서 생성 — 사내 표준 6개 고정 섹션.
 *
 *   1. QC·QA 검증 진행 시 참고해야 할 점   (관점별 확인 사항 + 준비 체크리스트)
 *   2. 검증 시 진행해야 할 URL
 *   3. 프로젝트 동작 흐름 (mermaid)
 *   4. Figma 링크
 *   5. 목표가 아닌 것 (Out of Scope)
 *   6. 목표 (In Scope)
 *
 * 섹션 순서·제목을 고정하는 것이 핵심이다. 매번 형식이 흔들리면 검증 담당자가
 * 문서마다 다시 적응해야 한다. 문서에서 확인되지 않은 항목은 비워두지 않고
 * NOT_SPECIFIED 로 표기해 "확인 필요"임을 드러낸다.
 */
const { truncate, clean } = require('./engine/generator');

const NOT_SPECIFIED = '(문서에 명시되지 않음 — 확인 필요)';

/**
 * 문서의 메타 섹션 — 기능 영역이 아니므로 흐름도·보장 문장에서 제외한다.
 * ("목적", "3. 범위" 같은 제목이 화면 이름처럼 섞이면 분석서가 어색해진다.)
 */
const META_AREA_RE = /^(?:\d+(?:\.\d+)*\.?\s*)?(목적|목표|개요|배경|범위|용어|참고|비고|변경\s*이력|이력|revision|history|overview|purpose|scope|glossary|미분류)/i;

const isFeatureArea = (area) => Boolean(area) && !META_AREA_RE.test(String(area).trim());

const has = (reqs, key) => reqs.some((r) => r.categories.includes(key));
const pick = (reqs, key) => reqs.filter((r) => r.categories.includes(key));

/* ------------------------------------------------------- §2 검증 URL 목록 */

const FIGMA_RE = /https?:\/\/(?:www\.)?figma\.com\/[^\s)>\]"'`]+/gi;
const ABS_URL_RE = /https?:\/\/[^\s)>\]"'`]+/gi;
// "/board/list", "/api/posts/{id}" 형태의 경로. 날짜(/2026)·소수점만 있는 토큰은 제외한다.
const PATH_RE = /(?:^|[\s(["'`|>])(\/(?:[a-zA-Z][\w\-.{}:]*)(?:\/[\w\-.{}:$]*)*)/g;

/** 경로/URL 이 어떤 권한을 요구하는지 문맥에서 추정 */
function guessAccess(context) {
  if (/관리자|admin|백오피스|back ?office|운영자/i.test(context)) return '관리자';
  if (/로그인\s*(후|필요|한)|회원만|인증\s*필요|logged ?in|authenticated/i.test(context)) return '회원';
  if (/비로그인|누구나|전체\s*공개|public|guest/i.test(context)) return '전체';
  return `전체 ${NOT_SPECIFIED}`;
}

/** 영역의 카테고리로부터 핵심 검증 시나리오 문구를 만든다 */
const SCENARIO_BY_CATEGORY = {
  LIST: '페이징 · 정렬 · 검색 · 0건 표시',
  AUTH: '권한 경계(비로그인/일반/관리자) · 세션 만료',
  VALIDATION: '필수값 · 길이/형식 제한 · 특수문자(XSS)',
  PAYMENT: '결제 성공/실패 · 중복 청구 · 환불',
  FILE: '허용 확장자 · 용량 초과 · 첨부 개수',
  DESTRUCTIVE: '삭제 확인/취소 · 권한 없는 삭제 · 목록 반영',
  NOTIFICATION: '발송 채널 · 문구 일치 · 중복 발송',
  PERFORMANCE: '응답시간 기준 · 저속 네트워크',
  ABORT: '중도 이탈 · 타임아웃 · 재진입',
  NAVIGATION: '화면 이동 · 뒤로가기 · 딥링크',
};

function scenarioFor(categories) {
  const hits = categories.map((c) => SCENARIO_BY_CATEGORY[c]).filter(Boolean);
  return hits.length ? [...new Set(hits)].slice(0, 3).join(' / ') : '정상 흐름 + 실패 처리';
}

function collectUrls(rawText, requirements) {
  const text = String(rawText || '');
  const rows = [];
  const seen = new Set();

  /** 해당 문자열이 등장한 줄과, 그 줄이 속한 영역을 찾는다 */
  const lines = text.split('\n');
  const locate = (needle) => {
    const idx = lines.findIndex((l) => l.includes(needle));
    if (idx < 0) return { context: '', area: null };
    const req = requirements.find((r) => r.line === idx + 1)
      || requirements.filter((r) => r.line <= idx + 1).slice(-1)[0];
    return { context: lines[idx], area: req ? req.area : null };
  };

  const push = (url) => {
    const key = url.replace(/[.,;)]+$/, '');
    if (seen.has(key) || FIGMA_RE.test(key)) return;
    FIGMA_RE.lastIndex = 0;
    seen.add(key);
    const { context, area } = locate(key);
    const req = requirements.find((r) => r.area === area);
    rows.push({
      screen: area || NOT_SPECIFIED,
      path: key,
      access: guessAccess(`${context} ${area || ''}`),
      scenario: scenarioFor(req ? req.categories : []),
    });
  };

  for (const m of text.matchAll(ABS_URL_RE)) push(m[0]);
  for (const m of text.matchAll(PATH_RE)) push(m[1]);

  return rows.slice(0, 40);
}

function collectFigma(rawText) {
  const found = [...String(rawText || '').matchAll(FIGMA_RE)].map((m) => m[0].replace(/[.,;)]+$/, ''));
  return [...new Set(found)];
}

/* ------------------------------------------------------- §3 동작 흐름 */

/**
 * 영역과 조건 분기로 mermaid flowchart 를 만든다.
 * (앱에서는 코드 블록으로 보여주고, Notion·GitHub 에 붙이면 그림으로 렌더된다.)
 *
 * 어느 영역이 비로그인으로 접근 가능한지는 문서만으로 단정할 수 없으므로 추측하지 않는다.
 * 인증 영역이 있으면 진입 관문으로만 배치하고, 판단이 필요한 부분은 caption 으로 알린다.
 */
function buildFlow(requirements, areas) {
  if (!areas.length) return { mermaid: null, caption: NOT_SPECIFIED };

  const safe = (s) => clean(s).replace(/[\[\]{}()"|]/g, '').slice(0, 28) || '단계';
  // 관문은 영역 이름 자체가 인증을 뜻할 때만 둔다. 단순히 AUTH 키워드가 섞였다는 이유로
  // 임의의 기능 영역을 로그인 관문으로 세우면 흐름을 잘못 단정하게 된다.
  const authArea = areas.find((a) => /로그인|인증|가입|계정|login|sign\s?in|sign\s?up|auth/i.test(a));
  const authElsewhere = !authArea && pick(requirements, 'AUTH').length > 0;
  const rest = areas.filter((a) => a !== authArea).slice(0, 5);

  const lines = ['flowchart TD', '    START[사용자 진입]'];
  let hub = 'START';

  if (authArea) {
    lines.push(`    START --> AUTH[${safe(authArea)}]`);
    lines.push('    AUTH --> AUTHR{인증 성공 여부}');
    lines.push('    AUTHR -- 실패 --> AUTHNG[사유 안내 · 재시도]');
    lines.push('    AUTHR -- 성공 --> HUB[기능 진입]');
    hub = 'HUB';
  }

  (rest.length ? rest : areas).forEach((a, i) => {
    lines.push(`    ${hub} --> F${i}[${safe(a)}]`);
    lines.push(`    F${i} --> R${i}{정상 / 실패}`);
    lines.push(`    R${i} -- 정상 --> OK${i}[처리 완료 · 결과 반영]`);
    lines.push(`    R${i} -- 실패 --> NG${i}[사유 안내 · 상태 원복]`);
  });

  let caption;
  if (authArea) {
    caption = `"${authArea}" 영역을 진입 관문으로 배치했습니다. 각 기능의 비로그인 접근 허용 여부는 문서에서 확정되지 않아 기획 확인이 필요합니다.`;
  } else if (authElsewhere) {
    caption = '인증 관련 요구사항이 개별 기능 안에 섞여 있어 별도 로그인 관문을 두지 않았습니다. 기능별 접근 권한은 기획 확인이 필요합니다.';
  } else {
    caption = '문서에 인증 관련 요구사항이 없어 로그인 관문 없이 구성했습니다. 권한 모델은 기획 확인이 필요합니다.';
  }

  return { mermaid: lines.join('\n'), caption };
}

/* --------------------------------------------- §1 검증 참고사항 / 체크리스트 */

/** 문서에서 등장한 역할(권한) 키워드 */
function detectRoles(rawText) {
  const roles = [];
  const text = String(rawText || '');
  if (/비로그인|게스트|guest|익명/i.test(text)) roles.push('비로그인');
  if (/일반\s*회원|회원|사용자|user|member/i.test(text)) roles.push('일반회원');
  if (/관리자|admin|운영자|백오피스/i.test(text)) roles.push('관리자');
  return roles;
}

function buildCheckpoints(requirements, rawText) {
  const item = (what, why, how) => ({ what, why, how });
  const groups = [];

  /* 권한/역할 경계 */
  const roles = detectRoles(rawText);
  groups.push({
    title: '권한 / 역할 경계',
    items: roles.length
      ? [item(
        `역할별 가능·불가능 동작 (${roles.join(' / ')})`,
        '권한 우회는 사용자에게 보이지 않지만 피해가 가장 큰 결함이다.',
        '각 역할 계정으로 화면 노출 여부를 보고, 하위 권한 계정의 토큰으로 API 를 직접 호출해 401/403 을 확인한다.',
      )]
      : [item(`역할 구분 ${NOT_SPECIFIED}`, '권한 모델이 정해지지 않으면 접근 제어 검증 기준을 세울 수 없다.', '기획에 역할 목록과 역할별 허용 동작을 확인한다.')],
  });

  /* 입력 검증 */
  const validation = pick(requirements, 'VALIDATION');
  const constrained = requirements.filter((r) => r.constraints.length);
  const validationItems = [];
  if (validation.length) {
    validationItems.push(item(
      `필수값·형식 제약 ${validation.length}건`,
      '입력 검증 누락은 잘못된 데이터가 그대로 저장되는 원인이 된다.',
      '공백·형식 불일치·허용되지 않는 특수문자를 넣어 차단되는지, 오류 문구가 해당 필드에 붙는지 확인한다.',
    ));
  }
  if (constrained.length) {
    const list = constrained.flatMap((r) => r.constraints.map((c) => `${c.value}${c.unit || ''}`)).slice(0, 8);
    validationItems.push(item(
      `길이·수치 제한 (${list.join(', ')})`,
      '경계값은 개발·기획 해석이 갈리는 지점이다.',
      '기준값과 ±1 지점을 모두 입력해 허용/거부가 명세와 일치하는지 확인한다.',
    ));
  }
  validationItems.push(item(
    '스크립트 삽입(XSS) · SQL 특수문자',
    '게시판 성격의 입력 화면은 저장형 XSS 위험이 상시 존재한다.',
    '<script>alert(1)</script>, \'"--; 등을 제목·본문·검색어에 넣어 저장 후 노출 화면에서 실행되지 않는지 확인한다.',
  ));
  groups.push({ title: '입력 검증', items: validationItems });

  /* 경계조건 */
  const boundaryItems = [];
  if (has(requirements, 'LIST')) {
    boundaryItems.push(item(
      '목록 0건 / 1건 / 페이지 경계 / 대량',
      '데이터 개수 경계에서 빈 상태·페이징 누락·중복이 자주 발생한다.',
      '0건, 1건, 페이지 크기 +1건, 대량(1만건) 데이터셋으로 진입해 렌더·페이징·정렬·검색을 확인한다.',
    ));
  }
  const retry = requirements.filter((r) => r.retryCount != null);
  if (retry.length) {
    boundaryItems.push(item(
      `재시도 상한 (${retry.map((r) => `${r.retryCount}회`).join(', ')})`,
      '상한을 넘겨 재시도하면 서버 부하와 중복 처리가 발생한다.',
      '실패 응답을 강제해 재시도 횟수를 네트워크 로그로 계측하고, 소진 후 최종 실패 처리를 확인한다.',
    ));
  }
  boundaryItems.push(item(
    '중복 제출 · 동시성',
    '버튼 연속 클릭(따닥)과 동시 요청은 중복 데이터의 주요 원인이다.',
    '1초 내 3회 연속 실행, 두 탭에서 동시 제출을 시도해 결과가 멱등한지 확인한다.',
  ));
  groups.push({ title: '경계조건', items: boundaryItems });

  /* 예외 / 에러 처리 */
  const errorItems = [];
  if (has(requirements, 'ERROR')) {
    errorItems.push(item('명세된 오류 문구·코드', '오류 문구가 기획과 다르면 사용자 문의로 이어진다.', '오류 상황을 유발해 문구·코드가 기획서 표현과 일치하는지 대조한다.'));
  }
  if (has(requirements, 'ABORT')) {
    errorItems.push(item('중도 이탈 · 타임아웃 · 세션 만료', '중간 상태가 확정되면 유령 데이터가 남는다.', '처리 중 뒤로가기·앱 종료·네트워크 차단을 걸고, 재진입 시 상태(임시저장/초기화)를 확인한다.'));
  }
  errorItems.push(item(
    '잘못된 접근 · 네트워크 실패',
    '무한 로딩·크래시는 사용자가 복구할 수단이 없는 결함이다.',
    '존재하지 않는 ID 로 직접 접근, 서버 5xx 목(mock) 응답, 오프라인 상태에서 안내와 재시도 수단이 있는지 확인한다.',
  ));
  groups.push({ title: '예외 / 에러 처리', items: errorItems });

  /* 데이터 정합성 */
  const dataItems = [item(
    '작성 · 수정 · 삭제 후 목록/카운트 반영',
    '화면 캐시와 서버 상태가 어긋나면 사용자가 잘못된 정보를 보게 된다.',
    '각 동작 직후 목록·카운트·상세를 새로고침 없이, 그리고 새로고침 후 각각 비교한다.',
  )];
  if (has(requirements, 'DESTRUCTIVE')) {
    dataItems.push(item('되돌릴 수 없는 동작', '삭제·초기화는 실수 시 복구가 불가능하다.', '확인 팝업 취소 시 데이터가 유지되는지, 권한 없는 계정의 삭제 API 가 차단되는지 확인한다.'));
  }
  if (has(requirements, 'STATE')) {
    dataItems.push(item('임시저장 · 상태 복원', '복원 실패는 사용자가 입력을 처음부터 다시 하게 만든다.', '작성 중 이탈 후 재진입해 입력값이 복원되는지, 중복 데이터가 생기지 않는지 확인한다.'));
  }
  groups.push({ title: '데이터 정합성', items: dataItems });

  /* 검증 환경 */
  const envItems = [item(
    `브라우저 · 해상도 매트릭스 ${NOT_SPECIFIED}`,
    '지원 범위가 정해지지 않으면 결함 인정 여부로 논쟁이 생긴다.',
    '지원 브라우저·최소 해상도·모바일 대응 범위를 기획에 확인해 확정한다.',
  )];
  if (has(requirements, 'PERFORMANCE')) {
    envItems.push(item('네트워크 스로틀링 환경', '성능 기준은 정상 회선에서는 드러나지 않는다.', 'DevTools 로 3G 수준 제한을 걸고 기준 응답시간 초과 시 동작을 확인한다.'));
  }
  if (has(requirements, 'FILE')) {
    envItems.push(item('파일 테스트 자산', '허용/비허용 경계를 즉석에서 만들기 어렵다.', '허용 확장자, 비허용 확장자, 용량 초과 파일을 미리 준비한다.'));
  }
  groups.push({ title: '검증 환경', items: envItems });

  return groups;
}

/** 검증 착수 전 준비할 것 — "해야 할 내용" 체크리스트 */
function buildTodos(requirements, rawText) {
  const todos = [];
  const add = (text, reason) => todos.push({ text, reason });

  const roles = detectRoles(rawText);
  add(
    roles.length ? `권한별 테스트 계정 준비 (${roles.join(' / ')})` : '권한 모델 확인 후 역할별 테스트 계정 발급',
    '권한 경계 검증에 필수',
  );
  add('검증 대상 URL·환경(스테이징) 주소 확정', '§2 URL 목록의 base URL 이 확정돼야 검증을 시작할 수 있다');

  if (has(requirements, 'ERROR') || has(requirements, 'RETRY')) {
    add('5xx·타임아웃을 강제할 목(mock)/프록시 환경 구성', '실패 경로는 정상 환경에서 재현되지 않는다');
  }
  if (has(requirements, 'LIST')) add('0건 / 1건 / 페이지 크기+1건 / 대량(1만건) 데이터셋 준비', '목록 경계 검증용');
  if (has(requirements, 'PAYMENT')) add('PG 테스트 카드(정상·한도초과·잔액부족) 확보', '결제 성공·실패 경로 검증용');
  if (has(requirements, 'FILE')) add('허용/비허용 확장자 및 용량 초과 파일 준비', '업로드 제약 검증용');
  if (has(requirements, 'NOTIFICATION')) add('알림 수신 채널(푸시/메일/SMS) 수신 가능 환경 확보', '발송 결과를 직접 확인해야 한다');
  if (has(requirements, 'PERFORMANCE')) add('네트워크 스로틀링 도구 및 응답시간 계측 방법 준비', '성능 기준 검증용');
  if (has(requirements, 'AUTH')) add('세션 만료·토큰 만료를 강제하는 방법 확인', '만료 처리 검증용');

  add('기획 확인 필요 항목을 정리해 기획자에게 일괄 질의', '문서 요약의 "확인 필요" 목록을 그대로 사용');
  add('생성된 TC 초안 검토 후 사내 TC 시트에 병합', '자동 생성분은 초안이므로 QA 검토가 전제');

  return todos;
}

/* ------------------------------------------------- §5 비목표 / §6 목표 */

// "다음 단계로 이동한다" 처럼 일반 흐름을 뜻하는 표현은 제외해야 하므로
// 범위 제외를 실제로 뜻하는 표현만 남긴다.
const NON_GOAL_RE = /추후|차기(?:\s*(?:버전|스프린트|과제))?|다음\s*(?:스프린트|버전|차수)|이번\s*(?:범위|스코프|검증)\s*(?:에서\s*)?(?:제외|아님|제외한다)|미지원|지원하지\s*않|제외한다|범위\s*(?:외|아님)|해당\s*없음|out of scope|not supported|not included|future release/i;
const GOAL_RE = /목적|목표|위해|제공한다|개선한다|도입한다|구축한다|지원한다|purpose|goal|objective/i;

function collectNonGoals(requirements, rawText) {
  const items = [];
  const lines = String(rawText || '').split('\n');

  lines.forEach((line, i) => {
    const text = clean(line.replace(/^\s*[-*+•]\s*/, '').replace(/^#+\s*/, ''));
    if (text.length < 6 || !NON_GOAL_RE.test(text)) return;
    items.push({ text: truncate(text, 120), line: i + 1, source: '문서 명시' });
  });

  // 기획서에서 다루지 않은 영역은 검증 범위가 아님을 명시해 불필요한 결함 리포트를 막는다.
  const absent = [
    ['PAYMENT', '결제·정산'],
    ['NOTIFICATION', '알림 발송'],
    ['FILE', '파일 업로드'],
    ['PRIVACY', '개인정보·보안 정책'],
  ].filter(([key]) => !has(requirements, key)).map(([, label]) => label);

  if (absent.length) {
    items.push({
      text: `${absent.join(' · ')} — 이번 문서에 요구사항이 없어 검증 대상에서 제외 (기획 확인 필요)`,
      line: null,
      source: '문서에 없음(추론)',
    });
  }

  return items.length ? items : [{ text: NOT_SPECIFIED, line: null, source: null }];
}

function collectGoals(requirements, rawText, keyPoints) {
  const items = [];
  const lines = String(rawText || '').split('\n');
  let inGoalSection = false;

  lines.forEach((line, i) => {
    const heading = line.match(/^#+\s*(.+)$/);
    if (heading) {
      inGoalSection = /목적|목표|개요|배경|purpose|goal|overview/i.test(heading[1]);
      return;
    }
    const text = clean(line.replace(/^\s*[-*+•]\s*/, ''));
    if (text.length < 8) return;
    // 범위 제외 문장("차기 버전에서 지원한다")이 목표로 섞이지 않게 먼저 걸러낸다.
    if (NON_GOAL_RE.test(text)) return;
    if (inGoalSection || GOAL_RE.test(text)) {
      items.push({ text: truncate(text, 120), line: i + 1, source: '문서 명시' });
    }
  });

  const unique = [];
  const seen = new Set();
  for (const g of items) {
    if (seen.has(g.text)) continue;
    seen.add(g.text);
    unique.push(g);
    if (unique.length >= 6) break;
  }

  // 명시된 목적문이 없으면 핵심 요구사항에서 "검증 통과 시 보장되는 것"을 구성한다.
  if (!unique.length && keyPoints.length) {
    keyPoints.slice(0, 4).forEach((k) => {
      unique.push({ text: truncate(k.text, 120), line: k.line, source: '핵심 요구사항 기반(추론)' });
    });
  }

  const featureAreas = [...new Set(requirements.map((r) => r.area))].filter(isFeatureArea);
  const guarantee = featureAreas.length
    ? `검증이 통과되면 ${featureAreas.slice(0, 5).join(' · ')} 영역의 정상 흐름과 명세된 실패·경계 처리가 보장된다.`
    : NOT_SPECIFIED;

  return { items: unique.length ? unique : [{ text: NOT_SPECIFIED, line: null, source: null }], guarantee };
}

/* ------------------------------------------------------------------ 본체 */

/**
 * @param {Array} requirements parseDocument 결과의 requirements
 * @param {string} rawText 기획서 원문 (URL·Figma·목표 추출에 필요)
 * @param {{keyPoints?: Array}} context
 */
function buildQaPlan(requirements, rawText, context = {}) {
  const allAreas = [...new Set(requirements.map((r) => r.area))];
  const areas = allAreas.filter(isFeatureArea);
  const keyPoints = context.keyPoints || [];
  const figma = collectFigma(rawText);
  const goals = collectGoals(requirements, rawText, keyPoints);

  return {
    checkpoints: buildCheckpoints(requirements, rawText),
    todos: buildTodos(requirements, rawText),
    urls: collectUrls(rawText, requirements),
    flow: buildFlow(requirements, areas),
    figma: figma.length ? figma : null,
    nonGoals: collectNonGoals(requirements, rawText),
    goals: goals.items,
    guarantee: goals.guarantee,
  };
}

module.exports = {
  buildQaPlan,
  isFeatureArea,
  buildCheckpoints,
  buildTodos,
  collectUrls,
  collectFigma,
  collectGoals,
  collectNonGoals,
  buildFlow,
  detectRoles,
  NOT_SPECIFIED,
};
