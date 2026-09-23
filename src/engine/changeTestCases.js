'use strict';

/**
 * 기획서가 **바뀌었을 때** 확인할 테스트케이스.
 *
 * 지금까지 비교(Diff) 결과로는 바뀐 요구사항을 다시 일반 생성기에 넣어 평범한
 * 기능 TC 를 뽑고 `regression` 태그만 붙였다. 그런데 QA 가 개정된 기획서를 받고
 * 실제로 확인하는 것은 그 기능이 되는지가 아니라 **"바뀐 그 부분이 화면에 반영됐는가"** 다.
 *
 *   · 문구가 A → B 로 바뀌었다  → B 가 나오는가, 그리고 **A 가 아무 데도 안 남았는가**
 *   · 기준값이 10 → 20 으로 바뀌었다 → 20 으로 판정하는가, 옛 기준 10 은 더 이상 안 먹는가
 *   · 기능이 추가됐다          → 존재하는가, 그리고 **거기까지 가는 경로**가 생겼는가
 *   · 기능이 빠졌다            → 화면·메뉴에서 사라졌는가, 주소를 직접 쳐도 막히는가
 *
 * 특히 "옛 값이 안 남았는가" 와 "경로가 생겼는가" 는 일반 기능 TC 로는 절대 나오지
 * 않는데, 실제로 개정 반영이 새는 곳은 대부분 이 둘이다. 문구만 고치고 다른 화면에
 * 옛 문구가 남아 있거나, 기능은 만들었는데 메뉴에 안 걸어 둔 경우다.
 */

const {
  clean, step, qa, sys, josa, quoted, quotedList, fmt, calcPriority, boundaryPoints, TYPE,
} = require('./generator');

const TYPE_TAG = { [TYPE.PASS]: '기능 확인', [TYPE.FAIL]: '오류 처리', [TYPE.EDGE]: '경계값' };

function screenOf(req) {
  return String(req.area || '대상').replace(/^\s*[\d.]+\s*/, '').trim() || '대상';
}

/** 제약을 "20글자 이하" 처럼 사람이 읽는 문구로 */
const OP_TEXT = { '>=': '이상', '<=': '이하', '>': '초과', '<': '미만' };
const describeConstraint = (c) => `${fmt(c.value, c.unit)} ${OP_TEXT[c.op] || c.op}`;

/** 두 목록의 차이 — 빠진 것과 새로 생긴 것 */
function diffList(before, after) {
  const a = Array.isArray(before) ? before : [];
  const b = Array.isArray(after) ? after : [];
  return {
    gone: a.filter((x) => !b.includes(x)),
    fresh: b.filter((x) => !a.includes(x)),
  };
}

/* ------------------------------------------------------------- 케이스별 조립 */

/** 4. 문구 변경 — 새 문구가 나오고, 옛 문구가 어디에도 안 남았는지 */
function copyChangeCase(req, oldLiterals, newLiterals) {
  const screen = screenOf(req);
  const gone = oldLiterals.map((t) => `"${t}"`).join(' / ');
  const fresh = newLiterals.map((t) => `"${t}"`).join(' / ');

  return {
    type: TYPE.PASS,
    title: `문구 변경 반영 — ${gone || '(없음)'} → ${fresh}`,
    objective: `${screen} 화면의 문구가 ${quotedList(newLiterals, '으로')} 바뀌었고,`
      + ` 이전 문구 ${oldLiterals.length ? quotedList(oldLiterals, '이') : '(없음)이'} 어디에도 남지 않았는지 확인한다.`,
    precondition: [
      `${screen} 화면에 접근할 수 있는 테스트 계정과 데이터가 준비되어 있다`,
      '해당 문구가 나오는 상황을 만들 수 있다 (오류 유발·빈 목록·완료 화면 등)',
      '개정 전 빌드가 아니라 개정 내용이 반영된 빌드를 보고 있다',
    ],
    steps: [
      step('진입', qa(`${screen} 화면에 진입한다`)),
      step('실행', qa('문구가 나오는 상황을 만든다')),
      step('확인', qa(`화면의 문구를 복사해 ${quotedList(newLiterals, '과')} 나란히 놓고 글자 그대로 같은지 본다`)),
      ...(gone ? [step('확인', qa(
        `이전 문구 ${quotedList(oldLiterals, '으로')} 화면 전체(목록·상세·팝업·토스트·메일·푸시·오류 화면)를 검색한다`,
      ))] : []),
      step('확인', qa('같은 문구를 쓰는 다른 화면이 있으면 그쪽도 함께 본다')),
    ],
    expected: newLiterals.map((t) => sys(`${quoted(t)} 글자 그대로 표시한다 (띄어쓰기·조사·문장부호 포함)`))
      .concat(gone ? [sys(`이전 문구 ${quotedList(oldLiterals, '은')} 어느 화면에서도 더는 보여주지 않는다`)] : [])
      .concat(['같은 문구를 쓰는 다른 화면도 함께 바뀌어 있다']),
    tags: ['change', 'copy', 'front'],
  };
}

