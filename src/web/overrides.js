'use strict';

/**
 * QA 가 지정한 조건을 화면 인벤토리에 덮어쓴다.
 *
 * 왜 필요한가
 *   페이지 HTML 은 "무엇이 있는지" 만 알려준다. 실제 규칙(최대 길이, 필수 여부,
 *   사내 형식 규칙, 선행 조건)은 HTML 에 없는 경우가 대부분이고, 그건 QA 가 알고 있다.
 *   그 조건을 넣으면 문서 기반 엔진과 같은 수준의 경계값·조건 분기 TC 를 만들 수 있다.
 *
 * 또한 JS 로 그려지는 화면은 정적 분석에 잡히지 않으므로, 없는 필드를 직접 추가할 수도 있다.
 *
 * 입력은 클라이언트가 보낸 값이므로 크기·타입을 모두 제한한다.
 */

const LIMITS = {
  forms: 20,
  fieldsPerForm: 60,
  addedPerForm: 30,
  string: 200,
  number: 100000,
};

const str = (v, max = LIMITS.string) => (typeof v === 'string' ? v.trim().slice(0, max) : null);

/** "20", 20 → 20 / 빈 값·범위 밖 → null */
function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > LIMITS.number) return null;
  return n;
}

const bool = (v) => (v === true || v === 'true' || v === 1 || v === '1' ? true
  : (v === false || v === 'false' || v === 0 || v === '0' ? false : null));

const SAFE_TYPES = new Set([
  'text', 'email', 'password', 'tel', 'url', 'number', 'search', 'date', 'time',
  'datetime-local', 'month', 'file', 'checkbox', 'radio', 'textarea', 'select', 'range', 'color',
]);

/** 필드 하나에 대한 QA 지정값을 정리 */
function cleanFieldOverride(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const out = {};
  const required = bool(raw.required);
  if (required !== null) out.required = required;

  const maxLength = num(raw.maxLength);
  if (maxLength !== null) out.maxLength = maxLength;

  const minLength = num(raw.minLength);
  if (minLength !== null) out.minLength = minLength;

  const rule = str(raw.rule);
  if (rule) out.rule = rule;

  const testValue = str(raw.testValue);
  if (testValue) out.testValue = testValue;

  const note = str(raw.note);
  if (note) out.note = note;

  return Object.keys(out).length ? out : null;
}

/** 페이지에서 잡히지 않은 필드를 QA 가 직접 추가한 경우 */
function cleanAddedField(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const label = str(raw.label, 60);
  if (!label) return null;

  const type = SAFE_TYPES.has(String(raw.type)) ? String(raw.type) : 'text';
  const over = cleanFieldOverride(raw) || {};

  return {
    tag: type === 'textarea' || type === 'select' ? type : 'input',
    type,
    name: str(raw.name, 60) || null,
    label,
    placeholder: null,
    constraints: {
      ...(over.required !== undefined ? { required: over.required } : {}),
      ...(over.maxLength !== undefined ? { maxLength: over.maxLength } : {}),
      ...(over.minLength !== undefined ? { minLength: over.minLength } : {}),
    },
    rule: over.rule || null,
    testValue: over.testValue || null,
    note: over.note || null,
    source: 'user-added',
  };
}

/**
 * 인벤토리에 오버라이드를 적용한 **새 인벤토리**를 만든다 (원본은 건드리지 않는다).
 *
 * @param {object} inventory /api/analyze-url 이 준 인벤토리
 * @param {object} overrides { forms: [{ condition, fields: {index: {...}}, addedFields: [...] }] }
 * @returns {{inventory: object, applied: {fields: number, added: number, conditions: number}}}
 */
