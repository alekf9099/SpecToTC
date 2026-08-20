'use strict';

const { parseDocument } = require('./parser');
const { buildTestCases, summarize } = require('./generator');

/**
 * 기획서 텍스트 → 테스트케이스 생성 (규칙 엔진)
 *
 * @param {string} specText 기획서 원문
 * @param {object} options  generator 옵션 (includePass/Fail/Edge, maxFailPerRequirement 등)
 */
function generateFromSpec(specText, options = {}) {
  const parsed = parseDocument(specText);
  const testCases = buildTestCases(parsed.requirements, options);

  return {
    requirements: parsed.requirements,
    areas: parsed.areas,
    testCases,
    summary: { ...summarize(testCases), parse: parsed.stats },
  };
}

module.exports = { generateFromSpec, parseDocument, buildTestCases, summarize };
