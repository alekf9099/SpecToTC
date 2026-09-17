'use strict';

/**
 * TC 를 "읽는 문서"가 아니라 **지워 나가는 체크리스트**로 쓰게 한다.
 *
 * QA 는 표를 위에서 아래로 훑으며 하나씩 처리한다. 그런데 화면에는 어디까지
 * 했는지 남는 곳이 없어서, 창을 닫거나 필터를 바꾸면 위치를 잃어버렸다.
 *
 * 그래서 두 층으로 체크한다.
 *   TC 단위   — 이 케이스를 다 봤는가
 *   수행 단계 — 이 케이스 안에서 어느 단계까지 했는가
 *
 * 체크 상태는 **이 브라우저에만** 남는다. 서버로 가지 않고, 다른 사람과
 * 공유되지도 않는다. 공유가 필요하면 CSV 로 내보내면 된다 — 내보낸 파일에
 * ☑ / ☐ 로 그대로 찍힌다.
 */

const CHECK_KEY = 'spectotc.checks.v1';

/** { [tc_id]: { done: boolean, steps: number[] } } */
let checks = {};

/* ------------------------------------------------------------------ 저장 */

/**
 * localStorage 는 시크릿 창·사이트 데이터 차단·미리보기에서 읽기만 해도 던진다.
 * 체크는 편의 기능이라 여기서 실패해도 화면은 그대로 동작해야 한다.
 */
function loadChecks() {
  try {
    const raw = localStorage.getItem(CHECK_KEY);
    checks = raw ? JSON.parse(raw) || {} : {};
  } catch (err) {
    checks = {};
  }
  return checks;
}

function saveChecks() {
  try {
    localStorage.setItem(CHECK_KEY, JSON.stringify(checks));
  } catch (err) {
    /* 저장할 수 없어도 이번 세션 동안의 체크는 그대로 쓴다 */
  }
}

/* ------------------------------------------------------------------ 읽기 */

function entryOf(tcId) {
  const e = checks[tcId];
  return e && typeof e === 'object' ? e : { done: false, steps: [] };
}

function isChecked(tcId) {
  return entryOf(tcId).done === true;
}

function checkedSteps(tcId) {
  const steps = entryOf(tcId).steps;
  return Array.isArray(steps) ? steps : [];
}

function isStepChecked(tcId, index) {
  return checkedSteps(tcId).includes(index);
}

/* ------------------------------------------------------------------ 쓰기 */

function setChecked(tcId, done) {
  const e = entryOf(tcId);
  checks[tcId] = { done: !!done, steps: e.steps || [] };
  saveChecks();
}

/**
 * 단계를 체크한다. 모든 단계를 체크하면 TC 자체도 자동으로 체크된다 —
 * 단계를 다 지우고 나서 위에서 한 번 더 체크하게 만들 이유가 없다.
 */
function setStepChecked(tcId, index, done, totalSteps) {
  const e = entryOf(tcId);
  const next = new Set(Array.isArray(e.steps) ? e.steps : []);
  if (done) next.add(index);
  else next.delete(index);

  const steps = [...next].sort((a, b) => a - b);

  // 단계를 다 채우면 TC 도 완료. 반대로 하나를 되돌리면 TC 완료도 풀린다.
  let tcDone = e.done === true;
  if (totalSteps > 0 && steps.length === totalSteps) tcDone = true;
  else if (!done) tcDone = false;

  checks[tcId] = { done: tcDone, steps };
  saveChecks();
}

/** 보이는 TC 전체를 켜거나 끈다 (표 머리의 전체 체크) */
function setAllChecked(tcIds, done) {
  tcIds.forEach((id) => {
    const e = entryOf(id);
    checks[id] = { done: !!done, steps: e.steps || [] };
  });
  saveChecks();
}

function clearChecks() {
  checks = {};
  saveChecks();
}

/* ------------------------------------------------------------- 내보내기용 */

/** CSV·JSON 으로 넘기기 전에 체크 상태를 TC 에 붙인다. */
function withChecks(testCases) {
  return (testCases || []).map((tc) => ({
    ...tc,
    _checked: isChecked(tc.tc_id),
    _checkedSteps: checkedSteps(tc.tc_id),
  }));
}

/** 진행률 — { done, total, percent } */
function progressOf(testCases) {
  const total = (testCases || []).length;
  const done = (testCases || []).filter((tc) => isChecked(tc.tc_id)).length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

loadChecks();
