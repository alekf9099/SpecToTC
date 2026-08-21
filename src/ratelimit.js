'use strict';

/**
 * 의존성 없는 인메모리 레이트리밋 (고정 창 방식).
 *
 * ⚠️ 서버리스 한계: Vercel 함수는 인스턴스가 여러 개 뜨고 수시로 재활용되므로
 * 카운터가 인스턴스별로만 유지된다. 동시 인스턴스가 N개면 실효 한도도 N배가 된다.
 * "실수·단순 남용·비용 폭증"을 막는 1차 방어선으로만 쓰고, 엄격한 제한이 필요하면
 * Upstash Redis 같은 외부 저장소로 교체해야 한다.
 */

const buckets = new Map();
const MAX_KEYS = 5000;

function now() {
  return Date.now();
}

/** 창이 지난 항목 정리 — 메모리 무한 증가 방지 */
function sweep() {
  const t = now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= t) buckets.delete(key);
  }
  if (buckets.size > MAX_KEYS) {
    // 그래도 넘치면 가장 먼저 들어온 것부터 버린다 (Map 은 삽입 순서를 유지).
    const excess = buckets.size - MAX_KEYS;
    let i = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++i >= excess) break;
    }
  }
}

/** 프록시 뒤에서도 동작하는 클라이언트 식별자 */
function clientKey(req) {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.get('x-real-ip') || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * @param {string} name   버킷 이름 (엔드포인트 그룹)
 * @param {number} limit  창 안에서 허용할 요청 수
 * @param {number} windowMs 창 길이(ms)
 * @returns {{ok: boolean, remaining: number, retryAfter: number}}
 */
function consume(name, id, limit, windowMs) {
  sweep();
  const key = `${name}:${id}`;
  const t = now();
  let entry = buckets.get(key);

  if (!entry || entry.resetAt <= t) {
    entry = { count: 0, resetAt: t + windowMs };
    buckets.set(key, entry);
  }

  entry.count += 1;
  const ok = entry.count <= limit;
  return {
    ok,
    remaining: Math.max(0, limit - entry.count),
    retryAfter: Math.ceil((entry.resetAt - t) / 1000),
    limit,
  };
}

/**
 * Express 미들웨어 팩토리.
 * @param {{name: string, limit: number, windowMs: number, message?: string}} opts
 */
function limiter(opts) {
  const { name, limit, windowMs } = opts;
  const message = opts.message || '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';

  return (req, res, next) => {
    if (process.env.SPECTOTC_DISABLE_RATELIMIT === 'true') return next();

    const result = consume(name, clientKey(req), limit, windowMs);
    res.set('X-RateLimit-Limit', String(limit));
    res.set('X-RateLimit-Remaining', String(result.remaining));

    if (result.ok) return next();

    res.set('Retry-After', String(result.retryAfter));
    return res.status(429).json({
      ok: false,
      error: `${message} (${result.retryAfter}초 후 재시도)`,
      retryAfter: result.retryAfter,
    });
  };
}

/** 테스트용 — 카운터 초기화 */
function reset() {
  buckets.clear();
}

module.exports = { limiter, consume, clientKey, reset };
