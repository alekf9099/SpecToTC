# 회원 서비스 기획서 (샘플)

## 1. 로그인

- 아이디와 비밀번호가 모두 입력된 경우에만 로그인 버튼을 활성화한다.
- 비밀번호는 8자 이상 20자 이하로 입력해야 한다.
- 비밀번호를 5회 연속 틀리면 계정을 10분간 잠금 처리한다.
- 로그인 성공 시 홈 화면으로 이동하고, 액세스 토큰을 저장한다.
- 서버 응답이 3초 이내에 오지 않으면 최대 2회 재시도한다.
- 로그인 실패 시 "아이디 또는 비밀번호를 확인해 주세요" 문구를 노출한다.

## 2. 회원가입

- 이메일 형식이 유효하지 않으면 다음 단계로 이동할 수 없다.
- 필수 약관(이용약관, 개인정보 처리방침)에 모두 동의해야 가입을 완료할 수 있다.
- 인증번호는 발송 후 3분간 유효하며, 만료 시 재발송할 수 있다.
- 가입 절차 중간에 이탈하면 입력값을 임시 저장하고, 재진입 시 복원한다.
- 닉네임은 최대 12자까지 허용하며 특수문자를 사용할 수 없다.

## 3. 주문/결제

- 장바구니에 1개 이상 상품이 담긴 경우 결제 버튼을 노출한다.
- 결제 금액이 50,000원 이상이면 배송비를 무료로 처리한다.
- 결제 승인이 실패하면 주문을 확정하지 않고 실패 사유를 안내한다.
- 결제 완료 시 주문 완료 알림을 푸시와 이메일로 발송한다.
- 주문 취소는 결제 후 24시간 이내에만 가능하다.

## 4. 주문 목록

- 주문 목록은 한 페이지에 20건씩 표시하고, 무한 스크롤로 추가 로딩한다.
- 최근 주문일 기준으로 내림차순 정렬한다.
- 주문 내역이 없으면 빈 상태 문구를 노출한다.

## 5. Notification Settings (English section)

- If the user disables push notifications, the app must not send any push message.
- Email digests are sent at most 1 time per day.
- When the notification API returns an error, retry up to 3 times with exponential backoff.
- Users can upload up to 5 attachment files, each no more than 10 MB.
