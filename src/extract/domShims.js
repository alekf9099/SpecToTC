'use strict';

/**
 * pdf.js 를 Node 에서 돌리기 위한 최소 DOM 폴리필.
 *
 * 왜 필요한가
 *   pdfjs-dist 는 Node 환경에서 DOMMatrix / ImageData / Path2D 를
 *   optionalDependency 인 `@napi-rs/canvas`(네이티브 바이너리)에서 가져온다.
 *   그 패키지가 없는 환경(다른 OS·arch, `npm i --omit=optional`, 서버리스 번들에
 *   .node 바이너리가 포함되지 않은 경우)에서는 폴리필이 실패하고,
 *   일부 PDF 를 처리할 때 "DOMMatrix is not defined" 로 터진다.
 *
 * 우리는 텍스트만 추출하므로 렌더링용 구현체가 필요하지 않다.
 *   - DOMMatrix : 실제 2D 행렬 연산이 필요하므로 제대로 구현한다.
 *   - ImageData : 픽셀 버퍼만 들고 있으면 된다.
 *   - Path2D    : 경로를 그리지 않으므로 호출을 받아 넘기는 수준으로 둔다.
 *
 * pdf.js 를 import 하기 전에 호출해야 한다. 전역이 이미 있으면(진짜 canvas 가
 * 설치된 환경) 건드리지 않는다.
 */

