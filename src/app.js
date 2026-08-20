'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const { generateFromSpec } = require('./engine');
const { summarize } = require('./engine/generator');
const { diffSpecs } = require('./diff');
const { toCsv, csvFileName } = require('./csv');
const ai = require('./ai');

const MAX_SPEC_LENGTH = Number(process.env.SPECTOTC_MAX_SPEC || 300000);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SAMPLE_PATH = path.join(__dirname, '..', 'samples', 'sample-srs.md');

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

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: false, limit: '4mb' }));

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    next();
  });

  /* ------------------------------------------------------------- health */
  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      service: 'SpecToTC',
      version: require('../package.json').version,
      node: process.version,
      ai: { enabled: ai.isEnabled(), model: ai.MODEL },
      time: new Date().toISOString(),
    });
  });

  /* ------------------------------------------------------- 샘플 기획서 */
  app.get('/api/sample', (req, res) => {
    fs.readFile(SAMPLE_PATH, 'utf8', (err, data) => {
      if (err) return res.status(404).json({ ok: false, error: '샘플 기획서를 찾을 수 없습니다.' });
      res.json({ ok: true, specText: data });
    });
  });

  /* ---------------------------------------------------- TC 생성 (메인) */
  app.post('/api/generate-tc', async (req, res) => {
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
      ai: { requested: Boolean(req.body && req.body.useAI), enabled: false },
    };

    if (req.body && req.body.useAI) {
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

    res.json(response);
  });

  /* ----------------------------------------------------- CSV 내보내기 */
  app.post('/api/export-csv', (req, res) => {
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
    res.send(csv);
  });

  /* ------------------------------------------------------- 기획서 diff */
  app.post('/api/diff-check', (req, res) => {
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

    res.json({ ok: true, generatedAt: new Date().toISOString(), ...result });
  });

  /* ---------------------------------------------------------- 정적 파일 */
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: `없는 API 경로: ${req.method} ${req.originalUrl}` }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[SpecToTC] unhandled error:', err);
    res.status(500).json({ ok: false, error: err.message || '서버 내부 오류' });
  });

  return app;
}

module.exports = { createApp };
