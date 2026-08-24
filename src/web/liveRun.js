'use strict';

/**
 * 브라우저로 실제 화면을 열고, 필요하면 실제로 폼을 제출해 결과를 관측한다.
 *
 * 두 가지를 한다.
 *   1) 렌더링 분석 — JS 로 그려진 DOM 을 그대로 인벤토리로 만든다. 읽기만 한다.
 *   2) 실행 검증 — QA 가 지정한 값을 실제로 입력·제출하고 결과를 기록한다. 기본 꺼짐.
 *
 * 관측한 사실은 TC 의 기대 결과를 "그렇게 되어야 한다" 에서
 * "실제로 이렇게 나왔다" 로 바꾸는 데 쓴다. 추측과 관측은 문구에서 항상 구분한다.
 */

const { buildInventory } = require('./inventory');
const { withPage, settle, assertSubmitAllowed } = require('./browser');
const { normalizeUrl } = require('./fetchPage');

/** 입력을 넣지 않는 필드 — 값을 만들 수 없거나 넣으면 안 되는 것들 */
const SKIP_TYPES = new Set(['file', 'hidden', 'submit', 'button', 'reset', 'image']);

/** 폼 하나에 대응하는 라이브 DOM 핸들을 찾는다 (인벤토리와 같은 순서 규칙) */
function formHandle(page, form) {
  if (form.outsideForm) return page.locator('body');
  const n = Math.max(0, (Number(form.index) || 1) - 1);
  return page.locator('form').nth(n);
}

/** 폼 안의 입력 요소를 인벤토리와 같은 순서로 집는다 */
function fieldLocators(scope) {
  return scope.locator(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select',
  );
}

/** 화면에 보이는 오류/안내 문구를 모은다 — 검증 메시지가 실제로 뜨는지 확인하기 위해 */
async function readMessages(page) {
  return page.evaluate(() => {
    const out = [];
    const sels = [
      '[role="alert"]', '[aria-live="assertive"]', '[aria-live="polite"]',
      '.error', '.err', '.invalid', '.form-error', '.field-error',
      '.help-block', '.invalid-feedback', '.message', '.alert', '.toast',
    ];
    document.querySelectorAll(sels.join(',')).forEach((el) => {
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 200) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return; // 숨겨진 템플릿은 제외
      if (!out.includes(t)) out.push(t);
    });
    return out.slice(0, 10);
  });
}

/** 브라우저의 기본 제약 검증(HTML5 validity) 이 막았는지 */
async function readValidity(scope) {
  return scope.evaluate((root) => {
    const els = root.querySelectorAll('input, textarea, select');
    const bad = [];
    els.forEach((el) => {
      if (typeof el.checkValidity === 'function' && !el.checkValidity()) {
        bad.push({ name: el.name || el.id || el.type, message: el.validationMessage || '' });
      }
    });
    return bad.slice(0, 10);
  });
}

/**
 * 결과 건수를 추정한다.
 *
 * 정확히 알 수는 없으므로 두 가지 신호만 정직하게 보고한다.
 *   · 본문에 적힌 "N건 / N개 / N results" 표기
 *   · 가장 많이 반복된 목록 항목 수 (결과 목록일 가능성이 높은 것)
 * TC 에는 "관측" 이라고 붙여 쓰고, 확정 수치로 단정하지 않는다.
 */
async function readResultSignals(page) {
  return page.evaluate(() => {
    const body = (document.body ? document.body.innerText : '') || '';
    const stated = [];
    const re = /([0-9][0-9,]{0,11})\s*(건|개|명|results?|items?)\b/gi;
    let m = re.exec(body);
    while (m && stated.length < 5) {
      stated.push(`${m[1]}${m[2]}`);
      m = re.exec(body);
    }

    let listItems = 0;
    document.querySelectorAll('ul, ol, tbody, [role="list"]').forEach((el) => {
      const n = el.querySelectorAll(':scope > li, :scope > tr, :scope > [role="listitem"]').length;
      if (n > listItems) listItems = n;
    });

    const emptyWords = ['검색 결과가 없', '결과가 없', '일치하는', '찾을 수 없', 'no results', 'not found'];
    return {
      statedCounts: stated,
      largestList: listItems,
      bodyTextLength: body.length,
      looksEmpty: emptyWords.some((w) => body.toLowerCase().includes(w.toLowerCase())),
    };
  });
}

/** 페이지 상태 요약 — 제출 전/후를 비교하기 위해 */
async function snapshot(page) {
  return {
    url: page.url(),
    title: await page.title().catch(() => null),
    messages: await readMessages(page),
    results: await readResultSignals(page),
  };
}

/**
 * 브라우저로 페이지를 열어 **렌더링된 DOM** 으로 인벤토리를 만든다.
 * 정적 HTML 로는 볼 수 없는 SPA 화면을 잡기 위한 것으로, 읽기만 한다.
 */
