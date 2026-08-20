# SpecToTC — 기획서(SRS) 기반 테스트케이스 자동 생성기

기획서 텍스트를 붙여넣으면 **Pass / Fail / Edge Case** 3종 테스트케이스를 자동으로 만들어 주는 QA 도구입니다.
규칙 엔진(정규식·키워드·경계값 추출)이 기본 동작이고, `ANTHROPIC_API_KEY` 가 있으면 Claude 보강이 추가로 붙습니다.

```
기획서 텍스트 ──▶ 파서(요구사항/조건절/경계값 추출) ──▶ 규칙 엔진(TC 생성) ──▶ 대시보드 / JSON / CSV
                                                      └▶ (선택) Claude 보강
```

---

## 1. 빠른 시작

```bash
npm install
npm start
```

브라우저에서 <http://localhost:3000> → **샘플 불러오기** → **테스트케이스 생성**.

Claude 보강까지 쓰려면:

```bash
cp .env.example .env   # .env 에 ANTHROPIC_API_KEY 입력
npm run start:env
```

테스트:

```bash
npm test
```

---

## 2. 디렉터리 구조

```
SpecToTC/
├── server.js                 로컬 실행 엔트리 (express listen)
├── api/index.js              Vercel Serverless Function 엔트리 (동일 앱 재사용)
├── src/
│   ├── app.js                Express 앱 + REST 라우트
│   ├── engine/
│   │   ├── dictionary.js     다국어(한/영) 키워드·비교연산자·단위 사전  ← 규칙 튜닝 지점
│   │   ├── parser.js         문서 → 요구사항/조건절/경계값 파싱
│   │   ├── generator.js      요구사항 → Pass/Fail/Edge TC 생성 + 중요도 산정
│   │   └── index.js          generateFromSpec()
│   ├── csv.js                CSV 변환 (UTF-8 BOM, 수식 인젝션 방지)
│   ├── diff.js               기획서 변경분 추출 + 회귀 TC 생성
│   └── ai.js                 선택적 Claude 보강 (claude-opus-5)
├── public/                   대시보드 (index.html / dashboard.css / dashboard.js)
├── samples/sample-srs.md     샘플 기획서
├── test/run.js               의존성 없는 테스트 러너 (23 케이스)
└── vercel.json               Vercel 배포 설정
```

---

## 3. 규칙 엔진이 감지하는 것

### 3.1 조건문 패턴

| 유형 | 한글 | 영문 |
|---|---|---|
| 조건 분기 | `~일 때`, `~하면`, `~인 경우`, `성공 시` | `if`, `when`, `once`, `in case of` |
| 경계값 | `8자 이상`, `20자 이하`, `50,000원 이상`, `최대 12자`, `3초 이내`, `8~20자` | `at least 8`, `up to 5`, `no more than 10`, `within 3 seconds`, `>= 10` |
| 재시도 | `재시도`, `재전송`, `최대 2회 재시도` | `retry up to 3 times`, `backoff` |
| 이탈 처리 | `이탈`, `중단`, `타임아웃`, `세션 만료` | `abort`, `cancel`, `timeout`, `drop-off` |

그 외 카테고리: 인증/권한, 입력 검증, 오류 처리, 결제, 개인정보, 삭제, 성능, 화면 이동, 노출, 목록/검색, 파일, 알림, 상태 저장.
전체 사전은 [`src/engine/dictionary.js`](src/engine/dictionary.js) 한 파일에 모여 있어 사내 용어를 여기에 추가하면 바로 반영됩니다.

### 3.2 생성 규칙

- **[Pass]** 조건 충족 → 명세된 동작이 정상 수행되는 흐름. 상태 저장/알림 카테고리가 있으면 재진입·발송 확인 TC 추가.
- **[Fail]** 조건 미충족 케이스 + 카테고리별 실패 레시피(필수값 미입력, 미인증/권한 없음, 결제 승인 실패, 확장자·용량 초과, 중도 이탈/타임아웃, 5xx 등). 감지된 카테고리가 없으면 네트워크 단절 케이스로 대체.
- **[Edge Case]** 추출된 경계값마다 **경계 외부 / 경계 정확값 / 경계 내부** 3점을 한 TC 로 묶어 검증. 재시도 상한(N회 소진·초과), 저속 네트워크, 목록 0건/1건/페이지경계/대량, 이탈 후 재진입, 멱등성(따닥) 케이스.

### 3.3 중요도(High / Med / Low)

카테고리 가중치 합 + 유형 보정(Fail +2, Edge +1, 경계값 +1)으로 점수를 내고 `>=10 High`, `>=5 Med`, 그 외 `Low`.
결제·개인정보·삭제(6) > 인증·검증·오류·재시도·이탈(4) > 경계값·성능·파일·알림·상태(3) > 조건·이동·목록(2) > 노출(1).
가중치와 임계값은 `dictionary.js` 의 `weight`, `generator.js` 의 `calcPriority()` 에서 조정합니다.

