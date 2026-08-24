# SpecToTC — 기획서(SRS) 기반 테스트케이스 자동 생성기

기획서를 붙여넣거나 파일로 올리면 **Pass / Fail / Edge Case** 3종 테스트케이스와 **문서 핵심 요약**을 만들어 주는 QA 도구입니다.
규칙 엔진(정규식·키워드·경계값 추출)이 기본 동작이고, `ANTHROPIC_API_KEY` 가 있으면 Claude 보강이 추가로 붙습니다.

```
.md/.txt/.pdf/.docx ──▶ 텍스트 추출 ──▶ 파서(요구사항·조건절·경계값)
                                          ├─▶ 규칙 엔진 ──▶ TC (Pass/Fail/Edge) ──▶ 대시보드 / JSON / CSV
                                          ├─▶ 요약 엔진 ──▶ 핵심 요구사항 · 수치 기준 · 확인 필요 항목
                                          └─▶ (선택) Claude 보강
```

---

## 1. 빠른 시작

```bash
npm install
npm start
```

브라우저에서 <http://localhost:3000> → **샘플 불러오기** → **테스트케이스 생성**.

로그인은 기본적으로 **비활성**입니다(사내 도구 기준). Claude 보강이나 로그인을 켜려면 `.env` 를 만들고 실행합니다.

```bash
cp .env.example .env   # ANTHROPIC_API_KEY / (선택) SPECTOTC_PASSWORD 입력
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
│   ├── app.js                Express 앱 + REST 라우트 (인증 게이트·레이트리밋 포함)
│   ├── auth.js               공용 비밀번호 + HMAC 서명 세션 쿠키
│   ├── ratelimit.js          의존성 없는 인메모리 레이트리밋
│   ├── engine/
│   │   ├── dictionary.js     다국어(한/영) 키워드·비교연산자·단위 사전  ← 규칙 튜닝 지점
│   │   ├── parser.js         문서 → 요구사항/조건절/경계값 파싱
│   │   ├── generator.js      요구사항 → Pass/Fail/Edge TC + 중요도 산정
│   │   └── index.js          generateFromSpec()
│   ├── summary.js            문서 핵심 요약 (핵심 요구사항·수치 기준·확인 필요)
│   ├── qaPlan.js             QA 검증 분석서 6개 고정 섹션 생성
│   ├── extract/
│   │   ├── index.js          업로드 파일 → 텍스트 (형식 판별·인코딩 처리)
│   │   ├── zip.js            의존성 없는 최소 ZIP 리더 (.docx 용)
│   │   ├── docx.js           .docx → 마크다운 유사 텍스트
│   │   ├── pdf.js            .pdf → 텍스트 (pdfjs-dist, 머리글·바닥글 제거)
│   │   └── domShims.js       Node 용 DOMMatrix/ImageData/Path2D 폴리필
│   ├── csv.js                CSV 변환 (UTF-8 BOM, 수식 인젝션 방지)
│   ├── diff.js               기획서 변경분 추출 + 회귀 TC 생성
│   └── ai.js                 선택적 Claude 보강 (claude-opus-5)
├── public/                   대시보드 (index.html / login.html / dashboard.css / dashboard.js / summary-view.js / qa-plan-view.js / robots.txt)
├── samples/sample-srs.md     샘플 기획서
├── test/run.js               의존성 없는 테스트 러너 (70 케이스)
└── vercel.json               Vercel 배포 설정
```

---

## 3. 접근 제어 — 기본은 인증 없음

사내에서 쓰는 도구라 **기본값은 로그인 없이 열림**입니다. 필요해지면 환경 변수 하나로 켤 수 있습니다.

```bash
# .env — 이 값을 넣는 순간 로그인 화면이 활성화된다
SPECTOTC_PASSWORD=팀에서_정한_비밀번호
SPECTOTC_SESSION_HOURS=12          # 선택, 기본 12시간
SPECTOTC_SESSION_SECRET=랜덤문자열   # 선택, 비우면 비밀번호에서 파생
```

