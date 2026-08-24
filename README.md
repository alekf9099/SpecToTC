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
│   ├── web/
│   │   ├── fetchPage.js      URL → HTML (SSRF 방어·리다이렉트 재검사)
│   │   ├── inventory.js      HTML → 화면 요소 인벤토리
│   │   ├── webTestCases.js   인벤토리 → TC
│   │   ├── overrides.js      QA 가 지정한 폼 조건 반영 + 클라이언트 입력 검증
│   │   ├── browser.js        헤드리스 브라우저 실행 (시스템 Chrome/Edge, SSRF 재검사, 3중 게이트)
│   │   ├── liveRun.js        렌더링 분석 + 실제 제출·결과 관측
│   │   ├── liveTestCases.js  관측 결과 → 실측 기대결과 TC
│   │   └── webSummary.js     인벤토리 → 요약·검증 분석서
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
├── public/                   대시보드 (index.html / login.html / dashboard.css / dashboard.js /
│                             summary-view.js / qa-plan-view.js / report.js / web-view.js /
│                             web-form-editor.js / theme.js / robots.txt)
├── samples/sample-srs.md     샘플 기획서
├── test/run.js               의존성 없는 테스트 러너 (93 케이스)
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

> **PDF 워커** — pdf.js 는 워커를 런타임에 동적 import 하는데, 그 경로는 정적 분석이 되지 않아
> 서버리스 번들(Vercel)에 `pdf.worker.mjs` 가 빠지고 `Setting up fake worker failed: Cannot find module …` 로
> 실패합니다. 그래서 우리 코드에서 워커를 **리터럴 경로로 직접 import 해 `globalThis.pdfjsWorker` 에 공급**합니다.
> pdf.js 는 이 값이 있으면 파일을 찾지 않으므로 런타임 파일 의존이 사라지고, 번들러도 이 파일을 함께 포함합니다.
> 현재 구동 방식은 `GET /api/health` 의 `pdf.worker` (`main-thread` 정상) 로 확인합니다.


---

## 5. 웹사이트 화면 분석 (URL → TC)

좌측 **웹사이트 분석** 탭에 공개된 주소를 넣으면 페이지의 화면 요소를 읽어 TC 를 만듭니다.
기획서가 없거나, 이미 만들어진 화면을 검증할 때 씁니다.

| 읽어내는 것 | 만들어지는 TC |
|---|---|
| 폼 (action·method) 과 입력 필드 | 정상 제출, 필수값 미입력, 형식 오류, XSS 삽입 |
| 입력 제약 (`required` `maxlength` `minlength` `min` `max` `pattern` `accept`) | 제약별 경계값 ±1 검증 |
| 로그인 폼 (`type=password` 감지) | 잘못된 자격 증명·연속 실패·계정 열거 방지 |
| 검색 폼 (`type=search`, `q`·`query` 등) | 빈 검색어·특수문자·초장문·결과 0건 |
| 파일 업로드 (`type=file`) | 허용되지 않는 확장자·용량 초과, 서버측 검증 |
| 내부/외부 링크 | 링크 이동·404·뒤로가기, `rel="noopener"` 누락 |
| 접근성 신호 (`alt` 누락, `lang`, 빈 링크) | 접근성 결함 확인, 키보드 이동 |
| `viewport` meta | 모바일·태블릿 해상도 표시 |

생성된 TC 는 **기획서 기반 TC 와 완전히 같은 구조**라, 표·필터·CSV·PDF 내보내기·검증 분석서가 그대로 동작합니다.
근거(`requirement`)에는 요구사항 문장 대신 **페이지에서 관측한 사실**이 들어갑니다
(예: `POST /signup · 필드 6개`, `email: {"required":true,"maxLength":"60"}`).

### 발견된 폼에 조건 지정 → TC 다시 생성

