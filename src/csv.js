'use strict';

/** 배열 필드를 셀 안에서 번호 매긴 여러 줄로 만든다 (Excel 에서 줄바꿈으로 보인다). */
function numbered(list) {
  if (!Array.isArray(list)) return list == null ? '' : String(list);
  return list.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

/** 불릿 목록 (순서가 의미 없는 사전조건·기대결과용) */
function bulleted(list) {
  if (!Array.isArray(list)) return list == null ? '' : String(list);
  return list.map((s) => `• ${s}`).join('\n');
}

const req = (tc) => tc.requirement || {};

/* ------------------------------------------------------------- 행 정리 */

const TYPE_ORDER = { Pass: 0, Fail: 1, 'Edge Case': 2 };
const PRIORITY_ORDER = { High: 0, Med: 1, Low: 2 };

/** 영역 이름에서 앞머리 번호를 떼고 짧게 — 연번 접두어로 쓴다 ("1. 로그인" → "로그인") */
function areaSlug(area) {
  const name = String(area || '기타').replace(/^\s*[\d.]+\s*/, '').trim();
  return (name || '기타').slice(0, 12);
}

/**
 * 영역별로 묶어 정렬하고 연번을 매긴다.
 *
 * 생성 순서 그대로 내보내면 같은 영역의 정상·실패·경계가 흩어져, Excel 에서
 * "이 영역에 TC 가 몇 건이고 무엇을 덮는지" 를 한눈에 볼 수 없었다.
 *
 * 영역 순서는 **문서 등장 순서**를 유지한다. 가나다순으로 다시 세우면
 * 기획서를 읽은 순서와 어긋나 대조가 어려워진다.
 */
function organize(testCases) {
  const list = Array.isArray(testCases) ? testCases : [];

  const areaRank = new Map();
  list.forEach((tc) => {
    if (!areaRank.has(tc.area)) areaRank.set(tc.area, areaRank.size);
  });

  const sorted = list.slice().sort((a, b) => (
    areaRank.get(a.area) - areaRank.get(b.area)
    || (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)
    || (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
    || String(a.tc_id).localeCompare(String(b.tc_id))
  ));

  const seq = new Map();
  const total = new Map();
  sorted.forEach((tc) => total.set(tc.area, (total.get(tc.area) || 0) + 1));

  return sorted.map((tc) => {
    const n = (seq.get(tc.area) || 0) + 1;
    seq.set(tc.area, n);
    return {
      ...tc,
      _no: `${areaSlug(tc.area)}-${String(n).padStart(2, '0')}`,
      _ofArea: `${n}/${total.get(tc.area)}`,
    };
  });
}

/**
 * CSV 컬럼 정의 — 사내 TC 양식에 맞추려면 이 배열만 수정하면 된다.
 * 순서는 "표를 왼쪽부터 읽으며 그대로 실행할 수 있는가" 기준으로 정렬했다.
 */
const COLUMNS = [
  { header: '연번', get: (tc) => tc._no || '' },
  { header: '요구사항 영역', get: (tc) => tc.area },
  { header: '영역 내 순서', get: (tc) => tc._ofArea || '' },
  { header: 'TC_ID', get: (tc) => tc.tc_id },
  { header: '유형', get: (tc) => tc.type },
  { header: '중요도', get: (tc) => tc.priority },
  { header: '테스트 시나리오', get: (tc) => tc.title || tc.scenario },
  { header: '검증 목적', get: (tc) => tc.objective },
  { header: '사전 조건', get: (tc) => bulleted(tc.precondition) },
  { header: '수행 단계', get: (tc) => numbered(tc.steps) },
  { header: '기대 결과', get: (tc) => bulleted(tc.expected) },
  { header: '요구사항 ID', get: (tc) => req(tc).id || tc.requirement_id },
  { header: '근거 문장', get: (tc) => req(tc).text || tc.source_text },
  { header: '원문 라인', get: (tc) => req(tc).line != null ? req(tc).line : tc.source_line },
  { header: '분류', get: (tc) => (req(tc).categories || tc.categories || []).join(', ') },
  { header: '태그', get: (tc) => (tc.tags || []).join(', ') },
  { header: '생성 방식', get: (tc) => tc.origin },
];

function escapeCell(value) {
  const s = value == null ? '' : String(value);
  // 셀 앞의 =, +, -, @ 는 스프레드시트 수식으로 해석될 수 있어 앞에 ' 를 붙여 무력화한다.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * 테스트케이스 배열 → CSV 문자열
 *
 * @param {Array} testCases
 * @param {{bom?: boolean, excel?: boolean, delimiter?: string}} opts
 *   bom   : UTF-8 BOM 부착 여부. **기본 true** — 없으면 Excel 에서 한글이 깨진다.
 *           BOM 을 거부하는 외부 시스템(TestRail/Jira import 등)에 넣을 때만 false.
 *   excel : true(기본) → CRLF 줄바꿈, false → LF 줄바꿈. BOM 과는 무관하다.
 */
function toCsv(testCases, opts = {}) {
  const excel = opts.excel !== false;
  const delimiter = opts.delimiter || ',';
  const eol = excel ? '\r\n' : '\n';
  const bom = opts.bom !== false;

  const rows = [COLUMNS.map((c) => escapeCell(c.header)).join(delimiter)];
  for (const tc of organize(testCases)) {
    rows.push(COLUMNS.map((c) => escapeCell(c.get(tc))).join(delimiter));
  }
  return (bom ? '\ufeff' : '') + rows.join(eol) + eol;
}

function csvFileName(prefix = 'spectotc-tc') {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.csv`;
}

module.exports = { toCsv, csvFileName, COLUMNS, numbered, bulleted, organize };
