'use strict';

/**
 * .docx → 마크다운 유사 텍스트.
 *
 * 파서가 요구사항 "영역"을 잡을 수 있도록 Word 의 제목 스타일(Heading 1~6)은 `#` 로,
 * 목록 문단(numPr)은 `- ` 로 변환해 문서 구조를 살린다.
 */
const zip = require('./zip');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function unescapeXml(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] != null ? ENTITIES[body] : whole;
  });
}

/** 한 문단(<w:p>) XML → 텍스트 한 줄 */
function paragraphToLine(xml) {
  let text = '';
  // <w:t>텍스트</w:t>, <w:tab/>, <w:br/> 를 순서대로 이어 붙인다.
  const tokens = xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)\s*\/>/g);
  for (const t of tokens) {
    if (t[1] != null) text += unescapeXml(t[1]);
    else if (t[0].startsWith('<w:tab')) text += ' ';
    else text += ' ';
  }

  text = text.replace(/[ \t]+/g, ' ').trim();
  if (!text) return '';

  const heading = xml.match(/<w:pStyle\s+w:val="(?:Heading|heading|제목)\s*(\d)"/);
  if (heading) return `${'#'.repeat(Math.min(6, Number(heading[1]) || 1))} ${text}`;
  if (/<w:pStyle\s+w:val="(?:Title|Subtitle)"/.test(xml)) return `# ${text}`;
  if (/<w:numPr>/.test(xml)) return `- ${text}`;
  return text;
}

/**
 * @param {Buffer} buffer .docx 파일 전체
 * @returns {{text: string, meta: {paragraphs: number, tables: number}}}
 */
function extractDocx(buffer) {
  let documentXml;
  try {
    documentXml = zip.readFile(buffer, 'word/document.xml').toString('utf8');
  } catch (err) {
    throw new Error(`.docx 를 읽지 못했습니다: ${err.message} (구버전 .doc 이면 .docx 로 다시 저장해 주세요.)`);
  }

  const lines = [];
  let paragraphs = 0;
  let tables = 0;

  // 표는 셀 단위로 줄을 나눠 파서가 각 셀을 개별 문장으로 볼 수 있게 한다.
  for (const block of documentXml.matchAll(/<w:tbl[\s>][\s\S]*?<\/w:tbl>|<w:p[\s>][\s\S]*?<\/w:p>|<w:p\s*\/>/g)) {
    const xml = block[0];
    if (xml.startsWith('<w:tbl')) {
      tables += 1;
      for (const row of xml.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)) {
        const cells = [];
        for (const cell of row[0].matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)) {
          const cellText = [...cell[0].matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)]
            .map((p) => paragraphToLine(p[0]).replace(/^#+\s*|^-\s*/, ''))
            .filter(Boolean)
            .join(' ');
          if (cellText) cells.push(cellText);
        }
        if (cells.length) lines.push(`| ${cells.join(' | ')} |`);
      }
      continue;
    }

    paragraphs += 1;
    const line = paragraphToLine(xml);
    if (line) lines.push(line);
    else if (lines.length && lines[lines.length - 1] !== '') lines.push('');
  }

  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), meta: { paragraphs, tables } };
}

module.exports = { extractDocx, unescapeXml, paragraphToLine };