페이지 HTML 은 **무엇이 있는지** 만 알려줍니다. 실제 규칙(최대 길이 · 필수 여부 · 사내 형식 규칙 ·
선행 조건)은 대개 HTML 에 없고 **QA 가 알고 있습니다.** 분석 결과 아래 **발견된 폼 편집기** 에 그 조건을
적고 `조건 반영해 TC 다시 생성` 을 누르면, 문서 기반 엔진과 같은 수준의 경계값·조건 분기 TC 가 나옵니다.

| 지정 항목 | 추가로 만들어지는 TC |
|---|---|
| 폼의 **선행 조건** (예: `로그인한 회원만 접근 가능`) | 조건 충족 상태의 정상 제출 + **조건 미충족 상태에서 차단되는지** (`negative-condition`) |
| **필수 / 최소 / 최대 길이** | 지정값 기준 경계값 ±1 (근거에 `(QA 지정)` 으로 표기) |
| **형식 규칙** (자유 서술, 예: `사내 도메인만 허용`) | 규칙 위반 값 거부 확인 (`qa-rule`) |
| **정상 테스트 값** | 정상 제출 TC 의 입력 단계에 실제 값이 그대로 들어감 |
| **조건·비고** | QA 가 기록한 예외가 성립하는지 확인 (`qa-note`) |
| **필드 추가** | JS 로 그려져 정적 분석에 잡히지 않은 필드도 직접 넣어 TC 생성 |

- QA 가 지정한 값이 페이지 관측값보다 **우선**합니다 (실제 규칙을 아는 쪽이 QA 이므로).
- 재생성은 **페이지를 다시 가져오지 않습니다.** 조건을 고쳐가며 몇 번을 눌러도 네트워크·레이트리밋을
  소모하지 않고, 지정한 조건과 추가한 필드는 재생성 왕복에서 유지됩니다.
- `지정한 조건 초기화` 는 처음 관측한 상태로 되돌립니다.

```jsonc
POST /api/web-testcases          // 페이지 재요청 없이 TC 만 다시 만든다
{
  "inventory": { /* /api/analyze-url 이 준 inventory 를 그대로 */ },
  "overrides": {
    "forms": {
      "0": {
        "condition": "로그인한 회원만 접근 가능",
        "fields": { "0": { "required": true, "maxLength": 30, "rule": "사내 도메인만 허용", "testValue": "qa@muhayu.com", "note": "가입 후 24시간 내에만 변경" } },
        "addedFields": [{ "label": "쿠폰 코드", "type": "text", "required": true, "maxLength": 12 }]
      }
    }
  }
}
```

응답: `applied`(지정한 조건 수 · 추가 필드 수 · 선행 조건 수) · `inventory`(반영된 인벤토리) ·
`testCases` · `specSummary` · `summary` · `areas`

### 브라우저 실행 — 렌더링 분석과 실행 검증

정적 HTML 분석으로는 두 가지를 알 수 없습니다. **JS 로 그려지는 화면**과 **실제로 제출했을 때의 결과**입니다.
헤드리스 브라우저를 켜면 둘 다 해결됩니다. 위험도가 완전히 다르므로 **2단계로 나눠** 각각 따로 켭니다.

브라우저는 새로 내려받지 않고 **시스템에 이미 있는 Chrome/Edge** 를 씁니다(`playwright-core` + channel).
300MB 다운로드가 없어야 사내 설치가 막히지 않습니다.

```bash
npm install --save-optional playwright-core
```

#### 1단계 — 렌더링 분석 (읽기만 함)

`웹사이트 분석` 탭의 **브라우저로 렌더링 분석** 체크박스. 페이지를 브라우저로 열고 네트워크가 잠잠해진 뒤
렌더링된 DOM 을 분석합니다. 폼을 제출하지 않으므로 대상 사이트 상태를 바꾸지 않습니다.

```bash
SPECTOTC_BROWSER=1
```

실측 비교 (`naver.com` 메인):

| | 폼 | 입력 | 링크 | 버튼 | jsRendered |
|---|---|---|---|---|---|
| 정적 HTML | 1 | 1 | 8 | 3 | `true` (경고) |
| 브라우저 렌더링 | 1 | 1 | **108** | **24** | `false` |

