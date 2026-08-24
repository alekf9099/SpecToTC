'use strict';

/**
 * 라이트/다크 테마 전환.
 *
 * 세 상태를 순환한다: 자동(OS 설정) → 라이트 → 다크 → 자동.
 * 선택은 localStorage 에 남기고, 화면이 그려지기 전(head)에 적용해 깜빡임을 막는다.
 * 자동일 때는 data-theme 속성을 지워 CSS 의 prefers-color-scheme 규칙이 판단하게 한다.
 */
(function initTheme() {
  const KEY = 'spectotc_theme';
  const ORDER = ['system', 'light', 'dark'];
  const LABEL = { system: '자동', light: '라이트', dark: '다크' };
  const ICON = { system: '◐', light: '☀', dark: '☾' };

  function read() {
    try {
      const v = localStorage.getItem(KEY);
      return ORDER.includes(v) ? v : 'system';
    } catch (err) {
      return 'system';
    }
  }

  function apply(mode) {
    const root = document.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
  }

  // 첫 페인트 전에 적용 (head 에서 실행된다)
  apply(read());

  /** 버튼이 있으면 배선한다. 없으면(로그인 화면 등) 적용만 하고 끝난다. */
  function bindButton() {
    const btn = document.querySelector('#btnTheme');
    if (!btn) return;

    const render = () => {
      const mode = read();
      btn.textContent = `${ICON[mode]} ${LABEL[mode]}`;
      btn.title = `테마: ${LABEL[mode]} (클릭하면 다음으로 전환)`;
      btn.setAttribute('aria-label', `테마 전환 — 현재 ${LABEL[mode]}`);
    };

    btn.addEventListener('click', () => {
      const next = ORDER[(ORDER.indexOf(read()) + 1) % ORDER.length];
      try {
        localStorage.setItem(KEY, next);
      } catch (err) {
        // 저장이 막힌 브라우저에서도 현재 세션에는 적용된다.
      }
      apply(next);
      render();
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindButton);
  } else {
    bindButton();
  }
}());
