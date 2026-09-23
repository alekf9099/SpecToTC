'use strict';

const { parseDocument } = require('./engine/parser');
const { buildTestCases, summarize } = require('./engine/generator');
const { buildChangeTestCases } = require('./engine/changeTestCases');

/** 비교용 정규화: 공백/기호 제거 후 소문자화 */
function normKey(text) {
  return text.replace(/[\s.,·:;!?()[\]{}"'`~-]/g, '').toLowerCase();
}

function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  if (!out.size && s.length) out.add(s);
  return out;
}

/** Dice 계수 기반 유사도 (0~1) */
function similarity(a, b) {
  const A = bigrams(normKey(a));
  const B = bigrams(normKey(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return (2 * inter) / (A.size + B.size);
}

const DEFAULT_THRESHOLD = 0.55;

/**
 * 이전/신규 기획서를 비교해 변경된 요구사항을 추출하고,
 * 변경분에 대한 회귀 테스트케이스를 생성한다.
 *
 * @param {string} oldText
 * @param {string} newText
 * @param {{threshold?: number, generateTestCases?: boolean, generatorOptions?: object}} options
 */
function diffSpecs(oldText, newText, options = {}) {
  const threshold = options.threshold != null ? options.threshold : DEFAULT_THRESHOLD;
  const oldReqs = parseDocument(oldText).requirements;
  const newReqs = parseDocument(newText).requirements;

  const oldByKey = new Map();
  oldReqs.forEach((r) => {
    if (!oldByKey.has(normKey(r.text))) oldByKey.set(normKey(r.text), r);
  });

  const usedOld = new Set();
  const added = [];
  const modified = [];
  const unchanged = [];

  for (const nr of newReqs) {
    const key = normKey(nr.text);
    const exact = oldByKey.get(key);
    if (exact && !usedOld.has(exact.id)) {
      usedOld.add(exact.id);
      unchanged.push({ requirement: nr, previousId: exact.id });
      continue;
    }

    // 같은 영역 우선 → 전체에서 가장 비슷한 문장 탐색
    let best = null;
    for (const or of oldReqs) {
      if (usedOld.has(or.id)) continue;
      const score = similarity(nr.text, or.text) + (or.area === nr.area ? 0.05 : 0);
      if (!best || score > best.score) best = { req: or, score };
    }

    if (best && best.score >= threshold) {
      usedOld.add(best.req.id);
      modified.push({
        requirement: nr,
        previousId: best.req.id,
        previousText: best.req.text,
        // 변경 확인 TC 는 "무엇이 무엇으로 바뀌었는지" 를 알아야 만들 수 있다.
        // 문장만으로는 문구·기준값이 어떻게 달라졌는지 되짚을 수 없어 통째로 들고 간다.
        previous: best.req,
        similarity: Number(Math.min(best.score, 1).toFixed(3)),
        changes: describeChanges(best.req, nr),
      });
    } else {
      added.push({ requirement: nr });
    }
  }

  const removed = oldReqs.filter((r) => !usedOld.has(r.id)).map((r) => ({ requirement: r }));

  const changedReqs = [...added.map((a) => a.requirement), ...modified.map((m) => m.requirement)];
  const impactedAreas = [...new Set([
    ...changedReqs.map((r) => r.area),
    ...removed.map((r) => r.requirement.area),
  ])];

  const result = {
    summary: {
      old: { requirements: oldReqs.length },
      new: { requirements: newReqs.length },
      added: added.length,
      removed: removed.length,
      modified: modified.length,
      unchanged: unchanged.length,
      impactedAreas,
    },
    added,
    removed,
    modified,
    unchanged: options.includeUnchanged ? unchanged : undefined,
  };

  if (options.generateTestCases !== false) {
    // 순서가 중요하다. QA 가 개정 기획서를 받고 제일 먼저 볼 것은 "바뀐 부분이
    // 반영됐는가" 이지, 그 기능이 원래대로 도는가가 아니다. 변경 확인 TC 를 앞에 둔다.
    const changeTcs = buildChangeTestCases({ added, modified, removed });
    const featureTcs = buildTestCases(changedReqs, options.generatorOptions || {})
      .map((tc) => ({ ...tc, tags: [...tc.tags, 'regression'] }));

    result.changeTestCases = changeTcs;
    result.regressionTestCases = [...changeTcs, ...featureTcs];
    result.regressionSummary = summarize(result.regressionTestCases);
  }

  return result;
}

/** 두 문장 사이에서 무엇이 바뀌었는지 사람이 읽을 수 있게 요약 */
function describeChanges(oldReq, newReq) {
  const notes = [];

  const oldNums = oldReq.constraints.map((c) => `${c.value}${c.unit || ''}${c.op}`);
  const newNums = newReq.constraints.map((c) => `${c.value}${c.unit || ''}${c.op}`);
  if (oldNums.join('|') !== newNums.join('|')) {
    notes.push(`경계값/임계치 변경: [${oldNums.join(', ') || '없음'}] → [${newNums.join(', ') || '없음'}]`);
  }

  if (oldReq.retryCount !== newReq.retryCount) {
    notes.push(`재시도 횟수 변경: ${oldReq.retryCount ?? '없음'} → ${newReq.retryCount ?? '없음'}`);
  }

  const gone = oldReq.categories.filter((c) => !newReq.categories.includes(c));
  const fresh = newReq.categories.filter((c) => !oldReq.categories.includes(c));
  if (gone.length) notes.push(`제거된 분류: ${gone.join(', ')}`);
  if (fresh.length) notes.push(`추가된 분류: ${fresh.join(', ')}`);

  if ((oldReq.condition || '') !== (newReq.condition || '')) {
    notes.push(`조건절 변경: "${oldReq.condition || '없음'}" → "${newReq.condition || '없음'}"`);
  }
  if (oldReq.area !== newReq.area) notes.push(`영역 이동: ${oldReq.area} → ${newReq.area}`);

  if (!notes.length) notes.push('문구 수정(의미 변화 여부 기획 확인 필요)');
  return notes;
}

module.exports = { diffSpecs, similarity, normKey };