브라우저 실행이 실패하거나 꺼져 있으면 **정적 분석으로 되돌아가고** 그 사실을 화면에 적습니다.
이 기능 때문에 전체 분석이 실패하지는 않습니다.

#### 2단계 — 실행 검증 (실제로 제출함)

폼 편집기의 **실제로 제출해 확인** 버튼. `정상 테스트 값` 칸에 적은 값을 브라우저가 실제로 입력하고
제출한 뒤, 관측한 결과로 TC 를 만듭니다. 기대 결과가 **추정이 아니라 실측값**이 됩니다.

```
[정상] 검색 폼 — 검색어 자동차 조회 · 실제 제출 결과 확인
  수행 단계   진입: https://shop.example.com/
              입력: 검색어 = 자동차
              실행: 제출 버튼 클릭
  기대 결과   현재 동작(기준선): /search?q=%EC%9E%90%EB%8F%99%EC%B0%A8 로 이동
              현재 동작(기준선): HTTP 200
              현재 동작(기준선): 본문 표기 1,240건, 목록 항목 20개
              입력값이 조회 조건으로 전달됨 (검색어 — 주소에 포함)
              ※ 위는 관측값입니다. 이 동작이 기획 의도와 맞는지는 QA 가 판단하세요.
```

관측한 값은 **`현재 동작(기준선)`** 으로만 적습니다. 기획서가 없으면 지금 동작이 옳은지는 알 수 없으므로,
판단은 QA 에게 남기고 도구는 측정만 합니다. 이 구분을 흐리면 잘못된 동작이 정답으로 굳습니다.

**3중 게이트** — 이 기능만 유일하게 대상 사이트 상태를 바꿀 수 있습니다.
임의의 공개 사이트에 가입·문의·로그인을 자동 제출하는 도구가 되지 않도록 기본값을 모두 잠갔습니다.

```bash
SPECTOTC_LIVE_SUBMIT=1                          # ① 기능 자체를 켠다
SPECTOTC_LIVE_ALLOW_HOSTS=shop.example.com      # ② 검증 권한이 있는 도메인만 (하위 도메인 포함)
SPECTOTC_LIVE_ALLOW_POST=1                      # ③ POST 폼까지 허용 (기본은 GET 폼만)
```

- 허용 목록이 비어 있으면 **아무 곳도** 제출할 수 없습니다.
- GET 이 아닌 폼은 데이터를 바꿀 수 있어 기본적으로 제출하지 않습니다.
- 화면에서도 실행 전에 **주소·폼·입력값을 보여주고 확인**을 받습니다.
- 전용 레이트리밋 **5회 / 5분** (분석보다 더 조입니다).
- 브라우저 안에서도 SSRF 방어를 다시 적용합니다 — 모든 요청을 가로채 정적 분석과 **같은 판정 로직**으로
  호스트를 검사합니다. 브라우저 경로가 우회로가 되면 안 되기 때문입니다. 파일 다운로드는 차단합니다.

수동 확인 스크립트 — 실제 제출은 자동 테스트에 넣지 않고 사람이 의도적으로 실행하게 분리했습니다.

```bash
SPECTOTC_BROWSER=1 SPECTOTC_LIVE_SUBMIT=1 SPECTOTC_LIVE_ALLOW_HOSTS=naver.com node scripts/live-check.js https://www.naver.com 자동차
```

기타 환경 변수: `SPECTOTC_BROWSER_TIMEOUT`(기본 20000) · `SPECTOTC_BROWSER_SETTLE`(기본 1500) ·
`SPECTOTC_BROWSER_CHANNEL`(기본 `chrome,msedge,chromium`)

```jsonc
POST /api/analyze-url
{ "url": "https://www.naver.com", "render": true }   // 렌더링 분석

POST /api/live-verify                                 // 실행 검증
{ "url": "https://shop.example.com/", "inventory": { }, "overrides": { }, "formIndex": 0 }
```