async function renderInventory(rawUrl) {
  return withPage(rawUrl, async (page, obs) => {
    const html = await page.content();
    const inventory = buildInventory(html, page.url());

    // 브라우저로 봤으므로 "JS 렌더링이라 못 봤다" 는 경고는 더 이상 해당되지 않는다
    inventory.rendering = {
      ...inventory.rendering,
      jsRendered: false,
      renderedByBrowser: true,
      note: '헤드리스 브라우저로 렌더링된 DOM 을 분석했습니다. JS 로 그려지는 요소가 포함됩니다.',
    };

    return {
      inventory,
      page: { url: page.url(), status: obs.status, title: await page.title().catch(() => null) },
      observations: {
        consoleErrors: obs.consoleErrors.slice(0, 10),
        pageErrors: obs.pageErrors.slice(0, 10),
        dialogs: obs.dialogs,
        blockedRequests: obs.requestFailures.filter((r) => r.blockedByUs).length,
        failedRequests: obs.requestFailures.filter((r) => !r.blockedByUs).slice(0, 10),
      },
    };
  });
}

/**
 * 폼에 값을 실제로 넣고 제출해 결과를 관측한다.
 *
 * @param {string} rawUrl 대상 주소
 * @param {object} form   인벤토리의 폼 (index·method·fields 사용)
 * @param {Array<{index:number,value:string}>} inputs 넣을 값
 * @param {object} opts   { label } 이 케이스의 이름
 */
async function runFormCase(rawUrl, form, inputs, opts = {}) {
  const url = normalizeUrl(rawUrl);
  assertSubmitAllowed(url.hostname, form.method); // 허용 목록·메서드 게이트

  return withPage(rawUrl, async (page, obs) => {
    const scope = formHandle(page, form);
    const before = await snapshot(page);
    const filled = [];
    const skipped = [];

    const locators = fieldLocators(scope);
    const count = await locators.count();

    for (const { index, value } of inputs) {
      const field = form.fields[index];
      if (!field) { skipped.push({ index, reason: '인벤토리에 없는 필드' }); continue; }
      if (SKIP_TYPES.has(field.type)) { skipped.push({ index, label: field.label, reason: `${field.type} 타입은 자동 입력하지 않음` }); continue; }
      if (index >= count) { skipped.push({ index, label: field.label, reason: '화면에서 해당 요소를 찾지 못함' }); continue; }

      const el = locators.nth(index);
      try {
        if (field.type === 'checkbox' || field.type === 'radio') {
          if (String(value).toLowerCase() !== 'false') await el.check({ timeout: 5000 });
        } else if (field.tag === 'select') {
          await el.selectOption({ label: String(value) }, { timeout: 5000 })
            .catch(() => el.selectOption(String(value), { timeout: 5000 }));
        } else {
          await el.fill(String(value), { timeout: 5000 });
        }
        filled.push({ index, label: field.label, value: String(value).slice(0, 100) });
      } catch (err) {
        skipped.push({ index, label: field.label, reason: err.message.split('\n')[0].slice(0, 120) });
      }
    }

    // HTML5 기본 검증이 막는지는 제출 전에 봐야 알 수 있다
    const validityBeforeSubmit = await readValidity(scope).catch(() => []);

    // 제출 — 버튼이 있으면 클릭, 없으면 Enter (SPA 는 버튼이 form 밖일 수 있다)
    let submitAction = null;
    const navigation = page.waitForNavigation({ timeout: 8000 }).catch(() => null);
    try {
      const button = scope.locator('button[type="submit"], input[type="submit"], button:not([type])').first();
      if (await button.count()) {
        await button.click({ timeout: 5000 });
        submitAction = '제출 버튼 클릭';
      } else {
        await fieldLocators(scope).first().press('Enter', { timeout: 5000 });
        submitAction = 'Enter 키';
      }
    } catch (err) {
      submitAction = `제출 실패: ${err.message.split('\n')[0].slice(0, 120)}`;
    }

    const nav = await navigation;
    await settle(page);
    const after = await snapshot(page);

    return {
      label: opts.label || '실행 검증',
      form: { index: form.index, name: form.name, method: form.method, action: form.action },
      filled,
      skipped,
      submitAction,
      validityBeforeSubmit,
      navigated: before.url !== after.url,
      httpStatus: nav ? nav.status() : (obs.status ?? null),
      before: { url: before.url, title: before.title },
      after,
      // 입력값이 주소에 반영됐는지 — GET 검색이 실제로 조회됐다는 가장 직접적인 증거
      valueInUrl: filled
        .filter((f) => f.value && after.url.includes(encodeURIComponent(f.value)))
        .map((f) => f.label),
      consoleErrors: obs.consoleErrors.slice(0, 10),
      pageErrors: obs.pageErrors.slice(0, 10),
      dialogs: obs.dialogs,
    };
  });
}

module.exports = { renderInventory, runFormCase, readResultSignals, snapshot };
