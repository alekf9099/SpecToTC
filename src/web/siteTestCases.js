'use strict';

/**
 * 탐색 결과(여러 화면) → 테스트케이스.
 *
 * 한 장짜리 분석(webTestCases)은 링크를 "주요 내부 링크 이동" TC 한 줄로 뭉쳤다.
 * 여기서는 **화면마다** TC 를 만들고, 그 위에 한 장에서는 만들 수 없던 세 가지를 얹는다.
 *
 *   1) 로그인 기능      — 정상·실패·세션 유지·로그아웃 후 접근
 *   2) 딥링크           — 각 경로로 바로 진입했을 때(로그인/비로그인) 어떻게 되는지
 *   3) 화면 간 이동      — 링크로 도달한 경로가 실제로 열리는지
 *
 * 화면별 세부 TC 는 기존 buildWebTestCases 를 화면마다 돌려 재사용한다.
 * 출력 구조가 같으므로 표·필터·CSV·PDF 가 그대로 동작한다.
 */

const { buildWebTestCases } = require('./webTestCases');
const { step, truncate } = require('../engine/generator');

const TYPE_TAG = { Pass: '정상', Fail: '실패', 'Edge Case': '경계' };

/** 자격 증명은 TC 문구에 절대 넣지 않는다. 넣으면 CSV·PDF 로 그대로 새어 나간다. */
const CREDENTIAL_PLACEHOLDER = '전달받은 테스트 계정';

function makeEmitter(out, counters, prefix) {
  return (type, area, tc) => {
    const code = type === 'Pass' ? 'P' : type === 'Fail' ? 'F' : 'E';
    counters[code] += 1;
    const title = `[${TYPE_TAG[type]}] ${tc.title}`;
    out.push({
      tc_id: `TC-${prefix}${code}-${String(counters[code]).padStart(3, '0')}`,
      type,
      priority: tc.priority || 'Med',
      area,
      title,
      objective: tc.objective,
      precondition: tc.precondition,
      steps: tc.steps,
      expected: tc.expected,
      requirement: {
        id: tc.evidenceId || 'SITE',
        text: tc.evidence,
        line: null,
        categories: tc.categories || ['사이트 탐색'],
      },
      tags: (tc.tags || []).concat(['web', 'site']),
      origin: 'site',

      scenario: title,
      requirement_id: tc.evidenceId || 'SITE',
      source_text: tc.evidence,
      source_line: null,
      categories: tc.categories || ['사이트 탐색'],
    });
  };
}

/* ------------------------------------------------------------ 로그인 기능 */

function loginCases(emit, crawl) {
  const login = crawl.login;
  if (!login) return;

  const area = '로그인';
  const at = login.loginUrl || crawl.start;
  const evidence = `탐색 관측 · 로그인 화면 ${at}`
    + (login.ok ? ` · 로그인 성공 후 ${truncate(login.movedTo || '', 60)} 로 이동` : ' · 로그인 실패로 관측됨');

  emit(login.ok ? 'Pass' : 'Fail', area, {
    title: `정상 자격 증명으로 로그인`,
    objective: '전달받은 계정으로 로그인이 완료되고 로그인 상태 화면으로 진입하는지 확인한다.',
    precondition: [`로그인 화면 접근 가능: ${at}`, `${CREDENTIAL_PLACEHOLDER} 준비`],
    steps: [
      step('진입', at),
      step('입력', `${CREDENTIAL_PLACEHOLDER}의 아이디 · 비밀번호`),
      step('실행', '로그인'),
      step('확인', '이동한 화면 · 로그아웃 메뉴 노출 여부'),
    ],
    expected: login.ok
      ? [
        `현재 동작(기준선): ${truncate(login.movedTo || '로그인 상태 화면', 80)} 로 이동`,
        '로그아웃 메뉴가 보이거나 비밀번호 입력란이 사라짐',
        '※ 관측값입니다. 이동 화면이 기획 의도와 맞는지는 QA 가 판단하세요.',
      ]
      : [
        '로그인이 완료되어야 함',
        `관측: ${login.note || '로그인 후에도 로그인 화면에 머무름'}`,
      ],
    evidence,
    priority: 'High',
    categories: ['사이트 탐색', '인증'],
    tags: ['login'],
  });

  emit('Fail', area, {
    title: '잘못된 비밀번호로 로그인 시도',
    objective: '자격 증명이 틀렸을 때 로그인이 차단되고 사유가 안내되는지 확인한다.',
    precondition: [`로그인 화면 접근 가능: ${at}`],
    steps: [
      step('입력', '올바른 아이디 + 틀린 비밀번호'),
      step('실행', '로그인'),
      step('확인', '오류 문구 · 잔여 시도 횟수 안내'),
    ],
    expected: [
      '로그인 차단',
      '아이디/비밀번호 중 무엇이 틀렸는지 특정하지 않는 문구 (계정 열거 방지)',
      '연속 실패 시 잠금·캡차 정책 동작 (정책 확인 필요)',
    ],
    evidence,
    priority: 'High',
    categories: ['사이트 탐색', '인증'],
    tags: ['login', 'negative'],
  });

  emit('Edge Case', area, {
    title: '로그인 상태 유지 — 새로고침 · 새 탭 · 재접속',
    objective: '세션이 화면 이동과 새로고침에서 유지되는지 확인한다.',
    precondition: ['로그인 완료 상태'],
    steps: [
      step('실행', '로그인 후 임의 화면에서 새로고침'),
      step('실행', '새 탭으로 같은 주소 열기'),
      step('확인', '로그인 상태 유지 여부'),
    ],
    expected: ['로그인 상태 유지', '로그인 화면으로 튕기지 않음', '세션 만료 시간은 기획 확인 필요'],
    evidence,
    priority: 'Med',
    categories: ['사이트 탐색', '인증'],
    tags: ['login', 'session'],
  });
}