> **Vercel 에서는 동작하지 않습니다.** 서버리스 함수에는 Chrome 이 없습니다. 브라우저 기능은
> 로컬 실행이나 사내 서버(항상 켜져 있는 Node 프로세스)에서 쓰세요. Vercel 에 올린 인스턴스는
> 정적 분석으로 자동 되돌아가므로, 배포가 깨지지는 않습니다.

### 분석 한계 — 반드시 알고 쓰세요

- 기본은 **브라우저 없이 HTML 만 읽습니다.** JS 로 그려지는 요소(SPA)는 잡히지 않습니다.
  (위 **브라우저 실행** 을 켜면 해결됩니다. 아래는 브라우저를 쓰지 않을 때의 한계입니다.)
  본문이 거의 없고 스크립트만 많으면 `JS 렌더링 위주` 로 판정해 경고하고, "수동 확인 필요" TC 를 함께 만듭니다.
  실제로 `naver.com` 메인은 검색 폼 1개만 잡히고 나머지는 JS 렌더링으로 분류됩니다.
- **로그인이 필요한 화면은 볼 수 없습니다.** 공개 페이지만 대상입니다.
- 기획서가 없으므로 "명세대로인지" 는 판단할 수 없습니다. 목표·비목표는 `기획 확인 필요` 로 표기됩니다.

### 보안 (SSRF 방어)

이 기능은 **서버가 사용자가 준 주소로 요청을 보냅니다.** 인증 없이 열어두면 내부망 탐색에 악용될 수 있어
다음을 막습니다.

- 사설·루프백·링크로컬 대역 차단 — `127.0.0.0/8` `10/8` `172.16/12` `192.168/16` `169.254/16`(클라우드 메타데이터)
  `100.64/10`(CGNAT), 멀티캐스트, IPv6 `::1` `fe80::` `fc00::/7`, IPv4 매핑 주소까지
- 도메인은 **DNS 조회 후 실제 IP** 로 검사 (DNS 로 내부 IP 를 가리키는 우회 차단)
- **리다이렉트를 직접 따라가며 매 홉마다 재검사** (fetch 에 맡기면 중간 홉을 검사할 수 없음)
- `http`/`https` 만 허용, HTML 이 아닌 응답 거부, 12초 타임아웃, 3MB 상한(초과 시 앞부분만)
- 전용 레이트리밋 **10회 / 5분**

환경 변수: `SPECTOTC_WEB_TIMEOUT` `SPECTOTC_WEB_MAX_BYTES` `SPECTOTC_WEB_UA`

### API

```jsonc
POST /api/analyze-url
{ "url": "https://www.naver.com" }   // 스킴 생략 가능 ("naver.com")
```

응답: `page`(최종 URL·상태·크기·리다이렉트) · `inventory`(화면 요소 전체) · `testCases` · `specSummary`
---

## 6. 규칙 엔진이 감지하는 것

### 6.1 조건문 패턴

| 유형 | 한글 | 영문 |
|---|---|---|
| 조건 분기 | `~일 때`, `~하면`, `~인 경우`, `성공 시` | `if`, `when`, `once`, `in case of` |
| 경계값 | `8자 이상`, `20자 이하`, `50,000원 이상`, `최대 12자`, `3초 이내`, `8~20자` | `at least 8`, `up to 5`, `no more than 10`, `within 3 seconds`, `>= 10` |
| 재시도 | `재시도`, `재전송`, `최대 2회 재시도` | `retry up to 3 times`, `backoff` |
| 이탈 처리 | `이탈`, `중단`, `타임아웃`, `세션 만료` | `abort`, `cancel`, `timeout`, `drop-off` |

그 외 카테고리: 인증/권한, 입력 검증, 오류 처리, 결제, 개인정보, 삭제, 성능, 화면 이동, 노출, 목록/검색, 파일, 알림, 상태 저장.
전체 사전은 [`src/engine/dictionary.js`](src/engine/dictionary.js) 한 파일에 모여 있어 사내 용어를 여기에 추가하면 바로 반영됩니다.

