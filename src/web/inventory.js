'use strict';

/**
 * HTML → 화면 요소 인벤토리.
 *
 * "무엇을 테스트해야 하는가" 를 페이지에서 직접 읽어낸다.
 *   · 폼과 입력 필드, 그리고 각 필드의 제약(required / maxlength / type / pattern)
 *   · 버튼·링크·검색·로그인 같은 상호작용 지점
 *   · 접근성·반응형 신호 (alt 누락, viewport, lang)
 *   · JS 렌더링 위주 페이지인지 (정적 HTML 로는 볼 수 없는 화면인지)
 *
 * 정규식이 아니라 파서를 쓰는 이유: 어떤 input 이 어떤 form 에 속하는지,
 * 버튼 라벨이 무엇인지 같은 관계는 태그 중첩을 이해해야 정확하다.
 */
const { parse } = require('node-html-parser');

const text = (node) => (node ? node.text.replace(/\s+/g, ' ').trim() : '');
const attr = (node, name) => (node && node.getAttribute(name)) || null;

/** 사람이 읽을 라벨을 찾는다 — label[for] → 감싸는 label → aria-label → placeholder → name */
function fieldLabel(root, field) {
  const id = attr(field, 'id');
  if (id) {
    const escaped = id.replace(/["\\]/g, '\\$&');
    const label = root.querySelector(`label[for="${escaped}"]`);
    if (label && text(label)) return text(label).slice(0, 60);
  }
  let parent = field.parentNode;
  for (let depth = 0; parent && depth < 3; depth += 1, parent = parent.parentNode) {
    if (parent.rawTagName === 'label' && text(parent)) return text(parent).slice(0, 60);
  }
  return (attr(field, 'aria-label') || attr(field, 'placeholder') || attr(field, 'name')
    || attr(field, 'id') || '이름 없는 필드').slice(0, 60);
}

const IGNORED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

/** 입력 필드 하나의 검증 제약을 수집 */
function readField(root, el) {
  const tag = el.rawTagName.toLowerCase();
  const type = (attr(el, 'type') || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : 'text')).toLowerCase();

  const constraints = {};
  for (const [key, name] of [
    ['required', 'required'], ['maxLength', 'maxlength'], ['minLength', 'minlength'],
    ['max', 'max'], ['min', 'min'], ['step', 'step'], ['pattern', 'pattern'],
    ['accept', 'accept'], ['multiple', 'multiple'], ['readonly', 'readonly'], ['disabled', 'disabled'],
  ]) {
    const v = el.hasAttribute(name) ? (attr(el, name) === null || attr(el, name) === '' ? true : attr(el, name)) : null;
    if (v !== null) constraints[key] = v;
  }

  return {
    tag,
    type,
    name: attr(el, 'name'),
    label: fieldLabel(root, el),
    placeholder: attr(el, 'placeholder'),
    constraints,
    options: tag === 'select' ? el.querySelectorAll('option').length : undefined,
  };
}

/** 폼 단위로 필드를 묶는다. form 밖 입력은 별도 그룹으로 모은다. */
function readForms(root) {
  const forms = [];

  root.querySelectorAll('form').forEach((form, i) => {
    const fields = [];
    form.querySelectorAll('input, textarea, select').forEach((el) => {
      const type = (attr(el, 'type') || '').toLowerCase();
      if (el.rawTagName.toLowerCase() === 'input' && IGNORED_INPUT_TYPES.has(type)) return;
      fields.push(readField(root, el));
    });

    const submits = [];
    form.querySelectorAll('button, input[type="submit"], input[type="image"]').forEach((el) => {
      const label = text(el) || attr(el, 'value') || attr(el, 'aria-label') || attr(el, 'alt');
      if (label) submits.push(label.slice(0, 40));
    });

    const hasPassword = fields.some((f) => f.type === 'password');
    const isSearch = fields.some((f) => f.type === 'search'
      || /^(q|query|keyword|search|sword|kw)$/i.test(f.name || ''));

    forms.push({
      index: i + 1,
      name: attr(form, 'name') || attr(form, 'id') || (hasPassword ? '로그인 폼' : isSearch ? '검색 폼' : `폼 ${i + 1}`),
      action: attr(form, 'action') || '(현재 주소)',
      method: (attr(form, 'method') || 'GET').toUpperCase(),
      fields,
      submits,
      kind: hasPassword ? 'login' : isSearch ? 'search' : 'generic',
      hasFileUpload: fields.some((f) => f.type === 'file'),
    });
  });

  // form 태그 밖에 있는 입력 — SPA 에서 흔하다
  const orphan = [];
  root.querySelectorAll('input, textarea, select').forEach((el) => {
    if (el.closest('form')) return;
    const type = (attr(el, 'type') || '').toLowerCase();
    if (el.rawTagName.toLowerCase() === 'input' && IGNORED_INPUT_TYPES.has(type)) return;
    orphan.push(readField(root, el));
  });

  if (orphan.length) {
    forms.push({
      index: forms.length + 1,
      name: 'form 태그 밖 입력',
      action: '(JS 처리 추정)',
      method: 'N/A',
      fields: orphan,
      submits: [],
      kind: orphan.some((f) => f.type === 'password') ? 'login' : 'generic',
      hasFileUpload: orphan.some((f) => f.type === 'file'),
      outsideForm: true,
    });
  }

  return forms;
}

/** 링크를 내부/외부로 나누고 대표 항목을 뽑는다 */
function readLinks(root, baseUrl) {
  const base = new URL(baseUrl);
  const internal = [];
  const external = [];
  const problems = { emptyHref: 0, javascriptHref: 0, noTextLink: 0, targetBlankNoRel: 0 };

  root.querySelectorAll('a').forEach((a) => {
    const href = attr(a, 'href');
    const label = text(a) || attr(a, 'aria-label') || attr(a, 'title') || '';

    if (!href || href === '#') { problems.emptyHref += 1; return; }
    if (/^javascript:/i.test(href)) { problems.javascriptHref += 1; return; }
    if (/^(mailto|tel):/i.test(href)) return;
    if (!label) problems.noTextLink += 1;
    if (attr(a, 'target') === '_blank' && !/noopener/i.test(attr(a, 'rel') || '')) {
      problems.targetBlankNoRel += 1;
    }

    let url;
    try { url = new URL(href, base.href); } catch (err) { return; }
    const entry = { label: label.slice(0, 50), path: url.pathname + url.search, href: url.href };
    if (url.hostname === base.hostname) internal.push(entry);
    else external.push({ ...entry, host: url.hostname });
  });

  const dedupe = (list, key) => {
    const seen = new Set();
    return list.filter((x) => (seen.has(x[key]) ? false : seen.add(x[key])));
  };

  return {
    internalCount: internal.length,
    externalCount: external.length,
    internal: dedupe(internal, 'href').slice(0, 30),
    externalHosts: [...new Set(external.map((e) => e.host))].slice(0, 15),
    problems,
  };
}

/**
 * HTML 을 인벤토리로 바꾼다.
 * @param {string} html
 * @param {string} pageUrl 상대 경로를 절대화하는 기준
 */
function buildInventory(html, pageUrl) {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });

  const bodyText = text(root.querySelector('body') || root);
  const scripts = root.querySelectorAll('script').length;
  const images = root.querySelectorAll('img');
  const missingAlt = images.filter((img) => !img.hasAttribute('alt')).length;

  const headings = [];
  root.querySelectorAll('h1, h2, h3').forEach((h) => {
    const t = text(h);
    if (t) headings.push({ level: Number(h.rawTagName.slice(1)), text: t.slice(0, 80) });
  });

  const buttons = [];
  root.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach((b) => {
    const label = text(b) || attr(b, 'value') || attr(b, 'aria-label') || attr(b, 'title');
    if (label) buttons.push(label.replace(/\s+/g, ' ').trim().slice(0, 40));
  });

  const forms = readForms(root, pageUrl);
  const links = readLinks(root, pageUrl);

  const viewport = root.querySelector('meta[name="viewport"]');
  const description = root.querySelector('meta[name="description"]');
  const htmlEl = root.querySelector('html');

  // 정적 HTML 로 볼 수 있는 내용이 적고 스크립트만 많으면 JS 렌더링 위주다.
  const jsRendered = bodyText.length < 600 && scripts >= 3;

  return {
    page: {
      url: pageUrl,
      title: text(root.querySelector('title')).slice(0, 120) || null,
      description: attr(description, 'content'),
      lang: attr(htmlEl, 'lang'),
      hasViewport: Boolean(viewport),
      viewport: attr(viewport, 'content'),
      textLength: bodyText.length,
    },
    structure: {
      headings: headings.slice(0, 40),
      sections: root.querySelectorAll('section, article, nav, aside, header, footer, main').length,
      tables: root.querySelectorAll('table').length,
      lists: root.querySelectorAll('ul, ol').length,
      iframes: root.querySelectorAll('iframe').length,
      media: root.querySelectorAll('video, audio').length,
    },
    interaction: {
      forms,
      buttons: [...new Set(buttons)].slice(0, 40),
      buttonCount: buttons.length,
      hasLogin: forms.some((f) => f.kind === 'login'),
      hasSearch: forms.some((f) => f.kind === 'search'),
      hasUpload: forms.some((f) => f.hasFileUpload),
    },
    links,
    accessibility: {
      images: images.length,
      missingAlt,
      langMissing: !attr(htmlEl, 'lang'),
      emptyLinks: links.problems.emptyHref,
      unlabeledLinks: links.problems.noTextLink,
    },
    rendering: {
      scripts,
      jsRendered,
      note: jsRendered
        ? '정적 HTML 에 본문이 거의 없어 JS 렌더링 위주 페이지로 보입니다. 화면 요소 상당 부분이 이 분석에 잡히지 않았을 수 있습니다.'
        : null,
    },
  };
}

module.exports = { buildInventory, readForms, readLinks, fieldLabel };