| 설정 | 동작 |
| --- | --- |
| `SPECTOTC_PASSWORD` 비움 **(기본)** | 인증 없이 열림. 서버 배너에 `로그인 ▶ 비활성` 표시 |
| `SPECTOTC_PASSWORD` 설정 | 로그인 화면(`/login.html`) 활성화. 미인증 요청은 화면 302 / API 401 |
| `SPECTOTC_REQUIRE_AUTH=true` 인데 비밀번호 없음 | 설정 오류로 보고 503 (인증을 반드시 켜야 하는 환경용 안전장치) |

로그인을 켰을 때의 동작:

- 비밀번호는 SHA-256 해시를 `timingSafeEqual`로 비교 (타이밍 공격 방지, 길이 노출 없음)
- 세션은 HMAC-SHA256 서명 토큰을 **HttpOnly · SameSite=Lax · Secure(HTTPS)** 쿠키로 발급. JS에서 읽을 수 없음
- 세션 스토어가 없어 서버리스에서 인스턴스가 새로 떠도 검증이 그대로 동작
- 비밀번호를 교체하면 파생 서명 키가 바뀌어 기존 세션이 전부 무효
- `POST /api/login` / `POST /api/logout`, 우측 상단 `로그아웃` 버튼

### 로그인 없이 운영할 때 알아둘 것

인증이 없으면 **URL을 아는 사람은 누구나 사용**할 수 있습니다. 사내 도구로는 흔한 선택이지만, 아래는 그래서 더 중요합니다.

| 항목 | 내용 |
| --- | --- |
| 레이트리밋 | 생성·요약·CSV 60회/분, 업로드 20회/분, **AI 보강 12회/시간**, 로그인 10회/15분 |
| **AI 키 노출 주의** | `ANTHROPIC_API_KEY`를 등록하면 아무나 AI 호출로 크레딧을 소진시킬 수 있습니다. 인증 없이 배포한다면 `SPECTOTC_AI_TOKEN`을 함께 설정하거나 `SPECTOTC_AI_ENABLED=false`로 두는 편이 안전합니다 |
| 검색 엔진 차단 | 모든 응답에 `X-Robots-Tag: noindex, nofollow, noarchive` + `robots.txt` + 페이지 meta |
| 보안 헤더 | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` |
| 로그 위생 | 기획서 본문은 로그에 남기지 않고 메타데이터(형식·바이트·문자 수·처리 시간)만 기록. JSON 파싱 오류 메시지에 섞여 들어오는 본문 조각도 응답·로그에서 제거 |

> ⚠️ 레이트리밋은 인메모리 고정 창 방식입니다. Vercel 함수는 인스턴스가 여러 개 뜨므로 카운터가 인스턴스별로만 유지되고, 동시 인스턴스가 N개면 실효 한도도 N배가 됩니다. 실수·단순 남용·비용 폭증을 막는 1차 방어선으로만 보고, 엄격한 제한이 필요하면 Upstash Redis 같은 외부 저장소로 교체해야 합니다.


---

## 4. 입력 — 붙여넣기 또는 파일 업로드

| 형식 | 처리 방식 |
|---|---|
| `.md` `.txt` 등 텍스트 | UTF-8/UTF-16 BOM 감지, 깨지면 CP949(EUC-KR)로 재디코딩 |
| `.pdf` | `pdfjs-dist` 로 추출 (한글 CID 폰트의 ToUnicode CMap 해석이 필요해 직접 파싱하지 않음). 페이지마다 반복되는 머리글·바닥글, 페이지 번호·인쇄 시각 줄은 자동 제거 |
| `.docx` | 내장 ZIP 리더로 `word/document.xml` 파싱. Word 제목 스타일 → `#`, 목록 문단 → `- `, 표 → `\| 셀 \| 셀 \|` 로 변환해 **문서 구조를 살린 채** 파서에 전달 |
| `.doc` `.hwp` `.hwpx` | 미지원 — `.docx` 또는 PDF 로 다시 저장하라는 안내 메시지 반환 |

