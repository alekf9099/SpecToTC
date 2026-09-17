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
/**
 * 케이스 종류를 적는다 — **수행 결과가 아니다.**
 *
 * 처음에는 `Pass` / `Fail` 을 그대로 내보냈다. 아직 아무것도 실행하지 않았는데
 * 이미 "Pass" 라고 적혀 있으니 수행 결과로 읽혔다. 그래서 `정상` / `실패` 로
 * 바꿨는데, 그 두 단어야말로 QA 가 결과를 적을 때 쓰는 말이라 오해가 그대로였다.
 *
 * 그래서 **결과로 읽힐 수 없는 이름**으로 다시 바꿨다. "오류 처리" 는 결과가
 * 될 수 없고, 무엇을 검증하는 케이스인지도 그대로 말해준다.
 * 실제 결과는 옆의 빈 `수행 결과` 칸에 QA 가 적는다.
 */
const TYPE_LABEL = { Pass: '기능 확인', Fail: '오류 처리', 'Edge Case': '경계값' };

/* --------------------------------------------------------- 체크리스트 */

const CHECKED = '☑';    // ☑
const UNCHECKED = '☐';  // ☐

/**
 * TC 를 체크리스트로 내보낸다.
 *
 * QA 는 TC 를 "읽고 판단하는 문서"가 아니라 **하나씩 지워 나가는 목록**으로 쓴다.
 * 화면에서 체크한 것(`_checked`)과 단계별로 체크한 것(`_checkedSteps`)을 그대로
 * CSV 에 옮겨, 내보낸 파일에서도 어디까지 했는지 이어서 볼 수 있게 한다.
 */
const checkBox = (done) => (done ? CHECKED : UNCHECKED);

/** 수행 단계를 "☐ 1. …" 형태의 체크 목록으로 만든다. */
function stepChecklist(tc) {
  const steps = Array.isArray(tc.steps) ? tc.steps : [];
  const done = new Set(Array.isArray(tc._checkedSteps) ? tc._checkedSteps : []);
  return steps.map((s, i) => `${checkBox(done.has(i))} ${i + 1}. ${s}`).join('\n');
}

const COLUMNS = [
  { header: '연번', get: (tc) => tc._no || '' },
  { header: '요구사항 영역', get: (tc) => tc.area },
  { header: '영역 내 순서', get: (tc) => tc._ofArea || '' },
  { header: 'TC_ID', get: (tc) => tc.tc_id },
  { header: '케이스 종류', get: (tc) => TYPE_LABEL[tc.type] || tc.type },
  { header: '중요도', get: (tc) => tc.priority },

  // 체크리스트 — 화면에서 체크한 상태를 그대로 가져온다
  { header: '확인', get: (tc) => checkBox(tc._checked) },

  // QA 가 실행하며 채우는 칸 — 비워서 내보낸다
  { header: '수행 결과', get: () => '' },
  { header: '수행일', get: () => '' },
  { header: '담당자', get: () => '' },
  { header: '비고', get: () => '' },

  { header: '테스트 시나리오', get: (tc) => tc.title || tc.scenario },
  { header: '검증 목적', get: (tc) => tc.objective },
  { header: '사전 조건', get: (tc) => bulleted(tc.precondition) },
  { header: '수행 단계', get: (tc) => stepChecklist(tc) },
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

module.exports = {
  toCsv, csvFileName, COLUMNS, numbered, bulleted, organize,
  TYPE_LABEL, CHECKED, UNCHECKED, stepChecklist,
};
