'use strict';

const { CATEGORIES, COMPARATORS, UNIT_ALIASES, NOISE_PATTERNS } = require('./dictionary');

const HANGUL = /[가-힣]/;

function normalizeText(input) {
  return String(input == null ? '' : input)
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+$/gm, '');
}

function isNoise(line) {
  return NOISE_PATTERNS.some((re) => re.test(line));
}

/** 마크다운/번호 목록 마커, 강조 문법, 체크박스 제거 */
function stripMarkers(line) {
  return line
    .replace(/^\s{0,8}(?:[-*+•·▪]|\d{1,2}[.)]|\(\d{1,2}\)|[가-하][.)])\s+/, '')
    .replace(/^\s*\[[ xX]\]\s*/, '')
    .replace(/\*\*|__|`/g, '')
    .trim();
}

/** 문단 제목(요구사항 영역) 후보인지 판단하고 제목 텍스트를 반환 */
function detectArea(line) {
  const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (heading) return { title: heading[2].trim(), depth: heading[1].length };

  const numbered = line.match(/^\s*(\d+(?:\.\d+){0,3})\.?\s+(.{2,60})$/);
  if (numbered && !/[.。]$/.test(numbered[2]) && !/(한다|합니다|된다|입니다|이다)\s*$/.test(numbered[2])) {
    return { title: `${numbered[1]} ${numbered[2].trim()}`, depth: numbered[1].split('.').length };
  }

  const bold = line.match(/^\s*\*\*(.{2,60}?)\*\*\s*:?\s*$/);
  if (bold) return { title: bold[1].trim(), depth: 3 };

  const colon = line.match(/^\s*([^\s].{1,40})\s*[:：]\s*$/);
  if (colon) return { title: colon[1].trim(), depth: 4 };

  return null;
}

/** 한 라인을 문장 단위로 분해 */
function splitStatements(line) {
  return line
    .split(/(?<=(?:다|요|음|함|됨|것)\.)\s+|(?<=[.;!?])\s+|\s{2,}·\s*|\s+›\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

function detectCategories(text) {
  const hits = [];
  for (const cat of CATEGORIES) {
    if (cat.patterns.some((re) => re.test(text))) hits.push(cat.key);
  }
  return hits;
}

function detectComparator(fragment) {
  for (const c of COMPARATORS) {
    if (c.patterns.some((re) => re.test(fragment))) return c.op;
  }
  return null;
}

function normalizeUnit(raw) {
  if (!raw) return null;
  // "최대 12자까지" 처럼 단위 캡처에 비교어가 섞여 들어온 경우를 잘라낸다.
  const key = raw.trim().replace(/(이상|이하|이내|초과|미만|까지|이후|이전)+$/, '');
  if (!key) return null;
  return UNIT_ALIASES[key] || UNIT_ALIASES[key.toLowerCase()] || (HANGUL.test(key) || /^[A-Za-z%]+$/.test(key) ? key : null);
}

function toNumber(raw) {
  return Number(String(raw).replace(/,/g, ''));
}

/**
 * 문장에서 경계값 제약을 추출한다.
 * 반환: [{ value, unit, op, source }]
 */
function extractConstraints(text) {
  const found = [];
  const push = (value, unit, op, source) => {
    if (!Number.isFinite(value) || !op) return;
    if (found.some((f) => f.value === value && f.op === op && f.unit === unit)) return;
    found.push({ value, unit: unit || null, op, source: source.trim() });
  };

  // 1) "8자 이상", "500건 이하", "30초 이내"
  const koPost = /(\d[\d,]*(?:\.\d+)?)\s*([가-힣A-Za-z%]{0,5}?)\s*(이상|이하|초과|미만|까지|이내)/g;
  for (const m of text.matchAll(koPost)) {
    push(toNumber(m[1]), normalizeUnit(m[2]), detectComparator(m[3]), m[0]);
  }

  // 2) "최대 20자", "최소 3회"
  const koPre = /(최대|최소|상한|하한)\s*(\d[\d,]*(?:\.\d+)?)\s*([가-힣A-Za-z%]{0,5})?/g;
  for (const m of text.matchAll(koPre)) {
    push(toNumber(m[2]), normalizeUnit(m[3]), detectComparator(m[1]), m[0]);
  }

  // 3) 영문 표현: "at least 8 characters", "within 3 seconds"
  const en = /\b(at least|at most|up to|no more than|no less than|more than|less than|greater than|minimum|maximum|min|max|within)\b\s*(\d[\d,]*(?:\.\d+)?)\s*([A-Za-z%]{0,12})?/gi;
  for (const m of text.matchAll(en)) {
    push(toNumber(m[2]), normalizeUnit(m[3]), detectComparator(m[1]), m[0]);
  }

  // 4) 기호 표현: ">= 10", "< 500"
  const sym = /([<>]=?)\s*(\d[\d,]*(?:\.\d+)?)/g;
  for (const m of text.matchAll(sym)) {
    push(toNumber(m[2]), null, m[1], m[0]);
  }

  // 5) 범위: "8~20자", "between 8 and 20"
  const range = /(\d[\d,]*)\s*(?:~|-|–|부터|to|and)\s*(\d[\d,]*)\s*([가-힣A-Za-z%]{0,5})?/g;
  for (const m of text.matchAll(range)) {
    const lo = toNumber(m[1]);
    const hi = toNumber(m[2]);
    if (lo < hi) {
      const unit = normalizeUnit(m[3]);
      push(lo, unit, '>=', m[0]);
      push(hi, unit, '<=', m[0]);
    }
  }

  return found;
}

/** "3회 재시도", "retry up to 5 times" 등에서 재시도 횟수 추출 */
function extractRetryCount(text) {
  const a = text.match(/(\d+)\s*(?:회|번|times?)[^\d]{0,10}(?:재시도|재전송|재요청|retry|retries|resend)/i);
  if (a) return toNumber(a[1]);
  const b = text.match(/(?:재시도|재전송|재요청|retry|retries|resend)[^\d]{0,12}(\d+)\s*(?:회|번|times?)?/i);
  if (b) return toNumber(b[1]);
  return null;
}

/**
 * 조건절/동작절 분리. 실패하면 condition=null, action=원문.
 */
function splitConditionAction(text) {
  const ko = text.match(
    /^\s*(.{2,}?)(?:일\s*때|할\s*때|인\s*경우|하는\s*경우|되는\s*경우|하면|되면|이면|라면|한\s*뒤|한\s*후|시)\s*[,]?\s*(.{4,})$/
  );
  if (ko) return { condition: ko[1].trim(), action: ko[2].trim() };

  const en = text.match(/^\s*(?:if|when|whenever|once|in case of)\s+(.{2,}?)(?:\s*,\s*|\s+then\s+)(.{4,})$/i);
  if (en) return { condition: en[1].trim(), action: en[2].trim() };

  const enTail = text.match(/^\s*(.{4,}?)\s+(?:if|when|unless)\s+(.{2,})$/i);
  if (enTail) return { condition: enTail[2].trim(), action: enTail[1].trim() };

  return { condition: null, action: text.trim() };
}

/**
 * 기획서 텍스트 → 요구사항 목록
 * @returns {{requirements: Array, areas: string[], stats: object}}
 */
function parseDocument(rawText) {
  const text = normalizeText(rawText);
  const lines = text.split('\n');

  const requirements = [];
  const areaStack = [];
  let seq = 0;
  let inCodeFence = false;

  lines.forEach((rawLine, idx) => {
    if (/^\s*```/.test(rawLine)) {
      inCodeFence = !inCodeFence;
      return;
    }
    if (inCodeFence || isNoise(rawLine)) return;

    const area = detectArea(rawLine);
    if (area) {
      while (areaStack.length && areaStack[areaStack.length - 1].depth >= area.depth) areaStack.pop();
      areaStack.push(area);
      return;
    }

    // 마크다운 표 행: 셀을 개별 문장으로 취급
    const cells = /^\s*\|.*\|\s*$/.test(rawLine)
      ? rawLine.split('|').map((c) => c.trim()).filter((c) => c.length >= 4)
      : [stripMarkers(rawLine)];

    for (const cell of cells) {
      if (!cell) continue;
      for (const statement of splitStatements(cell)) {
        const categories = detectCategories(statement);
        const { condition, action } = splitConditionAction(statement);
        const constraints = extractConstraints(statement);
        const retryCount = extractRetryCount(statement);

        // 카테고리도, 제약도, 조건절도 없는 순수 서술문은 TC 대상에서 제외
        if (!categories.length && !constraints.length && !condition) continue;

        seq += 1;
        requirements.push({
          id: `REQ-${String(seq).padStart(3, '0')}`,
          area: areaStack.length ? areaStack[areaStack.length - 1].title : '미분류',
          areaPath: areaStack.map((a) => a.title),
          line: idx + 1,
          text: statement,
          lang: HANGUL.test(statement) ? 'ko' : 'en',
          categories,
          condition,
          action,
          constraints,
          retryCount,
        });
      }
    }
  });

  const areas = [...new Set(requirements.map((r) => r.area))];
  return {
    requirements,
    areas,
    stats: {
      lines: lines.length,
      requirements: requirements.length,
      areas: areas.length,
      withConstraints: requirements.filter((r) => r.constraints.length).length,
      withCondition: requirements.filter((r) => r.condition).length,
    },
  };
}

module.exports = {
  parseDocument,
  normalizeText,
  splitStatements,
  splitConditionAction,
  extractConstraints,
  extractRetryCount,
  detectCategories,
  detectArea,
  stripMarkers,
};