- 대시보드에서 **드래그 앤 드롭** 또는 클릭해 파일 선택. 추출이 끝나면 텍스트 영역이 채워지고 TC 생성까지 자동 진행됩니다.
- 확장자가 없거나 잘못돼도 매직 넘버(`%PDF-`, ZIP 시그니처)로 형식을 판별합니다.
- 기본 업로드 상한 25MB (`SPECTOTC_MAX_UPLOAD`), 기획서 텍스트 상한 30만자 (`SPECTOTC_MAX_SPEC`).
- 스캔 이미지 PDF 는 텍스트가 없어 실패합니다(OCR 필요). 이 경우 오류 메시지로 안내합니다.
- 특정 페이지에서 오류가 나면 그 페이지만 건너뛰고 나머지 텍스트를 살립니다 (`meta.failedPages`).
> **PDF 처리와 `DOMMatrix`** — `pdfjs-dist` 는 Node 에서 `DOMMatrix`·`ImageData`·`Path2D` 를
> optionalDependency 인 `@napi-rs/canvas`(네이티브 바이너리)에서 가져옵니다. 그 패키지가 없는 환경
> (다른 OS·arch, `npm i --omit=optional`, 서버리스 번들에 `.node` 가 포함되지 않은 경우)에서는
> pdf.js **import 자체가 실패**해 모든 PDF 업로드가 `DOMMatrix is not defined` 로 끊깁니다.
> 이를 막기 위해 순수 JS 폴리필([`src/extract/domShims.js`](src/extract/domShims.js))을 내장했습니다.
> 네이티브 canvas 가 있으면 그쪽을 우선 쓰고, 없으면 폴리필로 동작합니다.
> 현재 어느 쪽을 쓰는지는 `GET /api/health` 의 `pdf.dom` 으로 확인할 수 있습니다.


---

## 5. 규칙 엔진이 감지하는 것

### 5.1 조건문 패턴

| 유형 | 한글 | 영문 |
|---|---|---|
| 조건 분기 | `~일 때`, `~하면`, `~인 경우`, `성공 시` | `if`, `when`, `once`, `in case of` |
| 경계값 | `8자 이상`, `20자 이하`, `50,000원 이상`, `최대 12자`, `3초 이내`, `8~20자` | `at least 8`, `up to 5`, `no more than 10`, `within 3 seconds`, `>= 10` |
| 재시도 | `재시도`, `재전송`, `최대 2회 재시도` | `retry up to 3 times`, `backoff` |
| 이탈 처리 | `이탈`, `중단`, `타임아웃`, `세션 만료` | `abort`, `cancel`, `timeout`, `drop-off` |

그 외 카테고리: 인증/권한, 입력 검증, 오류 처리, 결제, 개인정보, 삭제, 성능, 화면 이동, 노출, 목록/검색, 파일, 알림, 상태 저장.
전체 사전은 [`src/engine/dictionary.js`](src/engine/dictionary.js) 한 파일에 모여 있어 사내 용어를 여기에 추가하면 바로 반영됩니다.

### 5.2 생성 규칙

- **[Pass]** 조건 충족 → 명세된 동작이 정상 수행되는 흐름. 상태 저장/알림 카테고리가 있으면 재진입·발송 확인 TC 추가.
- **[Fail]** 조건 미충족 케이스 + 카테고리별 실패 레시피(필수값 미입력, 미인증/권한 없음, 결제 승인 실패, 확장자·용량 초과, 중도 이탈/타임아웃, 5xx 등). 감지된 카테고리가 없으면 네트워크 단절 케이스로 대체.
- **[Edge Case]** 추출된 경계값마다 **경계 외부 / 경계 정확값 / 경계 내부** 3점을 한 TC 로 묶어 검증. 재시도 상한(N회 소진·초과), 저속 네트워크, 목록 0건/1건/페이지경계/대량, 이탈 후 재진입, 멱등성(따닥) 케이스.

### 5.3 중요도(High / Med / Low)

카테고리 가중치 합 + 유형 보정(Fail +2, Edge +1, 경계값 +1)으로 점수를 내고 `>=10 High`, `>=5 Med`, 그 외 `Low`.
결제·개인정보·삭제(6) > 인증·검증·오류·재시도·이탈(4) > 경계값·성능·파일·알림·상태(3) > 조건·이동·목록(2) > 노출(1).
가중치와 임계값은 `dictionary.js` 의 `weight`, `generator.js` 의 `calcPriority()` 에서 조정합니다.

