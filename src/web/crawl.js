'use strict';

/**
 * 로그인 후 사이트를 돌며 화면을 모은다.
 *
 * 지금까지의 웹 분석은 **준 URL 한 장**만 봤다. 그래서 내부 링크 4개가
 * "주요 내부 링크 이동 (4개 중 대표)" TC 한 줄로 뭉쳤고, 그 링크 너머의
 * 주문내역·쿠폰·설정 화면은 아예 분석되지 않았다.
 *
 * 여기서는 링크를 따라가 **화면마다 인벤토리를 만든다.** 로그인 정보를 주면
 * 먼저 로그인하고 그 세션으로 돈다. 로그인 뒤에만 보이는 화면이 대부분이므로
 * 이게 없으면 실제 기능 TC 를 만들 수 없다.
 *
 * 안전 규칙 — 남의 서비스를 자동으로 돌아다니는 일이라 좁게 잠가 둔다.
 *   · 링크 이동(GET)만 한다. 크롤 중에는 폼을 제출하지 않는다(로그인 폼 제외).
 *   · 로그아웃·삭제·탈퇴처럼 되돌릴 수 없는 링크는 따라가지 않는다.
 *   · 같은 출처(origin)만. 외부 도메인은 목록에만 남긴다.
 *   · 페이지 수·깊이 상한을 둔다. 무한 크롤은 대상 서비스에 부담이 된다.
 */

const { buildInventory } = require('./inventory');
const {
  withPage, settle, assertSubmitAllowed, assertCrawlTarget,
} = require('./browser');

const DEFAULTS = {
  maxPages: Number(process.env.SPECTOTC_CRAWL_MAX_PAGES || 10),
  maxDepth: Number(process.env.SPECTOTC_CRAWL_MAX_DEPTH || 2),
};
const HARD_MAX_PAGES = 30;

/**
 * 따라가면 안 되는 링크.
 * 세션이 끊기거나(로그아웃) 데이터가 사라지는(삭제·탈퇴) 경로다.
 * 크롤러가 이걸 밟으면 이후 탐색이 전부 망가지고, 최악의 경우 데이터를 지운다.
 */
const DANGEROUS = new RegExp([
  'logout', 'signout', 'sign-out', 'log-out',
  'delete', 'remove', 'destroy', 'drop', 'purge',
  'withdraw', 'unsubscribe', 'deactivate', 'cancel',
  'reset', 'revoke', 'expire',
  '로그아웃', '탈퇴', '삭제', '해지', '취소', '초기화',
].join('|'), 'i');

