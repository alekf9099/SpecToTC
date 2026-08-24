'use strict';

/**
 * 헤드리스 브라우저 실행 — 선택 기능.
 *
 * 왜 필요한가
 *   fetchPage 는 HTML 만 읽으므로 JS 로 그려지는 화면(SPA)은 볼 수 없고,
 *   폼을 실제로 제출해 본 결과도 알 수 없다. 브라우저를 띄우면 둘 다 해결된다.
 *
 * 왜 선택 기능인가
 *   1) 브라우저 실행은 서버리스(Vercel)에서 동작하지 않는다. 없으면 정적 분석으로 되돌아간다.
 *   2) 폼을 실제로 제출하는 것은 남의 사이트에 실제 요청을 보내는 행위다. 기본은 꺼져 있다.
 *
 * 브라우저는 새로 내려받지 않고 **시스템에 이미 있는 Chrome/Edge** 를 쓴다
 * (playwright-core + channel). 300MB 다운로드가 없어야 사내에서 설치가 막히지 않는다.
 */

const { normalizeUrl, assertPublicHost } = require('./fetchPage');

const NAV_TIMEOUT = Number(process.env.SPECTOTC_BROWSER_TIMEOUT || 20000);
const SETTLE_MS = Number(process.env.SPECTOTC_BROWSER_SETTLE || 1500);
const CHANNELS = (process.env.SPECTOTC_BROWSER_CHANNEL || 'chrome,msedge,chromium')
  .split(',').map((c) => c.trim()).filter(Boolean);

/** 브라우저 기능이 켜져 있는지 (기본 꺼짐 — 명시적으로 켜야 한다) */
function browserEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.SPECTOTC_BROWSER || ''));
}

/** 실제 폼 제출이 허용됐는지 (기본 꺼짐 — 남의 사이트에 실제 요청을 보내므로) */
function submitEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.SPECTOTC_LIVE_SUBMIT || ''));
}

/** POST 등 상태를 바꾸는 메서드까지 허용됐는지 (기본은 GET 폼만) */
function unsafeMethodsEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.SPECTOTC_LIVE_ALLOW_POST || ''));
}