function applyOverrides(inventory, overrides) {
  const forms = (inventory.interaction && inventory.interaction.forms) || [];
  const rawForms = (overrides && overrides.forms) || {};
  const applied = { fields: 0, added: 0, conditions: 0 };

  const nextForms = forms.slice(0, LIMITS.forms).map((form, fi) => {
    const ov = rawForms[fi] || rawForms[String(fi)] || {};

    const condition = str(ov.condition);
    if (condition) applied.conditions += 1;

    const fieldOverrides = ov.fields || {};
    const fields = form.fields.slice(0, LIMITS.fieldsPerForm).map((field, xi) => {
      const o = cleanFieldOverride(fieldOverrides[xi] || fieldOverrides[String(xi)]);
      if (!o) return field;

      // 직접 추가한 필드는 added 로 세므로 fields 에서 중복 집계하지 않는다
      if (field.source !== 'user-added') applied.fields += 1;
      return {
        ...field,
        constraints: {
          ...field.constraints,
          // QA 가 지정한 값이 페이지 값보다 우선한다 (실제 규칙을 아는 쪽이 QA 이므로)
          ...(o.required !== undefined ? { required: o.required } : {}),
          ...(o.maxLength !== undefined ? { maxLength: o.maxLength } : {}),
          ...(o.minLength !== undefined ? { minLength: o.minLength } : {}),
        },
        rule: o.rule || field.rule || null,
        testValue: o.testValue || field.testValue || null,
        note: o.note || field.note || null,
        // 직접 추가한 필드는 조건을 덧붙여도 '추가' 출처를 유지한다
        source: field.source === 'user-added' ? 'user-added' : 'user',
      };
    });

    const added = (Array.isArray(ov.addedFields) ? ov.addedFields : [])
      .slice(0, LIMITS.addedPerForm)
      .map(cleanAddedField)
      .filter(Boolean);
    applied.added += added.length;
    // 앞선 재생성에서 이미 인벤토리에 들어간 추가 필드도 함께 센다
    applied.added += form.fields.filter((f) => f.source === 'user-added').length;

    const allFields = fields.concat(added);

    return {
      ...form,
      condition: condition || form.condition || null,
      fields: allFields,
      // 필드 추가로 성격이 바뀔 수 있어 다시 판정한다
      kind: allFields.some((f) => f.type === 'password') ? 'login'
        : allFields.some((f) => f.type === 'search' || /^(q|query|keyword|search|sword|kw)$/i.test(f.name || '')) ? 'search'
          : form.kind,
      hasFileUpload: allFields.some((f) => f.type === 'file'),
    };
  });

  return {
    inventory: {
      ...inventory,
      interaction: {
        ...inventory.interaction,
        forms: nextForms,
        hasLogin: nextForms.some((f) => f.kind === 'login'),
        hasSearch: nextForms.some((f) => f.kind === 'search'),
        hasUpload: nextForms.some((f) => f.hasFileUpload),
      },
    },
    applied,
  };
}

/**
 * 클라이언트가 보낸 인벤토리를 최소한으로 검증한다.
 * (TC 문구를 만드는 데만 쓰이므로 형태만 확인하고 크기를 제한한다.)
 */