/**
 * 5. 결과값 변경 — 새 기준으로 판정하고, 옛 기준은 더 이상 안 먹는지.
 *
 * 처음에는 새 제약 목록의 첫 번째를 집었는데, "8자 이상 20자 이하" 에서 20 만
 * 바뀐 경우 안 바뀐 8 을 집어 엉뚱한 값을 넣게 했다. **실제로 달라진 제약**만 본다.
 * 경계 앞뒤 값도 직접 계산하지 말고 일반 경계값 TC 와 같은 boundaryPoints() 를 쓴다.
 * 손으로 계산했더니 이상/이하의 안팎이 뒤집혔다.
 */
function valueChangeCase(req, before, after, changed) {
  const screen = screenOf(req);
  const oldText = before.length ? before.map(describeConstraint).join(', ') : '없음';
  const newText = after.length ? after.map(describeConstraint).join(', ') : '없음';

  const target = changed[0];
  const dropped = before.filter((c) => !after.some((n) => describeConstraint(n) === describeConstraint(c)));

  const steps = [step('진입', qa(`${screen} 화면에 진입한다`))];
  if (target) {
    boundaryPoints(target).forEach((pt) => {
      steps.push(step('입력', qa(`${pt.label}인 ${josa(fmt(pt.value, target.unit), '을')} 넣고 제출한다`)));
    });
  }
  if (dropped.length) {
    steps.push(step('입력', qa(
      `옛 기준이던 ${describeConstraint(dropped[0])}에 맞춘 값으로도 넣어 본다`
      + ' — 옛 기준으로 판정되면 개정이 반영되지 않은 것이다',
    )));
  }
  steps.push(step('확인', qa('각 값이 통과했는지 거부됐는지, 안내 문구에 적힌 숫자가 몇인지 확인한다')));

  const changedText = changed.map(describeConstraint).join(', ');
  const droppedText = dropped.map(describeConstraint).join(', ');

  return {
    type: TYPE.EDGE,
    title: `기준값 변경 반영 — ${droppedText || '없음'} → ${changedText}`,
    objective: `${screen}의 판정 기준이 ${josa(changedText, '으로')} 바뀌었고,`
      + ` 옛 기준 ${josa(droppedText || '없음', '이')} 더는 적용되지 않는지 확인한다.`,
    precondition: [
      `${screen} 화면에 접근할 수 있는 테스트 계정과 데이터가 준비되어 있다`,
      `기획서 개정 내용: ${oldText} → ${newText}`,
    ],
    steps,
    expected: [
      ...(target ? boundaryPoints(target).map((pt) => sys(
        `${josa(fmt(pt.value, target.unit), '을')} 넣으면 ${pt.verdict}`,
      )) : []),
      sys('안내 문구에 적힌 숫자도 새 기준으로 바뀌어 있다'),
      ...(droppedText ? [sys(`옛 기준 ${josa(droppedText, '으로')}는 더 이상 판정하지 않는다`)] : []),
      '서버와 화면이 같은 기준을 쓴다 (화면만 바뀌고 서버가 옛 기준이면 결함)',
    ],
    tags: ['change', 'boundary'],
  };
}

/** 6·7. 신규 기능 — 존재하는지 + 거기까지 가는 경로가 생겼는지 */
function addedFeatureCase(req) {
  const screen = screenOf(req);
  const action = clean(req.action || req.text);

  return {
    type: TYPE.PASS,
    title: `신규 기능 반영 — ${action}`,
    objective: `이번 개정에 추가된 ${quoted(action, '이')} 실제로 만들어져 동작하는지 확인한다.`,
    precondition: [
      `${screen} 화면에 접근할 수 있는 테스트 계정과 데이터가 준비되어 있다`,
      '이번 개정 내용이 반영된 빌드를 보고 있다',
      ...(req.condition ? [`${clean(req.condition)} 상태를 만들 수 있다`] : []),
    ],
    steps: [
      step('진입', qa(`${screen} 화면에 진입한다`)),
      step('확인', qa('새로 생긴 화면 요소(버튼·메뉴·입력칸·영역)가 실제로 보이는지 확인한다')),
      ...(req.condition ? [step('조건 설정', qa(`${clean(req.condition)} 상태로 만든다`))] : []),
      step('실행', qa('새 기능을 한 번 끝까지 실행한다')),
      step('확인', qa('결과 화면과, 개발자 도구 네트워크 탭의 응답 코드를 확인한다')),
    ],
    expected: [
      sys(action),
      sys('새 기능을 화면에 실제로 보여준다 (기획서에만 있고 화면에 없으면 미반영)'),
      '기존 기능이 이번 변경으로 깨지지 않는다',
      '서버가 정상 응답(200번대)을 준다',
    ],
    tags: ['change', 'new-feature'],
  };
}