/** 실행 검증을 허용한 호스트 목록 — 비어 있으면 아무 곳도 제출할 수 없다 */
function allowedHosts() {
  return String(process.env.SPECTOTC_LIVE_ALLOW_HOSTS || '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/**
 * 이 호스트에 실제 제출을 해도 되는지.
 *
 * 허용 목록을 요구하는 이유: 임의의 공개 사이트에 폼을 자동 제출하면
 * 가입·문의·로그인 시도를 대량으로 보내는 도구가 된다. QA 가 검증 권한을 가진
 * 사이트만 명시적으로 적게 한다. `example.com` 은 하위 도메인까지 포함한다.
 */
function assertSubmitAllowed(hostname, method) {
  if (!submitEnabled()) {
    throw new Error('실제 제출이 꺼져 있습니다. 서버에 SPECTOTC_LIVE_SUBMIT=1 을 설정하세요.');
  }

  const hosts = allowedHosts();
  if (!hosts.length) {
    throw new Error('실행 검증 허용 호스트가 없습니다. SPECTOTC_LIVE_ALLOW_HOSTS 에 검증 권한이 있는 도메인만 적어주세요.');
  }

  const host = String(hostname).toLowerCase();
  const ok = hosts.some((h) => host === h || host.endsWith(`.${h}`));
  if (!ok) {
    throw new Error(`${host} 는 실행 검증 허용 목록에 없습니다. 검증 권한이 있는 도메인만 SPECTOTC_LIVE_ALLOW_HOSTS 에 추가하세요.`);
  }

  const m = String(method || 'GET').toUpperCase();
  if (m !== 'GET' && !unsafeMethodsEnabled()) {
    throw new Error(`${m} 폼은 데이터를 변경할 수 있어 기본적으로 제출하지 않습니다. 정말 필요하면 SPECTOTC_LIVE_ALLOW_POST=1 을 설정하세요.`);
  }
}

/** playwright-core 가 설치돼 있는지 (optionalDependency 라 없을 수 있다) */
function driver() {
  try {
    // eslint-disable-next-line global-require
    return require('playwright-core');
  } catch {
    return null;
  }
}

/** 브라우저 실행 가능 여부를 진단용으로 알려준다 */
function browserSupport() {
  return {
    enabled: browserEnabled(),
    driverInstalled: Boolean(driver()),
    submitEnabled: submitEnabled(),
    allowPost: unsafeMethodsEnabled(),
    allowHosts: allowedHosts().length,
    channels: CHANNELS,
  };
}

/** 시스템에 있는 Chrome/Edge 를 순서대로 시도한다 */
async function launch() {
  const pw = driver();
  if (!pw) {
    throw new Error('playwright-core 가 설치되지 않았습니다. `npm install --save-optional playwright-core` 후 다시 시도하세요.');
  }

  const errors = [];
  for (const channel of CHANNELS) {
    try {
      return await pw.chromium.launch({
        channel: channel === 'chromium' ? undefined : channel,
        headless: true,
        args: ['--disable-dev-shm-usage', '--no-first-run', '--disable-extensions'],
      });
    } catch (err) {
      errors.push(`${channel}: ${err.message.split('\n')[0]}`);
    }
  }
  throw new Error(`브라우저를 실행할 수 없습니다. 시스템에 Chrome 또는 Edge 가 필요합니다. (${errors.join(' / ')})`);
}

/**
 * 브라우저 안에서도 SSRF 를 막는다.
 *
 * URL 을 미리 검사해도 부족하다 — 페이지가 리다이렉트하거나 JS 로 fetch 하면
 * 내부망으로 갈 수 있고, 그건 서버가 대신 보내는 요청이다. 모든 요청을 가로채
 * 호스트를 다시 검사한다. 검사 결과는 캐시해 페이지당 DNS 조회를 줄인다.
 */
function guardRequests(context) {
  const verdict = new Map();

  return context.route('**/*', async (route) => {
    let host;
    try {
      const u = new URL(route.request().url());
      if (!/^https?:$/.test(u.protocol)) return route.abort('blockedbyclient');
      host = u.hostname;
    } catch {
      return route.abort('blockedbyclient');
    }

    if (!verdict.has(host)) {
      // 정적 분석과 **똑같은** 판정 로직을 쓴다. 두 경로의 방어 수준이 갈리면
      // 브라우저 경로가 우회로가 된다. (assertPublicHost 는 IP·DNS 를 모두 본다)
      verdict.set(host, assertPublicHost(host).then(() => true, () => false));
    }

    return (await verdict.get(host)) ? route.continue() : route.abort('blockedbyclient');
  });
}

/**
 * 브라우저로 페이지를 열고 콜백에 넘긴다. 정리는 항상 보장한다.
 *
 * @param {string} rawUrl 사용자가 준 주소
 * @param {(page, ctx) => Promise<any>} fn
 */
async function withPage(rawUrl, fn) {
  const url = normalizeUrl(rawUrl); // 사설 IP·스킴 검사 (기존 방어 재사용)

  const browser = await launch();
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];

  try {
    const context = await browser.newContext({
      userAgent: process.env.SPECTOTC_WEB_UA
        || 'Mozilla/5.0 (compatible; SpecToTC/0.1; +QA test case generator)',
      viewport: { width: 1280, height: 900 },
      locale: 'ko-KR',
      acceptDownloads: false, // 파일을 내려받게 만드는 페이지를 막는다
    });
    context.setDefaultTimeout(NAV_TIMEOUT);
    context.setDefaultNavigationTimeout(NAV_TIMEOUT);
    await guardRequests(context);

    const page = await context.newPage();

    // 관측 신호 수집 — TC 의 기대 결과를 "실제로 본 것" 으로 채우기 위해
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
    });
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
    page.on('requestfailed', (r) => {
      const f = r.failure();
      // 우리가 막은 요청은 결함이 아니라 방어의 결과이므로 구분해 적는다
      requestFailures.push({
        url: r.url().slice(0, 200),
        reason: f ? f.errorText : 'unknown',
        blockedByUs: Boolean(f && /blockedbyclient|ERR_BLOCKED_BY_CLIENT/i.test(f.errorText)),
      });
    });

    // 자동으로 뜨는 dialog 는 페이지를 멈추게 하므로 닫고 기록만 한다
    const dialogs = [];
    page.on('dialog', async (d) => {
      dialogs.push({ type: d.type(), message: d.message().slice(0, 200) });
      await d.dismiss().catch(() => {});
    });

    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await settle(page);

    const result = await fn(page, {
      status: response ? response.status() : null,
      consoleErrors, pageErrors, requestFailures, dialogs,
    });

    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** 네트워크가 잠잠해지길 기다린다. 계속 폴링하는 페이지도 있으므로 실패해도 넘어간다. */
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: SETTLE_MS * 3 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
}

module.exports = {
  withPage,
  settle,
  browserEnabled,
  submitEnabled,
  unsafeMethodsEnabled,
  allowedHosts,
  assertSubmitAllowed,
  browserSupport,
  launch,
  NAV_TIMEOUT,
};
