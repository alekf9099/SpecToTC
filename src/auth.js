'use strict';

/**
 * 공유 비밀번호 + 서명된 세션 쿠키 인증.
 *
 * 계정 개념은 없다. 팀 공용 비밀번호 하나로 들어오고, 서버는 HMAC 으로 서명한
 * HttpOnly 쿠키를 발급한다. 의존성(세션 스토어·쿠키 파서)을 쓰지 않으므로
 * 서버리스에서 인스턴스가 새로 떠도 쿠키 검증이 그대로 동작한다.
 *
 * 환경 변수
 *   SPECTOTC_PASSWORD        팀 공용 비밀번호. 없으면 로컬은 인증 없이 열리고,
 *                            Vercel 배포에서는 모든 요청을 503 으로 막는다.
 *   SPECTOTC_SESSION_SECRET  쿠키 서명 키. 없으면 비밀번호에서 파생한다
 *                            (비밀번호를 바꾸면 기존 세션이 모두 무효가 된다).
 *   SPECTOTC_SESSION_HOURS   세션 유효 시간 (기본 12)
 */
const crypto = require('node:crypto');

const COOKIE_NAME = 'spectotc_session';
const SESSION_VERSION = 1;

function password() {
  const value = process.env.SPECTOTC_PASSWORD || process.env.APP_PASSWORD || '';
  return value.trim();
}

/** 인증 기능 자체가 켜져 있는지 (비밀번호가 설정됐는지) */
function isEnabled() {
  return password().length > 0;
}

/** Vercel 등 배포 환경인지 — 비밀번호 없이 배포되는 사고를 막기 위해 본다. */
function isDeployed() {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.SPECTOTC_FORCE_AUTH);
}

/**
 * 비밀번호 없이 배포된 상태인지. true 면 앱은 모든 요청을 503 으로 막는다.
 * (열린 채로 사내 기획서를 받는 것보다 아예 막는 편이 안전하다.)
 */
function isMisconfigured() {
  return isDeployed() && !isEnabled();
}

function sessionHours() {
  const n = Number(process.env.SPECTOTC_SESSION_HOURS);
  return Number.isFinite(n) && n > 0 && n <= 720 ? n : 12;
}

function secret() {
  const explicit = process.env.SPECTOTC_SESSION_SECRET;
  if (explicit && explicit.trim()) return explicit.trim();
  // 비밀번호에서 파생 — 비밀번호를 교체하면 기존 세션이 자동으로 무효화된다.
  return crypto.createHash('sha256').update(`spectotc:${password()}`).digest('hex');
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** 타이밍 공격에 안전한 문자열 비교 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** 입력 비밀번호 검증 — 길이 노출을 막기 위해 해시를 비교한다. */
function verifyPassword(input) {
  if (!isEnabled() || typeof input !== 'string') return false;
  const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
  return safeEqual(hash(input), hash(password()));
}

/* ------------------------------------------------------------------ 토큰 */

function createToken() {
  const payload = b64url(JSON.stringify({
    v: SESSION_VERSION,
    exp: Date.now() + sessionHours() * 3600 * 1000,
  }));
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, signature] = token.split('.', 2);
  if (!payload || !signature) return false;
  if (!safeEqual(signature, sign(payload))) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.v === SESSION_VERSION && typeof data.exp === 'number' && data.exp > Date.now();
  } catch (err) {
    return false;
  }
}

/* ----------------------------------------------------------------- 쿠키 */

/** cookie-parser 없이 쿠키 헤더를 직접 파싱 */
function readCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch (err) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

function isSecureRequest(req) {
  return req.secure || req.get('x-forwarded-proto') === 'https' || Boolean(process.env.VERCEL);
}

function setSessionCookie(req, res) {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(createToken())}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${sessionHours() * 3600}`,
  ];
  if (isSecureRequest(req)) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req, res) {
  const attrs = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecureRequest(req)) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

/** 요청이 인증된 상태인지. 인증 기능이 꺼져 있으면(로컬 개발) 항상 통과. */
function isAuthenticated(req) {
  if (!isEnabled()) return true;
  return verifyToken(readCookie(req, COOKIE_NAME));
}

module.exports = {
  COOKIE_NAME,
  isEnabled,
  isDeployed,
  isMisconfigured,
  sessionHours,
  verifyPassword,
  createToken,
  verifyToken,
  readCookie,
  setSessionCookie,
  clearSessionCookie,
  isAuthenticated,
};
