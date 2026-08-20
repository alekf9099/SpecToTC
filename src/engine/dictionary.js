'use strict';

/**
 * 요구사항 문장에서 의미 카테고리를 뽑아내기 위한 다국어(한/영) 키워드 사전.
 *
 * 각 항목:
 *   key      : 카테고리 식별자
 *   label    : 리포트/UI 표기용 이름
 *   weight   : 중요도 산정 가중치 (높을수록 High 로 수렴)
 *   patterns : 감지 정규식 배열 (한글 + 영문)
 */
const CATEGORIES = [
  {
    key: 'CONDITION',
    label: '조건 분기',
    weight: 2,
    patterns: [
      /(일|할|인|하는)\s*(때|경우)/,
      /[가-힣]{1,}(하면|되면|이면|라면)/,
      /(에|을|를|이|가)?\s*(성공|실패|완료)\s*시/,
      /[가-힣]{2,}\s*시(?=[\s,)]|$)/,
      /\b(if|when|whenever|in case of|once|unless)\b/i,
    ],
  },
  {
    key: 'THRESHOLD',
    label: '경계값/임계치',
    weight: 3,
    patterns: [
      /\d+\s*(자|글자|byte|바이트|자리|회|번|개|건|초|분|시간|일|%|원|MB|KB|GB|ms)?\s*(이상|이하|초과|미만|까지|이내|이후|이전)/,
      /(최대|최소|최대치|최소치|상한|하한)\s*\d+/,
      /\d+\s*(자|글자|자리)\s*(제한|제약)/,
      /[<>]=?\s*\d+/,
      /\b(at least|at most|up to|no more than|more than|less than|greater than|minimum|maximum|min|max|within)\b\s*\d*/i,
      /\b(between)\b\s*\d+\s*(and|~|-)\s*\d+/i,
    ],
  },
  {
    key: 'RETRY',
    label: '재시도',
    weight: 4,
    patterns: [
      /재시도|재전송|재요청|다시\s*시도|재발송|재인증/,
      /\b(retry|retries|re-?try|resend|re-?attempt|backoff)\b/i,
    ],
  },
  {
    key: 'ABORT',
    label: '이탈/중단 처리',
    weight: 4,
    patterns: [
      /이탈|중단|중도\s*포기|취소|강제\s*종료|앱\s*종료|백그라운드\s*전환|타임아웃|시간\s*초과|세션\s*만료|만료\s*처리/,
      /\b(abort|cancel|exit|drop-?off|bounce|timeout|timed out|expire[ds]?|terminate)\b/i,
    ],
  },
  {
    key: 'AUTH',
    label: '인증/권한',
    weight: 4,
    patterns: [
      /로그인|로그아웃|인증|인가|권한|토큰|비밀번호|패스워드|2단계|OTP|본인\s*확인|회원\s*가입|세션/,
      /\b(login|log ?in|logout|sign ?in|sign ?up|auth|authn|authz|permission|role|token|password|credential|session|otp|mfa)\b/i,
    ],
  },
  {
    key: 'VALIDATION',
    label: '입력 검증',
    weight: 4,
    patterns: [
      /필수|유효성|형식|포맷|정규식|검증|미입력|공백|중복\s*확인|허용\s*문자|특수\s*문자|이메일\s*형식|전화번호\s*형식/,
      /\b(required|mandatory|validate|validation|invalid|format|regex|pattern|blank|empty|whitespace|duplicate)\b/i,
    ],
  },
  {
    key: 'ERROR',
    label: '오류/예외 처리',
    weight: 4,
    patterns: [
      /실패|오류|에러|예외|장애|알럿|경고\s*문구|토스트|에러\s*코드|4\d{2}|5\d{2}/,
      /\b(fail|failed|failure|error|exception|reject|denied|fallback|alert)\b/i,
    ],
  },
  {
    key: 'PAYMENT',
    label: '결제/정산',
    weight: 6,
    patterns: [
      /결제|환불|정산|쿠폰|포인트|과금|청구|카드|계좌|입금|출금/,
      /\b(payment|pay|refund|checkout|billing|invoice|coupon|settlement)\b/i,
    ],
  },
  {
    key: 'PRIVACY',
    label: '개인정보/보안',
    weight: 6,
    patterns: [
      /개인정보|주민등록|마스킹|암호화|동의|약관|보안|접근\s*제어|감사\s*로그/,
      /\b(pii|personal data|masking|encrypt(?:ion|ed)?|consent|terms|gdpr|audit log|security)\b/i,
    ],
  },
  {
    key: 'DESTRUCTIVE',
    label: '삭제/되돌릴 수 없는 동작',
    weight: 6,
    patterns: [
      /삭제|탈퇴|초기화|영구\s*삭제|복구\s*불가|되돌릴\s*수\s*없/,
      /\b(delete|remove|purge|withdraw|reset|irreversible|hard-?delete)\b/i,
    ],
  },
  {
    key: 'PERFORMANCE',
    label: '성능/응답시간',
    weight: 3,
    patterns: [
      /\d+\s*(초|ms|밀리초|분)\s*(이내|이하|안에)/,
      /응답\s*시간|로딩\s*시간|성능|동시\s*접속|처리량/,
      /\b(within \d+\s*(ms|s|sec|seconds?|minutes?)|latency|throughput|concurrent|performance|p9[59])\b/i,
    ],
  },
  {
    key: 'NAVIGATION',
    label: '화면 이동/전환',
    weight: 2,
    patterns: [
      /이동|전환|리다이렉트|딥링크|뒤로\s*가기|팝업|모달|바텀시트|페이지\s*이동/,
      /\b(navigate|redirect|route|deep ?link|back|popup|modal|drawer|bottom ?sheet)\b/i,
    ],
  },
  {
    key: 'DISPLAY',
    label: '노출/표시',
    weight: 1,
    patterns: [
      /노출|표시|보여|숨김|비활성|활성화|문구|텍스트|라벨|배지|아이콘/,
      /\b(display|show|hide|visible|hidden|disabled|enabled|label|badge|placeholder|copy)\b/i,
    ],
  },
  {
    key: 'LIST',
    label: '목록/검색/정렬',
    weight: 2,
    patterns: [
      /목록|리스트|페이징|페이지네이션|무한\s*스크롤|정렬|필터|검색|더보기/,
      /\b(list|paging|pagination|infinite scroll|sort|filter|search|load more)\b/i,
    ],
  },
  {
    key: 'FILE',
    label: '파일/업로드',
    weight: 3,
    patterns: [
      /업로드|다운로드|첨부|파일|이미지|확장자|용량/,
      /\b(upload|download|attach|attachment|file|image|extension|mime|size limit)\b/i,
    ],
  },
  {
    key: 'NOTIFICATION',
    label: '알림/발송',
    weight: 3,
    patterns: [
      /알림|푸시|문자|SMS|메일|이메일\s*발송|카카오|웹훅/,
      /\b(notification|push|sms|email|mail|webhook|dispatch)\b/i,
    ],
  },
  {
    key: 'STATE',
    label: '상태 저장/동기화',
    weight: 3,
    patterns: [
      /저장|임시\s*저장|캐시|동기화|이어하기|복원|상태\s*유지/,
      /\b(save|autosave|draft|cache|sync|restore|persist|resume)\b/i,
    ],
  },
];

