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
const {
  step, truncate, qa, sys,
  josa,
} = require('../engine/generator');

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
      step('진입', qa(`브라우저에서 ${at} 주소를 연다`)),
      step('입력', qa(`로그인 화면에 ${CREDENTIAL_PLACEHOLDER}의 아이디와 비밀번호를 입력한다`)),
      step('실행', qa('로그인 버튼을 누른다')),
      step('확인', qa('이동한 화면 주소와 로그아웃 메뉴 노출 여부를 확인한다')),
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
      step('진입', qa(`브라우저에서 ${at} 주소를 연다`)),
      step('입력', qa('올바른 아이디와 틀린 비밀번호를 입력한다')),
      step('실행', qa('로그인 버튼을 누른다')),
      step('확인', qa('오류 문구와 잔여 시도 횟수 안내를 확인한다')),
    ],
    expected: [
      sys('로그인을 차단한다'),
      sys('아이디와 비밀번호 중 무엇이 틀렸는지 특정하지 않는 문구를 보여준다 (계정 열거 방지)'),
      sys('연속 실패 시 잠금·캡차 정책을 적용한다 (정책 확인 필요)'),
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
      step('실행', qa('로그인한 뒤 임의 화면에서 새로고침한다')),
      step('실행', qa('새 탭으로 같은 주소를 연다')),
      step('확인', qa('두 경우 모두 로그인 상태가 유지되는지 확인한다')),
    ],
    expected: [
      sys('새로고침·새 탭에서도 로그인 상태를 유지한다'),
      sys('로그인 화면으로 되돌리지 않는다'),
      '세션 만료 시간은 기획 확인이 필요하다',
    ],
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
    steps: list.map((p) => step('진입', qa(`주소창에 ${p.path} 를 직접 입력해 ${p.name} 화면을 연다`)))
      .concat(step('확인', qa('각 화면이 빈 화면이나 오류 없이 구성되는지 확인한다'))),
    expected: [
      sys('각 경로를 빈 화면·오류 없이 로드한다'),
      sys('앞 화면에서 넘겨주던 값이 없어도 화면을 정상 구성한다'),
      sys('새로고침해도 같은 화면을 유지한다'),
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
      step('상태', qa('로그아웃한 뒤 브라우저의 모든 쿠키를 삭제한다')),
      ...list.slice(0, 8).map((p) => step('진입', qa(`주소창에 ${p.path} 를 직접 입력한다`))),
      step('확인', qa('로그인 화면으로 유도되는지, 로그인 후 원래 가려던 곳으로 돌아오는지 확인한다')),
    ],
    expected: [
      sys('보호가 필요한 화면은 로그인 화면으로 이동시킨다'),
      sys('로그인 후 원래 가려던 경로로 되돌려 준다 (되돌리지 않으면 결함 후보)'),
      sys('보호 대상 데이터를 잠깐이라도 노출하지 않는다'),
      '어느 화면이 보호 대상인지는 기획 확인이 필요하다',
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
      step('진입', qa(`주소창에 ${list[0].path}/__not_found__ 를 입력한다`)),
      step('진입', qa(`파라미터가 있는 화면에 ${list[0].path}?id=0, ?id=-1, ?id=abc 를 각각 입력한다`)),
      step('진입', qa('다른 사용자 소유 자원의 식별자로 접근한다')),
      step('확인', qa('각 경우의 화면과 응답 코드를 확인한다')),
    ],
    expected: [
      sys('없는 페이지(404)나 오류 화면을 안내 문구와 함께 보여준다 — 빈 화면이나 끝나지 않는 로딩이 아니다'),
      sys('다른 사용자 자원은 권한 없음(403)으로 막거나 목록으로 되돌린다'),
      sys('서버 오류(5xx) 화면이나 내부 오류 로그를 사용자에게 그대로 보여주지 않는다'),
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
    steps: reached.slice(0, 10).map((p) => step('이동', qa(`메뉴에서 "${p.viaLabel}" 버튼을 눌러 ${p.name} 화면(${p.path})으로 이동한다`)))
      .concat(step('확인', qa('각 이동 결과와 뒤로 가기 복귀, 메뉴의 현재 위치 표시를 확인한다'))),
    expected: [
      sys('각 링크에서 의도한 화면으로 이동시킨다'),
      sys('뒤로 가기를 누르면 이전 화면으로 되돌린다'),
      sys('현재 위치를 메뉴에 활성 표시한다'),
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
      steps: crawl.skippedLinks.slice(0, 8).map((x) => step('확인', qa(`"${x.label || x.url}" 항목을 직접 눌러 동작을 확인한다 (${x.reason})`))),
      expected: [
        sys('각 동작 전에 확인 단계를 보여준다'),
        sys('실행한 뒤 되돌릴 수 있는 수단(Undo·복구)을 제공한다'),
        sys('권한 없는 계정의 실행을 차단한다'),
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
      steps: crawl.notVisited.slice(0, 8).map((p) => step('확인', qa(`"${p.label || p.url}" 화면을 직접 열어 확인한다`))),
      expected: [
        `탐색 상한(페이지 ${crawl.limits.maxPages} · 깊이 ${crawl.limits.maxDepth})을 넓혀 다시 분석하거나 QA 가 수동으로 확인한다`,
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