> 기획서 성격에 따라 High 비중이 커질 수 있습니다(로그인·결제 중심 문서는 대부분 High 로 수렴). 팀 기준에 맞게 임계값을 조정하세요.

---

## 6. 테스트케이스 구조

**다른 담당자가 표만 보고 그대로 실행할 수 있는가**를 기준으로 설계했습니다.

| 필드 | 설명 |
|---|---|
| `tc_id` | `TC-P-001` / `TC-F-001` / `TC-E-001` (AI 보강분은 `TC-E-A001`) |
| `type` / `priority` / `area` | Pass·Fail·Edge Case / High·Med·Low / 요구사항 영역 |
| `title` | `[정상] 1. 로그인 — 경계값 8글자 이상 전후 판정` — 유형·영역·검증 대상이 한 줄에 |
| `objective` | **이 TC 가 왜 필요한지** 한 문장 (리뷰어가 판단 기준을 잡는 근거) |
| `precondition` | 배열 — 준비물·선행 조건 |
| `steps` | 배열 — `진입:` `준비:` `조건 설정:` `입력:` `실행:` `확인:` 레이블이 붙은 실행 단계 |
| `expected` | 배열 — 검증 포인트를 하나씩 분리 (한 문장에 뭉치지 않음) |
| `requirement` | `{ id, text, line, categories }` — 기획서 원문·라인으로 역추적 |
| `tags` | `boundary` `retry` `spec-gap` `idempotency` 등 |

레이블 방식(`실행: …`)을 쓴 이유는 한국어 조사 문제로 문장이 어색해지는 것을 피하면서 표에서 스캔하기 쉽게 하기 위함입니다.
기존 스크립트·시트 호환을 위해 `scenario`, `requirement_id`, `source_text`, `source_line`, `categories` 평면 필드도 함께 유지합니다.

대시보드 표는 `TC_ID / 유형 / 중요도 / 영역 / 시나리오` 5열로 압축해 보여주고, **행을 클릭하면** 검증 목적·사전 조건·수행 단계·기대 결과·근거 요구사항이 펼쳐집니다.

---

## 7. 문서 요약 (핵심만 골라 보기)

우측 패널의 **문서 요약** 탭. `POST /api/summarize` 또는 `generate-tc` 응답의 `specSummary` 로도 받을 수 있습니다.

| 항목 | 내용 |
|---|---|
| **개요** | 영역·요구사항·조건 분기·수치 기준 수, 언어, 상위 카테고리, TC 커버리지(요구사항당 평균 TC, 미커버 목록) |
| **핵심 요구사항** | 카테고리 가중치 + 제약 보유 여부로 점수를 내 상위 N건 (기본 8건) |
| **수치 기준** | 경계값·재시도 기준을 표로 모아 제공 — 검증 시 그대로 입력값으로 사용 (`8글자 이상`, `10 MB 이하`, `3회`) |
| **확인 필요** | 기획에 물어봐야 하는 것 — 모호 표현(`적절히`, `필요시`, `등`, `빠르게`, `TBD`), 재시도 횟수 누락, 단위 누락, 조건만 있고 실패 처리 없음, 결제에 실패 흐름 없음. 사유별로 묶고 **질문 문장까지** 생성 |
| **영역별 요점** | 영역마다 요구사항 수·주요 카테고리·대표 문장 3건 |

- **요약 마크다운 복사** 버튼으로 회의록·티켓에 바로 붙여넣을 수 있습니다.
- **Claude 서술형 요약** 버튼(`ANTHROPIC_API_KEY` 필요)은 문서가 무엇을 정의하는지, 핵심 흐름과 깨지기 쉬운 지점, 기획 확인 질문, QA 유의사항, 그리고 목표·비목표·반드시 수행할 테스트를 문장으로 추가합니다.
- **요약 탭에서 파일을 직접 올릴 수 있습니다.** 탭 상단 드롭존에 파일을 놓으면 TC 생성 없이 요약·검증 분석서만 만듭니다 (좌측 텍스트 영역도 함께 채워져 이후 TC 생성으로 이어갈 수 있습니다).

