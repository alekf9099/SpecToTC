'use strict';

// Vercel Serverless Function 엔트리 — Express 앱을 그대로 핸들러로 사용한다.
// vercel.json 의 rewrite 가 모든 /api/* 요청을 이 함수로 보낸다.
const { createApp } = require('../src/app');

module.exports = createApp();