> 기획서 성격에 따라 High 비중이 커질 수 있습니다(로그인·결제 중심 문서는 대부분 High 로 수렴). 팀 기준에 맞게 임계값을 조정하세요.

---

## 4. REST API

모든 응답은 `application/json` (CSV 제외), 실패 시 `{ "ok": false, "error": "..." }`.

### `POST /api/generate-tc`

```jsonc
// 요청
{
  "specText": "- 비밀번호는 8자 이상 20자 이하로 입력해야 한다.",
  "useAI": false,                 // true + ANTHROPIC_API_KEY 있을 때만 Claude 보강
  "aiLimit": 12,
  "options": {
    "includePass": true,
    "includeFail": true,
    "includeEdge": true,
    "maxFailPerRequirement": 3,
    "maxEdgePerRequirement": 2,
    "idPrefix": "TC"
  }
}
```

```jsonc
// 응답 (발췌)
{
  "ok": true,
  "elapsedMs": 12,
  "areas": ["1. 로그인"],
  "requirements": [
    { "id": "REQ-001", "area": "1. 로그인", "line": 1, "text": "비밀번호는 8자 이상 20자 이하로 입력해야 한다",
      "lang": "ko", "categories": ["THRESHOLD", "AUTH"], "condition": null,
      "constraints": [{ "value": 8, "unit": "글자", "op": ">=", "source": "8자 이상" }], "retryCount": null }
  ],
  "testCases": [
    {
      "tc_id": "TC-E-001",
      "requirement_id": "REQ-001",
      "area": "1. 로그인",
      "type": "Edge Case",
      "scenario": "[경계값] 8글자 이상 기준 경계 검증 — 1. 로그인",
      "precondition": "대상 영역: 1. 로그인 / 테스트 계정·데이터 준비 완료 / 기준값: 8글자 이상",
      "steps": ["입력값 7글자 (경계 외부)로 동작을 수행한다.", "..."],
      "expected": "7글자 → 거부(유효성 오류 안내) / 8글자 → 허용(정상 처리) / 9글자 → 허용(정상 처리)",
      "priority": "High",
      "categories": ["경계값/임계치", "인증/권한"],
      "tags": ["boundary"],
      "source_text": "비밀번호는 8자 이상 20자 이하로 입력해야 한다",
      "source_line": 1,
      "origin": "rule"
    }
  ],
  "summary": { "total": 99, "byType": { "Pass": 31, "Fail": 40, "Edge Case": 28 },
               "byPriority": { "High": 64, "Med": 26, "Low": 9 }, "byArea": { "...": 24 },
               "parse": { "requirements": 23, "areas": 5, "withConstraints": 9 } },
  "ai": { "requested": false, "enabled": false }
}
```

### `POST /api/export-csv`

`testCases` 배열을 보내면 그대로 CSV 로, `specText` 만 보내면 생성까지 한 번에 처리합니다.

```jsonc
{ "testCases": [ /* ... */ ], "excel": true, "bom": true, "fileName": "로그인-TC.csv" }
```

| 파라미터 | 기본값 | 의미 |
|---|---|---|
| `bom` | `true` | UTF-8 BOM 부착. **Excel 한글 깨짐 방지의 핵심.** BOM 을 거부하는 외부 시스템(TestRail·Jira import 등)에 넣을 때만 `false`. |
| `excel` | `true` | 줄바꿈 `CRLF`. `false` 면 `LF`. BOM 여부와는 무관. |

대시보드의 **CSV (Excel용·권장)** 버튼이 `bom: true` + `CRLF`, **CSV (BOM 없음·연동용)** 버튼이 `bom: false` + `LF` 입니다.
컬럼: `TC_ID, 요구사항 ID, 요구사항 영역, 유형, 테스트 시나리오, 사전 조건, 수행 단계, 기대 결과, 중요도, 분류, 태그, 근거 문장, 원문 라인, 생성 방식`
(양식 변경은 `src/csv.js` 의 `COLUMNS` 배열만 수정하면 됩니다.)

### `POST /api/diff-check`

```jsonc
{ "oldText": "- 비밀번호는 8자 이상이다.", "newText": "- 비밀번호는 12자 이상이다.",
  "threshold": 0.55, "generateTestCases": true, "includeUnchanged": false }
```

Dice 계수 유사도로 문장을 매칭해 **추가 / 수정 / 삭제 / 동일**로 분류하고, 수정 건은 무엇이 바뀌었는지(경계값·재시도 횟수·조건절·분류·영역) 문장으로 알려줍니다.
변경·추가된 요구사항에 대해서만 `regressionTestCases`(태그 `regression`)를 생성하므로, 기획 변경 시 회귀 범위를 바로 잡을 수 있습니다.

