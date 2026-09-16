'use strict';

/**
 * 브라우저에서 PDF 텍스트를 뽑는다 — 큰 파일을 올리기 위한 우회로.
 *
 * Vercel 서버리스는 요청 본문이 4.5MB 로 막혀 있고, 그 한도는 우리 코드가 실행되기
 * 전에 플랫폼이 적용한다. 그래서 큰 PDF 는 서버로 보낼 방법 자체가 없다.
 *
 * 대신 **브라우저가 PDF 를 읽고 텍스트만 보낸다.** 10MB PDF 도 글자는 수십 KB 라
 * 제한에 걸리지 않는다. 파일은 사용자 기기를 떠나지 않는다.
 *
 * 줄 잇기·머리글 제거 같은 텍스트 규칙은 **서버가 그대로 담당한다**(`/api/extract-lines`).
 * 여기서는 pdf.js 로 읽기만 한다. 같은 규칙을 두 곳에 두면 반드시 갈라진다.
 */

/** 브라우저 처리 상한 — 이보다 크면 탭이 버거워진다 */
const BROWSER_PDF_MAX = 100 * 1024 * 1024;

let pdfjsPromise = null;

/** pdf.js 브라우저 빌드를 한 번만 불러온다 */
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('/vendor/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
      return lib;
    });
  }
  return pdfjsPromise;
}

/** 이 파일을 브라우저에서 읽을 수 있는지 */
function canExtractInBrowser(file) {
  const name = String(file.name || '').toLowerCase();
  return (file.type === 'application/pdf' || name.endsWith('.pdf')) && file.size <= BROWSER_PDF_MAX;
}

/**
 * PDF → 페이지별 줄 목록.
 * 서버의 itemsToLines 와 같은 규칙으로 줄을 만든다 (hasEOL 기준).
 */
async function pdfToPages(file, onProgress) {
  const pdfjs = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer, isEvalSupported: false }).promise;

  const pages = [];
  const failed = [];
  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      try {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();

        const lines = [];
        let current = '';
        for (const item of content.items) {
          if (typeof item.str !== 'string') continue;
          current += item.str;
          if (item.hasEOL) {
            lines.push(current.replace(/[ \t]+/g, ' ').trim());
            current = '';
          }
        }
        if (current.trim()) lines.push(current.replace(/[ \t]+/g, ' ').trim());

        pages.push(lines);
        page.cleanup();
      } catch (err) {
        // 한 페이지가 실패해도 나머지는 살린다 (도표·이미지가 섞인 페이지에서 발생)
        failed.push(i);
        pages.push([]);
      }
      if (onProgress) onProgress(i, doc.numPages);
    }
  } finally {
    await doc.destroy();
  }

  return { pages, failed, totalPages: doc.numPages };
}

/**
 * 브라우저에서 PDF 를 읽어 서버에 텍스트만 보낸다.
 * @returns {Promise<{specText: string, meta: object}>}
 */
async function extractPdfInBrowser(file, onProgress) {
  const { pages, failed, totalPages } = await pdfToPages(file, onProgress);

  const data = await api('/api/extract-lines', {
    fileName: file.name,
    bytes: file.size,
    pages,
  });

  return {
    specText: data.specText,
    meta: { ...data.meta, totalPages, failedPages: failed },
  };
}