function sanitizeInventory(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('분석 결과(inventory)가 필요합니다.');
  const page = raw.page || {};
  if (!page.url || typeof page.url !== 'string') throw new Error('분석 결과에 페이지 주소가 없습니다.');

  const interaction = raw.interaction || {};
  const forms = Array.isArray(interaction.forms) ? interaction.forms : [];

  return {
    page: {
      url: str(page.url, 2000),
      title: str(page.title, 200),
      description: str(page.description, 400),
      lang: str(page.lang, 20),
      hasViewport: Boolean(page.hasViewport),
      viewport: str(page.viewport, 200),
      textLength: num(page.textLength) || 0,
    },
    structure: {
      headings: Array.isArray(raw.structure && raw.structure.headings)
        ? raw.structure.headings.slice(0, 40).map((h) => ({ level: num(h.level) || 2, text: str(h.text, 120) }))
        : [],
      sections: num(raw.structure && raw.structure.sections) || 0,
      tables: num(raw.structure && raw.structure.tables) || 0,
      lists: num(raw.structure && raw.structure.lists) || 0,
      iframes: num(raw.structure && raw.structure.iframes) || 0,
      media: num(raw.structure && raw.structure.media) || 0,
    },
    interaction: {
      forms: forms.slice(0, LIMITS.forms).map((f, i) => ({
        index: i + 1,
        name: str(f.name, 80) || `폼 ${i + 1}`,
        action: str(f.action, 500) || '(현재 주소)',
        method: str(f.method, 10) || 'GET',
        kind: ['login', 'search', 'generic'].includes(f.kind) ? f.kind : 'generic',
        // 이미 지정된 QA 선행 조건은 재생성 왕복에서 잃지 않도록 보존한다
        condition: str(f.condition, 300),
        outsideForm: Boolean(f.outsideForm),
        hasFileUpload: Boolean(f.hasFileUpload),
        submits: Array.isArray(f.submits) ? f.submits.slice(0, 10).map((s) => str(s, 40)).filter(Boolean) : [],
        fields: (Array.isArray(f.fields) ? f.fields : []).slice(0, LIMITS.fieldsPerForm).map((x) => ({
          tag: str(x.tag, 20) || 'input',
          type: SAFE_TYPES.has(String(x.type)) ? String(x.type) : 'text',
          name: str(x.name, 60),
          label: str(x.label, 80) || '이름 없는 필드',
          placeholder: str(x.placeholder, 120),
          options: num(x.options),
          // QA 가 넣은 규칙/테스트 값/비고와 출처도 왕복에서 보존한다
          rule: str(x.rule, 300),
          testValue: str(x.testValue, 200),
          note: str(x.note, 300),
          source: x.source === 'user-added' ? 'user-added' : (x.source === 'user' ? 'user' : null),
          constraints: (() => {
            const c = (x.constraints && typeof x.constraints === 'object') ? x.constraints : {};
            const o = {};
            if (bool(c.required)) o.required = true;
            if (num(c.maxLength) !== null) o.maxLength = num(c.maxLength);
            if (num(c.minLength) !== null) o.minLength = num(c.minLength);
            if (num(c.max) !== null) o.max = num(c.max);
            if (num(c.min) !== null) o.min = num(c.min);
            if (str(c.pattern)) o.pattern = str(c.pattern);
            if (str(c.accept)) o.accept = str(c.accept);
            if (bool(c.readonly)) o.readonly = true;
            if (bool(c.disabled)) o.disabled = true;
            return o;
          })(),
        })),
      })),
      buttons: Array.isArray(interaction.buttons)
        ? interaction.buttons.slice(0, 40).map((b) => str(b, 40)).filter(Boolean) : [],
      buttonCount: num(interaction.buttonCount) || 0,
      hasLogin: Boolean(interaction.hasLogin),
      hasSearch: Boolean(interaction.hasSearch),
      hasUpload: Boolean(interaction.hasUpload),
    },
    links: {
      internalCount: num(raw.links && raw.links.internalCount) || 0,
      externalCount: num(raw.links && raw.links.externalCount) || 0,
      internal: Array.isArray(raw.links && raw.links.internal)
        ? raw.links.internal.slice(0, 30).map((l) => ({
          label: str(l.label, 60), path: str(l.path, 300), href: str(l.href, 500),
        })) : [],
      externalHosts: Array.isArray(raw.links && raw.links.externalHosts)
        ? raw.links.externalHosts.slice(0, 15).map((h) => str(h, 120)).filter(Boolean) : [],
      problems: {
        emptyHref: num(raw.links && raw.links.problems && raw.links.problems.emptyHref) || 0,
        javascriptHref: num(raw.links && raw.links.problems && raw.links.problems.javascriptHref) || 0,
        noTextLink: num(raw.links && raw.links.problems && raw.links.problems.noTextLink) || 0,
        targetBlankNoRel: num(raw.links && raw.links.problems && raw.links.problems.targetBlankNoRel) || 0,
      },
    },
    accessibility: {
      images: num(raw.accessibility && raw.accessibility.images) || 0,
      missingAlt: num(raw.accessibility && raw.accessibility.missingAlt) || 0,
      langMissing: Boolean(raw.accessibility && raw.accessibility.langMissing),
      emptyLinks: num(raw.accessibility && raw.accessibility.emptyLinks) || 0,
      unlabeledLinks: num(raw.accessibility && raw.accessibility.unlabeledLinks) || 0,
    },
    rendering: {
      scripts: num(raw.rendering && raw.rendering.scripts) || 0,
      jsRendered: Boolean(raw.rendering && raw.rendering.jsRendered),
      note: str(raw.rendering && raw.rendering.note, 400),
    },
  };
}

module.exports = { applyOverrides, sanitizeInventory, cleanFieldOverride, cleanAddedField, LIMITS };