/** 7. 신규 기능까지 가는 경로 — 메뉴·링크·주소 직접 입력·뒤로 가기 */
function addedPathCase(req) {
  const screen = screenOf(req);
  const action = clean(req.action || req.text);

  return {
    type: TYPE.PASS,
    title: `신규 기능 진입 경로 반영 — ${action}`,
    objective: `추가된 기능까지 사용자가 실제로 도달할 수 있는지 확인한다. 기능은 만들었는데 메뉴에 안 걸어 두는 일이 가장 흔한 누락이다.`,
    precondition: [
      `${screen} 화면에 접근할 수 있는 테스트 계정과 데이터가 준비되어 있다`,
      '이번 개정 내용이 반영된 빌드를 보고 있다',
    ],
    steps: [
      step('확인', qa(`메뉴·네비게이션·홈에서 ${josa(screen, '으로')} 가는 입구가 생겼는지 찾는다`)),
      step('이동', qa('그 입구를 눌러 실제로 해당 화면까지 이동한다')),
      step('이동', qa('주소를 직접 입력하거나 딥링크로도 같은 화면에 들어가 본다')),
      step('실행', qa('뒤로 가기를 눌러 이전 화면으로 제대로 돌아오는지 본다')),
      step('확인', qa('권한이 없는 계정으로 로그인해 같은 경로가 어떻게 보이는지 확인한다')),
      step('확인', qa('새로고침해도 같은 화면이 유지되는지 확인한다')),
    ],
    expected: [
      sys('메뉴나 화면 안에 새 기능으로 가는 입구를 보여준다'),
      sys('주소 직접 입력·딥링크로도 같은 화면을 연다'),
      sys('뒤로 가기를 누르면 이전 화면으로 되돌린다'),
      sys('현재 위치를 메뉴에 활성 표시한다'),
      '권한이 없는 계정에는 입구를 보여주지 않거나, 눌렀을 때 권한 안내로 막는다',
    ],
    tags: ['change', 'new-feature', 'navigation'],
  };
}

/** 제거된 요구사항 — 화면에서도 실제로 사라졌는지 */
function removedFeatureCase(req) {
  const screen = screenOf(req);
  const action = clean(req.action || req.text);

  return {
    type: TYPE.FAIL,
    title: `삭제된 기능이 화면에서도 빠졌는지 — ${action}`,
    objective: `이번 개정에서 빠진 ${quoted(action, '이')} 화면·메뉴·주소 어디에도 남아 있지 않은지 확인한다.`,
    precondition: [
      `${screen} 화면에 접근할 수 있는 테스트 계정과 데이터가 준비되어 있다`,
      '이번 개정 내용이 반영된 빌드를 보고 있다',
      '삭제 정책을 기획에 확인했다 (완전 삭제인지, 숨김인지, 기존 데이터는 어떻게 하는지)',
    ],
    steps: [
      step('확인', qa(`${screen} 화면과 메뉴에서 해당 기능이 보이는지 찾는다`)),
      step('진입', qa('예전 주소를 직접 입력해 들어가 본다')),
      step('실행', qa('개발자 도구 네트워크 탭에서 예전 API 를 직접 호출해 본다')),
      step('확인', qa('이 기능으로 만들어 둔 기존 데이터가 어떻게 보이는지 확인한다')),
    ],
    expected: [
      sys('화면과 메뉴에서 해당 기능을 더는 보여주지 않는다'),
      sys('예전 주소로 들어가면 안내 화면으로 보내거나 없는 페이지(404)로 응답한다'),
      sys('예전 API 를 직접 불러도 받아 주지 않는다 (화면만 가리고 서버가 살아 있으면 결함)'),
      '기존 데이터의 처리(유지·숨김·삭제)가 기획에 확인한 정책과 같다',
    ],
    tags: ['change', 'removed'],
  };
}

