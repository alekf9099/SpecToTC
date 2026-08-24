'use strict';

/**
 * 공개 웹 페이지를 가져온다.
 *
 * ⚠️ 이 기능은 "서버가 사용자가 준 주소로 요청을 보낸다" — 즉 SSRF 위험이 있다.
 * 인증이 없는 배포에서는 누구나 이 엔드포인트로 내부망을 훑을 수 있으므로,
 * 사설/루프백/링크로컬 IP 를 차단하고 리다이렉트마다 다시 검사한다.
 */
const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_BYTES = Number(process.env.SPECTOTC_WEB_MAX_BYTES || 3 * 1024 * 1024);
const TIMEOUT_MS = Number(process.env.SPECTOTC_WEB_TIMEOUT || 12000);
const MAX_REDIRECTS = 4;

const UA = process.env.SPECTOTC_WEB_UA
  || 'Mozilla/5.0 (compatible; SpecToTC/1.0; QA test-case generator)';

/** 사설/예약 IPv4·IPv6 대역 — 내부망 접근을 막는다. */
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;             // 링크로컬 (클라우드 메타데이터 169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;   // CGNAT
    if (a >= 224) return true;                            // 멀티캐스트·예약
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    // IPv4 매핑 주소는 v4 규칙으로 다시 본다.
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true; // 판별 불가는 차단
}

/**
 * URL 을 검사하고 정규화한다. 문제가 있으면 사람이 읽을 수 있는 오류를 던진다.
 */
function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('분석할 주소를 입력해 주세요.');

  // 스킴을 생략해도 받아준다 ("naver.com")
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch (err) {
    throw new Error(`주소 형식이 올바르지 않습니다: ${raw}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`http/https 주소만 분석할 수 있습니다 (입력: ${url.protocol}).`);
  }
  if (!url.hostname) {
    throw new Error('공개된 도메인 주소를 입력해 주세요 (예: https://www.naver.com).');
  }
  // IP 로 직접 들어온 경우: 사설 대역이면 그 사유를 정확히 알린다.
  if (net.isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) {
      throw new Error('내부망·사설 IP 주소는 분석할 수 없습니다.');
    }
    return url;
  }
  if (!url.hostname.includes('.')) {
    throw new Error('공개된 도메인 주소를 입력해 주세요 (예: https://www.naver.com).');
  }
  return url;
}

/** 호스트가 실제로 가리키는 IP 가 공개 대역인지 확인 */
async function assertPublicHost(hostname) {
  // 호스트가 이미 IP 인 경우
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error('내부망·사설 IP 주소는 분석할 수 없습니다.');
    }
    return;
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`도메인을 찾을 수 없습니다: ${hostname}`);
  }
  if (!records.length) throw new Error(`도메인을 찾을 수 없습니다: ${hostname}`);

  for (const r of records) {
    if (isPrivateAddress(r.address)) {
      throw new Error(`내부망을 가리키는 주소는 분석할 수 없습니다: ${hostname}`);
    }
  }
}

/**
 * HTML 을 가져온다. 리다이렉트는 직접 따라가며 매 홉마다 다시 검사한다.
 * @returns {Promise<{html: string, url: string, finalUrl: string, status: number, bytes: number, redirects: string[], contentType: string, truncated: boolean}>}
 */
async function fetchPage(input) {
  const start = normalizeUrl(input);
  const redirects = [];
  let current = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(current.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res;
    try {
      res = await fetch(current.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        },
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error(`응답이 ${Math.round(TIMEOUT_MS / 1000)}초 안에 오지 않았습니다: ${current.hostname}`);
      }
      throw new Error(`페이지를 가져오지 못했습니다: ${err.message}`);
    }
    clearTimeout(timer);

    // 리다이렉트를 직접 따라간다 (fetch 에 맡기면 중간 홉을 검사할 수 없다)
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), current.href);
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new Error(`리다이렉트 대상이 http/https 가 아닙니다: ${next.protocol}`);
      }
      redirects.push(next.href);
      current = next;
      continue;
    }

    if (!res.ok) {
      throw new Error(`페이지가 ${res.status} 를 반환했습니다 (${current.hostname}).`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      throw new Error(`HTML 페이지가 아닙니다 (${contentType.split(';')[0]}). 화면 분석은 웹 페이지만 지원합니다.`);
    }

    // 크기 상한을 넘으면 앞부분만 쓴다 (읽는 중간에 끊어 메모리를 지킨다)
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    let html = '';
    let bytes = 0;
    let truncated = false;

    if (reader) {
      const decoder = new TextDecoder('utf-8');
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) {
          truncated = true;
          html += decoder.decode(value, { stream: true });
          try { await reader.cancel(); } catch (err) { /* 이미 닫힌 스트림 */ }
          break;
        }
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
    } else {
      html = await res.text();
      bytes = Buffer.byteLength(html);
    }

    return {
      html,
      url: start.href,
      finalUrl: current.href,
      status: res.status,
      bytes,
      redirects,
      contentType: contentType.split(';')[0] || 'text/html',
      truncated,
    };
  }

  throw new Error(`리다이렉트가 ${MAX_REDIRECTS}회를 넘었습니다.`);
}

module.exports = { fetchPage, normalizeUrl, isPrivateAddress, assertPublicHost, MAX_BYTES, TIMEOUT_MS };
