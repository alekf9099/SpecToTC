'use strict';

/**
 * 화면 인벤토리 → 테스트케이스.
 *
 * 출력 구조는 기획서 기반 TC 와 **완전히 동일**하다(title/objective/precondition/
 * steps/expected/priority/requirement/tags). 그래서 표·필터·CSV·PDF 내보내기가
 * 손대지 않고 그대로 동작한다. 근거(requirement)에는 요구사항 문장 대신
 * "페이지에서 관측한 사실"을 넣어 어디서 나온 TC 인지 추적할 수 있게 한다.
 */
const { step, truncate } = require('../engine/generator');

const TYPE_TAG = { Pass: '정상', Fail: '실패', 'Edge Case': '경계' };

/** 입력 타입별 잘못된 값 예시 — 형식 검증 TC 에 쓴다 */
const INVALID_SAMPLE = {
  email: 'abc@ (도메인 없음), abc.com (@ 없음)',
  tel: '전화번호 자리에 문자 abc',
  number: '문자 abc, 음수 -1',
  url: 'htp://broken',
  date: '2026-13-45 (없는 날짜)',
  password: '공백 1칸',
  search: '특수문자 <>\'"%',
  file: '허용되지 않는 확장자(.exe)',
};

/** 필드 제약을 사람이 읽는 문구로 */
function describeConstraints(field) {
  const c = field.constraints || {};
  const out = [];
  if (c.required) out.push('필수');
  if (c.maxLength) out.push(`최대 ${c.maxLength}자`);
  if (c.minLength) out.push(`최소 ${c.minLength}자`);
  if (c.min !== undefined && c.min !== null) out.push(`최소값 ${c.min}`);
  if (c.max !== undefined && c.max !== null) out.push(`최대값 ${c.max}`);
  if (c.pattern) out.push(`패턴 ${truncate(String(c.pattern), 28)}`);
  if (c.accept) out.push(`허용 형식 ${truncate(String(c.accept), 28)}`);
  if (c.readonly) out.push('읽기 전용');
  if (c.disabled) out.push('비활성');
  return out;
}

