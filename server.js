'use strict';

const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT || 3000);
const app = createApp();

app.listen(PORT, () => {
  console.log(`\n  SpecToTC  ▶  http://localhost:${PORT}`);
  console.log(`  API       ▶  POST /api/generate-tc | /api/export-csv | /api/diff-check`);
  console.log(`  AI 보강   ▶  ${process.env.ANTHROPIC_API_KEY ? '활성 (ANTHROPIC_API_KEY 감지)' : '비활성 (규칙 엔진만 사용)'}\n`);
});
