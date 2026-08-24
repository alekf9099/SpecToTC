'use strict';

/**
 * 선택적 Claude 보강 레이어.
 *
 * 규칙 엔진은 키워드·경계값처럼 "기계가 확실히 잡을 수 있는" 것만 만든다.
 * 여기서는 규칙이 놓치는 도메인 맥락(업무 흐름, 상태 조합, 데이터 정합성)을 보강하고,
 * 기획서 요약도 사람이 읽는 문장으로 다듬는다.
 * ANTHROPIC_API_KEY 가 없으면 조용히 비활성화된다.
 */

const MODEL = process.env.SPECTOTC_MODEL || 'claude-opus-5';
const MAX_TOKENS = Number(process.env.SPECTOTC_MAX_TOKENS || 32000);

const TC_SYSTEM_PROMPT = `당신은 웹/모바일 서비스의 시니어 QA 엔지니어입니다.
기획서(SRS)를 읽고, 규칙 기반 자동 생성기가 놓치기 쉬운 테스트케이스를 추가로 작성합니다.

작성 원칙
- 규칙 엔진이 이미 만든 시나리오와 중복되지 않는 것만 작성한다.
- 업무 흐름 전체를 가로지르는 케이스, 상태 조합, 데이터 정합성, 권한 조합, 다중 기기/세션,
  시간(자정·월말·타임존) 관련 케이스를 우선한다.
- 기획서에 명시되지 않아 확인이 필요한 항목은 title 앞에 "[기획확인]" 을 붙인다.
- 단계는 다른 QA 담당자가 그대로 실행할 수 있게 쓴다. 추측한 UI 명칭을 단정하지 않는다.
- steps 는 "레이블: 내용" 형식(진입/준비/입력/실행/확인)을 사용한다.

출력 형식: 설명 없이 JSON 배열만 출력한다. 각 원소는 다음 키를 가진다.
{"type":"Pass|Fail|Edge Case","area":"요구사항 영역","title":"한 줄 제목",
 "objective":"이 TC로 무엇을 확인하는지 한 문장","precondition":["...","..."],
 "steps":["실행: ...","확인: ..."],"expected":["...","..."],
 "priority":"High|Med|Low","requirement_id":"관련 REQ-ID 또는 null"}`;

const SUMMARY_SYSTEM_PROMPT = `당신은 웹/모바일 서비스의 시니어 QA 리드입니다.
기획서를 읽고 QA 담당자가 30초 안에 파악해야 할 핵심만 요약합니다.

원칙
- 기획서에 쓰여 있는 내용만 쓴다. 추측으로 기능을 만들지 않는다.
- 검증 관점(무엇이 깨지면 치명적인가)에서 우선순위를 매긴다.
- 문서에 없어서 QA 가 물어봐야 하는 것은 openQuestions 에 넣는다.

사내 표준 검증 분석서 항목(목표 / 목표가 아닌 것 / 검증 시 주의점 / 해야 할 일)도 함께 채운다.
문서에 없는 내용은 지어내지 말고 해당 항목을 빈 배열로 둔다.

출력 형식: 설명 없이 JSON 객체만 출력한다.
{"headline":"이 문서가 무엇을 정의하는지 한 문장",
 "scope":["다루는 범위 항목", "..."],
 "criticalFlows":[{"name":"흐름 이름","why":"왜 중요한지","watchOut":"깨지기 쉬운 지점"}],
 "openQuestions":["기획에 물어봐야 할 질문", "..."],
 "riskNotes":["QA 진행 시 유의사항", "..."],
 "goals":["이 프로젝트/검증의 목표", "..."],
 "nonGoals":["이번 범위가 아닌 것 (추후·차기·미지원 항목)", "..."],
 "testFocus":["QA 가 반드시 수행해야 할 테스트", "..."],
 "todos":["검증 착수 전 준비해야 할 일", "..."]}`;

function isEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function loadSdk() {
  try {
    // 선택적 의존성 — 미설치 환경에서도 서버가 죽지 않도록 지연 로딩한다.
    return require('@anthropic-ai/sdk');
  } catch (err) {
    return null;
  }
}

function extractJson(text, open, close) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf(open);
  const end = body.lastIndexOf(close);
  if (start === -1 || end <= start) throw new Error('응답에서 JSON 을 찾지 못했습니다.');
  return JSON.parse(body.slice(start, end + 1));
}

/** Claude 호출 공통 래퍼 — 스트리밍으로 받아 타임아웃을 피한다. */
async function callClaude(system, userContent) {
  const Anthropic = loadSdk();
  if (!Anthropic) {
    throw new Error('@anthropic-ai/sdk 가 설치되지 않았습니다. `npm i @anthropic-ai/sdk` 후 다시 시도하세요.');
  }

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    messages: [{ role: 'user', content: userContent }],
  });

  const message = await stream.finalMessage();
  return {
    text: message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
    usage: message.usage,
  };
}

/* -------------------------------------------------------------- TC 보강 */

const VALID_TYPES = new Set(['Pass', 'Fail', 'Edge Case']);
const VALID_PRIORITY = new Set(['High', 'Med', 'Low']);

