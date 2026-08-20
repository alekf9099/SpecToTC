'use strict';

/**
 * 선택적 Claude 보강 레이어.
 *
 * 규칙 엔진은 키워드/경계값처럼 "기계가 확실히 잡을 수 있는" TC 를 만든다.
 * 여기서는 규칙이 놓치는 도메인 맥락 기반 TC(업무 흐름, 데이터 정합성, 상태 조합)를
 * Claude 로 추가 생성한다. ANTHROPIC_API_KEY 가 없으면 조용히 비활성화된다.
 */

const MODEL = process.env.SPECTOTC_MODEL || 'claude-opus-5';
const MAX_TOKENS = Number(process.env.SPECTOTC_MAX_TOKENS || 32000);

const SYSTEM_PROMPT = `당신은 웹/모바일 서비스의 시니어 QA 엔지니어입니다.
기획서(SRS)를 읽고, 규칙 기반 자동 생성기가 놓치기 쉬운 테스트케이스를 추가로 작성합니다.

작성 원칙
- 규칙 엔진이 이미 만든 시나리오와 중복되지 않는 것만 작성한다.
- 업무 흐름 전체를 가로지르는 케이스, 상태 조합, 데이터 정합성, 권한 조합, 다중 기기/세션, 시간(자정·월말·타임존) 관련 케이스를 우선한다.
- 기획서에 명시되지 않아 확인이 필요한 항목은 시나리오 앞에 "[기획확인]" 을 붙인다.
- 실행 가능한 단계로 쓴다. 추측한 UI 명칭을 단정하지 않는다.

출력 형식: 설명 없이 JSON 배열만 출력한다. 각 원소는 다음 키를 가진다.
{"type":"Pass|Fail|Edge Case","area":"요구사항 영역","scenario":"...","precondition":"...","steps":["...","..."],"expected":"...","priority":"High|Med|Low","requirement_id":"관련 REQ-ID 또는 null"}`;

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

function extractJsonArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end <= start) throw new Error('응답에서 JSON 배열을 찾지 못했습니다.');
  return JSON.parse(body.slice(start, end + 1));
}

const VALID_TYPES = new Set(['Pass', 'Fail', 'Edge Case']);
const VALID_PRIORITY = new Set(['High', 'Med', 'Low']);

function sanitize(raw, index) {
  const type = VALID_TYPES.has(raw.type) ? raw.type : 'Edge Case';
  const code = type === 'Pass' ? 'P' : type === 'Fail' ? 'F' : 'E';
  return {
    tc_id: `TC-${code}-A${String(index + 1).padStart(3, '0')}`,
    requirement_id: raw.requirement_id || null,
    area: String(raw.area || '미분류').slice(0, 120),
    type,
    scenario: String(raw.scenario || '').slice(0, 500),
    precondition: String(raw.precondition || '').slice(0, 800),
    steps: Array.isArray(raw.steps) ? raw.steps.map((s) => String(s).slice(0, 500)).slice(0, 12) : [],
    expected: String(raw.expected || '').slice(0, 1000),
    priority: VALID_PRIORITY.has(raw.priority) ? raw.priority : 'Med',
    categories: ['AI 보강'],
    tags: ['ai'],
    source_text: '(AI 보강 — 기획서 전문 기반)',
    source_line: null,
    origin: 'ai',
  };
}

/**
 * @param {string} specText 기획서 원문
 * @param {Array} ruleTestCases 규칙 엔진 결과 (중복 방지용)
 * @param {{limit?: number}} options
 * @returns {Promise<{enabled: boolean, testCases: Array, error?: string, model?: string}>}
 */
async function enrichWithClaude(specText, ruleTestCases = [], options = {}) {
  if (!isEnabled()) {
    return { enabled: false, testCases: [], error: 'ANTHROPIC_API_KEY 가 설정되지 않아 AI 보강을 건너뜁니다.' };
  }

  const Anthropic = loadSdk();
  if (!Anthropic) {
    return { enabled: false, testCases: [], error: '@anthropic-ai/sdk 가 설치되지 않았습니다. `npm i @anthropic-ai/sdk` 후 다시 시도하세요.' };
  }

  const limit = options.limit || 12;
  const existing = ruleTestCases.slice(0, 120).map((tc) => `- [${tc.type}] ${tc.scenario}`).join('\n');

  const client = new Anthropic();
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      messages: [
        {
          role: 'user',
          content: `## 기획서 원문\n${specText}\n\n## 규칙 엔진이 이미 생성한 시나리오\n${existing || '(없음)'}\n\n위와 중복되지 않는 테스트케이스를 최대 ${limit}건 작성해 JSON 배열로만 출력하세요.`,
        },
      ],
    });

    const message = await stream.finalMessage();
    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    const parsed = extractJsonArray(text);
    return {
      enabled: true,
      model: MODEL,
      testCases: parsed.slice(0, limit).map(sanitize),
      usage: message.usage,
    };
  } catch (err) {
    return { enabled: true, model: MODEL, testCases: [], error: `AI 보강 실패: ${err.message}` };
  }
}

module.exports = { enrichWithClaude, isEnabled, MODEL };