/** 비교 연산자 사전: 표현 → 논리 연산자 */
const COMPARATORS = [
  { op: '>=', patterns: [/이상/, /최소/, /\bat least\b/i, /\bminimum\b/i, /\bmin\b/i, /\bno less than\b/i, />=/] },
  { op: '<=', patterns: [/이하/, /까지/, /이내/, /최대/, /\bat most\b/i, /\bup to\b/i, /\bmaximum\b/i, /\bmax\b/i, /\bno more than\b/i, /\bwithin\b/i, /<=/] },
  { op: '>', patterns: [/초과/, /\bmore than\b/i, /\bgreater than\b/i, /\bover\b/i, />(?!=)/] },
  { op: '<', patterns: [/미만/, /\bless than\b/i, /\bunder\b/i, /<(?!=)/] },
];

/** 단위 정규화: 표기 → 표준 단위명 */
const UNIT_ALIASES = {
  '자': '글자', '글자': '글자', '자리': '자리', 'byte': '바이트', '바이트': '바이트',
  '회': '회', '번': '회', '개': '개', '건': '건',
  '초': '초', 's': '초', 'sec': '초', 'seconds': '초', 'second': '초',
  'ms': 'ms', '밀리초': 'ms', '분': '분', 'minutes': '분', 'minute': '분',
  '시간': '시간', 'hours': '시간', 'hour': '시간', '일': '일', 'days': '일', 'day': '일',
  '%': '%', '원': '원', 'MB': 'MB', 'KB': 'KB', 'GB': 'GB',
};

/** 요구사항 문장으로 보기 어려운 라인(표 구분선, 코드펜스 등) */
const NOISE_PATTERNS = [
  /^\s*$/,
  /^\s*[-=*_]{3,}\s*$/,
  /^\s*\|?[\s:|-]+\|?\s*$/,
  /^\s*```/,
  /^\s*(TODO|FIXME|참고|비고)\s*[:：]?\s*$/i,
];

module.exports = { CATEGORIES, COMPARATORS, UNIT_ALIASES, NOISE_PATTERNS };