### QA 검증 분석서 — 사내 표준 6개 고정 섹션

요약 아래에 검증 담당자가 그대로 쓸 수 있는 분석서가 함께 나옵니다. 섹션 순서·제목은 항상 고정입니다.

| 섹션 | 내용 |
|---|---|
| **1. QC·QA 검증 진행 시 참고해야 할 점** | 6개 관점(권한·역할 경계 / 입력 검증 / 경계조건 / 예외·에러 처리 / 데이터 정합성 / 검증 환경)별로 **"확인할 것 · 왜 · 어떻게"** 표. 이어서 **검증 착수 전 준비 체크리스트**(테스트 계정, 목 서버, 데이터셋, 스로틀링 도구 등) |
| **2. 검증 시 진행해야 할 URL** | 문서에서 URL·경로를 뽑아 화면/기능 · 경로 · 접근 권한 · 핵심 검증 시나리오 표로 정리 |
| **3. 프로젝트 동작 흐름** | mermaid flowchart. Notion·GitHub 에 붙이면 다이어그램으로 렌더 |
| **4. Figma 링크** | 문서의 figma.com 링크. 없으면 정확히 `Figma 링크 없음` |
| **5. 목표가 아닌 것 (Out of Scope)** | `추후` `차기` `미지원` 등으로 언급된 항목 + 문서에 요구사항이 없어 검증 대상이 아닌 영역 |
| **6. 목표 (In Scope)** | 문서의 목적문, 없으면 핵심 요구사항 기반 추론 + "검증 통과 시 보장되는 것" |

- 각 항목에 **근거 표기**가 붙습니다 — `문서 명시`(원문 라인 번호 포함) / `추론` / `(문서에 명시되지 않음 — 확인 필요)`. 지어낸 내용과 문서 근거를 구분하기 위한 것입니다.
- **검증 분석서 마크다운 복사** 버튼으로 Notion·티켓에 그대로 붙여넣을 수 있습니다 (표·mermaid 포함).

**§2 URL 추출이 인식하는 표기**

| 표기 | 예 |
|---|---|
| 마크다운 링크 | `[게시글 상세](https://staging.example.com/board/view/{id})` — 라벨을 화면 이름으로 사용 |
| 마크다운 표 | `| 게시글 목록 | /board/list | 전체 |` — 첫 셀을 화면 이름, 권한 셀(전체·회원·관리자)을 그대로 사용 |
| 라벨 표기 | `URL: /board/list`, `경로: board/list`, `엔드포인트: ...` (슬래시 없이 적어도 인식) |
| HTTP 메서드 | `GET /api/posts`, `POST /api/posts` — 같은 경로는 한 행으로 합치고 메서드를 함께 표기 |
| 스킴 없는 도메인 | `center.muhayu.com/post/view/abc` |
| 절대 URL | `https://staging.example.com/board/list` |

이미지·소스 파일(`.png` `.js` `.pdf` 등)과 Figma 링크는 검증 대상이 아니므로 URL 표에서 제외합니다.
검증 시나리오는 **화면 이름·경로에 맞춰** 추정합니다 — `목록`은 페이징·정렬, `작성`은 입력 검증, `관리`는 권한 경계, `/api/`는 토큰 직접 호출·파라미터 검증.

**§3 흐름 순서**

- 문서에 `1단계` `Step 1` `①` 같은 **단계 표기가 있으면 그 순서대로 직렬 흐름**을 그립니다 (각 단계에 정상/실패 분기).
- 표기가 없으면 영역을 병렬로 배치하고 "실제 화면 전이 순서는 기획 확인이 필요합니다"를 캡션에 남깁니다. 번호가 붙은 절 제목(`1. 로그인`, `2. 주문`)은 기능 목록일 뿐이라 흐름 순서로 단정하지 않습니다.
- 잘못 단정하지 않도록 만든 규칙 두 가지:
  - `목적` `범위` `용어` `변경 이력` 같은 **메타 섹션은 기능 영역으로 취급하지 않습니다**
  - 흐름도의 로그인 관문은 **영역 이름 자체가 인증을 뜻할 때만** 세우고, 인증 요구사항이 개별 기능에 섞여 있으면 관문 없이 구성한 뒤 그 사실을 캡션으로 알립니다