### 6.2 생성 규칙

- **[Pass]** 조건 충족 → 명세된 동작이 정상 수행되는 흐름. 상태 저장/알림 카테고리가 있으면 재진입·발송 확인 TC 추가.
- **[Fail]** 조건 미충족 케이스 + 카테고리별 실패 레시피(필수값 미입력, 미인증/권한 없음, 결제 승인 실패, 확장자·용량 초과, 중도 이탈/타임아웃, 5xx 등). 감지된 카테고리가 없으면 네트워크 단절 케이스로 대체.
- **[Edge Case]** 추출된 경계값마다 **경계 외부 / 경계 정확값 / 경계 내부** 3점을 한 TC 로 묶어 검증. 재시도 상한(N회 소진·초과), 저속 네트워크, 목록 0건/1건/페이지경계/대량, 이탈 후 재진입, 멱등성(따닥) 케이스.

### 6.3 중요도(High / Med / Low)

카테고리 가중치 합 + 유형 보정(Fail +2, Edge +1, 경계값 +1)으로 점수를 내고 `>=10 High`, `>=5 Med`, 그 외 `Low`.
결제·개인정보·삭제(6) > 인증·검증·오류·재시도·이탈(4) > 경계값·성능·파일·알림·상태(3) > 조건·이동·목록(2) > 노출(1).
가중치와 임계값은 `dictionary.js` 의 `weight`, `generator.js` 의 `calcPriority()` 에서 조정합니다.

> 기획서 성격에 따라 High 비중이 커질 수 있습니다(로그인·결제 중심 문서는 대부분 High 로 수렴). 팀 기준에 맞게 임계값을 조정하세요.

---

## 7. 테스트케이스 구조

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

## 8. 문서 요약 (핵심만 골라 보기)

우측 패널의 **문서 요약** 탭. `POST /api/summarize` 또는 `generate-tc` 응답의 `specSummary` 로도 받을 수 있습니다.

| 항목 | 내용 |
|---|---|
| **개요** | 영역·요구사항·조건 분기·수치 기준 수, 언어, 상위 카테고리, TC 커버리지(요구사항당 평균 TC, 미커버 목록) |
| **핵심 요구사항** | 카테고리 가중치 + 제약 보유 여부로 점수를 내 상위 N건 (기본 8건) |
| **수치 기준** | 경계값·재시도 기준을 표로 모아 제공 — 검증 시 그대로 입력값으로 사용 (`8글자 이상`, `10 MB 이하`, `3회`) |
| **확인 필요** | 기획에 물어봐야 하는 것 — 모호 표현(`적절히`, `필요시`, `등`, `빠르게`, `TBD`), 재시도 횟수 누락, 단위 누락, 조건만 있고 실패 처리 없음, 결제에 실패 흐름 없음. 사유별로 묶고 **질문 문장까지** 생성 |
| **영역별 요점** | 영역마다 요구사항 수·주요 카테고리·대표 문장 3건 |



### 테마 (라이트 / 다크 / 자동)

상단바의 테마 버튼으로 **자동(OS 설정) → 라이트 → 다크** 를 순환합니다. 선택은 브라우저에 저장되고,
화면이 그려지기 전에 적용되어 깜빡임이 없습니다. 자동일 때는 OS 설정을 따릅니다.

- 색은 전부 CSS 변수 사다리로 관리합니다 — `--bg` `--surface` `--surface-2/3` `--sunken` `--muted`
  `--elevated` `--border` `--divider`, 텍스트 `--fg` `--fg-muted` `--fg-subtle` `--fg-faint`.
  라이트가 기본 정의이고, 다크는 `@media (prefers-color-scheme: dark)` 와 `[data-theme="dark"]` 에서 덮어씁니다.
