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

const { installDomShims } = require('./domShims');

let pdfjsPromise = null;
let shimInfo = null;

function loadPdfjs() {
  // pdf.js 는 Node 에서 DOMMatrix/ImageData/Path2D 를 optionalDependency 인
  // @napi-rs/canvas(네이티브 바이너리)에서 가져온다. 그 패키지가 없는 환경에서는
  // 일부 PDF 가 "DOMMatrix is not defined" 로 실패하므로,
  // import 전에 순수 JS 폴리필을 먼저 깔아 둔다.
  if (!shimInfo) shimInfo = installDomShims();

  // ESM 전용 모듈이라 CommonJS 에서는 동적 import 로 지연 로딩한다.
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/** 진단용 — 네이티브 canvas 를 쓰는지, 폴리필로 동작하는지 */
function domSupport() {
  if (!shimInfo) shimInfo = installDomShims();
  return shimInfo;
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


/** 페이지마다 반복되는 머리글·바닥글, 페이지 번호/인쇄 시각 줄 */
const CHROME_PATTERNS = [
  /^\d+\s*\/\s*\d+$/,                       // 1/4
  /^-?\s*\d+\s*-?$/,                          // - 3 -
  /^https?:\/\/\S+(\s+\d+\s*\/\s*\d+)?$/i, // URL + 페이지 번호
  /^\d{2,4}[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}\.?\s*(오전|오후|AM|PM)?\s*\d{0,2}:?\d{0,2}/i,
  /^page\s+\d+(\s+of\s+\d+)?$/i,
];

function isChrome(line) {
  return CHROME_PATTERNS.some((re) => re.test(line.trim()));
}

/**
 * 여러 페이지에 반복 등장하는 줄을 머리글·바닥글로 보고 제거한다.
 * (그대로 두면 "26. 6. 23. 오전 11:39 문서명" 같은 줄이 요구사항 영역으로 잡힌다.)
 */
function stripPageChrome(pages) {
  const seen = new Map();
  for (const lines of pages) {
    for (const line of new Set(lines)) {
      const key = line.trim();
      if (key.length < 4) continue;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
  }

  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  const repeated = new Set([...seen.entries()].filter(([, n]) => n >= threshold).map(([k]) => k));

  return pages.map((lines) => lines.filter((line) => {
    const key = line.trim();
    return key && !isChrome(key) && !repeated.has(key);
  }));
}

/**
 * pdf.js 오류를 사용자가 판단할 수 있는 문장으로 바꾼다.
 * 특히 DOM API 누락은 파일 문제가 아니라 실행 환경 문제이므로 구분해서 알려야 한다.
 */
function describePdfError(err, stage) {
  const message = String((err && err.message) || err);

  if (/DOMMatrix|Path2D|ImageData|OffscreenCanvas/i.test(message)) {
    return `PDF 처리에 필요한 그래픽 API 가 이 환경에 없습니다 (${message}). `
      + '서버를 재시작하면 내장 폴리필이 적용됩니다. 계속 발생하면 담당자에게 알려 주세요.';
  }
  if (/password|encrypted/i.test(message)) {
    return 'PDF 가 암호로 보호되어 있습니다. 암호를 해제한 파일로 다시 업로드해 주세요.';
  }
  if (/Invalid PDF structure|InvalidPDFException|not a PDF/i.test(message)) {
    return 'PDF 구조가 손상되어 읽을 수 없습니다. 원본에서 다시 내보낸 뒤 업로드해 주세요.';
  }
  return `PDF 를 ${stage} 중 오류가 발생했습니다: ${message}`;
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
    throw new Error(describePdfError(err, '여는'));
  }

  const pageCount = doc.numPages;
  const extractedPages = Math.min(pageCount, maxPages);
  const pages = [];

  const failedPages = [];
  try {
    for (let i = 1; i <= extractedPages; i += 1) {
      try {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        pages.push(itemsToLines(content.items).map(normalizeBullets).filter(Boolean));
        page.cleanup();
      } catch (err) {
        // 한 페이지가 실패해도 나머지는 살린다 (도표·이미지가 섞인 페이지에서 발생).
        failedPages.push({ page: i, reason: describePdfError(err, '읽는') });
      }
    }
  } finally {
    await doc.destroy();
  }

  if (!pages.length && failedPages.length) {
    throw new Error(failedPages[0].reason);
  }

  const cleaned = stripPageChrome(pages);
  const removed = pages.reduce((n, p) => n + p.length, 0) - cleaned.reduce((n, p) => n + p.length, 0);
  const text = cleaned
    .filter((lines) => lines.length)
    .map((lines) => lines.join('\n'))
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) {
    throw new Error('PDF 에서 텍스트를 찾지 못했습니다. 스캔 이미지 PDF 는 OCR 이 필요합니다.');
  }

  return {
    text,
    meta: {
      pages: pageCount,
      extractedPages,
      removedChromeLines: removed,
      failedPages: failedPages.length ? failedPages.map((f) => f.page) : undefined,
      domPolyfill: domSupport().installed.length ? domSupport().installed : undefined,
    },
  };
}

module.exports = { extractPdf, itemsToLines, normalizeBullets, stripPageChrome, isChrome, describePdfError, domSupport };