/** 나머지 수정 — 무엇이 어떻게 바뀌었는지 짚어 주고 대조하게 한다 */
function generalChangeCase(req, previousText, notes) {
  const screen = screenOf(req);

  return {
    type: TYPE.PASS,
    title: `변경 내용 반영 — ${clean(req.action || req.text)}`,
    objective: `${screen} 에서 이번 개정으로 바뀐 내용이 화면에 그대로 반영됐는지 확인한다.`,
    precondition: [
      `${screen} 화면에 접근할 수 있는 테스트 계정과 데이터가 준비되어 있다`,
      `개정 전 문장: ${clean(previousText)}`,
      `개정 후 문장: ${clean(req.text)}`,
    ],
    steps: [
      step('진입', qa(`${screen} 화면에 진입한다`)),
      step('확인', qa('개정 전·후 문장을 나란히 놓고 무엇이 달라졌는지 짚는다')),
      step('실행', qa('개정 후 문장대로 한 번 실행한다')),
      step('확인', qa('개정 전 동작이 남아 있지는 않은지 확인한다')),
    ],
    expected: [
      sys(clean(req.action || req.text)),
      ...notes.map((n) => `변경점이 반영돼 있다 — ${n}`),
      '개정 전 동작이 함께 남아 있지 않다',
    ],
    tags: ['change', 'modified'],
  };
}

/* --------------------------------------------------------------------- 조립 */

/**
 * 비교 결과 → 변경 확인 테스트케이스
 *
 * 일반 생성기와 **같은 모양**을 돌려준다. 그래야 표·필터·CSV·PDF 가 그대로 쓰인다.
 *
 * @param {{added:Array, removed:Array, modified:Array}} diff
 */
function buildChangeTestCases(diff) {
  const out = [];
  const counters = { P: 0, F: 0, E: 0 };
  const CODE = { [TYPE.PASS]: 'P', [TYPE.FAIL]: 'F', [TYPE.EDGE]: 'E' };

  const emit = (req, tc) => {
    const code = CODE[tc.type];
    counters[code] += 1;
    const title = `[${TYPE_TAG[tc.type]}] ${tc.title}`;

    out.push({
      tc_id: `TC-CH-${code}-${String(counters[code]).padStart(3, '0')}`,
      type: tc.type,
      // 개정 반영 확인은 놓치면 그대로 출시되므로 일반 TC 보다 한 단계 높게 본다
      priority: calcPriority(req, tc.type) === 'Low' ? 'Med' : calcPriority(req, tc.type),
      area: req.area,
      title,
      objective: tc.objective,
      precondition: tc.precondition,
      steps: tc.steps,
      expected: tc.expected,
      requirement: {
        id: req.id,
        text: req.text,
        line: req.line,
        categories: req.categories || [],
      },
      tags: [...tc.tags, 'regression'],
      origin: 'change',

      scenario: title,
      requirement_id: req.id,
      source_text: req.text,
      source_line: req.line,
      categories: req.categories || [],
    });
  };

  for (const item of diff.added || []) {
    const req = item.requirement;
    emit(req, addedFeatureCase(req));
    emit(req, addedPathCase(req));
  }

  for (const item of diff.modified || []) {
    const req = item.requirement;
    const before = item.previous || {};

    // 문구가 바뀌었으면 그것부터. 개정에서 가장 자주 있고, 가장 자주 새는 항목이다.
    const lit = diffList(before.literals, req.literals);
    if (lit.fresh.length) emit(req, copyChangeCase(req, lit.gone, lit.fresh));

    // 수치 기준이 바뀌었으면 새 기준·옛 기준을 함께 본다
    const oldC = before.constraints || [];
    const newC = req.constraints || [];
    const oldKeys = oldC.map(describeConstraint);
    const changedC = newC.filter((c) => !oldKeys.includes(describeConstraint(c)));
    const sameNums = oldKeys.join('|') === newC.map(describeConstraint).join('|');
    if (changedC.length) emit(req, valueChangeCase(req, oldC, newC, changedC));

    // 문구도 수치도 아니면, 무엇이 달라졌는지 짚어 주는 대조 TC 하나
    if (!lit.fresh.length && sameNums) {
      emit(req, generalChangeCase(req, item.previousText || '', item.changes || []));
    }
  }

  for (const item of diff.removed || []) {
    emit(item.requirement, removedFeatureCase(item.requirement));
  }

  return out;
}

module.exports = { buildChangeTestCases, diffList };