- 강조색 배경은 알파(`hsl(... / 0.13)`)로 얹어 두 테마에서 같은 규칙이 동작합니다.
  강조색 위의 글자는 `--on-mint` `--on-rose` `--on-amber` `--on-indigo` `--on-violet` 로 분리해
  테마별로 읽히는 톤을 씁니다 (면 색을 글자색으로 쓰면 라이트에서 대비가 2.6:1 까지 떨어집니다).
- **대비 기준**: 본문·보조 텍스트·배지·표 머리행을 실측해 두 테마 모두 WCAG AA(4.5:1) 이상을 유지합니다
  (라이트 최저 4.72, 다크 최저 5.1).
- 다크는 이전보다 한 단계 밝혔습니다 — 배경 `hsl(226 33% 7.5%)` → `hsl(226 26% 12%)`.
### 전체 문서 내보내기 (PDF · HTML)

요약 탭의 **전체 문서 PDF 내보내기** 버튼(테스트케이스 탭의 `전체 문서 PDF` 도 동일)은
**문서 요약 + QA 검증 분석서 + 테스트케이스 전문**을 하나의 인쇄용 문서로 만들어 인쇄 대화상자를 띄웁니다.
대상을 **"PDF로 저장"** 으로 선택하면 PDF 파일이 만들어집니다.

| 항목 | 내용 |
|---|---|
| 표지 | 기획서 첫 제목을 프로젝트명으로 사용 · 분석 출처 파일명 · 작성 기준일 |
| 구성 | 문서 요약(개요·핵심 요구사항·수치 기준·확인 필요·영역별 요점) → QA 검증 분석서 6개 섹션 → 테스트케이스 전문 |
| 인쇄 품질 | A4 여백 지정, 표 머리행 페이지마다 반복, 행·항목 페이지 중간 분리 방지, 주요 섹션은 새 페이지에서 시작 |
| **HTML 파일 저장** | 같은 내용을 단일 HTML 파일로 저장 — 첨부·공유용. 열어서 인쇄하면 동일한 PDF 가 나옵니다 |

> **왜 서버에서 PDF 를 직접 만들지 않는가** — pdfkit 등 서버 PDF 라이브러리의 기본 폰트에는 한글이 없어,
> 한글 문서를 만들려면 폰트 파일(수 MB)을 저장소에 넣고 임베딩해야 합니다. 인쇄 경로는 시스템 폰트를 쓰므로
> 깨짐이 없고, 글자가 이미지가 아니라 **선택·검색 가능한 상태**로 남습니다.
> 한 번 클릭으로 파일이 바로 떨어지는 방식이 필요하면 폰트 임베딩을 추가해 서버 생성으로 바꿀 수 있습니다.
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

## 9. REST API

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

### `POST /api/analyze-url` · `POST /api/web-testcases`

웹사이트 화면 분석과 QA 조건 반영 재생성. 5장 참고.

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

## 10. 대시보드

- **좌측** — 3개 탭: `TC 생성`(파일 드롭존 + 기획서 입력, ⌘/Ctrl + Enter) · `웹사이트 분석`(URL 입력) · `기획서 비교(Diff)`
- **우측** — `테스트케이스` / `문서 요약` 뷰 전환
  - 테스트케이스: 5열 압축 표 + 행 클릭 시 상세 펼침, 유형 칩·중요도·영역 필터, 시나리오/단계/기대결과/근거 문장 통합 검색
  - 문서 요약: **파일 드롭존** + 개요 · 핵심 요구사항 · 수치 기준 표 · 확인 필요 목록 · 영역별 요점 · **QA 검증 분석서 6개 섹션** (+ 전체 문서 PDF·HTML 내보내기, 마크다운 복사, Claude 서술형 요약)
- **내보내기** — CSV(Excel용·권장) / CSV(BOM 없음·연동용) / JSON. 필터가 적용된 현재 목록만 내려갑니다.
  Excel 로 열 때는 반드시 **CSV (Excel용·권장)** 을 사용하세요. 연동용 파일은 BOM 이 없어 Excel 이 CP949 로 잘못 해석해 한글이 깨집니다.
