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
let workerMode = 'unknown';

/**
 * pdf.js 워커를 메인 스레드에 직접 공급한다.
 *
 * pdf.js 는 Node 에서 워커가 없으면 "fake worker" 를 세우면서
 * GlobalWorkerOptions.workerSrc 를 런타임에 동적 import 한다. 이 경로는 정적 분석이
 * 되지 않아 서버리스 번들(Vercel)에 pdf.worker.mjs 가 포함되지 않고,
 * "Setting up fake worker failed: Cannot find module ... pdf.worker.mjs" 로 실패한다.
 *
 * globalThis.pdfjsWorker 가 있으면 pdf.js 는 파일을 찾지 않고 그것을 그대로 쓴다.
 * 여기서 리터럴 경로로 import 하므로 번들러도 이 파일을 함께 포함한다.
 */
async function ensureWorker(pdfjs) {
  if (globalThis.pdfjsWorker?.WorkerMessageHandler) {
    workerMode = 'main-thread';
    return;
  }

  try {
    globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    workerMode = globalThis.pdfjsWorker?.WorkerMessageHandler ? 'main-thread' : 'unknown';
  } catch (err) {
    // 여기까지 실패하면 pdf.js 의 기존 경로(workerSrc 동적 import)에 맡긴다.
    workerMode = `fallback: ${String(err.message).split('\n')[0]}`;
  }

  // 위가 실패했을 때를 대비해 해석 가능한 절대 경로를 알려 둔다.
  if (pdfjs?.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
    try {
      const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    } catch (err) {
      // 경로를 못 찾아도 main-thread 모드면 문제없다.
    }
  }
}

function loadPdfjs() {
  // pdf.js 는 Node 에서 DOMMatrix/ImageData/Path2D 를 optionalDependency 인
  // @napi-rs/canvas(네이티브 바이너리)에서 가져온다. 그 패키지가 없는 환경에서는
  // 일부 PDF 가 "DOMMatrix is not defined" 로 실패하므로,
  // import 전에 순수 JS 폴리필을 먼저 깔아 둔다.
  if (!shimInfo) shimInfo = installDomShims();

  // ESM 전용 모듈이라 CommonJS 에서는 동적 import 로 지연 로딩한다.
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      await ensureWorker(pdfjs);
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/** 진단용 — 네이티브 canvas 를 쓰는지, 워커를 어떻게 구동하는지 */
function domSupport() {
  if (!shimInfo) shimInfo = installDomShims();
  return { ...shimInfo, worker: workerMode };
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

/* ------------------------------------------------- 줄바꿈된 문장 다시 잇기 */

/** 문장이 여기서 끝났다고 볼 수 있는 끝맺음 */
const SENTENCE_END = /[.!?;:。！？…"'”’)\]}】]$/;
/**
 * 마침표 없이 끝나는 한국어 종결형 — 기획서에서 흔하다.
 * 흔한 중간 음절(정·시·안·중·료)은 넣지 않는다. "…기능 설정" 처럼 이어져야 할
 * 줄까지 문장 끝으로 오인해 조각을 남기게 된다.
 */
const KOREAN_END = /(한다|된다|이다|합니다|입니다|습니다|다|요|음|함|임|됨|것)$/;
/** 새 블록의 시작 — 앞 줄에 이어 붙이면 안 된다 */
const BLOCK_START = /^(#{1,6}\s|[-*•▪◦·]\s|\d+[.)]\s|\(\d+\)|[①-⑳㉠-㉻]|[IVX]+\.\s|\||>|\[|【|【)/;
/** "항목 :" 형태의 라벨 줄 (표를 텍스트로 뽑으면 자주 나온다) */
const LABEL_LINE = /^[^\s:：]{1,24}\s*[:：]/;

/**
 * PDF 는 **시각적 줄**만 알려준다. 한 문장이 두 줄에 걸치면 두 조각이 되고,
 * 파서는 각 줄을 별개 요구사항으로 읽어 "…기능 설정 (이" 처럼 단어 중간에서
 * 끊긴 요구사항을 만든다.
 *
 * 그래서 **줄이 꽉 찼는데 문장이 안 끝났으면** 다음 줄과 잇는다.
 * "꽉 찼는지" 는 그 페이지에서 흔한 줄 길이를 기준으로 판단한다 — 일부러 짧게
 * 끊은 줄(제목·목록·표 셀)은 기준에 못 미쳐 이어붙지 않는다.
 *
 * 단순히 "마침표가 없으면 잇는다" 로 하면 표·목록이 한 덩어리로 뭉개진다.
 */
/**
 * 두 조각을 잇는다. 공백을 넣을지가 핵심이다.
 *
 * 한국어는 단어 중간에서도 줄이 바뀌므로 "12" + "개월간" 은 붙여야 "12개월간" 이 된다.
 * 반면 영문은 보통 단어 사이에서 줄이 바뀌므로 공백이 필요하다.
 */
function joinWrapped(prev, next) {
  // 영문 하이픈 분철: "config-" + "uration" → "configuration"
  if (/[A-Za-z]-$/.test(prev) && /^[a-z]/.test(next)) {
    return `${prev.slice(0, -1)}${next}`;
  }

  const end = prev.slice(-1);
  const start = next[0];
  const glue = (/[가-힣0-9]/.test(end) && /[가-힣]/.test(start))   // 한글은 아무 데서나 끊긴다
    || /[([{"'“‘]$/.test(prev)                                     // 여는 괄호 뒤는 붙인다
    || /^[)\]}.,;:!?]/.test(next);                                  // 닫는 괄호·문장부호 앞도 붙인다

  return `${prev}${glue ? '' : ' '}${next}`.replace(/[ \t]{2,}/g, ' ');
}

function reflowWrappedLines(lines) {
  const lengths = lines.map((l) => l.length).filter((n) => n > 0).sort((a, b) => a - b);
  if (lengths.length < 2) return lines;   // 이을 대상이 없다

  // 본문 줄 길이의 대표값 — 제목처럼 짧은 줄에 휘둘리지 않게 상위 분위수를 쓴다
  const p80 = lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.8))];
  const fullWidth = Math.max(24, Math.round(p80 * 0.8));

  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { out.push(raw); continue; }

    const prev = out.length ? out[out.length - 1] : null;
    const canContinue = prev
      && prev.length >= fullWidth          // 앞 줄이 꽉 찼다 = 자동 줄바꿈일 가능성이 높다
      && !SENTENCE_END.test(prev)
      && !KOREAN_END.test(prev)
      && !BLOCK_START.test(prev)
      && !LABEL_LINE.test(prev)
      && !BLOCK_START.test(line);          // 이어질 줄이 새 블록을 시작하면 안 된다

    if (canContinue) {
      out[out.length - 1] = joinWrapped(prev, line);
    } else {
      out.push(line);
    }
  }

  return out;
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
  if (/fake worker|pdf.worker|Cannot find module/i.test(message)) {
    return `PDF 워커 모듈을 불러오지 못했습니다 (${message}). `
      + '배포 번들에 pdf.worker 파일이 포함되지 않은 경우입니다. 담당자에게 알려 주세요.';
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
        // 줄바꿈으로 끊긴 문장을 먼저 잇고 나서 글머리표를 정규화한다
        const lines = reflowWrappedLines(itemsToLines(content.items));
        pages.push(lines.map(normalizeBullets).filter(Boolean));
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

module.exports = {
  extractPdf, itemsToLines, reflowWrappedLines, normalizeBullets,
  stripPageChrome, isChrome, describePdfError, domSupport,
};
