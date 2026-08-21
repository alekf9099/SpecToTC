'use strict';

/**
 * 의존성 없는 최소 ZIP 리더.
 * .docx 는 OOXML(ZIP) 컨테이너이므로, 필요한 엔트리 하나만 꺼내려면 이 정도로 충분하다.
 */
const zlib = require('node:zlib');

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

/** 파일 끝에서 End Of Central Directory 레코드를 찾는다 (주석 최대 64KB 고려) */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 0x10000 - 22);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * ZIP 엔트리 목록을 읽는다.
 * @returns {Map<string, {offset:number, method:number, compressedSize:number, size:number}>}
 */
function readEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('ZIP 구조를 찾을 수 없습니다 (손상되었거나 ZIP 형식이 아님).');

  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  // ZIP64: 오프셋/개수가 0xFFFF/0xFFFFFFFF 로 마스킹된 경우 locator 를 따라간다.
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const locator = eocd - 20;
    if (locator >= 0 && buf.readUInt32LE(locator) === EOCD64_LOCATOR_SIG) {
      const eocd64 = Number(buf.readBigUInt64LE(locator + 8));
      count = Number(buf.readBigUInt64LE(eocd64 + 32));
      cdOffset = Number(buf.readBigUInt64LE(eocd64 + 48));
    }
  }

  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count && p + 46 <= buf.length; i += 1) {
    if (buf.readUInt32LE(p) !== CDH_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { offset, method, compressedSize, size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 엔트리 하나를 압축 해제해 Buffer 로 반환 */
function readFile(buf, name) {
  const entries = readEntries(buf);
  const entry = entries.get(name);
  if (!entry) throw new Error(`ZIP 안에 ${name} 가 없습니다.`);

  const lfh = entry.offset;
  if (buf.readUInt32LE(lfh) !== LFH_SIG) throw new Error('ZIP 로컬 헤더가 손상되었습니다.');
  const nameLen = buf.readUInt16LE(lfh + 26);
  const extraLen = buf.readUInt16LE(lfh + 28);
  const start = lfh + 30 + nameLen + extraLen;

  // 데이터 디스크립터를 쓰는 경우 로컬 헤더의 크기가 0 이므로 중앙 디렉터리 값을 신뢰한다.
  const raw = buf.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`지원하지 않는 ZIP 압축 방식입니다 (method ${entry.method}).`);
}

module.exports = { readEntries, readFile };