- 비교 탭에서 실행하면 우측 표가 회귀 대상 TC 로 교체됩니다.

---

## 11. Vercel 배포

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

## 12. Claude 보강 (선택)

`ANTHROPIC_API_KEY` 가 설정된 경우에만 동작합니다.

- 모델: `claude-opus-5` (`SPECTOTC_MODEL` 로 변경 가능), adaptive thinking + effort `high`, 스트리밍 수신
- **TC 보강** (`generate-tc` + `useAI: true`) — 규칙 엔진이 만든 시나리오 목록을 함께 전달해 중복을 피하고, 업무 흐름 전체·상태 조합·데이터 정합성·권한 조합·시간(자정/월말/타임존) 케이스를 추가 생성. 기획서에 없어 확인이 필요한 항목은 제목에 `[기획확인]` 표기
- **요약 보강** (`summarize` + `useAI: true`) — 규칙 엔진이 뽑은 지표를 함께 넘겨 서술형 요약·핵심 흐름·기획 확인 질문 생성
- 결과 TC 는 `origin: "ai"`, `tc_id` 는 `TC-E-A001` 형태로 구분되며 대시보드에서 `AI` 배지로 표시
- 키가 없거나 SDK 미설치, 응답 파싱 실패 시에도 규칙 엔진 결과는 그대로 반환됩니다(오류 메시지만 `ai.error` 로 전달)

`@anthropic-ai/sdk` 는 `optionalDependencies` 이므로 설치에 실패하더라도 서버는 정상 동작합니다.

---

## 13. 알려진 한계

- 파서는 **문장 단위 규칙 기반**입니다. 이미지·플로우차트로만 표현된 기획, 셀 병합이 복잡한 표는 잡지 못합니다.
- 조건절/동작절 분리는 한국어 어미 패턴에 의존하므로, 만연체 문장에서는 조건이 통째로 동작절에 포함될 수 있습니다.
- PDF 는 레이아웃 정보를 잃습니다. 2단 편집·표 중심 문서는 줄 순서가 섞일 수 있어, 추출 결과를 텍스트 영역에서 한 번 확인하는 것을 권합니다.
- 생성된 TC 는 **초안**입니다. QA 가 검토·병합하는 것을 전제로 설계했고, 그래서 모든 TC 에 `requirement.text` / `requirement.line`(근거 문장)을 함께 담습니다.
- Diff 는 문장 유사도 기반이라 문단을 크게 재구성한 개정판에서는 `added` + `removed` 로 잡힐 수 있습니다(`threshold` 조정 가능).
- **기본은 인증 없음**입니다 — URL 을 아는 사람은 누구나 사용할 수 있습니다. 로그인을 켜도 팀 공용 비밀번호 하나이므로, 개인별 계정·권한 구분·접속 감사 로그가 필요하면 SSO(예: Vercel Authentication, Cloudflare Access) 앞단에 두는 편이 낫습니다.
- 레이트리밋은 서버리스 인스턴스별로만 동작합니다(위 3장 참고).
- **브라우저 실행(렌더링 분석·실행 검증)은 Vercel 에서 동작하지 않습니다.** 서버리스 함수에 Chrome 이 없기 때문입니다. 로컬이나 사내 서버에서만 쓰세요 — Vercel 인스턴스는 정적 분석으로 자동 되돌아갑니다.
- 실행 검증의 결과 건수는 **추정**입니다. 본문의 `N건` 표기와 가장 큰 목록의 항목 수라는 두 신호만 정직하게 보고하며, 확정 수치로 단정하지 않습니다.
- 실행 검증은 **캡차·2FA·로그인 뒤 화면**을 통과할 수 없습니다. 자동 입력하지 못한 필드는 `수동 확인` TC 로 남깁니다.
- 관측값은 **현재 동작(기준선)** 일 뿐 정답이 아닙니다. 기획서 없이는 그 동작이 옳은지 알 수 없으므로 QA 판단이 필요합니다.