/* ---------------------------------------------------------------- 딥링크 */

/**
 * 딥링크 TC — 발견한 경로로 **바로 진입**했을 때의 동작.
 *
 * 링크를 눌러 들어가는 것과 주소창에 직접 치는 것은 다르다. 후자는 앞 화면의
 * 상태가 없어서 깨지는 경우가 많고, 비로그인 상태면 접근 제어가 드러난다.
 */
function deepLinkCases(emit, crawl) {
  const inner = crawl.pages.filter((p) => p.depth > 0);
  if (!inner.length) return;

  const area = '딥링크';
  const list = inner.slice(0, 12);

  emit('Pass', area, {
    title: `주소 직접 입력으로 화면 진입 (${list.length}개 경로)`,
    objective: '링크를 거치지 않고 주소로 바로 들어가도 화면이 정상 구성되는지 확인한다.',
    precondition: ['로그인 완료 상태', '이전 화면을 거치지 않고 주소창에 직접 입력'],
    steps: list.map((p) => step('진입', `${p.path} — ${p.name}`)),
    expected: [
      '각 경로가 빈 화면·오류 없이 로드됨',
      '앞 화면에서 넘겨주던 값이 없어도 깨지지 않음',
      '새로고침해도 같은 화면이 유지됨',
    ],
    evidence: `탐색 관측 · 내부 경로 ${inner.length}개 발견 (${list.slice(0, 5).map((p) => p.path).join(', ')}${inner.length > 5 ? ' …' : ''})`,
    priority: 'High',
    categories: ['사이트 탐색', '딥링크'],
    tags: ['deep-link'],
  });

  emit('Fail', area, {
    title: `비로그인 상태로 내부 경로 직접 접근 (${list.length}개)`,
    objective: '로그인이 필요한 화면이 비로그인 상태에서 차단되는지 확인한다.',
    precondition: ['로그아웃 또는 시크릿 창', '세션 쿠키 없음'],
    steps: [
      step('상태', '로그아웃 후 모든 쿠키 삭제'),
      ...list.slice(0, 8).map((p) => step('진입', `${p.path} 직접 접근`)),
      step('확인', '로그인 화면 유도 여부 · 원래 가려던 곳으로 복귀하는지'),
    ],
    expected: [
      '보호가 필요한 화면은 로그인 화면으로 이동',
      '로그인 후 원래 가려던 경로로 복귀 (미복귀면 결함 후보)',
      '보호 대상 데이터가 잠깐이라도 노출되지 않음',
      '※ 어느 화면이 보호 대상인지는 기획 확인이 필요합니다.',
    ],
    evidence: `탐색 관측 · 로그인 세션으로 접근한 경로 ${inner.length}개`,
    priority: 'High',
    categories: ['사이트 탐색', '딥링크', '인증'],
    tags: ['deep-link', 'auth'],
  });

  emit('Edge Case', area, {
    title: '잘못된 경로·파라미터로 진입',
    objective: '없는 경로나 손상된 파라미터에서 안전하게 실패하는지 확인한다.',
    precondition: ['로그인 완료 상태'],
    steps: [
      step('진입', `${list[0].path}/__not_found__`),
      step('진입', `${list[0].path}?id=0 · ?id=-1 · ?id=abc (파라미터가 있는 화면)`),
      step('진입', '다른 사용자 소유 자원의 식별자로 접근'),
    ],
    expected: [
      '404·오류 화면이 안내와 함께 노출 (빈 화면·무한 로딩 없음)',
      '다른 사용자 자원은 403 또는 목록으로 차단',
      '서버 오류(5xx)나 스택 트레이스 노출 없음',
    ],
    evidence: `탐색 관측 · 대표 경로 ${list[0].path}`,
    priority: 'High',
    categories: ['사이트 탐색', '딥링크'],
    tags: ['deep-link', 'boundary'],
  });
}

/* ------------------------------------------------------------- 화면 간 이동 */