---

## 8. REST API

모든 응답은 `application/json` (CSV 제외), 실패 시 `{ "ok": false, "error": "..." }`.

### `POST /api/extract-text`

파일 본문을 그대로 body 에 싣고, 파일명은 헤더로 보냅니다(멀티파트 파서 불필요).

```bash
curl -s -X POST http://localhost:3000/api/extract-text \
  -H "Content-Type: application/pdf" \
  -H "X-File-Name: $(printf '%s' '로그인 기획서.pdf' | jq -sRr @uri)" \
  --data-binary @로그인기획서.pdf
```

응답: `{ ok, specText, meta: { fileName, kind, bytes, chars, pages?, paragraphs?, encoding?, truncated } }`

### `POST /api/generate-tc`

```jsonc
{
  "specText": "- 비밀번호는 8자 이상 20자 이하로 입력해야 한다.",
  "useAI": false,            // true + ANTHROPIC_API_KEY 있을 때만 Claude 보강
  "aiLimit": 12,
  "summaryTopN": 8,
  "options": {
    "includePass": true, "includeFail": true, "includeEdge": true,
    "maxFailPerRequirement": 3, "maxEdgePerRequirement": 2, "idPrefix": "TC"
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
    { "id": "REQ-001", "area": "1. 로그인", "line": 1, "lang": "ko",
      "categories": ["THRESHOLD", "AUTH"], "condition": null,
      "constraints": [{ "value": 8, "unit": "글자", "op": ">=", "source": "8자 이상" }], "retryCount": null }
  ],
  "testCases": [
    {
      "tc_id": "TC-E-001", "type": "Edge Case", "priority": "High", "area": "1. 로그인",
      "title": "[경계] 1. 로그인 — 경계값 8글자 이상 전후 판정",
      "objective": "기준값 8글자 이상 의 경계에서 허용/거부 판정이 정확한지 확인한다.",
      "precondition": ["1. 로그인 진입 가능한 테스트 계정/데이터 준비", "기준: 8글자 이상 (기획서 표현 \"8자 이상\")"],
      "steps": ["입력: 7글자 — 경계 외부", "입력: 8글자 — 경계 정확값", "입력: 9글자 — 경계 내부"],
      "expected": ["7글자 → 거부 + 유효성 안내", "8글자 → 허용 + 정상 처리", "9글자 → 허용 + 정상 처리"],
      "requirement": { "id": "REQ-001", "text": "비밀번호는 8자 이상 20자 이하로 입력해야 한다", "line": 1,
                       "categories": ["경계값/임계치", "인증/권한"] },
      "tags": ["boundary"], "origin": "rule"
    }
  ],
  "summary": { "total": 99, "byType": { "Pass": 31, "Fail": 40, "Edge Case": 28 },
               "byPriority": { "High": 64, "Med": 26, "Low": 9 } },
  "specSummary": { "headline": "...", "overview": {}, "keyPoints": [], "numericRules": [], "risks": [], "coverage": {} },
  "ai": { "requested": false, "enabled": false }
}
```

### `POST /api/summarize`

```jsonc
{ "specText": "...", "topN": 8, "useAI": false }
```

`useAI: true` 면 `ai.summary` 에 서술형 요약(`headline`, `scope`, `criticalFlows`, `openQuestions`, `riskNotes`)이 추가됩니다.

### `POST /api/export-csv`

`testCases` 배열을 보내면 그대로 CSV 로, `specText` 만 보내면 생성까지 한 번에 처리합니다.

```jsonc
{ "testCases": [ /* ... */ ], "excel": true, "bom": true, "fileName": "로그인-TC.csv" }
```