/** 같은 화면으로 보는 기준 — 쿼리·프래그먼트가 달라도 경로가 같으면 한 번만 본다 */
function pageKey(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/+$/, '') || '/'}`;
  } catch {
    return String(url);
  }
}

/** 화면 이름 — 문서 제목이 있으면 그걸, 없으면 경로를 쓴다 */
function screenName(title, url) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();
  if (clean && clean.length <= 40) return clean;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    return path && path !== '' ? path : '홈';
  } catch {
    return clean.slice(0, 40) || '화면';
  }
}

/** 로그인 상태로 보이는지 — 화면 신호로만 판단한다 (확신이 아니라 추정) */
async function readAuthSignals(page) {
  return page.evaluate(() => {
    const text = (document.body ? document.body.innerText : '') || '';
    const hasPasswordField = Boolean(document.querySelector('input[type="password"]'));
    const logoutLink = [...document.querySelectorAll('a, button')].some((el) => (
      /로그아웃|logout|sign\s*out/i.test((el.innerText || '') + (el.getAttribute('href') || ''))
    ));
    return {
      hasPasswordField,
      logoutLink,
      mentionsLogin: /로그인|sign\s*in|log\s*in/i.test(text.slice(0, 3000)),
    };
  });
}

/**
 * 로그인 폼을 찾아 자격 증명을 넣고 제출한다.
 *
 * 자격 증명은 **여기서만 쓰고 어디에도 남기지 않는다.** 반환값·로그·TC 문구에
 * 아이디나 비밀번호가 들어가면 CSV·PDF 로 그대로 새어 나간다.
 */
async function performLogin(page, login) {
  const result = { attempted: true, ok: false, note: null, loginUrl: page.url() };

  // 로그인 화면이 따로 있으면 먼저 이동
  if (login.url && login.url !== page.url()) {
    await page.goto(assertCrawlTarget(login.url).href, { waitUntil: 'domcontentloaded' });
    await settle(page);
    result.loginUrl = page.url();
  }

  const pw = page.locator('input[type="password"]').first();
  if (!(await pw.count())) {
    result.note = '로그인 화면에서 비밀번호 입력란을 찾지 못했습니다. 로그인 주소를 직접 지정해 주세요.';
    return result;
  }

  // 아이디 칸 — 비밀번호 앞의 텍스트성 입력 중 마지막 것
  const idCandidates = page.locator(
    'input[type="text"], input[type="email"], input[type="tel"], input:not([type])',
  );
  if (await idCandidates.count()) {
    await idCandidates.first().fill(String(login.username), { timeout: 5000 }).catch(() => {});
  }
  await pw.fill(String(login.password), { timeout: 5000 });

  const before = page.url();
  const navigation = page.waitForNavigation({ timeout: 10000 }).catch(() => null);
  const submit = page.locator('button[type="submit"], input[type="submit"], button:not([type])').first();
  if (await submit.count()) await submit.click({ timeout: 5000 }).catch(() => {});
  else await pw.press('Enter', { timeout: 5000 }).catch(() => {});
  await navigation;
  await settle(page);

  const signals = await readAuthSignals(page);
  // 비밀번호 칸이 사라졌거나 로그아웃 링크가 보이면 성공으로 본다
  result.ok = !signals.hasPasswordField || signals.logoutLink;
  result.movedTo = page.url();
  result.changedScreen = before !== page.url();
  if (!result.ok) {
    result.note = '로그인 후에도 비밀번호 입력란이 남아 있습니다. 자격 증명이나 추가 인증(2단계·캡차)을 확인해 주세요.';
  }
  return result;
}

/** 이 페이지에서 따라갈 만한 내부 링크를 고른다 */
async function collectLinks(page, origin) {
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
    .map((a) => ({ href: a.href, label: (a.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) })));

  const out = [];
  const skipped = [];
  for (const { href, label } of hrefs) {
    let u;
    try { u = new URL(href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (u.origin !== origin) continue;                       // 외부 도메인은 따라가지 않는다
    if (DANGEROUS.test(u.pathname + u.search) || DANGEROUS.test(label)) {
      skipped.push({ url: u.href, label, reason: '되돌릴 수 없는 동작으로 보여 건너뜀' });
      continue;
    }
    out.push({ url: u.href, label });
  }
  return { links: out, skipped };
}

/**
 * 시작 주소에서 출발해 화면을 모은다.
 *
 * @param {string} startUrl
 * @param {{login?: {username,password,url?}, maxPages?: number, maxDepth?: number}} options
 */
async function crawlSite(startUrl, options = {}) {
  const maxPages = Math.min(HARD_MAX_PAGES, Math.max(1, Number(options.maxPages) || DEFAULTS.maxPages));
  const maxDepth = Math.max(0, Math.min(4, Number(options.maxDepth) ?? DEFAULTS.maxDepth));
  const login = options.login && options.login.password ? options.login : null;

  const start = assertCrawlTarget(startUrl);
  // 로그인은 대상 사이트에 실제 자격 증명을 보내는 행위다. 실행 검증과 같은 게이트를 통과해야 한다.
  if (login) assertSubmitAllowed(start.hostname, 'POST');

  return withPage(startUrl, async (page, obs) => {
    const origin = new URL(page.url()).origin;
    const pages = [];
    const skippedLinks = [];
    const visited = new Set();
    const queue = [{ url: page.url(), depth: 0, label: null }];

    let loginResult = null;
    if (login) {
      loginResult = await performLogin(page, login);
      // 로그인 후 도착한 화면에서 다시 출발한다 (대개 홈·대시보드)
      queue[0] = { url: page.url(), depth: 0, label: null };
    }

    while (queue.length && pages.length < maxPages) {
      const item = queue.shift();
      const key = pageKey(item.url);
      if (visited.has(key)) continue;
      visited.add(key);

      try {
        if (page.url() !== item.url) {
          await page.goto(item.url, { waitUntil: 'domcontentloaded' });
          await settle(page);
        }
      } catch (err) {
        skippedLinks.push({ url: item.url, label: item.label, reason: `열지 못함: ${String(err.message).split('\n')[0].slice(0, 80)}` });
        continue;
      }

      const html = await page.content();
      const url = page.url();
      const title = await page.title().catch(() => null);
      const inventory = buildInventory(html, url);
      inventory.rendering = { ...inventory.rendering, jsRendered: false, renderedByBrowser: true };

      const auth = await readAuthSignals(page);
      pages.push({
        url,
        path: (() => { try { return new URL(url).pathname; } catch { return url; } })(),
        title,
        name: screenName(title, url),
        depth: item.depth,
        viaLabel: item.label,
        inventory,
        behindLogin: Boolean(loginResult && loginResult.ok),
        authSignals: auth,
      });

      if (item.depth >= maxDepth) continue;
      const { links, skipped } = await collectLinks(page, origin);
      skippedLinks.push(...skipped);
      for (const link of links) {
        if (visited.has(pageKey(link.url))) continue;
        if (queue.some((q) => pageKey(q.url) === pageKey(link.url))) continue;
        queue.push({ url: link.url, depth: item.depth + 1, label: link.label });
      }
    }

    return {
      start: start.href,
      origin,
      login: loginResult,
      pages,
      // 큐에 남은 건 상한에 걸려 못 본 화면이다. 숨기지 않고 알려 준다.
      notVisited: queue.slice(0, 20).map((q) => ({ url: q.url, label: q.label })),
      skippedLinks: skippedLinks.slice(0, 30),
      limits: { maxPages, maxDepth },
      observations: {
        consoleErrors: obs.consoleErrors.slice(0, 10),
        pageErrors: obs.pageErrors.slice(0, 10),
        blockedRequests: obs.requestFailures.filter((r) => r.blockedByUs).length,
      },
    };
  });
}

module.exports = { crawlSite, pageKey, screenName, DANGEROUS, DEFAULTS, HARD_MAX_PAGES };
