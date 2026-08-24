'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const { generateFromSpec, parseDocument } = require('./engine');
const { summarize } = require('./engine/generator');
const { diffSpecs } = require('./diff');
const { summarizeSpec } = require('./summary');
const { toCsv, csvFileName } = require('./csv');
const { extractText, MAX_BYTES: MAX_UPLOAD } = require('./extract');
const { domSupport } = require('./extract/pdf');
const { fetchPage } = require('./web/fetchPage');
const { buildInventory } = require('./web/inventory');
const { buildWebTestCases } = require('./web/webTestCases');
const { buildWebSummary } = require('./web/webSummary');
const auth = require('./auth');
const { limiter } = require('./ratelimit');
const ai = require('./ai');

const MAX_SPEC_LENGTH = Number(process.env.SPECTOTC_MAX_SPEC || 300000);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SAMPLE_PATH = path.join(__dirname, '..', 'samples', 'sample-srs.md');

/** 인증 없이 접근 가능한 경로 — 로그인 화면과 그 화면이 필요한 리소스만 */
const PUBLIC_PATHS = new Set([
  '/login.html', '/login',
  '/dashboard.css',
  '/robots.txt', '/favicon.ico',
  '/api/login', '/api/health',
]);

function badRequest(res, message) {
  return res.status(400).json({ ok: false, error: message });
}

function readSpecText(body, field = 'specText') {
  const value = body && (body[field] ?? body.text ?? body.spec);
  if (typeof value !== 'string' || !value.trim()) return { error: `${field} (기획서 텍스트)가 비어 있습니다.` };
  if (value.length > MAX_SPEC_LENGTH) return { error: `기획서가 너무 깁니다. 최대 ${MAX_SPEC_LENGTH}자까지 지원합니다.` };
  return { value };
}

/** 요청 body 의 options 를 화이트리스트로 정리 */
function pickGeneratorOptions(raw = {}) {
  const opt = {};
  ['includePass', 'includeFail', 'includeEdge'].forEach((k) => {
    if (typeof raw[k] === 'boolean') opt[k] = raw[k];
  });
  ['maxFailPerRequirement', 'maxEdgePerRequirement'].forEach((k) => {
    const n = Number(raw[k]);
    if (Number.isInteger(n) && n >= 0 && n <= 10) opt[k] = n;
  });
  if (typeof raw.idPrefix === 'string' && /^[A-Za-z0-9_-]{1,12}$/.test(raw.idPrefix)) opt.idPrefix = raw.idPrefix;
  return opt;
}

/* --------------------------------------------------------------- AI 게이트 */

/**
 * AI 보강은 비용이 발생하므로 인증 외에 별도 잠금을 둔다.
 *   SPECTOTC_AI_ENABLED=false  → 키가 있어도 AI 기능 차단
 *   SPECTOTC_AI_TOKEN=...      → 설정 시 X-AI-Token 헤더가 일치해야 허용
 */
function aiGate(req) {
  if (process.env.SPECTOTC_AI_ENABLED === 'false') {
    return { allowed: false, error: 'AI 보강이 서버 설정으로 비활성화되어 있습니다 (SPECTOTC_AI_ENABLED=false).' };
  }
  const required = (process.env.SPECTOTC_AI_TOKEN || '').trim();
  if (required && req.get('X-AI-Token') !== required) {
    return { allowed: false, error: 'AI 보강에는 별도 토큰(X-AI-Token)이 필요합니다.' };
  }
  return { allowed: true };
}

/* ------------------------------------------------------------------ 로깅 */

/**
 * 기획서 본문이 로그에 남지 않도록 메타데이터만 기록한다.
 * (에러 메시지에 문서 조각이 섞여 들어오는 경우가 있어 본문 계열은 절대 넣지 않는다.)
 */