| 파라미터 | 기본값 | 의미 |
|---|---|---|
| `bom` | `true` | UTF-8 BOM 부착. **Excel 한글 깨짐 방지의 핵심.** BOM 을 거부하는 외부 시스템(TestRail·Jira import 등)에 넣을 때만 `false`. |
| `excel` | `true` | 줄바꿈 `CRLF`. `false` 면 `LF`. BOM 여부와는 무관. |

컬럼: `TC_ID, 유형, 중요도, 요구사항 영역, 테스트 시나리오, 검증 목적, 사전 조건, 수행 단계, 기대 결과, 요구사항 ID, 근거 문장, 원문 라인, 분류, 태그, 생성 방식`
사전 조건·기대 결과는 셀 안에서 `•` 불릿, 수행 단계는 `1. 2. 3.` 번호로 줄바꿈됩니다. 양식 변경은 `src/csv.js` 의 `COLUMNS` 배열만 수정하면 됩니다.

### `POST /api/diff-check`

```jsonc
{ "oldText": "- 비밀번호는 8자 이상이다.", "newText": "- 비밀번호는 12자 이상이다.",
  "threshold": 0.55, "generateTestCases": true, "includeUnchanged": false }
```

Dice 계수 유사도로 문장을 매칭해 **추가 / 수정 / 삭제 / 동일**로 분류하고, 수정 건은 무엇이 바뀌었는지(경계값·재시도 횟수·조건절·분류·영역) 문장으로 알려줍니다.
변경·추가된 요구사항에 대해서만 `regressionTestCases`(태그 `regression`)를 생성하므로 기획 변경 시 회귀 범위를 바로 잡을 수 있습니다.

### 기타

- `POST /api/login` — `{ "password": "..." }` → 세션 쿠키 발급 (10회/15분 제한)
- `POST /api/logout` — 세션 쿠키 만료
- `GET /api/health` — 인증 없이 열려 있으나 **미인증 상태에서는 최소 정보만** 반환 (버전·인증 필요 여부). 인증 후에는 Node 버전·AI 상태·업로드 제한까지 포함
- `GET /api/sample` — 샘플 기획서 텍스트

> 한글이 포함된 본문은 **UTF-8 파일로 저장해서 보내세요.** Windows 터미널(Git Bash·cmd)에서 인라인 문자열로 보내면 CP949 로 전송돼 한글 키워드가 매칭되지 않고 TC 가 0건이 될 수 있습니다.
>
> ```bash
> curl -s -X POST http://localhost:3000/api/generate-tc -H "Content-Type: application/json" --data-binary @request.json
> ```

---

## 9. 대시보드

- **좌측** — 파일 드롭존, 기획서 입력(⌘/Ctrl + Enter 로 생성), Pass/Fail/Edge 포함 여부, Claude 보강 토글, 샘플 불러오기 / 기획서 비교 탭
- **우측** — `테스트케이스` / `문서 요약` 뷰 전환
  - 테스트케이스: 5열 압축 표 + 행 클릭 시 상세 펼침, 유형 칩·중요도·영역 필터, 시나리오/단계/기대결과/근거 문장 통합 검색
  - 문서 요약: **파일 드롭존** + 개요 · 핵심 요구사항 · 수치 기준 표 · 확인 필요 목록 · 영역별 요점 · **QA 검증 분석서 6개 섹션** (+ 마크다운 복사, Claude 서술형 요약)
- **내보내기** — CSV(Excel용·권장) / CSV(BOM 없음·연동용) / JSON. 필터가 적용된 현재 목록만 내려갑니다.
  Excel 로 열 때는 반드시 **CSV (Excel용·권장)** 을 사용하세요. 연동용 파일은 BOM 이 없어 Excel 이 CP949 로 잘못 해석해 한글이 깨집니다.
- 비교 탭에서 실행하면 우측 표가 회귀 대상 TC 로 교체됩니다.

---

## 10. Vercel 배포

```bash
git add -A
git commit -m "feat: SpecToTC"
git push -u origin main
```

