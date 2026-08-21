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

/**
 * CSV 컬럼 정의 — 사내 TC 양식에 맞추려면 이 배열만 수정하면 된다.
 * 순서는 "표를 왼쪽부터 읽으며 그대로 실행할 수 있는가" 기준으로 정렬했다.
 */
const COLUMNS = [
  { header: 'TC_ID', get: (tc) => tc.tc_id },
  { header: '유형', get: (tc) => tc.type },
  { header: '중요도', get: (tc) => tc.priority },
  { header: '요구사항 영역', get: (tc) => tc.area },
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
  for (const tc of testCases || []) {
    rows.push(COLUMNS.map((c) => escapeCell(c.get(tc))).join(delimiter));
  }
  return (bom ? '\ufeff' : '') + rows.join(eol) + eol;
}

function csvFileName(prefix = 'spectotc-tc') {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.csv`;
}

module.exports = { toCsv, csvFileName, COLUMNS, numbered, bulleted };