const strArray = (value, max, limit) =>
  Array.isArray(value) ? value.map((s) => String(s).slice(0, limit)).slice(0, max) : [];

function sanitizeTestCase(raw, index) {
  const type = VALID_TYPES.has(raw.type) ? raw.type : 'Edge Case';
  const code = type === 'Pass' ? 'P' : type === 'Fail' ? 'F' : 'E';
  const area = String(raw.area || '미분류').slice(0, 120);
  const title = String(raw.title || raw.scenario || '').slice(0, 300);
  const typeTag = type === 'Pass' ? '정상' : type === 'Fail' ? '실패' : '경계';
  const fullTitle = `[${typeTag}] ${area} — ${title}`;

  return {
    tc_id: `TC-${code}-A${String(index + 1).padStart(3, '0')}`,
    type,
    priority: VALID_PRIORITY.has(raw.priority) ? raw.priority : 'Med',
    area,
    title: fullTitle,
    objective: String(raw.objective || 'AI 보강 케이스').slice(0, 500),
    precondition: strArray(raw.precondition, 8, 300),
    steps: strArray(raw.steps, 12, 500),
    expected: strArray(raw.expected, 10, 500),
    requirement: {
      id: raw.requirement_id || null,
      text: '(AI 보강 — 기획서 전문 기반)',
      line: null,
      categories: ['AI 보강'],
    },
    tags: ['ai'],
    origin: 'ai',

    // 하위 호환 필드
    scenario: fullTitle,
    requirement_id: raw.requirement_id || null,
    source_text: '(AI 보강 — 기획서 전문 기반)',
    source_line: null,
    categories: ['AI 보강'],
  };
}

/**
 * @param {string} specText 기획서 원문
 * @param {Array} ruleTestCases 규칙 엔진 결과 (중복 방지용)
 * @param {{limit?: number}} options
 */
async function enrichWithClaude(specText, ruleTestCases = [], options = {}) {
  if (!isEnabled()) {
    return { enabled: false, testCases: [], error: 'ANTHROPIC_API_KEY 가 설정되지 않아 AI 보강을 건너뜁니다.' };
  }

  const limit = options.limit || 12;
  const existing = ruleTestCases.slice(0, 120).map((tc) => `- [${tc.type}] ${tc.title || tc.scenario}`).join('\n');

  try {
    const { text, usage } = await callClaude(TC_SYSTEM_PROMPT,
      `## 기획서 원문\n${specText}\n\n## 규칙 엔진이 이미 생성한 시나리오\n${existing || '(없음)'}\n\n`
      + `위와 중복되지 않는 테스트케이스를 최대 ${limit}건 작성해 JSON 배열로만 출력하세요.`);

    const parsed = extractJson(text, '[', ']');
    return {
      enabled: true,
      model: MODEL,
      testCases: parsed.slice(0, limit).map(sanitizeTestCase),
      usage,
    };
  } catch (err) {
    return { enabled: true, model: MODEL, testCases: [], error: `AI 보강 실패: ${err.message}` };
  }
}

/* -------------------------------------------------------------- 요약 보강 */

function sanitizeSummary(raw) {
  return {
    headline: String(raw.headline || '').slice(0, 500),
    scope: strArray(raw.scope, 12, 200),
    goals: strArray(raw.goals, 10, 300),
    nonGoals: strArray(raw.nonGoals, 10, 300),
    testFocus: strArray(raw.testFocus, 14, 300),
    todos: strArray(raw.todos, 12, 300),
    criticalFlows: Array.isArray(raw.criticalFlows)
      ? raw.criticalFlows.slice(0, 8).map((f) => ({
        name: String(f.name || '').slice(0, 120),
        why: String(f.why || '').slice(0, 400),
        watchOut: String(f.watchOut || '').slice(0, 400),
      }))
      : [],
    openQuestions: strArray(raw.openQuestions, 12, 300),
    riskNotes: strArray(raw.riskNotes, 12, 300),
  };
}

/**
 * 규칙 기반 요약에 덧붙일 서술형 요약을 생성한다.
 * @param {string} specText
 * @param {{ruleSummary?: object}} options
 */
async function summarizeWithClaude(specText, options = {}) {
  if (!isEnabled()) {
    return { enabled: false, error: 'ANTHROPIC_API_KEY 가 설정되지 않아 AI 요약을 건너뜁니다.' };
  }

  const hint = options.ruleSummary
    ? `\n\n## 규칙 엔진이 뽑은 지표\n${JSON.stringify({
      overview: options.ruleSummary.overview,
      numericRules: (options.ruleSummary.numericRules || []).slice(0, 20),
      risks: (options.ruleSummary.risks || []).slice(0, 15),
    })}`
    : '';

  try {
    const { text, usage } = await callClaude(SUMMARY_SYSTEM_PROMPT, `## 기획서 원문\n${specText}${hint}`);
    return { enabled: true, model: MODEL, summary: sanitizeSummary(extractJson(text, '{', '}')), usage };
  } catch (err) {
    return { enabled: true, model: MODEL, error: `AI 요약 실패: ${err.message}` };
  }
}

module.exports = { enrichWithClaude, summarizeWithClaude, isEnabled, MODEL };