1. [vercel.com/new](https://vercel.com/new) → 이 저장소 Import
2. Framework Preset: **Other** (`vercel.json` 이 이미 지정)
3. Claude 보강을 쓸 경우 Project Settings → Environment Variables → `ANTHROPIC_API_KEY` 등록 후 Redeploy
   · 인증 없이 배포하면 아무나 AI 호출을 보낼 수 있으니, 함께 `SPECTOTC_AI_TOKEN` 을 설정하거나 `SPECTOTC_AI_ENABLED=false` 로 두는 편이 안전합니다
   · 로그인을 켜려면 `SPECTOTC_PASSWORD` 를 등록합니다 (선택)
4. Deploy → `https://<프로젝트>.vercel.app` 에서 대시보드, `/api/health` 로 상태 확인

배포 구성 요약:

- `public/` → 정적 대시보드 (`outputDirectory`)
- `/api/*` → `api/index.js` 하나의 Serverless Function 으로 rewrite (Express 앱 그대로 재사용)
- `samples/**` 는 `includeFiles` 로 함수 번들에 포함 (`/api/sample` 용)
- `/api/*` 응답은 `no-store`
- PDF 파싱은 `pdfjs-dist` 를 쓰므로 함수 메모리 1024MB / 최대 60초로 설정되어 있습니다. 대용량 PDF 를 다루면 이 값을 올리세요.

`main` 브랜치 push 는 Production, PR 은 Preview 배포로 자동 반영됩니다.

---

## 11. Claude 보강 (선택)

`ANTHROPIC_API_KEY` 가 설정된 경우에만 동작합니다.

- 모델: `claude-opus-5` (`SPECTOTC_MODEL` 로 변경 가능), adaptive thinking + effort `high`, 스트리밍 수신
- **TC 보강** (`generate-tc` + `useAI: true`) — 규칙 엔진이 만든 시나리오 목록을 함께 전달해 중복을 피하고, 업무 흐름 전체·상태 조합·데이터 정합성·권한 조합·시간(자정/월말/타임존) 케이스를 추가 생성. 기획서에 없어 확인이 필요한 항목은 제목에 `[기획확인]` 표기
- **요약 보강** (`summarize` + `useAI: true`) — 규칙 엔진이 뽑은 지표를 함께 넘겨 서술형 요약·핵심 흐름·기획 확인 질문 생성
- 결과 TC 는 `origin: "ai"`, `tc_id` 는 `TC-E-A001` 형태로 구분되며 대시보드에서 `AI` 배지로 표시
- 키가 없거나 SDK 미설치, 응답 파싱 실패 시에도 규칙 엔진 결과는 그대로 반환됩니다(오류 메시지만 `ai.error` 로 전달)

`@anthropic-ai/sdk` 는 `optionalDependencies` 이므로 설치에 실패하더라도 서버는 정상 동작합니다.

---

## 12. 알려진 한계

- 파서는 **문장 단위 규칙 기반**입니다. 이미지·플로우차트로만 표현된 기획, 셀 병합이 복잡한 표는 잡지 못합니다.
- 조건절/동작절 분리는 한국어 어미 패턴에 의존하므로, 만연체 문장에서는 조건이 통째로 동작절에 포함될 수 있습니다.
- PDF 는 레이아웃 정보를 잃습니다. 2단 편집·표 중심 문서는 줄 순서가 섞일 수 있어, 추출 결과를 텍스트 영역에서 한 번 확인하는 것을 권합니다.
- 생성된 TC 는 **초안**입니다. QA 가 검토·병합하는 것을 전제로 설계했고, 그래서 모든 TC 에 `requirement.text` / `requirement.line`(근거 문장)을 함께 담습니다.
- Diff 는 문장 유사도 기반이라 문단을 크게 재구성한 개정판에서는 `added` + `removed` 로 잡힐 수 있습니다(`threshold` 조정 가능).
- **기본은 인증 없음**입니다 — URL 을 아는 사람은 누구나 사용할 수 있습니다. 로그인을 켜도 팀 공용 비밀번호 하나이므로, 개인별 계정·권한 구분·접속 감사 로그가 필요하면 SSO(예: Vercel Authentication, Cloudflare Access) 앞단에 두는 편이 낫습니다.
- 레이트리밋은 서버리스 인스턴스별로만 동작합니다(위 3장 참고).
