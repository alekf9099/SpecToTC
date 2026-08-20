'use strict';

/**
 * .pdf → 평문 텍스트. pdf.js(pdfjs-dist) 를 사용한다.
 *
 * 직접 스트림을 파싱하지 않는 이유: 한글 PDF 는 거의 항상 CID/Type0 서브셋 폰트를 쓰기 때문에
 * ToUnicode CMap 해석 없이 텍스트를 뽑으면 글자가 깨진다. pdf.js 가 그 부분을 담당한다.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let pdfjsPromise = null;

function loadPdfjs() {
  // ESM 전용 모듈이라 CommonJS 에서는 동적 import 로 지연 로딩한다.
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/**
 * pdf.js 표준 폰트 메트릭 경로. 없으면 undefined 를 넘겨 경고만 억제한다
 * (텍스트 추출 자체는 이 파일 없이도 동작한다).
 */
let standardFontDataUrl;
function resolveStandardFonts() {
  if (standardFontDataUrl !== undefined) return standardFontDataUrl;
  try {
    const pkg = require.resolve('pdfjs-dist/package.json');
    const dir = path.join(path.dirname(pkg), 'standard_fonts');
    // pdf.js 는 슬래시로 끝나는 URL 만 받는다 (Windows 경로를 그대로 주면 거부된다).
    standardFontDataUrl = fs.existsSync(dir) ? pathToFileURL(dir + path.sep).href : null;
  } catch (err) {
    standardFontDataUrl = null;
  }
  return standardFontDataUrl;
}

/** 문자 단위로 흩어진 items 를 y 좌표 기준으로 줄로 재조립 */
function itemsToLines(items) {
  const lines = [];
  let current = '';

  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    current += item.str;
    if (item.hasEOL) {
      lines.push(current.replace(/[ \t]+/g, ' ').trim());
      current = '';
    }
  }
  if (current.trim()) lines.push(current.replace(/[ \t]+/g, ' ').trim());

  return lines;
}

/** PDF 목록 기호를 마크다운 불릿으로 정규화 */
function normalizeBullets(line) {
  return line.replace(/^\s*[•·▪●○◦※•▪]\s*/, '- ');
}

/**
 * @param {Buffer} buffer PDF 파일 전체
 * @param {{maxPages?: number}} options
 * @returns {Promise<{text: string, meta: {pages: number, extractedPages: number}}>}
 */
async function extractPdf(buffer, options = {}) {
  const pdfjs = await loadPdfjs();
  const maxPages = options.maxPages || 200;

  let doc;
  try {
    const fonts = resolveStandardFonts();
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      // 서버 사이드에서는 워커/폰트 렌더링 리소스를 쓰지 않는다.
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
      verbosity: 0, // 렌더링용 경고 억제 (텍스트 추출에는 영향 없음)
      ...(fonts ? { standardFontDataUrl: fonts } : {}),
    }).promise;
  } catch (err) {
    throw new Error(`PDF 를 열지 못했습니다: ${err.message} (암호로 보호된 파일이면 해제 후 업로드해 주세요.)`);
  }

  const pageCount = doc.numPages;
  const extractedPages = Math.min(pageCount, maxPages);
  const out = [];

  try {
    for (let i = 1; i <= extractedPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const lines = itemsToLines(content.items).map(normalizeBullets).filter(Boolean);
      if (lines.length) out.push(lines.join('\n'));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  const text = out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) {
    throw new Error('PDF 에서 텍스트를 찾지 못했습니다. 스캔 이미지 PDF 는 OCR 이 필요합니다.');
  }

  return { text, meta: { pages: pageCount, extractedPages } };
}

module.exports = { extractPdf, itemsToLines, normalizeBullets };