### 기타

- `GET /api/health` — 버전, Node 버전, AI 활성 여부
- `GET /api/sample` — 샘플 기획서 텍스트

### cURL 예시

한글이 포함된 본문은 **UTF-8 파일로 저장해서 보내는 것**을 권장합니다. Windows 터미널(Git Bash·cmd)에서 인라인 문자열로 보내면 CP949 로 전송돼 한글 키워드가 매칭되지 않고 TC 가 0건이 될 수 있습니다.

```bash
curl -s -X POST http://localhost:3000/api/generate-tc -H "Content-Type: application/json" --data-binary @request.json
```

---

## 5. 대시보드

- **좌측** — 기획서 입력(⌘/Ctrl + Enter 로 생성), Pass/Fail/Edge 포함 여부, Claude 보강 토글, 샘플 불러오기 / 기획서 비교 탭
- **우측** — TC 테이블(중요도별 좌측 색상 바 + 배지), 유형 칩 필터, 중요도·영역 셀렉트, 시나리오/기대결과 검색
- **내보내기** — CSV(Excel용·권장) / CSV(BOM 없음·연동용) / JSON. 필터가 적용된 현재 목록만 내려갑니다.
  Excel 로 열 때는 반드시 **CSV (Excel용·권장)** 을 사용하세요. 연동용 파일은 BOM 이 없어 Excel 이 CP949 로 잘못 해석해 한글이 깨집니다.
- 비교 탭에서 실행하면 우측 표가 회귀 대상 TC 로 교체됩니다.

---

## 6. Vercel 배포

```bash
git add -A
git commit -m "feat: SpecToTC 초기 구현"
git push -u origin main
```

1. [vercel.com/new](https://vercel.com/new) → 이 저장소 Import
2. Framework Preset: **Other** (`vercel.json` 이 이미 지정)
3. Claude 보강을 쓸 경우 Project Settings → Environment Variables → `ANTHROPIC_API_KEY` 등록 후 Redeploy
4. Deploy → `https://<프로젝트>.vercel.app` 에서 대시보드, `/api/health` 로 상태 확인

배포 구성 요약:

- `public/` → 정적 대시보드 (`outputDirectory`)
- `/api/*` → `api/index.js` 하나의 Serverless Function 으로 rewrite (Express 앱 그대로 재사용)
- `samples/**` 는 `includeFiles` 로 함수 번들에 포함 (`/api/sample` 용)
- `/api/*` 응답은 `no-store`

`main` 브랜치 push 는 Production, PR 은 Preview 배포로 자동 반영됩니다.

---

## 7. Claude 보강 (선택)

`ANTHROPIC_API_KEY` 가 설정되고 `useAI: true` 인 요청에서만 동작합니다.

- 모델: `claude-opus-5` (`SPECTOTC_MODEL` 로 변경 가능), adaptive thinking + effort `high`, 스트리밍 수신
- 규칙 엔진이 만든 시나리오 목록을 함께 전달해 **중복을 피하고**, 업무 흐름 전체·상태 조합·데이터 정합성·권한 조합·시간(자정/월말/타임존) 케이스를 추가로 생성
- 기획서에 없어 확인이 필요한 항목은 시나리오 앞에 `[기획확인]` 표기
- 결과 TC 는 `origin: "ai"`, `tc_id` 는 `TC-E-A001` 형태로 구분되며 대시보드에서 `AI` 배지로 표시
- 키가 없거나 SDK 미설치, 응답 파싱 실패 시에도 규칙 엔진 결과는 그대로 반환됩니다(오류 메시지만 `ai.error` 로 전달)

`@anthropic-ai/sdk` 는 `optionalDependencies` 이므로 설치에 실패하더라도 서버는 정상 동작합니다.

---

## 8. 알려진 한계

- 파서는 **문장 단위 규칙 기반**입니다. 표 안에 조건이 흩어져 있거나 이미지·플로우차트로만 표현된 기획은 잡지 못합니다.
- 조건절/동작절 분리는 한국어 어미 패턴에 의존하므로, 만연체 문장에서는 조건이 통째로 동작절에 포함될 수 있습니다.
- 생성된 TC 는 **초안**입니다. QA 가 검토·병합하는 것을 전제로 설계했고, 그래서 모든 TC 에 `source_text`/`source_line`(근거 문장)을 함께 담습니다.
- Diff 는 문장 유사도 기반이라 문단을 크게 재구성한 개정판에서는 `added` + `removed` 로 잡힐 수 있습니다(`threshold` 조정 가능).
