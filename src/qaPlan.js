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
// 마크다운 링크 — 라벨을 화면 이름으로 쓸 수 있어 따로 뽑는다.
const MD_LINK_RE = /\[([^\]]{1,60})\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g;
// "URL: ...", "경로: board/list" 처럼 라벨이 붙은 표기 (슬래시 없이 적는 경우까지)
const LABELED_RE = /(?:URL|url|주소|경로|링크|링크\s*주소|엔드포인트|endpoint|path|page)\s*[:：=]\s*([^\s,|)]{2,120})/g;
// "GET /api/posts", "POST /board/write"
const METHOD_RE = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s,|)]*)/g;
// 스킴 없이 적힌 도메인 — 사내 문서에서 흔하다. ("center.muhayu.com/post/view/xxx")
const BARE_HOST_RE = /(?:^|[\s(["'`|>])((?:[a-z0-9][a-z0-9-]*\.)+(?:com|net|org|io|co|kr|dev|app|me|ai|cloud)(?:\/[\w\-./{}:$?=&%]*)?)/gi;

/** URL 로 보이지만 검증 대상 화면이 아닌 것 (소스 파일·이미지·문서 등) */
const NOT_A_SCREEN = /\.(?:png|jpe?g|gif|svg|webp|ico|css|js|mjs|ts|tsx|jsx|json|ya?ml|md|txt|pdf|docx?|xlsx?|zip|woff2?)$/i;

/** 경로/URL 후보를 정리한다. 대상이 아니면 null. */
function normalizeTarget(raw) {
  if (!raw) return null;
  let t = String(raw).trim().replace(/[.,;:]+$/, '').replace(/^[<("'`]+|[>)"'`]+$/g, '');
  if (!t || t.length < 2) return null;
  if (/figma\.com/i.test(t)) return null;
  if (NOT_A_SCREEN.test(t)) return null;
  // "board/list" 처럼 슬래시로 시작하지 않는 상대 경로는 앞에 / 를 붙여 통일한다.
  if (!/^https?:\/\//i.test(t) && !t.startsWith('/')) {
    if (/^(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}/i.test(t)) return t;      // 도메인
    if (!/^[a-zA-Z][\w\-]*(?:\/[\w\-.{}:$]*)+$/.test(t)) return null;  // 경로 형태가 아니면 버린다
    t = `/${t}`;
  }
  if (t === '/' || /^\/\d+(?:\.\d+)*$/.test(t)) return null; // 루트·버전/날짜 토큰 제외
  return t;
}

/** 표 행에서 권한 셀("전체" / "회원" / "관리자")을 직접 읽는다 */
const ACCESS_CELL = {
  전체: '전체', 모두: '전체', 누구나: '전체', 공개: '전체', all: '전체', public: '전체',
  회원: '회원', 로그인: '회원', 사용자: '회원', member: '회원', user: '회원',
  관리자: '관리자', 운영자: '관리자', admin: '관리자',
  비로그인: '비로그인', 게스트: '비로그인', guest: '비로그인',
};

function accessFromTableRow(line, needle) {
  if (!/^\s*\|/.test(String(line || ''))) return null;
  const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
  for (const cell of cells) {
    if (cell.includes(needle)) continue;
    const hit = ACCESS_CELL[cell] || ACCESS_CELL[cell.toLowerCase()];
    if (hit) return hit;
  }
  return null;
}

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

/**
 * 화면 이름·경로에서 검증 관점을 추정한다.
 * 영역 카테고리만 쓰면 "글 작성" 행에 "페이징·정렬" 이 붙는 것처럼 화면과 어긋난다.
 */
const SCREEN_HINTS = [
  [/목록|리스트|list|index/i, ['LIST']],
  [/검색|search/i, ['LIST']],
  [/작성|등록|쓰기|생성|write|create|new|form/i, ['VALIDATION', 'FILE']],
  [/수정|편집|변경|edit|update|modify/i, ['VALIDATION', 'DESTRUCTIVE']],
  [/삭제|제거|delete|remove/i, ['DESTRUCTIVE']],
  [/관리|어드민|백오피스|admin|manage/i, ['AUTH', 'DESTRUCTIVE']],
  [/상세|보기|detail|view|read/i, ['NAVIGATION']],
  [/로그인|인증|가입|계정|login|sign|auth/i, ['AUTH']],
  [/결제|주문|정산|환불|payment|order|checkout/i, ['PAYMENT']],
  [/업로드|첨부|파일|upload|attach|file/i, ['FILE']],
  [/알림|푸시|메일|notification|push|mail/i, ['NOTIFICATION']],
];

function scenarioForScreen(screen, path, fallbackCategories) {
  const hay = `${screen || ''} ${path || ''}`;
  const keys = [];
  for (const [re, cats] of SCREEN_HINTS) {
    if (re.test(hay)) keys.push(...cats);
  }

  // API 경로는 화면이 아니라 직접 호출 대상이므로 관점이 다르다.
  const target = String(path || '').toLowerCase();
  if (target.startsWith('/api/') || target.startsWith('api/') || target.includes('/api/')) {
    return '권한 경계(토큰 직접 호출) / 필수 파라미터 검증 / 오류 응답 코드';
  }

  if (!keys.length) return scenarioFor(fallbackCategories || []);
  return [...new Set(keys)].map((k) => SCENARIO_BY_CATEGORY[k]).filter(Boolean).slice(0, 3).join(' / ');
}

function collectUrls(rawText, requirements) {
  const text = String(rawText || '');
  const lines = text.split('\n');
  const rows = [];
  const seen = new Map();

  /** 해당 문자열이 등장한 줄과, 그 줄이 속한 영역·표 첫 셀을 찾는다 */
  const locate = (needle) => {
    const idx = lines.findIndex((l) => l.includes(needle));
    if (idx < 0) return { context: '', area: null, cell: null };
    const line = lines[idx];
    const req = requirements.find((r) => r.line === idx + 1)
      || requirements.filter((r) => r.line <= idx + 1).slice(-1)[0];

    // 마크다운 표 행이면 첫 셀을 화면 이름으로 쓴다 ("| 게시글 목록 | /board/list |")
    let cell = null;
    if (/^\s*\|/.test(line)) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2 && !cells[0].includes(needle) && cells[0].length <= 40) cell = cells[0];
    }
    return { context: line, area: req ? req.area : null, cell };
  };

  /**
   * @param {string} raw   경로/URL 후보
   * @param {{label?: string, method?: string}} meta 화면 이름 힌트와 HTTP 메서드
   */
  const push = (raw, meta = {}) => {
    const path = normalizeTarget(raw);
    if (!path) return;

    const needle = String(raw).trim();
    const { context, area, cell } = locate(needle);
    const screen = meta.label || cell || area || NOT_SPECIFIED;

    // 같은 경로는 메서드 유무와 무관하게 한 행으로 합친다.
    // ("GET /api/posts" 를 먼저 담고 나중에 "/api/posts" 가 또 잡히는 중복 방지)
    const prev = seen.get(path);
    if (prev) {
      if (prev.screen === NOT_SPECIFIED && screen !== NOT_SPECIFIED) {
        prev.screen = screen;
        prev.scenario = scenarioForScreen(screen, path, null);
      }
      if (meta.method && !prev.methods.includes(meta.method)) prev.methods.push(meta.method);
      const betterAccess = accessFromTableRow(context, needle);
      if (betterAccess && prev.access.includes(NOT_SPECIFIED)) prev.access = betterAccess;
      return;
    }

    const req = requirements.find((r) => r.area === area);
    const row = {
      screen,
      methods: meta.method ? [meta.method] : [],
      path,
      access: accessFromTableRow(context, needle) || guessAccess(`${context} ${area || ''} ${path}`),
      scenario: scenarioForScreen(screen, path, req ? req.categories : []),
    };
    seen.set(path, row);
    rows.push(row);
  };

  // 라벨이 붙은 표기를 먼저 처리해 화면 이름을 확보한다.
  for (const m of text.matchAll(MD_LINK_RE)) push(m[2], { label: m[1] });
  for (const m of text.matchAll(METHOD_RE)) push(m[2], { method: m[1] });
  for (const m of text.matchAll(LABELED_RE)) push(m[1]);
  for (const m of text.matchAll(ABS_URL_RE)) push(m[0]);
  for (const m of text.matchAll(BARE_HOST_RE)) push(m[1]);
  for (const m of text.matchAll(PATH_RE)) push(m[1]);

  return rows.slice(0, 40).map((r) => ({
    screen: r.screen,
    method: r.methods.length ? r.methods.join(' / ') : null,
    path: r.path,
    access: r.access,
    scenario: r.scenario,
  }));
}

function collectFigma(rawText) {
  const found = [...String(rawText || '').matchAll(FIGMA_RE)].map((m) => m[0].replace(/[.,;)]+$/, ''));
  return [...new Set(found)];
}

/* ------------------------------------------------------- §3 동작 흐름 */

/**
 * 문서에 명시된 단계 표기를 찾는다 — "1단계", "Step 2", "①", "순서: ...".
 * 표기가 있을 때만 순서를 그리고, 없으면 순서를 추측하지 않는다.
 * (번호가 붙은 절 제목은 기능 목록일 뿐 사용자 흐름 순서가 아닌 경우가 많다.)
 */
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

function detectSteps(rawText) {
  const lines = String(rawText || '').split('\n');
  const found = [];

  lines.forEach((line, i) => {
    const body = clean(line.replace(/^\s*[-*+•]\s*/, '').replace(/^#+\s*/, ''));
    if (!body) return;

    let order = null;
    let label = null;

    const ko = body.match(/^(\d{1,2})\s*단계\s*[:.)\-]?\s*(.*)$/);
    if (ko) { order = Number(ko[1]); label = ko[2]; }

    const en = !ko && body.match(/^step\s*(\d{1,2})\s*[:.)\-]?\s*(.*)$/i);
    if (en) { order = Number(en[1]); label = en[2]; }

    if (!order) {
      const idx = CIRCLED.indexOf(body[0]);
      if (idx >= 0) { order = idx + 1; label = body.slice(1).trim(); }
    }

    if (!order) return;
    // 첫 문장(또는 첫 절)만 남긴다. 뒤에 붙는 상세 설명까지 노드에 넣으면 도형이 깨진다.
    const head = String(label || '').split(/(?<=다)\.\s|\.\s|—|·|,\s/)[0];
    found.push({ order, label: truncate(head || `${order}단계`, 24), line: i + 1 });
  });

  // 같은 번호가 여러 번 나오면(여러 흐름) 첫 세트만 쓴다.
  const unique = [];
  const usedOrders = new Set();
  for (const step of found.sort((a, b) => a.order - b.order || a.line - b.line)) {
    if (usedOrders.has(step.order)) continue;
    usedOrders.add(step.order);
    unique.push(step);
  }

  return unique.length >= 2 ? unique : null;
}

/**
 * 영역과 조건 분기로 mermaid flowchart 를 만든다.
 * (앱에서는 코드 블록으로 보여주고, Notion·GitHub 에 붙이면 그림으로 렌더된다.)
 *
 * 어느 영역이 비로그인으로 접근 가능한지는 문서만으로 단정할 수 없으므로 추측하지 않는다.
 * 인증 영역이 있으면 진입 관문으로만 배치하고, 판단이 필요한 부분은 caption 으로 알린다.
 */
function buildFlow(requirements, areas, rawText) {
  const safe = (s) => clean(s).replace(/[\[\]{}()"|]/g, '').slice(0, 28) || '단계';

  // 문서에 단계 표기가 있으면 그 순서대로 직렬 흐름을 그린다.
  // 요구사항이 하나도 추출되지 않은 문서(순서만 적힌 흐름 문서)에서도 살려야 하므로
  // 영역 유무보다 먼저 판정한다.
  const steps = detectSteps(rawText);
  if (steps) {
    const lines = ['flowchart TD', '    START[사용자 진입]'];
    let prev = { node: 'START', label: null };
    steps.forEach((step, i) => {
      if (i === 0) lines.push(`    START --> S0["${step.order}. ${safe(step.label)}"]`);
      lines.push(`    S${i} --> C${i}{정상 / 실패}`);
      lines.push(`    C${i} -- 실패 --> NG${i}[사유 안내 · 상태 원복]`);
      prev = { node: `C${i}`, label: '정상' };
      if (i < steps.length - 1) {
        // 다음 단계로 넘어가는 엣지도 "정상" 경로임을 표시한다.
        lines.push(`    C${i} -- 정상 --> S${i + 1}["${steps[i + 1].order}. ${safe(steps[i + 1].label)}"]`);
      }
    });
    lines.push(`    ${prev.node} -- 정상 --> DONE[처리 완료 · 결과 반영]`);
    return {
      mermaid: lines.join('\n'),
      caption: `문서에 명시된 단계 표기(${steps.length}단계)를 따라 순서를 구성했습니다.`,
      ordered: true,
    };
  }

  if (!areas.length) return { mermaid: null, caption: NOT_SPECIFIED, ordered: false };

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

  return { mermaid: lines.join('\n'), caption: `${caption} 문서에 단계 표기(1단계·Step 등)가 없어 영역을 병렬로 배치했습니다 — 실제 화면 전이 순서는 기획 확인이 필요합니다.`, ordered: false };
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
    flow: buildFlow(requirements, areas, rawText),
    figma: figma.length ? figma : null,
    nonGoals: collectNonGoals(requirements, rawText),
    goals: goals.items,
    guarantee: goals.guarantee,
  };
}

module.exports = {
  buildQaPlan,
  isFeatureArea,
  scenarioForScreen,
  detectSteps,
  normalizeTarget,
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
