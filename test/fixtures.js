'use strict';

/**
 * 테스트용 .docx / .pdf 파일을 코드로 만든다.
 * 외부 바이너리 픽스처를 저장소에 넣지 않고도 추출기를 종단 검증하기 위한 도구.
 */
const zlib = require('node:zlib');

/* ------------------------------------------------------------------ ZIP/docx */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** { 'path/in/zip': Buffer|string } → ZIP Buffer (deflate) */
function makeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const deflated = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);          // version needed
    lfh.writeUInt16LE(0, 6);           // flags
    lfh.writeUInt16LE(8, 8);           // method: deflate
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(deflated.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lfh, nameBuf, deflated);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(deflated.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(offset, 42);
    central.push(cdh, nameBuf);

    offset += lfh.length + nameBuf.length + deflated.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return Buffer.concat([localPart, centralPart, eocd]);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const p = (text, opts = {}) => {
  const style = opts.heading ? `<w:pStyle w:val="Heading${opts.heading}"/>` : '';
  const num = opts.bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '';
  const pr = style || num ? `<w:pPr>${style}${num}</w:pPr>` : '';
  return `<w:p>${pr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
};

/** 제목·목록·표가 들어간 최소 .docx */
function makeDocx() {
  const body = [
    p('회원 서비스 기획서', { heading: 1 }),
    p('로그인', { heading: 2 }),
    p('비밀번호는 8자 이상 20자 이하로 입력해야 한다.', { bullet: true }),
    p('로그인에 5회 연속 실패하면 계정을 10분간 잠금 처리한다.', { bullet: true }),
    '<w:p><w:r><w:t>서버 응답이 </w:t></w:r><w:r><w:t>3초 이내</w:t></w:r><w:r><w:t xml:space="preserve"> 에 오지 않으면 최대 2회 재시도한다.</w:t></w:r></w:p>',
    '<w:tbl><w:tr>' +
      '<w:tc><w:p><w:r><w:t>항목</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>결제 승인이 실패하면 주문을 확정하지 않는다.</w:t></w:r></w:p></w:tc>' +
    '</w:tr></w:tbl>',
    p('AT&amp;T 문자 &lt;태그&gt; 이스케이프 확인'),
  ].join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

  return makeZip({ '[Content_Types].xml': CONTENT_TYPES, 'word/document.xml': documentXml });
}

/* ---------------------------------------------------------------------- PDF */

/**
 * 텍스트 한 줄씩 그리는 최소 PDF (Helvetica/WinAnsi, 비압축 스트림).
 * xref 오프셋을 실제 바이트 위치로 계산해 유효한 PDF 를 만든다.
 */
function makePdf(lines) {
  const content = ['BT', '/F1 12 Tf', '14 TL', '60 740 Td']
    .concat(lines.map((line) => `(${line.replace(/([\\()])/g, '\\$1')}) Tj T*`))
    .concat(['ET'])
    .join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
      + '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

module.exports = { makeZip, makeDocx, makePdf, crc32 };