/** 2D 전용 DOMMatrix. a,b,c,d,e,f 만 쓰며 3D 는 지원하지 않는다. */
class DOMMatrixShim {
  constructor(init) {
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
    this.is2D = true;

    if (typeof init === 'string') {
      // "matrix(a, b, c, d, e, f)" 형태만 해석한다. 그 외 변환 문법은 쓰이지 않는다.
      const nums = init.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi);
      if (nums && nums.length >= 6) this.#setFromArray(nums.map(Number));
    } else if (Array.isArray(init) || (init && typeof init.length === 'number')) {
      this.#setFromArray(Array.from(init, Number));
    } else if (init && typeof init === 'object') {
      for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) {
        if (typeof init[k] === 'number') this[k] = init[k];
      }
    }
  }

  #setFromArray(v) {
    if (v.length >= 16) {
      // 4x4 열 우선 행렬에서 2D 성분만 취한다.
      [this.a, this.b] = [v[0], v[1]];
      [this.c, this.d] = [v[4], v[5]];
      [this.e, this.f] = [v[12], v[13]];
      return;
    }
    if (v.length >= 6) [this.a, this.b, this.c, this.d, this.e, this.f] = v;
  }

  static #of(a, b, c, d, e, f) {
    const m = new DOMMatrixShim();
    m.a = a; m.b = b; m.c = c; m.d = d; m.e = e; m.f = f;
    return m;
  }

  static #coerce(other) {
    return other instanceof DOMMatrixShim ? other : new DOMMatrixShim(other);
  }

  /** this × other (CSS/Canvas 규약: other 가 먼저 적용된다) */
  #multiply(other) {
    const o = DOMMatrixShim.#coerce(other);
    return DOMMatrixShim.#of(
      this.a * o.a + this.c * o.b,
      this.b * o.a + this.d * o.b,
      this.a * o.c + this.c * o.d,
      this.b * o.c + this.d * o.d,
      this.a * o.e + this.c * o.f + this.e,
      this.b * o.e + this.d * o.f + this.f,
    );
  }

  #assign(m) {
    this.a = m.a; this.b = m.b; this.c = m.c; this.d = m.d; this.e = m.e; this.f = m.f;
    return this;
  }

  multiply(other) { return this.#multiply(other); }
  multiplySelf(other) { return this.#assign(this.#multiply(other)); }
  preMultiplySelf(other) { return this.#assign(DOMMatrixShim.#coerce(other).#multiply(this)); }

  translate(tx = 0, ty = 0) { return this.#multiply(DOMMatrixShim.#of(1, 0, 0, 1, tx, ty)); }
  translateSelf(tx = 0, ty = 0) { return this.#assign(this.translate(tx, ty)); }

  scale(sx = 1, sy = sx) { return this.#multiply(DOMMatrixShim.#of(sx, 0, 0, sy === undefined ? sx : sy, 0, 0)); }
  scaleSelf(sx = 1, sy = sx) { return this.#assign(this.scale(sx, sy)); }
  scaleNonUniform(sx = 1, sy = 1) { return this.scale(sx, sy); }

  rotate(deg = 0) {
    const r = (deg * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    return this.#multiply(DOMMatrixShim.#of(cos, sin, -sin, cos, 0, 0));
  }
  rotateSelf(deg = 0) { return this.#assign(this.rotate(deg)); }

  inverse() {
    const det = this.a * this.d - this.b * this.c;
    if (!det) return DOMMatrixShim.#of(NaN, NaN, NaN, NaN, NaN, NaN);
    return DOMMatrixShim.#of(
      this.d / det,
      -this.b / det,
      -this.c / det,
      this.a / det,
      (this.c * this.f - this.d * this.e) / det,
      (this.b * this.e - this.a * this.f) / det,
    );
  }
  invertSelf() { return this.#assign(this.inverse()); }

  transformPoint(point = {}) {
    const x = point.x || 0;
    const y = point.y || 0;
    return {
      x: this.a * x + this.c * y + this.e,
      y: this.b * x + this.d * y + this.f,
      z: 0,
      w: 1,
    };
  }

  toFloat64Array() { return new Float64Array([this.a, this.b, this.c, this.d, this.e, this.f]); }
  toFloat32Array() { return new Float32Array([this.a, this.b, this.c, this.d, this.e, this.f]); }
  toString() { return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`; }
}

/** 픽셀 버퍼 컨테이너. 텍스트 추출 경로에서는 값을 읽지 않는다. */
class ImageDataShim {
  constructor(a, b, c) {
    if (typeof a === 'number') {
      this.width = a;
      this.height = b;
      this.data = new Uint8ClampedArray(a * b * 4);
    } else {
      this.data = a;
      this.width = b;
      this.height = c != null ? c : (a && b ? a.length / 4 / b : 0);
    }
    this.colorSpace = 'srgb';
  }
}

/**
 * 경로 수집 스텁. 렌더링을 하지 않으므로 호출만 받아 넘긴다.
 * (구현이 없으면 "Path2D is not defined" 로 같은 문제가 반복된다.)
 */
class Path2DShim {
  constructor() { this.ops = []; }
  addPath(...args) { this.ops.push(['addPath', args]); }
  moveTo(...args) { this.ops.push(['moveTo', args]); }
  lineTo(...args) { this.ops.push(['lineTo', args]); }
  bezierCurveTo(...args) { this.ops.push(['bezierCurveTo', args]); }
  quadraticCurveTo(...args) { this.ops.push(['quadraticCurveTo', args]); }
  arc(...args) { this.ops.push(['arc', args]); }
  arcTo(...args) { this.ops.push(['arcTo', args]); }
  ellipse(...args) { this.ops.push(['ellipse', args]); }
  rect(...args) { this.ops.push(['rect', args]); }
  roundRect(...args) { this.ops.push(['roundRect', args]); }
  closePath() { this.ops.push(['closePath', []]); }
}

/**
 * 네이티브 canvas(@napi-rs/canvas)가 설치돼 있으면 그쪽 구현을 우선한다.
 * 렌더링 충실도가 높고 pdf.js 가 원래 기대하는 구현이기 때문이다.
 * 없으면 위의 순수 JS 대체 구현을 쓴다.
 */
function loadNativeCanvas() {
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    return require('@napi-rs/canvas');
  } catch (err) {
    return null;
  }
}

/**
 * 없는 전역만 채운다. 이미 있으면 건드리지 않는다.
 * @returns {{installed: string[], source: Record<string, 'native'|'shim'>, native: boolean}}
 */
function installDomShims() {
  const native = loadNativeCanvas();
  const shims = { DOMMatrix: DOMMatrixShim, ImageData: ImageDataShim, Path2D: Path2DShim };

  const installed = [];
  const source = {};

  for (const [name, shim] of Object.entries(shims)) {
    if (globalThis[name]) {
      source[name] = 'preexisting';
      continue;
    }
    const impl = (native && native[name]) || shim;
    globalThis[name] = impl;
    installed.push(name);
    source[name] = native && native[name] ? 'native' : 'shim';
  }

  return {
    installed,
    source,
    // 네이티브 구현을 하나라도 썼는지 (진단용)
    native: Object.values(source).includes('native'),
  };
}

module.exports = { installDomShims, loadNativeCanvas, DOMMatrixShim, ImageDataShim, Path2DShim };
