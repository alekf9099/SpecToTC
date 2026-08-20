'use strict';

const path = require('node:path');

const { extractDocx } = require('./docx');
const { extractPdf } = require('./pdf');

const MAX_BYTES = Number(process.env.SPECTOTC_MAX_UPLOAD || 25 * 1024 * 1024);

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text', '.csv', '.tsv', '.json', '.yml', '.yaml', '.adoc', '.rst']);

/** UTF-8 로 디코딩하되, 깨지면 CP949(EUC-KR) 로 재시도한다 (한글 Windows 텍스트 파일 대응) */
function decodeText(buffer) {
  // UTF-8 BOM 제거
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf-8 (BOM)' };
  }
  // UTF-16 BOM
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString('utf16le'), encoding: 'utf-16le' };
  }

  const utf8 = buffer.toString('utf8');
  const replacementCount = (utf8.match(/�/g) || []).length;
  if (replacementCount === 0) return { text: utf8, encoding: 'utf-8' };

  try {
    const cp949 = new TextDecoder('euc-kr', { fatal: false }).decode(buffer);
    const cp949Bad = (cp949.match(/�/g) || []).length;
    if (cp949Bad < replacementCount) return { text: cp949, encoding: 'euc-kr (cp949)' };
  } catch (err) {
    // euc-kr 디코더가 없는 런타임 — utf-8 결과를 그대로 쓴다.
  }
  return { text: utf8, encoding: 'utf-8 (일부 문자 손실)' };
}

function looksLikeBinary(buffer) {
  const sample = buffer.subarray(0, 2048);
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) control += 1;
  }
  return control / Math.max(1, sample.length) > 0.1;
}

/**
 * 업로드 파일 → 기획서 텍스트
 *
 * @param {Buffer} buffer
 * @param {string} fileName 확장자 판별용 원본 파일명
 * @returns {Promise<{text: string, meta: object}>}
 */
async function extractText(buffer, fileName) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('업로드된 파일이 비어 있습니다.');
  if (buffer.length > MAX_BYTES) {
    throw new Error(`파일이 너무 큽니다. 최대 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB 까지 지원합니다.`);
  }

  const ext = path.extname(String(fileName || '')).toLowerCase();
  const base = { fileName: fileName || 'upload', bytes: buffer.length, ext };

  // 확장자가 없거나 틀렸을 수 있으므로 매직 넘버를 함께 본다.
  const isPdf = ext === '.pdf' || buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;

  if (isPdf) {
    const { text, meta } = await extractPdf(buffer);
    return { text, meta: { ...base, kind: 'pdf', ...meta } };
  }

  if (ext === '.docx' || (isZip && ext !== '.zip')) {
    const { text, meta } = extractDocx(buffer);
    if (!text) throw new Error('.docx 에서 텍스트를 찾지 못했습니다.');
    return { text, meta: { ...base, kind: 'docx', ...meta } };
  }

  if (ext === '.doc') {
    throw new Error('구버전 .doc 은 지원하지 않습니다. Word 에서 .docx 로 다시 저장해 주세요.');
  }
  if (ext === '.hwp' || ext === '.hwpx') {
    throw new Error('한글(.hwp/.hwpx)은 지원하지 않습니다. PDF 또는 .docx 로 내보낸 뒤 업로드해 주세요.');
  }

  if (TEXT_EXTENSIONS.has(ext) || !looksLikeBinary(buffer)) {
    const { text, encoding } = decodeText(buffer);
    if (!text.trim()) throw new Error('파일에서 텍스트를 찾지 못했습니다.');
    return { text, meta: { ...base, kind: 'text', encoding } };
  }

  throw new Error(`지원하지 않는 파일 형식입니다 (${ext || '확장자 없음'}). .md / .txt / .pdf / .docx 를 사용해 주세요.`);
}

module.exports = { extractText, decodeText, MAX_BYTES, TEXT_EXTENSIONS };