function buildWebTestCases(inventory, options = {}) {
  const counters = { P: 0, F: 0, E: 0 };
  const out = [];
  const host = (() => {
    try { return new URL(inventory.page.url).hostname; } catch (err) { return inventory.page.url; }
  })();

  const emit = (type, area, tc) => {
    const code = type === 'Pass' ? 'P' : type === 'Fail' ? 'F' : 'E';
    counters[code] += 1;
    const title = `[${TYPE_TAG[type]}] ${area} — ${tc.title}`;
    out.push({
      tc_id: `TC-${code}-${String(counters[code]).padStart(3, '0')}`,
      type,
      priority: tc.priority || 'Med',
      area,
      title,
      objective: tc.objective,
      precondition: tc.precondition,
      steps: tc.steps,
      expected: tc.expected,
      requirement: {
        id: tc.evidenceId || 'WEB',
        text: tc.evidence,
        line: null,
        categories: tc.categories || ['화면 분석'],
      },
      tags: (tc.tags || []).concat('web'),
      origin: 'web',

      // 하위 호환 필드 (CSV·기존 스크립트용)
      scenario: title,
      requirement_id: tc.evidenceId || 'WEB',
      source_text: tc.evidence,
      source_line: null,
      categories: tc.categories || ['화면 분석'],
    });
  };

  const base = [`${host} 접속 가능`, '검증용 브라우저(지원 매트릭스 기준) 준비'];

  /* ------------------------------------------------------------ 페이지 로딩 */
  emit('Pass', '페이지 로딩', {
    title: `${inventory.page.title || host} 정상 진입`,
    objective: '페이지가 오류 없이 렌더되고 주요 영역이 표시되는지 확인한다.',
    precondition: base,
    steps: [
      step('진입', inventory.page.url),
      step('확인', '콘솔 오류 · 깨진 이미지 · 레이아웃 붕괴 여부'),
      step('확인', `주요 제목 노출 (${(inventory.structure.headings[0] || {}).text || '제목 확인'})`),
    ],
    expected: ['200 응답으로 렌더', '콘솔 에러 없음', '주요 영역 정상 표시'],
    evidence: `제목 "${inventory.page.title || '(없음)'}" · 섹션 ${inventory.structure.sections}개 · 본문 ${inventory.page.textLength}자`,
    evidenceId: 'WEB-PAGE',
    priority: 'High',
    tags: ['smoke'],
  });

  /* ------------------------------------------------------------------ 폼 */
  (inventory.interaction.forms || []).forEach((form, fi) => {
    const area = form.name;
    const evidenceId = `WEB-FORM-${fi + 1}`;
    const evidence = `${form.method} ${form.action} · 필드 ${form.fields.length}개`
      + (form.outsideForm ? ' (form 태그 밖 — JS 처리 추정)' : '');
    const required = form.fields.filter((f) => f.constraints && f.constraints.required);
    const fieldList = form.fields.slice(0, 8).map((f) => `${f.label}(${f.type})`).join(', ');

    // 정상 제출
    emit('Pass', area, {
      title: '유효한 값으로 제출',
      objective: '정상 입력에서 제출이 성공하고 결과 화면이 명세대로 표시되는지 확인한다.',
      precondition: base.concat(`대상 폼: ${form.method} ${form.action}`),
      steps: [
        step('입력', `모든 필드에 유효한 값 — ${fieldList || '입력 필드'}`),
        step('실행', form.submits[0] ? `"${form.submits[0]}" 클릭` : '제출'),
        step('확인', '결과 화면 · 서버 응답 · 저장된 값'),
      ],
      expected: ['제출 성공', '결과/완료 화면 표시', '입력값이 정확히 반영됨'],
      evidence,
      evidenceId,
      priority: form.kind === 'login' ? 'High' : 'Med',
      categories: ['화면 분석', '폼'],
      tags: ['form', 'happy-path'],
    });

    // 필수값 미입력
    if (required.length) {
      emit('Fail', area, {
        title: `필수값 미입력 (${required.length}개)`,
        objective: '필수 항목이 비었을 때 제출이 차단되고 사유가 안내되는지 확인한다.',
        precondition: base,
        steps: [
          step('입력', `필수 항목을 공백으로 둠 — ${required.map((f) => f.label).slice(0, 6).join(', ')}`),
          step('실행', '제출'),
        ],
        expected: ['제출 차단', '해당 필드에 오류 안내 표시', '서버 요청 미발생 또는 400 응답'],
        evidence: `${evidence} · required: ${required.map((f) => f.name || f.label).join(', ')}`,
        evidenceId,
        priority: 'High',
        categories: ['화면 분석', '입력 검증'],
        tags: ['form', 'validation'],
      });
    } else if (form.fields.length) {
      emit('Fail', area, {
        title: '빈 값으로 제출 (필수 표기 없음 — 기획 확인 필요)',
        objective: 'HTML 에 required 표기가 없어, 빈 값 제출 시 서버가 어떻게 처리하는지 확인한다.',
        precondition: base,
        steps: [step('입력', '모든 필드를 비움'), step('실행', '제출')],
        expected: ['서버가 검증해 오류를 안내하거나, 정책상 허용되는지 확인', '무응답·크래시 없음'],
        evidence: `${evidence} · required 속성 없음`,
        evidenceId,
        priority: 'Med',
        categories: ['화면 분석', '입력 검증'],
        tags: ['form', 'validation', 'spec-gap'],
      });
    }

    // 형식 오류
    const typed = form.fields.filter((f) => INVALID_SAMPLE[f.type] || f.constraints.pattern);
    if (typed.length) {
      emit('Fail', area, {
        title: '형식에 맞지 않는 값 입력',
        objective: '타입·패턴 제약이 실제로 검증되는지 확인한다.',
        precondition: base,
        steps: typed.slice(0, 5).map((f) => step('입력',
          `${f.label} ← ${INVALID_SAMPLE[f.type] || `패턴 위반 값 (${truncate(String(f.constraints.pattern), 24)})`}`)),
        expected: ['각 필드에서 형식 오류 안내', '제출 차단', '브라우저 기본 메시지에만 의존하지 않는지 확인'],
        evidence: `${evidence} · 타입/패턴 보유 필드 ${typed.length}개`,
        evidenceId,
        priority: 'Med',
        categories: ['화면 분석', '입력 검증'],
        tags: ['form', 'validation'],
      });
    }

    // 길이 경계
    const bounded = form.fields.filter((f) => f.constraints.maxLength || f.constraints.minLength
      || f.constraints.max !== undefined || f.constraints.min !== undefined);
    bounded.slice(0, 4).forEach((f) => {
      const c = f.constraints;
      const limit = c.maxLength || c.max;
      const lower = c.minLength || c.min;
      const points = [];
      if (lower !== undefined && lower !== null) {
        points.push(`${Number(lower) - 1} → 거부`, `${lower} → 허용`);
      }
      if (limit !== undefined && limit !== null) {
        points.push(`${limit} → 허용`, `${Number(limit) + 1} → 거부(또는 입력 자체가 잘림)`);
      }
      emit('Edge Case', area, {
        title: `${f.label} 경계값 (${describeConstraints(f).join(' · ')})`,
        objective: '입력 제약의 경계에서 허용/거부가 정확한지 확인한다.',
        precondition: base.concat(`대상 필드: ${f.label} (${f.type})`),
        steps: points.map((p) => step('입력', p.split(' → ')[0] + ' 길이/값')),
        expected: points,
        evidence: `${evidence} · ${f.name || f.label}: ${JSON.stringify(c)}`,
        evidenceId,
        priority: 'Med',
        categories: ['화면 분석', '경계값'],
        tags: ['form', 'boundary'],
      });
    });

    // XSS
    if (form.fields.some((f) => ['text', 'search', 'textarea', 'email', 'url'].includes(f.type))) {
      emit('Fail', area, {
        title: '스크립트 삽입(XSS) 시도',
        objective: '입력값이 그대로 렌더되어 스크립트가 실행되지 않는지 확인한다.',
        precondition: base,
        steps: [
          step('입력', '<script>alert(1)</script> 와 "><img src=x onerror=alert(1)>'),
          step('실행', '제출'),
          step('확인', '결과 화면·목록·상세에서 렌더 결과'),
        ],
        expected: ['스크립트 미실행', '입력값이 문자열로 이스케이프되어 표시', '저장형 XSS 없음'],
        evidence,
        evidenceId,
        priority: 'High',
        categories: ['화면 분석', '보안'],
        tags: ['form', 'security', 'xss'],
      });
    }

    // 로그인 폼 전용
    if (form.kind === 'login') {
      emit('Fail', area, {
        title: '잘못된 자격 증명 · 연속 실패',
        objective: '인증 실패 처리와 잠금·안내 정책을 확인한다.',
        precondition: base.concat('사용 가능한 테스트 계정 1개'),
        steps: [
          step('입력', '존재하지 않는 계정 / 올바른 계정 + 틀린 비밀번호'),
          step('실행', '로그인 시도를 연속 5회 반복'),
          step('확인', '오류 문구 · 잠금 여부 · 계정 존재 여부가 문구로 노출되는지'),
        ],
        expected: [
          '로그인 실패 및 사유 안내',
          '계정 존재 여부를 구분해 알려주지 않음(열거 공격 방지)',
          '연속 실패 시 잠금·지연 정책 동작(정책 확인 필요)',
        ],
        evidence: `${evidence} · password 필드 존재`,
        evidenceId,
        priority: 'High',
        categories: ['화면 분석', '인증'],
        tags: ['login', 'security'],
      });
    }

    // 검색 폼 전용
    if (form.kind === 'search') {
      emit('Edge Case', area, {
        title: '검색어 경계 (빈 값 · 특수문자 · 초장문 · 결과 0건)',
        objective: '검색 입력의 경계 조건에서 화면이 안전하게 동작하는지 확인한다.',
        precondition: base,
        steps: [
          step('입력', '빈 검색어로 실행'),
          step('입력', '특수문자 <>\'"%& 와 SQL 예약어'),
          step('입력', '1000자 이상 초장문'),
          step('입력', '결과가 없을 단어'),
        ],
        expected: [
          '빈 검색어는 차단 또는 전체 목록(정책 확인 필요)',
          '특수문자로 화면·쿼리 오류 없음',
          '초장문에서 오류 없이 처리 또는 길이 제한 안내',
          '결과 0건은 빈 상태 문구 표시',
        ],
        evidence,
        evidenceId,
        priority: 'Med',
        categories: ['화면 분석', '검색'],
        tags: ['search', 'boundary'],
      });
    }

    // 파일 업로드
    if (form.hasFileUpload) {
      const fileField = form.fields.find((f) => f.type === 'file');
      emit('Fail', area, {
        title: '허용되지 않는 파일 업로드',
        objective: '확장자·용량 제한이 실제로 차단되는지 확인한다.',
        precondition: base.concat('허용/비허용 확장자 파일과 대용량 파일 준비'),
        steps: [
          step('입력', '허용되지 않는 확장자(.exe, .svg) 선택'),
          step('입력', '매우 큰 파일(수십 MB) 선택'),
          step('실행', '업로드'),
        ],
        expected: ['업로드 차단', '허용 형식·용량 기준이 포함된 안내', '서버에서도 검증(클라이언트만 막지 않는지)'],
        evidence: `${evidence} · accept: ${(fileField && fileField.constraints.accept) || '(미지정 — 확인 필요)'}`,
        evidenceId,
        priority: 'High',
        categories: ['화면 분석', '파일'],
        tags: ['upload', 'security'],
      });
    }
  });

  /* --------------------------------------------------------------- 링크·이동 */
  if (inventory.links.internalCount) {
    emit('Pass', '화면 이동', {
      title: `주요 내부 링크 이동 (${inventory.links.internalCount}개 중 대표)`,
      objective: '내부 링크가 의도한 화면으로 이동하고 깨진 링크가 없는지 확인한다.',
      precondition: base,
      steps: [
        step('실행', `대표 링크 순차 클릭 — ${inventory.links.internal.slice(0, 5).map((l) => l.label || l.path).join(', ')}`),
        step('확인', '이동 결과 · 404/500 여부 · 뒤로가기 복귀'),
      ],
      expected: ['모든 링크가 200 으로 이동', '뒤로가기로 이전 화면 복귀', '깨진 링크 없음'],
      evidence: `내부 링크 ${inventory.links.internalCount}개 · 외부 ${inventory.links.externalCount}개`,
      evidenceId: 'WEB-LINK',
      priority: 'Med',
      categories: ['화면 분석', '화면 이동'],
      tags: ['navigation'],
    });
  }

  if (inventory.links.problems.targetBlankNoRel) {
    emit('Fail', '화면 이동', {
      title: `새 창 링크에 rel="noopener" 누락 ${inventory.links.problems.targetBlankNoRel}건`,
      objective: '새 창으로 열리는 링크가 원본 창을 조작할 수 없게 되어 있는지 확인한다.',
      precondition: base,
      steps: [step('확인', 'target="_blank" 링크의 rel 속성'), step('실행', '해당 링크로 이동 후 원본 탭 상태 확인')],
      expected: ['rel="noopener noreferrer" 적용', '새 창에서 원본 창(window.opener) 접근 불가'],
      evidence: `target=_blank + rel 누락 ${inventory.links.problems.targetBlankNoRel}건`,
      evidenceId: 'WEB-LINK',
      priority: 'Med',
      categories: ['화면 분석', '보안'],
      tags: ['navigation', 'security'],
    });
  }

  /* ------------------------------------------------------------- 접근성·반응형 */
  const a11y = inventory.accessibility;
  if (a11y.missingAlt || a11y.langMissing || a11y.emptyLinks || a11y.unlabeledLinks) {
    const findings = [];
    if (a11y.missingAlt) findings.push(`alt 없는 이미지 ${a11y.missingAlt}/${a11y.images}개`);
    if (a11y.langMissing) findings.push('html lang 속성 없음');
    if (a11y.emptyLinks) findings.push(`href 가 비었거나 #인 링크 ${a11y.emptyLinks}개`);
    if (a11y.unlabeledLinks) findings.push(`텍스트 없는 링크 ${a11y.unlabeledLinks}개`);

    emit('Fail', '접근성', {
      title: '접근성 결함 확인',
      objective: '스크린리더·키보드 사용자가 화면을 이용할 수 있는지 확인한다.',
      precondition: base.concat('스크린리더 또는 접근성 검사 도구'),
      steps: [
        step('확인', findings.join(' / ')),
        step('실행', 'Tab 키만으로 주요 기능까지 이동'),
        step('확인', '포커스 표시가 보이는지'),
      ],
      expected: ['의미 있는 이미지에 alt 제공', 'lang 속성 지정', '키보드만으로 주요 기능 사용 가능', '포커스 표시 유지'],
      evidence: findings.join(' / '),
      evidenceId: 'WEB-A11Y',
      priority: 'Med',
      categories: ['화면 분석', '접근성'],
      tags: ['a11y'],
    });
  }

  emit('Edge Case', '반응형', {
    title: '모바일·태블릿 해상도 표시',
    objective: '좁은 화면에서 레이아웃이 깨지거나 요소가 잘리지 않는지 확인한다.',
    precondition: base.concat(inventory.page.hasViewport
      ? `viewport: ${inventory.page.viewport}`
      : 'viewport meta 없음 — 모바일 대응 여부 기획 확인 필요'),
    steps: [
      step('확인', '375×812 (모바일)'),
      step('확인', '768×1024 (태블릿)'),
      step('확인', '가로 스크롤 발생 여부 · 버튼 터치 영역'),
    ],
    expected: ['가로 스크롤 없음', '텍스트·버튼 잘림 없음', '터치 대상이 충분히 큼'],
    evidence: inventory.page.hasViewport ? `viewport meta: ${inventory.page.viewport}` : 'viewport meta 없음',
    evidenceId: 'WEB-RESPONSIVE',
    priority: inventory.page.hasViewport ? 'Med' : 'High',
    categories: ['화면 분석', '반응형'],
    tags: ['responsive'],
  });

  /* ------------------------------------------------------------- 공통 예외 */
  emit('Fail', '예외 처리', {
    title: '없는 경로 · 네트워크 실패',
    objective: '오류 상황에서 사용자가 복구할 수단이 있는지 확인한다.',
    precondition: base,
    steps: [
      step('실행', `없는 경로 직접 접근 (${new URL('/__not_found__' + Date.now(), inventory.page.url).pathname})`),
      step('실행', '네트워크를 차단한 뒤 새로고침'),
    ],
    expected: ['404 안내 화면 표시(빈 화면·스택 트레이스 아님)', '네트워크 오류 안내와 재시도 수단 제공'],
    evidence: `기준 주소 ${inventory.page.url}`,
    evidenceId: 'WEB-ERROR',
    priority: 'Med',
    categories: ['화면 분석', '오류 처리'],
    tags: ['error'],
  });

  if (inventory.rendering.jsRendered) {
    emit('Edge Case', '분석 한계', {
      title: 'JS 렌더링 화면 — 수동 확인 필요',
      objective: '정적 HTML 로 보이지 않는 화면 요소를 사람이 직접 확인해야 한다.',
      precondition: base,
      steps: [
        step('확인', '브라우저에서 페이지를 열어 실제 렌더된 폼·버튼·목록 확인'),
        step('확인', '이 도구가 놓친 요소를 TC 로 추가'),
      ],
      expected: ['실제 화면 요소 목록 확보', '누락된 검증 항목을 TC 로 보완'],
      evidence: inventory.rendering.note,
      evidenceId: 'WEB-RENDER',
      priority: 'High',
      categories: ['화면 분석', '분석 한계'],
      tags: ['spec-gap'],
    });
  }

  return out;
}

module.exports = { buildWebTestCases, describeConstraints };
