'use strict';

/**
 * 화면 인벤토리 → 요약 (기획서 요약과 같은 형태).
 *
 * 대시보드의 요약 패널·검증 분석서·PDF 내보내기가 모두 specSummary 형태를
 * 기대하므로, 화면 분석 결과도 같은 필드에 맞춰 채운다.
 * 다만 "문서에서 읽은 것"이 아니라 "페이지에서 관측한 것"이므로 근거 표기를 구분한다.
 */
const OBSERVED = '페이지 관측';
const NOT_SPECIFIED = '(페이지만으로는 알 수 없음 — 기획 확인 필요)';

const describe = (f) => {
  const c = f.constraints || {};
  const parts = [];
  if (c.required) parts.push('필수');
  if (c.maxLength) parts.push(`최대 ${c.maxLength}자`);
  if (c.minLength) parts.push(`최소 ${c.minLength}자`);
  if (c.min !== undefined && c.min !== null) parts.push(`min ${c.min}`);
  if (c.max !== undefined && c.max !== null) parts.push(`max ${c.max}`);
  if (c.pattern) parts.push('패턴 지정');
  return parts;
};

function buildWebSummary(inventory, testCases) {
  const inv = inventory;
  const forms = inv.interaction.forms || [];
  const fields = forms.flatMap((f) => f.fields);

  /* 개요 */
  const overview = {
    areas: new Set(testCases.map((tc) => tc.area)).size,
    requirements: forms.length + (inv.links.internalCount ? 1 : 0),
    conditional: forms.length,
    withNumericRule: fields.filter((f) => describe(f).length).length,
    languages: [inv.page.lang || 'unknown'],
    topCategories: [
      { label: '폼', count: forms.length },
      { label: '입력 필드', count: fields.length },
      { label: '버튼', count: inv.interaction.buttonCount },
      { label: '내부 링크', count: inv.links.internalCount },
      { label: '외부 링크', count: inv.links.externalCount },
      { label: '이미지', count: inv.accessibility.images },
    ].filter((c) => c.count),
  };

  const headline = `${inv.page.title || inv.page.url} — 폼 ${forms.length}개 · 입력 ${fields.length}개 · `
    + `버튼 ${inv.interaction.buttonCount}개 · 내부 링크 ${inv.links.internalCount}개`
    + (inv.rendering.jsRendered ? ' · ⚠ JS 렌더링 위주(요소 누락 가능)' : '');

  /* 핵심 항목 = 폼과 주요 상호작용 */
  const keyPoints = forms.map((f, i) => ({
    requirementId: `WEB-FORM-${i + 1}`,
    area: f.name,
    line: null,
    text: `${f.method} ${f.action} — 필드 ${f.fields.length}개 (${f.fields.slice(0, 6).map((x) => x.label).join(', ')})`,
    score: f.kind === 'login' ? 20 : f.kind === 'search' ? 12 : 10,
    categories: [f.kind === 'login' ? '인증' : f.kind === 'search' ? '검색' : '폼', OBSERVED],
    condition: f.outsideForm ? 'form 태그 밖 입력 (JS 처리 추정)' : null,
    constraints: f.fields.flatMap(describe).slice(0, 6),
  }));

  if (inv.interaction.buttons.length) {
    keyPoints.push({
      requirementId: 'WEB-BUTTON',
      area: '버튼·액션',
      line: null,
      text: `버튼 ${inv.interaction.buttonCount}개 — ${inv.interaction.buttons.slice(0, 10).join(', ')}`,
      score: 8,
      categories: ['상호작용', OBSERVED],
      condition: null,
      constraints: [],
    });
  }

  /* 수치 기준 = 입력 제약 */
  const numericRules = [];
  forms.forEach((f, i) => {
    f.fields.forEach((field) => {
      const parts = describe(field);
      if (!parts.length) return;
      numericRules.push({
        kind: '입력 제약',
        area: f.name,
        criterion: parts.join(' · '),
        value: field.constraints.maxLength || field.constraints.max || null,
        unit: null,
        op: null,
        source: `${field.label} (${field.type})`,
        requirementId: `WEB-FORM-${i + 1}`,
        text: `${field.name || field.label}: ${JSON.stringify(field.constraints)}`,
      });
    });
  });

  /* 확인 필요 */
  const risks = [];
  const addRisk = (type, message, question, items) => {
    risks.push({ type, message, question, items, count: items.length, areas: [...new Set(items.map((i) => i.area))] });
  };

  if (inv.rendering.jsRendered) {
    addRisk('분석 한계', inv.rendering.note,
      '이 화면은 브라우저에서 직접 열어 요소를 확인한 뒤 TC 를 보완해야 합니다.',
      [{ requirementId: 'WEB-RENDER', area: '분석 한계', text: `본문 ${inv.page.textLength}자 · 스크립트 ${inv.rendering.scripts}개`, line: null }]);
  }
  if (inv.accessibility.missingAlt) {
    addRisk('접근성', `alt 속성이 없는 이미지 ${inv.accessibility.missingAlt}개 (전체 ${inv.accessibility.images}개)`,
      '의미 있는 이미지인지, 장식용이라 alt="" 가 맞는지 확인이 필요합니다.',
      [{ requirementId: 'WEB-A11Y', area: '접근성', text: `alt 누락 ${inv.accessibility.missingAlt}개`, line: null }]);
  }
  if (inv.accessibility.langMissing) {
    addRisk('접근성', 'html 태그에 lang 속성이 없음',
      '문서 기본 언어를 지정해야 스크린리더가 올바르게 읽습니다.',
      [{ requirementId: 'WEB-A11Y', area: '접근성', text: 'lang 속성 없음', line: null }]);
  }
  if (!inv.page.hasViewport) {
    addRisk('반응형', 'viewport meta 태그가 없음',
      '모바일 대응이 범위에 포함되는지 기획에 확인해야 합니다.',
      [{ requirementId: 'WEB-RESPONSIVE', area: '반응형', text: 'viewport meta 없음', line: null }]);
  }
  if (inv.links.problems.targetBlankNoRel) {
    addRisk('보안', `새 창 링크 ${inv.links.problems.targetBlankNoRel}건에 rel="noopener" 누락`,
      'target="_blank" 링크에 rel="noopener noreferrer" 를 적용해야 합니다.',
      [{ requirementId: 'WEB-LINK', area: '화면 이동', text: `rel 누락 ${inv.links.problems.targetBlankNoRel}건`, line: null }]);
  }
  if (inv.links.problems.emptyHref) {
    addRisk('접근성', `href 가 비었거나 "#" 인 링크 ${inv.links.problems.emptyHref}개`,
      '실제 이동이 없는 링크는 button 으로 바꾸는 것이 맞는지 확인이 필요합니다.',
      [{ requirementId: 'WEB-LINK', area: '화면 이동', text: `빈 링크 ${inv.links.problems.emptyHref}개`, line: null }]);
  }
  const noAccept = forms.filter((f) => f.hasFileUpload && !f.fields.some((x) => x.constraints.accept));
  if (noAccept.length) {
    addRisk('기준 누락', '파일 업로드에 허용 형식(accept)이 지정되지 않음',
      '허용 확장자와 최대 용량 기준을 알려주세요.',
      noAccept.map((f, i) => ({ requirementId: `WEB-FORM-${i + 1}`, area: f.name, text: 'accept 미지정', line: null })));
  }

  /* 영역별 요점 */
  const byAreaMap = new Map();
  testCases.forEach((tc) => {
    if (!byAreaMap.has(tc.area)) byAreaMap.set(tc.area, { area: tc.area, requirements: 0, focus: new Set(), highlights: [] });
    const e = byAreaMap.get(tc.area);
    e.requirements += 1;
    (tc.requirement.categories || []).forEach((c) => e.focus.add(c));
    if (e.highlights.length < 3) e.highlights.push(tc.title.replace(/^\[[^\]]+\]\s*/, ''));
  });
  const byArea = [...byAreaMap.values()]
    .map((e) => ({ ...e, focus: [...e.focus].slice(0, 5) }))
    .sort((a, b) => b.requirements - a.requirements);

  /* QA 검증 분석서 — 화면 분석에 맞춘 형태 */
  const urls = inv.links.internal.slice(0, 25).map((l) => ({
    screen: l.label || '(라벨 없음)',
    method: null,
    path: l.path,
    access: NOT_SPECIFIED,
    scenario: '이동 확인 · 404 여부 · 뒤로가기 복귀',
  }));

  const flowLines = ['flowchart TD', '    START[페이지 진입]'];
  forms.forEach((f, i) => {
    flowLines.push(`    START --> F${i}["${f.name.replace(/["[\]{}()|]/g, '')}"]`);
    flowLines.push(`    F${i} --> R${i}{제출 결과}`);
    flowLines.push(`    R${i} -- 성공 --> OK${i}[결과 화면]`);
    flowLines.push(`    R${i} -- 실패 --> NG${i}[오류 안내]`);
  });
  if (!forms.length) flowLines.push('    START --> BROWSE[콘텐츠 열람 · 링크 이동]');

  const qaPlan = {
    checkpoints: [
      {
        title: '입력 검증',
        items: fields.length
          ? [{
            what: `입력 필드 ${fields.length}개의 제약 확인`,
            why: '클라이언트 제약만 있고 서버 검증이 없으면 우회가 가능하다.',
            how: 'DevTools 로 maxlength·required 를 제거하거나 API 를 직접 호출해 서버가 다시 검증하는지 본다.',
          }]
          : [{ what: `입력 필드 ${NOT_SPECIFIED}`, why: '정적 HTML 에서 입력 요소를 찾지 못했다.', how: '브라우저에서 실제 화면을 열어 입력 요소를 확인한다.' }],
      },
      {
        title: '보안',
        items: [
          { what: '저장형 XSS', why: '입력이 그대로 렌더되면 스크립트가 실행된다.', how: '<script>alert(1)</script> 를 입력해 결과 화면에서 실행 여부를 본다.' },
          { what: '새 창 링크 rel 속성', why: 'noopener 가 없으면 새 창에서 원본 창을 조작할 수 있다.', how: 'target="_blank" 링크의 rel 을 확인한다.' },
        ],
      },
      {
        title: '접근성',
        items: [{
          what: `이미지 alt (${inv.accessibility.missingAlt}/${inv.accessibility.images} 누락) · 키보드 이동`,
          why: '스크린리더·키보드 사용자가 기능에 접근할 수 없으면 결함이다.',
          how: 'Tab 만으로 주요 기능까지 이동되는지, 포커스 표시가 보이는지 확인한다.',
        }],
      },
      {
        title: '반응형',
        items: [{
          what: inv.page.hasViewport ? `viewport: ${inv.page.viewport}` : `viewport meta 없음 ${NOT_SPECIFIED}`,
          why: '모바일에서 레이아웃이 깨지면 사용 자체가 막힌다.',
          how: '375×812 / 768×1024 에서 가로 스크롤·잘림을 확인한다.',
        }],
      },
      {
        title: '분석 환경',
        items: [{
          what: inv.rendering.jsRendered ? 'JS 렌더링 위주 — 정적 분석 한계' : '정적 HTML 로 주요 요소 확인 가능',
          why: '이 도구는 브라우저 실행 없이 HTML 만 읽으므로, JS 로 그려지는 요소는 보이지 않는다.',
          how: '브라우저로 직접 열어 이 목록에 없는 요소를 TC 로 보완한다.',
        }],
      },
    ],
    todos: [
      { text: '검증 환경(스테이징) 주소와 테스트 계정 확보', reason: '실제 제출·로그인 검증에 필요' },
      { text: '지원 브라우저·최소 해상도 확정', reason: '결함 인정 범위를 정하기 위해' },
      ...(inv.interaction.hasLogin ? [{ text: '로그인 테스트 계정(정상·잠금 대상) 준비', reason: '인증 실패·잠금 정책 검증' }] : []),
      ...(inv.interaction.hasUpload ? [{ text: '허용/비허용 확장자·대용량 파일 준비', reason: '업로드 제약 검증' }] : []),
      ...(inv.rendering.jsRendered ? [{ text: '브라우저에서 실제 화면 요소 목록 작성', reason: '정적 분석이 놓친 부분 보완' }] : []),
      { text: '생성된 TC 검토 후 사내 TC 시트에 병합', reason: '자동 생성분은 초안' },
    ],
    urls,
    flow: {
      mermaid: flowLines.join('\n'),
      caption: '폼 제출 흐름을 관측된 폼 기준으로 구성했습니다. 실제 화면 전이 순서는 기획·화면 확인이 필요합니다.',
      ordered: false,
    },
    figma: null,
    nonGoals: [{
      text: `${NOT_SPECIFIED} — 화면만 분석했으므로 프로젝트 범위(제외 항목)는 기획서에서 확인해야 합니다.`,
      line: null,
      source: '페이지 관측 불가',
    }],
    goals: [{
      text: `${inv.page.title || inv.page.url} 화면의 입력·이동·오류 처리가 정상 동작하는지 확인`,
      line: null,
      source: OBSERVED,
    }],
    guarantee: `검증이 통과되면 ${byArea.slice(0, 5).map((a) => a.area).join(' · ')} 영역의 화면 동작이 보장된다. `
      + '단, 기획서 없이 화면만 본 결과이므로 "명세대로인지" 는 판단할 수 없다.',
  };

  return {
    headline,
    overview,
    keyPoints,
    byArea,
    numericRules,
    risks,
    qaPlan,
    coverage: {
      testCases: testCases.length,
      coveredRequirements: new Set(testCases.map((tc) => tc.requirement_id)).size,
      uncovered: [],
      perRequirement: overview.requirements ? Number((testCases.length / overview.requirements).toFixed(1)) : testCases.length,
    },
  };
}

module.exports = { buildWebSummary, NOT_SPECIFIED, OBSERVED };