function navigationCases(emit, crawl) {
  const reached = crawl.pages.filter((p) => p.viaLabel);
  if (!reached.length) return;

  emit('Pass', '화면 이동', {
    title: `메뉴·링크로 화면 이동 (${reached.length}개)`,
    objective: '메뉴에서 각 화면으로 이동하고 뒤로 가기로 되돌아오는지 확인한다.',
    precondition: ['로그인 완료 상태'],
    steps: reached.slice(0, 10).map((p) => step('이동', `"${p.viaLabel}" → ${p.path} (${p.name})`)),
    expected: [
      '각 링크가 의도한 화면으로 이동',
      '뒤로 가기로 이전 화면 복귀',
      '현재 위치가 메뉴에 표시됨 (활성 표시)',
    ],
    evidence: `탐색 관측 · 링크로 도달한 화면 ${reached.length}개`,
    priority: 'Med',
    categories: ['사이트 탐색', '화면 이동'],
    tags: ['navigation'],
  });

  if (crawl.skippedLinks.length) {
    emit('Edge Case', '화면 이동', {
      title: `자동 탐색에서 제외한 링크 수동 확인 (${crawl.skippedLinks.length}개)`,
      objective: '되돌릴 수 없는 동작이라 자동으로 눌러보지 않은 링크를 사람이 확인한다.',
      precondition: ['데이터 복구 방법 확보 후 진행'],
      steps: crawl.skippedLinks.slice(0, 8).map((s) => step('확인', `${s.label || s.url} — ${s.reason}`)),
      expected: [
        '각 동작에 확인 단계가 있는지',
        '실행 후 되돌릴 수 있는지(Undo·복구)',
        '권한 없는 계정으로는 차단되는지',
      ],
      evidence: `탐색 관측 · 위험 판단으로 제외한 링크 ${crawl.skippedLinks.length}개`,
      priority: 'High',
      categories: ['사이트 탐색', '수동 확인'],
      tags: ['manual-check', 'destructive'],
    });
  }

  if (crawl.notVisited.length) {
    emit('Edge Case', '화면 이동', {
      title: `탐색 상한으로 보지 못한 화면 (${crawl.notVisited.length}개)`,
      objective: '자동 탐색 범위 밖의 화면은 TC 가 없으므로 범위를 넓히거나 수동으로 확인한다.',
      precondition: [],
      steps: crawl.notVisited.slice(0, 8).map((p) => step('확인', `${p.label || p.url}`)),
      expected: [
        `탐색 상한(페이지 ${crawl.limits.maxPages} · 깊이 ${crawl.limits.maxDepth})을 넓혀 재분석하거나 수동 확인`,
      ],
      evidence: `탐색 관측 · 상한에 걸려 미방문 ${crawl.notVisited.length}개`,
      priority: 'Low',
      categories: ['사이트 탐색', '수동 확인'],
      tags: ['manual-check', 'coverage'],
    });
  }
}

/* ------------------------------------------------------------------ 조립 */

/**
 * 화면이 바뀌어도 내용이 같아지는 TC — 사이트 전체에 한 번만 있으면 된다.
 * 화면별로 반복하면 10개 화면에서 같은 줄이 40개 나와 표가 못 쓰게 된다.
 */
const SITE_WIDE_TAGS = new Set(['smoke', 'a11y', 'responsive', 'error', 'navigation']);

function isSiteWide(tc) {
  return (tc.tags || []).some((t) => SITE_WIDE_TAGS.has(t));
}

/**
 * 탐색 결과 → TC 목록
 *
 * @param {object} crawl crawlSite 결과
 * @returns {Array} 기획서 기반 TC 와 같은 구조
 */
function buildSiteTestCases(crawl) {
  const out = [];
  const counters = { P: 0, F: 0, E: 0 };
  const emit = makeEmitter(out, counters, 'S');

  loginCases(emit, crawl);
  deepLinkCases(emit, crawl);
  navigationCases(emit, crawl);

  // 화면마다 세부 TC — 폼·입력 제약·버튼·목록은 화면 단위로 봐야 의미가 있다.
  // 화면 수만큼 반복되는 사이트 공통 항목(페이지 로딩·접근성·반응형·예외 처리·
  // 링크 이동)은 대표 화면에서 한 번만 낸다. 화면이 10개면 40줄이 똑같아진다.
  crawl.pages.forEach((pageInfo, index) => {
    const perPage = buildWebTestCases(pageInfo.inventory)
      .filter((tc) => index === 0 || !isSiteWide(tc));
    perPage.forEach((tc) => {
      const code = tc.type === 'Pass' ? 'P' : tc.type === 'Fail' ? 'F' : 'E';
      counters[code] += 1;
      out.push({
        ...tc,
        // 화면 이름을 영역으로 바꿔 CSV 에서 화면별로 묶이게 한다
        tc_id: `TC-S${code}-${String(counters[code]).padStart(3, '0')}`,
        area: `${index + 1}. ${pageInfo.name}`,
        origin: 'site',
        tags: [...new Set([...(tc.tags || []), 'site', 'screen'])],
        requirement: {
          ...(tc.requirement || {}),
          text: `${pageInfo.path} · ${(tc.requirement && tc.requirement.text) || ''}`.trim(),
        },
        source_text: `${pageInfo.path} · ${tc.source_text || ''}`.trim(),
        scenario: tc.title,
      });
    });
  });

  return out;
}

module.exports = { buildSiteTestCases, CREDENTIAL_PLACEHOLDER };