function logMeta(event, fields = {}) {
  if (process.env.SPECTOTC_QUIET === 'true') return;
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`[SpecToTC] ${event}${parts ? ` ${parts}` : ''}`);
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  /* --------------------------------------------------- 공통 보안 헤더 */
  app.use((req, res, next) => {
    // 사내 도구이므로 검색 엔진 색인·크롤링을 전면 차단한다.
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Frame-Options', 'DENY');
    next();
  });

  /* ---- 인증을 필수로 요구했는데(SPECTOTC_REQUIRE_AUTH=true) 비밀번호가 없을 때 */
  // 기본 동작은 "인증 없이 열림" 이다. 이 잠금은 명시적으로 옵트인한 경우에만 걸린다.
  app.use((req, res, next) => {
    if (!auth.isMisconfigured()) return next();
    res.status(503).json({
      ok: false,
      error: 'SPECTOTC_REQUIRE_AUTH=true 인데 SPECTOTC_PASSWORD 가 없어 서비스를 잠갔습니다. '
        + '비밀번호를 등록하거나 SPECTOTC_REQUIRE_AUTH 를 해제해 주세요.',
    });
  });

  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: false, limit: '4mb' }));

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    next();
  });

  /* ------------------------------------------------------------- 로그인 */
  // 무작위 대입을 막기 위해 로그인만 별도의 좁은 한도를 준다.
  app.post('/api/login',
    limiter({ name: 'login', limit: 10, windowMs: 15 * 60 * 1000, message: '로그인 시도가 너무 많습니다.' }),
    (req, res) => {
      if (!auth.isEnabled()) {
        return res.json({ ok: true, authRequired: false, message: '이 서버는 인증이 비활성화되어 있습니다.' });
      }
      const supplied = req.body && req.body.password;
      if (!auth.verifyPassword(supplied)) {
        logMeta('login.failed', { ip: req.ip });
        return res.status(401).json({ ok: false, error: '비밀번호가 올바르지 않습니다.' });
      }
      auth.setSessionCookie(req, res);
      logMeta('login.ok', { hours: auth.sessionHours() });
      res.json({ ok: true, authRequired: true, expiresInHours: auth.sessionHours() });
    });

  app.post('/api/logout', (req, res) => {
    auth.clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  /* ------------------------------------------------------------- health */
  // 모니터링용으로 인증 없이 열어두되, 미인증 상태에서는 최소 정보만 노출한다.
  app.get('/api/health', (req, res) => {
    const base = {
      ok: true,
      service: 'SpecToTC',
      version: require('../package.json').version,
      auth: { required: auth.isEnabled(), authenticated: auth.isAuthenticated(req) },
      time: new Date().toISOString(),
    };
    if (!auth.isAuthenticated(req)) return res.json(base);

    res.json({
      ...base,
      node: process.version,
      ai: {
        enabled: ai.isEnabled() && aiGate(req).allowed,
        model: ai.MODEL,
        tokenRequired: Boolean((process.env.SPECTOTC_AI_TOKEN || '').trim()),
      },
      upload: { maxBytes: MAX_UPLOAD, formats: ['.md', '.txt', '.pdf', '.docx'] },
      // PDF 처리에 쓰는 DOM 구현 — "DOMMatrix is not defined" 류 문제를 바로 진단하기 위한 정보
      pdf: { dom: domSupport().source, nativeCanvas: domSupport().native, worker: domSupport().worker },
      sessionHours: auth.sessionHours(),
    });
  });

  /* -------------------------------------------------------- 인증 게이트 */
  app.use((req, res, next) => {
    if (!auth.isEnabled()) return next();
    if (PUBLIC_PATHS.has(req.path)) return next();
    if (auth.isAuthenticated(req)) return next();

    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ ok: false, error: '로그인이 필요합니다.', loginUrl: '/login.html' });
    }
    // 화면 요청이면 로그인 페이지로 보내고, 로그인 후 원래 경로로 돌려보낸다.
    const next_ = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(302, `/login.html?next=${next_}`);
  });

  /* --------------------------------------------- 여기부터는 인증된 요청 */

  const readLimiter = limiter({ name: 'read', limit: 120, windowMs: 60 * 1000 });
  const generateLimiter = limiter({ name: 'generate', limit: 60, windowMs: 60 * 1000 });
  const uploadLimiter = limiter({
    name: 'upload', limit: 20, windowMs: 60 * 1000,
    message: '업로드 요청이 너무 많습니다.',
  });
  const aiLimiter = limiter({
    name: 'ai', limit: 12, windowMs: 60 * 60 * 1000,
    message: 'AI 보강 요청 한도를 초과했습니다.',
  });

  /** useAI 요청일 때만 AI 한도를 적용 */
  const maybeAiLimit = (req, res, next) => (req.body && req.body.useAI ? aiLimiter(req, res, next) : next());

  /* ------------------------------------------------------- 샘플 기획서 */
  app.get('/api/sample', readLimiter, (req, res) => {
    fs.readFile(SAMPLE_PATH, 'utf8', (err, data) => {
      if (err) return res.status(404).json({ ok: false, error: '샘플 기획서를 찾을 수 없습니다.' });
      res.json({ ok: true, specText: data });
    });
  });

  /* ------------------------------------------------- 파일 → 기획서 텍스트 */
  // 멀티파트 대신 raw 바디 + X-File-Name 헤더를 쓴다.
  // 브라우저에서 fetch(file) 로 File 객체를 그대로 body 에 실을 수 있어 파서 의존성이 없다.
  app.post('/api/extract-text',
    uploadLimiter,
    express.raw({ type: () => true, limit: `${Math.ceil(MAX_UPLOAD / 1024 / 1024)}mb` }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return badRequest(res, '업로드된 파일 본문이 비어 있습니다.');
      }

      let fileName = 'upload';
      const header = req.get('X-File-Name');
      if (header) {
        try {
          fileName = path.basename(decodeURIComponent(header));
        } catch (err) {
          fileName = path.basename(header);
        }
      }

      const started = Date.now();
      try {
        const { text, meta } = await extractText(req.body, fileName);
        const truncated = text.length > MAX_SPEC_LENGTH;
        // 파일명·본문은 남기지 않고 형식/크기/시간만 기록한다.
        logMeta('extract.ok', { kind: meta.kind, bytes: meta.bytes, chars: text.length, ms: Date.now() - started });
        res.json({
          ok: true,
          specText: truncated ? text.slice(0, MAX_SPEC_LENGTH) : text,
          meta: { ...meta, chars: text.length, truncated },
        });
      } catch (err) {
        logMeta('extract.failed', { bytes: req.body.length, ms: Date.now() - started });
        badRequest(res, err.message);
      }
    });

  /* ---------------------------------------------------- TC 생성 (메인) */
  app.post('/api/generate-tc', generateLimiter, maybeAiLimit, async (req, res) => {
    const { value: specText, error } = readSpecText(req.body || {});
    if (error) return badRequest(res, error);

    const options = pickGeneratorOptions((req.body && req.body.options) || {});
    const started = Date.now();
    const result = generateFromSpec(specText, options);

    const response = {
      ok: true,
      generatedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      areas: result.areas,
      requirements: result.requirements.map((r) => ({
        id: r.id,
        area: r.area,
        line: r.line,
        text: r.text,
        lang: r.lang,
        categories: r.categories,
        condition: r.condition,
        constraints: r.constraints,
        retryCount: r.retryCount,
      })),
      testCases: result.testCases,
      summary: result.summary,
      specSummary: summarizeSpec({ requirements: result.requirements }, {
        topN: Number((req.body && req.body.summaryTopN)) || 8,
        testCases: result.testCases,
        rawText: specText,
      }),
      ai: { requested: Boolean(req.body && req.body.useAI), enabled: false },
    };

    if (req.body && req.body.useAI) {
      const gate = aiGate(req);
      if (!gate.allowed) {
        response.ai = { requested: true, enabled: false, error: gate.error };
      } else {
        const enriched = await ai.enrichWithClaude(specText, result.testCases, {
          limit: Number(req.body.aiLimit) || 12,
        });
        response.ai = {
          requested: true,
          enabled: enriched.enabled,
          model: enriched.model,
          error: enriched.error,
          added: enriched.testCases.length,
        };
        if (enriched.testCases.length) {
          response.testCases = [...response.testCases, ...enriched.testCases];
          response.summary = { ...summarize(response.testCases), parse: result.summary.parse };
        }
      }
    }

    logMeta('generate.ok', {
      chars: specText.length,
      requirements: result.requirements.length,
      tc: response.testCases.length,
      ai: response.ai.added || 0,
      ms: Date.now() - started,
    });
    res.json(response);
  });

  /* ----------------------------------------------------- CSV 내보내기 */
  app.post('/api/export-csv', generateLimiter, (req, res) => {
    const body = req.body || {};
    let testCases = body.testCases;

    // testCases 대신 기획서 원문만 보내도 바로 CSV 를 받을 수 있게 허용
    if (!Array.isArray(testCases)) {
      const { value: specText, error } = readSpecText(body);
      if (error) return badRequest(res, 'testCases 배열 또는 specText 중 하나는 필요합니다.');
      testCases = generateFromSpec(specText, pickGeneratorOptions(body.options || {})).testCases;
    }
    if (!testCases.length) return badRequest(res, '내보낼 테스트케이스가 없습니다.');

    // bom 은 기본 true (Excel 한글 호환). BOM 을 거부하는 외부 시스템용으로만 false 를 허용한다.
    const csv = toCsv(testCases, { excel: body.excel !== false, bom: body.bom !== false });
    const fileName = /^[\w.\-가-힣]{1,80}$/.test(body.fileName || '') ? body.fileName : csvFileName();

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    logMeta('export.csv', { rows: testCases.length, bytes: Buffer.byteLength(csv) });
    res.send(csv);
  });

  /* --------------------------------------------------- 웹사이트 화면 분석 */
  // 서버가 외부로 요청을 보내므로(SSRF 표면) 한도를 따로 좁게 잡는다.
  const webLimiter = limiter({
    name: 'web', limit: 10, windowMs: 5 * 60 * 1000,
    message: '웹사이트 분석 요청이 너무 많습니다.',
  });

  app.post('/api/analyze-url', webLimiter, async (req, res) => {
    const url = req.body && (req.body.url || req.body.link);
    if (typeof url !== 'string' || !url.trim()) return badRequest(res, '분석할 주소를 입력해 주세요.');

    const started = Date.now();
    let page;
    try {
      page = await fetchPage(url);
    } catch (err) {
      logMeta('web.fetchFailed', { ms: Date.now() - started });
      return badRequest(res, err.message);
    }

    try {
      const inventory = buildInventory(page.html, page.finalUrl);
      const testCases = buildWebTestCases(inventory);
      const summary = buildWebSummary(inventory, testCases);

      logMeta('web.ok', {
        host: new URL(page.finalUrl).hostname,
        bytes: page.bytes,
        forms: inventory.interaction.forms.length,
        tc: testCases.length,
        ms: Date.now() - started,
      });

      res.json({
        ok: true,
        generatedAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        page: {
          url: page.url,
          finalUrl: page.finalUrl,
          status: page.status,
          bytes: page.bytes,
          redirects: page.redirects,
          truncated: page.truncated,
          title: inventory.page.title,
        },
        inventory,
        testCases,
        specSummary: summary,
        summary: summarize(testCases),
        areas: [...new Set(testCases.map((tc) => tc.area))],
      });
    } catch (err) {
      logMeta('web.parseFailed', { ms: Date.now() - started });
      badRequest(res, `페이지를 분석하지 못했습니다: ${err.message}`);
    }
  });

  /* ------------------------------------------------------- 기획서 요약 */
  app.post('/api/summarize', generateLimiter, maybeAiLimit, async (req, res) => {
    const { value: specText, error } = readSpecText(req.body || {});
    if (error) return badRequest(res, error);

    const parsed = parseDocument(specText);
    const topN = Number(req.body && req.body.topN);
    const summary = summarizeSpec(parsed, {
      topN: Number.isInteger(topN) && topN > 0 && topN <= 50 ? topN : 8,
      rawText: specText,
    });

    const response = {
      ok: true,
      generatedAt: new Date().toISOString(),
      summary,
      ai: { requested: Boolean(req.body && req.body.useAI), enabled: false },
    };

    if (req.body && req.body.useAI) {
      const gate = aiGate(req);
      if (!gate.allowed) {
        response.ai = { requested: true, enabled: false, error: gate.error };
      } else {
        const enriched = await ai.summarizeWithClaude(specText, { ruleSummary: summary });
        response.ai = {
          requested: true,
          enabled: enriched.enabled,
          model: enriched.model,
          error: enriched.error,
          summary: enriched.summary,
        };
      }
    }

    logMeta('summarize.ok', { chars: specText.length, requirements: parsed.requirements.length });
    res.json(response);
  });

  /* ------------------------------------------------------- 기획서 diff */
  app.post('/api/diff-check', generateLimiter, (req, res) => {
    const body = req.body || {};
    const oldSpec = readSpecText(body, 'oldText');
    if (oldSpec.error) return badRequest(res, 'oldText (이전 기획서)가 비어 있습니다.');
    const newSpec = readSpecText(body, 'newText');
    if (newSpec.error) return badRequest(res, 'newText (신규 기획서)가 비어 있습니다.');

    const threshold = Number(body.threshold);
    const result = diffSpecs(oldSpec.value, newSpec.value, {
      threshold: Number.isFinite(threshold) && threshold > 0 && threshold < 1 ? threshold : undefined,
      includeUnchanged: Boolean(body.includeUnchanged),
      generateTestCases: body.generateTestCases !== false,
      generatorOptions: pickGeneratorOptions(body.options || {}),
    });

    logMeta('diff.ok', {
      added: result.summary.added, removed: result.summary.removed, modified: result.summary.modified,
    });
    res.json({ ok: true, generatedAt: new Date().toISOString(), ...result });
  });

  /* ---------------------------------------------------------- 정적 파일 */
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: `없는 API 경로: ${req.method} ${req.originalUrl}` }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // JSON 파싱 오류 메시지에는 본문 조각이 섞이므로 로그·응답 모두에서 지운다.
    const isBodyError = err instanceof SyntaxError || err.type === 'entity.parse.failed' || err.type === 'entity.too.large';
    if (isBodyError) {
      logMeta('request.invalidBody', { type: err.type || 'syntax', status: err.status || 400 });
      return res.status(err.status || 400).json({
        ok: false,
        error: err.type === 'entity.too.large' ? '요청 본문이 너무 큽니다.' : '요청 본문(JSON) 형식이 올바르지 않습니다.',
      });
    }

    console.error('[SpecToTC] unhandled error:', err.stack || err.message);
    res.status(500).json({ ok: false, error: '서버 내부 오류가 발생했습니다.' });
  });

  return app;
}

module.exports = { createApp };
