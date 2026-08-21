'use strict';

const { createApp } = require('./src/app');
const auth = require('./src/auth');

const PORT = Number(process.env.PORT || 3000);
const app = createApp();

app.listen(PORT, () => {
  console.log(`\n  SpecToTC  ▶  http://localhost:${PORT}`);
  console.log(`  API       ▶  POST /api/generate-tc | /api/summarize | /api/export-csv | /api/diff-check`);
  console.log(`  로그인    ▶  ${auth.isEnabled()
    ? `활성 (공용 비밀번호 · 세션 ${auth.sessionHours()}시간)`
    : '비활성 — SPECTOTC_PASSWORD 미설정 (로컬 개발용. 배포 시에는 반드시 설정)'}`);
  console.log(`  AI 보강   ▶  ${process.env.ANTHROPIC_API_KEY ? '활성 (ANTHROPIC_API_KEY 감지)' : '비활성 (규칙 엔진만 사용)'}\n`);
});
