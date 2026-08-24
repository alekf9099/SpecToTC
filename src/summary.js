'use strict';

/**
 * 기획서 핵심 요약 — QA 가 문서를 처음 열었을 때 30초 안에 파악해야 하는 것만 뽑는다.
 *
 *  1) 개요        문서 규모 / 영역 / 언어
 *  2) 핵심 요구사항  중요도 점수 상위 항목
 *  3) 수치 기준    경계값·재시도·성능 기준 표 (검증 시 그대로 쓰는 값)
 *  4) 영역별 요점  영역마다 무엇을 보는지
 *  5) 확인 필요    모호 표현·누락된 실패 처리 등 기획 확인 항목
 */
const { WEIGHTS, LABELS, truncate, clean, formatCriterion } = require('./engine/generator');
const { parseDocument } = require('./engine/parser');
const { buildQaPlan } = require('./qaPlan');

const OP_TEXT = { '>=': '이상', '<=': '이하', '>': '초과', '<': '미만' };

/** 문서에서 걸러내야 할 모호 표현 — QA 가 판정 기준을 세울 수 없는 문구 */
const VAGUE_PATTERNS = [
  { re: /적절히|적당히|알맞게|원활히|자연스럽게/, note: '판정 기준이 없는 정성 표현' },
  { re: /필요시|필요에\s*따라|가능하면|가급적|추후|나중에/, note: '조건이 불명확해 테스트 시점을 정할 수 없음' },
  { re: /등(?:을|를|의|이|,|\s|$)|기타/, note: '"등"으로 생략된 항목 — 대상 목록 확정 필요' },
  { re: /빠르게|즉시|신속히|바로/, note: '수치 기준 없는 성능 표현 — 목표 응답시간 확정 필요' },
  { re: /\bTBD\b|미정|협의\s*중|확인\s*필요/i, note: '미확정 항목' },
  { re: /최적화|개선|고도화/, note: '검증 가능한 완료 조건 필요' },
];

function requirementScore(req) {
  let score = req.categories.reduce((sum, key) => sum + (WEIGHTS[key] || 0), 0);
  if (req.constraints.length) score += 2;
  if (req.retryCount != null) score += 1;
  if (req.condition) score += 1;
  return score;
}

function labelize(categories) {
  return categories.map((k) => LABELS[k] || k);
}

/* --------------------------------------------------------------- 수치 기준 */

function collectNumericRules(requirements) {
  const rules = [];
  for (const req of requirements) {
    for (const c of req.constraints) {
      rules.push({
        kind: '경계값',
        area: req.area,
        criterion: formatCriterion(c),
        value: c.value,
        unit: c.unit,
        op: c.op,
        source: c.source,
        requirementId: req.id,
        text: truncate(req.text, 80),
      });
    }
    // "retry up to 3 times" 처럼 경계값으로도 잡힌 경우 중복 행을 만들지 않는다.
    const retryAlreadyListed = req.retryCount != null
      && req.constraints.some((c) => c.value === req.retryCount && (c.unit === '회' || c.unit == null));
    if (req.retryCount != null && !retryAlreadyListed) {
      rules.push({
        kind: '재시도',
        area: req.area,
        criterion: `${req.retryCount}회`,
        value: req.retryCount,
        unit: '회',
        op: '<=',
        source: null,
        requirementId: req.id,
        text: truncate(req.text, 80),
      });
    }
  }
  return rules;
}

/* --------------------------------------------------------------- 확인 필요 */

function collectRisks(requirements) {
  const risks = [];
  const add = (type, message, req, question) => {
    risks.push({
      type,
      message,
      question,
      area: req ? req.area : null,
      requirementId: req ? req.id : null,
      text: req ? truncate(req.text, 90) : null,
      line: req ? req.line : null,
    });
  };

  // 영역별로 실패 처리 요구사항이 있는지 미리 집계
  const areasWithFailureSpec = new Set(
    requirements
      .filter((r) => r.categories.some((c) => c === 'ERROR' || c === 'VALIDATION'))
      .map((r) => r.area)
  );

  for (const req of requirements) {
    for (const v of VAGUE_PATTERNS) {
      if (v.re.test(req.text)) {
        add('모호 표현', v.note, req, `"${truncate(req.text, 50)}" 의 판정 기준을 수치/목록으로 확정해 주세요.`);
        break;
      }
    }

    if (req.categories.includes('RETRY') && req.retryCount == null) {
      add('기준 누락', '재시도 언급은 있으나 횟수·간격이 명시되지 않음', req, '재시도 최대 횟수와 간격(백오프)을 알려주세요.');
    }

    if (req.categories.includes('CONDITION') && !areasWithFailureSpec.has(req.area)) {
      add('실패 처리 누락', '조건 분기는 있으나 해당 영역에 실패/예외 처리 명세가 없음', req,
        `${req.area} 에서 조건 미충족 시 어떤 화면·문구를 보여줘야 하나요?`);
    }

    for (const c of req.constraints) {
      if (!c.unit) {
        add('단위 누락', `수치 ${c.value} 의 단위가 불명확 (${c.source})`, req, `${c.source} 의 단위(자·건·초 등)를 확정해 주세요.`);
      }
    }

    if (req.categories.includes('PAYMENT') && !req.categories.includes('ERROR')) {
      add('예외 흐름 확인', '결제 관련 요구사항에 실패 시나리오가 함께 기술되지 않음', req,
        '결제 실패·중복 결제·부분 환불 시 처리 정책을 알려주세요.');
    }
  }

  // 같은 사유는 한 항목으로 묶고, 해당하는 요구사항 목록을 안에 담는다.
  const grouped = new Map();
  for (const r of risks) {
    const key = `${r.type}|${r.message}`;
    if (!grouped.has(key)) {
      grouped.set(key, { type: r.type, message: r.message, question: r.question, items: [] });
    }
    const entry = grouped.get(key);
    if (entry.items.some((i) => i.requirementId === r.requirementId)) continue;
    entry.items.push({ requirementId: r.requirementId, area: r.area, text: r.text, line: r.line });
  }

  return [...grouped.values()]
    .map((g) => ({ ...g, count: g.items.length, areas: [...new Set(g.items.map((i) => i.area))] }))
    .sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------ 요약 본체 */

/**
 * @param {string|object} input 기획서 원문 또는 parseDocument 결과
 * @param {{topN?: number, testCases?: Array, rawText?: string, qaPlan?: boolean}} options
 *   rawText  URL·Figma·목표 문장 추출에 원문이 필요하다. input 이 문자열이면 자동으로 쓰인다.
 *   qaPlan   false 로 주면 QA 검증 분석서(6개 섹션) 생성을 건너뛴다.
 */
function summarizeSpec(input, options = {}) {
  const parsed = typeof input === 'string' ? parseDocument(input) : input;
  const requirements = parsed.requirements || [];
  const rawText = typeof input === 'string' ? input : (options.rawText || '');
  const topN = options.topN || 8;

  const scored = requirements
    .map((req) => ({ req, score: requirementScore(req) }))
    .sort((a, b) => b.score - a.score || a.req.line - b.req.line);

  const keyPoints = scored.slice(0, topN).map(({ req, score }) => ({
    requirementId: req.id,
    area: req.area,
    line: req.line,
    text: clean(req.text),
    score,
    categories: labelize(req.categories),
    condition: req.condition ? clean(req.condition) : null,
    constraints: req.constraints.map(formatCriterion),
  }));

  const byArea = [...new Set(requirements.map((r) => r.area))].map((area) => {
    const items = requirements.filter((r) => r.area === area);
    const top = items
      .map((req) => ({ req, score: requirementScore(req) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ req }) => truncate(req.text, 70));
    const categories = [...new Set(items.flatMap((r) => r.categories))];
    return {
      area,
      requirements: items.length,
      focus: labelize(categories).slice(0, 5),
      highlights: top,
    };
  }).sort((a, b) => b.requirements - a.requirements);

  const numericRules = collectNumericRules(requirements);
  const risks = collectRisks(requirements);

  const langs = [...new Set(requirements.map((r) => r.lang))];
  const overview = {
    requirements: requirements.length,
    areas: byArea.length,
    languages: langs,
    conditional: requirements.filter((r) => r.condition).length,
    withNumericRule: requirements.filter((r) => r.constraints.length || r.retryCount != null).length,
    topCategories: Object.entries(
      requirements.flatMap((r) => r.categories).reduce((acc, k) => {
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => ({ label: LABELS[k] || k, count: n })),
  };

  // 사람이 읽는 한 줄 요약
  const headline = requirements.length
    ? `${overview.areas}개 영역 / 요구사항 ${overview.requirements}건 — 조건 분기 ${overview.conditional}건, 수치 기준 ${numericRules.length}건, 확인 필요 ${risks.reduce((n, r) => n + r.count, 0)}건(${risks.length}종)`
    : '요구사항으로 인식된 문장이 없습니다. 문서가 이미지·표 위주인지 확인해 주세요.';

  const result = { headline, overview, keyPoints, byArea, numericRules, risks };

  // QA 검증 분석서 — 사내 표준 6개 고정 섹션
  if (options.qaPlan !== false) {
    result.qaPlan = buildQaPlan(requirements, rawText, { keyPoints });
  }

  if (Array.isArray(options.testCases)) {
    const covered = new Set(options.testCases.map((tc) => tc.requirement_id || (tc.requirement && tc.requirement.id)));
    result.coverage = {
      testCases: options.testCases.length,
      coveredRequirements: covered.size,
      uncovered: requirements.filter((r) => !covered.has(r.id)).map((r) => ({ id: r.id, area: r.area, text: truncate(r.text, 70) })),
      perRequirement: requirements.length ? Number((options.testCases.length / requirements.length).toFixed(1)) : 0,
    };
  }

  return result;
}

module.exports = { summarizeSpec, requirementScore, collectRisks, collectNumericRules, VAGUE_PATTERNS };
